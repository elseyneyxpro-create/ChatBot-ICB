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
    guia: str = ""


class AnalizarIn(BaseModel):
    uid: str


@router.post("/generar")
async def generar(payload: GenerarIn):
    try:
        pregunta = await asyncio.to_thread(
            service.generar_pregunta,
            payload.mundo, payload.nodo, payload.nivel, [e.model_dump() for e in payload.ejemplos], payload.guia,
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


class Mensaje(BaseModel):
    rol: str          # alumno | tutor | evento
    texto: str = ""
    # Mensajes del tutor: alternativas que dio y cuál esperaba (el alumno no la ve)
    opciones: list[str] = Field(default_factory=list)
    esperada: int | None = None
    # Mensajes del alumno: botón de ayuda ("no_entiendo" | "pista") o si eligió la alternativa esperada
    ayuda: str | None = None
    eleccion_esperada: bool | None = None


class AccionAlumno(BaseModel):
    """Lo que hizo el alumno en este turno (no escribe: elige una alternativa o toca un botón)."""
    texto: str = ""
    ayuda: str | None = None
    eleccion_esperada: bool | None = None
    evento: bool = False   # aviso de la plataforma (p. ej. respondió el ejercicio del tutor)


class TutorIn(BaseModel):
    contexto: dict = Field(default_factory=dict)
    historial: list[Mensaje] = Field(default_factory=list)
    mensaje: AccionAlumno | None = None


@router.post("/tutor")
async def tutor(payload: TutorIn):
    """Siguiente turno del tutor socrático: {mensaje, opciones, esperada}."""
    try:
        turno = await asyncio.to_thread(
            service.tutor_responder, payload.contexto, [m.model_dump() for m in payload.historial],
            payload.mensaje.model_dump() if payload.mensaje else None,
        )
        return JSONResponse({"ok": True, "respuesta": turno["mensaje"], "opciones": turno["opciones"],
                             "esperada": turno["esperada"]})
    except Exception as e:
        logger.exception("tutor falló")
        return JSONResponse({"ok": False, "error": str(e)})


class ResolverIn(BaseModel):
    enunciado: str = Field(min_length=1, max_length=4000)
    contexto: dict = Field(default_factory=dict)


@router.post("/resolver")
async def resolver(payload: ResolverIn):
    """Resolución privada de un ejercicio que trae el alumno (la usa el tutor; el alumno no la ve)."""
    try:
        r = await asyncio.to_thread(service.resolver_ejercicio, payload.enunciado, payload.contexto)
        return JSONResponse({"ok": True, "resolucion": r})
    except Exception as e:
        logger.exception("resolver falló")
        return JSONResponse({"ok": False, "error": str(e)})


class RetroIn(BaseModel):
    contexto: dict = Field(default_factory=dict)
    preguntas: list[dict] = Field(default_factory=list)


@router.post("/retroalimentar")
async def retroalimentar(payload: RetroIn):
    try:
        r = await asyncio.to_thread(service.retroalimentar, payload.contexto, payload.preguntas)
        return JSONResponse({"ok": True, **r})
    except Exception as e:
        logger.exception("retroalimentación falló")
        return JSONResponse({"ok": False, "error": str(e)})
