import logging
import time
from datetime import datetime
from google.cloud import firestore as fs_module
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from app.core.config import settings
from app.core.firestore_client import db
from app.routers.ai.prompts import (
    BLOCK_SUMMARY_SYSTEM, BLOCK_SUMMARY_HUMAN,
    SUPER_SUMMARY_SYSTEM, SUPER_SUMMARY_HUMAN,
)

logger = logging.getLogger("icb.ai")

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0)

# Cada cuántos hilos se cierra un bloque y se apila resumen_rolling en resumenes[].
BLOCK_SIZE = 20
# Cada cuántos resumenes[] se genera un super resumen y se vacía resumenes[].
SUPER_BLOCK_SIZE = 5

# ── Cadenas de resumen ────────────────────────────────────────────────────────
_block_summary_prompt = ChatPromptTemplate.from_messages([("system", BLOCK_SUMMARY_SYSTEM), ("human", BLOCK_SUMMARY_HUMAN)])
_block_summary_chain = _block_summary_prompt | llm | StrOutputParser()

_super_summary_prompt = ChatPromptTemplate.from_messages([("system", SUPER_SUMMARY_SYSTEM), ("human", SUPER_SUMMARY_HUMAN)])
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


def _append_system_hilo(id_chat_nr: str, texto: str) -> None:
    """Crea un hilo tipo 'system' permanente en el historial."""
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
    question: str,
    answer: str,
    total_hilos: int = 0,
    exercise_results: dict | None = None,
) -> None:
    """
    Acumula los intercambios en resumen_rolling (lista) sin llamar al LLM por cada mensaje.
    Si total_hilos cierra un bloque (múltiplo de BLOCK_SIZE), genera un resumen de bloque extenso
    a partir de los intercambios crudos acumulados, lo apila en resumenes[] y resetea el rolling.
    Cada SUPER_BLOCK_SIZE bloques cerrados, colapsa resumenes[] en super_resumenes[].
    Corre en background.
    """
    try:
        chat_ref = db.collection("Chat_nr").document(id_chat_nr)
        nueva_entrada = {
            "pregunta": question,
            "respuesta": answer,
            "exercise_results": _format_exercise_results(exercise_results),
        }

        cierra_bloque = total_hilos > 0 and (total_hilos % BLOCK_SIZE) == 0

        if not cierra_bloque:
            # Solo acumular — sin LLM.
            chat_ref.update({
                "resumen_rolling": fs_module.ArrayUnion([nueva_entrada]),
                "fecha_resumen": datetime.utcnow(),
            })
            logger.info(f"resumen_rolling acumulado chat={id_chat_nr} (hilos={total_hilos})")
            return

        # Cerrar bloque: leer rolling acumulado + nueva entrada, generar resumen extenso.
        chat_snap = chat_ref.get()
        rolling_actual: list = list((chat_snap.to_dict() or {}).get("resumen_rolling") or [])
        # Asegurar que la entrada actual esté incluida (puede no estar aún en Firestore)
        rolling_actual.append(nueva_entrada)

        intercambios_texto = "\n\n".join(
            f"Intercambio {i+1}:\nAlumno: {e.get('pregunta', '')}\nTutor: {e.get('respuesta', '')}"
            + (f"\nEjercicios: {e.get('exercise_results', '')}" if e.get('exercise_results') and e.get('exercise_results') != "Ninguno." else "")
            for i, e in enumerate(rolling_actual)
        )

        bloque_resumido = _block_summary_chain.invoke({"intercambios": intercambios_texto})
        chat_ref.update({
            "resumen_rolling": [],
            "resumenes": fs_module.ArrayUnion([bloque_resumido]),
            "fecha_resumen": datetime.utcnow(),
        })
        _append_system_hilo(
            id_chat_nr,
            f"🧠 Contexto resumido — bloque de {BLOCK_SIZE} mensajes consolidado.",
        )
        logger.info(f"bloque cerrado en chat={id_chat_nr} (hilos={total_hilos}, intercambios={len(rolling_actual)})")

        # ¿Toca super resumen?
        chat_snap2 = chat_ref.get()
        resumenes = (chat_snap2.to_dict() or {}).get("resumenes") or []
        if len(resumenes) > 0 and len(resumenes) % SUPER_BLOCK_SIZE == 0:
            bloques_text = "\n\n".join([f"Bloque {i+1}:\n{r}" for i, r in enumerate(resumenes)])
            super_resumen = _super_summary_chain.invoke({"bloques": bloques_text})
            chat_ref.update({
                "resumenes": [],
                "super_resumenes": fs_module.ArrayUnion([super_resumen]),
            })
            _append_system_hilo(
                id_chat_nr,
                f"🧠 Super resumen — {SUPER_BLOCK_SIZE} bloques consolidados en memoria de largo plazo.",
            )
            logger.info(f"super resumen creado en chat={id_chat_nr}")
    except Exception as e:
        logger.warning(f"update_conversation_summary falló: {e}")


