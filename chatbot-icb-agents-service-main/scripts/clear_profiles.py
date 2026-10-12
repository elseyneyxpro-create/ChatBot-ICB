"""
Limpia el leaderboard y los perfiles de usuario en MongoDB
(antes limpiaba Leaderboard y Perfil_usuario en Firestore).
Ejecutar desde la carpeta chatbot-icb-agents-service-main:
    python scripts/clear_profiles.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.core.mongo import db


def main():
    print("[!] Limpiando Leaderboard, Perfil_usuario y nivel_usuario en MongoDB...")

    n_lb = db["Leaderboard"].delete_many({}).deleted_count
    print(f"[OK] Leaderboard: {n_lb} documentos eliminados")

    n_nv = db["nivel_usuario"].delete_many({}).deleted_count
    print(f"[OK] nivel_usuario: {n_nv} documentos eliminados")

    n_pu = db["Perfil_usuario"].delete_many({}).deleted_count
    print(f"[OK] Perfil_usuario: {n_pu} documentos eliminados")

    print("\n[OK] Limpieza completa. El perfil nuevo se construira con el sistema de ejercicios.")


if __name__ == "__main__":
    main()
