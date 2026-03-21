import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FirestoreService, type LeaderboardEntry } from '../../core/firestore.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-leaderboard-page',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './leaderboard-page.component.html',
  styleUrls: ['./leaderboard-page.component.scss'],
})
export class LeaderboardPageComponent implements OnInit, OnDestroy {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  entries = signal<LeaderboardEntry[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  currentUid = this.authService.currentUser()?.uid ?? null;

  private unsubscribe: (() => void) | null = null;

  get top3() { return this.entries().slice(0, 3); }
  get rest()  { return this.entries().slice(3); }

  ngOnInit() {
    this.unsubscribe = this.firestoreService.watchLeaderboard(
      (entries) => {
        this.entries.set(entries);
        this.loading.set(false);
        this.error.set(null);
      },
      (err) => {
        console.error('[Leaderboard] Error:', err);
        this.error.set(err?.message ?? 'Error al cargar el ranking.');
        this.loading.set(false);
      },
    );
  }

  ngOnDestroy() {
    this.unsubscribe?.();
  }

  getInitials(name: string): string {
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  getCarrera(email: string | null): string {
    if (!email) return '—';
    if (email.endsWith('@mail.udp.cl') || email.endsWith('@udp.cl')) return 'ICB · UDP';
    return email.split('@')[1] ?? '—';
  }

  isMe(uid: string): boolean {
    return uid === this.currentUid;
  }
}