def save_reinforcement_to_firestore(id_chat_nr: str, reinforcement: dict, videos: list = None) -> None:
    """
    Guarda el reinforcement en dos lugares:
    1. Chat_nr/{id_chat_nr}.last_reinforcement  → dispara onSnapshot en el frontend
    2. Hilo_chat/{id_tail}.reinforcement         → fuente directa para restaurar estado al recargar

    El Python lee id_tail ANTES de hacer cualquier escritura para evitar race conditions
    con update_conversation_summary (que también puede modificar id_tail).
    Para cuando este background corre, el frontend ya completó saveExchange y actualizó id_tail.
    """
    try:
        reinforcement_data = {
            "nivel": reinforcement.get("nivel", "amarillo"),
            "texto": reinforcement.get("texto", ""),
            "ejercicios": reinforcement.get("ejercicios", []),
            "videos": videos or [],
            "saved_at": time.time(),
        }

        chat_ref = db.collection("Chat_nr").document(id_chat_nr)

        # Leer id_tail primero, antes de cualquier escritura
        chat_snap = chat_ref.get()
        id_tail = (chat_snap.to_dict() or {}).get("id_tail") if chat_snap.exists else None

        # 1. Guardar en Chat_nr.last_reinforcement (dispara onSnapshot en frontend)
        chat_ref.update({"last_reinforcement": reinforcement_data})
        logger.info(f"Reinforcement guardado en Chat_nr/{id_chat_nr}")

        # 2. Guardar directamente en Hilo_chat/{id_tail} (más confiable que el flujo frontend)
        if id_tail:
            db.collection("Hilo_chat").document(id_tail).update({"reinforcement": reinforcement_data})
            logger.info(f"Reinforcement guardado en Hilo_chat/{id_tail}")
        else:
            logger.warning(f"save_reinforcement_to_firestore: id_tail vacío en Chat_nr/{id_chat_nr}")

        # 3. Anotar ejercicios en el último intercambio de Contexto_chat
        #    para que el responder los vea en conversaciones futuras
        ejercicios = reinforcement.get("ejercicios") or []
        if ejercicios:
            try:
                ctx_ref = db.collection("Contexto_chat").document(id_chat_nr)
                ctx_snap = ctx_ref.get()
                if ctx_snap.exists:
                    intercambios = list((ctx_snap.to_dict() or {}).get("intercambios") or [])
                    if intercambios:
                        # Anotar en el último intercambio
                        intercambios[-1]["ejercicios"] = [
                            {
                                "tipo": e.get("tipo"),
                                "enunciado": e.get("enunciado", ""),
                                "respuesta_correcta": e.get("respuesta_correcta"),
                                "desarrollo": e.get("desarrollo"),
                                "paso_error": e.get("paso_error"),
                            }
                            for e in ejercicios
                        ]
                        ctx_ref.set({"intercambios": intercambios}, merge=True)
                        logger.info(f"Ejercicios anotados en Contexto_chat/{id_chat_nr} (último intercambio)")
            except Exception as ce:
                logger.warning(f"save_reinforcement: anotar en Contexto_chat falló: {ce}")

    except Exception as e:
        logger.warning(f"save_reinforcement_to_firestore falló: {e}")


def _compute_nivel(errores_vof: int, errores_error: int, errores_concepto: int, errores_rojo: int) -> str:
    """Calcula el nivel de dificultad del alumno en un tema."""
    total = errores_vof + errores_error + errores_concepto + errores_rojo
    if total > 10 or errores_rojo >= 3:
        return "crítico"
    if total > 3 or errores_rojo >= 1:
        return "débil"
    return "normal"


