# app/core/vertex.py
import os
import vertexai
from vertexai.generative_models import (
    GenerativeModel,
    GenerationConfig,
    SafetySetting,
    HarmCategory,
    HarmBlockThreshold,
)
from app.core.config import settings

SYSTEM_PROMPT = (
    "Eres un tutor de matemáticas del ICB (UDP). "
    "Responde en español con pasos claros y breves."
)

# Config constantes (las usamos también para GEN_CFG_DESC)
GEN_TEMP = 0.2
GEN_MAX_TOKENS = 2048
GEN_MIME = "text/plain"

# Si está en settings, pásalo al entorno (Vertex lo lee desde ahí)
if settings.GOOGLE_APPLICATION_CREDENTIALS:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS

vertexai.init(project=settings.GCP_PROJECT, location=settings.GCP_LOCATION)

# Config de generación (no leer atributos luego: algunos builds no los exponen)
GEN_CFG = GenerationConfig(
    response_mime_type=GEN_MIME,
    temperature=GEN_TEMP,
    max_output_tokens=GEN_MAX_TOKENS,
)

# Safety sin bloqueos “suaves”
SAFETY = [
    SafetySetting(category=HarmCategory.HARM_CATEGORY_HATE_SPEECH,        threshold=HarmBlockThreshold.BLOCK_NONE),
    SafetySetting(category=HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,  threshold=HarmBlockThreshold.BLOCK_NONE),
    SafetySetting(category=HarmCategory.HARM_CATEGORY_HARASSMENT,         threshold=HarmBlockThreshold.BLOCK_NONE),
    SafetySetting(category=HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,  threshold=HarmBlockThreshold.BLOCK_NONE),
]

_model = GenerativeModel(
    model_name=settings.VERTEX_MODEL,
    system_instruction=SYSTEM_PROMPT,
)

# No intentes acceder a atributos de GEN_CFG aquí (pueden no existir).
GEN_CFG_DESC = f"{GEN_MIME}; max_tokens={GEN_MAX_TOKENS}; temp={GEN_TEMP}"

def _safe_extract_text(resp) -> str:
    """Extrae texto sin lanzar, probando varias rutas."""
    # 1) Intento directo
    try:
        t = getattr(resp, "text", None)
        if t:
            return t.strip()
    except Exception:
        pass
    # 2) candidates -> content.parts[*].text
    try:
        chunks = []
        for cand in getattr(resp, "candidates", []) or []:
            content = getattr(cand, "content", None)
            parts = getattr(content, "parts", None) if content else None
            if parts:
                for p in parts:
                    txt = getattr(p, "text", None)
                    if txt:
                        chunks.append(txt)
        if chunks:
            return "".join(chunks).strip()
    except Exception:
        pass
    return ""

def gen_native(user_prompt: str) -> str:
    """Wrapper con config robusta; evita respuestas sin texto."""
    # Nota: algunos despliegues aceptan thinking_config; si no, ignorará el kwarg silenciosamente.
    kwargs = dict(
        generation_config=GEN_CFG,
        safety_settings=SAFETY,
    )
    try:
        kwargs["thinking_config"] = {"include_thoughts": False, "max_output_tokens": 0}
    except Exception:
        pass

    resp = _model.generate_content([user_prompt], **kwargs)
    return _safe_extract_text(resp)
