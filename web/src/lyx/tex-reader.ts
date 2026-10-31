/**
 * LaTeX → the LyX-style editor's document (schema.ts).
 *
 * The body (between \begin{document} and \end{document}, or the whole file
 * for a file that is \input) is cut into blocks. Every block, and every run
 * of blocks that belong together (a list, a theorem, a paragraph broken by a
 * display formula), is recorded as a *unit* with its exact source text. The
 * writer (tex-writer.ts) puts that text back for any unit whose nodes were
 * not edited, so a file read and written unchanged comes back byte for byte.
 */
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema } from './schema';
import { DEFAULT_THEOREMS, frontOfCommand, headingOfCommand, layoutOfEnv, type Layout, type Theorems } from './layouts';
import { blankLineAt, matchBrace, matchBracket, matchDisplayMath, matchEnd, matchInlineMath, matchVerb, readBegin, readCommand, skipComment, skipSpace } from './scan';
import { parseColumns, splitRows, TABULARS } from './table';

/**
 * What a unit's text is: a block or blocks read together (`block`), a
 * whole environment (`env`), or one paragraph of an environment with what is
 * nested under it (`member`: an `\item …`, a theorem's paragraph).
 */
export type UnitKind = 'block' | 'env' | 'member';

/** A block or run of blocks read from the file, with the text it was read from. */
export interface Unit {
  kind: UnitKind;
  nodes: PMNode[];
  src: string;
}

/**
 * Units by their first node (a list, its first item and that item's text
 * start with the same node). The writer reuses a unit while its nodes are
 * unchanged.
 */
export type Units = WeakMap<PMNode, Unit[]>;

export interface TexDocument {
  /** Everything up to and including \begin{document} ('' for a file without one). */
  prefix: string;
  /** \end{document} and everything after it. */
  suffix: string;
  doc: PMNode;
  units: Units;
  theorems: Theorems;
  /** Environments the body used when it was read. */
  envsInUse: Set<string>;
  /** Packages the body's commands already needed when it was read (they are loaded somehow). */
  packagesInUse: Set<string>;
}

const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*', 'displaymath']);
/** Single-formula environments: their \label is shown as the formula's label. */
const ONE_FORMULA = new Set(['equation', 'equation*', 'displaymath', '\\[', '$$']);
const LIST_ENVS = new Set(['itemize', 'enumerate', 'description']);
const FLOATS = new Set(['figure', 'figure*', 'table', 'table*']);
const ALIGNMENTS = new Set(['center', 'flushleft', 'flushright']);
/** Commands that stand as a block of their own (kept as TeX code). */
const BLOCK_COMMANDS = new Set([
  'maketitle', 'tableofcontents', 'listoffigures', 'listoftables', 'newpage', 'clearpage', 'cleardoublepage', 'pagebreak', 'appendix',
  'bibliography', 'bibliographystyle', 'printbibliography', 'input', 'include', 'centering', 'vspace', 'bigskip', 'medskip', 'smallskip', 'noindent',
]);
const MARK_OF: Record<string, string> = { emph: 'emph', textit: 'italic', textbf: 'bold', textsc: 'noun', texttt: 'typewriter', textsf: 'sans', underline: 'underline', uline: 'underline' };
const REF_COMMANDS = /^(ref|eqref|pageref|autoref|nameref|cref|Cref|vref|labelcref|cpageref)$/;
const CITE_COMMANDS = /^(cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|nocite|Cite|Parencite|Textcite|Autocite|smartcite|supercite)$/;
const ESCAPED = new Set(['%', '&', '$', '#', '_', '{', '}']);
/** Commands read as the character they print. */
const CHARS: Record<string, string> = { ldots: '…', dots: '…', textellipsis: '…', textbackslash: '\\', ',': ' ' };

// ---- the preamble ------------------------------------------------------------------------

/** Index of `needle` outside comments, or -1. */
function findOutsideComments(s: string, needle: string, from = 0): number {
  for (let i = s.indexOf(needle, from); i >= 0; i = s.indexOf(needle, i + 1)) {
    const lineStart = s.lastIndexOf('\n', i - 1) + 1;
    if (!/(^|[^\\])%/.test(s.slice(lineStart, i))) return i;
  }
  return -1;
}

/** The theorem environments a preamble defines (\newtheorem{env}{Name}), on top of amsthm's usual ones. */
export function theoremsOf(preamble: string): Theorems {
  const out: Theorems = { ...DEFAULT_THEOREMS };
  for (const m of preamble.matchAll(/^[^%\n]*\\newtheorem\*?\s*\{([^}]+)\}\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/gm)) out[m[1].trim()] = m[2].trim();
  return out;
}

