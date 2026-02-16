import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { map } from 'rxjs';




export type Role = 'user' | 'bot';
export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  ts: number;
}

type AiResponse = {
  ok: boolean;
  reply?: string;
  error?: string;
};

function normalizeLatex(text: string) {
  if (!text) return text;

  // 1) \(...\) -> $...$
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_m, expr) => `$${expr}$`);

  // 2) \[...\] -> $$...$$
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, expr) => `\n$$\n${expr}\n$$\n`);

  // 3) Bloques "[]" de varias líneas -> $$...$$
  text = text.replace(/\n\s*\[\s*\n([\s\S]*?)\n\s*\]\s*\n/g, (_m, expr) => `\n$$\n${expr}\n$$\n`);

  return text;
}


@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private base = environment.API_URL;

  messagesSig = signal<ChatMessage[]>([]);

  ask(question: string, subject = 'Cálculo', session = 'demo') {
  return this.http
    .post<AiResponse>(`${this.base}/ai/answer`, {
      question,
      subject,
      session_id: session,
    })
    .pipe(
      map((res: AiResponse) => {
        const out = !res.ok
          ? (res.error ?? 'Hubo un error al generar respuesta.')
          : (res.reply ?? 'Sin respuesta.');

        return normalizeLatex(out);
      })
    );
}


  push(role: Role, text: string) {
    this.messagesSig.update((arr) => [
      ...arr,
      { id: crypto.randomUUID(), role, text, ts: Date.now() },
    ]);
  }

  clear() {
    this.messagesSig.set([]);
  }
}

