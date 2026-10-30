/**
 * The LyX-style editor for one .tex file (Settings → Editor style → LyX style).
 *
 * The file's Monaco model stays the source of truth, as in the default editor:
 * edits are written into it as one minimal replacement, so undo history, the
 * Workspace (saving, compiling, Git) and live collaboration all see ordinary
 * text edits. Changes that arrive from elsewhere (a pull, a collaborator, a
 * restore) are merged with any edit not yet written, then read back in.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import 'material-symbols/outlined.css';
import './lyx.css';
import type { monaco } from '../editor/monaco';
import { getModel } from '../editor/models';
import { editorBridge } from '../editor/bridge';
import { compile, forwardSearch, workspace } from '../state/actions';
import { getState, setState as setAppState, toast, updateSettings, useStore } from '../state/store';
import { cleanField, mergeBib, parseBib } from '../latex/bib';
import { loadedPackages } from '../latex/analysis';
import { zotero, type ZoteroSource } from '../storage/server';
import { dirname, extname, isImagePath, relativePath } from '../utils/paths';
import { Spinner } from '../components/ui';
import { createLyxEditor, type LyxEditor, type LyxHost } from './engine';
import { graphicsPaths } from './tex-import';

type MathLive = typeof import('mathlive');
let mathlive: Promise<MathLive> | null = null;

/** MathLive (≈1 MB) loads the first time a file is opened in the LyX style. Its fonts are bundled. */
function loadMathLive(): Promise<MathLive> {
  mathlive ??= (async () => {
    await import('mathlive/fonts.css');
    const ML = await import('mathlive');
    ML.MathfieldElement.fontsDirectory = null;
    ML.MathfieldElement.soundsDirectory = null;
    ML.MathfieldElement.plonkSound = null;
    return ML;
  })();
  mathlive.catch(() => (mathlive = null));
  return mathlive;
}

/** Resolve `p` against `dir`, allowing `..` (null when it leaves the project). */
function resolve(dir: string, p: string): string | null {
  const out = dir ? dir.split('/') : [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
/** Tried in turn for an \includegraphics path without an extension (pdfTeX's order first). */
const GRAPHICS_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'bmp', 'eps'];

/** Page 1 of a PDF figure as a PNG (pdf.js loads the first time one is shown). */
async function pdfImage(data: Uint8Array): Promise<string | null> {
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
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return blob && URL.createObjectURL(blob);
  } finally {
    void task.destroy();
  }
}

/** The span of `b` that differs from `a`: [start, end in a, end in b]. */
function diffSpan(a: string, b: string): [number, number, number] {
  let s = 0;
  const n = Math.min(a.length, b.length);
  while (s < n && a.charCodeAt(s) === b.charCodeAt(s)) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) {
    ea--;
    eb--;
  }
  return [s, ea, eb];
}

/**
 * Merge two edits of `base`: `ours` (written in the LyX editor) and `theirs`
 * (arrived from elsewhere). Null when they touch the same text.
 */
export function merge3(base: string, ours: string, theirs: string): string | null {
  if (ours === base) return theirs;
  if (theirs === base || theirs === ours) return ours;
  const [s1, e1, f1] = diffSpan(base, ours);
  const [s2, e2, f2] = diffSpan(base, theirs);
  if (e1 <= s2) return base.slice(0, s1) + ours.slice(s1, f1) + base.slice(e1, s2) + theirs.slice(s2, f2) + base.slice(e2);
  if (e2 <= s1) return base.slice(0, s2) + theirs.slice(s2, f2) + base.slice(e2, s1) + ours.slice(s1, f1) + base.slice(e1);
  return null;
}

/** Replace `model`'s text with `text` as one minimal edit (keeps undo and collaboration cursors sane). */
function applyText(model: monaco.editor.ITextModel, text: string) {
  const cur = model.getValue();
  if (cur === text) return;
  const [s, e, f] = diffSpan(cur, text);
  const a = model.getPositionAt(s);
  const b = model.getPositionAt(e);
  model.pushEditOperations([], [{ range: { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }, text: text.slice(s, f) }], () => null);
}

