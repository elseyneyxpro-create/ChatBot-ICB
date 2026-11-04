"""
Agentes de la nivelación:
  - generador:         crea preguntas nuevas (ejercicios del tutor; no se guardan en el banco).
  - analista:          revisa los intentos del alumno, guarda un análisis y ajusta su nivel.
  - tutor:             "Aprende con el tutor", conversación socrática con contexto del nodo.
  - retroalimentación: comentario por pregunta al terminar una fase o un test.
"""
import json
import logging
import random

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.core.postgres import execute, fetch_all
from app.routers.nivelacion.prompts import (
    ANALISTA_HUMAN, ANALISTA_SYSTEM, GENERADOR_HUMAN, GENERADOR_SYSTEM,
    RETRO_HUMAN, RETRO_SYSTEM, TUTOR_INICIO, TUTOR_SYSTEM,
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


def generar_pregunta(mundo: str, nodo: str, nivel: str, ejemplos: list[dict], guia: str = "") -> dict:
    ejemplos_txt = "\n".join(
        f"- {e.get('enunciado')} | alternativas: {e.get('alternativas')} | correcta: {e.get('correcta')}"
        for e in ejemplos
    ) or "(no hay ejemplos cargados; usa tu criterio para el nivel indicado)"
    human = GENERADOR_HUMAN.format(mundo=mundo, nodo=nodo, nivel=nivel, ejemplos=ejemplos_txt)
    if guia:
        human += f"\n\nGuía del nodo según el cuaderno de nivelación (respeta sus objetivos y su notación):\n{guia}"

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


# ── Tutor socrático ─────────────────────────────────────────────────────────

MAX_HISTORIAL_TUTOR = 16


def _llm_texto(temperature: float) -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.OPENAI_MODEL,
        api_key=settings.OPENAI_API_KEY,
        temperature=temperature,
        request_timeout=60,
    )


def _pregunta_txt(p: dict, mostrar_correcta: bool = True) -> str:
    alts = p.get("alternativas") or []
    partes = [f"Enunciado: {p.get('enunciado')}"]
    if alts:
        partes.append("Alternativas: " + " | ".join(str(a) for a in alts))
    if p.get("respuesta") is not None:
        partes.append(f"Respondió: {p.get('respuesta')}")
    if mostrar_correcta and p.get("correcta") is not None:
        partes.append(f"Correcta: {p.get('correcta')}")
    if p.get("es_correcto") is not None:
        partes.append("Resultado: " + ("CORRECTA" if p.get("es_correcto") else "INCORRECTA"))
    if p.get("explicacion"):
        partes.append(f"Explicación del banco: {p.get('explicacion')}")
    return " · ".join(partes)


def contexto_txt(ctx: dict) -> str:
    """Pasa el contexto que arma el backend a texto para el prompt."""
    lineas = [
        f"Mundo: {ctx.get('mundo') or '?'}",
        f"Nodo: {ctx.get('nodo') or '?'}" + (f" — {ctx['nodo_descripcion']}" if ctx.get("nodo_descripcion") else ""),
    ]
    nivel = ctx.get("nivel") or "Principiante"
    elo = ctx.get("elo")
    lineas.append(f"Nivel del estudiante: {nivel}" + (f" (ELO {elo})" if elo is not None else ""))
    if ctx.get("guia"):
        lineas.append(f"Guía del nodo (cuaderno):\n{ctx['guia']}")
    if ctx.get("debilidades"):
        lineas.append("Debilidades que detectó el agente analista: " + "; ".join(ctx["debilidades"]))
    if ctx.get("errores_recientes"):
        lineas.append("Errores recientes del estudiante en este nodo:\n" + "\n".join(
            f"- {_pregunta_txt(e)}" for e in ctx["errores_recientes"]))
    if ctx.get("revisar"):
        lineas.append(
            "Preguntas de su última fase/test que quiere revisar (la correcta es solo para ti: "
            "no la reveles de entrada, guíalo para que la encuentre):\n"
            + "\n".join(f"{i}. {_pregunta_txt(p)}" for i, p in enumerate(ctx["revisar"], 1)))
    ej = ctx.get("ejercicio")
    if ej:
        estado = ("ya respondió" if ej.get("respuesta") is not None else "todavía no responde")
        lineas.append(
            f"Ejercicio que el tutor le propuso ({estado}; "
            + ("la solución YA se le mostró" if ej.get("revelado") else "no reveles la correcta salvo regla 2d")
            + "):\n" + _pregunta_txt(ej))
    return "\n\n".join(lineas)


def tutor_responder(contexto: dict, historial: list[dict], mensaje: str | None) -> str:
    """Siguiente mensaje del tutor. Sin mensaje = la plataforma abre la conversación."""
    msgs = [SystemMessage(content=TUTOR_SYSTEM.format(contexto=contexto_txt(contexto)))]
    for m in historial[-MAX_HISTORIAL_TUTOR:]:
        texto = str(m.get("texto") or "")
        if m.get("rol") == "tutor":
            msgs.append(AIMessage(content=texto))
        elif m.get("rol") == "evento":
            msgs.append(HumanMessage(content=f"(Aviso de la plataforma, no lo escribió el estudiante) {texto}"))
        else:
            msgs.append(HumanMessage(content=texto))
    msgs.append(HumanMessage(content=mensaje if mensaje else TUTOR_INICIO))
    respuesta = str(_llm_texto(0.4).invoke(msgs).content).strip()
    logger.info(f"[NIV] tutor nodo='{contexto.get('nodo')}' ({len(historial)} msgs previos)")
    return respuesta


# ── Retroalimentación de fase / test ───────────────────────────────────────

def retroalimentar(contexto: dict, preguntas: list[dict]) -> dict:
    preguntas_txt = "\n".join(f"{i}. {_pregunta_txt(p)}" for i, p in enumerate(preguntas, 1))
    human = RETRO_HUMAN.format(
        mundo=contexto.get("mundo") or "?", nodo=contexto.get("nodo") or "test del mundo",
        nivel=contexto.get("nivel") or "Principiante", guia=contexto.get("guia") or "(sin guía)",
        preguntas=preguntas_txt,
    )
    r = _invocar_json(RETRO_SYSTEM, human, temperature=0.3)
    comentarios = {}
    for it in r.get("items") or []:
        try:
            comentarios[int(it.get("n"))] = str(it.get("comentario") or "").strip()
        except (TypeError, ValueError):
            continue
    return {
        "resumen": str(r.get("resumen") or "").strip(),
        "reforzar": [str(x).strip() for x in (r.get("reforzar") or []) if str(x).strip()][:3],
        "items": [comentarios.get(i, "") for i in range(1, len(preguntas) + 1)],
    }
