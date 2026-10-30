/**
 * Tables (tabular, tabular*, tabularx, tabulary) as a LyX-style table inset.
 *
 * `span.inset[data-inset=Tabular]` holds a real <table>; each cell is a
 * `td > .ibody` edited like any other inset body. The environment's name, the
 * arguments before the column spec (`data-args`: width, position) and the
 * column spec (`data-spec`) are kept as written. Each row keeps the rules
 * written before it (`data-rules`: \hline, \toprule, \cline{2-3}…) and how it
 * ended (`data-end`: \\, \\[2pt], or nothing for a last row without \\); rules
 * after the last row are on the inset (`data-after`). A \multicolumn cell has
 * `colspan` and its own spec in `data-mc`.
 */
import { ZW } from './model';

export const TABULAR_ENVS = /^(tabular\*?|tabularx|tabulary)$/;

export interface TabCell {
  body: Node | null;
  span?: number;
  mc?: string;
}
export interface TabRow {
  rules: string;
  end: string;
  cells: TabCell[];
}

/* ---------- Column spec ---------- */

/** Index just past the `{…}` group at `j`. */
function grp(s: string, j: number): number {
  let d = 0;
  for (let k = j; k < s.length; k++) {
    if (s[k] === '\\') k++;
    else if (s[k] === '{') d++;
    else if (s[k] === '}' && --d === 0) return k + 1;
  }
  return s.length;
}

/** `*{3}{c|}` → `c|c|c|`. */
function expandRepeats(spec: string): string {
  for (let i = spec.indexOf('*{'); i >= 0; i = spec.indexOf('*{')) {
    const a = grp(spec, i + 1);
    if (spec[a] !== '{') break;
    const b = grp(spec, a);
    const n = Math.min(100, parseInt(spec.slice(i + 2, a - 1), 10) || 0);
    spec = spec.slice(0, i) + spec.slice(a + 1, b - 1).repeat(n) + spec.slice(b);
  }
  return spec;
}

export interface SpecCol {
  /** The column as written, with its >{…} and <{…}. */
  col: string;
  /** Separators after it: |, @{…}, !{…}. */
  after: string;
  /** The column letter (l, c, r, p, X…). */
  kind: string;
}

/** A column spec as `lead` separators and columns. */
export function specColumns(spec: string): { lead: string; cols: SpecCol[] } {
  spec = expandRepeats(spec || '');
  const cols: SpecCol[] = [];
  let lead = '';
  let pre = '';
  const sep = (t: string) => {
    if (cols.length) cols[cols.length - 1].after += t;
    else lead += t;
  };
  let i = 0;
  while (i < spec.length) {
    const c = spec[i];
    if (/\s/.test(c)) i++;
    else if (c === '|' || c === ':') {
      sep(c);
      i++;
    } else if ((c === '@' || c === '!' || c === '>' || c === '<') && spec[i + 1] === '{') {
      const e = grp(spec, i + 1);
      const t = spec.slice(i, e);
      if (c === '>') pre += t;
      else if (c === '<' && cols.length && !cols[cols.length - 1].after) cols[cols.length - 1].col += t;
      else sep(t);
      i = e;
    } else {
      // a column letter and its arguments: p{3cm}, w{l}{2cm}, S[…]
      let e = i + 1;
      while (spec[e] === '{' || spec[e] === '[') e = spec[e] === '{' ? grp(spec, e) : Math.max(e + 1, spec.indexOf(']', e) + 1);
      cols.push({ col: pre + spec.slice(i, e), after: '', kind: c });
      pre = '';
      i = e;
    }
  }
  return { lead, cols };
}

const joinSpec = (lead: string, cols: SpecCol[]) => lead + cols.map((c) => c.col + c.after).join('');
const bars = (s: string) => (s.replace(/[@!]\{[^}]*\}/g, '').match(/\|/g) || []).length;

function alignOf(col: SpecCol | undefined): string {
  if (!col) return '';
  if (/\\centering/.test(col.col)) return 'center';
  if (/\\raggedleft/.test(col.col)) return 'right';
  return { l: 'left', r: 'right', c: 'center', S: 'center' }[col.kind] || 'left';
}

