import {
  Component, Input, ElementRef, ViewChild,
  AfterViewChecked, signal, NgZone, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ChatMessage } from '../../core/chat.service';
import { KatexRenderPipe } from '../katex-render.pipe';
import { UiService } from '../../core/ui.service';

const THRESHOLD = 150;

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [CommonModule, MatIconModule, KatexRenderPipe],
  templateUrl: './message-list.component.html',
  styleUrl: './message-list.component.scss',
})
export class MessageListComponent implements AfterViewChecked {
  @Input({ required: true }) messages: ChatMessage[] = [];
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef<HTMLElement>;

  private zone = inject(NgZone);
  private ui = inject(UiService);
  private lastCount = 0;
  private lastText = '';
  private lastIsTyping = false;
  private userScrolledUp = false;
  private lastScrollTop = 0;

  showScrollBtn = signal(false);

  trackById(_: number, m: ChatMessage) { return m.id; }

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

  onContainerScroll() {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;

    const scrollTop = el.scrollTop;
    const dist = el.scrollHeight - scrollTop - el.clientHeight;
    const isMobile = window.innerWidth < 960;

    // Detectar dirección: mostrar/ocultar navbar solo en mobile
    if (isMobile) {
      if (scrollTop > this.lastScrollTop + 8) {
        this.ui.topbarVisible.set(false);   // scrolleando abajo → ocultar navbar
      } else if (scrollTop < this.lastScrollTop - 8) {
        this.ui.topbarVisible.set(true);    // scrolleando arriba → mostrar navbar
      }
    }
    this.lastScrollTop = scrollTop;

    // Input visible solo cuando estás abajo
    this.userScrolledUp = dist > THRESHOLD;
    this.ui.chatScrolledUp.set(this.userScrolledUp);
    this.zone.run(() => this.showScrollBtn.set(this.userScrolledUp));
  }

  scrollToBottom() {
    const el = this.scrollContainer?.nativeElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    this.userScrolledUp = false;
    this.ui.chatScrolledUp.set(false);
    this.ui.topbarVisible.set(true);
    this.zone.run(() => this.showScrollBtn.set(false));
  }

  private _pinToBottom() {
    requestAnimationFrame(() => {
      const el = this.scrollContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.zone.run(() => this.showScrollBtn.set(false));
    });
  }

  ngAfterViewChecked() {
    const msgs = this.messages;
    const count = msgs.length;
    const last = msgs[count - 1];
    const currentText = last?.text ?? '';
    const isTyping = last?.isTyping ?? false;

    if (count !== this.lastCount) {
      // Mensaje nuevo: siempre ir al fondo y resetear flag
      this.lastCount = count;
      this.lastText = currentText;
      this.lastIsTyping = isTyping;
      this.userScrolledUp = false;
      this._pinToBottom();
    } else if (isTyping && currentText !== this.lastText && !this.userScrolledUp) {
      // Typewriter en progreso: seguir escritura si no scrolleó arriba
      this.lastText = currentText;
      this.lastIsTyping = true;
      this._pinToBottom();
    } else if (!isTyping && this.lastIsTyping && !this.userScrolledUp) {
      // Animación terminó: scroll final para asegurar que estemos abajo del todo
      this.lastIsTyping = false;
      this.lastText = currentText;
      this._pinToBottom();
    } else {
      this.lastIsTyping = isTyping;
      this.lastText = currentText;
    }
  }
}
