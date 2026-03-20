import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Auth } from '@angular/fire/auth';
import { FirestoreService } from './firestore.service';
import { environment } from '../../environments/environment';

export type Role = 'user' | 'bot';

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  ts: number;
  imagePreview?: string;
}

export interface Ejercicio {
  tipo: 'verdadero_falso' | 'encuentra_el_error' | 'concepto';
  enunciado: string;
  desarrollo?: string;
}

export interface Reinforcement {
  nivel: 'rojo' | 'amarillo' | 'trivial';
  texto: string;
  ejercicios?: Ejercicio[];
}

export interface AgentsAnswer {
  ok: boolean;
  reply?: string;
  reinforcement?: Reinforcement;
  videos?: string[];
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
  videosSig = signal<string[]>([]);

  private currentChatId: string | null = null;
  private currentTotalHilos = 0;

  setActiveChat(id: string, totalHilos = 0) {
    this.currentChatId = id;
    this.currentTotalHilos = totalHilos;
  }

  getActiveChatId(): string | null {
    return this.currentChatId;
  }

  async loadUserMessages(id_chat_nr: string): Promise<void> {
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
  }

  ask(question: string, imageBase64?: string) {
    const uid = this.auth.currentUser?.uid ?? 'anon';
    return this.http.post<AgentsAnswer>(`${this.base}/ai/answer`, {
      question,
      session_id: this.currentChatId ?? 'demo',
      uid,
      id_chat_nr: this.currentChatId,
      total_hilos: this.currentTotalHilos,
      image_base64: imageBase64 ?? null,
    });
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

  setVideos(videos: string[]) {
    this.videosSig.set(videos);
  }

  clear() {
    this.messagesSig.set([]);
    this.reinforcementSig.set(null);
    this.videosSig.set([]);
    this.currentTotalHilos = 0;
  }
}
