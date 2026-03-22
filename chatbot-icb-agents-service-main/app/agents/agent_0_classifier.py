import logging
import time
import numpy as np
from langchain_openai import OpenAIEmbeddings
from app.core.config import settings
from app.core.supabase_client import supabase

logger = logging.getLogger("icb.ai")

embeddings = OpenAIEmbeddings(model=settings.OPENAI_EMBEDDING_MODEL, api_key=settings.OPENAI_API_KEY)

# ── Cache de temas + embeddings pre-computados ────────────────────────────────
_temas_cache: dict[str, str] = {}          # tema → id_tema
_temas_embeddings: dict[str, list] = {}    # tema → vector
_temas_cache_ts: float = 0.0
_TEMAS_TTL = 600  # 10 min


def _get_temas_cached() -> dict[str, str]:
    global _temas_cache, _temas_embeddings, _temas_cache_ts
    if time.time() - _temas_cache_ts < _TEMAS_TTL and _temas_cache:
        return _temas_cache

    # 1. Obtener todos los temas (con descripcion enriquecida si existe)
    result = supabase.table("tema").select("id_tema, tema, descripcion").execute()
    _temas_cache = {row["tema"]: row["id_tema"] for row in result.data} if result.data else {}
    descripcion_por_id = {row["id_tema"]: row.get("descripcion") or "" for row in (result.data or [])}

    # 2. Si faltan descripciones, usar primer chunk de contenido como fallback
    temas_sin_desc = [tid for tid, desc in descripcion_por_id.items() if not desc]
    first_chunk: dict[str, str] = {}
    if temas_sin_desc:
        contenido_result = supabase.table("contenido_tema").select("id_tema, texto").execute()
        if contenido_result.data:
            for row in contenido_result.data:
                tid = row["id_tema"]
                if tid in temas_sin_desc and tid not in first_chunk:
                    first_chunk[tid] = row["texto"][:300]

    # 3. Construir textos a embeder: descripcion rica > primer chunk > solo nombre
    temas_list = list(_temas_cache.keys())
    embed_texts = []
    for tema_name in temas_list:
        id_tema = _temas_cache[tema_name]
        desc = descripcion_por_id.get(id_tema) or first_chunk.get(id_tema) or ""
        embed_texts.append(f"{tema_name}. {desc}" if desc else tema_name)

    if embed_texts:
        vecs = embeddings.embed_documents(embed_texts)
        _temas_embeddings = {t: v for t, v in zip(temas_list, vecs)}

    _temas_cache_ts = time.time()
    con_desc = sum(1 for d in descripcion_por_id.values() if d)
    logger.info(f"Agent0: cache recargado ({len(_temas_cache)} temas, {con_desc} con descripción enriquecida)")
    return _temas_cache


def _classify_by_similarity(question: str, temas_map: dict[str, str]) -> str | None:
    """
    Clasifica el tema por similitud coseno entre el embedding de la pregunta
    y los embeddings pre-computados de los temas. Sin llamada a LLM.
    """
    if not _temas_embeddings:
        return None

    q_vec = np.array(embeddings.embed_query(question))
    q_norm = np.linalg.norm(q_vec)
    if q_norm == 0:
        return None

    best_tema = None
    best_score = 0.0

    for tema, t_vec in _temas_embeddings.items():
        t_arr = np.array(t_vec)
        score = float(np.dot(q_vec, t_arr) / (q_norm * np.linalg.norm(t_arr)))
        if score > best_score:
            best_score = score
            best_tema = tema

    # Umbral: si la similitud es baja, probablemente es off-topic
    THRESHOLD = 0.35
    logger.info(f"Agent0: mejor tema='{best_tema}' score={best_score:.3f}")
    return best_tema if best_score >= THRESHOLD else None


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

    # 1. Temas desde cache
    temas_map = _get_temas_cached()

    # 2. Clasificar por similitud de embeddings (sin LLM)
    tema = _classify_by_similarity(question, temas_map)
    logger.info(f"Agent0: clasificacion={tema} ({time.time()-t0:.2f}s)")

    # 3. Fuente A: chunks del tema exacto (limitados a 8 para evitar contextos gigantes)
    exact_chunks: list[str] = []
    if tema:
        try:
            id_tema = temas_map[tema]
            content = supabase.table("contenido_tema").select("texto").eq("id_tema", id_tema).limit(8).execute()
            exact_chunks = [row["texto"] for row in content.data] if content.data else []
        except Exception as e:
            logger.warning(f"Error contenido exacto: {e}")

    # 4. Búsqueda semántica con weak_points_vector o fallback por pregunta
    semantic_chunks: list[str] = []
    if tema:
        wp_vector = _get_weak_points_vector(uid) if uid else None
        search_vector = wp_vector if wp_vector else embeddings.embed_query(question)
        threshold = 0.5 if wp_vector else 0.7
        count = 5 if wp_vector else 3
        try:
            result = supabase.rpc("match_contenido", {
                "query_embedding": search_vector,
                "match_threshold": threshold,
                "match_count": count,
            }).execute()
            semantic_chunks = [item["texto"] for item in result.data] if result.data else []
        except Exception as e:
            logger.warning(f"Semantico fallo: {e}")

    # 5. Videos — matching bidireccional + fallback por palabras de la pregunta
    videos: list[str] = []
    if tema:
        try:
            all_vt = supabase.table("videos_tema").select("id_tema, tema").execute()
            matching_id = None
            tema_lower = tema.lower()

            # Paso 1: coincidencia bidireccional con el tema clasificado
            for row in (all_vt.data or []):
                vt_tema = row["tema"].lower()
                if vt_tema in tema_lower or tema_lower in vt_tema:
                    matching_id = row["id_tema"]
                    break

            # Paso 2: fallback — buscar por palabras clave de la pregunta original
            if not matching_id:
                keywords = [w for w in question.lower().split() if len(w) > 4]
                for row in (all_vt.data or []):
                    vt_tema = row["tema"].lower()
                    if any(kw in vt_tema for kw in keywords):
                        matching_id = row["id_tema"]
                        logger.info(f"Agent0: video match por keyword en '{row['tema']}'")
                        break

            if matching_id:
                vr = supabase.table("videos").select("url, categoria").eq("id_tema", matching_id).execute()
                videos = [{"url": item["url"], "categoria": item.get("categoria") or ""} for item in vr.data] if vr.data else []
            logger.info(f"Agent0: videos={len(videos)} para tema='{tema}' (matched_id={matching_id}) — con categoria")
        except Exception as e:
            logger.warning(f"Error videos: {e}")

    # 6. Combinar y deduplicar
    seen: set[str] = set()
    all_chunks: list[str] = []
    for chunk in exact_chunks + semantic_chunks:
        if chunk not in seen:
            seen.add(chunk)
            all_chunks.append(chunk)

    rag_context = "\n\n".join(all_chunks)
    logger.info(f"Agent0: total={len(all_chunks)} chunks, {len(rag_context)} chars, tiempo={time.time()-t0:.2f}s")
    return {"rag_context": rag_context, "videos": videos, "tema": tema}
