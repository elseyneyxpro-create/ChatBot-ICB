import asyncio
import logging
import time
from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse
from app.agents.agent_0_classifier import classify_and_retrieve
from app.agents.agent_1_responder import respond
from app.agents.agent_2_reinforcer import reinforce, evaluate_concepto
from app.agents.agent_3_analyst import (
    get_latest_weak_points,
    update_conversation_summary,
    save_reinforcement_to_firestore,
    update_profile_from_rojo,
    update_profile_from_exercises,
)
from app.schemas.ask import Ask, EvaluateConcepto, SaveExerciseResult
from app.core.supabase_client import supabase

logger = logging.getLogger("icb.ai")
router = APIRouter(prefix="/ai", tags=["ai"])


def _run_reinforcement_background(
    question: str, answer: str, rag_context: str, tema: str,
    id_chat_nr: str, uid: str | None, videos: list = None,
) -> None:
    """Corre el reforzador en background y guarda el resultado en Firestore."""
    try:
        reinforcement = reinforce(
            question=question,
            answer=answer,
            rag_context=rag_context,
            tema=tema,
            videos=videos or [],
        )
        save_reinforcement_to_firestore(id_chat_nr, reinforcement, videos=videos)

        # Si el nivel es rojo, actualizar el perfil del usuario
        if reinforcement.get("nivel") == "rojo" and uid:
            update_profile_from_rojo(uid=uid, tema=tema, question=question)

    except Exception as e:
        logger.warning(f"Background reinforcement falló: {e}")


async def _get_weak_points_safe(uid: str) -> str:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(get_latest_weak_points, uid),
            timeout=2.0,
        )
    except Exception as e:
        logger.warning(f"get_latest_weak_points falló: {e}")
        return ""


def _get_memory_layers(id_chat_nr: str) -> dict:
    """Lee las capas de memoria del Chat_nr en Firestore. Tolera campo legacy resumen_conversacion."""
    try:
        from app.core.firestore_client import db
        snap = db.collection("Chat_nr").document(id_chat_nr).get()
        if not snap.exists:
            return {"resumen_rolling": "", "resumenes": [], "super_resumenes": []}
        d = snap.to_dict() or {}
        return {
            "resumen_rolling": d.get("resumen_rolling") or d.get("resumen_conversacion") or "",
            "resumenes": d.get("resumenes") or [],
            "super_resumenes": d.get("super_resumenes") or [],
        }
    except Exception as e:
        logger.warning(f"_get_memory_layers falló: {e}")
        return {"resumen_rolling": "", "resumenes": [], "super_resumenes": []}


@router.get("/videos")
async def get_videos():
    """Retorna todos los videos de la BD con su tema, y la lista de temas disponibles."""
    try:
        vt_result = supabase.table("videos_tema").select("id_tema, tema").execute()
        temas_data = vt_result.data or []
        vr_result = supabase.table("videos").select("url, id_tema, categoria").execute()
        videos_data = vr_result.data or []

        tema_map = {t["id_tema"]: t["tema"] for t in temas_data}
        all_temas = sorted(set(t["tema"] for t in temas_data))
        videos = [
            {"url": v["url"], "tema": tema_map.get(v["id_tema"], ""), "categoria": v.get("categoria") or ""}
            for v in videos_data
        ]
        return JSONResponse({"videos": videos, "temas": all_temas})
    except Exception as e:
        logger.warning(f"get_videos error: {e}")
        return JSONResponse({"videos": [], "temas": []})


