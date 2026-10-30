/**
 * The LyX-style document model, shared by the editor (engine.ts), the LaTeX
 * reader (tex-import.ts) and the LaTeX writer (tex-export.ts).
 *
 * A document is a flat list of block elements (`div.blk`) inside the editor:
 * `data-type` is the paragraph layout (Standard, Section, Itemize, Theorem…) or
 * one of the special blocks (`_display` math, `_toc`, `_newpage`, `_line`);
 * `data-depth` nests lists and paragraphs. Inline content is text, formatting
 * elements (em, strong, span.ftt…), formulas (`span.mwrap > math-field`),
 * special characters (`.sc`), line breaks (`.lb`), insets with a body
 * (`.inset > .ilabel + .ibody`: footnotes, notes, TeX code…) and atoms with no
 * body (`.inset.atom`: labels, references, citations, graphics).
 */

export const ZW = '​';

/* ---------- Layouts ---------- */
export const LAYOUT_GROUPS: [string, string[]][] = [
  ['', ['Standard', 'Quotation', 'Quote', 'Verse', 'LyX-Code']],
  ['Sectioning', ['Part', 'Chapter', 'Section', 'Subsection', 'Subsubsection', 'Paragraph', 'Subparagraph']],
  ['Unnumbered', ['Part*', 'Chapter*', 'Section*', 'Subsection*', 'Subsubsection*', 'Paragraph*', 'Subparagraph*']],
  ['List', ['Itemize', 'Enumerate', 'Description']],
  ['FrontMatter', ['Title', 'Author', 'Date', 'Abstract']],
  ['Reasoning', ['Claim', 'Conjecture', 'Corollary', 'Definition', 'Example', 'Exercise', 'Lemma', 'Problem', 'Proof', 'Proposition', 'Remark', 'Theorem']],
];
export const KNOWN = new Set(LAYOUT_GROUPS.flatMap((g) => g[1]));
export const HEAD: Record<string, number> = { Part: 0, Chapter: 1, Section: 2, Subsection: 3, Subsubsection: 4, Paragraph: 5, Subparagraph: 6 };
export const HEAD_CMD = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
export const HEAD_NAMES = Object.keys(HEAD);
export const LISTS: Record<string, string> = { Itemize: 'itemize', Enumerate: 'enumerate', Description: 'description' };
/** Theorem-like layouts and their amsthm style. Documents can add more (from \newtheorem). */
export const THM: Record<string, 'plain' | 'definition' | 'remark' | 'proof'> = {
  Theorem: 'plain', Lemma: 'plain', Corollary: 'plain', Proposition: 'plain', Conjecture: 'plain', Claim: 'plain',
  Definition: 'definition', Example: 'definition', Exercise: 'definition', Problem: 'definition', Remark: 'remark', Proof: 'proof',
};
export const ENVS: Record<string, string> = { Quote: 'quote', Quotation: 'quotation', Verse: 'verse', 'LyX-Code': 'lyxcode', Abstract: 'abstract' };
export const FRONT: Record<string, string> = { Title: 'title', Author: 'author', Date: 'date' };
export const ATOMBLK = new Set(['_display', '_toc', '_newpage', '_line']);

export const headBase = (t: string | undefined) => (t || '').replace(/\*$/, '');
export const headLevel = (t: string | undefined): number | null => (headBase(t) in HEAD ? HEAD[headBase(t)] : null);
/** The LaTeX environment a layout lives in (null for headings and Standard). */
export const envOf = (t: string): string | null => LISTS[t] || (THM[t] ? t.toLowerCase() : null) || ENVS[t] || null;

