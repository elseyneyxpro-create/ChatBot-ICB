import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FirestoreService, type ProfileTemaStats } from '../../core/firestore.service';
import { AuthService } from '../../core/auth.service';

interface TemaCard extends ProfileTemaStats {
  total_aciertos: number;
  total_errores: number;
  total: number;
  porcentaje: number;
}

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule],
  templateUrl: './profile-page.component.html',
  styleUrls: ['./profile-page.component.scss'],
})
export class ProfilePageComponent implements OnInit {
  private fs = inject(FirestoreService);
  private router = inject(Router);
  private auth = inject(AuthService);

  loading = signal(true);
  totalAciertos = signal(0);
  totalErrores = signal(0);
  porcentaje = signal(0);
  weakPointsText = signal('');
  temas = signal<TemaCard[]>([]);

  // Datos del usuario desde Firebase Auth
  user = computed(() => this.auth.currentUser());
  displayName = computed(() => this.user()?.displayName || this.emailPrefix());
  email = computed(() => this.user()?.email ?? null);
  photoURL = computed(() => this.user()?.photoURL ?? null);
  emailPrefix = computed(() => this.user()?.email?.split('@')[0] ?? 'Estudiante');
  carrera = computed(() => {
    const e = this.email();
    if (!e) return '—';
    if (e.endsWith('@mail.udp.cl') || e.endsWith('@udp.cl')) return 'ICB · Universidad Diego Portales';
    return e.split('@')[1] ?? '—';
  });
  initials = computed(() => {
    const name = this.displayName();
    return name.trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  });

  weakPointsLines = computed(() =>
    this.weakPointsText().split('\n').map(l => l.trim()).filter(Boolean)
  );

  totalEjercicios = computed(() => this.totalAciertos() + this.totalErrores());

  async ngOnInit() {
    try {
      const stats = await this.fs.getProfileStats();
      this.totalAciertos.set(stats.total_aciertos);
      this.totalErrores.set(stats.total_errores);
      this.porcentaje.set(stats.porcentaje);
      this.weakPointsText.set(stats.weak_points_text);
      this.temas.set(this._toTemaCards(stats.temas));
    } catch (e) {
      console.error('[ProfilePage] error cargando perfil:', e);
    } finally {
      this.loading.set(false);
    }
  }

  private _toTemaCards(temas: ProfileTemaStats[]): TemaCard[] {
    return temas
      .map(t => {
        const total_aciertos = t.vof_aciertos + t.error_aciertos + t.concepto_aciertos;
        const total_errores = t.vof_errores + t.error_errores + t.concepto_errores;
        const total = total_aciertos + total_errores;
        const porcentaje = total > 0 ? Math.round((total_aciertos / total) * 100) : 0;
        return { ...t, total_aciertos, total_errores, total, porcentaje };
      })
      .filter(t => t.total > 0)
      .sort((a, b) => (b.ultima_actividad?.getTime() ?? 0) - (a.ultima_actividad?.getTime() ?? 0));
  }

  goToChat() { this.router.navigate(['/app/chat']); }
}
