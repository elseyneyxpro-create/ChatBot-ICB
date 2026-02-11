import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type Role = 'user' | 'bot';
export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  ts: number;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private base = environment.API_URL;

  // estado (opcional) por si quieres leer desde varios componentes
  messagesSig = signal<ChatMessage[]>([]);

  ask(question: string, subject = 'Cálculo', session = 'demo') {
    return this.http.post<any>(`${this.base}/v1/ai/answer`, {
      question,
      subject,
      session_id: session,
    });
  }

  push(role: Role, text: string) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      text,
      ts: Date.now(),
    };
    this.messagesSig.update((arr) => [...arr, msg]);
  }

  clear() {
    this.messagesSig.set([]);
  }
}