// ---- reading ------------------------------------------------------------------------------

/** How the paragraphs read in one place are laid out. */
interface Frame {
  depth: number;
  /** The layout of paragraph number `n` there (0 = the first); null keeps Standard. */
  layoutOf(n: number): { layout: Layout; attrs?: Record<string, unknown> } | null;
}

class Reader {
  readonly units: Units = new WeakMap();
  constructor(
    readonly s: string,
    readonly theorems: Theorems,
  ) {}

  unit(kind: UnitKind, nodes: PMNode[], from: number, to: number, trimEnd: boolean) {
    if (!nodes.length) return;
    const src = this.s.slice(from, to);
    const list = this.units.get(nodes[0]) ?? [];
    list.push({ kind, nodes, src: trimEnd ? src.trimEnd() : src });
    this.units.set(nodes[0], list);
  }

  /**
   * The blocks in [from, to), as runs: a block, or the blocks read together
   * (a list, a theorem, a paragraph broken by display formulas). Each run is
   * a unit; at the top level a unit keeps the whitespace after it, so the
   * file round-trips.
   */
  blocks(from: number, to: number, frame: Frame, top: boolean): PMNode[] {
    return this.runs(from, to, frame, top).flatMap((r) => r.nodes);
  }

  runs(from: number, to: number, frame: Frame, top: boolean): { nodes: PMNode[]; start: number; end: number; kind: UnitKind }[] {
    const s = this.s;
    let paragraphs = 0;
    const runs: { nodes: PMNode[]; start: number; end: number; kind: UnitKind }[] = [];
    let i = skipSpace(s, from);
    while (i < to) {
      const start = i;
      const read = this.block(i, to, frame, paragraphs);
      paragraphs += read.paragraphs;
      runs.push({ nodes: read.nodes, start, end: 0, kind: read.kind ?? 'block' });
      i = skipSpace(s, Math.max(read.end, i + 1));
    }
    runs.forEach((r, k) => {
      // At the top level the first unit also keeps the whitespace before it.
      if (top && k === 0) r.start = from;
      r.end = k + 1 < runs.length ? runs[k + 1].start : to;
      this.unit(r.kind, r.nodes, r.start, r.end, !top);
    });
    return runs;
  }

