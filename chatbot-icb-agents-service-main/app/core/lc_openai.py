# app/core/lc_openai.py
from langchain_openai import ChatOpenAI
from app.core.config import settings

# Modelo OpenAI (GPT). Requiere OPENAI_API_KEY en el entorno.
llm = ChatOpenAI(
    model=settings.OPENAI_MODEL,     # p. ej. "gpt-4o-mini" o "gpt-4.1-mini"
    temperature=0.2,
    max_tokens=1024,                 # ajustable
)
