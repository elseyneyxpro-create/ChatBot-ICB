import asyncio
import logging
import time
from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse
from app.agents.graph import agent_graph
from app.agents.agent_3_analyst import get_latest_weak_points, generate_snapshots
from app.schemas.ask import Ask

logger = logging.getLogger("icb.ai")
router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/answer")
async def ai_answer(payload: Ask, background_tasks: BackgroundTasks):
    user_text = (payload.question or "").strip()

    if not user_text:
        return JSONResponse({"ok": False, "error": "Pregunta vacía."})

    # Agente 3 (lectura rápida): obtener puntos débiles del último snapshot
    weak_points = ""
    if payload.uid:
        try:
            weak_points = await asyncio.to_thread(get_latest_weak_points, payload.uid)
        except Exception as e:
            logger.warning(f"get_latest_weak_points falló: {e}")

    t0 = time.time()
    try:
        state_input = {
            "question": user_text,
            "uid": payload.uid or None,
            "weak_points": weak_points,
            "rag_context": "",
            "videos": [],
            "tema": None,
            "image_base64": payload.image_base64 or None,
            "answer": "",
            "reinforcement": {},
        }
        # Correr el grafo sincrónico en un thread para no bloquear el event loop
        result = await asyncio.to_thread(agent_graph.invoke, state_input)
    except Exception as e:
        logger.exception("Error en agent_graph.invoke()")
        return JSONResponse({"ok": False, "error": str(e)})

    latency = int((time.time() - t0) * 1000)

    # Agente 3 (escritura en background): cada 5 hilos incremental, cada 25 re-lectura completa
    new_total = (payload.total_hilos or 0) + 1
    if payload.uid and payload.id_chat_nr:
        if new_total % 25 == 0:
            background_tasks.add_task(
                generate_snapshots,
                uid=payload.uid,
                id_chat_nr=payload.id_chat_nr,
                full_reread=True,
            )
            logger.info(f"Agent3 re-lectura COMPLETA encolada → uid={payload.uid}, hilo #{new_total}")
        elif new_total % 5 == 0:
            background_tasks.add_task(
                generate_snapshots,
                uid=payload.uid,
                id_chat_nr=payload.id_chat_nr,
                full_reread=False,
            )
            logger.info(f"Agent3 análisis INCREMENTAL encolado → uid={payload.uid}, hilo #{new_total}")

    return JSONResponse({
        "ok": True,
        "reply": result["answer"],
        "reinforcement": result["reinforcement"],
        "videos": result["videos"],
        "tema": result["tema"],
        "latency_ms": latency,
    })
