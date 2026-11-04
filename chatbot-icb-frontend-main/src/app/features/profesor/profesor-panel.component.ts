import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { AlumnoReporte, DetalleAlumno, ProfesorService, ReporteNivelacion } from './profesor.service';

type Tab = 'alumnos' | 'secciones' | 'mundos' | 'preguntas' | 'alertas';
type FiltroEstado = 'todos' | 'En curso' | 'Completada' | 'Sin ingresar' | 'alertas';
type ColOrden = 'nombre' | 'seccion' | 'estado' | 'progreso' | 'acierto' | 'ultima' | 'alertas';

const LS_SECCION = 'axi-prof-seccion';
const LS_TAB = 'axi-prof-tab';

const leer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k: string, v: string | null) => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin storage */ }
};

/**
 * Panel docente: avance de los alumnos en la nivelación.
 * Solo staff (staffGuard + StaffGuard del backend). Los datos y el Excel los arma el servicio de agentes.
 */
@Component({
  selector: 'app-profesor-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule],
  templateUrl: './profesor-panel.component.html',
  styleUrls: ['./profesor-panel.component.scss'],
})
export class ProfesorPanelComponent implements OnInit {
  private api = inject(ProfesorService);
  private auth = inject(AuthService);
  theme = inject(ThemeService);

  reporte = signal<ReporteNivelacion | null>(null);
  cargando = signal(true);
  error = signal<string | null>(null);
  descargando = signal(false);
  errorDescarga = signal<string | null>(null);

  seccion = signal<string | null>(leer(LS_SECCION));
  tab = signal<Tab>((leer(LS_TAB) as Tab) || 'alumnos');

  busqueda = signal('');
  filtroEstado = signal<FiltroEstado>('todos');
  orden = signal<{ col: ColOrden; dir: 1 | -1 }>({ col: 'nombre', dir: 1 });

