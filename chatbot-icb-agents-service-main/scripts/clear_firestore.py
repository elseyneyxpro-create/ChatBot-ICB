"""
Script para limpiar Leaderboard y Perfil_usuario de Firestore.
Ejecutar desde la carpeta chatbot-icb-agents-service-main:
    python scripts/clear_firestore.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.core.firestore_client import db


def delete_collection(coll_ref, batch_size: int = 100) -> int:
    deleted = 0
    docs = list(coll_ref.limit(batch_size).stream())
    for doc in docs:
        # Eliminar subcollecciones recursivamente
        for sub in doc.reference.collections():
            delete_collection(sub)
        doc.reference.delete()
        deleted += 1
    # Si había más docs, continuar
    if deleted >= batch_size:
        deleted += delete_collection(coll_ref, batch_size)
    return deleted


def main():
    print("[!] Limpiando Leaderboard y Perfil_usuario de Firestore...")

    n_lb = delete_collection(db.collection("Leaderboard"))
    print(f"[OK] Leaderboard: {n_lb} documentos eliminados")

    n_pu = delete_collection(db.collection("Perfil_usuario"))
    print(f"[OK] Perfil_usuario: {n_pu} documentos eliminados (incluye subcollecciones)")

    print("\n[OK] Limpieza completa. El perfil nuevo se construira con el sistema de ejercicios.")


if __name__ == "__main__":
    main()
