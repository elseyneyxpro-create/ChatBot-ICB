import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/*
 * DataService — reemplaza a FirestoreService.
 * Antes el frontend leía/escribía directo en Firestore; ahora todo pasa por el backend NestJS
 * (que guarda en MongoDB y valida que cada chat pertenezca al usuario del JWT).
 */

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface Ejercicio {
  tipo: 'verdadero_falso' | 'encuentra_el_error' | 'concepto';
  enunciado: string;
  desarrollo?: string[];
  respuesta_correcta?: boolean;
  paso_error?: number;
  explicacion?: string;
  respondido?: boolean;
  es_correcto?: boolean;
  respuesta_alumno?: any;
  feedback?: string;
}

export interface Reinforcement {
  nivel: 'rojo' | 'amarillo' | 'trivial';
  texto: string;
  ejercicios?: Ejercicio[];
  videos?: { url: string; categoria: string }[];
  saved_at?: number;
}

export interface ChatNr {
  id: string;
  uid: string;
  nombre: string;
  id_head: string;
  id_tail: string;
  total_hilos: number;
  created_at: Date;
  last_reinforcement?: Reinforcement | null;
  last_videos?: { url: string; categoria: string }[];
}

export interface HiloChat {
  id?: string;
  id_chat_nr: string;
  tipo: 'respuesta' | 'system';
  texto?: string;
  input?: string;
  output?: string;
  tema: string | null;
  count: number;
  id_next: string;
  created_at: Date;
  ejemplo_videos?: string[];
  reinforcement?: Reinforcement | null;
}

/** Estadísticas por tema (colección nivel_usuario en MongoDB) */
export interface NivelTemaStats {
  tema: string;
  nivel: 'crítico' | 'débil' | 'normal';
  vof_aciertos: number;
  vof_errores: number;
  error_aciertos: number;
  error_errores: number;
  concepto_aciertos: number;
  concepto_errores: number;
  errores_rojo: number;
  ultima_actividad?: Date;
}

