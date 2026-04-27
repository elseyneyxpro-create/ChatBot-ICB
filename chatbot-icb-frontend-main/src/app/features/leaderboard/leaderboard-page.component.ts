import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Auth } from '@angular/fire/auth';
import { FirestoreService, type LeaderboardEntry } from '../../core/firestore.service';

type Vista = 'totales' | 'tema';

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
  vista = signal<Vista>('totales');
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

  async ngOnInit() {
    await Promise.all([
      this._loadTotales(),
      this._loadTopTemas(),
    ]);
  }

  private async _loadTotales() {
    this.loading.set(true);
    try {
      this.entries.set(await this.fs.getLeaderboardTotals());
    } catch (e) {
      console.error('[Leaderboard] totales error:', e);
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
    if (v === 'totales') {
      await this._loadTotales();
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
