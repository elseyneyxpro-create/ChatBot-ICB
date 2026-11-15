import { Component, ElementRef, HostListener, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';
import { NivelacionService } from './nivelacion.service';
import { ThemeService } from '../../core/theme.service';

/** Contenedor de la nivelación: header (XP, nivel asignado) + pantallas hijas. */
@Component({
  selector: 'app-niv-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./niv-theme.scss', './niv-layout.component.scss'],
  template: `
  <div class="niv-root">
    <a class="saltar-contenido" href="#contenido" (click)="$event.preventDefault(); contenido.focus()">Saltar al contenido</a>
    <header class="niv-header">
      <a class="logo" routerLink="/nivelacion">AXIOMANTE <span>NIVELACIÓN</span></a>

      <div class="header-right" *ngIf="estado() as e">
        <div class="xp" *ngIf="e.estudiante.nivel">
          <div class="xp-top">
            <span>Nivel {{ e.estudiante.nivel_xp }}</span>
            <span class="muted">{{ e.estudiante.xp_en_nivel }}/{{ e.estudiante.xp_por_nivel }} XP</span>
          </div>
          <div class="xp-bar" aria-hidden="true"><div [style.width.%]="progresoXp()"></div></div>
        </div>

        <span class="nivel-chip" *ngIf="e.estudiante.nivel" title="Tu nivel lo asignan tus profesores y se ajusta según tus respuestas">
          <mat-icon>insights</mat-icon>{{ e.estudiante.nivel }}
        </span>
        <span class="dev-chip" *ngIf="e.estudiante.dev_desbloqueo" title="Modo dev: todos los mundos y nodos desbloqueados para tu cuenta">
          <mat-icon>lock_open</mat-icon><span>Modo dev</span>
        </span>

        <!-- Cambio directo al chatbot (sin pasar por /inicio) -->
        <a class="btn-secondary chatbot-btn" *ngIf="e.estudiante.chatbot_habilitado" routerLink="/app/chat" title="Ir al chatbot">
          <mat-icon>chat</mat-icon><span>Chatbot</span>
        </a>
        <span class="btn-secondary chatbot-btn bloqueado" *ngIf="!e.estudiante.chatbot_habilitado"
              title="Se desbloquea al completar la nivelación">
          <mat-icon>lock</mat-icon><span>Chatbot</span>
        </span>

        <button class="btn-secondary chatbot-btn tema-btn" type="button" (click)="theme.toggle()"
                [title]="theme.tema() === 'dark' ? 'Modo claro' : 'Modo oscuro'"
                [attr.aria-label]="theme.tema() === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'">
          <mat-icon>{{ theme.tema() === 'dark' ? 'light_mode' : 'dark_mode' }}</mat-icon>
        </button>

        <!-- Cuenta: el avatar abre un menú; cerrar sesión ya no es un clic accidental -->
        <div class="cuenta">
          <button class="avatar" type="button" (click)="menu.set(!menu())" title="Tu cuenta" aria-label="Tu cuenta"
                  aria-haspopup="menu" [attr.aria-expanded]="menu()">
            <img *ngIf="foto()" [src]="foto()" alt="" width="40" height="40" referrerpolicy="no-referrer" />
            <span *ngIf="!foto()">{{ inicial() }}</span>
          </button>
          <div class="menu-cuenta" *ngIf="menu()" role="menu">
            <div class="mc-info">
              <strong *ngIf="nombre()">{{ nombre() }}</strong>
              <small class="muted">{{ correo() }}</small>
            </div>
            <button class="mc-salir" type="button" role="menuitem" (click)="salir()">
              <mat-icon>logout</mat-icon> Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="niv-main" id="contenido" #contenido tabindex="-1">
      <div class="page" *ngIf="cargando()" role="status"><p class="muted">Cargando tu nivelación…</p></div>
      <div class="page" *ngIf="error()"><div class="error-box" role="alert">{{ error() }}</div></div>

      <router-outlet *ngIf="!cargando() && !error()"></router-outlet>
    </main>
  </div>
  `,
})
export class NivLayoutComponent implements OnInit {
  private niv = inject(NivelacionService);
  private auth = inject(AuthService);
  private router = inject(Router);
  /** Botón claro / oscuro (mismo que el chatbot) */
  theme = inject(ThemeService);

  private host = inject(ElementRef<HTMLElement>);

  estado = this.niv.estado;
  menu = signal(false);
  cargando = signal(true);
  error = signal<string | null>(null);

  progresoXp = computed(() => {
    const e = this.estado()?.estudiante;
    return e ? (e.xp_en_nivel / e.xp_por_nivel) * 100 : 0;
  });
  foto = computed(() => this.auth.currentUser()?.photoURL ?? null);
  nombre = computed(() => this.auth.currentUser()?.displayName ?? '');
  correo = computed(() => this.auth.currentUser()?.email ?? '');
  inicial = computed(() => (this.auth.currentUser()?.displayName || this.auth.currentUser()?.email || '?').charAt(0).toUpperCase());

  async ngOnInit() {
    try {
      await this.niv.cargarEstado();
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e, 'No se pudo cargar la nivelación.'));
    } finally {
      this.cargando.set(false);
    }
  }

  /** Cierra el menú de la cuenta al hacer clic fuera de él o con Escape. */
  @HostListener('document:click', ['$event'])
  clicFuera(ev: MouseEvent) {
    if (!this.menu()) return;
    const cuenta = this.host.nativeElement.querySelector('.cuenta');
    if (cuenta && !cuenta.contains(ev.target as Node)) this.menu.set(false);
  }

  @HostListener('document:keydown.escape')
  escape() { this.menu.set(false); }

  salir() {
    this.menu.set(false);
    this.auth.signOut();
  }
}
