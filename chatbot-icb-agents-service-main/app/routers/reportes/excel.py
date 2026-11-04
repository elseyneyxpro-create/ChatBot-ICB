"""
excel.py
--------
Genera el Excel del reporte de la nivelación (mismo estilo que reporte_profesor.py
de los reportes del chat). Recibe el diccionario de metricas.generar().
"""
import datetime
import io
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ─── Estilos ──────────────────────────────────────────────────────────────────
AZUL_OSC = "1F4E79"
AZUL_MED = "2E75B6"
MORADO = "5B2C83"
VERDE = "1E8449"
ROJO = "922B21"
GRIS_CLAR = "F2F2F2"
BLANCO = "FFFFFF"
VERDE_CLARO = "E9F7EF"
AMARILLO_CLARO = "FEF9E7"
ROJO_CLARO = "FDEDEC"

FMT_PCT = '0.0"%"'
FMT_HRS = '0.0" hrs"'

_ILEGALES = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
_LADO = Side(style="thin", color="CCCCCC")
_BORDE = Border(left=_LADO, right=_LADO, top=_LADO, bottom=_LADO)


def _txt(v):
    """Valor seguro para Excel (sin caracteres de control; listas como texto)."""
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return _ILEGALES.sub("", "; ".join(str(x) for x in v))
    if isinstance(v, str):
        return _ILEGALES.sub("", v)
    return v


def _fecha(iso: str | None, con_hora=True) -> str:
    if not iso:
        return ""
    dt = datetime.datetime.fromisoformat(iso)
    return dt.strftime("%d/%m/%Y %H:%M" if con_hora else "%d/%m/%Y")


def _color_acierto(v) -> str | None:
    if v is None:
        return None
    return VERDE_CLARO if v >= 70 else AMARILLO_CLARO if v >= 50 else ROJO_CLARO


def _titulo(ws, texto: str, ncols: int, color=AZUL_OSC, sub: str | None = None):
    ws.sheet_view.showGridLines = False
    fin = get_column_letter(max(ncols, 1))
    ws.merge_cells(f"A1:{fin}1")
    ws["A1"] = texto
    ws["A1"].font = Font(color=BLANCO, bold=True, size=13)
    ws["A1"].fill = PatternFill("solid", fgColor=color)
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 32
    if sub:
        ws.merge_cells(f"A2:{fin}2")
        ws["A2"] = sub
        ws["A2"].font = Font(color=AZUL_MED, italic=True, size=10)
        ws["A2"].alignment = Alignment(horizontal="center", vertical="center")
    ws.append([])


def _encabezado(ws, headers: list[str], widths: list[int], color=AZUL_MED):
    ws.append(headers)
    for cell in ws[ws.max_row]:
        cell.fill = PatternFill("solid", fgColor=color)
        cell.font = Font(color=BLANCO, bold=True, size=11)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = _BORDE
    ws.row_dimensions[ws.max_row].height = 32
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _fila(ws, valores: list, formatos: dict[int, str] | None = None, color: str | None = None,
          colores: dict[int, str | None] | None = None):
    ws.append([_txt(v) for v in valores])
    row = ws[ws.max_row]
    alterna = ws.max_row % 2 == 0
    for i, cell in enumerate(row):
        cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        cell.border = _BORDE
        c = (colores or {}).get(i) or color or (GRIS_CLAR if alterna else None)
        if c:
            cell.fill = PatternFill("solid", fgColor=c)
    for i, fmt in (formatos or {}).items():
        row[i].number_format = fmt


def _dato(ws, etiqueta: str, valor, nota: str = ""):
    ws.append([etiqueta, _txt(valor), nota])
    row = ws[ws.max_row]
    row[0].font = Font(bold=True, size=11)
    row[1].font = Font(color=AZUL_MED, bold=True, size=12)
    row[1].alignment = Alignment(horizontal="center", vertical="center")
    row[2].font = Font(italic=True, color="666666", size=10)
    for cell in row:
        cell.border = _BORDE
    ws.row_dimensions[ws.max_row].height = 22


def _num(v):
    return "" if v is None else v


