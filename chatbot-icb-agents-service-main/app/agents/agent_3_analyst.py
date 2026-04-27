import logging
import time
from datetime import datetime
from google.cloud import firestore as fs_module
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from app.core.config import settings

logger = logging.getLogger("icb.ai")

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0)

# Cada cuántos hilos se cierra un bloque y se apila resumen_rolling en resumenes[].
BLOCK_SIZE = 20
# Cada cuántos resumenes[] se genera un super resumen y se vacía resumenes[].
SUPER_BLOCK_SIZE = 5

# ── Resumen rolling (se actualiza en cada intercambio) ────────────────────────
_summary_prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un asistente que mantiene un resumen acumulativo de una sesión de tutoría de Cálculo 1.
Se te dará el resumen actual, el último intercambio y, opcionalmente, los resultados de los ejercicios de pensamiento crítico que hizo el alumno tras la respuesta. Actualiza el resumen incorporando todo eso.

REGLAS:
- Máximo 7 oraciones.
- Menciona los temas matemáticos tratados (derivadas, límites, integrales, etc.).
- Destaca si el alumno cometió errores conceptuales importantes.
- Si hay resultados de ejercicios, indica qué falló y qué acertó (concepto/V o F/encuentra el error) — esto es información valiosa de comprensión.
- Escribe en español, en tercera persona ("El alumno preguntó...", "Falló el V o F sobre...").
- Si el resumen actual está vacío, crea uno nuevo basado solo en el intercambio.
- NO incluyas la respuesta completa del tutor, solo el tema y punto clave."""),
    ("human", """Resumen actual:
{resumen_actual}

Último intercambio:
Alumno: {question}
Tutor: {answer}

Resultados de ejercicios de pensamiento crítico (si hay):
{exercise_results}

Escribe el resumen actualizado:"""),
])

_summary_chain = _summary_prompt | llm | StrOutputParser()

# ── Resumen de bloque (cuando se cierra un bloque de BLOCK_SIZE hilos) ────────
_block_summary_prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un asistente que sintetiza un BLOQUE de conversación de tutoría de Cálculo 1.
Se te dará el resumen acumulativo del bloque (rolling) y debes producir un resumen de bloque más largo, denso y útil para que un tutor pueda recuperar contexto rápido.

REGLAS:
- Entre 6 y 10 oraciones.
- Lista los temas matemáticos abordados, las dificultades específicas del alumno, los aciertos y los errores en ejercicios de pensamiento crítico.
- Estilo claro, en español, tercera persona.
- Termina con una línea "Estado:" describiendo dónde quedó el alumno (ej. "Estado: comprende derivadas básicas, falla regla de la cadena")."""),
    ("human", """Resumen rolling del bloque a cerrar:
{resumen_rolling}

Escribe el resumen de bloque:"""),
])

_block_summary_chain = _block_summary_prompt | llm | StrOutputParser()

# ── Super resumen (cada SUPER_BLOCK_SIZE bloques) ─────────────────────────────
_super_summary_prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un asistente que sintetiza VARIOS bloques de tutoría de Cálculo 1 en un solo super resumen de largo plazo.

REGLAS:
- Entre 8 y 12 oraciones.
- Identifica patrones (qué temas domina, cuáles se le repiten, errores conceptuales recurrentes).
- Lista los temas estudiados ordenados aproximadamente por frecuencia/profundidad.
- Termina con dos líneas: "Fortalezas:" y "Debilidades:".
- Español, tercera persona, denso pero claro."""),
    ("human", """Resúmenes de bloque a colapsar:
{bloques}

