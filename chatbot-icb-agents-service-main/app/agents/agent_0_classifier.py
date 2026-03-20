import logging
import time
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from app.core.config import settings
from app.core.supabase_client import supabase

logger = logging.getLogger("icb.ai")

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0)
embeddings = OpenAIEmbeddings(model=settings.OPENAI_EMBEDDING_MODEL, api_key=settings.OPENAI_API_KEY)

classify_prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un clasificador de preguntas de matemáticas para estudiantes de Cálculo 1.

Tu tarea es identificar a cuál de los siguientes temas pertenece la pregunta del alumno.
Si la pregunta es un saludo, algo off-topic, o no tiene relación con matemáticas, responde exactamente: null

Lista de temas válidos:
{temas}

Responde SOLO con el nombre exacto del tema (copiado de la lista) o con la palabra: null
No expliques nada más. Solo el tema o null."""),
    ("human", "Pregunta: {question}"),
])

classify_chain = classify_prompt | llm | StrOutputParser()

# ── Cache de temas (estáticos, se recargan cada 10 min) ───────────────────────
_temas_cache: dict[str, str] = {}   # tema → id_tema
_temas_cache_ts: float = 0.0
_TEMAS_TTL = 600


def _get_temas_cached() -> dict[str, str]:
    global _temas_cache, _temas_cache_ts
    if time.time() - _temas_cache_ts < _TEMAS_TTL and _temas_cache:
        return _temas_cache
    result = supabase.table("tema").select("id_tema, tema").execute()
    _temas_cache = {row["tema"]: row["id_tema"] for row in result.data} if result.data else {}
    _temas_cache_ts = time.time()
    logger.info(f"Agent0: cache de temas recargado ({len(_temas_cache)} temas)")
    return _temas_cache


def _get_weak_points_vector(uid: str) -> list[float] | None:
    try:
        from app.core.firestore_client import db
        doc = db.collection("Perfil_usuario").document(uid).get()
        if doc.exists:
            return doc.to_dict().get("weak_points_vector")
    except Exception as e:
        logger.warning(f"Error leyendo weak_points_vector uid={uid}: {e}")
    return None


def classify_and_retrieve(question: str, uid: str | None = None) -> dict:
    t0 = time.time()

    # 1. Temas desde cache (casi gratis)
    temas_map = _get_temas_cached()
    temas_str = "\n".join(f"- {t}" for t in temas_map.keys())

    # 2. Clasificar tema con LLM
    tema_raw = classify_chain.invoke({"temas": temas_str, "question": question}).strip()
    tema: str | None = None
    if tema_raw.lower() != "null" and tema_raw in temas_map:
        tema = tema_raw
    logger.info(f"Agent0: clasificacion={tema} ({time.time()-t0:.2f}s)")

    # 3. Fuente A: todos los chunks del tema exacto
    exact_chunks: list[str] = []
    if tema:
        try:
            id_tema = temas_map[tema]
            content = supabase.table("contenido_tema").select("texto").eq("id_tema", id_tema).execute()
            exact_chunks = [row["texto"] for row in content.data] if content.data else []
            logger.info(f"Agent0: contenido exacto={len(exact_chunks)} chunks ({time.time()-t0:.2f}s)")
        except Exception as e:
            logger.warning(f"Error contenido exacto: {e}")

    # 4. Fuente B/C: búsqueda semántica
    semantic_chunks: list[str] = []
    if tema:
        wp_vector = _get_weak_points_vector(uid) if uid else None
        if wp_vector:
            try:
                result = supabase.rpc("match_contenido", {
                    "query_embedding": wp_vector,
                    "match_threshold": 0.5,
                    "match_count": 5,
                }).execute()
                semantic_chunks = [item["texto"] for item in result.data] if result.data else []
                logger.info(f"Agent0: semantico (wp_vector)={len(semantic_chunks)} ({time.time()-t0:.2f}s)")
            except Exception as e:
                logger.warning(f"Semantico con wp_vector fallo: {e}")
        else:
            try:
                q_vector = embeddings.embed_query(question)
                result = supabase.rpc("match_contenido", {
                    "query_embedding": q_vector,
                    "match_threshold": 0.7,
                    "match_count": 3,
                }).execute()
                semantic_chunks = [item["texto"] for item in result.data] if result.data else []
                logger.info(f"Agent0: semantico (pregunta)={len(semantic_chunks)} ({time.time()-t0:.2f}s)")
            except Exception as e:
                logger.warning(f"Semantico por pregunta fallo: {e}")

    # 5. Videos
    videos: list[str] = []
    if tema:
        try:
            vt = supabase.table("videos_tema").select("id_tema").ilike("tema", f"%{tema}%").execute()
            if vt.data:
                vr = supabase.table("videos").select("url").eq("id_tema", vt.data[0]["id_tema"]).execute()
                videos = [item["url"] for item in vr.data] if vr.data else []
        except Exception as e:
            logger.warning(f"Error videos: {e}")

    # 6. Combinar y deduplicar
    seen: set[str] = set()
    all_chunks: list[str] = []
    for chunk in exact_chunks + semantic_chunks:
        if chunk not in seen:
            seen.add(chunk)
            all_chunks.append(chunk)

    logger.info(f"Agent0: total={len(all_chunks)} chunks, videos={len(videos)}, tiempo={time.time()-t0:.2f}s")

    return {"rag_context": "\n\n".join(all_chunks), "videos": videos, "tema": tema}