def _recompute_weak_points_text(uid: str) -> None:
    """
    Recomputa weak_points_text en Perfil_usuario/{uid} leyendo la subcolección 'nivel_usuario'.
    Cada doc tiene contadores + listas de preguntas que generaron errores.
    """
    try:
        docs = db.collection("Perfil_usuario").document(uid).collection("nivel_usuario").stream()
        weak_lines = []
        for doc in docs:
            data = doc.to_dict()
            tema = data.get("tema", doc.id)
            errores_vof = data.get("vof_errores", 0)
            errores_error = data.get("error_errores", 0)
            errores_concepto = data.get("concepto_errores", 0)
            errores_rojo = data.get("errores_rojo", 0)
            total_errores = errores_vof + errores_error + errores_concepto + errores_rojo

            if total_errores == 0:
                continue

            nivel = data.get("nivel", "normal")
            partes = []

            if errores_vof > 0:
                ejs = data.get("vof_preguntas_error") or []
                ejemplo = f', ej: "{ejs[-1]}"' if ejs else ""
                partes.append(f"falla en V/F ({errores_vof} errores{ejemplo})")

            if errores_error > 0:
                ejs = data.get("error_preguntas_error") or []
                ejemplo = f', ej: "{ejs[-1]}"' if ejs else ""
                partes.append(f"dificultad identificando errores ({errores_error} errores{ejemplo})")

            if errores_concepto > 0:
                ejs = data.get("concepto_preguntas_error") or []
                ejemplo = f', ej: "{ejs[-1]}"' if ejs else ""
                partes.append(f"concepto débil ({errores_concepto} errores{ejemplo})")

            if errores_rojo > 0:
                ejs = data.get("rojo_preguntas") or []
                ejemplo = f', ej: "{ejs[-1]}"' if ejs else ""
                partes.append(f"errores graves en chat ({errores_rojo} veces{ejemplo})")

            weak_lines.append(f"[{tema}] ({nivel}) " + "; ".join(partes))

        weak_points_text = "\n".join(weak_lines) if weak_lines else ""
        db.collection("Perfil_usuario").document(uid).set({
            "weak_points_text": weak_points_text,
            "fecha_actualizacion": datetime.utcnow(),
        }, merge=True)
        logger.info(f"Analyst: weak_points_text recomputado uid={uid} ({len(weak_lines)} temas con errores)")
    except Exception as e:
        logger.warning(f"_recompute_weak_points_text falló uid={uid}: {e}")


def update_profile_from_exercises(
    uid: str,
    tema: str,
    results: dict,
    id_chat_nr: str | None = None,
    enunciado: str | None = None,
) -> None:
    """
    Actualiza nivel_usuario/{tema} con los resultados de los ejercicios del panel.
    results = {
        "concepto": {"answered": bool, "es_correcto": bool},
        "vof":      {"answered": bool, "es_correcto": bool},
        "error":    {"answered": bool, "es_correcto": bool},
    }
    Si enunciado se provee y el resultado es incorrecto, se guarda en la lista de preguntas de error.
    """
    try:
        ref = db.collection("Perfil_usuario").document(uid).collection("nivel_usuario").document(tema)
        updates = {"tema": tema, "ultima_actividad": datetime.utcnow()}
        chat_updates = {}

        if results.get("concepto", {}).get("answered"):
            if results["concepto"].get("es_correcto"):
                updates["concepto_aciertos"] = fs_module.Increment(1)
                chat_updates["aciertos_concepto"] = fs_module.Increment(1)
            else:
                updates["concepto_errores"] = fs_module.Increment(1)
                chat_updates["errores_concepto"] = fs_module.Increment(1)
                if enunciado:
                    updates["concepto_preguntas_error"] = fs_module.ArrayUnion([enunciado])

        if results.get("vof", {}).get("answered"):
            if results["vof"].get("es_correcto"):
                updates["vof_aciertos"] = fs_module.Increment(1)
                chat_updates["aciertos_vof"] = fs_module.Increment(1)
            else:
                updates["vof_errores"] = fs_module.Increment(1)
                chat_updates["errores_vof"] = fs_module.Increment(1)
                if enunciado:
                    updates["vof_preguntas_error"] = fs_module.ArrayUnion([enunciado])

        if results.get("error", {}).get("answered"):
            if results["error"].get("es_correcto"):
                updates["error_aciertos"] = fs_module.Increment(1)
                chat_updates["aciertos_error"] = fs_module.Increment(1)
            else:
                updates["error_errores"] = fs_module.Increment(1)
                chat_updates["errores_error"] = fs_module.Increment(1)
                if enunciado:
                    updates["error_preguntas_error"] = fs_module.ArrayUnion([enunciado])

        ref.set(updates, merge=True)

        # Recomputar nivel después de actualizar contadores
        snap = ref.get()
        d = snap.to_dict() or {}
        nivel = _compute_nivel(
            d.get("vof_errores", 0),
            d.get("error_errores", 0),
            d.get("concepto_errores", 0),
            d.get("errores_rojo", 0),
        )
        ref.update({"nivel": nivel})
        logger.info(f"Analyst: nivel_usuario actualizado → uid={uid}, tema={tema}, nivel={nivel}")

        if id_chat_nr and chat_updates:
            try:
                db.collection("Chat_nr").document(id_chat_nr).update(chat_updates)
                logger.info(f"Analyst: contadores Chat_nr actualizados → chat={id_chat_nr}")
            except Exception as ce:
                logger.warning(f"Analyst: actualizar contadores Chat_nr falló: {ce}")

        _recompute_weak_points_text(uid)
    except Exception as e:
        logger.warning(f"update_profile_from_exercises falló uid={uid}: {e}")


