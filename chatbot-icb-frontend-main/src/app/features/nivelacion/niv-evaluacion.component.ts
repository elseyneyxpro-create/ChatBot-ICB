import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { KatexRenderPipe } from '../../shared/katex-render.pipe';
import { NivelacionService, PreguntaPublica, ResultadoEvaluacion, ResultadoPregunta, Retroalimentacion, latexSuelto } from './nivelacion.service';
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
    <div class="error-box" *ngIf="error()" role="alert">{{ error() }}
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
                [attr.aria-pressed]="seleccion() === op"
                (click)="seleccion.set(op)">
          <span class="letra">{{ letra(i) }}</span><span [innerHTML]="latex(op) | katexRender"></span>
        </button>
      </div>
      <button class="btn-primary" [class.danger]="modo === 'test'" [disabled]="!seleccion()" (click)="siguiente()">
        {{ actual() === preguntas().length - 1 ? 'Enviar respuestas' : 'Siguiente pregunta' }}
      </button>
      <button class="btn-link" (click)="volverMapa()">Salir</button>
    </div>

    <!-- IA evaluando -->
    <div class="evaluando aparecer" *ngIf="evaluando()" role="status">
      <div class="cerebro" aria-hidden="true"><mat-icon>psychology</mat-icon></div>
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
          <!-- Si se equivocó, la acción principal es revisar con el tutor; si no, seguir avanzando -->
          <ng-container *ngIf="errores().length; else sinErrores">
            <button class="btn-primary tutor-btn" *ngIf="!r.chatbot_desbloqueado" (click)="abrirTutor(errores())">
              <mat-icon>school</mat-icon> Revisar mis errores con el tutor
            </button>
            <button class="btn-secondary" *ngIf="!r.aprobado" (click)="reintentar()"><mat-icon>replay</mat-icon> Reintentar</button>
            <button class="btn-secondary" (click)="continuar(r)"><mat-icon>arrow_forward</mat-icon>{{ textoContinuar(r) }}</button>
          </ng-container>
          <ng-template #sinErrores>
            <button [class]="r.chatbot_desbloqueado ? 'btn-secondary' : 'btn-primary'" (click)="continuar(r)">
              <mat-icon>arrow_forward</mat-icon>{{ textoContinuar(r) }}
            </button>
            <button class="btn-link" *ngIf="modo === 'fase'" (click)="abrirTutor([])"><mat-icon>school</mat-icon> Practicar más con el tutor</button>
          </ng-template>
        </div>
      </div>

      <div class="glass-panel detalle">
        <div class="detalle-top">
          <h3>Retroalimentación</h3>
          <span class="chip ia"><mat-icon>auto_awesome</mat-icon> IA</span>
        </div>

        <div class="retro-cargando" *ngIf="cargandoRetro()" role="status">
          <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
          Analizando tus respuestas para explicarte qué pasó en cada una…
        </div>
        <p class="retro-resumen" *ngIf="retro()?.resumen as res" [innerHTML]="res | katexRender"></p>
        <div class="reforzar" *ngIf="retro()?.reforzar?.length">
          <span class="muted">Te conviene reforzar:</span>
          <span class="chip" *ngFor="let t of retro()!.reforzar">{{ t }}</span>
        </div>

        <!-- Primero las que estuvieron mal -->
        <div class="item" *ngFor="let it of itemsOrdenados()" [class.ok]="it.es_correcto">
          <div class="item-top"><mat-icon>{{ it.es_correcto ? 'check_circle' : 'cancel' }}</mat-icon>
            <span [innerHTML]="(numero(it) + '. ' + it.enunciado) | katexRender"></span></div>
          <div class="item-resp" *ngIf="!it.es_correcto">
            Respondiste <strong [innerHTML]="latex(it.respuesta) | katexRender"></strong> ·
            correcta <strong class="ok-txt" [innerHTML]="latex(it.correcta) | katexRender"></strong>
          </div>
          <div class="item-exp" *ngIf="comentario(it) as c" [innerHTML]="c | katexRender"></div>
          <button class="btn-mini" *ngIf="!it.es_correcto" (click)="abrirTutor([it.intento_id])">
            <mat-icon>school</mat-icon> Revisar esta con el tutor
          </button>
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

  retro = signal<Retroalimentacion | null>(null);
  cargandoRetro = signal(false);

  pregunta = computed(() => this.preguntas()[this.actual()] ?? null);
  /** Intentos que respondió mal (para abrir el tutor sobre ellos) */
  errores = computed(() => (this.resultado()?.resultados ?? []).filter(r => !r.es_correcto).map(r => r.intento_id).filter(Boolean));
  itemsOrdenados = computed(() => {
    const rs = this.resultado()?.resultados ?? [];
    return [...rs.filter(r => !r.es_correcto), ...rs.filter(r => r.es_correcto)];
  });
  titulo = computed(() => {
    const i = this.info();
    if (!i) return '';
    return this.modo === 'test'
      ? `Test: ${i.nombre} · Fase ${i.fase} de 2`
      : `${i.nombre} · ${i.repaso ? 'Repaso' : 'Fase ' + i.fase + '/4'}`;
  });
  letra = (i: number) => String.fromCharCode(65 + i);
  latex = latexSuelto;

  ngOnInit() { this.cargar(); }

  private async cargar() {
    this.error.set(null); this.resultado.set(null); this.actual.set(0); this.respuestas = []; this.seleccion.set(null);
    this.retro.set(null);
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
      this.cargarRetro(res);
      this.niv.cargarEstado().catch(() => {}); // refresca XP del header
      if (res.chatbot_desbloqueado) this.auth.loadSession(true); // ahora puede entrar al chatbot
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e, 'No se pudieron enviar tus respuestas.'));
    } finally {
      this.evaluando.set(false);
    }
  }

  /** Retroalimentación de la IA por pregunta; si falla, quedan las explicaciones del banco. */
  private async cargarRetro(r: ResultadoEvaluacion) {
    const ids = r.resultados.map(x => x.intento_id).filter(Boolean);
    if (!ids.length) return;
    this.cargandoRetro.set(true);
    try {
      const fb = await this.niv.retroalimentacion(ids);
      if (fb.ok) this.retro.set(fb);
    } catch { /* se muestran las explicaciones del banco */ }
    finally { this.cargandoRetro.set(false); }
  }

  comentario(it: ResultadoPregunta): string | null {
    const ia = this.retro()?.items.find(x => x.intento_id === it.intento_id)?.comentario;
    return ia || it.explicacion || null;
  }

  numero(it: ResultadoPregunta) {
    return (this.resultado()?.resultados.indexOf(it) ?? 0) + 1;
  }

  /** Tutor fuera de la evaluación: revisando las preguntas indicadas, o práctica libre del nodo. */
  abrirTutor(intentos: string[]) {
    const i = this.info();
    const queryParams: Record<string, string> = this.modo === 'fase'
      ? { nodo: String(this.id) }
      : { mundo: String(i?.mundoId ?? this.id) };
    if (intentos.length) queryParams['intentos'] = intentos.join(',');
    this.router.navigate(['/nivelacion/tutor'], { queryParams });
  }

  textoContinuar(r: ResultadoEvaluacion) {
    if (r.mundo_completado) return 'Continuar al Multiverso';
    if (this.modo === 'fase' && r.aprobado && !r.nodo_completado && !r.repaso) return 'Siguiente fase';
    return 'Continuar al mapa';
  }

  tituloResultado(r: ResultadoEvaluacion) {
    if (!r.aprobado) return 'Entrenamiento requerido';
    if (this.modo === 'test') return r.mundo_completado ? '¡Mundo dominado!' : '¡Fase 1 dominada!';
    if (r.repaso) return '¡Buen repaso!';
    return r.nodo_completado ? '¡Nodo completado!' : '¡Fase superada!';
  }

  mensajeResultado(r: ResultadoEvaluacion) {
    if (!r.aprobado) return 'Necesitas al menos 70% para aprobar. Revisa por qué te equivocaste con el tutor y vuelve a intentarlo.';
    if (this.modo === 'test') return r.mundo_completado
      ? 'Superaste ambas fases del test. El siguiente mundo está desbloqueado.'
      : 'Superaste la fase 1. Cuando estés listo, enfréntate a la fase 2.';
    return r.nodo_completado ? 'Dominaste este nodo: el siguiente quedó desbloqueado.' : 'Sigue así, te quedan más fases en este nodo.';
  }

  continuar(r: ResultadoEvaluacion) {
    if (r.mundo_completado) this.router.navigate(['/nivelacion']);
    else if (this.textoContinuar(r) === 'Siguiente fase') this.cargar();
    else this.volverMapa();
  }

  reintentar() { this.cargar(); }

  irChatbot() { this.router.navigateByUrl('/app/chat'); }

  volverMapa() {
    const mundoId = this.info()?.mundoId ?? (this.modo === 'test' ? this.id : null);
    this.router.navigate(mundoId ? ['/nivelacion/mundo', mundoId] : ['/nivelacion']);
  }
}
