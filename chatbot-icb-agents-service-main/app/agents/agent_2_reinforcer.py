from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from app.core.config import settings

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY)

prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un agente de pensamiento crítico para estudiantes de Cálculo 1 del ICB (UDP).

Analiza la pregunta del alumno e identifica posibles errores conceptuales o áreas de refuerzo.

━━━ CLASIFICACIÓN ━━━
1. "trivial" → La pregunta NO es de contenido matemático (saludos, agradecimientos, off-topic).
2. "amarillo" → Pregunta matemática válida, sin errores graves evidentes.
3. "rojo" → La pregunta revela un error conceptual grave en el razonamiento del alumno.

━━━ TEXTO PRINCIPAL ━━━
- trivial: reflexión interesante sobre Cálculo 1.
- amarillo: acotación de pensamiento crítico, conexión con otro tema o profundización.
- rojo: señala el error claramente y guía al alumno a reflexionar.

━━━ 3 EJERCICIOS ━━━
Genera exactamente 3 ejercicios enfocados en el tema y el error detectado (si hubo).
Sé conciso — los ejercicios deben ser claros pero breves.

Ejercicio 1 "verdadero_falso": afirmación sobre el tema (sin respuesta).
Ejercicio 2 "encuentra_el_error": desarrollo matemático incorrecto breve (3-4 pasos), el alumno identifica el error.
Ejercicio 3 "concepto": pregunta conceptual abierta.

Contexto del material:
{rag_context}

Responde en JSON exacto:
{{
  "nivel": "trivial" | "amarillo" | "rojo",
  "texto": "acotación breve",
  "ejercicios": [
    {{"tipo": "verdadero_falso", "enunciado": "..."}},
    {{"tipo": "encuentra_el_error", "enunciado": "...", "desarrollo": "paso1\\npaso2\\npaso3"}},
    {{"tipo": "concepto", "enunciado": "..."}}
  ]
}}"""),
    ("human", "Pregunta del alumno: {question}"),
])

chain = prompt | llm | JsonOutputParser()


def reinforce(question: str, rag_context: str) -> dict:
    try:
        result = chain.invoke({
            "question": question,
            "rag_context": rag_context or "No hay contexto disponible.",
        })
        if result.get("nivel") not in ("trivial", "amarillo", "rojo"):
            result["nivel"] = "amarillo"
        if "ejercicios" not in result or not isinstance(result["ejercicios"], list):
            result["ejercicios"] = []
        return result
    except Exception:
        return {
            "nivel": "amarillo",
            "texto": "¿Puedes explicar con tus propias palabras el concepto que acabas de ver?",
            "ejercicios": [],
        }
