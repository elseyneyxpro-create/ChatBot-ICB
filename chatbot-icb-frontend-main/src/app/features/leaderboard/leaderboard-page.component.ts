import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-leaderboard-page',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="leaderboard-placeholder">
      <mat-icon>emoji_events</mat-icon>
      <h2>Ranking en construcción</h2>
      <p>El sistema de ranking está siendo rediseñado. Pronto estará disponible.</p>
    </div>
  `,
  styles: [`
    .leaderboard-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: calc(100dvh - 64px);
      gap: 1rem;
      text-align: center;
      color: #9e9e9e;

      mat-icon { font-size: 64px; width: 64px; height: 64px; color: #c5cae9; }
      h2 { margin: 0; font-size: 1.2rem; color: #555; }
      p  { margin: 0; font-size: 0.9rem; color: #aaa; max-width: 320px; line-height: 1.6; }
    }
  `],
})
export class LeaderboardPageComponent {}
