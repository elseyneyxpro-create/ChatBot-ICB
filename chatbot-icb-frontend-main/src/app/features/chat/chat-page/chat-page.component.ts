import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { ChatService } from '../../../core/chat.service';
import { FirestoreService, type ChatNr } from '../../../core/firestore.service';
import { MessageListComponent } from '../../../shared/message-list/message-list.component';
import { MessageInputComponent, type SendPayload } from '../../../shared/message-input/message-input.component';
import { NewChatDialogComponent } from './new-chat-dialog.component';

const MAX_CHATS = 6;

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatDialogModule,
    MessageListComponent, MessageInputComponent,
  ],
  templateUrl: './chat-page.component.html',
  styleUrls: ['./chat-page.component.scss'],
})
export class ChatPageComponent implements OnInit {
  private chat = inject(ChatService);
  private firestoreService = inject(FirestoreService);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  loading = signal(false);
  elapsedSeconds = signal(0);
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  messages = computed(() => this.chat.messagesSig());
  reinforcement = computed(() => this.chat.reinforcementSig());
  videos = computed(() => this.chat.videosSig());

  chatList = signal<ChatNr[]>([]);
  activeChatId = signal<string | null>(null);
  maxChatsReached = signal(false);

  async ngOnInit() {
    await this.loadChatList();
  }

  async loadChatList() {
    let list: ChatNr[] = [];
    try {
      list = await this.firestoreService.getChatList();
    } catch (e) {
      console.error('[ChatPage] getChatList error:', e);
    }
    this.chatList.set(list);
    this.maxChatsReached.set(list.length >= MAX_CHATS);

    // Si hay chats, cargar el primero automáticamente
    if (list.length > 0 && !this.activeChatId()) {
      await this.selectChat(list[0]);
    }
  }

  async selectChat(chat: ChatNr) {
    if (this.activeChatId() === chat.id) return;
    this.activeChatId.set(chat.id);
    this.chat.setActiveChat(chat.id, chat.total_hilos);
    this.chat.clear();
    await this.chat.loadUserMessages(chat.id);
  }

  async openNewChatDialog() {
    if (this.maxChatsReached()) return;

    const ref = this.dialog.open(NewChatDialogComponent, { width: '320px' });
    const nombre = await ref.afterClosed().toPromise();
    if (!nombre?.trim()) return;

    const newChat = await this.firestoreService.createChat(nombre.trim());
    const updated = [newChat, ...this.chatList()];
    this.chatList.set(updated);
    this.maxChatsReached.set(updated.length >= MAX_CHATS);
    await this.selectChat(newChat);
  }

  goToProfile() {
    this.router.navigate(['/app/perfil']);
  }

  getYouTubeId(url: string): string | null {
    const patterns = [
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtu\.be\/([^?&]+)/,
      /youtube\.com\/embed\/([^?&]+)/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  async send(payload: SendPayload) {
    if (!this.activeChatId()) return;
    this.chat.push('user', payload.text, payload.imagePreview);
    this.loading.set(true);
    this.elapsedSeconds.set(0);
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds.update(s => s + 1);
    }, 1000);

    try {
      const res = await this.chat.ask(payload.text, payload.imageBase64).toPromise();

      if (res?.ok) {
        const reply = res.reply ?? '';
        this.chat.push('bot', reply);
        this.chat.setReinforcement(res.reinforcement ?? null);
        this.chat.setVideos(res.videos ?? []);
        await this.chat.saveExchange(payload.text, reply, res.tema ?? null);
      } else {
        this.chat.push('bot', `⚠️ ${res?.error ?? 'Error del agente'}`);
      }
    } catch (e: any) {
      this.chat.push('bot', `⚠️ ${e?.message ?? 'Error de conexión'}`);
    } finally {
      this.loading.set(false);
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    }
  }
}