def update_profile_from_rojo(uid: str, tema: str, question: str) -> None:
    """Registra un error conceptual grave (nivel='rojo') detectado en el chat principal."""
    try:
        ref = db.collection("Perfil_usuario").document(uid).collection("nivel_usuario").document(tema)
        updates = {
            "tema": tema,
            "errores_rojo": fs_module.Increment(1),
            "ultima_actividad": datetime.utcnow(),
        }
        if question:
            updates["rojo_preguntas"] = fs_module.ArrayUnion([question])

        ref.set(updates, merge=True)

        # Recomputar nivel
        snap = ref.get()
        d = snap.to_dict() or {}
        nivel = _compute_nivel(
            d.get("vof_errores", 0),
            d.get("error_errores", 0),
            d.get("concepto_errores", 0),
            d.get("errores_rojo", 0),
        )
        ref.update({"nivel": nivel})
        logger.info(f"Analyst: error rojo registrado → uid={uid}, tema={tema}, nivel={nivel}")
        _recompute_weak_points_text(uid)
    except Exception as e:
        logger.warning(f"update_profile_from_rojo falló uid={uid}: {e}")


def get_latest_weak_points(uid: str) -> str:
    """Lee el campo weak_points_text pre-computado en Perfil_usuario/{uid}."""
    try:

        doc = db.collection("Perfil_usuario").document(uid).get()
        if doc.exists:
            return doc.to_dict().get("weak_points_text", "")
        return ""
    except Exception as e:
        logger.warning(f"get_latest_weak_points falló: {e}")
        return ""


# ── Cola circular de contexto (Contexto_chat) ────────────────────────────────
CONTEXT_QUEUE_MAX = 7


def get_context_queue(id_chat_nr: str) -> str:
    """
    Lee Contexto_chat/{id_chat_nr} y devuelve los intercambios formateados como string
    listo para inyectar en el prompt del responder.
    Incluye los ejercicios de pensamiento crítico de cada intercambio si están disponibles,
    para que el tutor pueda responder preguntas sobre ejercicios específicos.
    """
    try:
        doc = db.collection("Contexto_chat").document(id_chat_nr).get()
        if not doc.exists:
            return ""
        intercambios = (doc.to_dict() or {}).get("intercambios") or []
        if not intercambios:
            return ""
        lines = []
        for entry in intercambios:
            lines.append(f"Alumno: {entry.get('pregunta', '')}")
            lines.append(f"Tutor: {entry.get('respuesta', '')}")
            # Incluir ejercicios del reinforcement si existen en este intercambio
            ejercicios = entry.get("ejercicios") or []
            if ejercicios:
                lines.append("[Ejercicios de pensamiento crítico generados en este intercambio:]")
                for ej in ejercicios:
                    tipo = ej.get("tipo", "")
                    enunciado = ej.get("enunciado", "")
                    if tipo == "concepto":
                        lines.append(f"  - Concepto: {enunciado}")
                    elif tipo == "verdadero_falso":
                        correcta = "Verdadero" if ej.get("respuesta_correcta") else "Falso"
                        lines.append(f"  - Verdadero/Falso: {enunciado} (respuesta correcta: {correcta})")
                    elif tipo == "encuentra_el_error":
                        desarrollo = ej.get("desarrollo") or []
                        pasos = " | ".join(f"Paso {i+1}: {p}" for i, p in enumerate(desarrollo))
                        lines.append(f"  - Encuentra el Error: {enunciado} → {pasos} (error en paso {ej.get('paso_error')})")
            lines.append("")  # línea en blanco entre intercambios
        return "\n".join(lines).strip()
    except Exception as e:
        logger.warning(f"get_context_queue falló id_chat_nr={id_chat_nr}: {e}")
        return ""


def update_context_queue(id_chat_nr: str, question: str, answer: str) -> None:
    """
    Agrega un nuevo intercambio a Contexto_chat/{id_chat_nr}.
    Si ya hay CONTEXT_QUEUE_MAX entradas, elimina la más antigua (posición 0).
    Corre en background — no bloquea la respuesta al alumno.
    """
    try:
        ref = db.collection("Contexto_chat").document(id_chat_nr)
        doc = ref.get()
        intercambios: list = []
        if doc.exists:
            intercambios = list((doc.to_dict() or {}).get("intercambios") or [])

        intercambios.append({"pregunta": question, "respuesta": answer})

        # Mantener máximo CONTEXT_QUEUE_MAX entradas (cola circular)
        if len(intercambios) > CONTEXT_QUEUE_MAX:
            intercambios = intercambios[-CONTEXT_QUEUE_MAX:]

        ref.set({"intercambios": intercambios}, merge=True)
        logger.info(f"update_context_queue: chat={id_chat_nr} intercambios={len(intercambios)}")
    except Exception as e:
        logger.warning(f"update_context_queue falló id_chat_nr={id_chat_nr}: {e}")
