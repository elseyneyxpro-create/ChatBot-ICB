"""
Orquestación del flujo de IA: junta los 4 agentes, maneja el background y la memoria.
El router delega aquí — este módulo no sabe nada de HTTP.
"""
import asyncio
import logging
import time

from app.routers.ai.agents.classifier import classify_and_retrieve
from app.routers.ai.agents.responder import respond
from app.routers.ai.agents.reinforcer import reinforce, evaluate_concepto, evaluate_vof, evaluate_error
from app.routers.ai.agents.analyst import (
    get_latest_weak_points,
    update_conversation_summary,
    save_reinforcement_to_firestore,
    update_profile_from_rojo,
    update_profile_from_exercises,
    get_context_queue,
    update_context_queue,
)
from app.routers.ai.models import Ask, EvaluateConcepto, EvaluateVof, EvaluateError, SaveExerciseResult
from app.core.supabase_client import supabase
from app.core.firestore_client import db

logger = logging.getLogger("icb.ai")


# ── Helpers de background ─────────────────────────────────────────────────────

def run_reinforcement_background(
    question: str,
    answer: str,
    rag_context: str,
    tema: str,
    id_chat_nr: str,
    uid: str | None,
    videos: list = None,
) -> None:
    """Corre el reforzador en background y guarda el resultado en Firestore."""
    import time as _time
    t0 = _time.time()
    logger.info(f"[BG] Reinforcement START → chat={id_chat_nr} tema='{tema}' videos={len(videos or [])}")
    try:
        reinforcement = reinforce(
            question=question,
            answer=answer,
            rag_context=rag_context,
            tema=tema,
            videos=videos or [],
        )
        save_reinforcement_to_firestore(id_chat_nr, reinforcement, videos=videos)
        logger.info(f"[BG] Reinforcement DONE → chat={id_chat_nr} ({_time.time()-t0:.2f}s)")

        if reinforcement.get("nivel") == "rojo" and uid:
            logger.info(f"[BG] Nivel ROJO → actualizando perfil uid={uid} tema='{tema}'")
            update_profile_from_rojo(uid=uid, tema=tema, question=question)

    except Exception as e:
        logger.error(f"[BG] Reinforcement FALLÓ chat={id_chat_nr}: {e}", exc_info=True)