export interface LeaderboardEntry {
  uid: string;
  display_name: string;
  photo_url: string | null;
  total_aciertos: number;
  total_errores: number;
  total_ejercicios: number;
  porcentaje: number;
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class DataService {
  private http = inject(HttpClient);
  private base = environment.AGENTS_URL; // /api/v1

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params, withCredentials: true }));
  }
  private send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
    return firstValueFrom(this.http.request<T>(method, `${this.base}${path}`, { body, withCredentials: true }));
  }

  // ── Chats ──────────────────────────────────────────────────────────────────

  async getChatList(): Promise<ChatNr[]> {
    const list = await this.get<any[]>('/chats');
    return list.map(c => this._mapChatNr(c));
  }

  async getChat(id_chat_nr: string): Promise<ChatNr> {
    return this._mapChatNr(await this.get<any>(`/chats/${id_chat_nr}`));
  }

  async createChat(nombre: string): Promise<ChatNr> {
    return this._mapChatNr(await this.send<any>('POST', '/chats', { nombre }));
  }

  async getChatTotalHilos(id_chat_nr: string): Promise<number> {
    return (await this.getChat(id_chat_nr)).total_hilos;
  }

  async saveLastVideos(id_chat_nr: string, videos: { url: string; categoria: string }[]): Promise<void> {
    try {
      await this.send('PUT', `/chats/${id_chat_nr}/last-videos`, { videos });
    } catch (e) {
      console.warn('[DataService] saveLastVideos falló:', e);
    }
  }

  async renameChat(id: string, nombre: string): Promise<void> {
    await this.send('PATCH', `/chats/${id}`, { nombre });
  }

  async deleteChat(id: string): Promise<void> {
    await this.send('DELETE', `/chats/${id}`);
  }

  /**
   * Antes: onSnapshot de Firestore sobre Chat_nr/{id}.last_reinforcement.
   * Ahora: polling cada `intervalMs` al backend. Llama al callback cada vez que cambia
   * el reinforcement. Devuelve la función para detener el polling (misma firma que antes).
   */
  watchReinforcement(
    id_chat_nr: string,
    callback: (r: Reinforcement | null) => void,
    intervalMs = 2000,
  ): () => void {
    let stopped = false;
    let lastKey = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped) return;
      try {
        const chat = await this.get<any>(`/chats/${id_chat_nr}`);
        const r = this._mapReinforcement(chat?.last_reinforcement);
        const key = r ? `${r.saved_at ?? ''}|${r.ejercicios?.length ?? 0}` : 'null';
        if (!stopped && key !== lastKey) {
          lastKey = key;
          callback(r);
        }
      } catch (e) {
        console.warn('[DataService] watchReinforcement falló:', e);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  // ── Hilos ──────────────────────────────────────────────────────────────────

  async appendHilo(
    id_chat_nr: string,
    input: string,
    output: string,
    tema: string | null,
    ejemploVideos: string[] = [],
  ): Promise<{ count: number; hiloId: string }> {
    return this.send<{ count: number; hiloId: string }>('POST', `/chats/${id_chat_nr}/hilos`, {
      input,
      output,
      tema,
      ejemplo_videos: ejemploVideos,
    });
  }

  async updateHiloReinforcement(id_chat_nr: string, reinforcement: Reinforcement): Promise<void> {
    try {
      await this.send('PUT', `/chats/${id_chat_nr}/reinforcement`, { reinforcement });
    } catch (e) {
      console.warn('[DataService] updateHiloReinforcement falló:', e);
    }
  }

  async updateHiloEjercicio(
    hiloId: string,
    chatId: string,
    ejercicioTipo: 'concepto' | 'verdadero_falso' | 'encuentra_el_error',
    update: { es_correcto: boolean; respuesta_alumno: any; feedback?: string },
  ): Promise<void> {
    await this.send('PATCH', `/chats/${chatId}/hilos/${hiloId}/ejercicio`, {
      tipo: ejercicioTipo,
      ...update,
    });
  }

  async loadHistory(id_chat_nr: string): Promise<HiloChat[]> {
    const docs = await this.get<any[]>(`/chats/${id_chat_nr}/hilos`);
    return docs.map(data => ({
      id:             data['id'],
      id_chat_nr:     data['id_chat_nr'],
      tipo:           data['tipo'] ?? 'respuesta',
      texto:          data['texto'],
      input:          data['input'],
      output:         data['output'],
      tema:           data['tema'] ?? null,
      count:          data['count'] ?? 0,
      id_next:        data['id_next'] ?? '',
      created_at:     data['created_at'] ? new Date(data['created_at']) : new Date(),
      ejemplo_videos: data['ejemplo_videos'] ?? [],
      reinforcement:  this._mapReinforcement(data['reinforcement']),
    } as HiloChat));
  }

  // ── Perfil y leaderboard ───────────────────────────────────────────────────

  async getProfileStats(): Promise<{
    total_aciertos: number;
    total_errores: number;
    porcentaje: number;
    weak_points_text: string;
    temas: NivelTemaStats[];
  }> {
    try {
      const r = await this.get<any>('/profile/stats');
      return {
        ...r,
        temas: (r.temas ?? []).map((t: any) => ({
          ...t,
          ultima_actividad: t.ultima_actividad ? new Date(t.ultima_actividad) : undefined,
        })),
      };
    } catch (e) {
      console.warn('[DataService] getProfileStats falló:', e);
      return { total_aciertos: 0, total_errores: 0, porcentaje: 0, weak_points_text: '', temas: [] };
    }
  }

  getLeaderboardTotals(topN = 50, sortBy: 'aciertos' | 'uso' = 'aciertos'): Promise<LeaderboardEntry[]> {
    return this.get<LeaderboardEntry[]>('/leaderboard', { sort: sortBy, limit: String(topN) });
  }

  getLeaderboardPorTema(tema: string, topN = 50): Promise<LeaderboardEntry[]> {
    return this.get<LeaderboardEntry[]>('/leaderboard', { tema, limit: String(topN) });
  }

  getTop5Temas(): Promise<string[]> {
    return this.get<string[]>('/leaderboard/top-temas');
  }

  // ── Privados ───────────────────────────────────────────────────────────────

  private _mapChatNr(data: any): ChatNr {
    return {
      id:                 data['id'],
      uid:                data['uid'],
      nombre:             data['nombre'],
      id_head:            data['id_head'] ?? '',
      id_tail:            data['id_tail'] ?? '',
      total_hilos:        data['total_hilos'] ?? 0,
      created_at:         data['created_at'] ? new Date(data['created_at']) : new Date(),
      last_reinforcement: this._mapReinforcement(data['last_reinforcement']),
      last_videos:        data['last_videos'] ?? [],
    };
  }

  private _mapReinforcement(raw: any): Reinforcement | null {
    if (!raw?.['nivel']) return null;
    return {
      nivel:     raw['nivel'],
      texto:     raw['texto'] ?? '',
      ejercicios: (raw['ejercicios'] ?? []).map((ej: any) => this._mapEjercicio(ej)),
      videos:    raw['videos'] ?? [],
      saved_at:  raw['saved_at'] ?? undefined,
    } as Reinforcement;
  }

  private _mapEjercicio(ej: any): Ejercicio {
    return {
      tipo:              ej['tipo'],
      enunciado:         ej['enunciado'] ?? '',
      desarrollo:        Array.isArray(ej['desarrollo']) ? ej['desarrollo'] : undefined,
      respuesta_correcta: this._parseBool(ej['respuesta_correcta']),
      paso_error:        typeof ej['paso_error'] === 'number' ? ej['paso_error'] : undefined,
      explicacion:       typeof ej['explicacion'] === 'string' ? ej['explicacion'] : '',
      respondido:        ej['respondido'] === true,
      es_correcto:       typeof ej['es_correcto'] === 'boolean' ? ej['es_correcto'] : undefined,
      respuesta_alumno:  ej['respuesta_alumno'],
      feedback:          typeof ej['feedback'] === 'string' ? ej['feedback'] : undefined,
    };
  }

  private _parseBool(val: any): boolean | undefined {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const v = val.trim().toLowerCase();
      if (['true', 'verdadero', '1', 'v'].includes(v)) return true;
      if (['false', 'falso', '0', 'f'].includes(v)) return false;
    }
    return undefined;
  }
}
