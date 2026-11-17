"""
metricas.py
-----------
Arma el reporte de la nivelación a partir de lo que devuelve datos.py.
El mismo diccionario alimenta el panel de profesores (JSON) y el Excel.

Las reglas de las alertas están juntas al inicio para ajustarlas fácil.
"""
import datetime
from collections import defaultdict
from zoneinfo import ZoneInfo

from app.routers.reportes import datos

ZONA = ZoneInfo(datos.ZONA)

# ─── Reglas de alertas ────────────────────────────────────────────────────────
DIAS_INACTIVO = 7             # sin responder nada en este tiempo y sin terminar la nivelación
MIN_RESPUESTAS_ACIERTO = 20   # desde cuántas respuestas se considera el % de acierto
ACIERTO_BAJO = 50             # % bajo este valor → alerta (al azar se acierta ~25 %)
ATASCO_RESPUESTAS_NODO = 16   # respuestas en el nodo actual sin completarlo (≈ 4 fases intentadas)
ATASCO_RESPUESTAS_TEST = 20   # respuestas en el test del mundo actual sin aprobarlo (≈ 2 intentos)
MIN_RESPUESTAS_PREGUNTA = 5   # para listar una pregunta del banco en el ranking de dificultad
MIN_RESPUESTAS_NODO = 20      # para elegir el "nodo más difícil" del resumen

NIVELES = ["Principiante", "Intermedio", "Avanzado"]


def pct(parte: int, total: int) -> float | None:
    return round(parte * 100 / total, 1) if total else None


def _iso(v):
    return v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else v


def _local(v: datetime.datetime | None) -> datetime.datetime | None:
    return v.astimezone(ZONA) if v else None


