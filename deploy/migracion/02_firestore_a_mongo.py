"""
Copia Firestore -> MongoDB, manteniendo los mismos ids de documento.

  Chat_nr, Hilo_chat, Contexto_chat, Perfil_usuario  -> misma colección, _id = id de Firestore
  Perfil_usuario/{uid}/nivel_usuario/{tema}           -> colección plana nivel_usuario { uid, tema, ... }

Uso (en tu PC o en la VM):
  pip install firebase-admin pymongo
  # Firebase Console -> Configuración del proyecto -> Cuentas de servicio -> Generar clave privada
  python 02_firestore_a_mongo.py --cred firebase-credentials.json \
      --mongo "mongodb://icb_user:CLAVE@localhost:27017/?authSource=admin" --db icb_chatbot

Es idempotente: se puede correr varias veces (reemplaza por _id).
"""
import argparse
from datetime import datetime

import firebase_admin
from firebase_admin import credentials, firestore
from pymongo import MongoClient, ReplaceOne, ASCENDING

COLECCIONES = ["Chat_nr", "Hilo_chat", "Contexto_chat", "Perfil_usuario"]


def limpiar(v):
    """Convierte tipos de Firestore a tipos que BSON entiende."""
    if isinstance(v, datetime):
        return datetime(v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond, tzinfo=v.tzinfo)
    if isinstance(v, dict):
        return {k: limpiar(x) for k, x in v.items()}
    if isinstance(v, list):
        return [limpiar(x) for x in v]
    if hasattr(v, "path") and hasattr(v, "id"):  # DocumentReference
        return v.path
    if hasattr(v, "latitude") and hasattr(v, "longitude"):  # GeoPoint
        return {"lat": v.latitude, "lng": v.longitude}
    return v


def volcar(ops, coleccion, mdb):
    if ops:
        r = mdb[coleccion].bulk_write(ops, ordered=False)
        print(f"   {coleccion}: {r.upserted_count} nuevos, {r.modified_count} actualizados")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cred", required=True, help="JSON de cuenta de servicio de Firebase")
    ap.add_argument("--mongo", required=True, help="URI de MongoDB")
    ap.add_argument("--db", default="icb_chatbot")
    args = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate(args.cred))
    fs = firestore.client()
    mdb = MongoClient(args.mongo)[args.db]

    for nombre in COLECCIONES:
        print(f"-> {nombre}")
        ops, total = [], 0
        for doc in fs.collection(nombre).stream():
            data = limpiar(doc.to_dict() or {})
            data["_id"] = doc.id
            ops.append(ReplaceOne({"_id": doc.id}, data, upsert=True))
            total += 1
            if len(ops) >= 500:
                volcar(ops, nombre, mdb); ops = []
        volcar(ops, nombre, mdb)
        print(f"   total leídos: {total}")

    print("-> nivel_usuario (subcolección de Perfil_usuario)")
    ops, total = [], 0
    for doc in fs.collection_group("nivel_usuario").stream():
        uid = doc.reference.parent.parent.id
        data = limpiar(doc.to_dict() or {})
        data["uid"] = uid
        data["tema"] = data.get("tema") or doc.id
        ops.append(ReplaceOne({"uid": uid, "tema": data["tema"]}, data, upsert=True))
        total += 1
        if len(ops) >= 500:
            volcar(ops, "nivel_usuario", mdb); ops = []
    volcar(ops, "nivel_usuario", mdb)
    print(f"   total leídos: {total}")

    mdb["Chat_nr"].create_index([("uid", ASCENDING), ("created_at", -1)])
    mdb["Hilo_chat"].create_index([("id_chat_nr", ASCENDING), ("created_at", ASCENDING)])
    mdb["nivel_usuario"].create_index([("uid", ASCENDING), ("tema", ASCENDING)], unique=True)
    mdb["nivel_usuario"].create_index([("tema", ASCENDING)])
    print("Listo.")


if __name__ == "__main__":
    main()
