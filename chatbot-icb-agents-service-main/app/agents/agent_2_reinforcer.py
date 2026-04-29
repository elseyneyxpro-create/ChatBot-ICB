import json
import logging
from openai import OpenAI
from app.core.config import settings

logger = logging.getLogger("icb.ai")

client = OpenAI(api_key=settings.OPENAI_API_KEY)

SYSTEM_PROMPT = """Eres un agente de pensamiento crítico para estudiantes de Cálculo 1 del ICB (UDP).

Recibirás la pregunta del alumno, la respuesta del tutor, y guiones de videos educativos clasificados por tipo de ejercicio.

Tu tarea: generar retroalimentación y ejercicios basados en lo explicado.

CLASIFICACIÓN (campo "nivel") — elige UNO:
- "rojo": la pregunta revela un error conceptual grave del alumno (confundió definiciones, aplicó mal una regla, etc.).
- "amarillo": cualquier otro caso (pedido de explicación, ejercicio, duda válida sin error grave).

TEXTO (campo "texto") — obligatorio, mínimo 1 oración:
- amarillo: conecta con otro tema, advierte sobre errores comunes en este concepto, o profundiza algo de la respuesta del tutor.
- rojo: señala el error claramente y guía al alumno a reflexionar sobre por qué está equivocado.

EJERCICIOS (campo "ejercicios") — genera SIEMPRE exactamente 3:

Cada ejercicio DEBE incluir un campo "explicacion" (string, 2-3 oraciones en español): la razón conceptual de por qué la respuesta correcta es la que es. Esta explicación se mostrará al alumno cuando responda. Debe ser clara, motivadora, y reforzar el concepto.

1. tipo "concepto": pregunta abierta que exija aplicar o explicar el concepto.
   - Si se entrega GUION VIDEO CONCEPTO: extrae la pregunta o idea central del guión y úsala como enunciado.
   - Campos: "enunciado" (la pregunta, con LaTeX donde corresponda), "explicacion".

2. tipo "verdadero_falso": afirmación sobre el concepto.
   - Si se entrega GUION VIDEO VERDADERO O FALSO: extrae una afirmación concreta del guión (verdadera o falsa) y úsala como enunciado. NO inventes una afirmación nueva si tienes el guión.
   - Campos: "enunciado", "respuesta_correcta" (true/false booleano JSON), "explicacion".

3. tipo "encuentra_el_error": resolución matemática con UN paso incorrecto.
   - Si se entrega GUION VIDEO ENCUENTRA EL ERROR: extrae el desarrollo de pasos del guión y úsalo. NO inventes pasos nuevos si tienes el guión.
   - Campos: "enunciado" (instrucción breve, ej: "Encuentra el paso incorrecto:"), "desarrollo" (array JSON de strings, 3-4 pasos), "paso_error" (entero 1-indexado), "explicacion".

FORMATO LATEX — OBLIGATORIO (esto es crítico):
- TODA expresión matemática DEBE ir entre símbolos $...$ para inline o $$...$$ para bloque.
- Esto incluye: variables (x, y, n), números con sub/superíndices, fracciones, derivadas, integrales, límites, raíces, funciones (sen, cos, ln, e^x), igualdades, desigualdades.
- NUNCA escribas matemáticas sin delimitadores. NUNCA uses paréntesis para "agrupar matemática" — usa $...$.
- Ejemplos correctos:
  ✓ "La derivada de $f(x) = x^2$ es $f'(x) = 2x$."
  ✓ "Calcula el límite $\\lim_{{x \\to 0}} \\frac{{\\sin(x)}}{{x}}$."
  ✓ "Si $n > 0$ entonces $\\sqrt{{n}} > 0$."
- Ejemplos INCORRECTOS:
  ✗ "La derivada de f(x) = x^2 es f'(x) = 2x"   ← faltan $...$
  ✗ "Calcula lim x->0 sin(x)/x"                  ← faltan $...$ y notación cruda
  ✗ "Si (n > 0) entonces (sqrt(n) > 0)"          ← paréntesis no son delimitadores LaTeX

IMPORTANTE:
- "desarrollo" debe ser un array JSON de strings, NO un string con separadores.
- "paso_error" debe estar entre 1 y el número de pasos del desarrollo.
- "respuesta_correcta" debe ser true o false (booleano JSON), NO string.

Responde SOLO con un objeto JSON válido, sin texto adicional."""