/* ---------- Inline special characters ---------- */
export const SC: Record<string, { g: string; tex: string; lyx: string[]; txt: string; name: string }> = {
  dots: { g: '…', tex: '\\ldots{}', lyx: ['\\SpecialChar ldots'], txt: '...', name: 'Ellipsis' },
  eos: { g: '.', tex: '\\@.', lyx: ['\\SpecialChar endofsentence'], txt: '.', name: 'End of sentence' },
  hyph: { g: '-', tex: '\\-', lyx: ['\\SpecialChar softhyphen'], txt: '', name: 'Hyphenation point' },
  lig: { g: '|', tex: '\\textcompwordmark{}', lyx: ['\\SpecialChar ligaturebreak'], txt: '', name: 'Ligature break' },
  slash: { g: '/', tex: '\\slash{}', lyx: ['\\SpecialChar slash'], txt: '/', name: 'Breakable slash' },
  nbdash: { g: '‑', tex: '\\nobreakdash-', lyx: ['\\SpecialChar nobreakdash'], txt: '-', name: 'Protected hyphen' },
  menusep: { g: '▹', tex: '\\lyxarrow{}', lyx: ['\\SpecialChar menuseparator'], txt: '>', name: 'Menu separator' },
  protected: { g: ' ', tex: '~', lyx: ['\\begin_inset space ~', '\\end_inset'], txt: ' ', name: 'Protected space' },
  thin: { g: ' ', tex: '\\,', lyx: ['\\begin_inset space \\thinspace{}', '\\end_inset'], txt: ' ', name: 'Thin space' },
  normal: { g: ' ', tex: '\\ ', lyx: ['\\begin_inset space \\space{}', '\\end_inset'], txt: ' ', name: 'Interword space' },
  visible: { g: '␣', tex: '\\textvisiblespace{}', lyx: ['\\begin_inset space \\textvisiblespace{}', '\\end_inset'], txt: ' ', name: 'Visible space' },
};

/* ---------- Text formatting ---------- */
export const SIZES = ['tiny', 'scriptsize', 'footnotesize', 'small', 'normal', 'large', 'larger', 'largest', 'huge', 'giant'];
export const SIZE_TEX: Record<string, string> = { tiny: 'tiny', scriptsize: 'scriptsize', footnotesize: 'footnotesize', small: 'small', large: 'large', larger: 'Large', largest: 'LARGE', huge: 'huge', giant: 'Huge' };
export const TEX_SIZE: Record<string, string> = Object.fromEntries(Object.entries(SIZE_TEX).map(([k, v]) => [v, k]));

/* ---------- Math environments ---------- */
/** Multi-line AMS environments are edited as their inner (aligned/gathered) form. */
export const ENVVIS: Record<string, string> = { align: 'aligned', eqnarray: 'aligned', alignat: 'aligned', flalign: 'aligned', gather: 'gathered', multline: 'gathered' };
export const envWrap = (env: string, inner: string) => `\\begin{${ENVVIS[env]}}${inner}\\end{${ENVVIS[env]}}`;
export function stripEnv(l: string) {
  const m = /^\s*\\begin\{(aligned|gathered)\}([\s\S]*)\\end\{\1\}\s*$/.exec(l);
  return m ? m[2] : l;
}

/* ---------- Factories ---------- */
type MathHook = (mf: HTMLElement) => void;
let mathHook: MathHook = () => {};
/** The editor installs this to wire every formula it creates (focus, move-out, macros…). */
export function setMathHook(fn: MathHook) {
  mathHook = fn;
}

/**
 * The LaTeX of a formula. `data-tex` holds the formula exactly as it was read
 * from the file until it is edited, so untouched formulas are written back
 * byte for byte (MathLive normalises what it serialises).
 */
export function latexOf(mf: Element | null | undefined): string {
  if (!mf) return '';
  const el = mf as HTMLElement & { value?: unknown };
  if (el.dataset.tex !== undefined) return el.dataset.tex;
  const v = el.value;
  return (typeof v === 'string' ? v : el.textContent) || '';
}

export function mkBlock(type: string, ...content: (Node | string)[]): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'blk';
  d.dataset.type = type;
  content.forEach((c) => d.append(typeof c === 'string' ? document.createTextNode(c) : c));
  if (!d.childNodes.length) d.appendChild(document.createElement('br'));
  return d;
}

function mathField(cls: string, latex: string, src: boolean) {
  const mf = document.createElement('math-field');
  mf.className = cls;
  mf.textContent = latex;
  if (src) mf.dataset.tex = latex;
  return mf;
}

/** An inline formula. `src` keeps `latex` verbatim for export until the formula is edited. */
export function mkMath(latex = '', src = false): HTMLSpanElement {
  const w = document.createElement('span');
  w.className = 'mwrap';
  w.contentEditable = 'false';
  const mf = mathField('inline', latex, src);
  w.appendChild(mf);
  mathHook(mf);
  return w;
}