/* ---------- DOM ---------- */

export const rowsOf = (ins: Element) => [...ins.querySelectorAll<HTMLTableRowElement>(':scope > table > tbody > tr')];
export const cellBody = (td: Element) => td.querySelector<HTMLElement>(':scope > .ibody')!;
/** Every cell body of the table, row by row. */
export const cellBodies = (ins: Element) => [...ins.querySelectorAll<HTMLElement>(':scope > table > tbody > tr > td > .ibody')];

function mkCell(c: TabCell): HTMLTableCellElement {
  const td = document.createElement('td');
  if (c.span && c.span > 1) td.colSpan = c.span;
  if (c.mc != null) td.dataset.mc = c.mc;
  const b = document.createElement('span');
  b.className = 'ibody';
  b.contentEditable = 'true';
  if (c.body) b.append(c.body);
  if (!b.textContent!.replace(/​/g, '') && !b.querySelector('math-field,.inset')) b.textContent = ZW;
  td.append(b);
  return td;
}

function mkRow(row: TabRow): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (row.rules) tr.dataset.rules = row.rules;
  tr.dataset.end = row.end;
  for (const c of row.cells) tr.append(mkCell(c));
  return tr;
}

export function mkTabular(env: string, args: string, spec: string, rows: TabRow[], after = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'inset';
  s.contentEditable = 'false';
  s.dataset.inset = 'Tabular';
  s.dataset.env = env;
  if (args) s.dataset.args = args;
  s.dataset.spec = spec;
  if (after) s.dataset.after = after;
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  for (const row of rows) tbody.append(mkRow(row));
  table.append(tbody);
  s.append(table);
  paintTabular(s);
  return s;
}

/** A new rows × cols table with lines around every cell. */
export function newTabular(rows: number, cols: number): HTMLSpanElement {
  const row = (rules: string): TabRow => ({ rules, end: '\\\\', cells: Array.from({ length: cols }, () => ({ body: null })) });
  return mkTabular('tabular', '', '|' + 'c|'.repeat(cols), Array.from({ length: rows }, () => row('\\hline')), '\\hline');
}

/** Each cell's first column (cells spanning columns count them all). */
function grid(tr: HTMLTableRowElement): { td: HTMLTableCellElement; c0: number; span: number }[] {
  let c = 0;
  return [...tr.cells].map((td) => {
    const span = Math.max(1, td.colSpan || 1);
    const out = { td, c0: c, span };
    c += span;
    return out;
  });
}

/** Horizontal rules → the line drawn and the columns it covers (null: all). */
function ruleLines(rules: string | undefined): { line: string; from: number; to: number }[] {
  const out: { line: string; from: number; to: number }[] = [];
  if (!rules) return out;
  const hl = (rules.match(/\\hline\b/g) || []).length;
  if (hl) out.push({ line: hl > 1 ? '3px double' : '1px solid', from: 0, to: Infinity });
  if (/\\(toprule|bottomrule)\b/.test(rules)) out.push({ line: '2px solid', from: 0, to: Infinity });
  if (/\\midrule\b/.test(rules)) out.push({ line: '1px solid', from: 0, to: Infinity });
  for (const m of rules.matchAll(/\\(?:cline|cmidrule)(?:\([^)]*\))?\s*\{\s*(\d+)\s*-\s*(\d+)\s*\}/g)) out.push({ line: '1px solid', from: +m[1] - 1, to: +m[2] - 1 });
  return out;
}

