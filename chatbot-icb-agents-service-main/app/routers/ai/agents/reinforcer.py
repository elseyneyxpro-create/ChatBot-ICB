import json
import re
import logging
from openai import OpenAI
from app.core.config import settings
from app.routers.ai.prompts import (
    REINFORCER_SYSTEM_PROMPT,
    build_evaluate_concepto_prompt,
    build_evaluate_vof_prompt,
    build_evaluate_error_prompt,
)
from app.utils.openai.json_parser import pre_escape_latex_backslashes

logger = logging.getLogger("icb.ai")

client = OpenAI(api_key=settings.OPENAI_API_KEY)


def _fix_latex_escapes(obj):
    """
    Repara backslashes LaTeX perdidos por json.loads().
    json.loads() convierte \\f → chr(12), \\t → chr(9), \\b → chr(8).
    Comandos LaTeX como \\frac, \\forall, \\text, \\textbf, \\begin pierden su backslash.
    """
    if isinstance(obj, str):
        s = obj
        # chr(12) ← \\f en JSON: \\frac, \\forall, \\function
        s = s.replace('\x0c', '\\f')
        # chr(8) ← \\b en JSON: \\begin, \\bar, \\beta, \\boldsymbol
        s = s.replace('\x08', '\\b')
        # chr(9) ← \\t en JSON: \\text, \\textbf, \\textit, \\theta, \\times, \\to
        # Solo si va seguido de letras (evitar tabs reales de formateo)
        s = re.sub(r'\t(?=[A-Za-z])', r'\\t', s)
        # chr(10) ← \\n en JSON cuando va seguido de letra: \\neq, \\nabla, \\nu,
        # \\not, \\notin, \\newcommand, \\normalsize, etc.
        # Solo si va seguido de letras (evitar saltos de línea reales entre párrafos)
        s = re.sub(r'\n(?=[A-Za-z])', r'\\n', s)
        return s
    if isinstance(obj, dict):
        return {k: _fix_latex_escapes(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_fix_latex_escapes(item) for item in obj]
    return obj


def _guiones_por_categoria(videos: list[dict]) -> dict[str, str]:
    """
    Organiza los guiones de videos por categoría normalizada.
    Si hay varios videos de la misma categoría, concatena los guiones en vez de descartar.
    """
    result: dict[str, str] = {}
    for v in (videos or []):
        cat = (v.get("categoria") or "").lower().strip()
        guion = (v.get("contenido_video") or "").strip()
        if cat and guion:
            if cat not in result:
                result[cat] = guion
            else:
                result[cat] += f"\n\n{guion}"
                logger.warning(f"Reinforcer: categoría '{cat}' con múltiples videos — guiones concatenados")
    return result


def reinforce(
    question: str,
    answer: str,
    rag_context: str,
    tema: str | None = None,
    videos: list[dict] | None = None,
) -> dict:
    guiones = _guiones_por_categoria(videos)

    # ── Log detallado de videos recibidos por categoría ───────────────────────
    total_videos = len(videos) if videos else 0
    if total_videos:
        from collections import Counter
        cat_count = Counter((v.get("categoria") or "sin_categoria").lower().strip() for v in (videos or []))
        cat_summary = " | ".join(f"{cat}={n}" for cat, n in sorted(cat_count.items()))
        con_guion   = sum(1 for v in (videos or []) if v.get("contenido_video"))
        logger.info(
            f"Reinforcer START tema='{tema}' | {total_videos} videos → [{cat_summary}] "
            f"| {con_guion}/{total_videos} con guión"
        )
    else:
        logger.warning(f"Reinforcer START tema='{tema}' | ⚠ sin videos recibidos")

    user_content = f"Pregunta del alumno: {question}\n\nRespuesta del tutor: {answer[:1500]}"
    if rag_context:
        user_content += f"\n\nContexto del material: {rag_context[:400]}"
    if tema:
        user_content += f"\n\nTema: {tema}"

    # Inyectar guiones por tipo de ejercicio (categoría exacta de la BD)
    concepto_guion = guiones.get("concepto", "")
    vof_guion      = guiones.get("v o f", "") or guiones.get("vof", "")
    error_guion    = guiones.get("encuentre el error", "") or guiones.get("encuentra_el_error", "")

    logger.info(
        f"Reinforcer guiones → "
        f"concepto={'✓ (' + str(len(concepto_guion)) + 'c)' if concepto_guion else '✗ FALTA'} | "
        f"vof={'✓ (' + str(len(vof_guion)) + 'c)' if vof_guion else '✗ FALTA'} | "
        f"error={'✓ (' + str(len(error_guion)) + 'c)' if error_guion else '✗ FALTA'}"
    )
    # Log primeros 300 chars de cada guión para detectar símbolos incorrectos en Supabase
    if concepto_guion: logger.info(f"  GUION concepto[:300]: {repr(concepto_guion[:300])}")
    if vof_guion:      logger.info(f"  GUION vof[:300]:      {repr(vof_guion[:300])}")
    if error_guion:    logger.info(f"  GUION error[:300]:    {repr(error_guion[:300])}")

    if concepto_guion:
        user_content += f"\n\nGUION VIDEO CONCEPTO (usa este contenido para el ejercicio concepto):\n{concepto_guion[:700]}"
    if vof_guion:
        user_content += f"\n\nGUION VIDEO VERDADERO O FALSO (extrae la afirmación de aquí):\n{vof_guion[:700]}"
    if error_guion:
        user_content += f"\n\nGUION VIDEO ENCUENTRA EL ERROR (extrae los pasos de aquí):\n{error_guion[:700]}"

    # Fallback: si no hay guiones específicos, usar cualquier contenido disponible
    if not any([concepto_guion, vof_guion, error_guion]):
        logger.warning(f"Reinforcer: sin guiones por categoría para tema='{tema}', usando fallback genérico")
        fallback = "\n\n".join(
            v["contenido_video"] for v in (videos or []) if v.get("contenido_video")
        )
        if fallback:
            user_content += f"\n\nContenido de videos del tema:\n{fallback[:800]}"

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": REINFORCER_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            timeout=60,
            max_tokens=1600,
        )
        raw = response.choices[0].message.content
        logger.info(f"Reinforcer raw: {raw[:200]}")
        raw = pre_escape_latex_backslashes(raw)
        result = json.loads(raw)
        result = _fix_latex_escapes(result)

        if result.get("nivel") not in ("amarillo", "rojo"):
            result["nivel"] = "amarillo"

        if not isinstance(result.get("ejercicios"), list):
            result["ejercicios"] = []

        # Normalizar ejercicios
        for ej in result["ejercicios"]:
            if not isinstance(ej.get("explicacion"), str):
                ej["explicacion"] = ""
            if ej.get("tipo") == "encuentra_el_error":
                if isinstance(ej.get("desarrollo"), str):
                    ej["desarrollo"] = [p.strip() for p in ej["desarrollo"].split("|") if p.strip()]
                elif not isinstance(ej.get("desarrollo"), list):
                    ej["desarrollo"] = []
                pasos = len(ej.get("desarrollo", []))
                if not isinstance(ej.get("paso_error"), int) or not (1 <= ej.get("paso_error", 0) <= pasos):
                    ej["paso_error"] = pasos
                # Validar que el enunciado incluya el problema matemático (con $...$)
                # Si solo tiene la instrucción (e.g. "Encuentra el paso incorrecto:")
                # intentar construir un enunciado útil con el primer paso como referencia
                enunciado = ej.get("enunciado", "").strip()
                # Acepta tanto $...$ como \(...\) y \[...\] — el LLM a veces usa notación alternativa
                tiene_latex = "$" in enunciado or "\\(" in enunciado or "\\[" in enunciado
                if not tiene_latex and enunciado:
                    logger.warning(
                        f"Reinforcer: enunciado de encuentra_el_error sin LaTeX: '{enunciado[:80]}' — "
                        "el LLM olvidó incluir el problema matemático."
                    )
                    desarrollo = ej.get("desarrollo", [])
                    if desarrollo:
                        # Reconstruir: mostrar la expresión de partida del paso 1 como contexto
                        ej["enunciado"] = (
                            f"En el siguiente desarrollo matemático, {enunciado.rstrip(':').lower()}:"
                        )
                    else:
                        ej["enunciado"] = "Encuentra el paso incorrecto en el siguiente desarrollo:"
            if ej.get("tipo") == "verdadero_falso":
                val = ej.get("respuesta_correcta")
                if isinstance(val, str):
                    ej["respuesta_correcta"] = val.strip().lower() in ("true", "verdadero", "1", "v")
                elif not isinstance(val, bool):
                    ej["respuesta_correcta"] = True

        # ── Log resultado final ───────────────────────────────────────────────
        tipos_generados = [ej.get("tipo") for ej in result.get("ejercicios", [])]
        logger.info(
            f"Reinforcer OK → nivel={result.get('nivel')} | "
            f"ejercicios={len(result.get('ejercicios', []))} → {tipos_generados}"
        )
        for ej in result.get("ejercicios", []):
            if ej.get("tipo") == "encuentra_el_error":
                logger.info(
                    f"  [encuentra_el_error] pasos={len(ej.get('desarrollo', []))} "
                    f"paso_error={ej.get('paso_error')} "
                    f"enunciado='{ej.get('enunciado', '')[:60]}'"
                )
            elif ej.get("tipo") == "verdadero_falso":
                logger.info(
                    f"  [verdadero_falso] respuesta_correcta={ej.get('respuesta_correcta')} "
                    f"enunciado='{ej.get('enunciado', '')[:60]}'"
                )
            elif ej.get("tipo") == "concepto":
                logger.info(f"  [concepto] enunciado='{ej.get('enunciado', '')[:60]}'")

        return result

    except Exception as e:
        logger.error(f"Reinforcer falló: {e}", exc_info=True)
        return {
            "nivel": "amarillo",
            "texto": "Reflexiona sobre el concepto que acabas de ver: ¿puedes aplicarlo a un caso distinto?",
            "ejercicios": [],
        }


