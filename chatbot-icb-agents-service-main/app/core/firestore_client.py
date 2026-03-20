import firebase_admin
from firebase_admin import credentials, firestore
from pathlib import Path
import os

# Inicializar Firebase Admin solo una vez
if not firebase_admin._apps:
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
    if cred_path and Path(cred_path).exists():
        cred = credentials.Certificate(cred_path)
    else:
        # En desarrollo usamos las credenciales de la aplicación por defecto
        cred = credentials.ApplicationDefault()

    firebase_admin.initialize_app(cred)

db = firestore.client()
