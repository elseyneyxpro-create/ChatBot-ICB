import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../../core/chat.service';
import { MessageListComponent } from '../../../shared/message-list/message-list.component';
import { MessageInputComponent } from '../../../shared/message-input/message-input.component';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, MessageListComponent, MessageInputComponent],
  templateUrl: './chat-page.component.html',
  styleUrls: ['./chat-page.component.scss'],
})
export class ChatPageComponent {
  private chat = inject(ChatService);

  loading = signal(false);
  messages = computed(() => this.chat.messagesSig());

  async send(text: string) {
    // 1) agrega mensaje del usuario
    this.chat.push('user', text);

    // 2) llama al BFF
    this.loading.set(true);
    try {
      const res = await this.chat.ask(text, 'Cálculo', 'demo').toPromise();
      // adapta según la forma en que responde tu Python.
      // Ejemplo genérico:
      const answer =
        typeof res === 'string'
          ? res
          : res?.answer ?? res?.message ?? JSON.stringify(res);
      this.chat.push('bot', answer);
    } catch (e: any) {
      const msg = e?.error?.message ?? e?.message ?? 'Error llamando al BFF';
      this.chat.push('bot', `⚠️ ${msg}`);
    } finally {
      this.loading.set(false);
    }
  }
}