def evaluate_concepto(enunciado: str, respuesta_usuario: str, tema: str) -> dict:
    """
    Evalúa la respuesta del alumno a la pregunta de concepto.
    Retorna {"es_correcto": bool, "feedback": str}
    """
    prompt = build_evaluate_concepto_prompt(enunciado, respuesta_usuario, tema)
    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0,
            timeout=25,
            max_tokens=400,
        )
        result = json.loads(response.choices[0].message.content)
        val = result.get("es_correcto")
        if isinstance(val, str):
            result["es_correcto"] = val.strip().lower() in ("true", "verdadero", "1", "v")
        elif not isinstance(val, bool):
            result["es_correcto"] = False
        if not result.get("feedback"):
            result["feedback"] = "Gracias por tu respuesta."
        logger.info(f"evaluate_concepto: es_correcto={result.get('es_correcto')} tema='{tema}'")
        return result
    except Exception as e:
        logger.error(f"evaluate_concepto falló: {e}")
        return {"es_correcto": False, "feedback": "No se pudo evaluar la respuesta. Intenta de nuevo."}


def evaluate_vof(enunciado: str, respuesta_usuario: bool, respuesta_correcta: bool, tema: str) -> dict:
    """
    Evalúa la respuesta del alumno a un ejercicio Verdadero/Falso.
    es_correcto se determina directamente — el LLM solo genera el feedback.
    Retorna {"es_correcto": bool, "feedback": str}
    """
    es_correcto = respuesta_usuario == respuesta_correcta
    prompt = build_evaluate_vof_prompt(enunciado, respuesta_usuario, respuesta_correcta, tema)
    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0,
            timeout=25,
            max_tokens=300,
        )
        result = json.loads(response.choices[0].message.content)
        feedback = result.get("feedback") or ("¡Correcto!" if es_correcto else "Esa no era la respuesta correcta.")
        logger.info(f"evaluate_vof: es_correcto={es_correcto} tema='{tema}'")
        return {"es_correcto": es_correcto, "feedback": feedback}
    except Exception as e:
        logger.error(f"evaluate_vof falló: {e}")
        return {"es_correcto": es_correcto, "feedback": "¡Correcto!" if es_correcto else "Esa no era la respuesta correcta."}


def evaluate_error(
    enunciado: str,
    desarrollo: list[str],
    paso_error: int,
    respuesta_usuario: int,
    tema: str,
) -> dict:
    """
    Evalúa la respuesta del alumno a un ejercicio Encuentra el Error.
    es_correcto se determina directamente — el LLM solo genera el feedback.
    Retorna {"es_correcto": bool, "feedback": str}
    """
    es_correcto = respuesta_usuario == paso_error
    prompt = build_evaluate_error_prompt(enunciado, desarrollo, paso_error, respuesta_usuario, tema)
    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0,
            timeout=25,
            max_tokens=300,
        )
        result = json.loads(response.choices[0].message.content)
        feedback = result.get("feedback") or ("¡Correcto!" if es_correcto else "Esa no era la respuesta correcta.")
        logger.info(f"evaluate_error: es_correcto={es_correcto} paso_error={paso_error} seleccionado={respuesta_usuario} tema='{tema}'")
        return {"es_correcto": es_correcto, "feedback": feedback}
    except Exception as e:
        logger.error(f"evaluate_error falló: {e}")
        return {"es_correcto": es_correcto, "feedback": "¡Correcto!" if es_correcto else "Esa no era la respuesta correcta."}
