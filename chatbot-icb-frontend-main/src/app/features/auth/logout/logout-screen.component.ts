import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/auth.service';

// Lo que el usuario responde a la despedida de Axiomante
const RESPONSES = [
  '¡Chao Axiomante! 👋',
  '¡Nos vemos! 😊',
  '¡Gracias por todo! ✨',
  '¡Hasta la próxima! 🤖',
];

@Component({
  selector: 'app-logout-screen',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host {
      display: flex;
      height: 100dvh;
      background: linear-gradient(160deg, #283593 0%, #e8eaf6 58%, #f5f6fa 100%);
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
    }

    .scene {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 28px;
      padding: 24px;
    }

    /* ── Robot ── */
    .robot {
      animation: float 3s ease-in-out infinite;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50%       { transform: translateY(-10px); }
    }

    .robot-head {
      width: 90px;
      height: 80px;
      background: #1a237e;
      border-radius: 18px;
      margin: 0 auto;
      position: relative;
      border: 2px solid rgba(255, 255, 255, 0.35);
      box-shadow: 0 4px 24px rgba(26, 35, 126, 0.5);
    }

    .robot-eyes {
      display: flex;
      justify-content: center;
      gap: 18px;
      padding-top: 22px;
    }

    .eye {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 8px rgba(255,255,255,0.7);
      animation: blink 4s ease-in-out infinite;
    }

    .eye.right { animation-delay: 0.12s; }

    @keyframes blink {
      0%, 90%, 100% { transform: scaleY(1); }
      95%            { transform: scaleY(0.1); }
    }

    .robot-mouth {
      width: 36px;
      height: 10px;
      border-radius: 0 0 10px 10px;
      border: 2px solid rgba(255,255,255,0.6);
      border-top: none;
      margin: 12px auto 0;
    }

    .robot-antenna {
      position: absolute;
      top: -18px;
      left: 50%;
      transform: translateX(-50%);
      width: 3px;
      height: 16px;
      background: rgba(255,255,255,0.5);
      border-radius: 2px;
    }

    .robot-antenna::after {
      content: '';
      display: block;
      width: 8px;
      height: 8px;
      background: #fff;
      border-radius: 50%;
      position: absolute;
      top: -6px;
      left: -2.5px;
      animation: pulse-dot 2s ease-in-out infinite;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.4; transform: scale(0.7); }
    }

    .robot-body {
      width: 70px;
      height: 54px;
      background: #1a237e;
      border-radius: 12px;
      margin: 6px auto 0;
      border: 2px solid rgba(255, 255, 255, 0.3);
      box-shadow: 0 4px 18px rgba(26, 35, 126, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .chest-light {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      animation: chest-pulse 1.6s ease-in-out infinite;
    }

    @keyframes chest-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.5; transform: scale(0.85); }
    }

    .robot-legs {
      display: flex;
      justify-content: center;
      gap: 14px;
      margin-top: 4px;
    }

    .leg {
      width: 16px;
      height: 22px;
      background: #1a237e;
      border-radius: 0 0 8px 8px;
      border: 2px solid rgba(255, 255, 255, 0.3);
    }

    /* ── Burbuja ── */
    .bubble {
      background: #fff;
      border: 1.5px solid rgba(63, 81, 181, 0.25);
      border-radius: 18px;
      padding: 20px 28px;
      max-width: 360px;
      text-align: center;
      position: relative;
      box-shadow: 0 6px 28px rgba(40, 53, 147, 0.18);
    }

    .bubble::before {
      content: '';
      position: absolute;
      top: -11px;
      left: 50%;
      transform: translateX(-50%);
      border: 11px solid transparent;
      border-bottom-color: #fff;
      border-top: none;
    }

    .bubble-name {
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 1.5px;
      color: #3f51b5;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .bubble-text {
      font-size: 1.05rem;
      line-height: 1.6;
      color: #1a237e;
      font-weight: 600;
    }

    /* ── Tarjetas de despedida ── */
    .cards-hint {
      font-size: 0.8rem;
      color: #5c6bc0;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .farewell-cards {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      max-width: 420px;
    }

    .farewell-card {
      background: #fff;
      border: 2px solid rgba(63, 81, 181, 0.2);
      border-radius: 14px;
      padding: 10px 18px;
      font-size: 0.9rem;
      font-weight: 600;
      color: #1a237e;
      cursor: pointer;
      transition: all 0.18s ease;
      box-shadow: 0 2px 10px rgba(40, 53, 147, 0.1);
    }

    .farewell-card:hover {
      background: #e8eaf6;
      border-color: #3f51b5;
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(40, 53, 147, 0.2);
    }

    .farewell-card.selected {
      background: #3f51b5;
      border-color: #3f51b5;
      color: #fff;
      transform: scale(0.97);
    }

    /* ── Spinner salida ── */
    .leaving {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #283593;
      font-size: 0.88rem;
      font-weight: 600;
    }

    .dots span {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #3f51b5;
      margin: 0 2px;
      animation: bounce-dot 1.4s ease-in-out infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.2s; }
    .dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce-dot {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40%            { transform: scale(1);   opacity: 1; }
    }
  `],
  template: `
    <div class="scene">

      <!-- Robot Axiomante -->
      <div class="robot">
        <div class="robot-head">
          <div class="robot-antenna"></div>
          <div class="robot-eyes">
            <div class="eye left"></div>
            <div class="eye right"></div>
          </div>
          <div class="robot-mouth"></div>
        </div>
        <div class="robot-body">
          <div class="chest-light"></div>
        </div>
        <div class="robot-legs">
          <div class="leg"></div>
          <div class="leg"></div>
        </div>
      </div>

      <!-- Burbuja de diálogo: Axiomante se despide primero -->
      <div class="bubble">
        <div class="bubble-name">Axiomante</div>
        <div class="bubble-text">
          @if (selectedCard()) {
            ¡Que te vaya súper bien! Fue un placer 🚀
          } @else {
            ¡Hasta luego! Fue un placer acompañarte hoy. ¡Vuelve cuando quieras! 👋
          }
        </div>
      </div>

      <!-- Respuestas del usuario o spinner -->
      @if (!selectedCard()) {
        <p class="cards-hint">¿Y tú, cómo te despides?</p>
        <div class="farewell-cards">
          @for (r of responses; track r) {
            <button
              class="farewell-card"
              (click)="pickFarewell(r)"
            >{{ r }}</button>
          }
        </div>
      } @else {
        <div class="leaving">
          <span>Cerrando sesión</span>
          <div class="dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      }

    </div>
  `,
})
export class LogoutScreenComponent implements OnInit {
  private authService = inject(AuthService);
  private router      = inject(Router);

  readonly responses = RESPONSES;
  selectedCard = signal<string | null>(null);

  ngOnInit() {
    // Si se llega directamente a /logout sin estar en proceso de logout, redirigir
    // (el componente se activa desde signOut del shell, no necesita init extra)
  }

  pickFarewell(f: string) {
    if (this.selectedCard()) return;
    this.selectedCard.set(f);
    // Pequeña pausa para que vea la reacción del robot
    setTimeout(() => this.authService.doSignOut(), 1400);
  }
}
