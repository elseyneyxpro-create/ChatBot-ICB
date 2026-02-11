# app/core/config.py
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # --- Selector de proveedor ---
    LLM_PROVIDER: str = "openai"        # "openai" | "vertex"

    # --- OpenAI (GPT) ---
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_API_KEY: Optional[str] = None

    # --- Vertex (por si vuelves) ---
    GCP_PROJECT: Optional[str] = None
    GCP_LOCATION: str = "us-central1"
    VERTEX_MODEL: str = "gemini-2.5-flash"
    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = None

    # --- Memoria ---
    MEM_TTL_SECONDS: int = 3600
    MEM_MAX_TURNS: int = 6

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