  /** One block (or a paragraph with the display formulas inside it) at `i`. */
  private block(i: number, to: number, frame: Frame, n: number): { nodes: PMNode[]; end: number; paragraphs: number; kind?: UnitKind } {
    const s = this.s;
    const other = (node: PMNode) => ({ nodes: [node], paragraphs: 0 });

    // Comment lines: shown as a LyX note (not printed), written back as comments.
    if (s[i] === '%') {
      let end = i;
      while (end < to && s[skipSpace(s, end, false)] === '%') end = Math.min(skipComment(s, skipSpace(s, end, false)), to);
      const text = s
        .slice(i, end)
        .replace(/\r?\n$/, '')
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*% ?/, ''))
        .join('\n');
      return { ...other(schema.nodes.note.create({ depth: this.otherDepth(frame) }, text ? schema.text(text) : null)), end };
    }

    const begin = readBegin(s, i);
    if (begin) {
      const close = matchEnd(s, begin.end, begin.env);
      if (!close || close.end > to) return { ...other(ert(s.slice(i, to), this.otherDepth(frame))), end: to };
      if (MATH_ENVS.has(begin.env)) return { ...other(this.display(begin.env, begin.end, close.bodyEnd, this.otherDepth(frame), false)), end: close.end };
      // An environment inside an item or theorem is nested one level under it.
      const inner: Frame = { depth: this.otherDepth(frame), layoutOf: () => null };
      if (LIST_ENVS.has(begin.env)) return { nodes: this.list(begin.env, begin.end, close, inner), end: close.end, paragraphs: 0, kind: 'env' };
      const envLayout = layoutOfEnv(begin.env, this.theorems);
      if (envLayout) return { nodes: this.env(envLayout, begin.env, begin.end, close, inner), end: close.end, paragraphs: 0, kind: 'env' };
      if (FLOATS.has(begin.env)) return { ...other(this.float(begin.env, begin.end, close.bodyEnd, inner.depth)), end: close.end };
      if (TABULARS.has(begin.env)) {
        const table = this.table(begin.env, begin.end, close.bodyEnd, inner.depth);
        if (table) return { ...other(table), end: close.end };
      }
      if (ALIGNMENTS.has(begin.env)) {
        // center / flushleft / flushright: their paragraphs, aligned.
        const nodes = this.blocks(begin.end, close.bodyEnd, inner, false).map((n) =>
          n.type === schema.nodes.paragraph || n.type === schema.nodes.table ? n.type.create({ ...n.attrs, align: begin.env }, n.content) : n,
        );
        if (nodes.length) return { nodes, end: close.end, paragraphs: 0, kind: 'env' };
      }
      return { ...other(ert(s.slice(i, close.end), this.otherDepth(frame))), end: close.end };
    }

    if (s.startsWith('\\[', i) || s.startsWith('$$', i)) {
      const end = matchDisplayMath(s, i);
      if (end > 0 && end <= to) return { ...other(this.display(s.startsWith('$$', i) ? '$$' : '\\[', i + 2, end - 2, this.otherDepth(frame), false)), end };
    }

    if (s[i] === '\\') {
      const { name, end: nameEnd } = readCommand(s, i);
      const star = s[nameEnd] === '*';
      const heading = headingOfCommand(name + (star ? '*' : ''));
      const front = !heading ? frontOfCommand(name) : null;
      if (heading || front) {
        const read = this.headed(heading ?? front!, star ? nameEnd + 1 : nameEnd, to, frame);
        if (read) return { nodes: [read.node], end: read.end, paragraphs: 0 };
      }
      if (BLOCK_COMMANDS.has(name)) {
        const end = commandEnd(s, nameEnd, to);
        return { ...other(ert(s.slice(i, end), this.otherDepth(frame))), end };
      }
    }

    return this.paragraphRun(i, to, frame, n);
  }

  /** Depth of a block that is not one of the frame's paragraphs (nested under them). */
  private otherDepth(frame: Frame) {
    return frame.layoutOf(0) ? frame.depth + 1 : frame.depth;
  }

  /** \section{…}, \title{…}…: the heading or front-matter paragraph, with a \label right after it. */
  private headed(l: Layout, i: number, to: number, frame: Frame): { node: PMNode; end: number } | null {
    const s = this.s;
    let j = skipSpace(s, i, false);
    let short: string | null = null;
    if (s[j] === '[') {
      const e = matchBracket(s, j);
      if (e < 0) return null;
      short = s.slice(j + 1, e - 1);
      j = skipSpace(s, e, false);
    }
    if (s[j] !== '{') return null;
    const close = matchBrace(s, j);
    if (close < 0 || close > to) return null;
    const content = this.inline(j + 1, close - 1, []);
    let end = close;
    // A label written right after the heading belongs to it, as in LyX.
    const k = skipSpace(s, close);
    if (s.startsWith('\\label', k) && !blankLineAt(s, s.indexOf('\n', close)) && s[skipSpace(s, k + 6, false)] === '{') {
      const open = skipSpace(s, k + 6, false);
      const lc = matchBrace(s, open);
      if (lc > 0 && lc <= to) {
        content.push(schema.nodes.label.create({ name: s.slice(open + 1, lc - 1) }));
        end = lc;
      }
    }
    return { node: schema.nodes.paragraph.create({ layout: l.name, depth: frame.depth, envOpt: short }, trimText(content)), end };
  }

  /** A figure or table: its contents as blocks, in a float node. */
  private float(env: string, bodyStart: number, bodyEnd: number, depth: number): PMNode {
    const s = this.s;
    let i = skipSpace(s, bodyStart, false);
    let placement: string | null = null;
    if (s[i] === '[') {
      const e = matchBracket(s, i);
      if (e > 0) {
        placement = s.slice(i + 1, e - 1);
        i = e;
      }
    }
    const content = this.blocks(i, bodyEnd, { depth: 0, layoutOf: () => null }, false);
    const indent = lineIndent(s, skipSpace(s, i));
    return schema.nodes.float.create({ env, placement, depth, indent }, content.length ? content : [schema.nodes.paragraph.create()]);
  }

  /** `{…}` at `i` (after spaces on the line): its inside and end. */
  private group(i: number, to: number): { from: number; to: number; end: number } | null {
    const open = skipSpace(this.s, i, false);
    if (this.s[open] !== '{') return null;
    const close = matchBrace(this.s, open);
    return close > 0 && close <= to ? { from: open + 1, to: close - 1, end: close } : null;
  }

  /**
   * A tabular as a table node: its arguments, columns, rows and cells. Null
   * (kept as TeX code) for one we cannot edit cell by cell: a column spec we
   * cannot read, or a row with more cells than columns.
   */
  private table(env: string, bodyStart: number, bodyEnd: number, depth: number): PMNode | null {
    const s = this.s;
    let i = bodyStart;
    let width: string | null = null;
    if (env !== 'tabular') {
      const w = this.group(i, bodyEnd);
      if (!w) return null;
      width = s.slice(w.from, w.to);
      i = w.end;
    }
    let pos: string | null = null;
    const o = skipSpace(s, i, false);
    if (s[o] === '[') {
      const e = matchBracket(s, o);
      if (e < 0) return null;
      pos = s.slice(o + 1, e - 1);
      i = e;
    }
    const spec = this.group(i, bodyEnd);
    const columns = spec && parseColumns(s.slice(spec.from, spec.to));
    if (!spec || !columns?.cols.length) return null;
    const body = splitRows(s, spec.end, bodyEnd);
    if (!body?.rows.length) return null;
    const rows: PMNode[] = [];
    for (const r of body.rows) {
      const cells = r.cells.map((c) => this.cell(c.from, c.to));
      let used = cells.reduce((n, c) => n + (c.attrs.colspan as number), 0);
      if (used > columns.cols.length) return null;
      // A short row's missing cells are empty ones.
      for (; used < columns.cols.length; used++) cells.push(schema.nodes.table_cell.create());
      rows.push(schema.nodes.table_row.create({ rules: r.rules, endOpt: r.endOpt }, cells));
    }
    // The rows' indent under \begin{tabular}'s own.
    const beginIndent = /^[ \t]*/.exec(s.slice(s.lastIndexOf('\n', bodyStart - 1) + 1))![0];
    const rowIndent = lineIndent(s, skipSpace(s, spec.end));
    const indent = rowIndent.startsWith(beginIndent) ? rowIndent.slice(beginIndent.length) : '';
    return schema.nodes.table.create({ env, width, pos, cols: columns.cols, tail: columns.tail, bottom: body.bottom, depth, indent }, rows);
  }

  /** A table cell: its text, or a \multicolumn's. */
  private cell(from: number, to: number): PMNode {
    const s = this.s;
    const a = skipSpace(s, from);
    if (s.startsWith('\\multicolumn', a)) {
      const n = this.group(readCommand(s, a).end, to);
      const spec = n && this.group(n.end, to);
      const content = spec && this.group(spec.end, to);
      const span = n ? Number(s.slice(n.from, n.to).trim()) : NaN;
      if (content && Number.isInteger(span) && span > 0 && !s.slice(content.end, to).trim()) {
        return schema.nodes.table_cell.create({ colspan: span, mc: { span, spec: s.slice(spec.from, spec.to) } }, trimText(this.inline(content.from, content.to, [])));
      }
    }
    return schema.nodes.table_cell.create(null, trimText(this.inline(from, to, [])));
  }

  /** A display formula's node. */
  private display(env: string, from: number, to: number, depth: number, joinPrev: boolean): PMNode {
    let latex = this.s.slice(from, to);
    let label: string | null = null;
    if (ONE_FORMULA.has(env)) {
      const m = /\\label\s*\{([^}]*)\}/.exec(latex);
      if (m) {
        label = m[1];
        latex = latex.slice(0, m.index) + latex.slice(m.index + m[0].length);
      }
    }
    return schema.nodes.math_display.create({ latex: latex.trim(), env, label, depth, joinPrev });
  }

  /** itemize / enumerate / description: one paragraph per item, nested content one level deeper. */
  private list(env: string, bodyStart: number, close: { bodyEnd: number; end: number }, frame: Frame): PMNode[] {
    const s = this.s;
    const l = layoutOfEnv(env, this.theorems)!;
    let i = skipSpace(s, bodyStart, false);
    let envOpt: string | null = null;
    if (s[i] === '[') {
      const e = matchBracket(s, i);
      if (e > 0) {
        envOpt = s.slice(i + 1, e - 1);
        i = e;
      }
    }
    const items = itemStarts(s, i, close.bodyEnd);
    const nodes: PMNode[] = [];
    // Anything before the first \item (comments, \setlength…) stays with \begin.
    const lead = s.slice(i, items[0] ?? close.bodyEnd);
    const envPre = lead.trim() ? lead.trimEnd() : null;
    items.forEach((itemStart, k) => {
      const itemEnd = items[k + 1] ?? close.bodyEnd;
      let j = itemStart + 5;
      let label: string | null = null;
      const o = skipSpace(s, j, false);
      if (s[o] === '[') {
        const e = matchBracket(s, o);
        if (e > 0) {
          label = s.slice(o + 1, e - 1);
          j = e;
        }
      }
      const first = k === 0;
      const attrs = { item: label, ...(first ? { startsEnv: true, env, envOpt, envPre } : {}) };
      const itemFrame: Frame = { depth: frame.depth, layoutOf: (n) => (n === 0 ? { layout: l, attrs } : null) };
      let content = this.blocks(j, itemEnd, itemFrame, false);
      // An item that starts with something other than text still gets its item paragraph.
      if (content[0]?.type !== schema.nodes.paragraph || content[0].attrs.layout !== l.name) {
        content = [schema.nodes.paragraph.create({ layout: l.name, depth: frame.depth, ...attrs }), ...content];
      }
      this.unit('member', content, itemStart, itemEnd, true);
      nodes.push(...content);
    });
    if (!items.length) nodes.push(schema.nodes.paragraph.create({ layout: l.name, depth: frame.depth, startsEnv: true, env, envOpt, envPre }));
    return nodes;
  }

  /** quote, abstract, theorem…: every paragraph has the environment's layout. */
  private env(l: Layout, env: string, bodyStart: number, close: { bodyEnd: number; end: number }, frame: Frame): PMNode[] {
    const s = this.s;
    let i = skipSpace(s, bodyStart, false);
    let envOpt: string | null = null;
    if (s[i] === '[') {
      const e = matchBracket(s, i);
      if (e > 0) {
        envOpt = s.slice(i + 1, e - 1);
        i = e;
      }
    }
    // Comment lines before the first paragraph (`\begin{theorem} % note`) stay with \begin.
    let j = i;
    while (s[skipSpace(s, j)] === '%' && skipSpace(s, j) < close.bodyEnd) j = skipComment(s, skipSpace(s, j));
    const envPre = j > i ? s.slice(i, j).trimEnd() : null;
    const envFrame: Frame = {
      depth: frame.depth,
      layoutOf: (n) => ({ layout: l, attrs: n === 0 ? { startsEnv: true, env, envOpt, envPre } : {} }),
    };
    const runs = this.runs(j, close.bodyEnd, envFrame, false);
    // Each of the environment's paragraphs, with what is nested under it, is a unit too.
    const isMember = (n: PMNode | undefined) => n?.type === schema.nodes.paragraph && n.attrs.layout === l.name && n.attrs.depth === frame.depth;
    runs.forEach((r, k) => {
      if (!isMember(r.nodes[0])) return;
      let last = k;
      while (last + 1 < runs.length && !isMember(runs[last + 1].nodes[0])) last++;
      this.unit('member', runs.slice(k, last + 1).flatMap((x) => x.nodes), r.start, runs[last].end, true);
    });
    const nodes = runs.flatMap((r) => r.nodes);
    if (!nodes.some(isMember)) nodes.unshift(schema.nodes.paragraph.create({ layout: l.name, depth: frame.depth, startsEnv: true, env, envOpt, envPre }));
    return nodes;
  }

  /**
   * A paragraph, up to a blank line or the next block. Display formulas
   * inside it split it: the text before, the formula, and the text after
   * (written back without blank lines between them).
   */
  private paragraphRun(i: number, to: number, frame: Frame, n: number): { nodes: PMNode[]; end: number; paragraphs: number } {
    const s = this.s;
    const nodes: PMNode[] = [];
    let paragraphs = 0;
    let start = i;
    let joinPrev = false;
    for (;;) {
      const stop = paragraphStop(s, start, to);
      const own = frame.layoutOf(n + paragraphs);
      // Paragraphs that are not the frame's own (an item's second paragraph,
      // text after a formula) nest under it.
      const nested = this.otherDepth(frame);
      const content = trimText(this.inline(start, stop.at, []));
      if (content.length || !nodes.length) {
        const first = !nodes.length;
        const mine = first && own;
        nodes.push(schema.nodes.paragraph.create({ layout: mine ? own.layout.name : 'Standard', depth: mine ? frame.depth : nested, joinPrev, ...(mine ? own.attrs : {}) }, content));
        if (first) paragraphs++;
      }
      if (stop.kind !== 'display') return { nodes, end: stop.at, paragraphs };
      // The display formula, then the text after it, still in this paragraph.
      const d = stop.display!;
      nodes.push(this.display(d.env, d.bodyStart, d.bodyEnd, nested, true));
      start = d.end;
      // A blank line (or the end) right after the formula ends the paragraph there.
      const next = skipSpace(s, start, false);
      if (next >= to || blankLineAt(s, next) || (s[next] === '\n' && blankLineAt(s, next))) return { nodes, end: start, paragraphs };
      if (s[next] === '\n' && skipSpace(s, next) >= to) return { nodes, end: start, paragraphs };
      joinPrev = true;
    }
  }

  /** Inline content of [from, to), with `marks` applied to its text. */
  inline(from: number, to: number, marks: readonly Mark[]): PMNode[] {
    const s = this.s;
    const out: PMNode[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push(schema.text(text, marks));
      text = '';
    };
    const push = (node: PMNode) => {
      flush();
      out.push(node);
    };
    const raw = (a: number, b: number) => push(ert(s.slice(a, b), 0, true));
    let i = from;
    while (i < to) {
      const c = s[i];
      if (c === '%') {
        const end = Math.min(skipComment(s, i), to);
        push(ert(s.slice(i, end).replace(/\r?\n$/, ''), 0, true));
        i = end;
        continue;
      }
      if (c === '$') {
        const end = matchInlineMath(s, i);
        if (end > 0 && end <= to) {
          push(schema.nodes.math_inline.create({ latex: s.slice(i + 1, end - 1), delim: '$' }));
          i = end;
          continue;
        }
      }
      if (c === '~') {
        text += ' ';
        i++;
        continue;
      }
      if (c === '{') {
        const end = matchBrace(s, i);
        if (end > 0 && end <= to) {
          raw(i, end);
          i = end;
          continue;
        }
      }
      if (/\s/.test(c)) {
        // Any run of spaces and newlines is one space, as in LaTeX.
        let j = i;
        while (j < to && /\s/.test(s[j])) j++;
        if (!text.endsWith(' ')) text += ' ';
        i = j;
        continue;
      }
      if (c !== '\\') {
        text += c;
        i++;
        continue;
      }
      // A control sequence.
      const verb = matchVerb(s, i);
      if (verb > 0 && verb <= to) {
        raw(i, verb);
        i = verb;
        continue;
      }
      const { name, end } = readCommand(s, i);
      if (ESCAPED.has(name)) {
        text += name;
        i = end;
        continue;
      }
      if (name in CHARS) {
        text += CHARS[name];
        i = name === ',' ? end : swallowEmptyGroup(s, end, to);
        continue;
      }
      if (name === '\\') {
        // A line break; with a star or [space] it is kept as TeX code.
        let e = s[end] === '*' ? end + 1 : end;
        if (s[e] === '[') e = Math.max(e, matchBracket(s, e));
        if (e === end) push(schema.nodes.hard_break.create());
        else raw(i, e);
        i = e;
        continue;
      }
      if (name === '(') {
        const e = matchInlineMath(s, i);
        if (e > 0 && e <= to) {
          push(schema.nodes.math_inline.create({ latex: s.slice(i + 2, e - 2), delim: '\\(' }));
          i = e;
          continue;
        }
      }
      const arg = (j: number) => {
        const open = skipSpace(s, j, false);
        if (s[open] !== '{') return null;
        const close = matchBrace(s, open);
        return close > 0 && close <= to ? { from: open + 1, to: close - 1, end: close } : null;
      };
      if (name in MARK_OF) {
        const a = arg(end);
        if (a) {
          flush();
          const mark = schema.marks[MARK_OF[name]].create();
          out.push(...this.inline(a.from, a.to, mark.addToSet(marks)));
          i = a.end;
          continue;
        }
      }
      if (name === 'footnote' || name === 'marginpar') {
        const a = arg(end);
        if (a) {
          push(schema.nodes.footnote.create({ kind: name }, trimText(this.inline(a.from, a.to, []))));
          i = a.end;
          continue;
        }
      }
      if (name === 'includegraphics') {
        let j = s[end] === '*' ? -1 : end;
        let options: string | null = null;
        const o = j > 0 ? skipSpace(s, j, false) : -1;
        if (o > 0 && s[o] === '[') {
          const e = matchBracket(s, o);
          if (e > 0) {
            options = s.slice(o + 1, e - 1);
            j = e;
          }
        }
        const a = j > 0 ? arg(j) : null;
        if (a) {
          push(schema.nodes.graphics.create({ path: s.slice(a.from, a.to).trim(), options }));
          i = a.end;
          continue;
        }
      }
      if (name === 'label' || name === 'url' || REF_COMMANDS.test(name)) {
        const a = arg(end);
        if (a) {
          const value = s.slice(a.from, a.to);
          push(
            name === 'label'
              ? schema.nodes.label.create({ name: value })
              : name === 'url'
                ? schema.nodes.url.create({ url: value })
                : schema.nodes.ref.create({ cmd: name, key: value }),
          );
          i = a.end;
          continue;
        }
      }
      if (CITE_COMMANDS.test(name)) {
        let j = s[end] === '*' ? end + 1 : end;
        const opts: string[] = [];
        for (let o = skipSpace(s, j, false); s[o] === '[' && opts.length < 2; o = skipSpace(s, j, false)) {
          const e = matchBracket(s, o);
          if (e < 0) break;
          opts.push(s.slice(o + 1, e - 1));
          j = e;
        }
        const a = arg(j);
        if (a && s[end] !== '*') {
          const [pre, post] = opts.length === 2 ? opts : [null, opts[0] ?? null];
          push(schema.nodes.cite.create({ cmd: name, keys: s.slice(a.from, a.to), pre, post }));
          i = a.end;
          continue;
        }
      }
      if (name === 'href') {
        const url = arg(end);
        const body = url && arg(url.end);
        if (url && body) {
          flush();
          const mark = schema.marks.href.create({ url: s.slice(url.from, url.to) });
          out.push(...this.inline(body.from, body.to, mark.addToSet(marks)));
          i = body.end;
          continue;
        }
      }
      if (name === 'begin') {
        const b = readBegin(s, i);
        const close = b && matchEnd(s, b.end, b.env);
        if (close && close.end <= to) {
          raw(i, close.end);
          i = close.end;
          continue;
        }
      }
      // Anything else is kept as TeX code: the command with the arguments right after it.
      const e = commandEnd(s, end, to, false);
      raw(i, e);
      i = e;
    }
    flush();
    return out;
  }
}

