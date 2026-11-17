"""
datos.py
--------
Única capa que sabe de dónde vienen los datos de la nivelación (misma idea que
fuente_datos.py de los reportes del chat). Todo se agrega en SQL para que el
reporte siga siendo rápido aunque haya cientos de alumnos y miles de respuestas.

Tablas que lee (todas de PostgreSQL):
  whitelist_alumnos            → quiénes son alumnos (codigo_asignatura) y su carrera (carrera)
  niv_banco.mundo / nodo / pregunta
  niv_progreso.estudiante      → nivel, XP (existe desde que el alumno entra por primera vez)
  niv_progreso.progreso_nodo   → fases aprobadas por nodo
  niv_progreso.progreso_test   → avance del test de cada mundo (fase 2 = mundo completado)
  niv_progreso.intento         → cada respuesta (fase, test o "entrenar" = ejercicios del tutor)
  niv_progreso.analisis        → conclusiones del agente analista

Si el sistema ELO cambia estas tablas, este es el único archivo que hay que ajustar.
"""
from app.core.postgres import fetch_all

# En whitelist_alumnos.codigo_asignatura los alumnos llevan su sección (o nada, si aún
# no tienen) y el equipo lleva alguno de estos valores (se comparan sin mayúsculas/minúsculas).
# Durante la nivelación los alumnos todavía no tienen sección: se agrupan por carrera
# (whitelist_alumnos.carrera, la cargan los profesores junto con el nivel inicial).
CODIGOS_STAFF = ("staff", "crack")

# Fases que debe aprobar un alumno para completar un nodo (igual que REGLAS.FASES_POR_NODO del backend).
FASES_POR_NODO = 4
# progreso_test.fase = 2 → test del mundo aprobado (mundo completado).
FASE_TEST_COMPLETO = 2

ZONA = "America/Santiago"

_ES_ALUMNO = "lower(trim(coalesce(w.codigo_asignatura, ''))) <> ALL(%(staff)s)"


def _params(carreras: list[str] | None) -> dict:
    return {"staff": list(CODIGOS_STAFF), "carreras": carreras, "fases": FASES_POR_NODO,
            "completo": FASE_TEST_COMPLETO, "zona": ZONA}


def _filtro_carrera(carreras: list[str] | None) -> str:
    return "AND w.carrera = ANY(%(carreras)s)" if carreras else ""


# CTE con un alumno por correo (la whitelist puede tener el mismo correo repetido).
def _cte_alumnos(carreras: list[str] | None) -> str:
    return f"""
    alumnos AS (
      SELECT DISTINCT ON (lower(w.email))
             lower(w.email) AS correo, w.nombre_completo, w.carrera,
             w.nivel_inicial, w.chatbot_habilitado
        FROM whitelist_alumnos w
       WHERE w.activo AND {_ES_ALUMNO} {_filtro_carrera(carreras)}
       ORDER BY lower(w.email), w.created_at
    )"""


def carreras_disponibles() -> list[str]:
    rows = fetch_all(
        f"""SELECT DISTINCT w.carrera FROM whitelist_alumnos w
             WHERE w.activo AND w.carrera IS NOT NULL AND w.carrera <> '' AND {_ES_ALUMNO}
             ORDER BY 1""",
        _params(None),
    )
    return [r["carrera"] for r in rows]


def mundos_y_nodos() -> tuple[list[dict], list[dict]]:
    mundos = fetch_all(
        "SELECT id, orden, titulo FROM niv_banco.mundo WHERE activo ORDER BY orden"
    )
    nodos = fetch_all(
        """SELECT n.id, n.mundo_id, n.orden, n.titulo
             FROM niv_banco.nodo n JOIN niv_banco.mundo m ON m.id = n.mundo_id
            WHERE m.activo ORDER BY m.orden, n.orden"""
    )
    return mundos, nodos


