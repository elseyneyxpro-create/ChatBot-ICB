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

    result = supabase.table("tema").select("id_tema, tema, descripcion").execute()
    _temas_cache = {row["tema"]: row["id_tema"] for row in result.data} if result.data else {}
    descripcion_por_id = {row["id_tema"]: row.get("descripcion") or "" for row in (result.data or [])}

    temas_sin_desc = [tid for tid, desc in descripcion_por_id.items() if not desc]
    first_chunk: dict[str, str] = {}
    if temas_sin_desc:
        # Filtrar en Supabase — solo traer chunks de los temas que no tienen descripción
        contenido_result = (
            supabase.table("contenido_tema")
            .select("id_tema, texto")
            .in_("id_tema", temas_sin_desc)
            .execute()
        )
        if contenido_result.data:
            for row in contenido_result.data:
                tid = row["id_tema"]
                if tid not in first_chunk:
                    first_chunk[tid] = row["texto"]  # texto completo para mejor embedding

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
    logger.info(
        f"Classifier: cache recargado ({len(_temas_cache)} temas, "
        f"{con_desc} con descripción, {len(first_chunk)} enriquecidos con chunk)"
    )
    return _temas_cache


def _score_all(query_text: str) -> tuple[str | None, float]:
    """Embedea query_text y retorna (mejor_tema, mejor_score)."""
    q_vec = np.array(embeddings.embed_query(query_text))
    q_norm = np.linalg.norm(q_vec)
    if q_norm == 0:
        return None, 0.0
    best_tema, best_score = None, 0.0
    for tema, t_vec in _temas_embeddings.items():
        t_arr = np.array(t_vec)
        score = float(np.dot(q_vec, t_arr) / (q_norm * np.linalg.norm(t_arr)))
        logger.debug(f"Classifier: tema='{tema}' score={score:.3f}")
        if score > best_score:
            best_score = score
            best_tema = tema
    return best_tema, best_score


def _classify_by_similarity(question: str, temas_map: dict[str, str], last_tema: str = "") -> str | None:
    if not _temas_embeddings:
        logger.warning("Classifier: _temas_embeddings vacío, no se puede clasificar")
        return None

    THRESHOLD = 0.47
    BORDERLINE_LOW = 0.38  # zona donde el hint de last_tema puede ayudar

    # Paso 1: embedear la pregunta sola
    best_tema, best_score = _score_all(question)
    logger.info(f"Classifier paso1: mejor='{best_tema}' score={best_score:.3f} (threshold={THRESHOLD})")

    if best_score >= THRESHOLD:
        return best_tema

    # Paso 2: si estamos en zona borderline, re-embedear con hint
    # El hint puede ser: last_tema (sesión previa) o el propio best_tema (autoconfirmación cuando hay imagen)
    hint = last_tema or best_tema or ""
    if best_score >= BORDERLINE_LOW and hint:
        hint_query = f"{question} (contexto: el tema es {hint})"
        hint_tema, hint_score = _score_all(hint_query)
        logger.info(
            f"Classifier paso2 (hint='{hint}'): mejor='{hint_tema}' score={hint_score:.3f}"
        )
        if hint_score >= THRESHOLD:
            logger.info(f"Classifier: hint elevó score suficiente → tema='{hint_tema}'")
            return hint_tema

    logger.info(f"Classifier: score insuficiente ({best_score:.3f}) → sin tema")
    return None


