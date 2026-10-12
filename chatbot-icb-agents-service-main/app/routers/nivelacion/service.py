"""
Agentes de la nivelación:
  - generador: crea preguntas nuevas para el modo Entrenar (no se guardan en el banco).
  - analista:  revisa los intentos del alumno, guarda un análisis y ajusta su nivel.
"""
import json
import logging
import random

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.core.postgres import execute, fetch_all
from app.routers.nivelacion.prompts import (
    ANALISTA_HUMAN, ANALISTA_SYSTEM, GENERADOR_HUMAN, GENERADOR_SYSTEM,
)

logger = logging.getLogger("icb.niv")

NIVELES = ("Principiante", "Intermedio", "Avanzado")
MAX_INTENTOS_ANALISIS = 60


def _llm(temperature: float) -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.OPENAI_MODEL,
        api_key=settings.OPENAI_API_KEY,
        temperature=temperature,
        model_kwargs={"response_format": {"type": "json_object"}},
        request_timeout=60,
    )


def _invocar_json(system: str, human: str, temperature: float) -> dict:
    raw = _llm(temperature).invoke([SystemMessage(content=system), HumanMessage(content=human)]).content
    return json.loads(raw)


# ── Generador ────────────────────────────────────────────────────────────────

def _validar_pregunta(p: dict) -> dict:
    enunciado = str(p.get("enunciado") or "").strip()
    alternativas = [str(a).strip() for a in (p.get("alternativas") or []) if str(a).strip()]
    correcta = str(p.get("correcta") or "").strip()
    if not enunciado or len(alternativas) < 2 or len(set(alternativas)) != len(alternativas):
        raise ValueError("pregunta incompleta o con alternativas repetidas")
    if correcta not in alternativas:
        raise ValueError("la correcta no está entre las alternativas")
    random.shuffle(alternativas)
    return {
        "enunciado": enunciado,
        "alternativas": alternativas,
        "correcta": correcta,
        "explicacion": str(p.get("explicacion") or "").strip(),
    }


def generar_pregunta(mundo: str, nodo: str, nivel: str, ejemplos: list[dict]) -> dict:
    ejemplos_txt = "\n".join(
        f"- {e.get('enunciado')} | alternativas: {e.get('alternativas')} | correcta: {e.get('correcta')}"
        for e in ejemplos
    ) or "(no hay ejemplos cargados; usa tu criterio para el nivel indicado)"
    human = GENERADOR_HUMAN.format(mundo=mundo, nodo=nodo, nivel=nivel, ejemplos=ejemplos_txt)

    ultimo_error = None
    for intento in range(3):  # el LLM a veces devuelve algo inválido: se reintenta
        try:
            pregunta = _validar_pregunta(_invocar_json(GENERADOR_SYSTEM, human, temperature=0.8))
            logger.info(f"[NIV] pregunta generada nodo='{nodo}' nivel={nivel}: {pregunta['enunciado'][:80]!r}")
            return pregunta
        except Exception as e:
            ultimo_error = e
            logger.warning(f"[NIV] generación inválida (intento {intento + 1}): {e}")
    raise RuntimeError(f"No se pudo generar una pregunta válida: {ultimo_error}")


# ── Analista ────────────────────────────────────────────────────────────────

def analizar_estudiante(uid: str) -> dict | None:
    est = fetch_all("SELECT nivel FROM niv_progreso.estudiante WHERE uid = %s", (uid,))
    if not est:
        return None
    nivel_actual = est[0]["nivel"] or "Principiante"

    intentos = fetch_all(
        """SELECT i.contexto, i.origen, i.dificultad, i.enunciado, i.respuesta, i.correcta, i.es_correcto,
                  n.titulo AS nodo, m.titulo AS mundo
             FROM niv_progreso.intento i
             LEFT JOIN niv_banco.nodo n ON n.id = i.nodo_id
             LEFT JOIN niv_banco.mundo m ON m.id = i.mundo_id
            WHERE i.uid = %s
            ORDER BY i.created_at DESC
            LIMIT %s""",
        (uid, MAX_INTENTOS_ANALISIS),
    )
    if not intentos:
        return None

    aciertos = sum(1 for i in intentos if i["es_correcto"])
    pct = round(100 * aciertos / len(intentos))
    intentos_txt = "\n".join(
        f"- [{i['mundo'] or '?'} / {i['nodo'] or 'test del mundo'} | {i['dificultad']} | {i['contexto']}] "
        f"{i['enunciado']} → respondió {i['respuesta']!r}, correcta {i['correcta']!r}: "
        f"{'ACIERTO' if i['es_correcto'] else 'ERROR'}"
        for i in intentos
    )
    r = _invocar_json(
        ANALISTA_SYSTEM,
        ANALISTA_HUMAN.format(nivel=nivel_actual, n=len(intentos), pct=pct, intentos=intentos_txt),
        temperature=0.2,
    )

    nivel_sugerido = r.get("nivel_sugerido") if r.get("nivel_sugerido") in NIVELES else nivel_actual
    fortalezas = [str(x) for x in (r.get("fortalezas") or [])][:6]
    debilidades = [str(x) for x in (r.get("debilidades") or [])][:6]

    execute(
        """INSERT INTO niv_progreso.analisis
             (uid, nivel_sugerido, fortalezas, debilidades, recomendacion, resumen, n_intentos)
           VALUES (%s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)""",
        (uid, nivel_sugerido, json.dumps(fortalezas, ensure_ascii=False), json.dumps(debilidades, ensure_ascii=False),
         str(r.get("recomendacion") or ""), str(r.get("resumen") or ""), len(intentos)),
    )
    if nivel_sugerido != nivel_actual:
        execute("UPDATE niv_progreso.estudiante SET nivel = %s, updated_at = now() WHERE uid = %s", (nivel_sugerido, uid))
        logger.info(f"[NIV] nivel de {uid}: {nivel_actual} → {nivel_sugerido}")
    logger.info(f"[NIV] análisis guardado uid={uid} ({len(intentos)} intentos, {pct}% acierto)")
    return {"nivel_sugerido": nivel_sugerido, "fortalezas": fortalezas, "debilidades": debilidades}


def analizar_en_background(uid: str) -> None:
    try:
        analizar_estudiante(uid)
    except Exception as e:
        logger.warning(f"[NIV] análisis falló uid={uid}: {e}")
