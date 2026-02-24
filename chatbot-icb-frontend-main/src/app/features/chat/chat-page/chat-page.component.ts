import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../../core/chat.service';
import { MessageListComponent } from '../../../shared/message-list/message-list.component';
import { MessageInputComponent } from '../../../shared/message-input/message-input.component';

type BotStatus = 'ready' | 'thinking' | 'error';

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
  botStatus = signal<BotStatus>('ready');

  messages = computed(() => this.chat.messagesSig());

  async send(text: string) {
    if (!text?.trim()) return;

    // 1) agrega mensaje del usuario
    this.chat.push('user', text);

    // 2) cambia estado a pensando
    this.loading.set(true);
    this.botStatus.set('thinking');

    try {
      const res = await this.chat.ask(text, 'Cálculo', 'demo').toPromise();
      const answer = res?.reply ?? JSON.stringify(res);

      if (res?.ok === false) {
        this.chat.push('bot', '⚠️ Error del BFF');
        this.botStatus.set('error');
      } else {
        this.chat.push('bot', answer);
        this.botStatus.set('ready');
      }

    } catch (e: any) {
      const msg = e?.error?.message ?? e?.message ?? 'Error llamando al BFF';
      this.chat.push('bot', `⚠️ ${msg}`);
      this.botStatus.set('error');
    } finally {
      this.loading.set(false);
    }
  }
}