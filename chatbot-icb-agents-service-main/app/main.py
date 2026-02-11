from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.answer import router as answer_router
from app.core.config import settings
from dotenv import load_dotenv

load_dotenv() 

app = FastAPI(title="ICB AI Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

@app.get("/health")
def health():
    return {
        "ok": True,
        "project": settings.GCP_PROJECT,
        "location": settings.GCP_LOCATION,
        "model": settings.VERTEX_MODEL
    }

app.include_router(answer_router)
