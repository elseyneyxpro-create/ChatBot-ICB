# app/core/chain.py
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import SystemMessage
from app.core.llm import llm  # 👈 ahora tomamos el LLM según provider

SYSTEM_PROMPT = (
    "Eres un tutor de matemáticas del ICB (UDP). "
    "Responde en español, paso a paso y con rigor. "
    "Si se indica 'subject' (Cálculo/Álgebra/Física), úsalo de contexto."
)

prompt = ChatPromptTemplate.from_messages([
    SystemMessage(content=SYSTEM_PROMPT),
    MessagesPlaceholder(variable_name="history"),
    ("human", "{question}"),
])

# Devolvemos texto plano
chain = prompt | llm | StrOutputParser()
