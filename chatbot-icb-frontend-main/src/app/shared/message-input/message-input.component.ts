import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface SendPayload {
  text: string;
  imageBase64?: string;
  imagePreview?: string;
}

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, TextFieldModule, MatTooltipModule,
  ],
  templateUrl: './message-input.component.html',
  styleUrls: ['./message-input.component.scss'],
})
export class MessageInputComponent {
  @Input() disabled = false;
  @Output() send = new EventEmitter<SendPayload>();
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  text = '';
  imagePreview: string | null = null;
  imageBase64: string | null = null;

  // Ctrl+V — pegar imagen desde portapapeles
  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent) {
    if (this.disabled) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) this.loadImageFile(file);
        break;
      }
    }
  }

  onSend() {
    const t = this.text?.trim();
    if (!t && !this.imageBase64) return;
    this.send.emit({
      text: t,
      imageBase64: this.imageBase64 ?? undefined,
      imagePreview: this.imagePreview ?? undefined,
    });
    this.text = '';
    this.clearImage();
  }

  openFilePicker() {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.loadImageFile(file);
    this.fileInput.nativeElement.value = '';
  }

  private loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      this.imagePreview = dataUrl;
      this.imageBase64 = dataUrl.split(',')[1];
    };
    reader.readAsDataURL(file);
  }

  clearImage() {
    this.imagePreview = null;
    this.imageBase64 = null;
  }
}
