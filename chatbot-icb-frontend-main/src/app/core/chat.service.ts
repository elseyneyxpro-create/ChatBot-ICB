import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Auth } from '@angular/fire/auth';
import { FirestoreService, type Reinforcement, type Ejercicio } from './firestore.service';
import { environment } from '../../environments/environment';

export type Role = 'user' | 'bot' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  ts: number;
  imagePreview?: string;
  isTyping?: boolean;
  ejemploVideos?: string[];
}

export type { Ejercicio, Reinforcement } from './firestore.service';

export interface VideoItem {
  url: string;
  categoria: string;
  contenido_video?: string;
}

export interface AgentsAnswer {
  ok: boolean;
  reply?: string;
  reinforcement?: Reinforcement;
  videos?: VideoItem[];
  tema?: string | null;
  latency_ms?: number;
  error?: string;
}

export interface EvaluateConceptoResult {
  ok: boolean;
  es_correcto: boolean;
  feedback: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private firestoreService = inject(FirestoreService);
  private base = environment.AGENTS_URL;

  messagesSig = signal<ChatMessage[]>([]);
  reinforcementSig = signal<Reinforcement | null>(null);
  videosSig = signal<VideoItem[]>([]);
  lastTemaSig = signal<string | null>(null);
  lastHiloIdSig = signal<string | null>(null);
  /** Estado de ejercicios restaurado desde el último hilo del historial (si hay reinforcement). */
  restoredEjerciciosSig = signal<Ejercicio[] | null>(null);

  private currentChatId: string | null = null;
  private currentTotalHilos = 0;

  setActiveChat(id: string, totalHilos = 0) {
    this.currentChatId = id;
    this.currentTotalHilos = totalHilos;
  }

  getActiveChatId(): string | null {
    return this.currentChatId;
  }

  async loadUserMessages(id_chat_nr: string, lastReinforcement?: Reinforcement | null): Promise<void> {
    const history = await this.firestoreService.loadHistory(id_chat_nr);
    const messages: ChatMessage[] = [];

    let lastRespuestaHiloId: string | null = null;
    let lastHiloReinforcement: Reinforcement | null = null;

    for (const hilo of history) {
      const ts = (hilo.created_at as any)?.getTime?.() ?? Date.now();
      if (hilo.tipo === 'system') {
        messages.push({
          id: hilo.id ?? `${ts}_sys`,
          role: 'system',
          text: hilo.texto ?? '',
          ts,
        });
        continue;
      }
      messages.push({
        id: `${hilo.id}_user`,
        role: 'user',
        text: hilo.input ?? '',
        ts,
      });
      messages.push({
        id: `${hilo.id}_bot`,
        role: 'bot',
        text: hilo.output ?? '',
        ts,
        ejemploVideos: hilo.ejemplo_videos ?? [],
      });
      lastRespuestaHiloId = hilo.id ?? null;
      if (hilo.reinforcement) lastHiloReinforcement = hilo.reinforcement;
    }

    this.currentTotalHilos = history.length;
    this.messagesSig.set(messages);

    // Estrategia de carga (doble fuente de verdad):
    // 1. lastHiloReinforcement: leído del Hilo_chat — tiene respuestas del alumno si _persistEjercicio corrió.
    // 2. lastReinforcement (Chat_nr.last_reinforcement): también se actualiza al responder.
    // Preferimos el que tenga más ejercicios respondidos; si empatan, el del hilo.
    const countRespondidos = (r: Reinforcement | null | undefined) =>
      r?.ejercicios?.filter(e => e.respondido).length ?? -1;
    const reinforcementToUse =
      countRespondidos(lastHiloReinforcement) >= countRespondidos(lastReinforcement)
        ? (lastHiloReinforcement ?? lastReinforcement ?? null)
        : (lastReinforcement ?? lastHiloReinforcement ?? null);
    this.reinforcementSig.set(reinforcementToUse);
    this.restoredEjerciciosSig.set(reinforcementToUse?.ejercicios ?? null);
    this.lastHiloIdSig.set(lastRespuestaHiloId);

    const lastTema = [...history].reverse().find(h => h.tema)?.tema ?? null;
    this.lastTemaSig.set(lastTema);
  }

