"""Endpoints internos de la nivelación (solo los llama el backend NestJS)."""
import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.routers.ai.router import verify_internal
from app.routers.nivelacion import service

logger = logging.getLogger("icb.niv")
router = APIRouter(prefix="/niv", tags=["nivelacion"], dependencies=[Depends(verify_internal)])


class Ejemplo(BaseModel):
    enunciado: str
    alternativas: list[str] = []
    correcta: str = ""


class GenerarIn(BaseModel):
    mundo: str
    nodo: str
    nivel: str
    ejemplos: list[Ejemplo] = Field(default_factory=list)


class AnalizarIn(BaseModel):
    uid: str


@router.post("/generar")
async def generar(payload: GenerarIn):
    try:
        pregunta = await asyncio.to_thread(
            service.generar_pregunta,
            payload.mundo, payload.nodo, payload.nivel, [e.model_dump() for e in payload.ejemplos],
        )
        return JSONResponse({"ok": True, "pregunta": pregunta})
    except Exception as e:
        logger.exception("generar falló")
        return JSONResponse({"ok": False, "error": str(e)})


@router.post("/analizar")
async def analizar(payload: AnalizarIn, background_tasks: BackgroundTasks):
    """Responde altiro y analiza en segundo plano (el alumno no espera al agente)."""
    background_tasks.add_task(service.analizar_en_background, payload.uid)
    return JSONResponse({"ok": True})