  seleccionado = signal<AlumnoReporte | null>(null);
  detalle = signal<DetalleAlumno | null>(null);
  cargandoDetalle = signal(false);
  errorDetalle = signal<string | null>(null);

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'alumnos', label: 'Alumnos', icon: 'groups' },
    { id: 'secciones', label: 'Secciones', icon: 'school' },
    { id: 'mundos', label: 'Mundos y nodos', icon: 'route' },
    { id: 'preguntas', label: 'Preguntas', icon: 'quiz' },
    { id: 'alertas', label: 'Alertas', icon: 'warning_amber' },
  ];
  readonly filtros: { id: FiltroEstado; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'En curso', label: 'En curso' },
    { id: 'Completada', label: 'Completada' },
    { id: 'Sin ingresar', label: 'Sin ingresar' },
    { id: 'alertas', label: 'Con alertas' },
  ];

  nombre = computed(() => (this.auth.currentUser()?.displayName ?? '').split(' ')[0]);
  foto = computed(() => this.auth.currentUser()?.photoURL ?? null);
  inicial = computed(() => (this.auth.currentUser()?.displayName || this.auth.currentUser()?.email || '?').charAt(0).toUpperCase());
  chatHabilitado = computed(() => this.auth.currentUser()?.chatbotHabilitado ?? false);

  conAlertas = computed(() => {
    const r = this.reporte();
    if (!r) return [];
    return [...r.alumnos.filter(a => a.alertas.length)]
      .sort((a, b) => b.alertas.length - a.alertas.length || a.nombre.localeCompare(b.nombre));
  });

  conteoEstado = computed(() => {
    const al = this.reporte()?.alumnos ?? [];
    return {
      todos: al.length,
      'En curso': al.filter(a => a.estado === 'En curso').length,
      Completada: al.filter(a => a.estado === 'Completada').length,
      'Sin ingresar': al.filter(a => a.estado === 'Sin ingresar').length,
      alertas: al.filter(a => a.alertas.length).length,
    } as Record<FiltroEstado, number>;
  });

  alumnosVisibles = computed(() => {
    const r = this.reporte();
    if (!r) return [];
    const q = this.normalizar(this.busqueda());
    const f = this.filtroEstado();
    const { col, dir } = this.orden();
    const lista = r.alumnos.filter(a =>
      (f === 'todos' || (f === 'alertas' ? a.alertas.length > 0 : a.estado === f)) &&
      (!q || this.normalizar(`${a.nombre} ${a.correo}`).includes(q)));
    const val = (a: AlumnoReporte): string | number => {
      switch (col) {
        case 'nombre': return this.normalizar(a.nombre);
        case 'seccion': return a.seccion ?? '';
        case 'estado': return ['Sin ingresar', 'En curso', 'Completada'].indexOf(a.estado);
        case 'progreso': return a.progreso;
        case 'acierto': return a.acierto ?? -1;
        case 'ultima': return a.ultima_actividad ? Date.parse(a.ultima_actividad) : 0;
        case 'alertas': return a.alertas.length;
      }
    };
    return lista.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return c * dir || a.nombre.localeCompare(b.nombre);
    });
  });

  nodosPorMundo = computed(() => {
    const r = this.reporte();
    if (!r) return [];
    return r.por_mundo.map(m => ({ ...m, nodos: r.por_nodo.filter(n => n.mundo_id === m.mundo_id) }));
  });

  ngOnInit() {
    this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await this.api.reporte(this.seccion());
      // Si la sección guardada ya no existe, volver a "todas"
      if (this.seccion() && !r.secciones_disponibles.includes(this.seccion()!)) {
        this.cambiarSeccion(null);
        return;
      }
      this.reporte.set(r);
    } catch (e) {
      this.error.set(ProfesorService.mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarSeccion(s: string | null) {
    this.seccion.set(s || null);
    guardar(LS_SECCION, s || null);
    this.cerrarFicha();
    this.cargar();
  }

  cambiarTab(t: Tab) {
    this.tab.set(t);
    guardar(LS_TAB, t);
  }

  ordenar(col: ColOrden) {
    const o = this.orden();
    // Primer clic: texto A→Z, números de mayor a menor
    const inicial: 1 | -1 = col === 'nombre' || col === 'seccion' ? 1 : -1;
    this.orden.set({ col, dir: o.col === col ? (o.dir === 1 ? -1 : 1) : inicial });
  }

  flecha(col: ColOrden) {
    const o = this.orden();
    return o.col !== col ? 'unfold_more' : o.dir === 1 ? 'arrow_upward' : 'arrow_downward';
  }

  async descargar() {
    this.descargando.set(true);
    this.errorDescarga.set(null);
    try {
      await this.api.descargarExcel(this.seccion());
    } catch (e) {
      this.errorDescarga.set(ProfesorService.mensajeError(e, 'No se pudo generar el Excel.'));
    } finally {
      this.descargando.set(false);
    }
  }

  async abrirFicha(a: AlumnoReporte) {
    this.seleccionado.set(a);
    this.detalle.set(null);
    this.errorDetalle.set(null);
    if (!a.uid) return;
    this.cargandoDetalle.set(true);
    try {
      const d = await this.api.detalle(a.uid, this.seccion());
      if (this.seleccionado()?.uid === a.uid) this.detalle.set(d);
    } catch (e) {
      this.errorDetalle.set(ProfesorService.mensajeError(e, 'No se pudo cargar el detalle.'));
    } finally {
      this.cargandoDetalle.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  cerrarFicha() {
    this.seleccionado.set(null);
    this.detalle.set(null);
  }

  verAlumno(correo: string) {
    const a = this.reporte()?.alumnos.find(x => x.correo === correo);
    if (a) this.abrirFicha(a);
  }

  trackCorreo = (_: number, a: AlumnoReporte) => a.correo;

  salir() {
    this.auth.signOut();
  }

  // ── Formato ──────────────────────────────────────────────────────────────
  nivelAcierto(v: number | null | undefined): 'ok' | 'medio' | 'bajo' | 'nd' {
    if (v === null || v === undefined) return 'nd';
    const r = Math.round(v);   // mismo redondeo que se muestra
    return r >= 70 ? 'ok' : r >= 50 ? 'medio' : 'bajo';
  }

  pct(v: number | null | undefined, dec = 0) {
    return v === null || v === undefined ? '—' : `${v.toFixed(dec)} %`;
  }

  hace(iso: string | null, dias: number | null): string {
    if (!iso) return 'Nunca';
    if (dias === null) return '';
    if (dias === 0) {
      const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
      return h <= 0 ? 'Hace un rato' : `Hace ${h} h`;
    }
    return dias === 1 ? 'Ayer' : `Hace ${dias} días`;
  }

  horas(min: number) {
    return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
  }

  tituloMundo(id: number) {
    const m = this.reporte()?.mundos.find(x => x.id === id);
    return m ? `${m.orden}. ${m.titulo}` : '';
  }

  textoTest(m: { completado: boolean; test_fase: number; mejor_puntaje: number; nodos_completados: number; total_nodos: number }) {
    if (m.completado) return `Test aprobado · ${m.mejor_puntaje} pts`;
    if (m.test_fase > 0) return `Test: fase ${m.test_fase} de 2 · ${m.mejor_puntaje} pts`;
    if (m.mejor_puntaje) return `Test reprobado · ${m.mejor_puntaje} pts`;
    return m.nodos_completados === m.total_nodos && m.total_nodos ? 'Test pendiente' : 'Test bloqueado';
  }

  contexto(c: string) {
    return c === 'fase' ? 'Fase' : c === 'test' ? 'Test' : 'Entrenar';
  }

  private normalizar(s: string) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
