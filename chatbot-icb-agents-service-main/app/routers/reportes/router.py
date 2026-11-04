"""
Reportes para profesores (solo los llama el backend NestJS, que ya validó que el
usuario es staff y decidió qué secciones puede ver).

  GET /reportes/nivelacion?secciones=A,B          → JSON para el panel
  GET /reportes/nivelacion/excel?secciones=A,B    → Excel descargable
  GET /reportes/nivelacion/alumno/{uid}           → ficha de un alumno
"""
import asyncio
import datetime
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.routers.ai.router import verify_internal
from app.routers.reportes import datos, excel, metricas

logger = logging.getLogger("icb.reportes")
router = APIRouter(prefix="/reportes", tags=["reportes"], dependencies=[Depends(verify_internal)])


def _secciones(raw: str | None) -> list[str] | None:
    lista = [s.strip() for s in (raw or "").split(",") if s.strip()]
    return lista or None


@router.get("/nivelacion")
async def nivelacion(secciones: str | None = Query(default=None)):
    return await asyncio.to_thread(metricas.generar, _secciones(secciones))


@router.get("/nivelacion/excel")
async def nivelacion_excel(secciones: str | None = Query(default=None)):
    secs = _secciones(secciones)
    reporte = await asyncio.to_thread(metricas.generar, secs)
    contenido = await asyncio.to_thread(excel.generar_excel, reporte)
    # Solo ASCII en el nombre: los encabezados HTTP no aceptan tildes
    sufijo = re.sub(r"[^A-Za-z0-9_-]", "", "_".join(secs)) if secs else "todas"
    nombre = f"reporte_nivelacion_{sufijo}_{datetime.datetime.now():%Y%m%d_%H%M}.xlsx"
    return Response(
        content=contenido,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


@router.get("/nivelacion/alumno/{uid}")
async def nivelacion_alumno(uid: str, secciones: str | None = Query(default=None)):
    # Si el backend limita secciones, la ficha también: el alumno debe estar en una de ellas.
    secs = _secciones(secciones)
    if secs:
        correo = await asyncio.to_thread(datos.correo_de_uid, uid)
        permitidos = {a["correo"] for a in await asyncio.to_thread(datos.alumnos, secs)}
        if not correo or correo not in permitidos:
            raise HTTPException(status_code=404, detail="Alumno no encontrado en tus secciones.")
    return await asyncio.to_thread(metricas.detalle, uid)
