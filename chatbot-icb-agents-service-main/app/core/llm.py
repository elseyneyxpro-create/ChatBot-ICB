# app/core/llm.py
from app.core.config import settings

if settings.LLM_PROVIDER.lower() == "openai":
    from app.core.lc_openai import llm  # noqa: F401
else:
    # Default: Vertex (tu archivo existente)
    from app.core.lc_vertex import llm  # noqa: F401
