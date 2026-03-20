import logging
from datetime import datetime
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from app.core.config import settings

logger = logging.getLogger("icb.ai")

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0)
embeddings = OpenAIEmbeddings(model=settings.OPENAI_EMBEDDING_MODEL, api_key=settings.OPENAI_API_KEY)

snapshot_prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un analista académico especializado en Cálculo 1. \
Analiza el historial de conversación de un alumno sobre el tema: {tema}.

━━━ CONTEXTO PREVIO DEL ALUMNO EN ESTE TEMA ━━━
{historial_previo}

━━━ TU TAREA ━━━
1. Identifica 2-4 puntos fuertes concretos sobre ESE TEMA.
2. Identifica 2-4 puntos débiles concretos sobre ESE TEMA.
3. Determina el nivel actual del alumno:
   - "bajo": comete errores conceptuales frecuentes, no domina lo básico.
   - "medio": entiende lo básico pero falla en aplicaciones o casos especiales.
   - "alto": domina el tema con solidez, puede aplicarlo correctamente.
4. Escribe un resumen MUY DETALLADO que capture:
   - Los errores CONCRETOS cometidos por el alumno (con sus propias palabras si es posible).
     Ej: "El alumno afirmó que el área del triángulo es la multiplicación de sus lados."
   - Si el alumno corrigió el error y cómo lo argumentó correctamente.
     Ej: "Tras la corrección, el alumno demostró entender base×altura/2 argumentando que es la mitad del rectángulo."
   - Errores nuevos que aparecieron en esta tanda de preguntas.
   - Evidencia explícita de avance o retroceso respecto al contexto previo.
   El resumen debe ser suficientemente rico para que un análisis futuro evalúe la evolución del alumno.