def generar_excel(r: dict) -> bytes:
    wb = Workbook()
    generado = _fecha(r["generado"])
    filtro = ", ".join(r["secciones"]) if r["secciones"] else "Todas las secciones"
    sub = f"Generado el {generado}  |  {filtro}  |  {len(r['alumnos'])} alumnos"
    res = r["resumen"]

    # ── 1. Resumen ───────────────────────────────────────────────────────────
    ws = wb.active
    ws.title = "Resumen"
    _titulo(ws, "REPORTE DE NIVELACIÓN — Axiomante", 10, sub=sub)
    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 34
    _dato(ws, "Alumnos", res["alumnos"])
    _dato(ws, "Entraron a la nivelación", res["ingresaron"],
          f"{round(res['ingresaron'] * 100 / res['alumnos'], 1) if res['alumnos'] else 0} % del total")
    _dato(ws, "Completaron la nivelación", res["completaron"], "aprobaron el test de todos los mundos")
    _dato(ws, "En curso", res["en_curso"])
    _dato(ws, "No han entrado", res["sin_ingresar"])
    ws.append([])
    _dato(ws, "Avance promedio", f"{res['progreso_promedio']} %", "de los que entraron (nodos + tests)")
    _dato(ws, "Acierto promedio", f"{res['acierto']} %" if res["acierto"] is not None else "Sin datos",
          "sobre todas las respuestas")
    _dato(ws, "Activos en los últimos 7 días", res["activos_ultima_semana"])
    _dato(ws, "Tiempo total aproximado", f"{res['horas_totales']} hrs", "ver hoja «Cómo leer»")
    ws.append([])
    _dato(ws, "Alumnos con alertas", res["con_alertas"], "ver hoja «Alertas»")
    if res.get("nodo_mas_dificil"):
        d = res["nodo_mas_dificil"]
        _dato(ws, "Nodo con menor acierto", f"{d['acierto']} %", f"{d['nodo']} ({d['mundo']})")

    ws.append([])
    ws.append([])
    _encabezado(ws, ["Sección", "Alumnos", "Entraron", "Completaron", "En curso", "No han entrado",
                     "Avance promedio", "Acierto", "Con alertas", "Activos 7 días"],
                [40, 18, 34, 14, 12, 16, 16, 12, 14, 14], AZUL_OSC)
    for s in r["por_seccion"]:
        _fila(ws, [s["seccion"], s["alumnos"], s["ingresaron"], s["completaron"], s["en_curso"], s["sin_ingresar"],
                   s["progreso_promedio"], _num(s["acierto"]), s["con_alertas"], s["activos_ultima_semana"]],
              formatos={6: FMT_PCT, 7: FMT_PCT})

    ws.append([])
    _encabezado(ws, ["Mundo", "Nodos", "Llegaron", "Completaron", "Acierto en fases", "Rindieron test",
                     "Acierto en test", "Mejor puntaje prom."],
                [40, 18, 34, 14, 16, 16, 16, 18], VERDE)
    for m in r["por_mundo"]:
        _fila(ws, [f"{m['orden']}. {m['mundo']}", m["total_nodos"], m["alumnos_llegaron"], m["alumnos_completaron"],
                   _num(m["acierto_fases"]), m["rindieron_test"], _num(m["acierto_test"]),
                   _num(m["mejor_puntaje_promedio"])],
              formatos={4: FMT_PCT, 6: FMT_PCT})

    # ── 2. Alumnos ───────────────────────────────────────────────────────────
    ws = wb.create_sheet("Alumnos")
    _titulo(ws, "AVANCE POR ALUMNO", 23, sub=sub)
    _encabezado(ws, [
        "N°", "Nombre", "Correo", "Sección", "Estado", "Nivel inicial", "Nivel actual", "Avance",
        "Nodos completados", "Mundos completados", "Mundo actual", "Nodo actual",
        "Respuestas", "% Acierto", "% Acierto fases", "% Acierto tests", "% Acierto entrenar",
        "Días con actividad", "Tiempo aprox.*", "Última actividad", "Días sin actividad",
        "Chatbot habilitado", "Alertas",
    ], [5, 30, 30, 16, 14, 14, 14, 10, 12, 12, 26, 28, 12, 11, 11, 11, 11, 11, 12, 18, 11, 11, 60])
    for i, a in enumerate(r["alumnos"], 1):
        _fila(ws, [
            i, a["nombre"], a["correo"], a["seccion"], a["estado"], a["nivel_inicial"], a["nivel_actual"] or "",
            a["progreso"], f"{a['nodos_completados']}/{a['total_nodos']}", f"{a['mundos_completados']}/{a['total_mundos']}",
            a["mundo_actual"] or "", a["nodo_actual"] or "",
            a["respuestas"], _num(a["acierto"]), _num(a["acierto_fases"]), _num(a["acierto_tests"]),
            _num(a["acierto_entrenar"]), a["dias_activos"], round(a["minutos"] / 60, 1),
            _fecha(a["ultima_actividad"]), _num(a["dias_sin_actividad"]),
            "Sí" if a["chatbot_habilitado"] else "No", a["alertas"],
        ], formatos={7: FMT_PCT, 13: FMT_PCT, 14: FMT_PCT, 15: FMT_PCT, 16: FMT_PCT, 18: FMT_HRS},
            colores={13: _color_acierto(a["acierto"]), 22: ROJO_CLARO if a["alertas"] else None})
    ws.freeze_panes = "C4"
    ws.auto_filter.ref = f"A3:{get_column_letter(23)}{ws.max_row}"
    nota = ws.cell(row=ws.max_row + 2, column=2,
                   value="(*) Suma de los tiempos entre respuestas seguidas, con un tope de 5 minutos entre una y otra. Es una aproximación.")
    nota.font = Font(italic=True, color="888888", size=9)

    # ── 3. Avance por mundo (matriz) ─────────────────────────────────────────
    ws = wb.create_sheet("Avance por mundo")
    headers = ["Nombre", "Sección"]
    widths = [30, 16]
    for m in r["mundos"]:
        headers += [f"{m['orden']}. {m['titulo']} · nodos", f"{m['orden']}. Test"]
        widths += [16, 16]
    _titulo(ws, "AVANCE POR MUNDO", len(headers), sub=sub)
    _encabezado(ws, headers, widths)
    for a in r["alumnos"]:
        valores, colores = [a["nombre"], a["seccion"]], {}
        for j, pm in enumerate(a["por_mundo"]):
            if not a["uid"]:
                valores += ["—", "—"]
                continue
            valores.append(f"{pm['nodos_completados']}/{pm['total_nodos']}")
            if pm["completado"]:
                test = f"Aprobado ({pm['mejor_puntaje']})"
                colores[3 + j * 2] = VERDE_CLARO
            elif pm["test_fase"] > 0:
                test = f"Fase {pm['test_fase']} de 2 ({pm['mejor_puntaje']})"
                colores[3 + j * 2] = AMARILLO_CLARO
            elif pm["mejor_puntaje"]:
                test = f"Reprobado ({pm['mejor_puntaje']})"
                colores[3 + j * 2] = ROJO_CLARO
            else:
                test = "—"
            if pm["nodos_completados"] == pm["total_nodos"] and pm["total_nodos"]:
                colores[2 + j * 2] = VERDE_CLARO
            valores.append(test)
        _fila(ws, valores, colores=colores)
    ws.freeze_panes = "C4"

    # ── 4. Nodos ─────────────────────────────────────────────────────────────
    ws = wb.create_sheet("Nodos")
    _titulo(ws, "RESULTADOS POR NODO", 9, sub=sub)
    _encabezado(ws, ["Mundo", "N°", "Nodo", "Alumnos que lo intentaron", "Lo completaron", "Atascados ahora",
                     "Respuestas", "% Acierto", "Respuestas promedio para completarlo"],
                [28, 5, 34, 14, 12, 12, 12, 11, 18])
    for n in r["por_nodo"]:
        _fila(ws, [n["mundo"], n["orden"], n["nodo"], n["alumnos_intentaron"], n["alumnos_completaron"],
                   n["alumnos_atascados"], n["respuestas"], _num(n["acierto"]), _num(n["respuestas_para_completar"])],
              formatos={7: FMT_PCT}, colores={7: _color_acierto(n["acierto"]),
                                              5: ROJO_CLARO if n["alumnos_atascados"] else None})
    ws.freeze_panes = "D4"

    # ── 5. Preguntas ─────────────────────────────────────────────────────────
    ws = wb.create_sheet("Preguntas")
    _titulo(ws, "PREGUNTAS DEL BANCO (de menor a mayor acierto)", 10, MORADO, sub=sub)
    _encabezado(ws, ["ID", "Enunciado", "Respuesta correcta", "Error más común", "Veces", "Respuestas",
                     "% Acierto", "Dificultad", "Mundo · Nodo", "Usada en"],
                [6, 60, 18, 18, 8, 11, 10, 13, 34, 14], MORADO)
    for p in r["preguntas"]:
        _fila(ws, [p["id"], p["enunciado"], p["correcta"], p["error_comun"] or "", p["veces_error_comun"],
                   p["respuestas"], p["acierto"], p["dificultad"], f"{p['mundo']} · {p['nodo']}", p["uso"]],
              formatos={6: FMT_PCT}, colores={6: _color_acierto(p["acierto"])})
    if not r["preguntas"]:
        ws.append([f"Todavía no hay preguntas con {r['reglas']['min_respuestas_pregunta']} respuestas o más."])
    ws.freeze_panes = "C4"

    # ── 6. Alertas ───────────────────────────────────────────────────────────
    ws = wb.create_sheet("Alertas")
    _titulo(ws, "ALUMNOS QUE REQUIEREN ATENCIÓN", 7, ROJO, sub=sub)
    _encabezado(ws, ["Nombre", "Sección", "Estado", "Avance", "% Acierto", "Última actividad", "Motivos"],
                [30, 16, 14, 10, 11, 18, 80], ROJO)
    con = [a for a in r["alumnos"] if a["alertas"]]
    for a in sorted(con, key=lambda a: (-len(a["alertas"]), a["seccion"] or "", a["nombre"])):
        _fila(ws, [a["nombre"], a["seccion"], a["estado"], a["progreso"], _num(a["acierto"]),
                   _fecha(a["ultima_actividad"]), "\n".join(a["alertas"])],
              formatos={3: FMT_PCT, 4: FMT_PCT}, color=ROJO_CLARO)
    if not con:
        ws.append(["No hay alumnos con alertas."])
    ws.freeze_panes = "B4"

    # ── 7. Análisis del agente ──────────────────────────────────────────────
    ws = wb.create_sheet("Análisis IA")
    _titulo(ws, "ÚLTIMO ANÁLISIS DEL AGENTE ANALISTA", 9, MORADO, sub=sub)
    _encabezado(ws, ["Nombre", "Sección", "Fecha", "Nivel actual", "Nivel sugerido", "Fortalezas", "Debilidades",
                     "Recomendación", "Resumen"],
                [30, 16, 18, 13, 13, 40, 40, 50, 60], MORADO)
    for a in r["alumnos"]:
        an = a["analisis"]
        if not an:
            continue
        _fila(ws, [a["nombre"], a["seccion"], _fecha(an["fecha"]), a["nivel_actual"] or "", an["nivel_sugerido"] or "",
                   "\n".join(an["fortalezas"]), "\n".join(an["debilidades"]), an["recomendacion"] or "",
                   an["resumen"] or ""])
    ws.freeze_panes = "B4"

    # ── 8. Cómo leer ─────────────────────────────────────────────────────────
    ws = wb.create_sheet("Cómo leer")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 100
    reg = r["reglas"]
    filas = [
        ("CÓMO LEER ESTE REPORTE", ""),
        ("", ""),
        ("Estado", "Sin ingresar: nunca abrió la nivelación. En curso: entró y no ha terminado. "
                   "Completada: aprobó el test de todos los mundos (se le habilita el chatbot)."),
        ("Avance", "Porcentaje de nodos completados y tests aprobados, sobre el total de nodos más mundos."),
        ("Nodo completado", f"El alumno aprobó las {reg['fases_por_nodo']} fases del nodo."),
        ("% Acierto", "Respuestas correctas sobre el total. Incluye fases, tests y el modo Entrenar "
                      "(preguntas generadas por IA). En preguntas de 4 alternativas, al azar se acierta cerca de 25 %."),
        ("Mundo / nodo actual", "Donde está trabajando el alumno: el primer nodo del mundo que aún no completa, "
                                "o el test del mundo si ya completó todos sus nodos."),
        ("Tiempo aprox.", "Suma de los tiempos entre respuestas seguidas, con un tope de 5 minutos entre una y otra."),
        ("", ""),
        ("ALERTAS", ""),
        ("No ha entrado", "El alumno está en la lista pero nunca abrió la nivelación."),
        ("Sin actividad", f"No responde nada hace {reg['dias_inactivo']} días o más y no ha terminado."),
        ("Acierto bajo", f"Menos de {reg['acierto_bajo']} % de acierto, con al menos {reg['min_respuestas_acierto']} respuestas."),
        ("Atascado en un nodo", f"{reg['atasco_respuestas_nodo']} respuestas o más en su nodo actual sin completarlo."),
        ("Le cuesta el test", f"{reg['atasco_respuestas_test']} respuestas o más en el test de su mundo actual sin aprobarlo."),
        ("Bajar de nivel", "El agente analista sugiere un nivel menor que el actual."),
        ("", ""),
        ("Preguntas", f"Solo se listan preguntas del banco con {reg['min_respuestas_pregunta']} respuestas o más. "
                      "«Error más común» es la alternativa incorrecta que más eligieron: sirve para detectar "
                      "enunciados confusos o errores de concepto frecuentes."),
    ]
    for etiqueta, texto in filas:
        ws.append([etiqueta, texto])
        row = ws[ws.max_row]
        row[0].font = Font(bold=True, color=AZUL_OSC if texto else BLANCO, size=11 if texto else 12)
        if etiqueta and not texto:
            row[0].fill = PatternFill("solid", fgColor=AZUL_OSC)
            row[1].fill = PatternFill("solid", fgColor=AZUL_OSC)
        row[1].alignment = Alignment(wrap_text=True, vertical="top")
        row[0].alignment = Alignment(vertical="top")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
