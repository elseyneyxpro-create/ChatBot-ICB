from pydantic import BaseModel, Field
from typing import Optional, List


class Ask(BaseModel):
    question: str = Field(..., description="Pregunta del usuario")
    uid: Optional[str] = Field(None, description="UID del usuario de Firebase")
    id_chat_nr: Optional[str] = Field(None, description="ID del chat activo en Firestore")
    total_hilos: Optional[int] = Field(0, description="Total de hilos del chat antes de este mensaje")
    image_base64: Optional[str] = Field(None, description="Imagen adjunta en base64 (JPEG/PNG)")
    last_tema: Optional[str] = Field(None, description="Último tema clasificado en este chat (para hint del clasificador)")


class EvaluateConcepto(BaseModel):
    uid: Optional[str] = Field(None, description="UID del usuario de Firebase")
    tema: str = Field(..., description="Tema del ejercicio")
    enunciado: str = Field(..., description="Pregunta de concepto")
    respuesta_usuario: str = Field(..., description="Respuesta del alumno")
    id_chat_nr: Optional[str] = Field(None, description="ID del chat activo")


class EvaluateVof(BaseModel):
    uid: Optional[str] = Field(None, description="UID del usuario de Firebase")
    tema: str = Field(..., description="Tema del ejercicio")
    enunciado: str = Field(..., description="Afirmación verdadero/falso")
    respuesta_usuario: bool = Field(..., description="Lo que seleccionó el alumno")
    respuesta_correcta: bool = Field(..., description="La respuesta correcta")
    id_chat_nr: Optional[str] = Field(None, description="ID del chat activo")


class EvaluateError(BaseModel):
    uid: Optional[str] = Field(None, description="UID del usuario de Firebase")
    tema: str = Field(..., description="Tema del ejercicio")
    enunciado: str = Field(..., description="Instrucción del ejercicio")
    desarrollo: List[str] = Field(..., description="Pasos del desarrollo matemático")
    paso_error: int = Field(..., description="Número de paso incorrecto (1-indexado)")
    respuesta_usuario: int = Field(..., description="Paso que seleccionó el alumno (1-indexado)")
    id_chat_nr: Optional[str] = Field(None, description="ID del chat activo")


class SaveExerciseResult(BaseModel):
    uid: str = Field(..., description="UID del usuario de Firebase")
    tema: str = Field(..., description="Tema del ejercicio")
    tipo: str = Field(..., description="'concepto' | 'vof' | 'error'")
    es_correcto: bool = Field(..., description="Si el alumno respondió correctamente")
    enunciado: Optional[str] = Field(None, description="Texto del ejercicio (para registrar preguntas que causaron error)")
    id_chat_nr: Optional[str] = Field(None, description="ID del chat activo (para incrementar contadores en Chat_nr)")
