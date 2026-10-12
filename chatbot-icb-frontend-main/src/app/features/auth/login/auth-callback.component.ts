import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';

const GREETINGS = [
  'Bien y tú, ¿cómo estás rey? 👑',
  'Bien y tú, ¿cómo estás? 😊',
  '¡Súper bien, y tú? ✨',
  '¡Buen día! ☀️',
];

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host {
      display: flex;
      height: 100dvh;
      background: var(--bg-image), var(--bg);
      align-items: center;
      justify-content: center;
      font-family: var(--font);
      color: var(--text);
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
      background: var(--accent-gradient);
      border-radius: 18px;
      margin: 0 auto;
      position: relative;
      border: 2px solid rgba(255, 255, 255, 0.35);
      box-shadow: 0 4px 24px rgba(139, 92, 246, 0.5);
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
      background: var(--accent-gradient);
      border-radius: 12px;
      margin: 6px auto 0;
      border: 2px solid rgba(255, 255, 255, 0.3);
      box-shadow: 0 4px 18px rgba(139, 92, 246, 0.4);
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
      background: var(--accent-gradient);
      border-radius: 0 0 8px 8px;
      border: 2px solid rgba(255, 255, 255, 0.3);
    }

    /* ── Burbuja ── */
    .bubble {
      background: var(--bg-elev);
      border: 1.5px solid var(--border-strong);
      border-radius: 18px;
      padding: 20px 28px;
      max-width: 360px;
      text-align: center;
      position: relative;
      box-shadow: var(--shadow);
    }

    .bubble::before {
      content: '';
      position: absolute;
      top: -11px;
      left: 50%;
      transform: translateX(-50%);
      border: 11px solid transparent;
      border-bottom-color: var(--bg-elev);
      border-top: none;
    }

    .bubble-name {
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 1.5px;
      color: var(--accent);
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .bubble-text {
      font-size: 1.05rem;
      line-height: 1.6;
      color: var(--text);
      font-weight: 600;
    }

    /* ── Spinner ── */
    .loader {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-2);
      font-size: 0.88rem;
      font-weight: 600;
    }

    .dots span {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent-gradient);
      margin: 0 2px;
      animation: bounce-dot 1.4s ease-in-out infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.2s; }
    .dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce-dot {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40%            { transform: scale(1);   opacity: 1; }
    }

    /* ── Tarjetas de saludo ── */
    .cards-hint {
      font-size: 0.8rem;
      color: var(--text-3);
      font-weight: 600;
      letter-spacing: 0.5px;
      opacity: 0;
      animation: fade-in 0.5s ease forwards;
    }

    .greeting-cards {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      max-width: 420px;
      opacity: 0;
      animation: fade-in 0.5s ease forwards;
    }

    @keyframes fade-in {
      to { opacity: 1; }
    }

    .greeting-card {
      background: var(--bg-elev);
      border: 2px solid var(--border-strong);
      border-radius: 14px;
      padding: 10px 18px;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text);
      cursor: pointer;
      transition: all 0.18s ease;
      box-shadow: 0 2px 10px rgba(139, 92, 246, 0.12);
    }

    .greeting-card:hover {
      background: var(--accent-soft);
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(139, 92, 246, 0.3);
    }

    .greeting-card.selected {
      background: var(--accent-gradient);
      border-color: transparent;
      color: #fff;
      transform: scale(0.97);
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

      <!-- Burbuja de diálogo -->
      <div class="bubble">
        <div class="bubble-name">Axiomante</div>
        <div class="bubble-text">
          @if (selectedCard()) {
            ¡Perfecto! Preparando tu espacio... 🚀
          } @else {
            ¡Hola! ¿Cómo estás el día de hoy?<br>
            Espero que tengas energías para seguir<br>
            construyendo tu futuro 🚀
          }
        </div>
      </div>

      <!-- Loading -->
      <div class="loader">
        <span>Iniciando sesión</span>
        <div class="dots">
          <span></span><span></span><span></span>
        </div>
      </div>

      <!-- Tarjetas de saludo -->
      @if (showCards()) {
        <p class="cards-hint">¿Cómo te encuentras hoy?</p>
        <div class="greeting-cards">
          @for (g of greetings; track g) {
            <button
              class="greeting-card"
              [class.selected]="selectedCard() === g"
              (click)="pickCard(g)"
            >{{ g }}</button>
          }
        </div>
      }

    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private authService = inject(AuthService);
  private router      = inject(Router);

  readonly greetings = GREETINGS;
  showCards    = signal(false);
  selectedCard = signal<string | null>(null);

  private cardResolve!: () => void;
  private cardPromise = new Promise<void>(res => { this.cardResolve = res; });

  private delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  pickCard(g: string) {
    if (this.selectedCard()) return;
    this.selectedCard.set(g);
    this.cardResolve();
  }

  async ngOnInit() {
    // Mostrar tarjetas después de 2.5 s
    setTimeout(() => this.showCards.set(true), 2500);

    // Auth y delay mínimo en paralelo
    const [authResult] = await Promise.allSettled([
      this.authService.handleOAuthCallback(),
      this.delay(8000),
    ]);

    // Esperar a que el usuario elija una tarjeta
    await this.cardPromise;

    // Pequeña pausa para que vea el mensaje de "Preparando tu espacio"
    await this.delay(1200);

    if (authResult.status === 'fulfilled') {
      // develop: pantalla para elegir módulo; producción: /app (el guard decide chatbot o nivelación)
      this.router.navigateByUrl(environment.dev?.selectorModulos ? '/inicio' : '/app');
    } else {
      console.error('[AuthCallback] error:', authResult.reason);
      const status = (authResult.reason as any)?.status;
      if (status === 403) {
        this.router.navigateByUrl('/login?error=not_authorized');
      } else {
        this.router.navigateByUrl('/login?error=auth_failed');
      }
    }
  }
}
