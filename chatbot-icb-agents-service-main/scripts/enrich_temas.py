"""
Script que enriquece la tabla 'tema' en Supabase con descripciones semánticas ricas.
Corre UNA SOLA VEZ. Genera una descripción por tema usando GPT + contenido real del curso.

Uso:
    cd chatbot-icb-agents-service-main
    python scripts/enrich_temas.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

from openai import OpenAI
from app.core.supabase_client import supabase
from app.core.config import settings

client = OpenAI(api_key=settings.OPENAI_API_KEY)

PROMPT_SISTEMA = """Eres un experto en Cálculo 1. Se te dará un tema matemático y fragmentos del material del curso.
Genera una descripción semántica densa de 3-5 oraciones que capture:
- La definición central del tema
- Palabras clave y sinónimos que un alumno usaría al preguntar sobre esto
- Conceptos relacionados o aplicaciones típicas

La descripción será usada para clasificar preguntas de alumnos por similitud vectorial,
así que debe cubrir múltiples formas en que un alumno podría preguntar sobre el tema.
Responde SOLO con la descripción, sin títulos ni listas."""


def generar_descripcion(tema_nombre: str, chunks: list[str]) -> str:
    contenido = "\n\n".join(chunks[:3]) if chunks else "Sin contenido disponible."
    response = client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": PROMPT_SISTEMA},
            {"role": "user", "content": f"Tema: {tema_nombre}\n\nFragmentos del material:\n{contenido[:1500]}"},
        ],
        max_tokens=300,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


def main():
    print("Cargando temas desde Supabase...")
    temas_result = supabase.table("tema").select("id_tema, tema, descripcion").execute()
    temas = temas_result.data or []
    print(f"  {len(temas)} temas encontrados.")

    # Cargar todos los chunks de una vez
    print("Cargando contenido...")
    contenido_result = supabase.table("contenido_tema").select("id_tema, texto").execute()
    chunks_por_tema: dict[str, list[str]] = {}
    for row in (contenido_result.data or []):
        chunks_por_tema.setdefault(row["id_tema"], []).append(row["texto"])

    print("\nGenerando descripciones...\n")
    for tema in temas:
        id_tema = tema["id_tema"]
        nombre = tema["tema"]
        ya_tiene = tema.get("descripcion", "")

        if ya_tiene:
            print(f"  OK '{nombre}' ya tiene descripcion, saltando.")
            continue

        chunks = chunks_por_tema.get(id_tema, [])
        print(f"  Generando para '{nombre}' ({len(chunks)} chunks)...", end=" ", flush=True)

        try:
            descripcion = generar_descripcion(nombre, chunks)
            # Guardar en Supabase
            supabase.table("tema").update({"descripcion": descripcion}).eq("id_tema", id_tema).execute()
            print(f"OK")
            print(f"    -> {descripcion[:120]}...")
        except Exception as e:
            print(f"ERROR: {e}")

    print("\n¡Listo! Todas las descripciones generadas.")
    print("Reinicia el backend para que el clasificador use las nuevas descripciones.")


if __name__ == "__main__":
    main()
