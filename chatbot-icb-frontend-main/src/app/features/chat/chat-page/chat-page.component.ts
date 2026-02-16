import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../../core/chat.service';
import { MessageListComponent } from '../../../shared/message-list/message-list.component';
import { MessageInputComponent } from '../../../shared/message-input/message-input.component';
import { firstValueFrom } from 'rxjs';

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
    this.chat.push('user', text);

    this.loading.set(true);
    try {
      // ahora ask() devuelve string directamente
      const reply = await firstValueFrom(this.chat.ask(text, 'Cálculo', 'demo'));
      this.chat.push('bot', reply);
    } catch (e: any) {
      const msg = e?.error?.message ?? e?.message ?? 'Error llamando al BFF';
      this.chat.push('bot', `⚠️ ${msg}`);
    } finally {
      this.loading.set(false);
    }
  }
}
