import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';

/**
 * Pantalla después del login: elegir Chatbot o Nivelación.
 * Si el chatbot no está habilitado para el alumno, su tarjeta aparece bloqueada.
 * (Solo para develop: se activa con environment.dev.selectorModulos)
 */
@Component({
  selector: 'app-selector-modulo',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  styles: [`
    :host {
      display: flex; min-height: 100dvh; align-items: center; justify-content: center; padding: 24px;
      background: linear-gradient(160deg, #283593 0%, #e8eaf6 58%, #f5f6fa 100%);
      font-family: 'Outfit', 'Roboto', sans-serif; overflow-y: auto;
    }
    .wrap { display: flex; flex-direction: column; align-items: center; gap: 28px; width: 100%; max-width: 820px; }
    .saludo { text-align: center; color: #fff; text-shadow: 0 2px 12px rgba(26, 35, 126, 0.4); }
    .saludo h1 { margin: 0 0 6px; font-size: 2rem; font-weight: 700; }
    .saludo p { margin: 0; font-size: 1.05rem; opacity: 0.9; }
    .tarjetas { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; width: 100%; }
    .tarjeta {
      position: relative; display: flex; flex-direction: column; gap: 14px; padding: 30px 26px; text-align: left;
      border-radius: 22px; border: none; cursor: pointer; color: #fff; font-family: inherit;
      box-shadow: 0 12px 32px rgba(26, 35, 126, 0.28);
      transition: transform 0.25s ease, box-shadow 0.25s ease;
      animation: entrar 0.45s ease both;
    }
    .tarjeta:nth-child(2) { animation-delay: 0.1s; }
    .tarjeta:hover:not(.bloqueada) { transform: translateY(-6px); box-shadow: 0 18px 40px rgba(26, 35, 126, 0.38); }
    .chat { background: linear-gradient(145deg, #1a237e, #3949ab); }
    .niv { background: linear-gradient(145deg, #6d28d9, #db2777); }
    .icono {
      width: 64px; height: 64px; border-radius: 18px; background: rgba(255, 255, 255, 0.18);
      display: flex; align-items: center; justify-content: center;
    }
    .icono mat-icon { font-size: 36px; width: 36px; height: 36px; }
    h2 { margin: 0; font-size: 1.45rem; }
    .desc { margin: 0; font-size: 0.95rem; line-height: 1.45; opacity: 0.9; }
    .ir { margin-top: auto; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 0.95rem; }
    .ir mat-icon { font-size: 20px; width: 20px; height: 20px; }

    .bloqueada { cursor: not-allowed; filter: grayscale(0.85); opacity: 0.75; }
    .candado {
      position: absolute; top: 18px; right: 18px; width: 40px; height: 40px; border-radius: 50%;
      background: rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center;
    }
    .bloqueada .ir { opacity: 0.9; }
    .dev { font-size: 0.75rem; color: #5c6bc0; background: rgba(255, 255, 255, 0.7); padding: 4px 10px; border-radius: 10px; }
    @keyframes entrar { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
    @media (max-width: 680px) { .tarjetas { grid-template-columns: 1fr; } .saludo h1 { font-size: 1.6rem; } }
  `],
  template: `
    <div class="wrap">
      <div class="saludo">
        <h1>¡Hola{{ nombre() ? ', ' + nombre() : '' }}! 👋</h1>
        <p>¿Qué quieres hacer hoy?</p>
      </div>

      <div class="tarjetas">
        <button class="tarjeta chat" [class.bloqueada]="!chatHabilitado()" [disabled]="!chatHabilitado()"
                [attr.aria-disabled]="!chatHabilitado()" (click)="ir('/app/chat')">
          <span class="candado" *ngIf="!chatHabilitado()"><mat-icon>lock</mat-icon></span>
          <span class="icono"><mat-icon>{{ chatHabilitado() ? 'chat' : 'speaker_notes_off' }}</mat-icon></span>
          <h2>Chatbot Axiomante</h2>
          <p class="desc">Tu tutor de Cálculo con IA: haz preguntas, recibe videos y ejercicios de refuerzo.</p>
          <span class="ir" *ngIf="chatHabilitado()">Entrar <mat-icon>arrow_forward</mat-icon></span>
          <span class="ir" *ngIf="!chatHabilitado()"><mat-icon>lock</mat-icon> Se habilita al completar la nivelación</span>
        </button>

        <button class="tarjeta niv" (click)="ir('/nivelacion')">
          <span class="icono"><mat-icon>route</mat-icon></span>
          <h2>Nivelación</h2>
          <p class="desc">Recorre los mundos de pre-cálculo, supera los tests y entrena con preguntas generadas por IA.</p>
          <span class="ir">Entrar <mat-icon>arrow_forward</mat-icon></span>
        </button>
      </div>

      <span class="dev">Selector de módulos · modo develop</span>
    </div>
  `,
})
export class SelectorModuloComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  chatHabilitado = computed(() => this.auth.currentUser()?.chatbotHabilitado ?? false);
  nombre = computed(() => (this.auth.currentUser()?.displayName ?? '').split(' ')[0]);

  ir(url: string) {
    this.router.navigateByUrl(url);
  }
}
