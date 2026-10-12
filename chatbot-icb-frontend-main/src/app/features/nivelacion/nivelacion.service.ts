import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type Nivel = 'Principiante' | 'Intermedio' | 'Avanzado';
export const NIVELES: Nivel[] = ['Principiante', 'Intermedio', 'Avanzado'];

export interface Analisis {
  nivel_sugerido: Nivel | null;
  fortalezas: string[];
  debilidades: string[];
  recomendacion: string | null;
  resumen: string | null;
  n_intentos: number | null;
  created_at: string;
}

export interface EstadoNivelacion {
  estudiante: {
    nivel: Nivel | null;
    xp: number;
    nivel_xp: number;
    xp_en_nivel: number;
    xp_por_nivel: number;
    chatbot_habilitado: boolean;
    nivelacion_completa: boolean;
  };
  mundos: {
    id: number; orden: number; titulo: string; descripcion: string | null; icono: string | null;
    total_nodos: number; nodos_completados: number; fase_test: number;
    completado: boolean; desbloqueado: boolean;
  }[];
  analisis: Analisis | null;
}

export interface NodoMapa {
  id: number; orden: number; titulo: string; descripcion: string | null;
  fases: number; estado: 'completado' | 'actual' | 'bloqueado';
}

export interface MundoDetalle {
  mundo: { id: number; titulo: string; descripcion: string | null; icono: string | null; completado: boolean };
  nodos: NodoMapa[];
  test: { fase: number; desbloqueado: boolean };
  reglas: { FASES_POR_NODO: number; PUNTAJE_APROBAR: number };
}

export interface PreguntaPublica { id: number; enunciado: string; alternativas: string[] }

export interface ResultadoPregunta {
  pregunta_id: number; enunciado: string; respuesta: string;
  es_correcto: boolean; correcta: string; explicacion: string | null;
}

export interface ResultadoEvaluacion {
  puntaje: number; aprobado: boolean; xp_ganado: number; resultados: ResultadoPregunta[];
  // fase de nodo
  fases?: number; nodo_completado?: boolean; repaso?: boolean;
  // test
  fase?: number; mundo_completado?: boolean;
  /** true cuando con este test completó toda la nivelación y se le habilitó el chatbot */
  chatbot_desbloqueado?: boolean;
}

export interface PreguntaGenerada {
  id: string; enunciado: string; alternativas: string[];
  nodo: { id: number; titulo: string; mundo_id: number; mundo_titulo: string };
}

/** Cliente de /api/v1/nivelacion + estado compartido (nivel, XP) para el header. */
@Injectable({ providedIn: 'root' })
export class NivelacionService {
  private http = inject(HttpClient);
  private base = `${environment.AGENTS_URL}/nivelacion`;

  estado = signal<EstadoNivelacion | null>(null);

  private get<T>(path: string) { return firstValueFrom(this.http.get<T>(`${this.base}${path}`)); }
  private send<T>(method: 'POST' | 'PUT', path: string, body: unknown = {}) {
    return firstValueFrom(this.http.request<T>(method, `${this.base}${path}`, { body }));
  }

  async cargarEstado(): Promise<EstadoNivelacion> {
    const e = await this.get<EstadoNivelacion>('/estado');
    this.estado.set(e);
    return e;
  }

  mundo(id: number) { return this.get<MundoDetalle>(`/mundos/${id}`); }

  preguntasFase(nodoId: number) {
    return this.get<{ nodo: { id: number; titulo: string; mundo_id: number; mundo_titulo: string }; fase: number; repaso: boolean; preguntas: PreguntaPublica[] }>(`/nodos/${nodoId}/fase`);
  }
  responderFase(nodoId: number, respuestas: { pregunta_id: number; respuesta: string }[]) {
    return this.send<ResultadoEvaluacion>('POST', `/nodos/${nodoId}/fase`, { respuestas });
  }

  preguntasTest(mundoId: number) {
    return this.get<{ mundo: { id: number; titulo: string }; fase: number; preguntas: PreguntaPublica[] }>(`/mundos/${mundoId}/test`);
  }
  responderTest(mundoId: number, respuestas: { pregunta_id: number; respuesta: string }[]) {
    return this.send<ResultadoEvaluacion>('POST', `/mundos/${mundoId}/test`, { respuestas });
  }

  generarPregunta(nodoId: number) { return this.send<PreguntaGenerada>('POST', `/nodos/${nodoId}/entrenar`); }
  responderGenerada(id: string, respuesta: string) {
    return this.send<{ es_correcto: boolean; correcta: string; explicacion: string | null; xp_ganado: number }>(
      'POST', `/entrenar/${id}`, { respuesta },
    );
  }

  /** Mensaje legible desde un HttpErrorResponse del backend. */
  static mensajeError(e: any, def = 'Ocurrió un error. Intenta de nuevo.'): string {
    const m = e?.error?.message;
    if (typeof m === 'string') return m;
    if (typeof m?.message === 'string') return m.message;
    return def;
  }
}
