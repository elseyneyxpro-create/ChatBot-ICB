import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';

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
    CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatIconModule,
    MatChipsModule, MatCardModule
  ],
  templateUrl: './video-library.component.html',
  styleUrls: ['./video-library.component.scss']
})
export class VideoLibraryComponent {
  query = signal('');
  subject = signal<Subject>('Todos');

  videos = signal<Video[]>([
    { id:'1', title:'Límites: intuición y propiedades', subject:'Cálculo', duration:'12:03', channel:'ICB', thumb:'https://i.ytimg.com/vi/5qap5aO4i9A/hqdefault.jpg' },
    { id:'2', title:'Autovalores y Autovectores',       subject:'Álgebra', duration:'16:40', channel:'ICB', thumb:'https://i.ytimg.com/vi/OHnq79rI1Wg/hqdefault.jpg' },
    { id:'3', title:'Cinemática: MRU y MRUA',           subject:'Física',  duration:'10:22', channel:'ICB', thumb:'https://i.ytimg.com/vi/2Vv-BfVoq4g/hqdefault.jpg' },
  ]);

  filtered = computed(() =>
    this.videos().filter(v =>
      (this.subject() === 'Todos' || v.subject === this.subject()) &&
      v.title.toLowerCase().includes(this.query().toLowerCase())
    )
  );

  // ← usa un método TS en vez de cast en el template
  updateQuery(ev: Event) {
    const target = ev.target as HTMLInputElement | null;
    this.query.set(target?.value ?? '');
  }
  clearQuery() {
  this.query.set('');
  }

  setSubject(s: Subject) { this.subject.set(s); }
}
