import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { KatexRenderPipe } from '../../shared/katex-render.pipe';
import { NivelacionService, PreguntaPublica, ResultadoEvaluacion } from './nivelacion.service';
import { AuthService } from '../../core/auth.service';

/**
 * Cuestionario de una fase de nodo (QuestionCard) o del test del mundo (TestCard),
 * con la pantalla de "IA evaluando" y el resultado. La corrección la hace el backend.
 */
@Component({
  selector: 'app-niv-evaluacion',
  standalone: true,
  imports: [CommonModule, MatIconModule, KatexRenderPipe],
  styleUrls: ['./niv-evaluacion.component.scss'],
  template: `
  <div class="page" [class.test]="modo === 'test'">
    <div class="error-box" *ngIf="error()">{{ error() }}
      <button class="btn-secondary" (click)="volverMapa()">Volver al mapa</button></div>

    <!-- Preguntas -->
    <div class="card glass-panel deslizar" *ngIf="!resultado() && !evaluando() && pregunta() as q"
         [class.borde-test]="modo === 'test'" [attr.data-q]="actual()">
      <div class="top">
        <span class="etiqueta">{{ titulo() }}</span>
        <span class="chip">{{ actual() + 1 }} / {{ preguntas().length }}</span>
      </div>
      <h2 [innerHTML]="q.enunciado | katexRender"></h2>
      <div class="opciones">
        <button *ngFor="let op of q.alternativas; let i = index" class="opcion" [class.sel]="seleccion() === op"
                (click)="seleccion.set(op)">
          <span class="letra">{{ letra(i) }}</span><span [innerHTML]="op | katexRender"></span>
        </button>
      </div>
      <button class="btn-primary" [class.danger]="modo === 'test'" [disabled]="!seleccion()" (click)="siguiente()">
        {{ actual() === preguntas().length - 1 ? 'Enviar respuestas' : 'Siguiente pregunta' }}
      </button>
      <button class="btn-link" (click)="volverMapa()">Salir</button>
    </div>

    <!-- IA evaluando -->
    <div class="evaluando aparecer" *ngIf="evaluando()">
      <div class="cerebro"><mat-icon>psychology</mat-icon></div>
      <h2 class="gradient-text">Evaluando tus respuestas…</h2>
    </div>

    <!-- Resultado -->
    <div class="resultado aparecer" *ngIf="resultado() as r">
      <div class="glass-panel res-card" [class.aprobado]="r.aprobado" [class.reprobado]="!r.aprobado">
        <mat-icon class="res-icon">{{ r.aprobado ? 'verified' : 'gpp_maybe' }}</mat-icon>
        <h2 class="puntaje">{{ r.puntaje }}%</h2>
        <h3>{{ tituloResultado(r) }}</h3>
        <p class="muted">{{ mensajeResultado(r) }}</p>
        <div class="xp-ganado" *ngIf="r.xp_ganado">+{{ r.xp_ganado }} XP</div>
        <div class="desbloqueo" *ngIf="r.chatbot_desbloqueado">
          <mat-icon>lock_open</mat-icon>
          <div><strong>¡Completaste la nivelación!</strong><span>Desbloqueaste a Axiomante, tu tutor de Cálculo con IA.</span></div>
        </div>
        <div class="botones">
          <button class="btn-primary" *ngIf="r.chatbot_desbloqueado" (click)="irChatbot()"><mat-icon>chat</mat-icon> Ir al chatbot</button>
          <button [class]="r.chatbot_desbloqueado ? 'btn-secondary' : 'btn-primary'" (click)="continuar(r)">
            <mat-icon>arrow_forward</mat-icon>{{ r.mundo_completado ? 'Continuar al Multiverso' : 'Continuar al mapa' }}
          </button>
          <button class="btn-secondary" *ngIf="!r.aprobado" (click)="reintentar()"><mat-icon>replay</mat-icon> Reintentar</button>
        </div>
      </div>

      <div class="glass-panel detalle">
        <h3>Revisión</h3>
        <div class="item" *ngFor="let it of r.resultados; let i = index" [class.ok]="it.es_correcto">
          <div class="item-top"><mat-icon>{{ it.es_correcto ? 'check_circle' : 'cancel' }}</mat-icon>
            <span [innerHTML]="(i + 1) + '. ' + it.enunciado | katexRender"></span></div>
          <div class="item-resp" *ngIf="!it.es_correcto">
            Respondiste <strong [innerHTML]="it.respuesta | katexRender"></strong> ·
            correcta <strong class="ok-txt" [innerHTML]="it.correcta | katexRender"></strong>
          </div>
          <div class="item-exp muted" *ngIf="it.explicacion" [innerHTML]="it.explicacion | katexRender"></div>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class NivEvaluacionComponent implements OnInit {
  private niv = inject(NivelacionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  modo: 'fase' | 'test' = this.route.snapshot.data['modo'];
  private id = Number(this.route.snapshot.paramMap.get('id'));

  preguntas = signal<PreguntaPublica[]>([]);
  actual = signal(0);
  seleccion = signal<string | null>(null);
  respuestas: { pregunta_id: number; respuesta: string }[] = [];
  evaluando = signal(false);
  resultado = signal<ResultadoEvaluacion | null>(null);
  error = signal<string | null>(null);
  info = signal<{ nombre: string; mundoId: number; fase: number; repaso?: boolean } | null>(null);

  pregunta = computed(() => this.preguntas()[this.actual()] ?? null);
  titulo = computed(() => {
    const i = this.info();
    if (!i) return '';
    return this.modo === 'test'
      ? `Test: ${i.nombre} · Fase ${i.fase} de 2`
      : `${i.nombre} · ${i.repaso ? 'Repaso' : 'Fase ' + i.fase + '/4'}`;
  });
  letra = (i: number) => String.fromCharCode(65 + i);

  ngOnInit() { this.cargar(); }

  private async cargar() {
    this.error.set(null); this.resultado.set(null); this.actual.set(0); this.respuestas = []; this.seleccion.set(null);
    try {
      if (this.modo === 'test') {
        const r = await this.niv.preguntasTest(this.id);
        this.info.set({ nombre: r.mundo.titulo, mundoId: r.mundo.id, fase: r.fase });
        this.preguntas.set(r.preguntas);
      } else {
        const r = await this.niv.preguntasFase(this.id);
        this.info.set({ nombre: r.nodo.titulo, mundoId: r.nodo.mundo_id, fase: r.fase, repaso: r.repaso });
        this.preguntas.set(r.preguntas);
      }
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e, 'No se pudieron cargar las preguntas.'));
    }
  }

  async siguiente() {
    const q = this.pregunta();
    if (!q || !this.seleccion()) return;
    this.respuestas.push({ pregunta_id: q.id, respuesta: this.seleccion()! });
    this.seleccion.set(null);
    if (this.actual() < this.preguntas().length - 1) {
      this.actual.update(n => n + 1);
      return;
    }
    this.evaluando.set(true);
    const minimo = new Promise(r => setTimeout(r, 1200)); // deja ver la animación
    try {
      const res = this.modo === 'test'
        ? await this.niv.responderTest(this.id, this.respuestas)
        : await this.niv.responderFase(this.id, this.respuestas);
      await minimo;
      this.resultado.set(res);
      this.niv.cargarEstado().catch(() => {}); // refresca XP del header
      if (res.chatbot_desbloqueado) this.auth.loadSession(true); // ahora puede entrar al chatbot
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e, 'No se pudieron enviar tus respuestas.'));
    } finally {
      this.evaluando.set(false);
    }
  }

  tituloResultado(r: ResultadoEvaluacion) {
    if (!r.aprobado) return 'Entrenamiento requerido';
    if (this.modo === 'test') return r.mundo_completado ? '¡Mundo dominado!' : '¡Fase 1 dominada!';
    if (r.repaso) return '¡Buen repaso!';
    return r.nodo_completado ? '¡Nodo completado!' : '¡Fase superada!';
  }

  mensajeResultado(r: ResultadoEvaluacion) {
    if (!r.aprobado) return 'Necesitas al menos 70% para aprobar. Revisa las explicaciones, entrena con IA y vuelve a intentarlo.';
    if (this.modo === 'test') return r.mundo_completado
      ? 'Superaste ambas fases del test. El siguiente mundo está desbloqueado.'
      : 'Superaste la fase 1. Cuando estés listo, enfréntate a la fase 2.';
    return r.nodo_completado ? 'Dominaste este nodo: el siguiente quedó desbloqueado.' : 'Sigue así, te quedan más fases en este nodo.';
  }

  continuar(r: ResultadoEvaluacion) {
    if (r.mundo_completado) this.router.navigate(['/nivelacion']);
    else this.volverMapa();
  }

  reintentar() { this.cargar(); }

  irChatbot() { this.router.navigateByUrl('/app/chat'); }

  volverMapa() {
    const mundoId = this.info()?.mundoId ?? (this.modo === 'test' ? this.id : null);
    this.router.navigate(mundoId ? ['/nivelacion/mundo', mundoId] : ['/nivelacion']);
  }
}
