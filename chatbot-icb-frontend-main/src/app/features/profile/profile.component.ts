import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service'; // ajusta ruta si cambia

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent {
  private auth = inject(AuthService);

  user = this.auth.currentUser; // signal readonly

  displayName = computed(() => {
    const u = this.user();
    if (!u) return 'Usuario';
    if (u.name?.trim()) return u.name.trim();
    return this.getDisplayNameFromEmail(u.email);
  });

  email = computed(() => this.user()?.email ?? 'Sin correo');
  sub = computed(() => this.user()?.sub ?? 'Sin ID');

  picture = computed(() => this.user()?.picture ?? null);

  initials = computed(() => {
    const u = this.user();
    if (!u) return 'U';

    const source = u.name?.trim() || this.getDisplayNameFromEmail(u.email);
    return this.getInitials(source);
  });

  isInstitutional = computed(() => {
    const email = (this.user()?.email ?? '').toLowerCase();
    return email.endsWith('@udp.cl') || email.endsWith('@mail.udp.cl');
  });

  accountType = computed(() => {
    if (!this.user()) return 'Sin sesión';
    return this.isInstitutional() ? 'Cuenta institucional' : 'Cuenta Google';
  });

  // Datos “derivados” útiles para mostrar mientras no tengas backend de perfil
  careerSuggestion = computed(() => {
    if (this.isInstitutional()) return 'Ingeniería Civil Informática y Telecomunicaciones';
    return 'No definida';
  });

  username = computed(() => {
    const email = this.user()?.email ?? '';
    return email ? email.split('@')[0] : 'usuario';
  });

  private getDisplayNameFromEmail(email: string): string {
    const local = (email.split('@')[0] || '').trim();
    if (!local) return 'Usuario';

    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }

  private getInitials(text: string): string {
    const parts = text.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // placeholder por ahora
  editProfile(): void {
    console.log('Editar perfil (pendiente backend)');
  }
}