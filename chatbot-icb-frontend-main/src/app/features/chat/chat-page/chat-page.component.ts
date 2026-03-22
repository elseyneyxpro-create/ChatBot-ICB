import { Component, computed, inject, signal, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ChatService, type VideoItem } from '../../../core/chat.service';
import { FirestoreService, type ChatNr } from '../../../core/firestore.service';
import { UiService } from '../../../core/ui.service';
import { MessageListComponent } from '../../../shared/message-list/message-list.component';
import { MessageInputComponent, type SendPayload } from '../../../shared/message-input/message-input.component';
import { NewChatDialogComponent } from './new-chat-dialog.component';

const MAX_CHATS = 6;

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatDialogModule, MatProgressSpinnerModule,
    MessageListComponent, MessageInputComponent,
  ],
  templateUrl: './chat-page.component.html',
  styleUrls: ['./chat-page.component.scss'],
})
export class ChatPageComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private firestoreService = inject(FirestoreService);
  private ui = inject(UiService);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);

  chatScrolledUp = computed(() => this.ui.chatScrolledUp());

  loading = signal(false);
  reinforcementLoading = signal(false);
  hasError = signal(false);
  elapsedSeconds = signal(0);
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private reinforcementUnsubscribe: (() => void) | null = null;
  private reinforcementTimeout: ReturnType<typeof setTimeout> | null = null;

  messages = computed(() => this.chat.messagesSig());
  reinforcement = computed(() => this.chat.reinforcementSig());
  videos = computed(() => this.chat.videosSig());
  botStatus = computed<'ready' | 'thinking' | 'error'>(() =>
    this.hasError() ? 'error' : this.loading() ? 'thinking' : 'ready'
  );

  chatList = signal<ChatNr[]>([]);
  activeChatId = signal<string | null>(null);
  maxChatsReached = signal(false);
  showMobileChats = signal(false);
  showMobileReinforcement = signal(false);

  renamingChatId = signal<string | null>(null);
  renamingName = signal('');

  async ngOnInit() {
    await this.loadChatList();
  }

  ngOnDestroy() {
    this._stopReinforcementListener();
  }

  private _stopReinforcementListener() {
    this.reinforcementUnsubscribe?.();
    this.reinforcementUnsubscribe = null;
    if (this.reinforcementTimeout) {
      clearTimeout(this.reinforcementTimeout);
      this.reinforcementTimeout = null;
    }
    this.reinforcementLoading.set(false);
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

    if (list.length > 0 && !this.activeChatId()) {
      await this.selectChat(list[0]);
    }
  }

  async selectChat(chat: ChatNr) {
    if (this.activeChatId() === chat.id) { this.showMobileChats.set(false); return; }
    this._stopReinforcementListener();
    this.activeChatId.set(chat.id);
    this.showMobileChats.set(false);
    this.chat.setActiveChat(chat.id, chat.total_hilos, chat.resumen_conversacion ?? '');
    this.chat.clear();
    await this.chat.loadUserMessages(chat.id, chat.last_reinforcement);
  }

  startRename(chat: ChatNr, event: Event) {
    event.stopPropagation();
    this.renamingChatId.set(chat.id);
    this.renamingName.set(chat.nombre);
  }

  async confirmRename(chat: ChatNr) {
    const nombre = this.renamingName().trim();
    this.renamingChatId.set(null);
    if (!nombre || nombre === chat.nombre) return;
    try {
      await this.firestoreService.renameChat(chat.id, nombre);
      this.chatList.update(list => list.map(c => c.id === chat.id ? { ...c, nombre } : c));
    } catch (e) {
      console.error('[ChatPage] renameChat error:', e);
    }
  }

  async deleteChat(chat: ChatNr, event: Event) {
    event.stopPropagation();
    if (!confirm(`¿Eliminar el chat "${chat.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.firestoreService.deleteChat(chat.id);
      const updated = this.chatList().filter(c => c.id !== chat.id);
      this.chatList.set(updated);
      this.maxChatsReached.set(updated.length >= MAX_CHATS);
      if (this.activeChatId() === chat.id) {
        this._stopReinforcementListener();
        this.chat.clear();
        this.activeChatId.set(updated.length > 0 ? updated[0].id : null);
        if (updated.length > 0) await this.selectChat(updated[0]);
      }
    } catch (e) {
      console.error('[ChatPage] deleteChat error:', e);
    }
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

  getVideoByCategoria(categoria: string): string | null {
    const v = this.videos().find(v => v.categoria === categoria);
    return v?.url ?? null;
  }

  sidebarVideos = computed(() =>
    this.videos().filter(v => !['concepto', 'v o f', 'encuentre el error', 'ejemplo'].includes(v.categoria))
  );

  async send(payload: SendPayload) {
    if (!this.activeChatId()) return;
    this.chat.push('user', payload.text, payload.imagePreview);
    this.loading.set(true);
    this.elapsedSeconds.set(0);
    // Clear old reinforcement and stop any pending listener
    this._stopReinforcementListener();
    this.chat.setReinforcement(null);
    const requestTime = Date.now() / 1000; // Unix seconds, to match backend saved_at

    this.timerInterval = setInterval(() => {
      this.elapsedSeconds.update(s => s + 1);
    }, 1000);

    try {
      const res = await firstValueFrom(this.chat.ask(payload.text, payload.imageBase64));

      if (res?.ok) {
        const reply = res.reply ?? '';
        const allVideos = res.videos ?? [];
        const ejemploUrls = allVideos.filter(v => v.categoria === 'ejemplo').map(v => v.url);
        await this.chat.pushWithTypewriter('bot', reply, ejemploUrls);
        this.chat.setVideos(allVideos);
        this.chat.saveExchange(payload.text, reply, res.tema ?? null);

        // Start listening for reinforcement via Firestore (comes in background)
        if (res.tema && this.activeChatId()) {
          this.zone.run(() => this.reinforcementLoading.set(true));
          this.reinforcementUnsubscribe = this.firestoreService.watchReinforcement(
            this.activeChatId()!,
            (r) => {
              if (r && r.saved_at && r.saved_at > requestTime) {
                this.zone.run(() => {
                  this.chat.setReinforcement(r);
                  this._stopReinforcementListener();
                });
              }
            }
          );
          this.reinforcementTimeout = setTimeout(() => this._stopReinforcementListener(), 45000);
        }
      } else {
        this.chat.push('bot', `⚠️ ${res?.error ?? 'Error del agente'}`);
      }
    } catch (e: any) {
      this.zone.run(() => {
        this.chat.push('bot', `⚠️ ${e?.message ?? 'Error de conexión'}`);
        this.hasError.set(true);
      });
    } finally {
      this.zone.run(() => {
        this.loading.set(false);
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
        setTimeout(() => this.hasError.set(false), 4000);
      });
    }
  }
}
