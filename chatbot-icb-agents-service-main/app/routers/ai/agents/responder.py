from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from app.core.config import settings
from app.routers.ai.prompts import RESPONDER_SYSTEM_PROMPT
import logging
logger = logging.getLogger("icb.ai")
llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, request_timeout=60, max_retries=1)
parser = StrOutputParser()


def respond(
    question: str,
    rag_context: str,
    weak_points: str,
    image_base64: str | None = None,
    context: str = "",
    resumen_rolling: "list[dict] | None" = None,
    resumenes: list[str] | None = None,
    super_resumenes: list[str] | None = None,
    formato: str | None = None,
) -> str:
    memory_parts: list[str] = []

    # Memoria de largo plazo (más antigua primero)
    if super_resumenes:
        joined = "\n\n".join(f"- {s}" for s in super_resumenes if s)
        if joined.strip():
            memory_parts.append(f"MEMORIA DE LARGO PLAZO (super resúmenes históricos):\n{joined}")

    if resumenes:
        joined = "\n\n".join(f"Bloque {i+1}:\n{r}" for i, r in enumerate(resumenes) if r)
        if joined.strip():
            memory_parts.append(f"MEMORIA DE BLOQUES RECIENTES:\n{joined}")

    # Rolling: lista de intercambios crudos del bloque actual
    if resumen_rolling:
        rolling_lines = []
        for entry in resumen_rolling:
            rolling_lines.append(f"Alumno: {entry.get('pregunta', '')}")
            rolling_lines.append(f"Tutor: {entry.get('respuesta', '')}")
        rolling_text = "\n".join(rolling_lines).strip()
        if rolling_text:
            memory_parts.append(f"BLOQUE ACTUAL (intercambios previos):\n{rolling_text}")

    if context.strip():
        memory_parts.append(f"ÚLTIMOS INTERCAMBIOS:\n{context}")

    memory_section = "\n\n".join(memory_parts) + "\n\n" if memory_parts else ""

    formato_section = ""
    if formato and formato.strip():
        formato_section = f"INSTRUCCIONES DE FORMATO PARA ESTE TEMA:\n{formato.strip()}\n\n"

    system_text = RESPONDER_SYSTEM_PROMPT.format(
        memory_section=memory_section,
        formato_section=formato_section,
        rag_context=rag_context or "No hay material del curso disponible.",
        weak_points=weak_points or "Sin puntos débiles registrados aún.",
    )

    logger.info(f"rag_context: {rag_context[:200]}")
    logger.info(f"weak_points: {weak_points[:200]}")

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
