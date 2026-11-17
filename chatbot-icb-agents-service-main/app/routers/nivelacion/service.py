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
import re

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.core.postgres import execute, fetch_all
from app.routers.nivelacion.prompts import (
    ANALISTA_HUMAN, ANALISTA_SYSTEM, GENERADOR_HUMAN, GENERADOR_SYSTEM,
    RESOLVER_SYSTEM, RETRO_HUMAN, RETRO_SYSTEM, TUTOR_INICIO, TUTOR_SYSTEM, VERIFICADOR_SYSTEM,
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

_CMD_LATEX = re.compile(r"\\[A-Za-z]+")
_PALABRAS = re.compile(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}")


def latex_suelto(texto: str) -> str:
    """
    Envuelve en $...$ una expresión corta que trae LaTeX sin delimitar (ej. "\\frac{5}{2}" o "x^{2}"),
    como a veces devuelve el LLM en las alternativas. No toca textos con $ ni frases con palabras.
    """
    t = str(texto).strip()
    if not t or "$" in t:
        return t
    t = re.sub(r"\\\((.+?)\\\)", r"$\1$", t)  # \( ... \)  →  $ ... $
    if "$" in t:
        return t
    tiene_latex = bool(_CMD_LATEX.search(t)) or bool(re.search(r"[\^_]\{", t))
    sin_comandos = _CMD_LATEX.sub("", t)
    if tiene_latex and not _PALABRAS.search(sin_comandos):
        return f"${t}$"
    return t


def _validar_pregunta(p: dict) -> dict:
    enunciado = str(p.get("enunciado") or "").strip()
    alternativas = [latex_suelto(a) for a in (p.get("alternativas") or []) if str(a).strip()]
    correcta = latex_suelto(p.get("correcta") or "")
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
    for intento in range(4):  # el LLM a veces devuelve algo inválido o mal resuelto: se reintenta
        try:
            pregunta = _validar_pregunta(_invocar_json(GENERADOR_SYSTEM, human, temperature=0.8))
            _verificar_pregunta(pregunta)
            logger.info(f"[NIV] pregunta generada nodo='{nodo}' nivel={nivel}: {pregunta['enunciado'][:80]!r}")
            return pregunta
        except Exception as e:
            ultimo_error = e
            logger.warning(f"[NIV] generación descartada (intento {intento + 1}): {e}")
    raise RuntimeError(f"No se pudo generar una pregunta válida: {ultimo_error}")


def _normalizar_alt(a: str) -> str:
    """Para comparar alternativas sin que molesten $, espacios ni mayúsculas."""
    return "".join(str(a).replace("$", "").split()).lower()


def _verificar_pregunta(p: dict) -> None:
    """
    Revisor independiente: resuelve la pregunta sin ver la respuesta marcada (temperatura 0).
    Se descarta si su respuesta no coincide con la marcada, si dice que ninguna es correcta
    o si hay más de una correcta.
    """
    human = f"Enunciado: {p['enunciado']}\nAlternativas:\n" + "\n".join(f"- {a}" for a in p["alternativas"])
    r = _invocar_json(VERIFICADOR_SYSTEM, human, temperature=0)
    respuesta = str(r.get("respuesta") or "").strip()
    try:
        correctas = int(r.get("correctas", 1))
    except (TypeError, ValueError):
        correctas = 1
    if correctas != 1 or respuesta.upper() == "NINGUNA":
        raise ValueError(f"el revisor encontró {correctas} alternativas correctas (resultado: {r.get('resultado')!r})")
    if _normalizar_alt(respuesta) != _normalizar_alt(p["correcta"]):
        raise ValueError(f"el revisor respondió {respuesta!r} y la marcada era {p['correcta']!r}")


# ── Analista ────────────────────────────────────────────────────────────────

def analizar_estudiante(uid: str) -> dict | None:
    est = fetch_all("SELECT nivel FROM niv_progreso.estudiante WHERE uid = %s", (uid,))
    if not est:
        return None
    nivel_actual = est[0]["nivel"] or "Principiante"

    intentos = fetch_all(
        """SELECT i.contexto, i.origen, i.dificultad, i.enunciado, i.respuesta, i.correcta, i.es_correcto,
                  COALESCE(i.n_intento, 1) AS n_intento, n.titulo AS nodo, m.titulo AS mundo
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

    # El % de acierto se calcula con la primera respuesta a cada pregunta: en las fases de nodo una
    # pregunta fallada vuelve al final de la cola (reintentos), y esos reintentos no deben inflarlo.
    primeros = [i for i in intentos if i["n_intento"] == 1] or intentos
    aciertos = sum(1 for i in primeros if i["es_correcto"])
    pct = round(100 * aciertos / len(primeros))
    intentos_txt = "\n".join(
        f"- [{i['mundo'] or '?'} / {i['nodo'] or 'test del mundo'} | {i['dificultad']} | {i['contexto']}"
        + (f" | reintento {i['n_intento']}" if i["n_intento"] > 1 else "") + "] "
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
# Algo de variación en la forma de preguntar (no un guion fijo); la exactitud la cuida la resolución oculta.
TEMPERATURA_TUTOR = 0.6


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
    propio = ctx.get("propio")
    if propio:
        r = propio.get("resolucion") or {}
        partes = [f"Ejercicio que trajo el estudiante (el más reciente):\n{propio.get('enunciado')}"]
        if r.get("claro") is False:
            partes.append(f"Ojo: el enunciado no se entiende o está incompleto. Falta: {r.get('falta') or '?'}")
        elif r.get("en_alcance") is False:
            partes.append(f"Ojo: no es del temario de la nivelación (tema: {r.get('tema') or '?'}).")
        if r.get("pasos") or r.get("resultado"):
            partes.append(
                "Resolución SOLO PARA TI (no la muestres, no copies sus pasos, no digas el resultado):\n"
                + "\n".join(f"- {x}" for x in r.get("pasos") or [])
                + f"\nResultado: {r.get('resultado') or '?'}")
        if r.get("conceptos"):
            partes.append("Conceptos que necesita: " + "; ".join(map(str, r["conceptos"])))
        if r.get("errores_tipicos"):
            partes.append("Errores típicos aquí: " + "; ".join(map(str, r["errores_tipicos"])))
        lineas.append("\n".join(partes))
    ej = ctx.get("ejercicio")
    if ej:
        estado = ("ya respondió" if ej.get("respuesta") is not None else "todavía no responde")
        lineas.append(
            f"Ejercicio que el tutor le propuso ({estado}; "
            + ("la solución YA se le mostró" if ej.get("revelado") else "no reveles la correcta salvo regla 2d")
            + "):\n" + _pregunta_txt(ej))
    return "\n\n".join(lineas)


def resolver_ejercicio(enunciado: str, contexto: dict) -> dict:
    """Resuelve en privado un ejercicio que trae el estudiante, para que el tutor lo guíe sin equivocarse."""
    human = (f"Mundo: {contexto.get('mundo') or '?'} · Nodo: {contexto.get('nodo') or '?'}\n\n"
             f"Ejercicio del estudiante:\n{enunciado}")
    r = _invocar_json(RESOLVER_SYSTEM, human, temperature=0)
    lista = lambda k, n: [str(x).strip() for x in (r.get(k) or []) if str(x).strip()][:n]
    return {
        "claro": r.get("claro") is not False,
        "falta": str(r.get("falta") or "").strip(),
        "en_alcance": r.get("en_alcance") is not False,
        "tema": str(r.get("tema") or "").strip(),
        "conceptos": lista("conceptos", 5),
        "pasos": lista("pasos", 12),
        "resultado": str(r.get("resultado") or "").strip(),
        "errores_tipicos": lista("errores_tipicos", 4),
    }


AYUDAS = {"no_entiendo": "No entiendo", "pista": "Dame una pista"}


def _tutor_ai_txt(m: dict) -> str:
    """Mensaje anterior del tutor tal como lo produjo (JSON), para que mantenga el formato y recuerde
    qué alternativa esperaba."""
    return json.dumps({"mensaje": str(m.get("texto") or ""), "opciones": m.get("opciones") or [],
                       "esperada": m.get("esperada")}, ensure_ascii=False)


def _tutor_alumno_txt(m: dict) -> str:
    """Lo que hizo el alumno: eligió una alternativa o tocó un botón de ayuda."""
    if m.get("ayuda") in AYUDAS:
        return f"(El estudiante tocó el botón «{AYUDAS[m['ayuda']]}»)"
    txt = f"(El estudiante eligió la alternativa) {m.get('texto') or ''}"
    if m.get("eleccion_esperada") is True:
        txt += "\n(Aviso de la plataforma: es la alternativa que esperabas.)"
    elif m.get("eleccion_esperada") is False:
        txt += "\n(Aviso de la plataforma: NO es la alternativa que esperabas.)"
    return txt


def _validar_turno(r: dict, sin_opciones: bool) -> dict:
    mensaje = str(r.get("mensaje") or "").strip()
    if not mensaje:
        raise ValueError("el tutor no devolvió mensaje")
    opciones: list[str] = []
    for o in r.get("opciones") or []:
        t = latex_suelto(str(o).strip())
        if t and len(t) <= 300 and t not in opciones:
            opciones.append(t)
    opciones = opciones[:4]
    esperada = r.get("esperada")
    esperada = esperada if isinstance(esperada, int) and 0 <= esperada < len(opciones) else None
    if sin_opciones:
        return {"mensaje": mensaje, "opciones": [], "esperada": None}
    if len(opciones) < 2:
        raise ValueError("el tutor no devolvió alternativas suficientes")
    # Se barajan para que la esperada no quede siempre en el mismo lugar
    orden = list(range(len(opciones)))
    random.shuffle(orden)
    return {
        "mensaje": mensaje,
        "opciones": [opciones[i] for i in orden],
        "esperada": orden.index(esperada) if esperada is not None else None,
    }


def tutor_responder(contexto: dict, historial: list[dict], mensaje: dict | None) -> dict:
    """Siguiente turno del tutor: {mensaje, opciones, esperada}. El estudiante solo responde eligiendo una
    alternativa o con los botones «No entiendo» / «Dame una pista».
    mensaje = lo que hizo el alumno ({texto, ayuda, eleccion_esperada}); None = la plataforma abre la conversación."""
    msgs = [SystemMessage(content=TUTOR_SYSTEM.format(contexto=contexto_txt(contexto)))]
    for m in historial[-MAX_HISTORIAL_TUTOR:]:
        if m.get("rol") == "tutor":
            msgs.append(AIMessage(content=_tutor_ai_txt(m)))
        elif m.get("rol") == "evento":
            msgs.append(HumanMessage(content=f"(Aviso de la plataforma, no lo escribió el estudiante) {m.get('texto') or ''}"))
        else:
            msgs.append(HumanMessage(content=_tutor_alumno_txt(m)))
    if not mensaje:
        msgs.append(HumanMessage(content=TUTOR_INICIO))
    elif mensaje.get("evento"):
        msgs.append(HumanMessage(content=str(mensaje.get("texto") or "")))
    else:
        msgs.append(HumanMessage(content=_tutor_alumno_txt(mensaje)))

    ej = contexto.get("ejercicio") or {}
    sin_opciones = bool(ej) and ej.get("respuesta") is None
    llm = _llm(TEMPERATURA_TUTOR)
    ultimo_error: Exception | None = None
    for _ in range(2):  # un reintento si el JSON viene mal o sin alternativas
        try:
            turno = _validar_turno(json.loads(llm.invoke(msgs).content), sin_opciones)
            logger.info(f"[NIV] tutor nodo='{contexto.get('nodo')}' ({len(historial)} msgs previos, "
                        f"{len(turno['opciones'])} alternativas)")
            return turno
        except Exception as e:  # noqa: BLE001
            ultimo_error = e
            logger.warning(f"[NIV] turno del tutor inválido: {e}")
    raise ultimo_error or ValueError("el tutor no respondió")


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
