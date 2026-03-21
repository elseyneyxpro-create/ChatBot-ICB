import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FirestoreService, ProfileSnapshot } from '../../core/firestore.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatSelectModule, MatFormFieldModule],
  templateUrl: './profile-page.component.html',
  styleUrls: ['./profile-page.component.scss'],
})
export class ProfilePageComponent implements OnInit {
  private fs = inject(FirestoreService);
  private router = inject(Router);
  private auth = inject(AuthService);

  loading = signal(true);
  snapshots = signal<ProfileSnapshot[]>([]);
  selectedTema = signal<string>('');
  totalPreguntas = signal(0);

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

  temas = computed(() => [...new Set(this.snapshots().map(s => s.tema))].sort());

  filteredSnapshots = computed(() => {
    const tema = this.selectedTema();
    return tema ? this.snapshots().filter(s => s.tema === tema) : this.snapshots();
  });

  latestPerTema = computed(() => {
    const map = new Map<string, ProfileSnapshot>();
    for (const s of this.snapshots()) {
      if (!map.has(s.tema)) map.set(s.tema, s);
    }
    return [...map.values()];
  });

  async ngOnInit() {
    const [data, stats] = await Promise.all([
      this.fs.getSnapshots(),
      this.fs.getUserStats(),
    ]);
    this.snapshots.set(data);
    this.totalPreguntas.set(stats.total_hilos_global);
    this.loading.set(false);
  }

  setTema(tema: string) { this.selectedTema.set(tema); }
  goToChat() { this.router.navigate(['/app/chat']); }
}
