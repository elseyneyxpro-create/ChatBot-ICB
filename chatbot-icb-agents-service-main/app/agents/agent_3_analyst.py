import logging
import time
from datetime import datetime
from google.cloud import firestore as fs_module
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser, StrOutputParser
from app.core.config import settings

logger = logging.getLogger("icb.ai")

llm = ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0)
embeddings = OpenAIEmbeddings(model=settings.OPENAI_EMBEDDING_MODEL, api_key=settings.OPENAI_API_KEY)

# ── Resumen de conversación ───────────────────────────────────────────────────
_summary_prompt = ChatPromptTemplate.from_messages([
    ("system", """Eres un asistente que mantiene un resumen acumulativo de una sesión de tutoría de Cálculo 1.
Se te dará el resumen actual y el último intercambio. Actualiza el resumen incorporando el nuevo intercambio.

REGLAS:
- Máximo 6 oraciones.
- Menciona los temas matemáticos tratados (derivadas, límites, integrales, etc.).
- Destaca si el alumno cometió errores conceptuales importantes.
- Escribe en español, en tercera persona ("El alumno preguntó...", "Se discutió...").
- Si el resumen actual está vacío, crea uno nuevo basado solo en el intercambio.
- NO incluyas la respuesta completa del tutor, solo el tema y punto clave."""),
    ("human", """Resumen actual:
{resumen_actual}

Último intercambio:
Alumno: {question}
Tutor: {answer}

Escribe el resumen actualizado:"""),
])

_summary_chain = _summary_prompt | llm | StrOutputParser()


def update_conversation_summary(id_chat_nr: str, resumen_actual: str, question: str, answer: str) -> None:
    """
    Genera un resumen actualizado de la conversación y lo persiste en Chat_nr/{id_chat_nr}.
    Corre en background — no bloquea la respuesta al usuario.
    """
    try:
        from app.core.firestore_client import db
        nuevo_resumen = _summary_chain.invoke({
            "resumen_actual": resumen_actual or "Sin resumen previo.",
            "question": question[:600],
            "answer": answer[:800],
        })
        db.collection("Chat_nr").document(id_chat_nr).update({
            "resumen_conversacion": nuevo_resumen,
            "fecha_resumen": datetime.utcnow(),
        })
        logger.info(f"Resumen actualizado para chat={id_chat_nr}")
    except Exception as e:
        logger.warning(f"update_conversation_summary falló: {e}")

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


def update_leaderboard(uid: str, display_name: str | None, email: str | None, photo_url: str | None) -> None:
    """
    Incrementa total_matematicas en Leaderboard/{uid} cada vez que el alumno
    hace una pregunta matemática (tema != None). Crea el doc si no existe.
    """
    try:
        from app.core.firestore_client import db
        ref = db.collection("Leaderboard").document(uid)
        ref.set({
            "uid": uid,
            "display_name": display_name or (email.split("@")[0] if email else "Estudiante"),
            "email": email,
            "photo_url": photo_url,
            "total_matematicas": fs_module.Increment(1),
            "fecha_actualizacion": datetime.utcnow(),
        }, merge=True)
        logger.info(f"Leaderboard: uid={uid} +1 total_matematicas")
    except Exception as e:
        logger.warning(f"update_leaderboard falló uid={uid}: {e}")


def increment_hilo_counters(uid: str) -> int:
    """
    Incrementa atómicamente total_hilos_global y hilos_desde_snapshot en
    Perfil_usuario/{uid}. Retorna el nuevo valor de hilos_desde_snapshot.
    Esto permite disparar el análisis de perfil con umbrales globales
    (todos los chats del usuario), no solo por chat individual.
    """
    try:
        from app.core.firestore_client import db
        ref = db.collection("Perfil_usuario").document(uid)
        ref.set({
            "total_hilos_global": fs_module.Increment(1),
            "hilos_desde_snapshot": fs_module.Increment(1),
        }, merge=True)
        doc = ref.get()
        value = doc.to_dict().get("hilos_desde_snapshot", 1) if doc.exists else 1
        logger.info(f"Agent3 counters: uid={uid} hilos_desde_snapshot={value}")
        return int(value)
    except Exception as e:
        logger.warning(f"increment_hilo_counters falló uid={uid}: {e}")
        return 1


def get_latest_weak_points(uid: str) -> str:
    """
    Lee el campo weak_points_text pre-computado en Perfil_usuario/{uid}.
    Una sola lectura de documento (mucho más rápida que consultar snapshots).
    El campo es actualizado por generate_snapshots() cada 5 o 25 hilos.
    """
    try:
        from app.core.firestore_client import db
        doc = db.collection("Perfil_usuario").document(uid).get()
        if doc.exists:
            return doc.to_dict().get("weak_points_text", "")
        return ""
    except Exception as e:
        logger.warning(f"get_latest_weak_points falló: {e}")
        return ""


def save_reinforcement_to_firestore(id_chat_nr: str, reinforcement: dict, videos: list = None) -> None:
    """
    Guarda el reinforcement generado en background en Chat_nr/{id_chat_nr}.
    El frontend lo lee mediante polling después de recibir la respuesta principal.
    """
    try:
        from app.core.firestore_client import db
        db.collection("Chat_nr").document(id_chat_nr).update({
            "last_reinforcement": {
                "nivel": reinforcement.get("nivel", "amarillo"),
                "texto": reinforcement.get("texto", ""),
                "ejercicios": reinforcement.get("ejercicios", []),
                "videos": videos or [],
                "saved_at": time.time(),
            }
        })
        logger.info(f"Reinforcement guardado en Chat_nr/{id_chat_nr}")
    except Exception as e:
        logger.warning(f"save_reinforcement_to_firestore falló: {e}")


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

        # 9. Resetear hilos_desde_snapshot para el próximo ciclo
        try:
            db.collection("Perfil_usuario").document(uid).update({
                "hilos_desde_snapshot": 0,
                "fecha_ultimo_snapshot": datetime.utcnow(),
            })
            logger.info(f"Agent3: hilos_desde_snapshot reseteado → uid={uid}")
        except Exception as e:
            logger.warning(f"Error reseteando hilos_desde_snapshot uid={uid}: {e}")

    except Exception as e:
        logger.exception(f"generate_snapshots falló para uid={uid}: {e}")
