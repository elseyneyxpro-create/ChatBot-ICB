import { Component, computed, inject, ViewChild, AfterViewInit, signal } from '@angular/core';
import { MatSidenav } from '@angular/material/sidenav';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { UiService } from '../../core/ui.service';
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
    MatSidenavModule, MatToolbarModule, MatIconModule,
    MatButtonModule, MatListModule, MatTooltipModule, MatDividerModule,
  ],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
})
export class ShellComponent implements AfterViewInit {
  @ViewChild('sidenav') private sidenavRef!: MatSidenav;

  private auth = inject(AuthService);
  private router = inject(Router);

  private ui = inject(UiService);
  sidebarCollapsed = false;
  topbarHidden = computed(() => !this.ui.topbarVisible());
  currentUser = this.auth.currentUser;

  isMobile = signal(window.innerWidth <= 960);
  sidenavMode = computed<'side' | 'over'>(() => this.isMobile() ? 'over' : 'side');

  constructor() {
    window.addEventListener('resize', () => {
      const mobile = window.innerWidth <= 960;
      this.isMobile.set(mobile);
      if (!mobile) this.sidenavRef?.open();
    });
  }

  ngAfterViewInit(): void {
    if (!this.isMobile()) {
      this.sidenavRef.open();
    }
  }

  displayName = computed(() => {
    const user = this.currentUser();
    if (!user) return 'Usuario';
    if (user.displayName?.trim()) return user.displayName.trim();
    return this.getDisplayNameFromEmail(user.email ?? '');
  });

  userInitials = computed(() => {
    const user = this.currentUser();
    if (!user) return 'U';
    const source = user.displayName?.trim() || this.getDisplayNameFromEmail(user.email ?? '');
    return this.getInitials(source);
  });

  userPicture = computed(() => this.currentUser()?.photoURL ?? null);

  isInstitutional = computed(() => {
    const email = this.currentUser()?.email ?? '';
    return email.endsWith('@udp.cl') || email.endsWith('@mail.udp.cl');
  });

  toggleSidenav(): void {
    if (this.isMobile()) {
      this.sidenavRef.toggle();
    } else {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
    }
  }

  closeSidenavOnMobile(): void {
    if (this.isMobile()) this.sidenavRef.close();
  }

  onContainerClick(): void {
    if (this.isMobile() && this.sidenavRef?.opened) this.sidenavRef.close();
  }

  signOut(): void {
    this.auth.signOut();
  }

  private getDisplayNameFromEmail(email: string): string {
    const local = (email.split('@')[0] || '').trim();
    if (!local) return 'Usuario';
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length === 0) return 'Usuario';
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }

  private getInitials(text: string): string {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
}
