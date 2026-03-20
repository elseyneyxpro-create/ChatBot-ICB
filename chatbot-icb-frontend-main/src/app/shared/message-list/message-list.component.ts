import { Component, Input, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatMessage } from '../../core/chat.service';
import { KatexRenderPipe } from '../katex-render.pipe';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [CommonModule, KatexRenderPipe],
  templateUrl: './message-list.component.html',
  styleUrl: './message-list.component.scss',
})
export class MessageListComponent implements AfterViewChecked {
  @Input({ required: true }) messages: ChatMessage[] = [];
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef<HTMLElement>;

  private lastCount = 0;

  ngAfterViewChecked() {
    const count = this.messages.length;
    if (count !== this.lastCount) {
      this.lastCount = count;
      const el = this.scrollContainer?.nativeElement;
      if (el) {
        // Pequeño delay para que el DOM termine de renderizar el nuevo mensaje
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
  }
}
