from pydantic import BaseModel, Field
from typing import Optional

class Ask(BaseModel):
    question: str = Field(..., description="Pregunta del usuario")
    session_id: Optional[str] = Field(None, description="UUID de sesión")
    uid: Optional[str] = Field(None, description="UID del usuario de Firebase")
    id_chat_nr: Optional[str] = Field(None, description="ID del chat activo en Firestore")
    total_hilos: Optional[int] = Field(0, description="Total de hilos del chat antes de este mensaje")
    image_base64: Optional[str] = Field(None, description="Imagen adjunta en base64 (JPEG/PNG)")
    display_name: Optional[str] = Field(None, description="Nombre del usuario (Firebase Auth)")
    email: Optional[str] = Field(None, description="Correo institucional del usuario")
    photo_url: Optional[str] = Field(None, description="URL de foto de perfil")
    context: Optional[str] = Field(None, description="Últimos intercambios del chat (memoria a corto plazo)")
    resumen_conversacion: Optional[str] = Field(None, description="Resumen acumulativo de toda la sesión")
