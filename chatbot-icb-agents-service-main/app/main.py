# app/main.py

# 1) Carga .env ANTES de importar tus módulos (obligatorio)
from pathlib import Path
from dotenv import load_dotenv

# Carga explícita del .env en la raíz del repo
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env", override=True)

# 2) Ahora sí, importa FastAPI y TUS módulos
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.answer import router as answer_router

# 3) Crea la app y configura CORS (luego afinamos orígenes)
app = FastAPI(title="ICB AI Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: cámbialo por ['http://localhost:4200','http://localhost:3000']
    allow_methods=["*"],
    allow_headers=["*"],
)

# 4) Healthcheck
@app.get("/health")
def health():
    return {
        "ok": True,
        "project": settings.GCP_PROJECT,
        "location": settings.GCP_LOCATION,
        "model": settings.VERTEX_MODEL,
    }

# 5) Routers
app.include_router(answer_router)