export function mkDisplay(latex = '', numbered = false, env = '', label = '', src = false): HTMLDivElement {
  const b = document.createElement('div');
  b.className = 'blk';
  b.dataset.type = '_display';
  b.contentEditable = 'false';
  if (numbered) b.dataset.numbered = '1';
  if (env) b.dataset.env = env;
  if (label) b.dataset.label = label;
  const mf = mathField('display', latex, src);
  const no = document.createElement('span');
  no.className = 'eqno';
  const lb = document.createElement('span');
  lb.className = 'eqlabel';
  b.append(mf, no, lb);
  mathHook(mf);
  return b;
}

export function mkSC(k: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'sc';
  s.contentEditable = 'false';
  s.dataset.sc = k;
  s.title = SC[k].name;
  s.textContent = SC[k].g;
  return s;
}

export function mkLB(kind: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'lb';
  s.contentEditable = 'false';
  s.dataset.lb = kind;
  s.title = kind === 'linebreak' ? 'Justified line break' : 'Ragged line break';
  s.innerHTML = '↵<br>';
  return s;
}

export const INSET_LABEL: Record<string, string> = { Foot: 'foot', Marginal: 'margin', ERT: 'TeX', URL: 'URL', Caption: 'Caption', Float: 'float' };

/** An inset with an editable body: Foot, Marginal, Note, ERT (TeX code), URL, Float, Caption. */
export function mkInset(type: string, variant?: string, content?: Node | null): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'inset';
  s.contentEditable = 'false';
  s.dataset.inset = type;
  if (type === 'Note') s.dataset.note = variant || 'Note';
  if (type === 'Float') s.dataset.float = variant || 'figure';
  const l = document.createElement('span');
  l.className = 'ilabel';
  l.textContent = type === 'Note' ? variant || 'Note' : type === 'Float' ? (variant === 'table' ? 'Table' : 'Figure') : INSET_LABEL[type] || type;
  const b = document.createElement('span');
  b.className = 'ibody';
  b.contentEditable = 'true';
  if (content) b.append(content);
  if (!b.textContent!.replace(/​/g, '') && !b.querySelector('math-field,.inset')) b.textContent = ZW;
  s.append(l, b);
  return s;
}

/** A TeX-code (ERT) inset holding `tex` verbatim. */
export function mkERT(tex: string): HTMLSpanElement {
  const i = mkInset('ERT');
  i.querySelector('.ibody')!.textContent = tex || ZW;
  return i;
}

const ATOM_TEXT: Record<string, (a: Record<string, string>) => string> = {
  Label: (a) => a.name,
  Href: (a) => a.name || a.target,
  Raw: (a) => '[' + (a.kind || 'inset') + ']',
  Cite: (a) => '[' + (a.keys || '').split(',').map((k) => k.trim()).join(', ') + ']',
  Graphics: (a) => a.path,
};

/** An inset with no editable body: Label, Ref, Href, Cite, Graphics, Raw. */
export function mkAtom(type: string, attrs: Record<string, string> = {}): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'inset atom' + (type === 'Raw' ? ' raw' : '');
  s.contentEditable = 'false';
  s.dataset.inset = type;
  if (type === 'Raw') s.title = 'Kept as-is; not editable here';
  Object.entries(attrs).forEach(([k, v]) => {
    if (v !== undefined && v !== '') s.dataset[k] = v;
  });
  s.textContent = ATOM_TEXT[type] ? ATOM_TEXT[type](attrs) : '??';
  return s;
}

export function mkSpecial(type: string, variant?: string): HTMLDivElement {
  const b = document.createElement('div');
  b.className = 'blk';
  b.dataset.type = type;
  b.contentEditable = 'false';
  if (type === '_newpage') {
    b.dataset.variant = variant || 'newpage';
    b.textContent = ({ newpage: 'New Page', pagebreak: 'Page Break', clearpage: 'Clear Page', cleardoublepage: 'Clear Double Page' } as Record<string, string>)[b.dataset.variant];
  } else if (type === '_line') b.innerHTML = '<hr>';
  else if (type === '_toc') b.innerHTML = '<div class="toch">Table of Contents</div><div class="tocl"></div>';
  return b;
}

export const isTextBlock = (b: Element | null | undefined): b is HTMLElement =>
  !!b && (b as HTMLElement).classList?.contains('blk') && !ATOMBLK.has((b as HTMLElement).dataset.type!);
