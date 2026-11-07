/**
 * \includegraphics in the LyX-style editor: the picture itself (a PDF figure
 * as its first page, an EPS figure from the PDF made of it), at the width its
 * options ask for. Missing files, and EPS nothing has converted, show by name.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';

/** A displayable URL for an \includegraphics path, or null when there is none. */
export type ImageResolver = (path: string) => Promise<string | null>;

/** width=0.5\linewidth (or \textwidth, \columnwidth) as a CSS width; scale=… as a factor of the natural size. */
function sizeOf(options: string | null): { width?: string; scale?: number } {
  if (!options) return {};
  const w = /width\s*=\s*([\d.]*)\s*\\(line|text|column)width/.exec(options);
  if (w) return { width: `${Math.min(100, (Number(w[1] || 1) || 1) * 100)}%` };
  const abs = /width\s*=\s*([\d.]+)\s*(cm|mm|in|pt|bp)/.exec(options);
  if (abs) {
    const px = { cm: 37.8, mm: 3.78, in: 96, pt: 1.33, bp: 1.33 }[abs[2]]! * Number(abs[1]);
    return { width: `min(100%, ${Math.round(px)}px)` };
  }
  const s = /scale\s*=\s*([\d.]+)/.exec(options);
  return s ? { scale: Number(s[1]) } : {};
}

export class GraphicsView implements NodeView {
  dom: HTMLElement;
  private shown = '';

  constructor(
    private node: PMNode,
    private resolve: ImageResolver,
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'lyx-graphics';
    this.render();
  }

  private render() {
    const { path, options } = this.node.attrs as { path: string; options: string | null };
    const key = `${path}|${options}`;
    if (key === this.shown) return;
    this.shown = key;
    this.dom.title = `\\includegraphics${options ? `[${options}]` : ''}{${path}}`;
    this.dom.replaceChildren(Object.assign(document.createElement('span'), { className: 'lyx-graphics-name', textContent: path }));
    // Browsers cannot draw EPS: say how it will show.
    if (/\.e?ps$/i.test(path)) this.dom.title += '\nAn EPS figure shows here once it is converted to PDF: compiling with pdfLaTeX does that, or install Ghostscript.';
    void this.resolve(path).then((url) => {
      if (!url || key !== this.shown) return;
      const img = document.createElement('img');
      img.src = url;
      img.alt = path;
      img.draggable = false;
      const size = sizeOf(options);
      if (size.width) img.style.width = size.width;
      if (size.scale) img.addEventListener('load', () => (img.style.width = `${Math.round(img.naturalWidth * size.scale!)}px`), { once: true });
      this.dom.replaceChildren(img);
    });
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation() {
    return true;
  }
}
