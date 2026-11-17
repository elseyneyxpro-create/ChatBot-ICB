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
    /** Modo dev (solo equipo): todo desbloqueado */
    dev_desbloqueo?: boolean;
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
  /** Id del intento: sirve para pedir la retroalimentación y abrir el tutor sobre esta pregunta */
  intento_id: string;
  pregunta_id: number; enunciado: string;
  /** Lo que respondió la primera vez (en las fases es lo que cuenta para el puntaje) */
  respuesta: string;
  es_correcto: boolean; correcta: string; explicacion: string | null;
  /** Solo fases de nodo: veces que la respondió y si la terminó acertando en la cola */
  intentos?: number; lograda?: boolean;
}

/** Fase de un nodo con cola estilo Duolingo: la pregunta que toca y cuánto falta. */
export interface PreguntaFase extends PreguntaPublica {
  /** true si es una pregunta que falló antes y volvió al final de la cola */
  reintento: boolean;
}
export interface ProgresoFase { total: number; respondidas: number; en_cola: number }
export interface SesionFase {
  sesion_id: string;
  nodo: { id: number; titulo: string; mundo_id: number; mundo_titulo: string };
  fase: number; repaso: boolean;
  pregunta: PreguntaFase | null;
  progreso: ProgresoFase;
}
/** Respuesta a una pregunta de la fase: solo dice si acertó; al terminar trae el resultado completo. */
export type RespuestaFase = Partial<ResultadoEvaluacion> & {
  es_correcto: boolean;
  vuelve_al_final: boolean;
  no_lograda: boolean;
  progreso: ProgresoFase;
  terminada: boolean;
  siguiente: PreguntaFase | null;
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

/** Comentario de la IA por pregunta al terminar una fase o un test. */
export interface Retroalimentacion {
  ok: boolean;
  resumen: string | null;
  reforzar: string[];
  items: { intento_id: string; comentario: string }[];
}

export interface EjercicioTutor {
  id: string; enunciado: string; alternativas: string[];
  respuesta: string | null; es_correcto: boolean | null; revelado: boolean;
  /** Pasó mucho tiempo sin responderlo: ya no se puede responder, se pide otro */
  vencido: boolean;
  /** Solo viene si acertó o si pidió ver la solución */
  correcta: string | null; explicacion: string | null;
}

export type AyudaTutor = 'no_entiendo' | 'pista';

export interface MensajeTutor {
  id: string; rol: 'alumno' | 'tutor'; texto: string; at: string;
  ejercicio: EjercicioTutor | null;
  /** Solo en el último mensaje del tutor: alternativas para responderle (el alumno no escribe) */
  opciones?: string[];
  /** Mensaje del alumno que fue un botón de ayuda */
  ayuda?: AyudaTutor | null;
}

export interface SesionTutor {
  id: string; modo: 'nodo' | 'revision';
  nodo: { id: number; titulo: string; orden: number } | null;
  mundo: { id: number; titulo: string } | null;
  /** Cuántas preguntas de la última fase/test se están revisando */
  revisando: number;
  mensajes: MensajeTutor[];
  restantes_hoy: number;
  /** Respuestas que le quedan en esta conversación (el tutor tiene un tope por conversación) */
  restantes_conversacion: number;
}

/**
 * Envuelve en $...$ una alternativa corta que trae LaTeX sin delimitar (ej. "\\frac{5}{2}"),
 * para que KaTeX la dibuje. No toca textos que ya tienen $ ni frases con palabras.
 * (Mismo criterio que latex_suelto() del servicio de agentes; esto cubre lo que ya estaba guardado.)
 */
export function latexSuelto(texto: string | null | undefined): string {
  let t = (texto ?? '').trim();
  if (!t || t.includes('$')) return t;
  t = t.replace(/\\\((.+?)\\\)/g, '$$$1$$');
  if (t.includes('$')) return t;
  const cmd = /\\[A-Za-z]+/g;
  const tieneLatex = cmd.test(t) || /[\^_]\{/.test(t);
  const sinComandos = t.replace(/\\[A-Za-z]+/g, '');
  return tieneLatex && !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}/.test(sinComandos) ? `$${t}$` : t;
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

  /** Modo dev (solo equipo, para demos): todos los mundos y nodos desbloqueados. */
  modoDev() { return this.get<{ desbloquear: boolean }>('/dev'); }
  cambiarModoDev(desbloquear: boolean) { return this.send<{ desbloquear: boolean }>('PUT', '/dev', { desbloquear }); }

  /** Entrega (o retoma) la pasada por la fase del nodo y la pregunta que toca. */
  preguntasFase(nodoId: number) {
    return this.get<SesionFase>(`/nodos/${nodoId}/fase`);
  }
  /** Responde la pregunta actual de la fase (de a una). */
  responderFase(nodoId: number, sesionId: string, preguntaId: number, respuesta: string) {
    return this.send<RespuestaFase>('POST', `/nodos/${nodoId}/fase/respuesta`, { sesion_id: sesionId, pregunta_id: preguntaId, respuesta });
  }

  preguntasTest(mundoId: number) {
    return this.get<{ mundo: { id: number; titulo: string }; fase: number; preguntas: PreguntaPublica[] }>(`/mundos/${mundoId}/test`);
  }
  responderTest(mundoId: number, respuestas: { pregunta_id: number; respuesta: string }[]) {
    return this.send<ResultadoEvaluacion>('POST', `/mundos/${mundoId}/test`, { respuestas });
  }

  // ── Retroalimentación y tutor ──────────────────────────────────────────
  retroalimentacion(intentoIds: string[]) {
    return this.send<Retroalimentacion>('POST', '/retroalimentacion', { intento_ids: intentoIds });
  }

  abrirTutor(opts: { nodo_id?: number; mundo_id?: number; intento_ids: string[] }) {
    return this.send<SesionTutor>('POST', '/tutor/sesiones', opts);
  }
  /** Responde al tutor eligiendo una alternativa (posición) o con un botón de ayuda. */
  responderAlTutor(sesionId: string, r: { opcion: number } | { ayuda: AyudaTutor }) {
    return this.send<{ mensajes: MensajeTutor[]; restantes_hoy: number; restantes_conversacion: number }>('POST', `/tutor/sesiones/${sesionId}/mensajes`, r);
  }
  pedirEjercicio(sesionId: string) {
    return this.send<{ mensajes: MensajeTutor[]; restantes_conversacion: number }>('POST', `/tutor/sesiones/${sesionId}/ejercicio`);
  }
  responderEjercicio(sesionId: string, ejId: string, respuesta: string) {
    return this.send<{ es_correcto: boolean; xp_ganado: number; ejercicio: EjercicioTutor; mensajes: MensajeTutor[] }>(
      'POST', `/tutor/sesiones/${sesionId}/ejercicio/${ejId}/respuesta`, { respuesta },
    );
  }
  verSolucion(sesionId: string, ejId: string) {
    return this.send<{ ejercicio: EjercicioTutor }>('POST', `/tutor/sesiones/${sesionId}/ejercicio/${ejId}/solucion`);
  }

  /** Mensaje legible desde un HttpErrorResponse del backend. */
  static mensajeError(e: any, def = 'Ocurrió un error. Intenta de nuevo.'): string {
    const m = e?.error?.message;
    if (typeof m === 'string') return m;
    if (typeof m?.message === 'string') return m.message;
    return def;
  }
}
