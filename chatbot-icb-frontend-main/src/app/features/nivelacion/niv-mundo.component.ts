import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MundoDetalle, NivelacionService, NodoMapa } from './nivelacion.service';

/** Ruta de nodos de un mundo + test final, en horizontal tipo Mario Bros. */
@Component({
  selector: 'app-niv-mundo',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  styleUrls: ['./niv-mundo.component.scss'],
  template: `
  <div class="page">
    <div class="error-box" *ngIf="error()">{{ error() }}</div>

    <ng-container *ngIf="data() as d">
      <div class="cabecera">
        <button class="btn-secondary volver" (click)="volver()"><mat-icon>arrow_back</mat-icon> Volver</button>
        <div class="tit">
          <h2 class="muted">Explorando</h2>
          <h1>{{ d.mundo.titulo }}</h1>
        </div>
        <span class="chip">{{ completados() }}/{{ d.nodos.length }} nodos</span>
      </div>

      <div class="mapa-scroll" #scroll>
        <div class="mapa-h" [style.width.px]="ancho()" [style.height.px]="ALTO">
          <svg class="camino" [attr.width]="ancho()" [attr.height]="ALTO" aria-hidden="true">
            <path *ngFor="let t of tramos()" [attr.d]="t.d" [class.hecho]="t.hecho" />
          </svg>

          <div class="hito inicio" [style.left.px]="PAD - 95" [style.top.px]="puntos()[0]?.y ?? 0">
            <mat-icon>flag</mat-icon><span>Inicio</span>
          </div>

          <div *ngFor="let p of puntos(); let i = index" class="nodo aparecer"
               [style.left.px]="p.x" [style.top.px]="p.y" [style.animation-delay.ms]="i * 40">
            <div class="jugador" *ngIf="p.n.estado === 'actual'" title="Estás aquí"><mat-icon>smart_toy</mat-icon></div>
            <button class="anillo" [class.bloqueado]="p.n.estado === 'bloqueado'" [class.actual]="p.n.estado === 'actual'"
                    [class.sel]="sel()?.id === p.n.id"
                    [style.background]="p.n.estado === 'bloqueado' ? null : anillo(p.n, d.reglas.FASES_POR_NODO)"
                    [disabled]="p.n.estado === 'bloqueado'" (click)="seleccionar(p.n)">
              <span class="centro" [class.completado]="p.n.estado === 'completado'" [class.actual]="p.n.estado === 'actual'">
                <mat-icon>{{ p.n.estado === 'completado' ? 'check' : p.n.estado === 'actual' ? 'star' : 'lock' }}</mat-icon>
              </span>
            </button>
            <div class="nodo-label" [class.muted]="p.n.estado === 'bloqueado'">
              <span class="orden">{{ p.n.orden }}</span>{{ p.n.titulo }}
            </div>
          </div>

          <!-- Test final: el "castillo" al final del camino -->
          <div class="nodo test aparecer" [style.left.px]="xTest()" [style.top.px]="yTest()">
            <button class="test-btn" [class.bloqueado]="!d.test.desbloqueado" [class.hecho]="d.test.fase >= 2"
                    [disabled]="!d.test.desbloqueado || d.test.fase >= 2" (click)="irTest()">
              <mat-icon>{{ d.test.fase >= 2 ? 'workspace_premium' : d.test.desbloqueado ? 'emoji_events' : 'lock' }}</mat-icon>
            </button>
            <div class="nodo-label test-label">
              Test del mundo
              <small>{{ d.test.fase >= 2 ? '¡Mundo dominado!' : d.test.desbloqueado ? 'Fase ' + (d.test.fase + 1) + ' de 2' : 'Completa los nodos' }}</small>
            </div>
          </div>
          <div class="suelo"></div>
        </div>
      </div>

      <!-- Panel del nodo seleccionado -->
      <div class="panel glass-panel aparecer" *ngIf="sel() as n">
        <div class="panel-info">
          <span class="muted">Nodo {{ n.orden }}</span>
          <h3>{{ n.titulo }}</h3>
          <div class="fases-bar">
            <span *ngFor="let f of fasesArr(d.reglas.FASES_POR_NODO); let i = index" [class.ok]="i < n.fases"></span>
          </div>
          <span class="muted small">{{ n.estado === 'completado' ? 'Nodo completado' : 'Fase ' + (n.fases + 1) + ' de ' + d.reglas.FASES_POR_NODO }}</span>
        </div>
        <div class="panel-acciones">
          <button class="btn-primary" (click)="irFase(n)">
            <mat-icon>{{ n.estado === 'completado' ? 'replay' : 'play_arrow' }}</mat-icon>
            {{ n.estado === 'completado' ? 'Repasar' : 'Jugar fase ' + (n.fases + 1) }}
          </button>
          <button class="btn-secondary" (click)="irEntrenar(n)"><mat-icon>fitness_center</mat-icon> Entrenar con IA</button>
        </div>
      </div>
      <p class="muted pista" *ngIf="!sel()"><mat-icon>touch_app</mat-icon> Toca el nodo con la estrella para seguir avanzando</p>
    </ng-container>
  </div>
  `,
})
export class NivMundoComponent implements OnInit {
  private niv = inject(NivelacionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  data = signal<MundoDetalle | null>(null);
  error = signal<string | null>(null);
  sel = signal<NodoMapa | null>(null);

  // ── Geometría del mapa horizontal ──────────────────────────────────────
  readonly PAD = 150;
  readonly PASO = 175;
  readonly ALTO = 340;
  private readonly Y = [115, 205];
  @ViewChild('scroll') private scrollRef?: ElementRef<HTMLDivElement>;

  puntos = computed(() => (this.data()?.nodos ?? []).map((n, i) => ({ n, x: this.PAD + i * this.PASO, y: this.Y[i % 2] })));
  xTest = computed(() => this.PAD + this.puntos().length * this.PASO + 30);
  yTest = computed(() => 160);
  ancho = computed(() => this.xTest() + 150);
  completados = computed(() => (this.data()?.nodos ?? []).filter(n => n.estado === 'completado').length);

  tramos = computed(() => {
    const p = this.puntos();
    if (!p.length) return [];
    const curva = (ax: number, ay: number, bx: number, by: number) => {
      const mx = (ax + bx) / 2;
      return `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
    };
    const u = p[p.length - 1];
    return [
      { d: curva(this.PAD - 95, p[0].y, p[0].x, p[0].y), hecho: true },
      ...p.slice(1).map((b, i) => ({ d: curva(p[i].x, p[i].y, b.x, b.y), hecho: p[i].n.estado === 'completado' })),
      { d: curva(u.x, u.y, this.xTest(), this.yTest()), hecho: u.n.estado === 'completado' },
    ];
  });

  async ngOnInit() {
    try {
      const d = await this.niv.mundo(Number(this.route.snapshot.paramMap.get('id')));
      this.data.set(d);
      // Deja seleccionado el nodo actual y centra el mapa en él
      const actual = d.nodos.find(n => n.estado === 'actual') ?? null;
      this.sel.set(actual);
      setTimeout(() => this.centrar(actual), 60);
    } catch (e) {
      this.error.set(NivelacionService.mensajeError(e, 'No se pudo cargar el mundo.'));
    }
  }

  private centrar(n: NodoMapa | null) {
    const el = this.scrollRef?.nativeElement;
    if (!el) return;
    const x = n ? this.puntos().find(p => p.n.id === n.id)?.x ?? 0 : this.xTest();
    el.scrollTo({ left: Math.max(x - el.clientWidth / 2, 0), behavior: 'smooth' });
  }

  anillo(n: NodoMapa, total: number) {
    const pct = (n.fases / total) * 100;
    return `conic-gradient(var(--accent-secondary) ${pct}%, var(--border-color) 0)`;
  }
  fasesArr = (n: number) => Array.from({ length: n });

  seleccionar(n: NodoMapa) { this.sel.set(this.sel()?.id === n.id ? null : n); }
  irFase(n: NodoMapa) { this.router.navigate(['/nivelacion/nodo', n.id, 'fase']); }
  irEntrenar(n: NodoMapa) { this.router.navigate(['/nivelacion/nodo', n.id, 'entrenar']); }
  irTest() { this.router.navigate(['/nivelacion/mundo', this.data()!.mundo.id, 'test']); }
  volver() { this.router.navigate(['/nivelacion']); }
}