def classify_and_retrieve(question: str, uid: str | None = None, last_tema: str = "") -> dict:
    t0 = time.time()

    temas_map = _get_temas_cached()
    tema = _classify_by_similarity(question, temas_map, last_tema=last_tema)
    logger.info(f"Classifier: clasificacion={tema} ({time.time()-t0:.2f}s)")

    # Fuente A: chunks del tema + formato de respuesta
    exact_chunks: list[str] = []
    formato: str | None = None
    if tema:
        try:
            id_tema = temas_map[tema]
            content = supabase.table("contenido_tema").select("texto, formato").eq("id_tema", id_tema).limit(8).execute()
            if content.data:
                exact_chunks = [row["texto"] for row in content.data]
                formato = next((row.get("formato") for row in content.data if row.get("formato")), None)
        except Exception as e:
            logger.warning(f"Error contenido exacto: {e}")

    # Fuente B: búsqueda semántica
    semantic_chunks: list[str] = []
    if tema:
        search_vector = embeddings.embed_query(question)
        try:
            result = supabase.rpc("match_contenido", {
                "query_embedding": search_vector,
                "match_threshold": 0.7,
                "match_count": 3,
            }).execute()
            if result.data:
                semantic_chunks = [item["texto"] for item in result.data]
                for item in result.data:
                    logger.debug(
                        f"Semántico: tema='{item.get('tema')}' "
                        f"similarity={item.get('similarity', 0):.3f} "
                        f"texto='{item['texto'][:60]}'"
                    )
        except Exception as e:
            logger.warning(f"Semántico falló: {e}")

    # Videos — query directo usando temas_map (ya tiene el id_tema)
    videos: list[dict] = []
    contenido_video: str = ""
    if tema:
        try:
            id_tema = temas_map.get(tema)
            if id_tema:
                vr = supabase.table("videos").select("url, categoria, contenido_video").eq("id_tema", id_tema).execute()
                if vr.data:
                    videos = [
                        {
                            "url": item["url"],
                            "categoria": item.get("categoria") or "",
                            "contenido_video": item.get("contenido_video") or "",
                            "tema": tema,
                        }
                        for item in vr.data
                    ]
                    contenido_video = "\n\n".join(
                        v["contenido_video"] for v in videos if v["contenido_video"]
                    )
                    # Log detallado por categoría
                    from collections import Counter
                    cat_count = Counter(v["categoria"].lower().strip() for v in videos)
                    cat_summary = " | ".join(f"{cat}={n}" for cat, n in sorted(cat_count.items()))
                    con_guion = sum(1 for v in videos if v["contenido_video"])
                    logger.info(
                        f"Classifier VIDEOS para tema='{tema}': "
                        f"{len(videos)} total → [{cat_summary}] | {con_guion}/{len(videos)} con guión"
                    )
                    # Log cada video individualmente (URL + categoría + tiene guión?)
                    for i, v in enumerate(videos, 1):
                        tiene_guion = "✓ guión" if v["contenido_video"] else "✗ sin guión"
                        logger.info(
                            f"  Video {i}: cat='{v['categoria']}' | {tiene_guion} "
                            f"({len(v['contenido_video'])}c) | url={v['url']}"
                        )
                    # Advertir si faltan categorías clave para el reinforcer
                    for cat_clave in ["concepto", "v o f", "encuentre el error"]:
                        n = cat_count.get(cat_clave, 0)
                        if n == 0:
                            logger.warning(f"Classifier: ⚠ sin videos de categoría '{cat_clave}' para tema='{tema}'")
                        elif n > 1:
                            logger.warning(f"Classifier: {n} videos de categoría '{cat_clave}' para tema='{tema}' — reinforcer concatenará guiones")
            else:
                    logger.warning(f"Classifier: 0 videos en BD para tema='{tema}' (id_tema={id_tema})")
        except Exception as e:
            logger.warning(f"Error videos: {e}")

    # Combinar y deduplicar chunks
    seen: set[str] = set()
    all_chunks: list[str] = []
    for chunk in exact_chunks + semantic_chunks:
        if chunk not in seen:
            seen.add(chunk)
            all_chunks.append(chunk)

    rag_context = "\n\n".join(all_chunks)
    logger.info(
        f"Classifier: total={len(all_chunks)} chunks ({len(exact_chunks)} exactos + {len(semantic_chunks)} semánticos), "
        f"{len(rag_context)} chars | formato={'sí' if formato else 'no'} | tiempo={time.time()-t0:.2f}s"
    )
    if rag_context:
        logger.info(f"  RAG context preview (primeros 400c): {rag_context[:400]!r}")
    else:
        logger.warning(f"  RAG context VACÍO para tema='{tema}'")

    return {
        "rag_context": rag_context,
        "videos": videos,
        "tema": tema,
        "formato": formato,
        "contenido_video": contenido_video,
    }
