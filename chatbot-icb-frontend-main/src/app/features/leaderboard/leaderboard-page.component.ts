import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Auth } from '@angular/fire/auth';
import { FirestoreService, type LeaderboardEntry } from '../../core/firestore.service';

type Vista = 'aciertos' | 'uso' | 'tema';

@Component({
  selector: 'app-leaderboard-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatIconModule, MatButtonModule, MatSelectModule, MatFormFieldModule,
  ],
  templateUrl: './leaderboard-page.component.html',
  styleUrls: ['./leaderboard-page.component.scss'],
})
export class LeaderboardPageComponent implements OnInit {
  private fs = inject(FirestoreService);
  private auth = inject(Auth);

  loading = signal(true);
  vista = signal<Vista>('aciertos');
  entries = signal<LeaderboardEntry[]>([]);
  topTemas = signal<string[]>([]);
  selectedTema = signal<string>('');

  myUid = computed(() => this.auth.currentUser?.uid ?? '');

  rankedEntries = computed(() =>
    this.entries().map((e, i) => ({ ...e, posicion: i + 1 }))
  );

  myEntry = computed(() =>
    this.rankedEntries().find(e => e.uid === this.myUid()) ?? null
  );

  totalParticipantes = computed(() => this.rankedEntries().length);

  /** Etiqueta del criterio de ordenamiento activo */
  criterioLabel = computed(() => {
    if (this.vista() === 'aciertos') return 'Mayor precisión (% aciertos)';
    if (this.vista() === 'uso') return 'Más ejercicios resueltos';
    return 'Aciertos en el tema';
  });

  /** Valor destacado para la tarjeta propia según vista */
  myHighlightValue = computed(() => {
    const me = this.myEntry();
    if (!me) return '';
    if (this.vista() === 'aciertos') return `${me.porcentaje}%`;
    if (this.vista() === 'uso') return `${me.total_ejercicios}`;
    return `${me.porcentaje}%`;
  });

  myHighlightLabel = computed(() => {
    if (this.vista() === 'aciertos') return 'precisión';
    if (this.vista() === 'uso') return 'ejercicios';
    return 'precisión';
  });

  async ngOnInit() {
    await Promise.all([
      this._loadAciertos(),
      this._loadTopTemas(),
    ]);
  }

  private async _loadAciertos() {
    this.loading.set(true);
    try {
      this.entries.set(await this.fs.getLeaderboardTotals(50, 'aciertos'));
    } catch (e) {
      console.error('[Leaderboard] aciertos error:', e);
      this.entries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private async _loadUso() {
    this.loading.set(true);
    try {
      this.entries.set(await this.fs.getLeaderboardTotals(50, 'uso'));
    } catch (e) {
      console.error('[Leaderboard] uso error:', e);
      this.entries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private async _loadTopTemas() {
    try {
      const temas = await this.fs.getTop5Temas();
      this.topTemas.set(temas);
      if (temas.length && !this.selectedTema()) this.selectedTema.set(temas[0]);
    } catch (e) {
      console.error('[Leaderboard] top temas error:', e);
    }
  }

  async setVista(v: Vista) {
    this.vista.set(v);
    if (v === 'aciertos') {
      await this._loadAciertos();
    } else if (v === 'uso') {
      await this._loadUso();
    } else if (v === 'tema' && this.selectedTema()) {
      await this._loadPorTema(this.selectedTema());
    }
  }

  async setTema(tema: string) {
    this.selectedTema.set(tema);
    if (this.vista() === 'tema') await this._loadPorTema(tema);
  }

  private async _loadPorTema(tema: string) {
    if (!tema) return;
    this.loading.set(true);
    try {
      this.entries.set(await this.fs.getLeaderboardPorTema(tema));
    } catch (e) {
      console.error('[Leaderboard] por tema error:', e);
      this.entries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  initialsOf(name: string): string {
    return (name || 'E')
      .trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }
}
