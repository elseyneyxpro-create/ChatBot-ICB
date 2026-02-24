import { Component, computed, signal } from '@angular/core';
import { CommonModule, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

type Subject = 'Todos' | 'Cálculo' | 'Álgebra' | 'Física';

interface Video {
  id: string;
  title: string;
  subject: Subject;
  duration: string;
  channel: string;
  thumb: string;
}

@Component({
  selector: 'app-video-library',
  standalone: true,
  imports: [
    CommonModule,
    NgClass,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
    MatButtonModule
  ],
  templateUrl: './video-library.component.html',
  styleUrls: ['./video-library.component.scss']
})
export class VideoLibraryComponent {
  query = signal('');
  subject = signal<Subject>('Todos');

  videos = signal<Video[]>([
    {
      id: '1',
      title: 'Límites: intuición y propiedades',
      subject: 'Cálculo',
      duration: '12:03',
      channel: 'ICB',
      thumb: 'https://i.ytimg.com/vi/5qap5aO4i9A/hqdefault.jpg'
    },
    {
      id: '2',
      title: 'Autovalores y Autovectores',
      subject: 'Álgebra',
      duration: '16:40',
      channel: 'ICB',
      thumb: 'https://i.ytimg.com/vi/OHnq79rI1Wg/hqdefault.jpg'
    },
    {
      id: '3',
      title: 'Cinemática: MRU y MRUA',
      subject: 'Física',
      duration: '10:22',
      channel: 'ICB',
      thumb: 'https://i.ytimg.com/vi/2Vv-BfVoq4g/hqdefault.jpg'
    }
  ]);

  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const s = this.subject();

    return this.videos().filter(v =>
      (s === 'Todos' || v.subject === s) &&
      (q === '' ||
        v.title.toLowerCase().includes(q) ||
        v.subject.toLowerCase().includes(q) ||
        v.channel.toLowerCase().includes(q))
    );
  });

  updateQuery(ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    this.query.set(target?.value ?? '');
  }

  setSubject(s: Subject): void {
    this.subject.set(s);
  }

  clearFilters(): void {
    this.query.set('');
    this.subject.set('Todos');
  }

  trackByVideoId(_: number, v: Video): string {
    return v.id;
  }

  subjectClass(subject: Subject): string {
    switch (subject) {
      case 'Cálculo':
        return 'calc';
      case 'Álgebra':
        return 'alg';
      case 'Física':
        return 'phy';
      default:
        return 'all';
    }
  }
}