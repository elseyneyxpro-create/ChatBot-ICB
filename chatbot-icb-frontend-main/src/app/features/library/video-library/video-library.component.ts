import { Component, signal, computed, inject, OnInit, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../../../environments/environment';

interface Video {
  url: string;
  tema: string;
  categoria: string;
}

@Component({
  selector: 'app-video-library',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatIconModule,
    MatChipsModule, MatCardModule, MatProgressSpinnerModule,
  ],
  templateUrl: './video-library.component.html',
  styleUrls: ['./video-library.component.scss']
})
export class VideoLibraryComponent implements OnInit {
  private http    = inject(HttpClient);
  private base    = environment.AGENTS_URL;
  private elRef   = inject(ElementRef);

  query        = signal('');
  selectedTema = signal('Todos');
  allVideos    = signal<Video[]>([]);
  temas        = signal<string[]>([]);
  loading      = signal(true);
  error        = signal(false);
  panelOpen    = signal(false);

  isFiltered = computed(() => this.selectedTema() !== 'Todos');

  /** Búsqueda dentro del panel de filtros (hay muchos temas) */
  temaQuery = signal('');

  /** Cantidad de videos por tema, para mostrarla en cada opción */
  conteoTema = computed(() => {
    const m = new Map<string, number>();
    for (const v of this.allVideos()) m.set(v.tema, (m.get(v.tema) ?? 0) + 1);
    return m;
  });

  /** Temas que calzan con la búsqueda del panel (sin tildes ni mayúsculas) */
  temasFiltrados = computed(() => {
    const q = this.normalizar(this.temaQuery());
    return q ? this.temas().filter(t => this.normalizar(t).includes(q)) : this.temas();
  });

  private normalizar(s: string) {
    return (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  updateTemaQuery(ev: Event) {
    this.temaQuery.set((ev.target as HTMLInputElement).value ?? '');
  }

  // Cierra el panel si el click fue fuera del componente
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    if (this.panelOpen() && !this.elRef.nativeElement.contains(e.target)) {
      this.panelOpen.set(false);
    }
  }

  togglePanel() {
    this.panelOpen.update(v => !v);
    if (this.panelOpen()) this.temaQuery.set('');
  }

  @HostListener('document:keydown.escape')
  onEsc() { this.panelOpen.set(false); }

  selectTema(t: string) {
    this.selectedTema.set(t);
    this.panelOpen.set(false);
  }

  filtered = computed(() => {
    const q = this.query().toLowerCase();
    const t = this.selectedTema();
    return this.allVideos().filter(v =>
      (t === 'Todos' || v.tema === t) &&
      (v.url.toLowerCase().includes(q) || v.tema.toLowerCase().includes(q))
    );
  });

  ngOnInit() {
    this.http.get<{ videos: Video[]; temas: string[] }>(`${this.base}${environment.endpoints.ai.videos}`).subscribe({
      next: (res) => {
        this.allVideos.set(res.videos ?? []);
        this.temas.set(res.temas ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }

  updateQuery(ev: Event) {
    this.query.set((ev.target as HTMLInputElement).value ?? '');
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
}
