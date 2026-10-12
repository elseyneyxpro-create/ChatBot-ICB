import { Component, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';
import { NivelacionService } from './nivelacion.service';
import { environment } from '../../../environments/environment';

/** Contenedor de la nivelación: header (XP, nivel asignado) + pantallas hijas. */
@Component({
  selector: 'app-niv-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./niv-theme.scss', './niv-layout.component.scss'],
  template: `
  <div class="niv-root">
    <header class="niv-header">
      <a class="logo" routerLink="/nivelacion">AXIOMANTE <span>NIVELACIÓN</span></a>

      <div class="header-right" *ngIf="estado() as e">
        <div class="xp" *ngIf="e.estudiante.nivel">
          <div class="xp-top">
            <span>Nivel {{ e.estudiante.nivel_xp }}</span>
            <span class="muted">{{ e.estudiante.xp_en_nivel }}/{{ e.estudiante.xp_por_nivel }} XP</span>
          </div>
          <div class="xp-bar"><div [style.width.%]="progresoXp()"></div></div>
        </div>

        <span class="nivel-chip" *ngIf="e.estudiante.nivel" title="Tu nivel lo asignan tus profesores y se ajusta según tus respuestas">
          <mat-icon>insights</mat-icon>{{ e.estudiante.nivel }}
        </span>

        <a class="btn-secondary chatbot-btn" *ngIf="devSelector" routerLink="/inicio" title="Elegir módulo">
          <mat-icon>apps</mat-icon><span>Inicio</span>
        </a>
        <a class="btn-secondary chatbot-btn" *ngIf="!devSelector && e.estudiante.chatbot_habilitado" routerLink="/app/chat">
          <mat-icon>chat</mat-icon><span>Chatbot</span>
        </a>

        <button class="avatar" (click)="salir()" title="Cerrar sesión">
          <img *ngIf="foto()" [src]="foto()" alt="" referrerpolicy="no-referrer" />
          <span *ngIf="!foto()">{{ inicial() }}</span>
        </button>
      </div>
    </header>

    <main class="niv-main">
      <div class="page" *ngIf="cargando()"><p class="muted">Cargando tu nivelación…</p></div>
      <div class="page" *ngIf="error()"><div class="error-box">{{ error() }}</div></div>

      <router-outlet *ngIf="!cargando() && !error()"></router-outlet>
    </main>
  </div>
  `,
})
export class NivLayoutComponent implements OnInit {
  private niv = inject(NivelacionService);
  private auth = inject(AuthService);
  private router = inject(Router);

  estado = this.niv.estado;
  cargando = signal(true);
  error = signal<string | null>(null);
  /** develop: botón para volver al selector de módulos */
  devSelector = !!environment.dev?.selectorModulos;

  progresoXp = computed(() => {
    const e = this.estado()?.estudiante;
    return e ? (e.xp_en_nivel / e.xp_por_nivel) * 100 : 0;
  });
  foto = computed(() => this.auth.currentUser()?.photoURL ?? null);
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

  salir() {
    this.auth.signOut();
  }
}