def alumnos(carreras: list[str] | None) -> list[dict]:
    """Un registro por alumno, con o sin actividad en la nivelación."""
    return fetch_all(
        f"""
        WITH {_cte_alumnos(carreras)},
        uids AS (
          SELECT e.uid FROM alumnos a JOIN niv_progreso.estudiante e ON lower(e.correo) = a.correo
        ),
        tiempos AS (
          SELECT i.uid,
                 i.created_at,
                 extract(epoch FROM i.created_at - lag(i.created_at) OVER (PARTITION BY i.uid ORDER BY i.created_at)) AS gap
            FROM niv_progreso.intento i WHERE i.uid IN (SELECT uid FROM uids)
        ),
        stats AS (
          -- Respuestas y acierto: solo la PRIMERA respuesta a cada pregunta (n_intento = 1). En las
          -- fases de nodo una pregunta fallada vuelve al final de la cola; esos reintentos se cuentan
          -- aparte (reintentos) y entran en los errores, pero no inflan ni bajan el porcentaje de acierto.
          SELECT i.uid,
                 count(*) FILTER (WHERE coalesce(i.n_intento, 1) = 1)::int                    AS intentos,
                 count(*) FILTER (WHERE coalesce(i.n_intento, 1) = 1 AND i.es_correcto)::int  AS correctas,
                 count(*) FILTER (WHERE NOT i.es_correcto)::int                               AS errores,
                 count(*) FILTER (WHERE coalesce(i.n_intento, 1) > 1)::int                    AS reintentos,
                 count(*) FILTER (WHERE i.contexto = 'fase' AND coalesce(i.n_intento, 1) = 1)::int AS intentos_fase,
                 count(*) FILTER (WHERE i.contexto = 'fase' AND coalesce(i.n_intento, 1) = 1 AND i.es_correcto)::int AS correctas_fase,
                 count(*) FILTER (WHERE i.contexto = 'test')::int                     AS intentos_test,
                 count(*) FILTER (WHERE i.contexto = 'test' AND i.es_correcto)::int   AS correctas_test,
                 count(*) FILTER (WHERE i.contexto = 'entrenar')::int                 AS intentos_entrenar,
                 count(*) FILTER (WHERE i.contexto = 'entrenar' AND i.es_correcto)::int AS correctas_entrenar,
                 min(i.created_at) AS primera_actividad,
                 max(i.created_at) AS ultima_actividad,
                 count(DISTINCT (i.created_at AT TIME ZONE %(zona)s)::date)::int     AS dias_activos
            FROM niv_progreso.intento i WHERE i.uid IN (SELECT uid FROM uids) GROUP BY i.uid
        ),
        tiempo AS (
          -- Tiempo aproximado: hueco entre respuestas consecutivas, con tope de 5 min
          -- (si pasó más, se asume que el alumno se fue) + 1 min por la primera respuesta.
          SELECT uid, round(sum(CASE WHEN gap IS NULL THEN 60 ELSE least(gap, 300) END) / 60.0)::int AS minutos
            FROM tiempos GROUP BY uid
        ),
        nodos AS (
          SELECT pn.uid, count(*) FILTER (WHERE pn.fases >= %(fases)s)::int AS nodos_completados
            FROM niv_progreso.progreso_nodo pn GROUP BY pn.uid
        ),
        tests AS (
          SELECT pt.uid, count(*) FILTER (WHERE pt.fase >= %(completo)s)::int AS mundos_completados
            FROM niv_progreso.progreso_test pt GROUP BY pt.uid
        )
        SELECT a.correo, a.nombre_completo AS nombre, a.carrera, a.nivel_inicial, a.chatbot_habilitado,
               e.uid, e.nivel AS nivel_actual, coalesce(e.xp, 0) AS xp, e.created_at AS primer_ingreso,
               coalesce(s.intentos, 0) AS intentos, coalesce(s.correctas, 0) AS correctas,
               coalesce(s.errores, 0) AS errores, coalesce(s.reintentos, 0) AS reintentos,
               coalesce(s.intentos_fase, 0) AS intentos_fase, coalesce(s.correctas_fase, 0) AS correctas_fase,
               coalesce(s.intentos_test, 0) AS intentos_test, coalesce(s.correctas_test, 0) AS correctas_test,
               coalesce(s.intentos_entrenar, 0) AS intentos_entrenar,
               coalesce(s.correctas_entrenar, 0) AS correctas_entrenar,
               s.primera_actividad, s.ultima_actividad, coalesce(s.dias_activos, 0) AS dias_activos,
               coalesce(t.minutos, 0) AS minutos,
               coalesce(n.nodos_completados, 0) AS nodos_completados,
               coalesce(ts.mundos_completados, 0) AS mundos_completados
          FROM alumnos a
          LEFT JOIN niv_progreso.estudiante e ON lower(e.correo) = a.correo
          LEFT JOIN stats  s  ON s.uid  = e.uid
          LEFT JOIN tiempo t  ON t.uid  = e.uid
          LEFT JOIN nodos  n  ON n.uid  = e.uid
          LEFT JOIN tests  ts ON ts.uid = e.uid
         ORDER BY a.carrera NULLS LAST, a.nombre_completo
        """,
        _params(carreras),
    )


