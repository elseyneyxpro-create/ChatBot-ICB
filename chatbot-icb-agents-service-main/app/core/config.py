from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4.1-mini"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # PostgreSQL + pgvector (reemplaza a Supabase)
    # Ej: postgresql://icb_user:clave@postgres:5432/icb_chatbot
    DATABASE_URL: str

    # MongoDB (reemplaza a Firestore)
    MONGO_URL: str = "mongodb://localhost:27017"
    MONGO_DB: str = "icb_chatbot"

    INTERNAL_SECRET: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
