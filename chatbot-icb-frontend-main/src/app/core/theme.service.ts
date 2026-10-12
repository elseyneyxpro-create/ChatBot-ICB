import { Injectable, effect, signal } from '@angular/core';

export type Tema = 'light' | 'dark';
const KEY = 'axi-tema';

/**
 * Modo claro / oscuro de toda la app.
 * Pone <html data-theme="..."> (los colores salen de los tokens de styles.scss)
 * y recuerda la elección en este navegador. Por defecto: oscuro.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly tema = signal<Tema>(ThemeService.leer());

  constructor() {
    effect(() => {
      const t = this.tema();
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem(KEY, t); } catch { /* modo privado: no pasa nada */ }
    });
  }

  toggle() {
    this.tema.update(t => (t === 'dark' ? 'light' : 'dark'));
  }

  private static leer(): Tema {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'light' || v === 'dark') return v;
    } catch { /* sin almacenamiento */ }
    return 'dark';
  }
}
