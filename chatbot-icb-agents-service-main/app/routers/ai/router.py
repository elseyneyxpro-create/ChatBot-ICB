"""
Endpoints del módulo AI. Capa thin: recibe HTTP, delega al service, devuelve respuesta.
"""
import logging
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from fastapi.responses import JSONResponse

from app.routers.ai.models import Ask, EvaluateConcepto, EvaluateVof, EvaluateError, SaveExerciseResult
from app.routers.ai import service
from app.routers.ai.agents.analyst import update_conversation_summary, update_context_queue
from app.core.config import settings

logger = logging.getLogger("icb.ai")

router = APIRouter(prefix="/ai", tags=["ai"])


def verify_internal(x_internal_secret: str = Header(default="")):
    if settings.INTERNAL_SECRET and x_internal_secret != settings.INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Acceso no autorizado.")


@router.get("/videos", dependencies=[Depends(verify_internal)])
async def get_videos():
    """Retorna todos los videos de la BD con su tema y categoría, más la lista de temas."""
    try:
        return JSONResponse(service.get_all_videos())
    except Exception as e:
        logger.warning(f"get_videos error: {e}")
        return JSONResponse({"videos": [], "temas": []})


@router.post("/answer", dependencies=[Depends(verify_internal)])
async def ai_answer(payload: Ask, background_tasks: BackgroundTasks):
    """
    Flujo principal:
      - Fase 1 (paralelo): clasificador + puntos débiles + capas de memoria
      - Fase 2: responder
      - Background: reinforcer + resumen de conversación
    """
    user_text = (payload.question or "").strip()
    if not user_text and not payload.image_base64:
        return JSONResponse({"ok": False, "error": "Pregunta vacía."})

    try:
        result = await service.process_answer(payload)
    except Exception as e:
        logger.exception("Error en process_answer")
        return JSONResponse({"ok": False, "error": str(e)})

    answer      = result["answer"]
    rag_result  = result["rag_result"]
    memory_layers = result["memory_layers"]
    tema        = result["tema"]

    # Background: reinforcer
    if tema and payload.id_chat_nr:
        background_tasks.add_task(
            service.run_reinforcement_background,
            question=user_text,
            answer=answer,
            rag_context=rag_result["rag_context"],
            tema=tema,
            id_chat_nr=payload.id_chat_nr,
            uid=payload.uid,
            videos=rag_result["videos"],
        )

    # Background: resumen de conversación
    if payload.id_chat_nr:
        nuevo_total = (payload.total_hilos or 0) + 1
        background_tasks.add_task(
            update_conversation_summary,
            id_chat_nr=payload.id_chat_nr,
            question=user_text,
            answer=answer,
            total_hilos=nuevo_total,
        )

    # Background: cola circular de contexto
    if payload.id_chat_nr:
        background_tasks.add_task(
            update_context_queue,
            id_chat_nr=payload.id_chat_nr,
            question=result["user_text"],
            answer=answer,
        )

    return JSONResponse({
        "ok": True,
        "reply": answer,
        "videos": rag_result["videos"],
        "tema": tema,
        "latency_ms": result["latency_ms"],
    })


@router.post("/evaluate-concepto", dependencies=[Depends(verify_internal)])
async def evaluate_concepto_endpoint(payload: EvaluateConcepto):
    """Evalúa la respuesta del alumno a la pregunta de concepto."""
    if not payload.enunciado or not payload.respuesta_usuario:
        return JSONResponse({"ok": False, "error": "Enunciado o respuesta vacíos."})

    try:
        result = await service.process_evaluate_concepto(payload)
        return JSONResponse({
            "ok": True,
            "es_correcto": result.get("es_correcto", False),
            "feedback": result.get("feedback", ""),
        })
    except Exception as e:
        logger.exception("evaluate-concepto falló")
        return JSONResponse({"ok": False, "error": str(e)})


@router.post("/evaluate-vof", dependencies=[Depends(verify_internal)])
async def evaluate_vof_endpoint(payload: EvaluateVof):
    """Evalúa la respuesta del alumno a un ejercicio Verdadero/Falso."""
    if not payload.enunciado:
        return JSONResponse({"ok": False, "error": "Enunciado vacío."})

    try:
        result = await service.process_evaluate_vof(payload)
        return JSONResponse({
            "ok": True,
            "es_correcto": result.get("es_correcto", False),
            "feedback": result.get("feedback", ""),
        })
    except Exception as e:
        logger.exception("evaluate-vof falló")
        return JSONResponse({"ok": False, "error": str(e)})


@router.post("/evaluate-error", dependencies=[Depends(verify_internal)])
async def evaluate_error_endpoint(payload: EvaluateError):
    """Evalúa la respuesta del alumno a un ejercicio Encuentra el Error."""
    if not payload.enunciado or not payload.desarrollo:
        return JSONResponse({"ok": False, "error": "Enunciado o desarrollo vacíos."})

    try:
        result = await service.process_evaluate_error(payload)
        return JSONResponse({
            "ok": True,
            "es_correcto": result.get("es_correcto", False),
            "feedback": result.get("feedback", ""),
        })
    except Exception as e:
        logger.exception("evaluate-error falló")
        return JSONResponse({"ok": False, "error": str(e)})


@router.post("/save-exercise-result", dependencies=[Depends(verify_internal)])
async def save_exercise_result(payload: SaveExerciseResult, background_tasks: BackgroundTasks):
    """Guarda el resultado de un ejercicio (concepto/VoF/error) en el perfil y en Chat_nr."""
    if payload.tipo not in ("vof", "error", "concepto"):
        return JSONResponse({"ok": False, "error": "tipo debe ser 'concepto', 'vof' o 'error'."})

    from app.routers.ai.agents.analyst import update_profile_from_exercises
    results = service.build_exercise_results(payload)
    background_tasks.add_task(
        update_profile_from_exercises,
        uid=payload.uid,
        tema=payload.tema,
        results=results,
        id_chat_nr=payload.id_chat_nr,
        enunciado=payload.enunciado,
    )
    return JSONResponse({"ok": True})
