import { inject, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import katex from 'katex';

@Pipe({ name: 'katexRender', standalone: true, pure: true })
export class KatexRenderPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(text: string): SafeHtml {
    if (!text) return '';

    // 1. Extraer bloques LaTeX antes de escapar HTML para protegerlos
    const latexBlocks: string[] = [];
    const latexInlines: string[] = [];

    // Placeholder tokens
    const BLOCK = '\x00BLK\x00';
    const INLINE = '\x00INL\x00';

    let src = text;

    // Extraer bloques $$ ... $$ y \[ ... \]
    src = src.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, a, b) => {
      const math = (a ?? b).trim();
      try { latexBlocks.push(katex.renderToString(math, { displayMode: true, throwOnError: false })); }
      catch { latexBlocks.push(math); }
      return BLOCK;
    });

    // Extraer inline \( ... \) y $ ... $
    src = src.replace(/\\\(([\s\S]*?)\\\)|\$([^\$\n]+?)\$/g, (_, a, b) => {
      const math = (a ?? b).trim();
      try { latexInlines.push(katex.renderToString(math, { displayMode: false, throwOnError: false })); }
      catch { latexInlines.push(math); }
      return INLINE;
    });

    // 2. Escapar HTML del texto restante
    let html = src
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 3. Markdown: encabezados (## y ###)
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');

    // 4. Markdown: línea horizontal ---
    html = html.replace(/^---$/gm, '<hr>');

    // 5. Markdown: listas numeradas (1. 2. ...)
    html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => {
      const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `<ol>${items}</ol>`;
    });

    // 6. Markdown: listas con viñetas (- o *)
    html = html.replace(/((?:^[-*] .+\n?)+)/gm, (match) => {
      const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    });

    // 7. Markdown: **negrita**, *cursiva*, `código`
    html = html
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    // 8. Saltos de línea → <br> (excepto dentro de ol/ul)
    html = html.replace(/\n/g, '<br>');

    // 9. Restaurar bloques LaTeX
    let bi = 0, ii = 0;
    html = html.replace(new RegExp(BLOCK.replace(/\x00/g, '\\x00'), 'g'), () => latexBlocks[bi++] ?? '');
    html = html.replace(new RegExp(INLINE.replace(/\x00/g, '\\x00'), 'g'), () => latexInlines[ii++] ?? '');

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
