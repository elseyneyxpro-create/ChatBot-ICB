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
import { KatexRenderPipe } from '../../../shared/katex-render.pipe';

const MAX_CHATS = 6;

export interface EjercicioEstado {
  concepto: { answered: boolean; loading: boolean; es_correcto?: boolean; feedback?: string; texto: string };
  vof:     { answered: boolean; es_correcto?: boolean; selected?: boolean };
  error:   { answered: boolean; es_correcto?: boolean; selected_paso?: number };
}

function emptyEjercicioEstado(): EjercicioEstado {
  return {
    concepto: { answered: false, loading: false, texto: '' },
    vof:      { answered: false },
    error:    { answered: false },
  };
}

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatDialogModule, MatProgressSpinnerModule,
    MessageListComponent, MessageInputComponent, KatexRenderPipe,
  ],
  templateUrl: './chat-page.component.html',
  styleUrls: ['./chat-page.component.scss'],
})
export class ChatPageComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private firestoreService = inject(FirestoreService);
  private ui = inject(UiService);
  private dialog = inject(MatDialog);
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

  // ── Estado ejercicios ──────────────────────────────────────────────────────
  ejercState = signal<EjercicioEstado>(emptyEjercicioEstado());
  currentTema = signal<string | null>(null);

  /** Ejercicios suficientes completados: concepto + (vof O error) */
  ejercCompletados = computed(() => {
    const s = this.ejercState();
    return s.concepto.answered && (s.vof.answered || s.error.answered);
  });

  /** El chat queda bloqueado mientras haya ejercicios pendientes */
  chatBloqueado = computed(() => {
    const r = this.reinforcement();
    if (!r?.ejercicios?.length) return false;
    return !this.ejercCompletados();
  });

  // Ejercicios indexados por tipo para acceso rápido en el template
  ejercicioConcepto = computed(() =>
    this.reinforcement()?.ejercicios?.find(e => e.tipo === 'concepto') ?? null
  );
  ejercicioVoF = computed(() =>
    this.reinforcement()?.ejercicios?.find(e => e.tipo === 'verdadero_falso') ?? null
  );
  ejercicioError = computed(() =>
    this.reinforcement()?.ejercicios?.find(e => e.tipo === 'encuentra_el_error') ?? null
  );

  // ── Chats ──────────────────────────────────────────────────────────────────
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
    this.chat.setActiveChat(chat.id, chat.total_hilos, chat.resumen_rolling ?? '');
    this.chat.clear();
    this.ejercState.set(emptyEjercicioEstado());
    this.currentTema.set(null);
    await this.chat.loadUserMessages(chat.id, chat.last_reinforcement);
    this.currentTema.set(this.chat.lastTemaSig());
    this._restoreEjercicioEstadoFromHilo();
    const videos = chat.last_videos?.length
      ? chat.last_videos
      : (chat.last_reinforcement?.videos ?? []);
    if (videos.length) {
      this.chat.setVideos(videos);
    }
  }

  /**
   * Reconstruye el estado del panel de ejercicios desde el reinforcement
   * persistido en el último hilo (incluye respuestas previas del alumno).
   */
  private _restoreEjercicioEstadoFromHilo() {
    const ejs = this.chat.restoredEjerciciosSig();
    if (!ejs?.length) return;
    const estado = emptyEjercicioEstado();
    for (const ej of ejs) {
      if (!ej.respondido) continue;
      if (ej.tipo === 'concepto') {
        estado.concepto = {
          answered: true,
          loading: false,
          texto: typeof ej.respuesta_alumno === 'string' ? ej.respuesta_alumno : '',
          es_correcto: ej.es_correcto,
          feedback: ej.feedback ?? '',
        };
      } else if (ej.tipo === 'verdadero_falso') {
        estado.vof = {
          answered: true,
          es_correcto: ej.es_correcto,
          selected: typeof ej.respuesta_alumno === 'boolean' ? ej.respuesta_alumno : undefined,
        };
      } else if (ej.tipo === 'encuentra_el_error') {
        estado.error = {
          answered: true,
          es_correcto: ej.es_correcto,
          selected_paso: typeof ej.respuesta_alumno === 'number' ? ej.respuesta_alumno : undefined,
        };
      }
    }
    this.ejercState.set(estado);
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

  // ── Ejercicios ─────────────────────────────────────────────────────────────

  setConceptoTexto(texto: string) {
    this.ejercState.update(s => ({ ...s, concepto: { ...s.concepto, texto } }));
  }

  async responderConcepto() {
    const texto = this.ejercState().concepto.texto.trim();
    const ej = this.ejercicioConcepto();
    const tema = this.currentTema();
    if (!texto || !ej || !tema) return;

    this.ejercState.update(s => ({ ...s, concepto: { ...s.concepto, loading: true } }));

    try {
      const res = await firstValueFrom(
        this.chat.evaluateConcepto(ej.enunciado, texto, tema)
      );
      this.zone.run(() => {
        this.ejercState.update(s => ({
          ...s,
          concepto: {
            ...s.concepto,
            answered: true,
            loading: false,
            es_correcto: res.es_correcto,
            feedback: res.feedback,
          },
        }));
      });
      this._persistEjercicio('concepto', {
        es_correcto: res.es_correcto,
        respuesta_alumno: texto,
        feedback: res.feedback,
      });
      this.chat.saveExerciseResult(tema, 'concepto', res.es_correcto);
    } catch (e) {
      console.error('[ChatPage] evaluateConcepto error:', e);
      this.ejercState.update(s => ({
        ...s,
        concepto: { ...s.concepto, loading: false, answered: true, es_correcto: false, feedback: 'Error al evaluar.' },
      }));
    }
  }

  responderVoF(seleccion: boolean) {
    const ej = this.ejercicioVoF();
    const tema = this.currentTema();
    if (!ej || this.ejercState().vof.answered) return;

    const es_correcto = seleccion === ej.respuesta_correcta;
    this.ejercState.update(s => ({
      ...s,
      vof: { answered: true, es_correcto, selected: seleccion },
    }));

    this._persistEjercicio('verdadero_falso', { es_correcto, respuesta_alumno: seleccion });
    if (tema) {
      this.chat.saveExerciseResult(tema, 'vof', es_correcto);
    }
  }

  responderError(paso: number) {
    const ej = this.ejercicioError();
    const tema = this.currentTema();
    if (!ej || this.ejercState().error.answered) return;

    const es_correcto = paso === ej.paso_error;
    this.ejercState.update(s => ({
      ...s,
      error: { answered: true, es_correcto, selected_paso: paso },
    }));

    this._persistEjercicio('encuentra_el_error', { es_correcto, respuesta_alumno: paso });
    if (tema) {
      this.chat.saveExerciseResult(tema, 'error', es_correcto);
    }
  }

  /** Persiste la respuesta del alumno en el reinforcement embebido del último hilo. */
  private _persistEjercicio(
    tipo: 'concepto' | 'verdadero_falso' | 'encuentra_el_error',
    update: { es_correcto: boolean; respuesta_alumno: any; feedback?: string },
  ) {
    const hiloId = this.chat.lastHiloIdSig();
    if (!hiloId) return;
    this.firestoreService.updateHiloEjercicio(hiloId, tipo, update)
      .catch(e => console.warn('[ChatPage] persistEjercicio falló:', e));
  }

  // ── Videos ─────────────────────────────────────────────────────────────────

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
    if (v) return v.url;
    // Fallback: cualquier video disponible que no sea 'ejemplo'
    const fallback = this.videos().find(v => v.categoria !== 'ejemplo');
    return fallback?.url ?? null;
  }

  sidebarVideos = computed(() =>
    this.videos().filter(v => !['concepto', 'v o f', 'encuentre el error', 'ejemplo'].includes(v.categoria))
  );

  // ── Envío de mensajes ──────────────────────────────────────────────────────

  async send(payload: SendPayload) {
    if (!this.activeChatId() || this.chatBloqueado()) return;

    this.chat.push('user', payload.text, payload.imagePreview);
    this.loading.set(true);
    this.elapsedSeconds.set(0);
    this._stopReinforcementListener();
    this.chat.setReinforcement(null);
    // Resetear estado de ejercicios para la nueva ronda
    this.ejercState.set(emptyEjercicioEstado());

    const requestTime = Date.now() / 1000;

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
        if (allVideos.length && this.activeChatId()) {
          this.firestoreService.saveLastVideos(this.activeChatId()!, allVideos);
        }
        this.chat.saveExchange(payload.text, reply, res.tema ?? null, ejemploUrls);

        // Guardar tema para los ejercicios
        if (res.tema) {
          this.currentTema.set(res.tema);
        }

        // Escuchar reinforcement por Firestore
        if (res.tema && this.activeChatId()) {
          this.zone.run(() => this.reinforcementLoading.set(true));
          this.reinforcementUnsubscribe = this.firestoreService.watchReinforcement(
            this.activeChatId()!,
            (r) => {
              if (r && r.saved_at && r.saved_at > requestTime) {
                this.zone.run(() => {
                  this.chat.setReinforcement(r);
                  this.ejercState.set(emptyEjercicioEstado());
                  this._stopReinforcementListener();
                });
                // Persistir el reinforcement embebido en el último hilo (id_tail).
                const chatId = this.activeChatId();
                if (chatId) {
                  this.firestoreService.updateHiloReinforcement(chatId, r)
                    .catch(e => console.warn('[ChatPage] updateHiloReinforcement falló:', e));
                }
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
