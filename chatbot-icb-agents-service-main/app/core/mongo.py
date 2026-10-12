"""
Cliente MongoDB (reemplaza a firestore_client.py).

Colecciones (mismos nombres que en Firestore para facilitar la migración):
  - Chat_nr          (_id = id del chat, string)
  - Hilo_chat        (_id = id del hilo, string)
  - Contexto_chat    (_id = id del chat)
  - Perfil_usuario   (_id = uid)
  - nivel_usuario    (antes subcolección Perfil_usuario/{uid}/nivel_usuario/{tema};
                      ahora colección plana con campos uid + tema, índice único (uid, tema))
"""
from bson import ObjectId
from pymongo import MongoClient, ASCENDING

from app.core.config import settings

client = MongoClient(settings.MONGO_URL, tz_aware=False)
db = client[settings.MONGO_DB]

# Índices (idempotente: si ya existen no hace nada)
try:
    db["Chat_nr"].create_index([("uid", ASCENDING), ("created_at", ASCENDING)])
    db["Hilo_chat"].create_index([("id_chat_nr", ASCENDING), ("created_at", ASCENDING)])
    db["nivel_usuario"].create_index([("uid", ASCENDING), ("tema", ASCENDING)], unique=True)
    db["nivel_usuario"].create_index([("tema", ASCENDING)])
except Exception:  # Mongo puede no estar arriba al importar; los índices se crean en el próximo arranque
    pass


def new_id() -> str:
    """Genera un id string (equivalente a los ids autogenerados de Firestore)."""
    return str(ObjectId())
