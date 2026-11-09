import { Component, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter } from 'rxjs';
import { AuthService, Vista } from '../../core/auth.service';
import { NivelacionService } from '../nivelacion/nivelacion.service';

/**
 * Selector de vista para demos. Solo lo ve el equipo de desarrollo (rol dev = codigo_asignatura "crack").
 *   - Ver como alumno: la app normal del alumno; opcional "todos los mundos desbloqueados" (lo guarda el backend).
 *   - Ver como profesor: panel docente + chat, sin nivelación (como un profesor real).
 * Es solo interfaz: el backend sigue validando con el rol real.
 */
@Component({
  selector: 'app-vista-demo',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="vd" *ngIf="visible()">
      <div class="panel" *ngIf="abierto()" role="dialog" aria-label="Ver la app como">
        <div class="p-tit">
          <span>Ver la app como</span>
          <small>Solo equipo de desarrollo</small>
        </div>
        <div class="opciones">
          <button type="button" class="op" [class.sel]="auth.vista() === 'alumno'" (click)="elegir('alumno')">
            <mat-icon>person</mat-icon>
            <span><strong>Alumno</strong><small>Nivelación, tutor y chat</small></span>
          </button>
          <button type="button" class="op" [class.sel]="auth.vista() === 'profesor'" (click)="elegir('profesor')">
            <mat-icon>co_present</mat-icon>
            <span><strong>Profesor</strong><small>Panel docente y chat, sin nivelación</small></span>
          </button>
        </div>
        <label class="toggle" [class.off]="auth.vista() !== 'alumno'">
          <span><strong>Todo desbloqueado</strong><small>Todos los mundos, nodos y tests abiertos</small></span>
          <button type="button" role="switch" class="switch" [class.on]="desbloqueo()"
                  [attr.aria-checked]="desbloqueo()" [disabled]="auth.vista() !== 'alumno' || guardando()"
                  (click)="alternarDesbloqueo()"><span></span></button>
        </label>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </div>
      <button type="button" class="pill" [class.modo-dev]="desbloqueo() && auth.vista() === 'alumno'"
              (click)="abierto.set(!abierto())" [attr.aria-expanded]="abierto()" [title]="etiqueta() + ' · cambiar vista'">
        <mat-icon>{{ auth.vista() === 'profesor' ? 'co_present' : 'visibility' }}</mat-icon>
        <span class="txt">{{ etiqueta() }}</span>
      </button>
    </div>
  `,
  styles: [`
    .vd { position: fixed; left: 16px; bottom: 16px; z-index: 1000; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; font-family: 'Outfit', 'Roboto', sans-serif; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px 0 11px; border-radius: 20px; cursor: pointer;
      border: 1px dashed #f59e0b; background: rgba(28, 25, 23, 0.88); color: #fde68a; font: inherit; font-size: 0.85rem; font-weight: 600;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25); backdrop-filter: blur(6px); opacity: 0.85; transition: opacity 0.2s;
    }
    .pill:hover, .pill[aria-expanded="true"] { opacity: 1; }
    .pill mat-icon { font-size: 19px; width: 19px; height: 19px; }
    /* Compacto para no tapar la pantalla: el texto aparece al pasar el mouse o con el panel abierto */
    .pill .txt { max-width: 0; overflow: hidden; white-space: nowrap; transition: max-width 0.25s ease; }
    .pill { padding: 0 9px; gap: 0; }
    .vd:hover .pill, .pill[aria-expanded="true"] { padding: 0 14px 0 11px; gap: 6px; }
    .vd:hover .pill .txt, .pill[aria-expanded="true"] .txt { max-width: 240px; }
    .pill.modo-dev { background: rgba(120, 53, 15, 0.92); }
    .panel {
      width: min(320px, calc(100vw - 32px)); padding: 14px; border-radius: 16px; display: flex; flex-direction: column; gap: 12px;
      background: var(--bg-panel, #1c1917); color: var(--text, #fff); border: 1px solid var(--border, #444);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3); animation: vd-in 0.15s ease both;
    }
    .p-tit { display: flex; flex-direction: column; gap: 1px; }
    .p-tit span { font-weight: 700; font-size: 1rem; }
    .p-tit small, .op small, .toggle small { color: var(--text-3, #999); font-size: 0.78rem; }
    .opciones { display: flex; flex-direction: column; gap: 6px; }
    .op {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; cursor: pointer; text-align: left;
      border: 1px solid var(--border, #444); background: transparent; color: inherit; font: inherit;
    }
    .op span { display: flex; flex-direction: column; }
    .op strong { font-size: 0.92rem; }
    .op mat-icon { color: var(--accent, #8b5cf6); }
    .op.sel { border-color: var(--accent, #8b5cf6); background: var(--accent-soft, rgba(139, 92, 246, 0.12)); }
    .toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 2px; }
    .toggle span { display: flex; flex-direction: column; }
    .toggle strong { font-size: 0.9rem; }
    .toggle.off { opacity: 0.5; }
    .switch { flex: 0 0 auto; width: 42px; height: 24px; border-radius: 12px; border: none; padding: 3px; cursor: pointer; background: var(--border, #555); transition: background 0.2s; }
    .switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.2s; }
    .switch.on { background: #f59e0b; }
    .switch.on span { transform: translateX(18px); }
    .switch:disabled { cursor: default; }
    .error { margin: 0; color: #ef4444; font-size: 0.8rem; }
    @keyframes vd-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (max-width: 700px) { .vd { left: 10px; bottom: 10px; } }
  `],
})
export class VistaDemoComponent {
  auth = inject(AuthService);
  private niv = inject(NivelacionService);
  private router = inject(Router);
  private host = inject(ElementRef<HTMLElement>);

  abierto = signal(false);
  desbloqueo = signal(false);
  guardando = signal(false);
  error = signal('');
  private url = signal(this.router.url);
  private cargado = false;

  /** Solo dev, con sesión y fuera de las pantallas de login/logout. */
  visible = computed(() => this.auth.esDev() && !/^\/(login|logout|signup|auth)/.test(this.url()));

  etiqueta = computed(() =>
    this.auth.vista() === 'profesor' ? 'Vista profesor' : this.desbloqueo() ? 'Vista alumno · todo abierto' : 'Vista alumno');

  constructor() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => this.url.set((e as NavigationEnd).urlAfterRedirects));
    // Lee el modo desbloqueado una vez, cuando se sabe que es dev
    effect(() => {
      if (this.auth.esDev() && !this.cargado) {
        this.cargado = true;
        this.niv.modoDev().then(r => this.desbloqueo.set(r.desbloquear)).catch(() => {});
      }
    }, { allowSignalWrites: true });
  }

  elegir(v: Vista) {
    this.abierto.set(false);
    if (v === this.auth.vista()) return;
    this.auth.cambiarVista(v);
    // Cada vista parte desde su inicio: profesor → panel docente; alumno → selector de módulos
    this.router.navigateByUrl(v === 'profesor' ? '/profesor' : '/inicio');
  }

  async alternarDesbloqueo() {
    this.guardando.set(true);
    this.error.set('');
    try {
      const r = await this.niv.cambiarModoDev(!this.desbloqueo());
      this.desbloqueo.set(r.desbloquear);
      if (this.url().startsWith('/nivelacion')) {
        await this.niv.cargarEstado();
        // Las pantallas de mundo/nodo cargan sus datos al entrar: se vuelve al mapa para verlo actualizado
        if (this.url() !== '/nivelacion') this.router.navigateByUrl('/nivelacion');
      }
    } catch {
      this.error.set('No se pudo cambiar. ¿Sigues con sesión?');
    } finally {
      this.guardando.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  clicFuera(ev: MouseEvent) {
    if (this.abierto() && !this.host.nativeElement.contains(ev.target as Node)) this.abierto.set(false);
  }

  @HostListener('document:keydown.escape')
  escape() { this.abierto.set(false); }
}