def generar(carreras: list[str] | None = None) -> dict:
    ahora = datetime.datetime.now(ZONA)
    mundos, nodos = datos.mundos_y_nodos()
    nodos_por_mundo: dict[int, list[dict]] = defaultdict(list)
    for n in nodos:
        nodos_por_mundo[n["mundo_id"]].append(n)
    nodo_por_id = {n["id"]: n for n in nodos}
    total_nodos = len(nodos)
    total_mundos = len(mundos)

    filas = datos.alumnos(carreras)
    uids = [f["uid"] for f in filas if f["uid"]]
    prog_nodo: dict[str, dict[int, dict]] = defaultdict(dict)
    for r in datos.progreso_nodos(uids):
        prog_nodo[r["uid"]][r["nodo_id"]] = r
    prog_test: dict[str, dict[int, dict]] = defaultdict(dict)
    for r in datos.progreso_tests(uids):
        prog_test[r["uid"]][r["mundo_id"]] = r
    analisis = {r["uid"]: r for r in datos.ultimo_analisis(uids)}

    # Para las estadísticas por nodo
    nodo_agg = {n["id"]: {"intentaron": 0, "completaron": 0, "atascados": 0, "intentos": 0, "correctas": 0, "errores": 0,
                          "intentos_hasta_completar": []} for n in nodos}

    alumnos = []
    for f in filas:
        uid = f["uid"]
        pn = prog_nodo.get(uid, {})
        pt = prog_test.get(uid, {})

        # ── Avance por mundo y posición actual ───────────────────────────────
        por_mundo = []
        mundo_actual = nodo_actual = None
        atasco = None
        for m in mundos:
            ns = nodos_por_mundo[m["id"]]
            completados = sum(1 for n in ns if pn.get(n["id"], {}).get("fases", 0) >= datos.FASES_POR_NODO)
            t = pt.get(m["id"], {})
            test_fase = t.get("fase", 0)
            completo = test_fase >= datos.FASE_TEST_COMPLETO
            por_mundo.append({
                "mundo_id": m["id"], "nodos_completados": completados, "total_nodos": len(ns),
                "test_fase": test_fase, "mejor_puntaje": t.get("mejor_puntaje", 0), "completado": completo,
            })
            if uid and mundo_actual is None and not completo:
                mundo_actual = m
                pendiente = next((n for n in ns if pn.get(n["id"], {}).get("fases", 0) < datos.FASES_POR_NODO), None)
                if pendiente:
                    nodo_actual = pendiente["titulo"]
                    resp = pn.get(pendiente["id"], {}).get("intentos", 0)
                    if resp >= ATASCO_RESPUESTAS_NODO:
                        atasco = (f"Atascado en el nodo «{pendiente['titulo']}» ({resp} respuestas sin completarlo)",
                                  pendiente["id"])
                else:
                    nodo_actual = "Test del mundo"
                    resp = t.get("intentos", 0)
                    if resp >= ATASCO_RESPUESTAS_TEST:
                        atasco = (f"Le cuesta el test de «{m['titulo']}» ({resp} respuestas sin aprobarlo)", None)

        for nid, r in pn.items():
            a = nodo_agg.get(nid)
            if not a:
                continue
            a["intentaron"] += 1
            a["intentos"] += r["intentos"]
            a["correctas"] += r["correctas"]
            a["errores"] += r.get("errores", 0)
            if r["fases"] >= datos.FASES_POR_NODO:
                a["completaron"] += 1
                a["intentos_hasta_completar"].append(r["intentos"])
        if atasco and atasco[1] in nodo_agg:
            nodo_agg[atasco[1]]["atascados"] += 1

        mundos_ok = f["mundos_completados"]
        completa = bool(uid) and total_mundos > 0 and mundos_ok >= total_mundos
        estado = "Sin ingresar" if not uid else ("Completada" if completa else "En curso")
        unidades = total_nodos + total_mundos
        progreso = round((f["nodos_completados"] + mundos_ok) * 100 / unidades, 1) if unidades else 0.0

        ultima = _local(f["ultima_actividad"])
        dias_sin = max(0, (ahora - ultima).days) if ultima else None
        an = analisis.get(uid)

        # ── Alertas ───────────────────────────────────────────────────────────
        alertas = []
        acierto = pct(f["correctas"], f["intentos"])
        if not uid:
            alertas.append("No ha entrado a la nivelación")
        elif not completa:
            if f["intentos"] == 0:
                alertas.append("Entró pero no ha respondido preguntas")
            elif dias_sin is not None and dias_sin >= DIAS_INACTIVO:
                alertas.append(f"Sin actividad hace {dias_sin} días")
        if f["intentos"] >= MIN_RESPUESTAS_ACIERTO and acierto is not None and acierto < ACIERTO_BAJO:
            alertas.append(f"Acierto bajo: {acierto:.0f} % en {f['intentos']} respuestas")
        if atasco and not completa:
            alertas.append(atasco[0])
        if an and an.get("nivel_sugerido") in NIVELES and f["nivel_actual"] in NIVELES \
                and NIVELES.index(an["nivel_sugerido"]) < NIVELES.index(f["nivel_actual"]):
            alertas.append(f"El analista sugiere bajar a {an['nivel_sugerido']}")

        alumnos.append({
            "uid": uid,
            "correo": f["correo"],
            "nombre": f["nombre"],
            "carrera": f["carrera"],
            "estado": estado,
            "nivel_inicial": f["nivel_inicial"],
            "nivel_actual": f["nivel_actual"],
            "xp": f["xp"],
            "progreso": progreso,
            "nodos_completados": f["nodos_completados"],
            "total_nodos": total_nodos,
            "mundos_completados": mundos_ok,
            "total_mundos": total_mundos,
            "mundo_actual": mundo_actual["titulo"] if mundo_actual else None,
            "nodo_actual": nodo_actual,
            "respuestas": f["intentos"],
            "correctas": f["correctas"],
            # Errores totales (incluye los reintentos de la cola de las fases)
            "errores": f["errores"],
            "reintentos": f["reintentos"],
            "acierto": acierto,
            "acierto_fases": pct(f["correctas_fase"], f["intentos_fase"]),
            "acierto_tests": pct(f["correctas_test"], f["intentos_test"]),
            "acierto_entrenar": pct(f["correctas_entrenar"], f["intentos_entrenar"]),
            "respuestas_entrenar": f["intentos_entrenar"],
            "primer_ingreso": _iso(_local(f["primer_ingreso"])),
            "ultima_actividad": _iso(ultima),
            "dias_sin_actividad": dias_sin,
            "dias_activos": f["dias_activos"],
            "minutos": f["minutos"],
            "chatbot_habilitado": f["chatbot_habilitado"],
            "por_mundo": por_mundo,
            "analisis": {
                "nivel_sugerido": an["nivel_sugerido"],
                "fortalezas": an["fortalezas"] or [],
                "debilidades": an["debilidades"] or [],
                "recomendacion": an["recomendacion"],
                "resumen": an["resumen"],
                "fecha": _iso(_local(an["created_at"])),
            } if an else None,
            "alertas": alertas,
        })

    # ── Por nodo ─────────────────────────────────────────────────────────────
    mundo_por_id = {m["id"]: m for m in mundos}
    por_nodo = []
    for n in nodos:
        a = nodo_agg[n["id"]]
        hasta = a["intentos_hasta_completar"]
        por_nodo.append({
            "nodo_id": n["id"], "mundo_id": n["mundo_id"], "mundo": mundo_por_id[n["mundo_id"]]["titulo"], "mundo_orden": mundo_por_id[n["mundo_id"]]["orden"],
            "orden": n["orden"], "nodo": n["titulo"],
            "alumnos_intentaron": a["intentaron"], "alumnos_completaron": a["completaron"],
            "alumnos_atascados": a["atascados"],
            "respuestas": a["intentos"], "correctas": a["correctas"], "acierto": pct(a["correctas"], a["intentos"]),
            "errores": a["errores"],
            "respuestas_para_completar": round(sum(hasta) / len(hasta), 1) if hasta else None,
        })

    # ── Por mundo ────────────────────────────────────────────────────────────
    por_mundo = []
    for i, m in enumerate(mundos):
        ns = [x for x in por_nodo if x["mundo_id"] == m["id"]]
        ids_nodos = {x["nodo_id"] for x in ns}
        estados = [al["por_mundo"][i] for al in alumnos if al["uid"]]
        llegaron = sum(1 for al in alumnos if al["uid"] and (
            al["por_mundo"][i]["test_fase"] > 0 or bool(prog_nodo.get(al["uid"], {}).keys() & ids_nodos)))
        tests = [prog_test[al["uid"]][m["id"]] for al in alumnos if al["uid"] and m["id"] in prog_test.get(al["uid"], {})]
        resp = sum(x["respuestas"] for x in ns)
        corr = sum(x["correctas"] for x in ns)
        por_mundo.append({
            "mundo_id": m["id"], "orden": m["orden"], "mundo": m["titulo"], "total_nodos": len(ns),
            "alumnos_llegaron": llegaron,
            "alumnos_completaron": sum(1 for e in estados if e["completado"]),
            "acierto_fases": pct(corr, resp),
            "rindieron_test": sum(1 for t in tests if t["intentos"] > 0 or t["fase"] > 0),
            "acierto_test": pct(sum(t["correctas"] for t in tests), sum(t["intentos"] for t in tests)),
            "mejor_puntaje_promedio": round(sum(t["mejor_puntaje"] for t in tests) / len(tests), 1) if tests else None,
        })

    # ── Preguntas del banco ──────────────────────────────────────────────────
    preguntas = []
    for p in datos.preguntas_banco(uids):
        if p["respuestas"] < MIN_RESPUESTAS_PREGUNTA:
            continue
        preguntas.append({
            "id": p["id"], "enunciado": p["enunciado"], "correcta": p["correcta"], "dificultad": p["dificultad"],
            "mundo": p["mundo"] or "General", "nodo": p["nodo"] or "General", "uso": p["contextos"],
            "respuestas": p["respuestas"], "acierto": pct(p["correctas"], p["respuestas"]),
            "errores": p["errores"], "alumnos_repiten": p["alumnos_repiten"],
            "error_comun": p["error_comun"], "veces_error_comun": p["veces_error_comun"],
        })
    preguntas.sort(key=lambda p: (p["acierto"], -p["respuestas"]))

    # ── Resumen general y por carrera ────────────────────────────────────────
    def resumir(grupo: list[dict]) -> dict:
        activos = [a for a in grupo if a["uid"]]
        con_resp = [a for a in grupo if a["respuestas"] > 0]
        return {
            "alumnos": len(grupo),
            "ingresaron": len(activos),
            "completaron": sum(1 for a in grupo if a["estado"] == "Completada"),
            "en_curso": sum(1 for a in grupo if a["estado"] == "En curso"),
            "sin_ingresar": sum(1 for a in grupo if a["estado"] == "Sin ingresar"),
            "progreso_promedio": round(sum(a["progreso"] for a in activos) / len(activos), 1) if activos else 0.0,
            "acierto": pct(sum(a["correctas"] for a in con_resp), sum(a["respuestas"] for a in con_resp)),
            "con_alertas": sum(1 for a in grupo if a["alertas"]),
            "activos_ultima_semana": sum(1 for a in grupo if a["dias_sin_actividad"] is not None
                                         and a["dias_sin_actividad"] < DIAS_INACTIVO),
            "horas_totales": round(sum(a["minutos"] for a in grupo) / 60, 1),
        }

    por_carrera = []
    for sec in sorted({a["carrera"] or "Sin carrera" for a in alumnos}):
        grupo = [a for a in alumnos if (a["carrera"] or "Sin carrera") == sec]
        por_carrera.append({"carrera": sec, **resumir(grupo)})

    resumen = resumir(alumnos)
    candidatos = [n for n in por_nodo if n["respuestas"] >= MIN_RESPUESTAS_NODO and n["acierto"] is not None]
    dificil = min(candidatos, key=lambda n: n["acierto"]) if candidatos else None
    resumen["nodo_mas_dificil"] = {"mundo": dificil["mundo"], "nodo": dificil["nodo"], "acierto": dificil["acierto"]} if dificil else None

    return {
        "generado": ahora.isoformat(),
        "carreras": carreras,
        "carreras_disponibles": datos.carreras_disponibles(),
        "reglas": {
            "fases_por_nodo": datos.FASES_POR_NODO,
            "dias_inactivo": DIAS_INACTIVO,
            "acierto_bajo": ACIERTO_BAJO,
            "min_respuestas_acierto": MIN_RESPUESTAS_ACIERTO,
            "atasco_respuestas_nodo": ATASCO_RESPUESTAS_NODO,
            "atasco_respuestas_test": ATASCO_RESPUESTAS_TEST,
            "min_respuestas_pregunta": MIN_RESPUESTAS_PREGUNTA,
        },
        "mundos": [{"id": m["id"], "orden": m["orden"], "titulo": m["titulo"],
                    "total_nodos": len(nodos_por_mundo[m["id"]])} for m in mundos],
        "resumen": resumen,
        "por_carrera": por_carrera,
        "por_mundo": por_mundo,
        "por_nodo": por_nodo,
        "preguntas": preguntas,
        "alumnos": alumnos,
    }


def detalle(uid: str) -> dict:
    d = datos.detalle_alumno(uid)
    for r in d["ultimas_respuestas"]:
        r["created_at"] = _iso(_local(r["created_at"]))
    for a in d["analisis"]:
        a["created_at"] = _iso(_local(a["created_at"]))
    for p in d["preguntas_dificiles"]:
        p["ultima_vez"] = _iso(_local(p["ultima_vez"]))
        p.pop("clave", None)
    return d