async def _extract_math_from_image(image_base64: str) -> str:
    """
    Extrae en texto plano la expresión o problema matemático de una imagen.
    Se usa solo cuando el usuario envía imagen sin texto, para alimentar al clasificador.
    Llamada rápida con gpt-4o-mini, detail=low, max_tokens=80.
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage
    from app.core.config import settings

    llm = ChatOpenAI(
        model="gpt-4o-mini",
        api_key=settings.OPENAI_API_KEY,
        max_tokens=80,
        request_timeout=10,
    )
    content = [
        {
            "type": "text",
            "text": (
                "Describe en una frase corta qué problema o expresión matemática aparece en esta imagen. "
                "Usa texto plano, sin LaTeX ni símbolos especiales. "
                "Ejemplo: 'inecuación lineal 2x+3>7' o 'derivada de x^2+1'. "
                "Si no hay matemáticas, responde 'sin contenido matemático'."
            ),
        },
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}", "detail": "low"},
        },
    ]
    try:
        def _call():
            return llm.invoke([HumanMessage(content=content)]).content
        result = await asyncio.wait_for(asyncio.to_thread(_call), timeout=12.0)
        extracted = result.strip()
        logger.info(f"Imagen→texto para clasificador: {extracted!r}")
        return extracted
    except Exception as e:
        logger.warning(f"_extract_math_from_image falló: {e}")
        return ""


async def _get_weak_points_safe(uid: str) -> str:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(get_latest_weak_points, uid),
            timeout=2.0,
        )
    except Exception as e:
        logger.warning(f"get_latest_weak_points falló: {e}")
        return ""


def get_memory_layers(id_chat_nr: str) -> dict:
    """
    Lee las capas de memoria del Chat_nr en Firestore.
    resumen_rolling es ahora una lista de dicts {"pregunta", "respuesta", "exercise_results"}.
    Tolera chats legacy donde resumen_rolling era un string (se ignora, empieza fresco).
    """
    try:
        snap = db.collection("Chat_nr").document(id_chat_nr).get()
        if not snap.exists:
            return {"resumen_rolling": [], "resumenes": [], "super_resumenes": []}
        d = snap.to_dict() or {}
        raw_rolling = d.get("resumen_rolling")
        if isinstance(raw_rolling, list):
            resumen_rolling = raw_rolling
        else:
            # Legacy: era string → ignorar, empezar lista vacía
            resumen_rolling = []
        return {
            "resumen_rolling": resumen_rolling,
            "resumenes": d.get("resumenes") or [],
            "super_resumenes": d.get("super_resumenes") or [],
        }
    except Exception as e:
        logger.warning(f"get_memory_layers falló: {e}")
        return {"resumen_rolling": [], "resumenes": [], "super_resumenes": []}


# ── Lógica principal de /ai/answer ───────────────────────────────────────────

async def process_answer(payload: Ask) -> dict:
    """
    Ejecuta el flujo principal:
      Fase 1 (paralelo): clasificador + puntos débiles + capas de memoria
      Fase 2:            responder
    Retorna el dict listo para JSONResponse. Las tareas de background las maneja el router.
    """
    user_text = (payload.question or "").strip()
    t_start = time.time()
    logger.info(
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"  REQUEST NUEVO\n"
        f"  uid      = {payload.uid}\n"
        f"  chat_nr  = {payload.id_chat_nr}\n"
        f"  pregunta = {user_text!r}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    )

    # Paso previo: fetchear contexto reciente para enriquecer el clasificador
    t0 = time.time()
    context = ""
    if payload.id_chat_nr:
        try:
            context = await asyncio.wait_for(
                asyncio.to_thread(get_context_queue, payload.id_chat_nr),
                timeout=2.0,
            )
        except Exception as e:
            logger.warning(f"context_queue fetch previo falló: {e}")

    # Si hay imagen sin texto, extraer la expresión matemática para alimentar el clasificador
    classifier_text = user_text
    if not user_text and payload.image_base64:
        classifier_text = await _extract_math_from_image(payload.image_base64)

    # Fase 1: en paralelo
    # NOTA: al clasificador le pasamos SOLO el nombre del último tema (no el contexto completo),
    # para evitar que sesgue la clasificación cuando el alumno cambia de tema.
    classifier_task = asyncio.to_thread(classify_and_retrieve, classifier_text, payload.uid, payload.last_tema or "")
    weak_points_task = _get_weak_points_safe(payload.uid) if payload.uid else asyncio.sleep(0)
    memory_task = (
        asyncio.to_thread(get_memory_layers, payload.id_chat_nr)
        if payload.id_chat_nr else asyncio.sleep(0)
    )

    results = await asyncio.gather(classifier_task, weak_points_task, memory_task, return_exceptions=True)

    rag_result = results[0]
    weak_points = results[1] if not isinstance(results[1], Exception) else ""
    if weak_points is None:
        weak_points = ""
    memory_layers = results[2] if isinstance(results[2], dict) else {
        "resumen_rolling": [],
        "resumenes": [],
        "super_resumenes": [],
    }

    if isinstance(rag_result, Exception):
        logger.exception("Error en classify_and_retrieve")
        raise rag_result

    logger.info(
        f"Fase 1 (clasificador+puntos+memoria): {time.time()-t0:.2f}s | "
        f"tema={rag_result.get('tema')} | "
        f"capas=rolling:{len(memory_layers['resumen_rolling'])} entradas, "
        f"bloques:{len(memory_layers['resumenes'])}, super:{len(memory_layers['super_resumenes'])} | "
        f"contexto_previo={len(context)}c"
    )

    # Fase 2: responder
    t0 = time.time()
    answer = await asyncio.to_thread(
        respond,
        question=user_text,
        rag_context=rag_result["rag_context"],
        weak_points=weak_points,
        image_base64=payload.image_base64 or None,
        context=context,
        resumen_rolling=memory_layers["resumen_rolling"],
        resumenes=memory_layers["resumenes"],
        super_resumenes=memory_layers["super_resumenes"],
        formato=rag_result.get("formato"),
    )
    logger.info(f"Fase 2 (responder): {time.time()-t0:.2f}s | {len(answer)} chars")

    tema = rag_result.get("tema")
    total = time.time() - t_start
    logger.info(f"TOTAL (sin reinforcer): {total:.2f}s | tema={tema}")

    return {
        "answer": answer,
        "rag_result": rag_result,
        "memory_layers": memory_layers,
        "tema": tema,
        "latency_ms": int(total * 1000),
        "user_text": user_text,
    }


# ── Lógica de /ai/videos ──────────────────────────────────────────────────────

def get_all_videos() -> dict:
    temas_result = supabase.table("tema").select("id_tema, tema").execute()
    temas_data = temas_result.data or []
    vr_result = supabase.table("videos").select("url, id_tema, categoria").execute()
    videos_data = vr_result.data or []

    tema_map = {t["id_tema"]: t["tema"] for t in temas_data}
    all_temas = sorted(set(t["tema"] for t in temas_data))
    videos = [
        {"url": v["url"], "tema": tema_map.get(v["id_tema"], ""), "categoria": v.get("categoria") or ""}
        for v in videos_data
    ]
    logger.info(f"get_all_videos: {len(videos)} videos, {len(all_temas)} temas")
    return {"videos": videos, "temas": all_temas}


# ── Lógica de /ai/evaluate-concepto ──────────────────────────────────────────

async def process_evaluate_concepto(payload: EvaluateConcepto) -> dict:
    return await asyncio.to_thread(
        evaluate_concepto,
        enunciado=payload.enunciado,
        respuesta_usuario=payload.respuesta_usuario,
        tema=payload.tema,
    )


# ── Lógica de /ai/evaluate-vof ───────────────────────────────────────────────

async def process_evaluate_vof(payload: EvaluateVof) -> dict:
    return await asyncio.to_thread(
        evaluate_vof,
        enunciado=payload.enunciado,
        respuesta_usuario=payload.respuesta_usuario,
        respuesta_correcta=payload.respuesta_correcta,
        tema=payload.tema,
    )


# ── Lógica de /ai/evaluate-error ─────────────────────────────────────────────

async def process_evaluate_error(payload: EvaluateError) -> dict:
    return await asyncio.to_thread(
        evaluate_error,
        enunciado=payload.enunciado,
        desarrollo=payload.desarrollo,
        paso_error=payload.paso_error,
        respuesta_usuario=payload.respuesta_usuario,
        tema=payload.tema,
    )


# ── Lógica de /ai/save-exercise-result ───────────────────────────────────────

def build_exercise_results(payload: SaveExerciseResult) -> dict:
    """Convierte el payload single-ejercicio al formato que espera update_profile_from_exercises."""
    tipos = ("concepto", "vof", "error")
    return {
        t: ({"answered": True, "es_correcto": payload.es_correcto} if t == payload.tipo else {"answered": False})
        for t in tipos
    }
