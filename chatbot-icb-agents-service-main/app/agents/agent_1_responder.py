from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from app.core.config import settings

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY)
parser = StrOutputParser()

SYSTEM_PROMPT = """Eres un tutor de matemáticas del ICB (UDP). Respondes preguntas de Cálculo 1.
Responde siempre en español, paso a paso y con rigor matemático.

Contexto del material del curso:
{rag_context}

Puntos débiles del alumno (enfoca tu respuesta en reforzar estos aspectos):
{weak_points}"""


def respond(question: str, rag_context: str, weak_points: str, image_base64: str | None = None) -> str:
    """
    Agente 1: Responde la pregunta del alumno. Si se adjunta una imagen,
    la analiza usando la capacidad de visión de GPT-4o-mini.
    """
    system_text = SYSTEM_PROMPT.format(
        rag_context=rag_context or "No hay contexto disponible.",
        weak_points=weak_points or "No hay puntos débiles registrados aún.",
    )

    if image_base64:
        # Modo visión: incluir imagen junto al texto
        human_content = [
            {"type": "text", "text": question or "Analiza y explica esta imagen matemática."},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}", "detail": "high"},
            },
        ]
        messages = [
            SystemMessage(content=system_text),
            HumanMessage(content=human_content),
        ]
        return parser.invoke(llm.invoke(messages))
    else:
        # Modo texto normal
        messages = [
            SystemMessage(content=system_text),
            HumanMessage(content=question),
        ]
        return parser.invoke(llm.invoke(messages))