def progreso_nodos(uids: list[str]) -> list[dict]:
    """Fases aprobadas y respuestas por alumno y nodo (solo nodos donde hubo algo)."""
    if not uids:
        return []
    return fetch_all(
        """
        WITH resp AS (
          -- intentos/correctas = primera respuesta a cada pregunta; errores = todos (incluye reintentos)
          SELECT uid, nodo_id,
                 count(*) FILTER (WHERE coalesce(n_intento, 1) = 1)::int AS intentos,
                 count(*) FILTER (WHERE coalesce(n_intento, 1) = 1 AND es_correcto)::int AS correctas,
                 count(*) FILTER (WHERE NOT es_correcto)::int AS errores
            FROM niv_progreso.intento
           WHERE contexto = 'fase' AND nodo_id IS NOT NULL AND uid = ANY(%(uids)s)
           GROUP BY uid, nodo_id
        )
        SELECT coalesce(pn.uid, r.uid) AS uid, coalesce(pn.nodo_id, r.nodo_id) AS nodo_id,
               coalesce(pn.fases, 0) AS fases, coalesce(r.intentos, 0) AS intentos,
               coalesce(r.correctas, 0) AS correctas, coalesce(r.errores, 0) AS errores, pn.updated_at
          FROM (SELECT * FROM niv_progreso.progreso_nodo WHERE uid = ANY(%(uids)s)) pn
          FULL JOIN resp r ON r.uid = pn.uid AND r.nodo_id = pn.nodo_id
        """,
        {"uids": uids},
    )


def progreso_tests(uids: list[str]) -> list[dict]:
    if not uids:
        return []
    return fetch_all(
        """
        WITH resp AS (
          SELECT uid, mundo_id, count(*)::int AS intentos, count(*) FILTER (WHERE es_correcto)::int AS correctas
            FROM niv_progreso.intento
           WHERE contexto = 'test' AND mundo_id IS NOT NULL AND uid = ANY(%(uids)s)
           GROUP BY uid, mundo_id
        )
        SELECT coalesce(pt.uid, r.uid) AS uid, coalesce(pt.mundo_id, r.mundo_id) AS mundo_id,
               coalesce(pt.fase, 0) AS fase, coalesce(pt.mejor_puntaje, 0) AS mejor_puntaje,
               coalesce(r.intentos, 0) AS intentos, coalesce(r.correctas, 0) AS correctas
          FROM (SELECT * FROM niv_progreso.progreso_test WHERE uid = ANY(%(uids)s)) pt
          FULL JOIN resp r ON r.uid = pt.uid AND r.mundo_id = pt.mundo_id
        """,
        {"uids": uids},
    )


def ultimo_analisis(uids: list[str]) -> list[dict]:
    if not uids:
        return []
    return fetch_all(
        """SELECT DISTINCT ON (uid) uid, nivel_sugerido, fortalezas, debilidades, recomendacion, resumen, created_at
             FROM niv_progreso.analisis WHERE uid = ANY(%(uids)s)
            ORDER BY uid, created_at DESC""",
        {"uids": uids},
    )


