/**
 * Finding and showing the pictures \includegraphics names, for the LyX-style
 * editor: paths are relative to the .tex file, may leave out the extension
 * (pdfTeX tries .pdf, .png, .jpg…), and are also looked up in the folders of
 * \graphicspath. A PDF figure is shown as its first page.
 */
import type { Workspace } from '../state/workspace';
import { dirname } from '../utils/paths';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
};
/** Tried in turn for a path without an extension, pdfTeX's order first. */
const EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'bmp', 'eps'];

/** `p` resolved against folder `dir` of the project, allowing `..`; null when it leaves the project. */
export function resolveInProject(dir: string, p: string): string | null {
  const out = dir ? dir.split('/') : [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

/** The folders of \graphicspath{{figures/}{img/}}. */
export function graphicsPaths(preamble: string): string[] {
  const m = /\\graphicspath\s*\{((?:\s*\{[^}]*\})+)\s*\}/.exec(preamble.replace(/(^|[^\\])%.*$/gm, '$1'));
  return m ? [...m[1].matchAll(/\{([^}]*)\}/g)].map((x) => x[1]) : [];
}

/** The project file an \includegraphics path means, or null. */
export function findGraphic(ws: Workspace, texPath: string, path: string, searchDirs: string[]): string | null {
  const dir = dirname(texPath);
  const hasExt = /\.[a-z0-9]+$/i.test(path);
  for (const base of ['', ...searchDirs]) {
    const full = resolveInProject(dir, base + path);
    if (!full) continue;
    for (const candidate of hasExt ? [full] : EXTENSIONS.map((e) => `${full}.${e}`)) {
      if (ws.get(candidate)) return candidate;
    }
  }
  return null;
}

/** Page 1 of a PDF as a PNG data URL. */
async function pdfFirstPage(data: Uint8Array): Promise<string | null> {
  const { pdfjs } = await import('../pdf/pdfjs');
  const task = pdfjs.getDocument({ data: data.slice() });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    void task.destroy();
  }
}

/**
 * The PDF pdfLaTeX made from an EPS figure when it compiled (the epstopdf
 * package writes `fig-eps-converted-to.pdf` next to `fig.eps`), if there is one.
 */
export const convertedEps = (file: string) => file.replace(/\.(eps|ps)$/i, '-$1-converted-to.pdf');

/** Converts an EPS file of the project to PDF (on the server); null when it cannot. */
export type EpsConverter = (path: string) => Promise<Uint8Array | null>;

/**
 * An image resolver for one .tex file: \includegraphics path → a URL to show,
 * or null (missing file, an EPS nothing can convert, a file still being
 * uploaded). Browsers cannot draw EPS: it is shown from the PDF compiling
 * made of it, or converted by the server. Results are cached until the file
 * changes.
 */
export function imageResolver(ws: () => Workspace | null, texPath: string, preamble: () => string, convertEps?: EpsConverter) {
  const cache = new Map<string, { at: number; url: Promise<string | null> }>();
  return (path: string): Promise<string | null> => {
    const w = ws();
    if (!w) return Promise.resolve(null);
    const file = findGraphic(w, texPath, path, graphicsPaths(preamble()));
    const entry = file ? w.get(file) : undefined;
    if (!file || !entry) return Promise.resolve(null);
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
    const eps = ext === 'eps' || ext === 'ps';
    const converted = eps ? w.get(convertedEps(file)) : undefined;
    const stamp = entry.updatedAt + (converted?.updatedAt ?? 0);
    const hit = cache.get(file);
    if (hit && hit.at === stamp) return hit.url;
    let url: Promise<string | null>;
    if (eps) {
      url = converted?.data
        ? pdfFirstPage(converted.data).catch(() => null)
        : convertEps
          ? convertEps(file).then((pdf) => (pdf ? pdfFirstPage(pdf) : null)).catch(() => null)
          : Promise.resolve(null);
    } else if (!entry.data) url = Promise.resolve(null);
    else if (ext === 'pdf') url = pdfFirstPage(entry.data).catch(() => null);
    else if (IMAGE_TYPES[ext]) url = Promise.resolve(URL.createObjectURL(new Blob([entry.data as BlobPart], { type: IMAGE_TYPES[ext] })));
    else url = Promise.resolve(null);
    cache.set(file, { at: stamp, url });
    return url;
  };
}
