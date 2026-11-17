import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { KatexRenderPipe } from '../../shared/katex-render.pipe';
import { AyudaTutor, EjercicioTutor, MensajeTutor, NivelacionService, SesionTutor, latexSuelto } from './nivelacion.service';


/**
 * "Aprende con el tutor": conversación socrática sobre un nodo (o sobre las preguntas que el alumno
 * respondió mal en una fase/test). Nunca se abre durante una evaluación.
 * Query params: nodo, mundo (revisión de un test) e intentos (ids separados por coma).
 */
@Component({
  selector: 'app-niv-tutor',
  standalone: true,
  imports: [CommonModule, MatIconModule, KatexRenderPipe],
  styleUrls: ['./niv-tutor.component.scss'],
  template: `
  <div class="page tutor-page">
    <div class="tutor-wrap">
      <header class="t-head glass-panel">
        <button class="btn-secondary icono" (click)="volver()" title="Volver al mapa" aria-label="Volver al mapa"><mat-icon>arrow_back</mat-icon></button>
        <div class="t-avatar"><mat-icon>school</mat-icon></div>
        <div class="t-tit">
          <span class="t-kicker">Aprende con el tutor</span>
          <h1>{{ titulo() }}</h1>
          <small class="muted" *ngIf="sesion() as s">
            {{ s.mundo?.titulo }} · {{ s.revisando ? 'Revisando ' + s.revisando + (s.revisando === 1 ? ' pregunta' : ' preguntas') : 'Práctica libre' }}
          </small>
        </div>
        <button class="btn-secondary icono" *ngIf="sesion()?.nodo" (click)="nueva()" [disabled]="ocupado()" title="Nueva conversación" aria-label="Nueva conversación">
          <mat-icon>add_comment</mat-icon>
        </button>
      </header>

      <div class="t-chat glass-panel" #chat role="log" aria-label="Conversación con el tutor">
        <div class="t-cargando" *ngIf="!sesion() && !error()" role="status">
          <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
          <p class="muted">Preparando a tu tutor…</p>
        </div>
        <div class="error-box" *ngIf="error() as e" role="alert">{{ e }}
          <button class="btn-secondary" (click)="volver()">Volver al mapa</button></div>

        <ng-container *ngFor="let m of mensajes(); trackBy: porId">
          <div class="msg" [class.alumno]="m.rol === 'alumno'" [class.tutor]="m.rol === 'tutor'">
            <div class="m-avatar" *ngIf="m.rol === 'tutor'"><mat-icon>school</mat-icon></div>
            <div class="m-cuerpo">
              <div class="burbuja" [class.ayuda]="!!m.ayuda"
                   [innerHTML]="(m.rol === 'alumno' ? latex(m.texto) : m.texto) | katexRender"></div>

              <!-- Ejercicio propuesto por el tutor -->
              <div class="ejercicio" *ngIf="m.ejercicio as ej">
                <div class="ej-top"><mat-icon>edit_note</mat-icon> Ejercicio · no cuenta para tus fases</div>
                <p class="ej-enunciado" [innerHTML]="ej.enunciado | katexRender"></p>
                <div class="opciones">
                  <button *ngFor="let op of ej.alternativas; let i = index" class="opcion"
                          [class.sel]="ej.respuesta === null && !ej.vencido && eleccion()[ej.id] === op"
                          [attr.aria-pressed]="ej.respuesta === null && !ej.vencido ? eleccion()[ej.id] === op : null"
                          [class.ok]="op === ej.correcta"
                          [class.bad]="ej.respuesta === op && ej.es_correcto === false"
                          [disabled]="ej.respuesta !== null || ej.vencido || ocupado()"
                          (click)="elegir(ej, op)">
                    <span class="letra">{{ letra(i) }}</span><span [innerHTML]="latex(op) | katexRender"></span>
                  </button>
                </div>
                <div class="ej-acciones">
                  <button class="btn-primary" *ngIf="ej.respuesta === null && !ej.vencido" [disabled]="!eleccion()[ej.id] || ocupado()" (click)="responder(ej)">
                    Responder
                  </button>
                  <span class="ej-estado vencido" *ngIf="ej.vencido && ej.respuesta === null">
                    <mat-icon>schedule</mat-icon> Este ejercicio venció. Pide uno nuevo cuando quieras.
                  </span>
                  <span class="ej-estado ok" *ngIf="ej.es_correcto === true"><mat-icon>check_circle</mat-icon> ¡Correcta!</span>
                  <ng-container *ngIf="ej.es_correcto === false">
                    <span class="ej-estado bad"><mat-icon>cancel</mat-icon>{{ ej.revelado ? ' No era esa.' : ' No era esa: conversa con el tutor para encontrar el error' }}</span>
                    <button class="btn-link" *ngIf="!ej.revelado" (click)="solucion(ej)" [disabled]="ocupado()">Ver la solución</button>
                  </ng-container>
                </div>
                <div class="ej-solucion" *ngIf="ej.explicacion && (ej.revelado || ej.es_correcto)" [innerHTML]="ej.explicacion | katexRender"></div>
              </div>
            </div>
          </div>
        </ng-container>

        <div class="msg tutor" *ngIf="pensando()">
          <div class="m-avatar"><mat-icon>school</mat-icon></div>
          <div class="burbuja escribiendo" role="status" aria-label="El tutor está escribiendo"><span></span><span></span><span></span></div>
        </div>
      </div>

      <!-- El alumno no escribe: responde con las alternativas del tutor o con los botones de ayuda -->
      <div class="t-input" *ngIf="sesion()">
        <div class="t-opciones" *ngIf="opcionesActuales() as ops" role="group" aria-label="Alternativas para responder al tutor">
          <button *ngFor="let op of ops; let i = index" type="button" class="opcion"
                  [disabled]="ocupado() || sinCupo()" (click)="elegirOpcion(i, op)">
            <span class="letra">{{ letra(i) }}</span><span [innerHTML]="latex(op) | katexRender"></span>
          </button>
        </div>
        <div class="sugerencias">
          <button type="button" class="chip-sug" [disabled]="ocupado() || sinCupo()" (click)="pedirAyuda('no_entiendo')">
            <mat-icon>help_outline</mat-icon>No entiendo
          </button>
          <button type="button" class="chip-sug" [disabled]="ocupado() || sinCupo()" (click)="pedirAyuda('pista')">
            <mat-icon>lightbulb</mat-icon>Dame una pista
          </button>
          <button type="button" class="chip-sug" *ngIf="sesion()?.nodo && !pendiente()" [disabled]="ocupado() || sinCupo()" (click)="pedirEjercicio()">
            <mat-icon>auto_awesome</mat-icon>Dame un ejercicio
          </button>
        </div>
        <div class="t-pie muted" aria-live="polite">
          <span *ngIf="aviso() as a" class="aviso">{{ a }}</span>
          <span *ngIf="!aviso()"><span class="largo">El tutor no te da la respuesta: te ayuda a encontrarla. </span>Te quedan {{ restantes() }} mensajes hoy.</span>
        </div>
      </div>
    </div>
  </div>
  `,
})
export class NivTutorComponent implements OnInit {
  private niv = inject(NivelacionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  @ViewChild('chat') private chatRef?: ElementRef<HTMLDivElement>;

  sesion = signal<SesionTutor | null>(null);
  mensajes = signal<MensajeTutor[]>([]);
  error = signal<string | null>(null);
  aviso = signal<string | null>(null);
  pensando = signal(false);
  enviando = signal(false);
  restantes = signal(0);
  eleccion = signal<Record<string, string>>({});

  ocupado = computed(() => this.pensando() || this.enviando());
  sinCupo = computed(() => this.restantes() <= 0);
  titulo = computed(() => {
    const s = this.sesion();
    if (!s) return '…';
    return s.nodo ? s.nodo.titulo : `Test: ${s.mundo?.titulo ?? ''}`;
  });
  pendiente = computed(() => this.mensajes().some(m => m.ejercicio && m.ejercicio.respuesta === null && !m.ejercicio.vencido));
  /** Alternativas del último mensaje del tutor (si el último mensaje es suyo y trae alternativas) */
  opcionesActuales = computed(() => {
    const ultimo = this.mensajes().at(-1);
    return ultimo?.rol === 'tutor' && ultimo.opciones?.length ? ultimo.opciones : null;
  });

  letra = (i: number) => String.fromCharCode(65 + i);
  latex = latexSuelto;
  porId = (_: number, m: MensajeTutor) => m.id;

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    const nodo = Number(q.get('nodo')) || undefined;
    const mundo = Number(q.get('mundo')) || undefined;
    const intentos = (q.get('intentos') ?? '').split(',').filter(x => /^\d+$/.test(x));
    await this.abrir({ nodo_id: nodo, mundo_id: nodo ? undefined : mundo, intento_ids: intentos.length ? intentos : undefined });
  }

