import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, User } from '../../core/auth.service';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatIconModule, MatButtonModule, MatListModule, MatTooltipModule, MatDividerModule
  ],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
})
export class ShellComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  sidebarCollapsed = false;

  // signal readonly desde AuthService
  currentUser = this.auth.currentUser;

  // nombre mostrado (si no hay name, deriva desde email)
  displayName = computed(() => {
    const user = this.currentUser();
    if (!user) return 'Usuario';
    if (user.name?.trim()) return user.name.trim();

    return this.getDisplayNameFromEmail(user.email);
  });

  // subtítulo (correo)
  displayEmail = computed(() => this.currentUser()?.email ?? '');

  // iniciales
  userInitials = computed(() => {
    const user = this.currentUser();
    if (!user) return 'U';

    const source = user.name?.trim() || this.getDisplayNameFromEmail(user.email);
    return this.getInitials(source);
  });

  // si luego backend manda picture
  userPicture = computed(() => this.currentUser()?.picture ?? null);

  isInstitutional = computed(() => {
    const email = this.currentUser()?.email ?? '';
    return this.isInstitutionalEmail(email);
  });

  toggleSidebarCollapse(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;

    // ayuda a recalcular layout del sidenav-content tras animación
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 250);
  }

  signOut(): void {
    this.auth.signOut();
  }

  private isInstitutionalEmail(email?: string | null): boolean {
    if (!email) return false;
    const e = email.toLowerCase();
    return e.endsWith('@udp.cl') || e.endsWith('@mail.udp.cl');
  }

  private getDisplayNameFromEmail(email: string): string {
    const local = (email.split('@')[0] || '').trim();
    if (!local) return 'Usuario';

    // separa por puntos, guiones, guiones bajos
    const parts = local.split(/[._-]+/).filter(Boolean);

    if (parts.length === 0) return 'Usuario';

    // "rodrigo.jeria" -> "Rodrigo Jeria"
    return parts
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }

  private getInitials(text: string): string {
    const parts = text.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
}