# app/core/lc_vertex.py
from langchain_google_vertexai import ChatVertexAI
from app.core.config import settings

try:
    from vertexai.generative_models import HarmCategory, HarmBlockThreshold
    SAFETY = {
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    }
except Exception:
    SAFETY = None

llm = ChatVertexAI(
    model=settings.VERTEX_MODEL,        # p.ej. "gemini-2.5-flash" o "gemini-2.5-pro"
    project=settings.GCP_PROJECT,
    location=settings.GCP_LOCATION,
    temperature=0.2,
    max_output_tokens=2048,             # subimos margen por si “piensa”
    response_mime_type="text/plain",    # 🔑 evita respuestas no textuales
    safety_settings=SAFETY,             # 🔑 evita bloqueos suaves
)