/** Draw the rules and column lines, and align the cells, as LaTeX would. */
export function paintTabular(ins: HTMLElement) {
  const { lead, cols } = specColumns(ins.dataset.spec || '');
  const rows = rowsOf(ins);
  const edge = (lines: ReturnType<typeof ruleLines>, c0: number, span: number) => lines.find((l) => l.from <= c0 + span - 1 && l.to >= c0)?.line || '';
  rows.forEach((tr, k) => {
    const top = ruleLines(tr.dataset.rules);
    const bottom = k === rows.length - 1 ? ruleLines(ins.dataset.after) : [];
    for (const { td, c0, span } of grid(tr)) {
      const st = td.style;
      let left = 0;
      let right = 0;
      let align: string;
      if (td.dataset.mc != null) {
        const mc = specColumns(td.dataset.mc);
        left = bars(mc.lead);
        right = bars(mc.cols[0]?.after || '');
        align = alignOf(mc.cols[0]);
      } else {
        left = c0 === 0 ? bars(lead) : 0;
        right = bars(cols[c0 + span - 1]?.after || '');
        align = alignOf(cols[c0]);
      }
      st.textAlign = align;
      st.borderTop = edge(top, c0, span) ? edge(top, c0, span) + ' currentColor' : '';
      st.borderBottom = edge(bottom, c0, span) ? edge(bottom, c0, span) + ' currentColor' : '';
      st.borderLeft = left ? (left > 1 ? '3px double' : '1px solid') + ' currentColor' : '';
      st.borderRight = right ? (right > 1 ? '3px double' : '1px solid') + ' currentColor' : '';
    }
  });
}

/* ---------- Editing: rows and columns ---------- */

/**
 * LyX's `inset-modify tabular …` on the table holding `td`. Returns the cell
 * body to put the caret in, or null when the operation does not apply.
 */
export function tabularOp(ins: HTMLElement, td: HTMLTableCellElement, op: string): HTMLElement | null {
  const tr = td.parentElement as HTMLTableRowElement;
  const rows = rowsOf(ins);
  const k = rows.indexOf(tr);
  const me = grid(tr).find((g) => g.td === td)!;
  const { lead, cols } = specColumns(ins.dataset.spec || '');
  let target: HTMLElement | null = null;
  if (op === 'append-row') {
    const next = rows[k + 1];
    const rules = next ? next.dataset.rules || '' : k > 0 ? tr.dataset.rules || '' : '';
    const nr = mkRow({ rules, end: '\\\\', cells: Array.from({ length: Math.max(1, cols.length) }, () => ({ body: null })) });
    if (!tr.dataset.end) tr.dataset.end = '\\\\';
    tr.after(nr);
    target = cellBody(nr.cells[Math.min(me.c0, nr.cells.length - 1)]);
  } else if (op === 'delete-row') {
    if (rows.length < 2) return null;
    const next = rows[k + 1];
    if (next && !next.dataset.rules && tr.dataset.rules) next.dataset.rules = tr.dataset.rules;
    if (!next) rows[k - 1].dataset.end = tr.dataset.end ?? '\\\\';
    const at = [...tr.cells].indexOf(td);
    tr.remove();
    const to = next || rows[k - 1];
    target = cellBody(to.cells[Math.min(at, to.cells.length - 1)]);
  } else if (op === 'append-column') {
    const c = me.c0 + me.span - 1;
    const src = cols[c] || cols[cols.length - 1] || { col: 'c', after: '', kind: 'c' };
    cols.splice(c + 1, 0, { ...src });
    ins.dataset.spec = joinSpec(lead, cols);
    for (const row of rows) {
      const g = grid(row).find((x) => x.c0 <= c && x.c0 + x.span - 1 >= c);
      if (!g) continue;
      if (g.c0 + g.span - 1 > c) g.td.colSpan = g.span + 1;
      else {
        const nc = mkCell({ body: null });
        g.td.after(nc);
        if (row === tr) target = cellBody(nc);
      }
    }
  } else if (op === 'delete-column') {
    if (cols.length < 2) return null;
    const c = me.c0;
    const [gone] = cols.splice(c, 1);
    // the outer line of the last column stays
    if (c === cols.length && cols.length && bars(gone.after) && !bars(cols[c - 1].after)) cols[c - 1].after += gone.after;
    ins.dataset.spec = joinSpec(lead, cols);
    for (const row of rows) {
      const g = grid(row).find((x) => x.c0 <= c && x.c0 + x.span - 1 >= c);
      if (!g) continue;
      if (g.span > 1) g.td.colSpan = g.span - 1;
      else if (row.cells.length > 1) g.td.remove();
    }
    const left = tr.cells[Math.min(c, tr.cells.length - 1)];
    target = left ? cellBody(left) : null;
  } else return null;
  paintTabular(ins);
  return target;
}
