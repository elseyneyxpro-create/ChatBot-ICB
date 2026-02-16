import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { ChatMessage } from '../../core/chat.service';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [CommonModule,MarkdownModule],
  template: `
  <div class="messages">
    <div *ngFor="let m of messages" class="msg" [class.user]="m.role==='user'" [class.bot]="m.role==='bot'">
      <div class="bubble">
        <markdown [data]="m.text"></markdown>
      </div>
    </div>
  </div>
`,

  styles: [`
  .messages { display:flex; flex-direction:column; gap:.5rem; }
  .msg { display:flex; }
  .msg.user { justify-content:flex-end; }
  .msg.bot { justify-content:flex-start; }
  .bubble { max-width:70%; padding:.5rem .75rem; border-radius:12px; }
  .msg.user .bubble { background:#1976d2; color:white; border-top-right-radius:4px; }
  .msg.bot .bubble  { background:#eee; color:#111; border-top-left-radius:4px; }

  /* Markdown pretty inside bubble */
  .bubble markdown { display:block; line-height:1.45; }
  .bubble markdown p { margin:0 0 .5rem; }
  .bubble markdown p:last-child { margin-bottom:0; }
  .bubble markdown ul, .bubble markdown ol { margin:.25rem 0 .5rem 1.25rem; }
  .bubble markdown code { padding:0 .25rem; border-radius:4px; background: rgba(0,0,0,.08); }
  .bubble markdown pre { padding:.75rem; border-radius:10px; overflow:auto; background: rgba(0,0,0,.08); }
`]

})
export class MessageListComponent {
  @Input({ required: true }) messages: ChatMessage[] = [];
}