  ask(question: string, imageBase64?: string) {
    const u = this.auth.currentUser;
    return this.http.post<AgentsAnswer>(`${this.base}${environment.endpoints.ai.answer}`, {
      question,
      uid: u?.uid ?? null,
      id_chat_nr: this.currentChatId,
      total_hilos: this.currentTotalHilos,
      image_base64: imageBase64 ?? null,
      ...(this.lastTemaSig() ? { last_tema: this.lastTemaSig() } : {}),
    });
  }

  evaluateConcepto(enunciado: string, respuesta_usuario: string, tema: string) {
    const u = this.auth.currentUser;
    return this.http.post<EvaluateConceptoResult>(`${this.base}${environment.endpoints.ai.evaluateConcepto}`, {
      uid: u?.uid ?? null,
      tema,
      enunciado,
      respuesta_usuario,
      id_chat_nr: this.currentChatId,
    });
  }

  evaluateVof(enunciado: string, respuesta_usuario: boolean, respuesta_correcta: boolean, tema: string) {
    const u = this.auth.currentUser;
    return this.http.post<EvaluateConceptoResult>(`${this.base}${environment.endpoints.ai.evaluateVof}`, {
      uid: u?.uid ?? null,
      tema,
      enunciado,
      respuesta_usuario,
      respuesta_correcta,
      id_chat_nr: this.currentChatId,
    });
  }

  evaluateError(enunciado: string, desarrollo: string[], paso_error: number, respuesta_usuario: number, tema: string) {
    const u = this.auth.currentUser;
    return this.http.post<EvaluateConceptoResult>(`${this.base}${environment.endpoints.ai.evaluateError}`, {
      uid: u?.uid ?? null,
      tema,
      enunciado,
      desarrollo,
      paso_error,
      respuesta_usuario,
      id_chat_nr: this.currentChatId,
    });
  }

  saveExerciseResult(tema: string, tipo: 'vof' | 'error' | 'concepto', es_correcto: boolean, enunciado?: string) {
    const u = this.auth.currentUser;
    if (!u?.uid) return;
    this.http.post(`${this.base}${environment.endpoints.ai.saveExerciseResult}`, {
      uid: u.uid,
      tema,
      tipo,
      es_correcto,
      enunciado: enunciado ?? null,
      id_chat_nr: this.currentChatId,
    }).subscribe({ error: (e) => console.warn('[ChatService] saveExerciseResult error:', e) });
  }

  push(role: Role, text: string, imagePreview?: string) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      text,
      ts: Date.now(),
      imagePreview,
    };
    this.messagesSig.update(arr => [...arr, msg]);
  }

  async pushWithTypewriter(role: Role, text: string, ejemploVideos?: string[]): Promise<void> {
    const id = crypto.randomUUID();
    this.messagesSig.update(arr => [...arr, { id, role, text: '', ts: Date.now(), isTyping: true }]);

    const words = text.split(' ');
    const delay = 45;
    let current = '';

    for (const word of words) {
      current += (current ? ' ' : '') + word;
      const snapshot = current;
      this.messagesSig.update(arr =>
        arr.map(m => m.id === id ? { ...m, text: snapshot } : m)
      );
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }

    this.messagesSig.update(arr =>
      arr.map(m => m.id === id ? { ...m, isTyping: false, ejemploVideos: ejemploVideos ?? [] } : m)
    );
  }

  async saveExchange(input: string, output: string, tema: string | null, ejemploVideos: string[] = []): Promise<string | null> {
    if (!this.currentChatId) return null;
    const { count, hiloId } = await this.firestoreService.appendHilo(
      this.currentChatId, input, output, tema, ejemploVideos
    );
    this.currentTotalHilos = count;
    this.lastHiloIdSig.set(hiloId);
    if (tema) this.lastTemaSig.set(tema);
    return hiloId;
  }

  setReinforcement(reinforcement: Reinforcement | null) {
    this.reinforcementSig.set(reinforcement);
  }

  setVideos(videos: VideoItem[]) {
    this.videosSig.set(videos);
  }

  clear() {
    this.messagesSig.set([]);
    this.reinforcementSig.set(null);
    this.videosSig.set([] as VideoItem[]);
    this.lastTemaSig.set(null);
    this.lastHiloIdSig.set(null);
    this.restoredEjerciciosSig.set(null);
    this.currentTotalHilos = 0;
  }
}
