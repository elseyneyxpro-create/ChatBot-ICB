import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatMessage } from '../../core/chat.service';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="messages">
      <div *ngFor="let m of messages" class="msg" [class.user]="m.role==='user'" [class.bot]="m.role==='bot'">
        <div class="bubble">{{ m.text }}</div>
      </div>
    </div>
  `,
  styleUrl: './message-list.component.scss',
})
export class MessageListComponent {
  @Input({ required: true }) messages: ChatMessage[] = [];
}
