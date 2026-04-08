import json
import logging
from openai import OpenAI
from app.core.config import settings

logger = logging.getLogger("icb.ai")

client = OpenAI(api_key=settings.OPENAI_API_KEY)

SYSTEM_PROMPT = """Eres un agente de pensamiento crítico para estudiantes de Cálculo 1 del ICB (UDP).

Recibirás la pregunta del alumno, la respuesta del tutor, y opcionalmente el guión del video relacionado con el tema.

Tu tarea: generar retroalimentación y ejercicios basados en lo explicado.

CLASIFICACIÓN (campo "nivel") — elige UNO:
- "rojo": la pregunta revela un error conceptual grave del alumno (confundió definiciones, aplicó mal una regla, etc.).
- "amarillo": cualquier otro caso (pedido de explicación, ejercicio, duda válida sin error grave).

TEXTO (campo "texto") — obligatorio, mínimo 1 oración:
- amarillo: conecta con otro tema, advierte sobre errores comunes en este concepto, o profundiza algo de la respuesta del tutor.
- rojo: señala el error claramente y guía al alumno a reflexionar sobre por qué está equivocado.

EJERCICIOS (campo "ejercicios") — genera SIEMPRE exactamente 3:

1. tipo "concepto": pregunta abierta que exija aplicar o explicar el concepto. Solo campo "enunciado". Usa LaTeX donde corresponda ($...$).

2. tipo "verdadero_falso": afirmación sobre el concepto basada en el guión del video si está disponible (para que si el alumno falla, el video sea relevante). Campos:
   - "enunciado": la afirmación (verdadera o falsa). Usa LaTeX donde corresponda.
   - "respuesta_correcta": true si la afirmación es verdadera, false si es falsa.

3. tipo "encuentra_el_error": resolución matemática con UN paso incorrecto. Basada en el guión del video si está disponible. Campos:
   - "enunciado": instrucción breve ("Encuentra el paso incorrecto:").
   - "desarrollo": array JSON de strings, cada string es un paso. Entre 3 y 4 pasos. Usa LaTeX donde corresponda.
   - "paso_error": número entero (1-indexado) del paso que contiene el error.

IMPORTANTE:
- "desarrollo" debe ser un array JSON de strings, NO un string con separadores.
- "paso_error" debe estar entre 1 y el número de pasos del desarrollo.
- "respuesta_correcta" debe ser true o false (booleano JSON), NO string.
- Usa LaTeX ($...$) en enunciados y pasos para expresiones matemáticas.

Responde SOLO con un objeto JSON válido, sin texto adicional."""


def reinforce(
    question: str,
    answer: str,
    rag_context: str,
    tema: str | None = None,
    contenido_video: str = "",
) -> dict:
    user_content = f"Pregunta del alumno: {question}\n\nRespuesta del tutor: {answer[:1500]}"
    if rag_context:
        user_content += f"\n\nContexto del material: {rag_context[:400]}"
    if contenido_video:
        user_content += f"\n\nGuión del video relacionado (basa los ejercicios VoF y Encuentra el error en este contenido):\n{contenido_video[:800]}"
    if tema:
        user_content += f"\n\nTema: {tema}"

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            timeout=45,
            max_tokens=1000,
        )
        raw = response.choices[0].message.content
        logger.info(f"Reinforcer raw: {raw[:200]}")
        result = json.loads(raw)

        if result.get("nivel") not in ("amarillo", "rojo"):
            result["nivel"] = "amarillo"

        if not isinstance(result.get("ejercicios"), list):
            result["ejercicios"] = []

        # Normalizar ejercicios
        for ej in result["ejercicios"]:
            # desarrollo debe ser array de strings
            if ej.get("tipo") == "encuentra_el_error":
                if isinstance(ej.get("desarrollo"), str):
                    # Si llegó como string con separadores, convertir a array
                    ej["desarrollo"] = [p.strip() for p in ej["desarrollo"].split("|") if p.strip()]
                elif not isinstance(ej.get("desarrollo"), list):
                    ej["desarrollo"] = []
                # Asegurar paso_error válido
                pasos = len(ej.get("desarrollo", []))
                if not isinstance(ej.get("paso_error"), int) or not (1 <= ej.get("paso_error", 0) <= pasos):
                    ej["paso_error"] = pasos  # fallback al último paso
            # respuesta_correcta debe ser bool
            if ej.get("tipo") == "verdadero_falso":
                if not isinstance(ej.get("respuesta_correcta"), bool):
                    ej["respuesta_correcta"] = True

        return result

    except Exception as e:
        logger.error(f"Reinforcer falló: {e}")
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
    prompt = f"""Eres un tutor de Cálculo 1. Evalúa si la respuesta del alumno demuestra comprensión del concepto.

Tema: {tema}
Pregunta: {enunciado}
Respuesta del alumno: {respuesta_usuario}

Responde SOLO con JSON: {{"es_correcto": true/false, "feedback": "retroalimentación breve y motivadora en español (máx 2 oraciones)"}}"""

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            timeout=20,
            max_tokens=200,
        )
        result = json.loads(response.choices[0].message.content)
        if not isinstance(result.get("es_correcto"), bool):
            result["es_correcto"] = False
        if not result.get("feedback"):
            result["feedback"] = "Gracias por tu respuesta."
        return result
    except Exception as e:
        logger.error(f"evaluate_concepto falló: {e}")
        return {"es_correcto": False, "feedback": "No se pudo evaluar la respuesta. Intenta de nuevo."}