def preguntas_banco(uids: list[str]) -> list[dict]:
    """Preguntas del banco que respondieron estos alumnos: % de acierto (primera respuesta), errores
    totales (con reintentos), cuántos alumnos la fallaron 2 veces o más y el error más común."""
    if not uids:
        return []
    return fetch_all(
        """
        WITH r AS (
          SELECT i.pregunta_id, i.uid, i.respuesta, i.es_correcto, i.contexto, i.nodo_id, i.mundo_id,
                 coalesce(i.n_intento, 1) AS n_intento
            FROM niv_progreso.intento i
           WHERE i.origen = 'banco' AND i.pregunta_id IS NOT NULL AND i.uid = ANY(%(uids)s)
        ),
        agg AS (
          SELECT pregunta_id,
                 count(*) FILTER (WHERE n_intento = 1)::int AS respuestas,
                 count(*) FILTER (WHERE n_intento = 1 AND es_correcto)::int AS correctas,
                 count(*) FILTER (WHERE NOT es_correcto)::int AS errores,
                 string_agg(DISTINCT contexto, ', ') AS contextos
            FROM r GROUP BY pregunta_id
        ),
        repiten AS (
          -- Alumnos que la fallaron 2 veces o más (en la cola de una fase o en fases distintas)
          SELECT pregunta_id, count(*)::int AS alumnos_repiten
            FROM (SELECT pregunta_id, uid FROM r WHERE NOT es_correcto
                   GROUP BY pregunta_id, uid HAVING count(*) >= 2) x
           GROUP BY pregunta_id
        ),
        errores AS (
          SELECT DISTINCT ON (pregunta_id) pregunta_id, respuesta AS error_comun, count(*)::int AS veces_error_comun
            FROM r WHERE NOT es_correcto AND respuesta IS NOT NULL
           GROUP BY pregunta_id, respuesta
           ORDER BY pregunta_id, count(*) DESC
        )
        SELECT p.id, p.enunciado, p.correcta, p.dificultad, p.tipo,
               m.titulo AS mundo, n.titulo AS nodo,
               a.respuestas, a.correctas, a.errores, coalesce(rp.alumnos_repiten, 0) AS alumnos_repiten,
               a.contextos, e.error_comun, coalesce(e.veces_error_comun, 0) AS veces_error_comun
          FROM agg a
          JOIN niv_banco.pregunta p ON p.id = a.pregunta_id
          LEFT JOIN niv_banco.mundo m ON m.id = p.mundo_id
          LEFT JOIN niv_banco.nodo  n ON n.id = p.nodo_id
          LEFT JOIN errores e ON e.pregunta_id = a.pregunta_id
          LEFT JOIN repiten rp ON rp.pregunta_id = a.pregunta_id
        """,
        {"uids": uids},
    )


def detalle_alumno(uid: str) -> dict:
    """Todo lo de un alumno para la ficha del panel."""
    ultimos = fetch_all(
        """SELECT i.created_at, i.contexto, i.origen, i.dificultad, i.enunciado, i.respuesta, i.correcta,
                  i.es_correcto, coalesce(i.n_intento, 1) AS n_intento, m.titulo AS mundo, n.titulo AS nodo
             FROM niv_progreso.intento i
             LEFT JOIN niv_banco.mundo m ON m.id = i.mundo_id
             LEFT JOIN niv_banco.nodo  n ON n.id = i.nodo_id
            WHERE i.uid = %(uid)s ORDER BY i.created_at DESC LIMIT 30""",
        {"uid": uid},
    )
    analisis = fetch_all(
        """SELECT nivel_sugerido, fortalezas, debilidades, recomendacion, resumen, n_intentos, created_at
             FROM niv_progreso.analisis WHERE uid = %(uid)s ORDER BY created_at DESC LIMIT 5""",
        {"uid": uid},
    )
    # Preguntas donde más se equivoca: errores por pregunta (contando los reintentos de la cola)
    dificiles = fetch_all(
        """SELECT coalesce(i.pregunta_id::text, i.enunciado) AS clave,
                  max(i.enunciado) AS enunciado, max(i.correcta) AS correcta, max(i.contexto) AS contexto,
                  max(m.titulo) AS mundo, max(n.titulo) AS nodo,
                  count(*) FILTER (WHERE NOT i.es_correcto)::int AS errores,
                  count(*)::int AS respuestas,
                  bool_or(i.es_correcto) AS la_logro,
                  max(i.created_at) AS ultima_vez
             FROM niv_progreso.intento i
             LEFT JOIN niv_banco.mundo m ON m.id = i.mundo_id
             LEFT JOIN niv_banco.nodo  n ON n.id = i.nodo_id
            WHERE i.uid = %(uid)s AND i.origen = 'banco'
            GROUP BY 1
           HAVING count(*) FILTER (WHERE NOT i.es_correcto) > 0
            ORDER BY errores DESC, ultima_vez DESC
            LIMIT 15""",
        {"uid": uid},
    )
    return {"ultimas_respuestas": ultimos, "analisis": analisis, "preguntas_dificiles": dificiles}


def correo_de_uid(uid: str) -> str | None:
    rows = fetch_all("SELECT lower(correo) AS correo FROM niv_progreso.estudiante WHERE uid = %(uid)s", {"uid": uid})
    return rows[0]["correo"] if rows else None
