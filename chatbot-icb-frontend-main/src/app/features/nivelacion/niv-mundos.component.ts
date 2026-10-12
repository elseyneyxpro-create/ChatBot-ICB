import { AfterViewInit, Component, ElementRef, ViewChild, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NivelacionService } from './nivelacion.service';

/** "Multiverso": los mundos en zigzag (WorldMap de la maqueta) + análisis del agente. */
@Component({
  selector: 'app-niv-mundos',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  styleUrls: ['./niv-mundos.component.scss'],
  template: `
  <div class="page" *ngIf="estado() as e">
    <div class="titulo">
      <h1 class="gradient-text">Multiverso de las Matemáticas</h1>
      <p class="muted">Selecciona un mundo para comenzar tu viaje de aprendizaje.</p>
    </div>

    <!-- Mapa horizontal tipo Mario Bros: se avanza de izquierda a derecha -->
    <div class="mapa-scroll" #scroll>
      <div class="mapa-h" [style.width.px]="ancho()" [style.height.px]="ALTO">
        <svg class="camino" [attr.width]="ancho()" [attr.height]="ALTO" aria-hidden="true">
          <path *ngFor="let t of tramos()" [attr.d]="t.d" [class.hecho]="t.hecho" />
        </svg>

        <div class="hito inicio" [style.left.px]="PAD - 125" [style.top.px]="puntos()[0]?.y ?? 0">
          <mat-icon>flag</mat-icon><span>Inicio</span>
        </div>

        <div *ngFor="let p of puntos(); let i = index" class="mundo aparecer"
             [style.left.px]="p.x" [style.top.px]="p.y" [style.animation-delay.ms]="i * 120">
          <div class="jugador" *ngIf="esActual(p.m)" title="Estás aquí"><mat-icon>smart_toy</mat-icon></div>
          <button class="circulo"
                  [class.completado]="p.m.completado" [class.actual]="esActual(p.m)" [class.bloqueado]="!p.m.desbloqueado"
                  [disabled]="!p.m.desbloqueado" (click)="abrir(p.m.id)">
            <mat-icon>{{ p.m.completado ? 'check_circle' : !p.m.desbloqueado ? 'lock' : (p.m.icono || 'public') }}</mat-icon>
          </button>
          <div class="etiqueta" [class.actual]="esActual(p.m)">
            <div class="num">Mundo {{ p.m.orden }}</div>
            <div class="nombre" [class.muted]="!p.m.desbloqueado">{{ p.m.titulo }}</div>
            <div class="avance muted">{{ p.m.nodos_completados }}/{{ p.m.total_nodos }} nodos · test {{ p.m.fase_test }}/2</div>
          </div>
        </div>

        <div class="hito meta" [class.logrado]="e.estudiante.nivelacion_completa"
             [style.left.px]="(puntos()[puntos().length - 1]?.x ?? 0) + 125"
             [style.top.px]="puntos()[puntos().length - 1]?.y ?? 0">
          <mat-icon>emoji_events</mat-icon><span>Meta</span>
        </div>
        <div class="suelo"></div>
      </div>
    </div>
    <p class="muted pista" *ngIf="e.mundos.length > 3"><mat-icon>swipe</mat-icon> Desliza hacia el lado para ver todos los mundos</p>

    <div class="aviso glass-panel" *ngIf="!e.estudiante.chatbot_habilitado">
      <mat-icon>lock_clock</mat-icon>
      <span>Completa la nivelación para que se habilite <strong>Axiomante</strong>, el tutor con IA.</span>
    </div>

    <div class="analisis glass-panel aparecer" *ngIf="e.analisis as a">
      <div class="an-head"><mat-icon>lightbulb</mat-icon><h3>Análisis de tu progreso</h3>
        <span class="chip">Nivel sugerido: {{ a.nivel_sugerido }}</span></div>
      <p class="muted" *ngIf="a.resumen">{{ a.resumen }}</p>
      <div class="an-cols">
        <div *ngIf="a.fortalezas?.length"><strong class="ok">Fortalezas</strong>
          <ul><li *ngFor="let f of a.fortalezas">{{ f }}</li></ul></div>
        <div *ngIf="a.debilidades?.length"><strong class="bad">Por reforzar</strong>
          <ul><li *ngFor="let d of a.debilidades">{{ d }}</li></ul></div>
      </div>
      <p class="reco" *ngIf="a.recomendacion"><mat-icon>tips_and_updates</mat-icon>{{ a.recomendacion }}</p>
    </div>

  </div>
  `,
})
export class NivMundosComponent implements AfterViewInit {
  private niv = inject(NivelacionService);
  private router = inject(Router);
  estado = this.niv.estado;

  private actualId = computed(() => this.estado()?.mundos.find(m => m.desbloqueado && !m.completado)?.id ?? null);
  esActual = (m: { id: number }) => m.id === this.actualId();

  // ── Geometría del mapa horizontal ──────────────────────────────────────
  readonly PAD = 190;      // margen izquierdo (bandera de inicio)
  readonly PASO = 260;     // distancia horizontal entre mundos
  readonly ALTO = 380;     // alto del mapa
  private readonly Y = [105, 205]; // alturas alternadas: el camino sube y baja

  @ViewChild('scroll') private scrollRef?: ElementRef<HTMLDivElement>;

  puntos = computed(() =>
    (this.estado()?.mundos ?? []).map((m, i) => ({ m, x: this.PAD + i * this.PASO, y: this.Y[i % 2] })),
  );
  ancho = computed(() => this.PAD * 2 + Math.max(this.puntos().length - 1, 0) * this.PASO);

  /** Curvas entre mundos consecutivos; el tramo queda "hecho" si el mundo de origen está completado. */
  tramos = computed(() => {
    const p = this.puntos();
    if (!p.length) return [];
    const curva = (ax: number, ay: number, bx: number, by: number) => {
      const mx = (ax + bx) / 2;
      return `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
    };
    const ultimo = p[p.length - 1];
    return [
      { d: curva(this.PAD - 125, p[0].y, p[0].x, p[0].y), hecho: true },
      ...p.slice(1).map((b, i) => ({ d: curva(p[i].x, p[i].y, b.x, b.y), hecho: p[i].m.completado })),
      { d: curva(ultimo.x, ultimo.y, ultimo.x + 125, ultimo.y), hecho: ultimo.m.completado },
    ];
  });

  constructor() {
    // Cuando cambia el estado, centra el mundo actual en pantalla
    effect(() => { if (this.puntos().length) setTimeout(() => this.centrarActual(), 50); });
  }

  ngAfterViewInit() { this.centrarActual(); }

  private centrarActual() {
    const el = this.scrollRef?.nativeElement;
    const actual = this.puntos().find(p => this.esActual(p.m));
    if (!el || !actual) return;
    el.scrollTo({ left: Math.max(actual.x - el.clientWidth / 2, 0), behavior: 'smooth' });
  }

  abrir(id: number) {
    this.router.navigate(['/nivelacion/mundo', id]);
  }
}
