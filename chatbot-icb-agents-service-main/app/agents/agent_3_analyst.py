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

# ── Resumen de conversación (se mantiene igual) ───────────────────────────────
_summary_prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un asistente que mantiene un resumen acumulativo de una sesión de tutoría de Cálculo 1.
Se te dará el resumen actual y el último intercambio. Actualiza el resumen incorporando el nuevo intercambio.

REGLAS:
- Máximo 6 oraciones.
- Menciona los temas matemáticos tratados (derivadas, límites, integrales, etc.).
- Destaca si el alumno cometió errores conceptuales importantes.
- Escribe en español, en tercera persona ("El alumno preguntó...", "Se discutió...").
- Si el resumen actual está vacío, crea uno nuevo basado solo en el intercambio.
- NO incluyas la respuesta completa del tutor, solo el tema y punto clave."""),
    ("human", """Resumen actual:
{resumen_actual}

Último intercambio:
Alumno: {question}
Tutor: {answer}

Escribe el resumen actualizado:"""),
])

_summary_chain = _summary_prompt | llm | StrOutputParser()


def update_conversation_summary(id_chat_nr: str, resumen_actual: str, question: str, answer: str) -> None:
    """Genera resumen acumulativo y lo persiste en Chat_nr/{id_chat_nr}. Corre en background."""
    try:
        from app.core.firestore_client import db
        nuevo_resumen = _summary_chain.invoke({
            "resumen_actual": resumen_actual or "Sin resumen previo.",
            "question": question[:600],
            "answer": answer[:800],
        })
        db.collection("Chat_nr").document(id_chat_nr).update({
            "resumen_conversacion": nuevo_resumen,
            "fecha_resumen": datetime.utcnow(),
        })
        logger.info(f"Resumen actualizado para chat={id_chat_nr}")
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


def update_profile_from_exercises(uid: str, tema: str, results: dict) -> None:
    """
    Actualiza el perfil del usuario con los resultados de los ejercicios del panel.

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

        if results.get("concepto", {}).get("answered"):
            if results["concepto"].get("es_correcto"):
                updates["concepto_aciertos"] = fs_module.Increment(1)
            else:
                updates["concepto_errores"] = fs_module.Increment(1)

        if results.get("vof", {}).get("answered"):
            if results["vof"].get("es_correcto"):
                updates["vof_aciertos"] = fs_module.Increment(1)
            else:
                updates["vof_errores"] = fs_module.Increment(1)

        if results.get("error", {}).get("answered"):
            if results["error"].get("es_correcto"):
                updates["error_aciertos"] = fs_module.Increment(1)
            else:
                updates["error_errores"] = fs_module.Increment(1)

        ref.set(updates, merge=True)
        logger.info(f"Agent3: perfil ejercicios actualizado → uid={uid}, tema={tema}")

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
