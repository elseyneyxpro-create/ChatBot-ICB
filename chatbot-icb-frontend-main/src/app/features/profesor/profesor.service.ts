import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type EstadoAlumno = 'Sin ingresar' | 'En curso' | 'Completada';

export interface MundoAlumno {
  mundo_id: number; nodos_completados: number; total_nodos: number;
  test_fase: number; mejor_puntaje: number; completado: boolean;
}

export interface AlumnoReporte {
  uid: string | null;
  correo: string;
  nombre: string;
  carrera: string | null;
  estado: EstadoAlumno;
  nivel_inicial: string;
  nivel_actual: string | null;
  xp: number;
  progreso: number;
  nodos_completados: number; total_nodos: number;
  mundos_completados: number; total_mundos: number;
  mundo_actual: string | null;
  nodo_actual: string | null;
  respuestas: number; correctas: number;
  acierto: number | null;
  acierto_fases: number | null; acierto_tests: number | null; acierto_entrenar: number | null;
  respuestas_entrenar: number;
  primer_ingreso: string | null;
  ultima_actividad: string | null;
  dias_sin_actividad: number | null;
  dias_activos: number;
  minutos: number;
  chatbot_habilitado: boolean;
  por_mundo: MundoAlumno[];
  analisis: {
    nivel_sugerido: string | null; fortalezas: string[]; debilidades: string[];
    recomendacion: string | null; resumen: string | null; fecha: string;
  } | null;
  alertas: string[];
}

export interface ResumenGrupo {
  alumnos: number; ingresaron: number; completaron: number; en_curso: number; sin_ingresar: number;
  progreso_promedio: number; acierto: number | null; con_alertas: number;
  activos_ultima_semana: number; horas_totales: number;
}

export interface ReporteNivelacion {
  generado: string;
  carreras: string[] | null;
  carreras_disponibles: string[];
  reglas: {
    fases_por_nodo: number; dias_inactivo: number; acierto_bajo: number; min_respuestas_acierto: number;
    atasco_respuestas_nodo: number; atasco_respuestas_test: number; min_respuestas_pregunta: number;
  };
  mundos: { id: number; orden: number; titulo: string; total_nodos: number }[];
  resumen: ResumenGrupo & { nodo_mas_dificil: { mundo: string; nodo: string; acierto: number } | null };
  por_carrera: (ResumenGrupo & { carrera: string })[];
  por_mundo: {
    mundo_id: number; orden: number; mundo: string; total_nodos: number;
    alumnos_llegaron: number; alumnos_completaron: number; acierto_fases: number | null;
    rindieron_test: number; acierto_test: number | null; mejor_puntaje_promedio: number | null;
  }[];
  por_nodo: {
    nodo_id: number; mundo_id: number; mundo: string; orden: number; nodo: string;
    alumnos_intentaron: number; alumnos_completaron: number; alumnos_atascados: number;
    respuestas: number; acierto: number | null; respuestas_para_completar: number | null;
  }[];
  preguntas: {
    id: number; enunciado: string; correcta: string; dificultad: string; mundo: string; nodo: string;
    uso: string; respuestas: number; acierto: number; error_comun: string | null; veces_error_comun: number;
  }[];
  alumnos: AlumnoReporte[];
}

export interface DetalleAlumno {
  ultimas_respuestas: {
    created_at: string; contexto: 'fase' | 'test' | 'entrenar'; origen: string; dificultad: string | null;
    enunciado: string; respuesta: string | null; correcta: string | null; es_correcto: boolean;
    mundo: string | null; nodo: string | null;
  }[];
  analisis: {
    nivel_sugerido: string | null; fortalezas: string[]; debilidades: string[];
    recomendacion: string | null; resumen: string | null; n_intentos: number | null; created_at: string;
  }[];
}

/** Reportes de la nivelación para el panel docente (backend: /api/v1/profesor/...). */
@Injectable({ providedIn: 'root' })
export class ProfesorService {
  private http = inject(HttpClient);
  private base = `${environment.AGENTS_URL}/profesor/nivelacion`;

  private params(carrera: string | null) {
    return carrera ? new HttpParams().set('carrera', carrera) : undefined;
  }

  reporte(carrera: string | null) {
    return firstValueFrom(this.http.get<ReporteNivelacion>(this.base, { params: this.params(carrera) }));
  }

  detalle(uid: string, carrera: string | null) {
    return firstValueFrom(this.http.get<DetalleAlumno>(`${this.base}/alumnos/${encodeURIComponent(uid)}`,
      { params: this.params(carrera) }));
  }

  /** Descarga el Excel con el nombre que manda el servidor. */
  async descargarExcel(carrera: string | null): Promise<void> {
    const res: HttpResponse<Blob> = await firstValueFrom(this.http.get(`${this.base}/excel`, {
      params: this.params(carrera), responseType: 'blob', observe: 'response',
    }));
    const disp = res.headers.get('content-disposition') ?? '';
    const nombre = /filename="?([^";]+)"?/.exec(disp)?.[1] ?? 'reporte_nivelacion.xlsx';
    const url = URL.createObjectURL(res.body!);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  static mensajeError(e: any, def = 'No se pudo cargar el reporte. Intenta de nuevo.'): string {
    if (e?.status === 403) return 'Este panel es solo para profesores.';
    if (e?.status === 0) return 'No hay conexión con el servidor.';
    const m = e?.error?.message;
    if (typeof m === 'string') return m;
    return def;
  }
}
