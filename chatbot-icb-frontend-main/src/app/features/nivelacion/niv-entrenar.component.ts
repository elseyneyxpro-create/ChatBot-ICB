import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { KatexRenderPipe } from '../../shared/katex-render.pipe';
import { NivelacionService, PreguntaGenerada } from './nivelacion.service';

/**
 * Modo Entrenar: preguntas generadas por IA, ilimitadas.
 * No se guardan en el banco de los profesores, pero cada respuesta suma al progreso y al análisis.
 */
@Component({
  selector: 'app-niv-entrenar',
  standalone: true,
  imports: [CommonModule, MatIconModule, KatexRenderPipe],
  styleUrls: ['./niv-evaluacion.component.scss', './niv-entrenar.component.scss'],
  template: `
  <div class="page">
    <div class="cabecera">
      <button class="btn-secondary volver" (click)="volver()"><mat-icon>arrow_back</mat-icon> Volver</button>
      <div>
        <h2 class="muted">Entrenamiento con IA</h2>
        <h1>{{ p()?.nodo?.titulo ?? '…' }}</h1>
      </div>
      <div class="marcador">
        <span class="ok"><mat-icon>check</mat-icon>{{ aciertos() }}</span>
        <span class="bad"><mat-icon>close</mat-icon>{{ errores() }}</span>
        <span class="racha" *ngIf="racha() >= 2"><mat-icon>local_fire_department</mat-icon>{{ racha() }}</span>
      </div>
    </div>

    <div class="error-box" *ngIf="error()">{{ error() }}
      <button class="btn-secondary" (click)="nueva()">Intentar de nuevo</button></div>

    <div class="evaluando aparecer" *ngIf="generando()">
      <div class="cerebro"><mat-icon>auto_awesome</mat-icon></div>
      <h2 class="gradient-text">Creando una pregunta para ti…</h2>
    </div>

    <div class="card glass-panel deslizar" *ngIf="!generando() && p() as q">
      <div class="top">
        <span class="etiqueta">Pregunta generada · no cuenta para las fases</span>
        <span class="chip">#{{ aciertos() + errores() + (feedback() ? 0 : 1) }}</span>
      </div>
      <h2 [innerHTML]="q.enunciado | katexRender"></h2>
      <div class="opciones">
        <button *ngFor="let op of q.alternativas; let i = index" class="opcion"
                [class.sel]="!feedback() && seleccion() === op"
                [class.ok]="feedback() && op === feedback()!.correcta"
                [class.bad]="feedback() && !feedback()!.es_correcto && op === seleccion()"
                [disabled]="!!feedback() || enviando()" (click)="seleccion.set(op)">
          <span class="letra">{{ letra(i) }}</span><span [innerHTML]="op | katexRender"></span>
        </button>
      </div>

      <div class="feedback aparecer" *ngIf="feedback() as f" [class.ok]="f.es_correcto">
        <strong>{{ f.es_correcto ? '¡Correcto!' : 'No era esa.' }}</strong>
        <span *ngIf="f.xp_ganado" class="xp">+{{ f.xp_ganado }} XP</span>
        <p *ngIf="f.explicacion" [innerHTML]="f.explicacion | katexRender"></p>
      </div>

      <button class="btn-primary" *ngIf="!feedback()" [disabled]="!seleccion() || enviando()" (click)="responder()">Responder</button>
      <button class="btn-primary" *ngIf="feedback()" (click)="nueva()"><mat-icon>auto_awesome</mat-icon> Otra pregunta</button>
    </div>
  </div>
  `,
})
export class NivEntrenarComponent implements OnInit {
  private niv = inject(NivelacionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private nodoId = Number(this.route.snapshot.paramMap.get('id'));

  p = signal<PreguntaGenerada | null>(null);
  seleccion = signal<string | null>(null);
  feedback = signal<{ es_correcto: boolean; correcta: string; explicacion: string | null; xp_ganado: number } | null>(null);
  generando = signal(false);
  enviando = signal(false);
  error = signal<string | null>(null);
  aciertos = signal(0);
  errores = signal(0);
  racha = signal(0);
  letra = (i: number) => String.fromCharCode(65 + i);

  ngOnInit() { this.nueva(); }

  async nueva() {
    this.error.set(null); this.feedback.set(null); this.seleccion.set(null);
    this.generando.set(true);
    try {
      this.p.set(await this.niv.generarPregunta(this.nodoId));
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e, 'No se pudo generar la pregunta.'));
    } finally {
      this.generando.set(false);
    }
  }

  async responder() {
    const q = this.p();
    if (!q || !this.seleccion()) return;
    this.enviando.set(true);
    try {
      const r = await this.niv.responderGenerada(q.id, this.seleccion()!);
      this.feedback.set(r);
      if (r.es_correcto) { this.aciertos.update(n => n + 1); this.racha.update(n => n + 1); }
      else { this.errores.update(n => n + 1); this.racha.set(0); }
      this.niv.cargarEstado().catch(() => {});
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e));
    } finally {
      this.enviando.set(false);
    }
  }

  volver() {
    const mundoId = this.p()?.nodo?.mundo_id;
    this.router.navigate(mundoId ? ['/nivelacion/mundo', mundoId] : ['/nivelacion']);
  }
}