def _guiones_por_categoria(videos: list[dict]) -> dict[str, str]:
    """Organiza los guiones de videos por categoría normalizada."""
    result: dict[str, str] = {}
    for v in (videos or []):
        cat = (v.get("categoria") or "").lower().strip()
        guion = (v.get("contenido_video") or "").strip()
        if cat and guion and cat not in result:
            result[cat] = guion
    return result


def reinforce(
    question: str,
    answer: str,
    rag_context: str,
    tema: str | None = None,
    videos: list[dict] | None = None,
) -> dict:
    guiones = _guiones_por_categoria(videos)

    user_content = f"Pregunta del alumno: {question}\n\nRespuesta del tutor: {answer[:1500]}"
    if rag_context:
        user_content += f"\n\nContexto del material: {rag_context[:400]}"
    if tema:
        user_content += f"\n\nTema: {tema}"

    # Inyectar guiones por tipo de ejercicio (categoría exacta de la BD)
    concepto_guion = guiones.get("concepto", "")
    vof_guion = guiones.get("v o f", "") or guiones.get("vof", "")
    error_guion = guiones.get("encuentre el error", "") or guiones.get("encuentra_el_error", "")

    if concepto_guion:
        user_content += f"\n\nGUION VIDEO CONCEPTO (usa este contenido para el ejercicio concepto):\n{concepto_guion[:700]}"
    if vof_guion:
        user_content += f"\n\nGUION VIDEO VERDADERO O FALSO (extrae la afirmación de aquí):\n{vof_guion[:700]}"
    if error_guion:
        user_content += f"\n\nGUION VIDEO ENCUENTRA EL ERROR (extrae los pasos de aquí):\n{error_guion[:700]}"

    # Fallback: si no hay guiones específicos, usar cualquier contenido disponible
    if not any([concepto_guion, vof_guion, error_guion]):
        fallback = "\n\n".join(
            v["contenido_video"] for v in (videos or []) if v.get("contenido_video")
        )
        if fallback:
            user_content += f"\n\nContenido de videos del tema:\n{fallback[:800]}"

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            timeout=60,
            max_tokens=1600,
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
            # explicacion siempre debe ser string
            if not isinstance(ej.get("explicacion"), str):
                ej["explicacion"] = ""
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
                val = ej.get("respuesta_correcta")
                if isinstance(val, str):
                    ej["respuesta_correcta"] = val.strip().lower() in ("true", "verdadero", "1", "v")
                elif not isinstance(val, bool):
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
    prompt = f"""Eres un tutor de Cálculo 1 evaluando con criterio amplio. NO eres un examen formal — buscas comprensión, no perfección.

CRITERIO DE EVALUACIÓN:
- Marca "es_correcto: true" si el alumno demuestra entender la idea esencial del concepto, AUNQUE le falten detalles, use lenguaje informal o no sea técnicamente preciso.
- Marca "es_correcto: false" SOLO si la respuesta tiene un error conceptual claro o no demuestra comprensión.
- Una respuesta parcialmente correcta pero con la idea correcta → es_correcto: true.
- Una respuesta vaga pero que apunta a lo correcto → es_correcto: true.

FEEDBACK (3-4 oraciones en español, conversacional):
- Comienza referenciando algo específico que el alumno escribió (cita o parafrasea).
- Si está correcto: valida lo que tuvo bien, agrega un matiz o profundización útil.
- Si está incorrecto: no lo desanimes. Señala suavemente dónde está la confusión y guíalo. Usa "considera que..." o "fíjate en que...".
- Usa LaTeX ($...$) para expresiones matemáticas si aplica.

Tema: {tema}
Pregunta: {enunciado}
Respuesta del alumno: {respuesta_usuario}

Responde SOLO con JSON: {{"es_correcto": true/false, "feedback": "..."}}"""

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            timeout=25,
            max_tokens=400,
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