Responde SOLO con JSON válido:
{{
  "puntos_fuertes": ["punto 1", "punto 2"],
  "puntos_debiles": ["punto 1", "punto 2"],
  "nivel": "bajo" | "medio" | "alto",
  "resumen": "resumen muy detallado aquí"
}}"""),
    ("human", "Historial sobre el tema {tema}:\n{history}"),
])

snapshot_chain = snapshot_prompt | llm | JsonOutputParser()


def get_latest_weak_points(uid: str) -> str:
    """
    Lee los snapshots más recientes del alumno y retorna sus puntos débiles combinados.
    Se usa para alimentar al Agente 1 en cada consulta.
    """
    try:
        from app.core.firestore_client import db
        snaps = (
            db.collection("Perfil_usuario").document(uid)
            .collection("snapshots")
            .order_by("fecha", direction="DESCENDING")
            .limit(5)
            .stream()
        )
        weak_points = []
        seen_temas: set[str] = set()
        for snap in snaps:
            data = snap.to_dict()
            tema = data.get("tema", "")
            if tema not in seen_temas:
                seen_temas.add(tema)
                debiles = data.get("puntos_debiles", [])
                if debiles:
                    weak_points.append(f"[{tema}] " + "; ".join(debiles))
        return "\n".join(weak_points)
    except Exception as e:
        logger.warning(f"get_latest_weak_points falló: {e}")
        return ""


def _get_existing_nivel_tema(db, uid: str, tema: str) -> dict | None:
    """Lee el documento nivel_tema existente para un tema."""
    try:
        doc = (
            db.collection("Perfil_usuario").document(uid)
            .collection("nivel_tema").document(tema)
            .get()
        )
        if doc.exists:
            return doc.to_dict()
    except Exception as e:
        logger.warning(f"Error leyendo nivel_tema uid={uid}, tema={tema}: {e}")
    return None


def _update_weak_points_vector(db, uid: str) -> None:
    """
    Recomputa el vector de debilidades combinadas leyendo los snapshots más recientes
    y lo guarda en Perfil_usuario/{uid} para que el Agente 0 lo use sin llamar a OpenAI.
    """
    try:
        snaps = (
            db.collection("Perfil_usuario").document(uid)
            .collection("snapshots")
            .order_by("fecha", direction="DESCENDING")
            .limit(10)
            .stream()
        )
        all_debiles: list[str] = []
        seen_temas: set[str] = set()
        for snap in snaps:
            data = snap.to_dict()
            tema = data.get("tema", "")
            if tema not in seen_temas:
                seen_temas.add(tema)
                debiles = data.get("puntos_debiles", [])
                if debiles:
                    all_debiles.append(f"[{tema}] " + "; ".join(debiles))

        if not all_debiles:
            return

        weak_points_text = "\n".join(all_debiles)
        vector = embeddings.embed_query(weak_points_text)

        db.collection("Perfil_usuario").document(uid).set({
            "weak_points_text": weak_points_text,
            "weak_points_vector": vector,
            "fecha_vector": datetime.utcnow(),
        }, merge=True)

        logger.info(f"Agent3: weak_points_vector actualizado para uid={uid}")
    except Exception as e:
        logger.warning(f"Error actualizando weak_points_vector para uid={uid}: {e}")


def generate_snapshots(uid: str, id_chat_nr: str, full_reread: bool = False) -> None:
    """
    Agente 3: Genera snapshots de análisis por tema y actualiza nivel_tema en Firestore.

    - full_reread=False (cada 5 hilos): lee solo los últimos 5 hilos (incremental).
    - full_reread=True  (cada 25 hilos): lee todos los hilos del chat (re-análisis completo).

    Después de procesar todos los temas, recomputa y guarda el weak_points_vector.
    """
    try:
        from app.core.firestore_client import db

        # 1. Leer hilos según el modo
        base_query = (
            db.collection("Hilo_chat")
            .where("id_chat_nr", "==", id_chat_nr)
            .order_by("created_at", direction="DESCENDING")
        )

        if full_reread:
            hilos_raw = list(
                db.collection("Hilo_chat")
                .where("id_chat_nr", "==", id_chat_nr)
                .order_by("created_at", direction="ASCENDING")
                .stream()
            )
        else:
            # Últimos 5, luego revertir para orden cronológico
            hilos_raw = list(reversed(list(base_query.limit(5).stream())))

        modo = "COMPLETO" if full_reread else "INCREMENTAL"
        logger.info(f"Agent3 [{modo}]: {len(hilos_raw)} hilos para uid={uid}")

        # 2. Agrupar por tema (solo hilos con tema identificado)
        hilos_por_tema: dict[str, list[dict]] = {}
        for h in hilos_raw:
            data = h.to_dict()
            tema = data.get("tema")
            if tema:
                hilos_por_tema.setdefault(tema, []).append(data)

        if not hilos_por_tema:
            logger.info(f"Agent3: No hay hilos con tema para uid={uid}")
            return

        snapshots_ref = (
            db.collection("Perfil_usuario").document(uid).collection("snapshots")
        )

        for tema, hilos_tema in hilos_por_tema.items():
            # 3. Leer contexto previo del nivel_tema para análisis acumulativo
            existing = _get_existing_nivel_tema(db, uid, tema)
            historial_previo = "Sin análisis previo para este tema."
            num_preguntas_prev = 0

            if existing:
                num_preguntas_prev = existing.get("num_preguntas", 0)
                historial = existing.get("historial", [])
                if historial:
                    # Pasar los últimos 3 resúmenes como contexto al LLM
                    ultimos = historial[-3:]
                    historial_previo = "\n---\n".join([
                        f"[Análisis previo | Nivel: {h.get('nivel', '?')} | Preguntas acumuladas: {h.get('num_preguntas', '?')}]\n{h.get('resumen', '')}"
                        for h in ultimos
                    ])

            # 4. Construir texto del historial de hilos para el LLM
            history_text = ""
            for entry in hilos_tema:
                history_text += f"Alumno: {entry.get('input', '')}\n"
                history_text += f"Tutor: {entry.get('output', '')}\n\n"

            # 5. Generar análisis con LLM
            try:
                analysis = snapshot_chain.invoke({
                    "tema": tema,
                    "historial_previo": historial_previo,
                    "history": history_text,
                })
            except Exception as e:
                logger.warning(f"Agent3 LLM falló para tema={tema}: {e}")
                continue

            nivel = analysis.get("nivel", "bajo")
            if nivel not in ("bajo", "medio", "alto"):
                nivel = "bajo"
            resumen = analysis.get("resumen", "")

            # 6. Guardar en la subcolección snapshots (historial existente)
            snapshots_ref.add({
                "fecha": datetime.utcnow(),
                "tema": tema,
                "hilo_trigger": id_chat_nr,
                "puntos_fuertes": analysis.get("puntos_fuertes", []),
                "puntos_debiles": analysis.get("puntos_debiles", []),
                "nivel": nivel,
                "resumen": resumen,
            })

            # 7. Actualizar nivel_tema con historial acumulativo
            nueva_entrada = {
                "nivel": nivel,
                "num_preguntas": num_preguntas_prev + len(hilos_tema),
                "fecha": datetime.utcnow().isoformat(),
                "resumen": resumen,
            }

            nivel_tema_ref = (
                db.collection("Perfil_usuario").document(uid)
                .collection("nivel_tema").document(tema)
            )

            if existing:
                historial_actual = existing.get("historial", [])
                nivel_tema_ref.update({
                    "nivel": nivel,
                    "num_preguntas": nueva_entrada["num_preguntas"],
                    "fecha_actualizacion": datetime.utcnow(),
                    "historial": historial_actual + [nueva_entrada],
                })
            else:
                nivel_tema_ref.set({
                    "tema": tema,
                    "nivel": nivel,
                    "num_preguntas": len(hilos_tema),
                    "fecha_actualizacion": datetime.utcnow(),
                    "historial": [nueva_entrada],
                })

            logger.info(f"Agent3: nivel_tema actualizado → uid={uid}, tema={tema}, nivel={nivel}")

        # 8. Recomputar y guardar weak_points_vector (evita llamar a OpenAI en cada consulta)
        _update_weak_points_vector(db, uid)

    except Exception as e:
        logger.exception(f"generate_snapshots falló para uid={uid}: {e}")
