from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from app.core.config import settings

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, request_timeout=60, max_retries=1)
parser = StrOutputParser()

SYSTEM_PROMPT = """Eres TutorBot, el asistente de matemáticas del ICB (Universidad Diego Portales). Ayudas a estudiantes de Cálculo 1.

FORMATO OBLIGATORIO:
- Usa LaTeX para TODA expresión matemática: $expresión$ para inline, $$expresión$$ para bloques centrados.
- Usa **negrita** para conceptos clave.
- Numera los pasos cuando resuelvas un problema (1. 2. 3. ...).
- Usa ## para títulos de sección si la respuesta es larga.
- Sé conciso y directo. No repitas la pregunta del alumno.
- Responde siempre en español.

MEMORIA: Tienes acceso al historial reciente de esta conversación (aparece más abajo como "ÚLTIMOS INTERCAMBIOS" y "RESUMEN DE LA SESIÓN"). Si el alumno pregunta si recuerdas algo, si puede continuar de donde estaba, o qué vieron antes — responde SÍ y referencia el contenido del historial. NUNCA digas que no tienes acceso a conversaciones pasadas.

{memory_section}
{formato_section}
MATERIAL DEL CURSO:
{rag_context}

PERFIL DEL ALUMNO — refuerza estos puntos débiles si aplica:
{weak_points}"""


def respond(
    question: str,
    rag_context: str,
    weak_points: str,
    image_base64: str | None = None,
    context: str = "",
    resumen_conversacion: str = "",
    formato: str | None = None,
) -> str:
    memory_parts: list[str] = []
    if resumen_conversacion.strip():
        memory_parts.append(f"RESUMEN DE LA SESIÓN (todo lo discutido):\n{resumen_conversacion}")
    if context.strip():
        memory_parts.append(f"ÚLTIMOS INTERCAMBIOS:\n{context}")
    memory_section = "\n\n".join(memory_parts) + "\n\n" if memory_parts else ""

    formato_section = ""
    if formato and formato.strip():
        formato_section = f"INSTRUCCIONES DE FORMATO PARA ESTE TEMA:\n{formato.strip()}\n\n"

    system_text = SYSTEM_PROMPT.format(
        memory_section=memory_section,
        formato_section=formato_section,
        rag_context=rag_context or "No hay material del curso disponible.",
        weak_points=weak_points or "Sin puntos débiles registrados aún.",
    )

    if image_base64:
        human_content = [
            {"type": "text", "text": question or "Analiza y explica esta imagen matemática."},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}", "detail": "high"},
            },
        ]
        messages = [SystemMessage(content=system_text), HumanMessage(content=human_content)]
    else:
        messages = [SystemMessage(content=system_text), HumanMessage(content=question)]

    return parser.invoke(llm.invoke(messages))