/** The spaces and tabs before `i` on its line, if nothing else comes before it there. */
function lineIndent(s: string, i: number): string {
  const lineStart = s.lastIndexOf('\n', i - 1) + 1;
  const before = s.slice(lineStart, i);
  return /^[ \t]*$/.test(before) ? before : '';
}

/** A TeX code node: a block, or inline. */
function ert(text: string, depth: number, inline = false): PMNode {
  const content = text ? schema.text(text) : null;
  return inline ? schema.nodes.ert_inline.create(null, content) : schema.nodes.ert_block.create({ depth }, content);
}

/** Past a command's star and its [options] and {arguments} (on the same line unless `lines`). */
function commandEnd(s: string, i: number, to: number, lines = false): number {
  let j = s[i] === '*' ? i + 1 : i;
  for (;;) {
    const k = skipSpace(s, j, lines);
    if (s[k] === '{') {
      const e = matchBrace(s, k);
      if (e < 0 || e > to) return j;
      j = e;
    } else if (s[k] === '[') {
      const e = matchBracket(s, k);
      if (e < 0 || e > to) return j;
      j = e;
    } else return j;
  }
}

/** `\ldots{}`: past the `{}` that only ends the command name. */
function swallowEmptyGroup(s: string, i: number, to: number) {
  return s.startsWith('{}', i) && i + 2 <= to ? i + 2 : i;
}