Escribe el super resumen:"""),
])

_super_summary_chain = _super_summary_prompt | llm | StrOutputParser()


def _format_exercise_results(exercise_results: dict | None) -> str:
    if not exercise_results:
        return "Ninguno."
    lines = []
    for tipo in ("concepto", "vof", "error"):
        e = exercise_results.get(tipo) or {}
        if not e.get("answered"):
            continue
        ok = "ACERTÓ" if e.get("es_correcto") else "FALLÓ"
        lines.append(f"- {tipo}: {ok}")
    return "\n".join(lines) if lines else "Ninguno."


def _append_system_hilo(db, id_chat_nr: str, texto: str) -> None:
    """Crea un hilo tipo 'system' permanente en el historial — análogo a cuando Claude muestra un resumen de contexto."""
    try:
        chat_ref = db.collection("Chat_nr").document(id_chat_nr)
        chat_snap = chat_ref.get()
        chat_data = chat_snap.to_dict() or {}
        new_count = (chat_data.get("total_hilos") or 0) + 1
        id_tail = chat_data.get("id_tail") or ""

        new_doc = db.collection("Hilo_chat").add({
            "id_chat_nr": id_chat_nr,
            "tipo": "system",
            "texto": texto,
            "tema": None,
            "count": new_count,
            "id_next": "",
            "created_at": datetime.utcnow(),
        })
        new_id = new_doc[1].id

        if id_tail:
            db.collection("Hilo_chat").document(id_tail).update({"id_next": new_id})

        update = {"id_tail": new_id, "total_hilos": fs_module.Increment(1)}
        if not chat_data.get("id_head"):
            update["id_head"] = new_id
        chat_ref.update(update)
        logger.info(f"system hilo creado en chat={id_chat_nr} → {texto[:60]}")
    except Exception as e:
        logger.warning(f"_append_system_hilo falló: {e}")


def update_conversation_summary(
    id_chat_nr: str,
    resumen_actual: str,
    question: str,
    answer: str,
    total_hilos: int = 0,
    exercise_results: dict | None = None,
) -> None:
    """
    Genera resumen rolling y lo persiste en Chat_nr/{id_chat_nr}. Corre en background.
    Si total_hilos cierra un bloque (múltiplo de BLOCK_SIZE), apila el rolling en resumenes[]
    y crea un hilo system. Cada SUPER_BLOCK_SIZE bloques cerrados, colapsa resumenes[] en super_resumenes[].
    """
    try:
        from app.core.firestore_client import db

        nuevo_resumen = _summary_chain.invoke({
            "resumen_actual": resumen_actual or "Sin resumen previo.",
            "question": question[:600],
            "answer": answer[:800],
            "exercise_results": _format_exercise_results(exercise_results),
        })

        chat_ref = db.collection("Chat_nr").document(id_chat_nr)

        # ¿Este intercambio cierra un bloque de BLOCK_SIZE hilos?
        cierra_bloque = total_hilos > 0 and (total_hilos % BLOCK_SIZE) == 0

        if not cierra_bloque:
            chat_ref.update({
                "resumen_rolling": nuevo_resumen,
                "fecha_resumen": datetime.utcnow(),
            })
            logger.info(f"resumen_rolling actualizado chat={id_chat_nr} (hilos={total_hilos})")
            return

        # Cerrar bloque: condensar el rolling en un resumen de bloque y apilar.
        bloque_resumido = _block_summary_chain.invoke({"resumen_rolling": nuevo_resumen})
        chat_ref.update({
            "resumen_rolling": "",
            "resumenes": fs_module.ArrayUnion([bloque_resumido]),
            "fecha_resumen": datetime.utcnow(),
        })
        _append_system_hilo(
            db,
            id_chat_nr,
            f"🧠 Contexto resumido — bloque de {BLOCK_SIZE} mensajes consolidado.",
        )
        logger.info(f"bloque cerrado en chat={id_chat_nr} (hilos={total_hilos})")

        # ¿Toca super resumen?
        chat_snap = chat_ref.get()
        resumenes = (chat_snap.to_dict() or {}).get("resumenes") or []
        if len(resumenes) >= SUPER_BLOCK_SIZE:
            bloques_text = "\n\n".join([f"Bloque {i+1}:\n{r}" for i, r in enumerate(resumenes)])
            super_resumen = _super_summary_chain.invoke({"bloques": bloques_text})
            chat_ref.update({
                "resumenes": [],
                "super_resumenes": fs_module.ArrayUnion([super_resumen]),
            })
            _append_system_hilo(
                db,
                id_chat_nr,
                f"🧠 Super resumen — {SUPER_BLOCK_SIZE} bloques consolidados en memoria de largo plazo.",
            )
            logger.info(f"super resumen creado en chat={id_chat_nr}")
    except Exception as e:
        logger.warning(f"update_conversation_summary falló: {e}")


def save_reinforcement_to_firestore(id_chat_nr: str, reinforcement: dict, videos: list = None) -> None:
    """Guarda el reinforcement en Chat_nr/{id_chat_nr}. El frontend lo recibe via onSnapshot."""
    try:
        from app.core.firestore_client import db
        db.collection("Chat_nr").document(id_chat_nr).update({
            "last_reinforcement": {
                "nivel": reinforcement.get("nivel", "amarillo"),
                "texto": reinforcement.get("texto", ""),
                "ejercicios": reinforcement.get("ejercicios", []),
                "videos": videos or [],
                "saved_at": time.time(),
            }
        })
        logger.info(f"Reinforcement guardado en Chat_nr/{id_chat_nr}")
    except Exception as e:
        logger.warning(f"save_reinforcement_to_firestore falló: {e}")


# ── Nuevo sistema de perfil basado en ejercicios ──────────────────────────────

def _recompute_weak_points_text(db, uid: str) -> None:
    """
    Recomputa weak_points_text en Perfil_usuario/{uid} leyendo todos los documentos
    de la subcolección 'temas'. Se llama después de cualquier actualización de perfil.
    """
    try:
        temas_docs = db.collection("Perfil_usuario").document(uid).collection("temas").stream()
        weak_lines = []
        for doc in temas_docs:
            data = doc.to_dict()
            tema = data.get("tema", doc.id)
            errores_vof = data.get("vof_errores", 0)
            errores_error = data.get("error_errores", 0)
            errores_concepto = data.get("concepto_errores", 0)
            errores_rojo = data.get("errores_rojo", 0)
            total_errores = errores_vof + errores_error + errores_concepto + errores_rojo

            if total_errores > 0:
                partes = []
                if errores_vof > 0:
                    partes.append(f"falla en preguntas V/F ({errores_vof} errores)")
                if errores_error > 0:
                    partes.append(f"dificultad identificando errores ({errores_error} errores)")
                if errores_concepto > 0:
                    partes.append(f"explicación de conceptos débil ({errores_concepto} errores)")
                if errores_rojo > 0:
                    partes.append(f"errores conceptuales graves en chat ({errores_rojo} veces)")
                weak_lines.append(f"[{tema}] " + "; ".join(partes))

        weak_points_text = "\n".join(weak_lines) if weak_lines else ""
        db.collection("Perfil_usuario").document(uid).set({
            "weak_points_text": weak_points_text,
            "fecha_actualizacion": datetime.utcnow(),
        }, merge=True)
        logger.info(f"Agent3: weak_points_text recomputado para uid={uid} ({len(weak_lines)} temas con errores)")
    except Exception as e:
        logger.warning(f"_recompute_weak_points_text falló uid={uid}: {e}")


def update_profile_from_exercises(uid: str, tema: str, results: dict, id_chat_nr: str | None = None) -> None:
    """
    Actualiza el perfil del usuario con los resultados de los ejercicios del panel.
    Si id_chat_nr está presente, también incrementa contadores en Chat_nr — esto permite que
    el perfil/leaderboard se actualicen automáticamente cuando se elimina un chat.

    results = {
        "concepto": {"answered": bool, "es_correcto": bool},
        "vof":      {"answered": bool, "es_correcto": bool},
        "error":    {"answered": bool, "es_correcto": bool},
    }
    """
    try:
        from app.core.firestore_client import db
        ref = (
            db.collection("Perfil_usuario").document(uid)
            .collection("temas").document(tema)
        )

        updates = {
            "tema": tema,
            "ultima_actividad": datetime.utcnow(),
        }
        chat_updates = {}

        if results.get("concepto", {}).get("answered"):
            if results["concepto"].get("es_correcto"):
                updates["concepto_aciertos"] = fs_module.Increment(1)
                chat_updates["aciertos_concepto"] = fs_module.Increment(1)
            else:
                updates["concepto_errores"] = fs_module.Increment(1)
                chat_updates["errores_concepto"] = fs_module.Increment(1)

        if results.get("vof", {}).get("answered"):
            if results["vof"].get("es_correcto"):
                updates["vof_aciertos"] = fs_module.Increment(1)
                chat_updates["aciertos_vof"] = fs_module.Increment(1)
            else:
                updates["vof_errores"] = fs_module.Increment(1)
                chat_updates["errores_vof"] = fs_module.Increment(1)

        if results.get("error", {}).get("answered"):
            if results["error"].get("es_correcto"):
                updates["error_aciertos"] = fs_module.Increment(1)
                chat_updates["aciertos_error"] = fs_module.Increment(1)
            else:
                updates["error_errores"] = fs_module.Increment(1)
                chat_updates["errores_error"] = fs_module.Increment(1)

        ref.set(updates, merge=True)
        logger.info(f"Agent3: perfil ejercicios actualizado → uid={uid}, tema={tema}")

        if id_chat_nr and chat_updates:
            try:
                db.collection("Chat_nr").document(id_chat_nr).update(chat_updates)
                logger.info(f"Agent3: contadores Chat_nr actualizados → chat={id_chat_nr}")
            except Exception as ce:
                logger.warning(f"Agent3: actualizar contadores Chat_nr falló: {ce}")

        # Recomputar weak_points_text
        _recompute_weak_points_text(db, uid)
    except Exception as e:
        logger.warning(f"update_profile_from_exercises falló uid={uid}: {e}")


def update_profile_from_rojo(uid: str, tema: str, question: str) -> None:
    """
    Registra un error conceptual grave (nivel='rojo') detectado en el chat principal.
    Solo se llama cuando el reinforcer clasifica nivel='rojo'.
    """
    try:
        from app.core.firestore_client import db
        ref = (
            db.collection("Perfil_usuario").document(uid)
            .collection("temas").document(tema)
        )
        ref.set({
            "tema": tema,
            "errores_rojo": fs_module.Increment(1),
            "ultima_actividad": datetime.utcnow(),
        }, merge=True)
        logger.info(f"Agent3: error rojo registrado → uid={uid}, tema={tema}")

        _recompute_weak_points_text(db, uid)
    except Exception as e:
        logger.warning(f"update_profile_from_rojo falló uid={uid}: {e}")


def get_latest_weak_points(uid: str) -> str:
    """Lee el campo weak_points_text pre-computado en Perfil_usuario/{uid}."""
    try:
        from app.core.firestore_client import db
        doc = db.collection("Perfil_usuario").document(uid).get()
        if doc.exists:
            return doc.to_dict().get("weak_points_text", "")
        return ""
    except Exception as e:
        logger.warning(f"get_latest_weak_points falló: {e}")
        return ""