@router.post("/answer")
async def ai_answer(payload: Ask, background_tasks: BackgroundTasks):
    user_text = (payload.question or "").strip()

    if not user_text:
        return JSONResponse({"ok": False, "error": "Pregunta vacía."})

    t_start = time.time()
    logger.info(f"REQUEST uid={payload.uid} pregunta='{user_text[:60]}'")

    # ── Fase 1: clasificador + puntos débiles + capas de memoria EN PARALELO ──
    t0 = time.time()
    classifier_task = asyncio.to_thread(classify_and_retrieve, user_text, payload.uid)
    weak_points_task = _get_weak_points_safe(payload.uid) if payload.uid else asyncio.sleep(0)
    memory_task = (
        asyncio.to_thread(_get_memory_layers, payload.id_chat_nr)
        if payload.id_chat_nr else asyncio.sleep(0)
    )

    results = await asyncio.gather(classifier_task, weak_points_task, memory_task, return_exceptions=True)

    rag_result = results[0]
    weak_points = results[1] if not isinstance(results[1], Exception) else ""
    if weak_points is None:
        weak_points = ""
    memory_layers = results[2] if isinstance(results[2], dict) else {
        "resumen_rolling": payload.resumen_conversacion or "",
        "resumenes": [],
        "super_resumenes": [],
    }

    if isinstance(rag_result, Exception):
        logger.exception("Error en classify_and_retrieve")
        return JSONResponse({"ok": False, "error": str(rag_result)})

    logger.info(
        f"Fase 1 (clasificador+puntos+memoria): {time.time()-t0:.2f}s | "
        f"tema={rag_result.get('tema')} | "
        f"capas=rolling:{len(memory_layers['resumen_rolling'])}c, "
        f"bloques:{len(memory_layers['resumenes'])}, super:{len(memory_layers['super_resumenes'])}"
    )

    # ── Fase 2: responder ─────────────────────────────────────────────────────
    t0 = time.time()
    try:
        answer = await asyncio.to_thread(
            respond,
            question=user_text,
            rag_context=rag_result["rag_context"],
            weak_points=weak_points,
            image_base64=payload.image_base64 or None,
            context=payload.context or "",
            resumen_rolling=memory_layers["resumen_rolling"],
            resumenes=memory_layers["resumenes"],
            super_resumenes=memory_layers["super_resumenes"],
            formato=rag_result.get("formato"),
        )
    except Exception as e:
        logger.exception("Error en responder")
        return JSONResponse({"ok": False, "error": str(e)})

    logger.info(f"Fase 2 (responder): {time.time()-t0:.2f}s | {len(answer)} chars")

    tema = rag_result.get("tema")
    is_math = bool(tema)
    total = time.time() - t_start
    logger.info(f"TOTAL (sin reinforcer): {total:.2f}s | tema={tema} | is_math={is_math}")

    # ── Background: reinforcer + resumen ──────────────────────────────────────
    if tema and payload.id_chat_nr:
        background_tasks.add_task(
            _run_reinforcement_background,
            question=user_text,
            answer=answer,
            rag_context=rag_result["rag_context"],
            tema=tema,
            id_chat_nr=payload.id_chat_nr,
            uid=payload.uid,
            videos=rag_result["videos"],
        )

    if payload.id_chat_nr:
        # total_hilos del payload representa el conteo ANTES de este intercambio.
        # +1 para reflejar el que estamos guardando ahora — así update_conversation_summary
        # detecta correctamente el cierre de bloques cada BLOCK_SIZE hilos.
        nuevo_total = (payload.total_hilos or 0) + 1
        background_tasks.add_task(
            update_conversation_summary,
            id_chat_nr=payload.id_chat_nr,
            resumen_actual=memory_layers["resumen_rolling"],
            question=user_text,
            answer=answer,
            total_hilos=nuevo_total,
        )

    return JSONResponse({
        "ok": True,
        "reply": answer,
        "videos": rag_result["videos"],
        "tema": tema,
        "latency_ms": int(total * 1000),
    })


@router.post("/evaluate-concepto")
async def evaluate_concepto_endpoint(payload: EvaluateConcepto, background_tasks: BackgroundTasks):
    """Evalúa la respuesta del alumno a la pregunta de concepto y actualiza el perfil."""
    if not payload.enunciado or not payload.respuesta_usuario:
        return JSONResponse({"ok": False, "error": "Enunciado o respuesta vacíos."})

    try:
        result = await asyncio.to_thread(
            evaluate_concepto,
            enunciado=payload.enunciado,
            respuesta_usuario=payload.respuesta_usuario,
            tema=payload.tema,
        )

        # El frontend ya llama a /save-exercise-result con tipo='concepto', que también
        # incrementa contadores en Chat_nr. Este endpoint solo evalúa — la persistencia
        # de contadores corre allá para tener una sola fuente de verdad.

        return JSONResponse({
            "ok": True,
            "es_correcto": result.get("es_correcto", False),
            "feedback": result.get("feedback", ""),
        })
    except Exception as e:
        logger.exception("evaluate-concepto falló")
        return JSONResponse({"ok": False, "error": str(e)})


@router.post("/save-exercise-result")
async def save_exercise_result(payload: SaveExerciseResult, background_tasks: BackgroundTasks):
    """Guarda el resultado de un ejercicio (concepto/VoF/error) en el perfil del usuario y en Chat_nr."""
    if payload.tipo not in ("vof", "error", "concepto"):
        return JSONResponse({"ok": False, "error": "tipo debe ser 'concepto', 'vof' o 'error'."})

    results = {
        "concepto": {"answered": payload.tipo == "concepto", "es_correcto": payload.es_correcto} if payload.tipo == "concepto" else {"answered": False},
        "vof": {"answered": payload.tipo == "vof", "es_correcto": payload.es_correcto} if payload.tipo == "vof" else {"answered": False},
        "error": {"answered": payload.tipo == "error", "es_correcto": payload.es_correcto} if payload.tipo == "error" else {"answered": False},
    }

    background_tasks.add_task(
        update_profile_from_exercises,
        uid=payload.uid,
        tema=payload.tema,
        results=results,
        id_chat_nr=payload.id_chat_nr,
    )

    return JSONResponse({"ok": True})