  private async abrir(opts: { nodo_id?: number; mundo_id?: number; intento_ids?: string[]; nueva?: boolean }) {
    this.error.set(null);
    this.pensando.set(true);
    try {
      const s = await this.niv.abrirTutor(opts);
      this.sesion.set(s);
      this.mensajes.set(s.mensajes);
      this.restantes.set(s.restantes_hoy);
      this.bajar();
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e, 'No se pudo abrir el tutor.'));
    } finally {
      this.pensando.set(false);
    }
  }

  async nueva() {
    const s = this.sesion();
    if (!s?.nodo) return;
    this.mensajes.set([]);
    this.sesion.set(null);
    this.router.navigate([], { queryParams: { nodo: s.nodo.id }, replaceUrl: true });
    await this.abrir({ nodo_id: s.nodo.id, nueva: true });
  }

  elegirOpcion(i: number, texto: string) {
    this.enviarAccion({ opcion: i }, texto);
  }

  pedirAyuda(ayuda: AyudaTutor) {
    this.enviarAccion({ ayuda }, ayuda === 'pista' ? 'Dame una pista' : 'No entiendo', ayuda);
  }

  /** Muestra altiro lo que eligió el alumno y espera la respuesta del tutor; si falla, se quita. */
  private async enviarAccion(r: { opcion: number } | { ayuda: AyudaTutor }, texto: string, ayuda: AyudaTutor | null = null) {
    const s = this.sesion();
    if (!s || this.ocupado()) return;
    const previos = this.mensajes();
    const temporal: MensajeTutor = { id: 'tmp', rol: 'alumno', texto, at: new Date().toISOString(), ejercicio: null, ayuda };
    // Las alternativas ya elegidas dejan de mostrarse
    this.mensajes.set([...previos.map(m => m.opciones?.length ? { ...m, opciones: [] } : m), temporal]);
    this.pensando.set(true);
    this.bajar();
    try {
      const res = await this.niv.responderAlTutor(s.id, r);
      this.mensajes.update(ms => [...ms.filter(m => m !== temporal), ...res.mensajes]);
      this.restantes.set(res.restantes_hoy);
      this.aviso.set(null);
    } catch (e) {
      this.mensajes.set(previos);
      this.mostrarError(e);
    } finally {
      this.pensando.set(false);
      this.bajar();
    }
  }

  async pedirEjercicio() {
    const s = this.sesion();
    if (!s || this.ocupado()) return;
    this.pensando.set(true);
    this.bajar();
    try {
      const r = await this.niv.pedirEjercicio(s.id);
      this.mensajes.update(ms => [...ms, ...r.mensajes]);
      this.restantes.update(n => Math.max(n - 1, 0));
    } catch (e) {
      this.mostrarError(e);
    } finally {
      this.pensando.set(false);
      this.bajar();
    }
  }

  elegir(ej: EjercicioTutor, op: string) {
    this.eleccion.update(e => ({ ...e, [ej.id]: op }));
  }

  async responder(ej: EjercicioTutor) {
    const s = this.sesion();
    const op = this.eleccion()[ej.id];
    if (!s || !op || this.ocupado()) return;
    this.enviando.set(true);
    try {
      const r = await this.niv.responderEjercicio(s.id, ej.id, op);
      this.actualizarEjercicio(ej.id, r.ejercicio);
      this.enviando.set(false);
      this.pensando.set(true);
      // pequeña pausa para que se note que el tutor "lee" la respuesta
      await new Promise(res => setTimeout(res, 400));
      this.mensajes.update(ms => [...ms, ...r.mensajes]);
      this.restantes.update(n => Math.max(n - 1, 0));
      if (r.xp_ganado) this.niv.cargarEstado().catch(() => {});
    } catch (e: any) {
      // Venció: la tarjeta del ejercicio ya lo explica y vuelve "Dame un ejercicio"
      if (e?.status === 410) this.actualizarEjercicio(ej.id, { vencido: true });
      else this.mostrarError(e);
    } finally {
      this.enviando.set(false);
      this.pensando.set(false);
      this.bajar();
    }
  }

  async solucion(ej: EjercicioTutor) {
    const s = this.sesion();
    if (!s) return;
    try {
      const r = await this.niv.verSolucion(s.id, ej.id);
      this.actualizarEjercicio(ej.id, r.ejercicio);
      this.bajar();
    } catch (e) {
      this.mostrarError(e);
    }
  }

  private actualizarEjercicio(id: string, cambios: Partial<EjercicioTutor>) {
    this.mensajes.update(ms => ms.map(m => m.ejercicio?.id === id ? { ...m, ejercicio: { ...m.ejercicio, ...cambios } } : m));
  }

  private mostrarError(e: any) {
    if (e?.status === 429) this.restantes.set(0);
    this.aviso.set(NivelacionService.mensajeError(e, 'El tutor no pudo responder. Intenta de nuevo.'));
  }

  private bajar() {
    setTimeout(() => {
      const el = this.chatRef?.nativeElement;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 30);
  }

  volver() {
    const id = this.sesion()?.mundo?.id ?? Number(this.route.snapshot.queryParamMap.get('mundo'));
    this.router.navigate(id ? ['/nivelacion/mundo', id] : ['/nivelacion']);
  }
}
