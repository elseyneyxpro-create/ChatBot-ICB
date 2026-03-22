import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Auth } from '@angular/fire/auth';
import { FirestoreService, type Reinforcement } from './firestore.service';
import { environment } from '../../environments/environment';

export type Role = 'user' | 'bot';

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

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private firestoreService = inject(FirestoreService);
  private base = environment.AGENTS_URL;

  messagesSig = signal<ChatMessage[]>([]);
  reinforcementSig = signal<Reinforcement | null>(null);
  videosSig = signal<VideoItem[]>([]);

  private currentChatId: string | null = null;
  private currentTotalHilos = 0;
  private currentResumen = '';

  setActiveChat(id: string, totalHilos = 0, resumen = '') {
    this.currentChatId = id;
    this.currentTotalHilos = totalHilos;
    this.currentResumen = resumen;
  }

  getActiveChatId(): string | null {
    return this.currentChatId;
  }

  async loadUserMessages(id_chat_nr: string, lastReinforcement?: Reinforcement | null): Promise<void> {
    const history = await this.firestoreService.loadHistory(id_chat_nr);
    const messages: ChatMessage[] = [];

    for (const hilo of history) {
      messages.push({
        id: `${hilo.id}_user`,
        role: 'user',
        text: hilo.input,
        ts: (hilo.created_at as any)?.toDate?.()?.getTime() ?? Date.now(),
      });
      messages.push({
        id: `${hilo.id}_bot`,
        role: 'bot',
        text: hilo.output,
        ts: (hilo.created_at as any)?.toDate?.()?.getTime() ?? Date.now(),
      });
    }

    this.currentTotalHilos = history.length;
    this.messagesSig.set(messages);
    this.reinforcementSig.set(lastReinforcement ?? null);
  }

  setResumen(resumen: string) {
    this.currentResumen = resumen;
  }

  ask(question: string, imageBase64?: string) {
    const u = this.auth.currentUser;
    return this.http.post<AgentsAnswer>(`${this.base}/ai/answer`, {
      question,
      session_id: this.currentChatId ?? 'demo',
      uid: u?.uid ?? null,
      id_chat_nr: this.currentChatId,
      total_hilos: this.currentTotalHilos,
      image_base64: imageBase64 ?? null,
      display_name: u?.displayName ?? null,
      email: u?.email ?? null,
      photo_url: u?.photoURL ?? null,
      context: this._buildContext(),
      resumen_conversacion: this.currentResumen || null,
    });
  }

  /** Últimos 3 intercambios como texto para dar contexto al bot. */
  private _buildContext(): string {
    const msgs = this.messagesSig();
    if (msgs.length === 0) return '';
    // Take last 6 messages (3 exchanges), cap each at 400 chars
    return msgs
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'Alumno' : 'Tutor'}: ${m.text.slice(0, 400)}`)
      .join('\n');
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
    // Mensaje vacío con isTyping=true — muestra texto plano sin KaTeX durante la animación
    this.messagesSig.update(arr => [...arr, { id, role, text: '', ts: Date.now(), isTyping: true }]);

    const words = text.split(' ');
    const delay = 45; // velocidad fija: ~22 palabras/seg
    let current = '';

    for (const word of words) {
      current += (current ? ' ' : '') + word;
      const snapshot = current;
      this.messagesSig.update(arr =>
        arr.map(m => m.id === id ? { ...m, text: snapshot } : m)
      );
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }

    // Animación terminada: desactivar isTyping y adjuntar videos de ejemplo si hay
    this.messagesSig.update(arr =>
      arr.map(m => m.id === id ? { ...m, isTyping: false, ejemploVideos: ejemploVideos ?? [] } : m)
    );
  }

  async saveExchange(input: string, output: string, tema: string | null): Promise<void> {
    if (!this.currentChatId) return;
    const newTotal = await this.firestoreService.appendHilo(
      this.currentChatId, input, output, tema
    );
    this.currentTotalHilos = newTotal;
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
    this.currentTotalHilos = 0;
    this.currentResumen = '';
  }
}
