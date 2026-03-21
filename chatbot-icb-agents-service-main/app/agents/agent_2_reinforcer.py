import json
import logging
from openai import OpenAI
from app.core.config import settings

logger = logging.getLogger("icb.ai")

client = OpenAI(api_key=settings.OPENAI_API_KEY)

SYSTEM_PROMPT = """Eres un agente de pensamiento crítico para estudiantes de Cálculo 1 del ICB (UDP).

Recibirás la pregunta del alumno (siempre matemática) y la respuesta del tutor.
Tu tarea: generar retroalimentación y ejercicios basados en lo explicado.

CLASIFICACIÓN (campo "nivel") — elige UNO:
- "rojo": la pregunta revela un error conceptual grave del alumno (confundió definiciones, aplicó mal una regla, etc.).
- "amarillo": cualquier otro caso (pedido de explicación, ejercicio, duda válida sin error grave).

TEXTO (campo "texto") — obligatorio, mínimo 1 oración:
- amarillo: conecta con otro tema, advierte sobre errores comunes en este concepto, o profundiza algo de la respuesta del tutor.
- rojo: señala el error claramente y guía al alumno a reflexionar sobre por qué está equivocado.

EJERCICIOS (campo "ejercicios") — genera SIEMPRE exactamente 3, basados en la respuesta del tutor:
1. tipo "verdadero_falso": afirmación V o F sobre el concepto (sin indicar cuál). Solo campo "enunciado".
2. tipo "encuentra_el_error": campo "enunciado" con instrucción + campo "desarrollo" con 3-4 pasos separados por " | ".
3. tipo "concepto": pregunta abierta que exija aplicar el concepto. Solo campo "enunciado".

Responde SOLO con un objeto JSON válido, sin texto adicional."""


def reinforce(question: str, answer: str, rag_context: str, tema: str | None = None) -> dict:
    user_content = f"Pregunta del alumno: {question}\n\nRespuesta del tutor: {answer[:1500]}"
    if rag_context:
        user_content += f"\n\nContexto del material: {rag_context[:500]}"

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            timeout=45,
            max_tokens=800,
        )
        raw = response.choices[0].message.content
        logger.info(f"Reinforcer raw: {raw[:200]}")
        result = json.loads(raw)

        # El reinforcer solo se llama en preguntas matemáticas, nunca debe ser trivial
        if result.get("nivel") not in ("amarillo", "rojo"):
            result["nivel"] = "amarillo"
        if not isinstance(result.get("ejercicios"), list):
            result["ejercicios"] = []

        for ej in result["ejercicios"]:
            if ej.get("desarrollo"):
                ej["desarrollo"] = ej["desarrollo"].replace(" | ", "\n")

        return result

    except Exception as e:
        logger.error(f"Reinforcer falló: {e}")
        return {
            "nivel": "amarillo",
            "texto": "Reflexiona sobre el concepto que acabas de ver: ¿puedes aplicarlo a un caso distinto?",
            "ejercicios": [],
        }
