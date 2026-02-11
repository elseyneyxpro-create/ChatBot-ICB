from pydantic import BaseModel, Field
from typing import Optional

class Ask(BaseModel):
    question: str = Field(..., description="Pregunta del usuario")
    subject: Optional[str] = Field(None, description="Cálculo | Álgebra | Física")
    top_k: Optional[int] = Field(4, description="Reservado para RAG")
    session_id: Optional[str] = Field(None, description="UUID de sesión para memoria")