export function LyxPane({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LyxEditor | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const reveal = useStore((s) => s.reveal);
  const epoch = useStore((s) => s.epoch);

  useEffect(() => {
    const model = getModel(path);
    if (!model) return;
    let disposed = false;
    let ed: LyxEditor | null = null;
    let sub: monaco.IDisposable | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** The text the editor's document corresponds to. */
    let base = model.getValue();
    /** Image URLs by `path@updatedAt`; a PDF figure's is a promise while it renders. */
    const urls = new Map<string, string | Promise<string | null> | null>();

    const write = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!ed) return;
      const text = ed.getText();
      base = text;
      applyText(model, text);
    };

    const mainDir = () => dirname(getState().project?.mainFile ?? path);
    const mainPackages = () => loadedPackages(workspace()?.getText(getState().project?.mainFile ?? path) ?? '');
    const host: Omit<LyxHost, 'mathlive'> = {
      fileName: path,
      onChange: () => {
        clearTimeout(timer);
        timer = setTimeout(write, 200);
      },
      save: () => {
        write();
        void compile({ reason: 'manual' });
      },
      compile: () => {
        write();
        void compile({ reason: 'manual' });
      },
      showInPdf: (line) => {
        write();
        forwardSearch(line);
      },
      openSource: () => {
        write();
        updateSettings({ editorStyle: 'default' });
      },
      bibKeys: () => {
        const out: { key: string; label: string }[] = [];
        for (const f of workspace()?.textFiles('bib') ?? []) {
          for (const e of parseBib(f.text, f.path)) {
            const author = cleanField(e.fields.author ?? e.fields.editor ?? '').split(/\s+and\s+/)[0]?.split(',')[0] ?? '';
            const year = cleanField(e.fields.year ?? e.fields.date ?? '').slice(0, 4);
            out.push({ key: e.key, label: [author && `${author}${year ? ` ${year}` : ''}`, cleanField(e.fields.title ?? '')].filter(Boolean).join(': ') });
          }
        }
        return out;
      },
      defaultCite: () => {
        const pkgs = mainPackages();
        return pkgs.has('biblatex') ? 'autocite' : pkgs.has('natbib') ? 'citep' : 'cite';
      },
      zotero: {
        status: () => zotero.status(),
        search: (q) => zotero.search(q),
        // as the source editor's citation picker does: merge into the project's .bib and report it
        importItems: async (ids, source) => {
          const ws = workspace();
          if (!ws) return [];
          const { bibtex } = await zotero.export(ids, source as ZoteroSource, mainPackages().has('biblatex'));
          const target = ws.paths().find((p) => p.endsWith('.bib')) ?? 'references.bib';
          const merged = mergeBib(ws.getText(target) ?? '', bibtex);
          if (merged.added.length) ws.writeFile(target, merged.text);
          const main = ws.getText(getState().project?.mainFile ?? path) ?? '';
          if (!/\\(bibliography|addbibresource|printbibliography)\b/.test(main)) {
            toast({ kind: 'warning', title: 'No bibliography yet', message: `Added to ${target}. Use Insert ▸ List / TOC ▸ BibTeX Bibliography at the end of your document to print it.` });
          } else if (merged.added.length) {
            toast({ kind: 'success', title: merged.added.length === 1 ? 'Reference imported' : `${merged.added.length} references imported`, message: `${merged.added.join(', ')} → ${target}` });
          }
          return merged.keys;
        },
      },
      bibFiles: () => (workspace()?.textFiles('bib') ?? []).map((f) => relativePath(getState().project?.mainFile ?? path, f.path).replace(/\.bib$/, '')),
      images: () => {
        const main = getState().project?.mainFile ?? path;
        return (workspace()?.paths() ?? []).filter((p) => isImagePath(p)).map((p) => relativePath(main, p));
      },
      imageUrl: (p) => {
        const ws = workspace();
        if (!ws) return null;
        const main = getState().project?.mainFile ?? path;
        const dirs = [mainDir(), dirname(path)];
        for (const g of graphicsPaths(ws.getText(main) ?? '')) dirs.push(resolve(mainDir(), g) ?? '');
        for (const dir of new Set(dirs)) {
          const base = resolve(dir, p);
          if (base == null) continue;
          for (const cand of extname(base) && (IMAGE_TYPES[extname(base)] || extname(base) === 'pdf') ? [base] : GRAPHICS_EXTS.map((e) => `${base}.${e}`)) {
            const f = ws.get(cand);
            if (!f || f.omitted) continue;
            const key = `${cand}@${f.updatedAt}`;
            const cached = urls.get(key);
            if (cached !== undefined) return cached;
            const ext = extname(cand);
            let url: string | Promise<string | null> | null = null;
            // SVG is kept as text; EPS has no browser renderer (shown as its name)
            const bytes = f.data ?? (f.text != null ? new TextEncoder().encode(f.text) : null);
            if (!bytes) continue;
            if (ext === 'pdf') url = pdfImage(bytes).catch(() => null);
            else if (IMAGE_TYPES[ext]) url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: IMAGE_TYPES[ext] }));
            urls.set(key, url);
            return url;
          }
        }
        return null;
      },
    };

    setState('loading');
    loadMathLive()
      .then((ML) => {
        if (disposed || !hostRef.current) return;
        ed = createLyxEditor(hostRef.current, { ...host, mathlive: ML });
        editorRef.current = ed;
        ed.load(base);
        sub = model.onDidChangeContent(() => {
          const theirs = model.getValue();
          if (theirs === base || !ed) return;
          // a change from elsewhere: merge it with ours (if any is pending), then read the result back in
          let next = theirs;
          if (timer) {
            clearTimeout(timer);
            timer = undefined;
            const merged = merge3(base, ed.getText(), theirs);
            if (merged == null) toast({ kind: 'warning', title: 'Edit replaced', message: 'The same paragraph was changed elsewhere at the same time; that version was kept.' });
            else next = merged;
          }
          base = next;
          if (next !== theirs) applyText(model, next);
          ed.load(next, true);
        });
        setState('ready');
        editorBridge.setCursorLine(() => ed?.caretPosition().line ?? 1);
        // coming from the source editor: start where its cursor was
        const mon = editorBridge.get();
        const at = mon?.getModel() === model ? mon.getPosition() : null;
        requestAnimationFrame(() => {
          if (disposed || !ed || getState().dialog) return;
          if (at && (at.lineNumber > 1 || at.column > 1)) ed.reveal(at.lineNumber, at.column);
          else ed.focus();
        });
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });

    return () => {
      disposed = true;
      if (timer) write();
      sub?.dispose();
      if (ed) editorBridge.setCursorLine(null);
      ed?.destroy();
      editorRef.current = null;
      for (const u of urls.values()) void Promise.resolve(u).then((x) => x && URL.revokeObjectURL(x));
    };
  }, [path, epoch]);

  // Switching this file to the source editor: put its cursor where ours is. A layout-effect
  // cleanup runs while the document is still on the page (the selection is gone after that).
  useLayoutEffect(
    () => () => {
      const ed = editorRef.current;
      if (!ed || getState().settings.editorStyle === 'lyx' || getState().activePath !== path) return;
      const { line, column } = ed.caretPosition();
      setAppState({ reveal: { path, line, column, nonce: Date.now() } });
    },
    [path, epoch],
  );

  // SyncTeX inverse search, outline clicks, diagnostics: show the paragraph
  useEffect(() => {
    if (!reveal || reveal.path !== path || state !== 'ready') return;
    editorRef.current?.reveal(reveal.line, reveal.column);
  }, [reveal, path, state]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="absolute inset-0" data-testid="lyx-editor" />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel text-sm text-muted">
          {state === 'loading' ? (
            <span className="flex items-center gap-2">
              <Spinner /> Loading the LyX-style editor…
            </span>
          ) : (
            <span className="max-w-md text-center">
              The LyX-style editor could not start: {error}
              <br />
              <button className="mt-2 text-accent hover:underline" onClick={() => updateSettings({ editorStyle: 'default' })}>
                Use the LaTeX source editor
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