/** Where each top-level \item in [from, to) starts. */
function itemStarts(s: string, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (c === '%') i = skipComment(s, i) - 1;
    else if (c === '{') {
      const e = matchBrace(s, i);
      if (e < 0) break;
      i = e - 1;
    } else if (c === '\\') {
      const b = readBegin(s, i);
      if (b) {
        const close = matchEnd(s, b.end, b.env);
        if (!close) break;
        i = close.end - 1;
        continue;
      }
      const { name, end } = readCommand(s, i);
      if (name === 'item') out.push(i);
      i = end - 1;
    }
  }
  return out;
}

/** Why a paragraph stops, and where. */
interface Stop {
  at: number;
  kind: 'blank' | 'block' | 'display' | 'end';
  display?: { env: string; bodyStart: number; bodyEnd: number; end: number };
}

/** Lines starting with one of these begin a new block, ending the paragraph above. */
const BLOCK_LINE = /^\\(begin\b|(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]|(maketitle|tableofcontents|newpage|clearpage|cleardoublepage|appendix|bibliography|bibliographystyle|printbibliography|title|author|date|caption|centering)\b)/;

/** Scan a paragraph from `i`: it ends at a blank line, a block on a new line, or a display formula. */
function paragraphStop(s: string, i: number, to: number): Stop {
  let lineStart = true;
  for (let j = i; j < to; j++) {
    const c = s[j];
    if (c === '\n') {
      if (blankLineAt(s, j)) return { at: j, kind: 'blank' };
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') continue;
    const atLineStart = lineStart && j > i;
    lineStart = false;
    if (c === '%') {
      j = skipComment(s, j) - 1;
      lineStart = true;
      continue;
    }
    if (c === '{') {
      const e = matchBrace(s, j);
      if (e < 0) return { at: to, kind: 'end' };
      j = e - 1;
      continue;
    }
    if (c === '$') {
      if (s[j + 1] === '$') {
        const e = matchDisplayMath(s, j);
        if (e > 0 && e <= to) return { at: j, kind: 'display', display: { env: '$$', bodyStart: j + 2, bodyEnd: e - 2, end: e } };
      }
      const e = matchInlineMath(s, j);
      if (e > 0) j = e - 1;
      continue;
    }
    if (c !== '\\') continue;
    const verb = matchVerb(s, j);
    if (verb > 0) {
      j = verb - 1;
      continue;
    }
    if (s[j + 1] === '[') {
      const e = matchDisplayMath(s, j);
      if (e > 0 && e <= to) return { at: j, kind: 'display', display: { env: '\\[', bodyStart: j + 2, bodyEnd: e - 2, end: e } };
    }
    const b = readBegin(s, j);
    if (b) {
      const close = matchEnd(s, b.end, b.env);
      if (close && close.end <= to && MATH_ENVS.has(b.env)) {
        return { at: j, kind: 'display', display: { env: b.env, bodyStart: b.end, bodyEnd: close.bodyEnd, end: close.end } };
      }
      if (atLineStart) return { at: j, kind: 'block' };
      if (close) j = close.end - 1;
      continue;
    }
    if (atLineStart && BLOCK_LINE.test(s.slice(j, j + 40))) return { at: j, kind: 'block' };
    j = readCommand(s, j).end - 1;
  }
  return { at: to, kind: 'end' };
}

/** Drop the space a paragraph's text starts and ends with. */
function trimText(nodes: PMNode[]): PMNode[] {
  const out = [...nodes];
  const first = out[0];
  if (first?.isText) {
    const t = first.text!.replace(/^ +/, '');
    if (t) out[0] = schema.text(t, first.marks);
    else out.shift();
  }
  const last = out[out.length - 1];
  if (last?.isText) {
    const t = last.text!.replace(/ +$/, '');
    if (t) out[out.length - 1] = schema.text(t, last.marks);
    else out.pop();
  }
  return out;
}

/** Packages for the commands the editor writes that a body already uses. */
function packagesUsedBy(body: string): Set<string> {
  const out = new Set<string>();
  if (/\\includegraphics\b/.test(body)) out.add('graphicx');
  if (/\\url\b/.test(body)) out.add('url');
  if (/\\href\b/.test(body)) out.add('hyperref');
  if (/\\(toprule|midrule|bottomrule|cmidrule)\b/.test(body)) out.add('booktabs');
  if (/\\begin\s*\{tabularx\}/.test(body)) out.add('tabularx');
  return out;
}

/** Read a .tex file into the editor's document. */
export function readTex(text: string): TexDocument {
  const begin = findOutsideComments(text, '\\begin{document}');
  const end = begin >= 0 ? findOutsideComments(text, '\\end{document}', begin) : -1;
  const bodyStart = begin >= 0 ? begin + '\\begin{document}'.length : 0;
  const bodyEnd = end >= 0 ? end : text.length;
  const theorems = theoremsOf(begin >= 0 ? text.slice(0, begin) : text);
  const reader = new Reader(text, theorems);
  // The body's leading newline (right after \begin{document}) stays with the prefix.
  const from = text[bodyStart] === '\n' ? bodyStart + 1 : text.startsWith('\r\n', bodyStart) ? bodyStart + 2 : bodyStart;
  const blocks = reader.blocks(from, bodyEnd, { depth: 0, layoutOf: () => null }, true);
  const nodes = blocks.length ? blocks : [schema.nodes.paragraph.create()];
  return {
    prefix: text.slice(0, from),
    suffix: text.slice(bodyEnd),
    doc: schema.nodes.doc.create(null, nodes),
    units: reader.units,
    theorems,
    // Environments the file already used work, however they are defined (tcolorbox, the class…).
    envsInUse: new Set([...text.slice(from, bodyEnd).matchAll(/\\begin\s*\{([^}]+)\}/g)].map((m) => m[1].trim())),
    packagesInUse: packagesUsedBy(text.slice(from, bodyEnd)),
  };
}
