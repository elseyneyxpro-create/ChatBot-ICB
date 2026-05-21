from fastapi import APIRouter
from app.routers.ai.router import router as ai_router

api_router = APIRouter()
api_router.include_router(ai_router)
