import { inject, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import katex from 'katex';

@Pipe({ name: 'katexRender', standalone: true, pure: true })
export class KatexRenderPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(text: string): SafeHtml {
    if (!text) return '';

    // 1. Escapar HTML básico para evitar XSS en el texto plano
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Bloques LaTeX: \[ ... \] y $$ ... $$
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
      try { return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }); }
      catch { return _; }
    });
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
      try { return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }); }
      catch { return _; }
    });

    // 3. LaTeX inline: \( ... \) y $ ... $
    html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
      try { return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }); }
      catch { return _; }
    });
    html = html.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
      try { return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }); }
      catch { return _; }
    });

    // 4. Markdown básico: **negrita**, *cursiva*, `código`, saltos de línea
    html = html
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

    // 5. Marcar como HTML seguro — Angular no lo va a sanitizar
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
