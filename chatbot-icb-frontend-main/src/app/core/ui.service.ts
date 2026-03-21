import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UiService {
  /** Solo afecta mobile: true = topbar visible, false = oculto */
  topbarVisible = signal(true);
  /** true cuando el usuario scrolleó arriba en el chat */
  chatScrolledUp = signal(false);
}
