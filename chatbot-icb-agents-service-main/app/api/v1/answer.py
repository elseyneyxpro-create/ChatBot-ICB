
import logging
import time
from fastapi import APIRouter
from app.core.chain import chain
from app.core.memory import MemoryStore
from app.core.config import settings
from app.schemas.ask import Ask
from langchain_core.messages import HumanMessage, AIMessage

from fastapi.responses import JSONResponse

logger = logging.getLogger("icb.ai")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

router = APIRouter(prefix="/ai", tags=["ai"])
mem = MemoryStore(
    max_turns=settings.MEM_MAX_TURNS,
    ttl_seconds=settings.MEM_TTL_SECONDS,
)

def _to_lc_history(mem_msgs):
    lc = []
    for m in mem_msgs:
        if m["role"] == "user":
            lc.append(HumanMessage(content=m["content"]))
        else:
            lc.append(AIMessage(content=m["content"]))
    return lc

@router.post("/answer")
async def ai_answer(payload: Ask):
    sid = payload.session_id or "anon"
    user_text = (payload.question or "").strip()
    subject = (payload.subject or "").strip()

    logger.info(f"👉 Nueva petición /ai/answer sid={sid} subject={subject} question='{user_text}'")

    if not user_text:
        logger.warning("⚠️ Pregunta vacía sid=%s", sid)
        return JSONResponse({"ok": False, "error": "Pregunta vacía."})

    lc_history = _to_lc_history(mem.get(sid))
    prefix = f"Materia: {subject}. " if subject else ""
    question = f"{prefix}{user_text}"
    logger.info("📜 Historial turns=%d, pregunta final='%s'", len(lc_history), question)

    t0 = time.time()
    try:
        logger.info("⏳ Invocando chain.invoke()...")
        answer_text = chain.invoke({"history": lc_history, "question": question})
        logger.info("✅ chain.invoke() completado en %.2fs", time.time() - t0)
        answer_text = (answer_text or "").strip()
        logger.info("Respuesta Modelo: %s", answer_text)
    except Exception as e:
        logger.exception("💥 Error en chain.invoke() sid=%s", sid)
        return JSONResponse({"ok": False, "error": str(e)})

    if not answer_text:
        logger.error("⚠️ Modelo devolvió texto vacío sid=%s", sid)
        return JSONResponse({"ok": False, "error": "El modelo no devolvió contenido."})
    
    logger.info("ANTES DEL APPEND")

    mem.append(sid, "user", user_text)
    logger.info("PASAMOS APPENT USER_TEXT")
    mem.append(sid, "assistant", answer_text)
    
    logger.info("DESPUES DEL APPEND, ANTES DEL LATENCY")

    latency = int((time.time() - t0) * 1000)
    logger.info("🎉 Respuesta OK sid=%s chars=%d latency_ms=%d",
                sid, len(answer_text), latency)
    
    logger.info("Latencyyy %s", latency)

    return JSONResponse({
        "ok": True,
        "reply": answer_text,
        "latency_ms": latency,
        "provider": settings.LLM_PROVIDER,
        "model": settings.OPENAI_MODEL if settings.LLM_PROVIDER=="openai" else settings.VERTEX_MODEL,
    })