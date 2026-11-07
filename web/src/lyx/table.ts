/**
 * Tables in the LyX-style editor: a tabular's column spec as columns, its
 * body cut into rows and cells, the table written back, and LyX's table
 * commands (rows, columns, alignment, lines, multicolumn cells).
 *
 * The cells, cell selection and adding or deleting rows and columns come
 * from prosemirror-tables; the commands here keep the column spec and the
 * rules (\hline…) in step with what it changes.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import {
  addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, CellSelection, deleteColumn, deleteRow, deleteTable, goToNextCell, isInTable, mergeCells,
  selectedRect, splitCell, TableMap, type TableRect,
} from 'prosemirror-tables';
import { matchBrace, matchBracket, matchEnd, matchVerb, readBegin, readCommand, skipComment, skipSpace } from './scan';
import { schema } from './schema';

// ---- column specs -------------------------------------------------------------------------------

/** One column of a column spec: the separators before it (| @{…} !{…}) and the column (l, >{…}p{3cm}<{…}…). */
export interface Column {
  pre: string;
  col: string;
}

export interface Columns {
  cols: Column[];
  /** Separators after the last column. */
  tail: string;
}

/** `*{3}{c|}` written out: `c|c|c|`. */
function expandStars(spec: string): string | null {
  let out = '';
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] !== '*') {
      out += spec[i];
      continue;
    }
    const a = skipSpace(spec, i + 1);
    const ae = spec[a] === '{' ? matchBrace(spec, a) : -1;
    const b = ae > 0 ? skipSpace(spec, ae) : -1;
    const be = b > 0 && spec[b] === '{' ? matchBrace(spec, b) : -1;
    const n = ae > 0 ? Number(spec.slice(a + 1, ae - 1).trim()) : NaN;
    if (be < 0 || !Number.isInteger(n) || n < 0 || n > 100) return null;
    const inner = expandStars(spec.slice(b + 1, be - 1));
    if (inner == null) return null;
    out += inner.repeat(n);
    i = be - 1;
  }
  return out;
}

/** A tabular's column spec as columns; null when it cannot be read. */
export function parseColumns(spec: string): Columns | null {
  const s = expandStars(spec);
  if (s == null) return null;
  const cols: Column[] = [];
  let pre = '';
  let i = 0;
  const group = (j: number) => {
    const k = skipSpace(s, j);
    const e = s[k] === '{' ? matchBrace(s, k) : -1;
    return e > 0 ? e : -1;
  };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '|') {
      pre += c;
      i++;
    } else if (c === '@' || c === '!') {
      const e = group(i + 1);
      if (e < 0) return null;
      pre += s.slice(i, e);
      i = e;
    } else if (c === '>' || /[A-Za-z]/.test(c)) {
      // >{…} goes with the column after it.
      let col = '';
      while (s[i] === '>') {
        const e = group(i + 1);
        if (e < 0) return null;
        col += s.slice(i, e);
        i = skipSpace(s, e);
      }
      if (!/[A-Za-z]/.test(s[i] ?? '')) return null;
      const letter = s[i];
      col += letter;
      i++;
      // siunitx's S[…], and the arguments of p{…}, m{…}, b{…}, w{…}{…}.
      if (s[i] === '[') {
        const e = matchBracket(s, i);
        if (e < 0) return null;
        col += s.slice(i, e);
        i = e;
      }
      const args = 'pmb'.includes(letter) ? 1 : 'wW'.includes(letter) ? 2 : 0;
      for (let k = 0; k < args; k++) {
        const e = group(i);
        if (e < 0) return null;
        col += s.slice(skipSpace(s, i), e);
        i = e;
      }
      while (s[skipSpace(s, i)] === '<') {
        const e = group(skipSpace(s, i) + 1);
        if (e < 0) return null;
        col += s.slice(skipSpace(s, i), e);
        i = e;
      }
      cols.push({ pre, col });
      pre = '';
    } else return null;
  }
  return { cols, tail: pre };
}

export const writeColumns = ({ cols, tail }: Columns) => cols.map((c) => c.pre + c.col).join('') + tail;

/** The vertical lines in a run of separators. */
const bars = (sep: string) => sep.replace(/[@!]\{[^}]*\}/g, '').replace(/[^|]/g, '');

/** How a column's text is aligned on screen. */
export function columnAlign(col: string): 'left' | 'center' | 'right' {
  if (/\\centering/.test(col)) return 'center';
  if (/\\raggedleft/.test(col)) return 'right';
  const letter = col.replace(/^(>\{[^}]*\})+/, '')[0];
  return letter === 'c' ? 'center' : letter === 'r' ? 'right' : 'left';
}

/** The columns, with plain `l` columns added when the table has more cells than its spec. */
function widened(c: Columns, width: number): Columns {
  const cols = c.cols.slice(0, Math.max(width, c.cols.length));
  while (cols.length < width) cols.push({ pre: '', col: 'l' });
  return { cols, tail: c.tail };
}

const columnsOf = (table: PMNode): Columns => widened({ cols: table.attrs.cols as Column[], tail: table.attrs.tail as string }, TableMap.get(table).width);

/**
 * The spec of a \multicolumn spanning `span` columns from `start`: centred,
 * with the vertical lines of the columns it covers (LaTeX gives a column the
 * lines to its right, and the first column the line on its left too).
 */
function spanSpec(c: Columns, start: number, span: number): string {
  const left = start === 0 ? bars(c.cols[0]?.pre ?? '') : '';
  const after = start + span >= c.cols.length ? c.tail : c.cols[start + span].pre;
  return `${left}c${bars(after)}`;
}

/** Where each cell's lines and alignment come from, for the stylesheet. */
export function cellLooks(table: PMNode): { pos: number; align: string; left: boolean; right: boolean }[] {
  const map = TableMap.get(table);
  const c = columnsOf(table);
  const out: { pos: number; align: string; left: boolean; right: boolean }[] = [];
  const seen = new Set<number>();
  map.map.forEach((pos, k) => {
    if (seen.has(pos)) return;
    seen.add(pos);
    const col = k % map.width;
    const cell = table.nodeAt(pos)!;
    const span = cell.attrs.colspan as number;
    const mc = cell.attrs.mc as { span: number; spec: string } | null;
    if (mc && mc.span === span) {
      const m = /^([^A-Za-z>]*)(.*?)([^A-Za-z}\]]*)$/.exec(mc.spec)!;
      out.push({ pos, align: columnAlign(m[2]), left: col === 0 ? bars(m[1]).length > 0 : bars(c.cols[col].pre).length > 0, right: bars(m[3]).length > 0 });
    } else {
      const last = col + span >= map.width;
      out.push({ pos, align: span > 1 ? 'center' : columnAlign(c.cols[col].col), left: bars(c.cols[col].pre).length > 0, right: last && bars(c.tail).length > 0 });
    }
  });
  return out;
}

// ---- reading ----------------------------------------------------------------------------------

export const TABULARS = new Set(['tabular', 'tabular*', 'tabularx']);

/** Commands that draw rules between rows (or sit before a row's cells). */
const RULE_COMMANDS = new Set(['hline', 'toprule', 'midrule', 'bottomrule', 'cline', 'cmidrule', 'addlinespace', 'specialrule', 'hhline', 'morecmidrules', 'rowcolor']);

export interface ReadRow {
  rules: string | null;
  cells: { from: number; to: number }[];
  /** After the row's \\; null when the row has none. */
  endOpt: string | null;
}

/** Past the rules (and comments) at `i`. */
function skipRules(s: string, i: number, to: number): number {
  for (;;) {
    const j = skipSpace(s, i);
    if (j >= to) return j;
    if (s[j] === '%') {
      i = skipComment(s, j);
      continue;
    }
    if (s[j] !== '\\') return j;
    const { name, end } = readCommand(s, j);
    if (!RULE_COMMANDS.has(name)) return j;
    let k = end;
    for (;;) {
      const a = skipSpace(s, k, false);
      const e = s[a] === '{' ? matchBrace(s, a) : s[a] === '[' ? matchBracket(s, a) : s[a] === '(' ? s.indexOf(')', a) + 1 : -1;
      if (e <= 0 || e > to) break;
      k = e;
    }
    i = k;
  }
}

/**
 * A tabular's body as rows of cells; null when it is not one we can edit
 * as a table (a nested environment's \\ is not a row end, but rows that do
 * not fit the spec are left as TeX code).
 */
export function splitRows(s: string, from: number, to: number): { rows: ReadRow[]; bottom: string | null } | null {
  const rows: ReadRow[] = [];
  let cells: { from: number; to: number }[] = [];
  let cellStart = from;
  let i = from;
  const endRow = (at: number, endOpt: string | null) => {
    cells.push({ from: cellStart, to: at });
    // The rules before the row are not part of its first cell.
    const first = cells[0];
    const after = skipRules(s, first.from, first.to);
    const rules = s.slice(first.from, after).trim() || null;
    first.from = after;
    rows.push({ rules, cells, endOpt });
    cells = [];
  };
  while (i < to) {
    const c = s[i];
    if (c === '%') {
      i = skipComment(s, i);
      continue;
    }
    if (c === '{') {
      const e = matchBrace(s, i);
      if (e < 0 || e > to) return null;
      i = e;
      continue;
    }
    if (c === '&') {
      cells.push({ from: cellStart, to: i });
      cellStart = ++i;
      continue;
    }
    if (c !== '\\') {
      i++;
      continue;
    }
    const verb = matchVerb(s, i);
    if (verb > 0) {
      i = verb;
      continue;
    }
    const b = readBegin(s, i);
    if (b) {
      const close = matchEnd(s, b.end, b.env);
      if (!close || close.end > to) return null;
      i = close.end;
      continue;
    }
    const { name, end } = readCommand(s, i);
    if (name === '\\' || name === 'tabularnewline') {
      let e = s[end] === '*' ? end + 1 : end;
      const o = skipSpace(s, e, false);
      if (s[o] === '[') {
        const be = matchBracket(s, o);
        if (be > 0) e = be;
      }
      endRow(i, s.slice(end, e));
      cellStart = i = e;
      continue;
    }
    i = end;
  }
  // What follows the last \\: the bottom rules, or a last row written without \\.
  const lastFrom = cellStart;
  const afterRules = skipRules(s, lastFrom, to);
  if (!cells.length && !s.slice(afterRules, to).trim()) return { rows, bottom: s.slice(lastFrom, afterRules).trim() || null };
  endRow(to, null);
  return { rows, bottom: null };
}

// ---- writing ----------------------------------------------------------------------------------

/** A table node as LaTeX; `inline` writes a cell's content. */
export function writeTable(table: PMNode, inline: (cell: PMNode) => string): string {
  const a = table.attrs;
  const map = TableMap.get(table);
  const columns = columnsOf(table);
  const head = `\\begin{${a.env}}${a.env !== 'tabular' && a.width != null ? `{${a.width}}` : ''}${a.pos != null ? `[${a.pos}]` : ''}{${writeColumns(columns)}}`;
  const lines = [head];
  table.forEach((row, _, r) => {
    if (row.attrs.rules) lines.push(a.indent + row.attrs.rules);
    const cells: string[] = [];
    for (let col = 0; col < map.width; ) {
      const pos = map.map[r * map.width + col];
      const rect = map.findCell(pos);
      const span = rect.right - rect.left;
      const cell = table.nodeAt(pos)!;
      // A cell spanning rows from above leaves this row's place empty.
      const text = rect.top === r ? inline(cell) : '';
      const mc = cell.attrs.mc as { span: number; spec: string } | null;
      if (span > 1 || mc?.span === 1) cells.push(`\\multicolumn{${span}}{${mc && mc.span === span ? mc.spec : spanSpec(columns, col, span)}}{${text}}`);
      else cells.push(text);
      col = rect.right;
    }
    const last = r === table.childCount - 1;
    const end = !last || row.attrs.endOpt != null || a.bottom ? ` \\\\${row.attrs.endOpt ?? ''}` : '';
    // Empty cells are just their &: `A &  & B` reads as `A & & B`.
    lines.push(a.indent + cells.map((c, k) => (k ? (c ? ` & ${c}` : ' &') : c)).join('').trim() + end);
  });
  if (a.bottom) lines.push(a.indent + a.bottom);
  lines.push(`\\end{${a.env}}`);
  return lines.join('\n');
}

// ---- commands -------------------------------------------------------------------------------------

/** Run a prosemirror-tables command, then fix up its result (the column spec, the rules). */
function after(cmd: Command, fix: (tr: Transaction, rect: TableRect) => void): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (!dispatch) return cmd(state);
    const rect = selectedRect(state);
    let done = null as Transaction | null;
    if (!cmd(state, (tr) => (done = tr)) || !done) return false;
    fix(done, rect);
    dispatch(done.scrollIntoView());
    return true;
  };
}

/** The table at `rect` in `tr`'s document (its position does not move: the changes are inside it). */
const tableIn = (tr: Transaction, rect: TableRect) => ({ pos: rect.tableStart - 1, node: tr.doc.nodeAt(rect.tableStart - 1)! });

function setColumns(tr: Transaction, pos: number, c: Columns) {
  const node = tr.doc.nodeAt(pos)!;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, cols: c.cols, tail: c.tail });
}

function setRowRules(tr: Transaction, tablePos: number, index: number, rules: string | null) {
  const table = tr.doc.nodeAt(tablePos)!;
  let pos = tablePos + 1;
  for (let k = 0; k < index; k++) pos += table.child(k).nodeSize;
  tr.setNodeMarkup(pos, undefined, { ...table.child(index).attrs, rules });
}

const FULL_RULE = /\\(hline|toprule|midrule|bottomrule)\b/;
const booktabs = (table: PMNode) => /\\(toprule|midrule|bottomrule)\b/.test([...rowsOf(table).map((r) => r.attrs.rules ?? ''), table.attrs.bottom ?? ''].join(' '));
const rowsOf = (table: PMNode) => {
  const out: PMNode[] = [];
  table.forEach((r) => out.push(r));
  return out;
};
/** Every row after the first has a line above it: a new row gets one too. */
const ruledBetween = (table: PMNode) => table.childCount > 1 && rowsOf(table).slice(1).every((r) => FULL_RULE.test(r.attrs.rules ?? ''));

/** A row above or below the selection (LyX: Add row), with the lines the table's other rows have. */
export function addRow(dir: -1 | 1): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const before = selectedRect(state).table;
    const ruled = ruledBetween(before);
    const inner = ruled ? (booktabs(before) ? '\\midrule' : '\\hline') : null;
    return after(dir < 0 ? addRowBefore : addRowAfter, (tr, rect) => {
      const { pos } = tableIn(tr, rect);
      const index = dir < 0 ? rect.top : rect.bottom;
      if (index === 0) {
        // A new first row takes over the line at the top.
        setRowRules(tr, pos, 0, before.child(0).attrs.rules);
        setRowRules(tr, pos, 1, inner);
      } else setRowRules(tr, pos, index, inner);
    })(state, dispatch);
  };
}

export const removeRows: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect0 = selectedRect(state);
  if (rect0.top === 0 && rect0.bottom >= rect0.map.height) return deleteTable(state, dispatch);
  const top = rect0.top === 0 ? rect0.table.child(0).attrs.rules : undefined;
  return after(deleteRow, (tr, rect) => {
    // The new first row keeps the line at the top.
    if (top !== undefined) setRowRules(tr, tableIn(tr, rect).pos, 0, top);
  })(state, dispatch);
};

/** A column left or right of the selection, set like the column next to it. */
export function addColumn(dir: -1 | 1): Command {
  return after(dir < 0 ? addColumnBefore : addColumnAfter, (tr, rect) => {
    const c = columnsOf(rect.table);
    const at = dir < 0 ? rect.left : rect.right;
    const like = c.cols[dir < 0 ? rect.left : rect.right - 1];
    const fresh: Column = { pre: bars(like.pre), col: like.col };
    const cols = [...c.cols];
    if (at === 0) {
      // The separators at the table's left edge stay there.
      cols[0] = { ...cols[0], pre: bars(cols[0].pre) };
      fresh.pre = c.cols[0].pre;
    }
    cols.splice(at, 0, fresh);
    setColumns(tr, tableIn(tr, rect).pos, { cols, tail: c.tail });
  });
}

export const removeColumns: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const r = selectedRect(state);
  if (r.left === 0 && r.right >= r.map.width) return deleteTable(state, dispatch);
  return after(deleteColumn, (tr, rect) => {
    const c = columnsOf(rect.table);
    const cols = [...c.cols];
    const leftEdge = cols[0].pre;
    cols.splice(rect.left, rect.right - rect.left);
    if (rect.left === 0 && cols.length) cols[0] = { ...cols[0], pre: leftEdge };
    setColumns(tr, tableIn(tr, rect).pos, { cols, tail: c.tail });
  })(state, dispatch);
};

/** Change the table's attributes from the selection's rectangle. */
function onTable(change: (table: PMNode, rect: TableRect) => Record<string, unknown> | null, rows?: (table: PMNode, rect: TableRect, tr: Transaction, pos: number) => void): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const attrs = change(rect.table, rect);
    if (!attrs && !rows) return false;
    if (dispatch) {
      const tr = state.tr;
      const pos = rect.tableStart - 1;
      if (rows) rows(rect.table, rect, tr, pos);
      if (attrs) tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, ...attrs });
      dispatch(tr);
    }
    return true;
  };
}

/** Align the selected columns' text (LyX: Left / Center / Right); for l, c, r columns. */
export function alignColumns(align: 'l' | 'c' | 'r'): Command {
  return onTable((table, rect) => {
    const c = columnsOf(table);
    const cols = c.cols.map((col, k) => (k >= rect.left && k < rect.right && /^[lcr]$/.test(col.col) ? { ...col, col: align } : col));
    return { cols, tail: c.tail };
  });
}

/** Strip the full-width rules from `rules`, or add one. */
function toggledRule(rules: string | null, add: string): string | null {
  if (FULL_RULE.test(rules ?? '')) return rules!.replace(/\\(hline|toprule|midrule|bottomrule)\b\s*/g, '').trim() || null;
  return rules ? `${rules}\n${add}` : add;
}

/** The line above (or below) the selected rows, on or off. */
export function toggleRowLine(side: 'top' | 'bottom'): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const { table, top, bottom, map } = selectedRect(state);
    const bt = booktabs(table);
    const index = side === 'top' ? top : bottom;
    if (dispatch) {
      const tr = state.tr;
      const pos = selectedRect(state).tableStart - 1;
      if (index >= map.height) tr.setNodeMarkup(pos, undefined, { ...table.attrs, bottom: toggledRule(table.attrs.bottom, bt ? '\\bottomrule' : '\\hline') });
      else setRowRules(tr, pos, index, toggledRule(table.child(index).attrs.rules, bt ? (index === 0 ? '\\toprule' : '\\midrule') : '\\hline'));
      dispatch(tr);
    }
    return true;
  };
}

/** The vertical line left (or right) of the selected columns, on or off. */
export function toggleColumnLine(side: 'left' | 'right'): Command {
  return onTable((table, rect) => {
    const c = columnsOf(table);
    const cols = [...c.cols];
    let tail = c.tail;
    const flip = (sep: string) => (bars(sep) ? sep.replace(/\|/g, '') : `${sep}|`);
    if (side === 'left') cols[rect.left] = { ...cols[rect.left], pre: flip(cols[rect.left].pre) };
    else if (rect.right >= cols.length) tail = bars(tail) ? tail.replace(/\|/g, '') : `|${tail}`;
    else cols[rect.right] = { ...cols[rect.right], pre: flip(cols[rect.right].pre) };
    return { cols, tail };
  });
}

/** All lines on (a full grid), or all off if the table already has them all (LyX: Set / Unset all lines). */
export const toggleAllLines: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { table, tableStart } = selectedRect(state);
  const c = columnsOf(table);
  const on = !(c.cols.every((col) => bars(col.pre)) && bars(c.tail) && rowsOf(table).every((r) => FULL_RULE.test(r.attrs.rules ?? '')) && FULL_RULE.test(table.attrs.bottom ?? ''));
  if (dispatch) {
    const tr = state.tr;
    const pos = tableStart - 1;
    const strip = (sep: string) => sep.replace(/\|/g, '');
    rowsOf(table).forEach((r, k) => setRowRules(tr, pos, k, on ? (FULL_RULE.test(r.attrs.rules ?? '') ? r.attrs.rules : toggledRule(r.attrs.rules, '\\hline')) : FULL_RULE.test(r.attrs.rules ?? '') ? toggledRule(r.attrs.rules, '') : r.attrs.rules));
    const bottom = on ? (FULL_RULE.test(table.attrs.bottom ?? '') ? table.attrs.bottom : toggledRule(table.attrs.bottom, '\\hline')) : FULL_RULE.test(table.attrs.bottom ?? '') ? toggledRule(table.attrs.bottom, '') : table.attrs.bottom;
    const cols = c.cols.map((col) => ({ ...col, pre: on ? `${strip(col.pre)}|` : strip(col.pre) }));
    tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, cols, tail: on ? `${strip(c.tail)}|` : strip(c.tail), bottom });
    dispatch(tr);
  }
  return true;
};

/** Merge the selected cells of one row into a \multicolumn (LyX: Multicolumn). */
export const mergeInRow: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return false;
  const rect = selectedRect(state);
  if (rect.bottom - rect.top !== 1) return false;
  return mergeCells(state, dispatch);
};

/** Split a \multicolumn cell back into its columns. */
export const splitMerged: Command = (state, dispatch) =>
  splitCell(state, dispatch && ((tr) => {
    // The split cells are plain cells again.
    tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (n, pos) => {
      if (n.type === schema.nodes.table_cell && n.attrs.mc) tr.setNodeMarkup(pos, undefined, { ...n.attrs, mc: null });
    });
    dispatch(tr);
  }));

export const removeTable: Command = deleteTable;

/** The cell `drow` rows down in the same column, with the cursor at its end. */
function cellBelow(state: EditorState, drow: number): number | null {
  const rect = selectedRect(state);
  const row = drow > 0 ? rect.bottom : rect.top - 1;
  if (row < 0 || row >= rect.map.height) return null;
  const pos = rect.map.map[row * rect.map.width + rect.left];
  const cell = rect.table.nodeAt(pos)!;
  return rect.tableStart + pos + 1 + cell.content.size;
}

/** Add a row at the end and put the cursor in it, in one transaction (one undo). */
function withNewRow(state: EditorState, place: (added: EditorState) => number | null): Transaction | null {
  let tr: Transaction | null = null;
  addRow(1)(state, (t) => (tr = t));
  if (!tr) return null;
  const t: Transaction = tr;
  const at = place(state.apply(t));
  if (at != null) t.setSelection(TextSelection.create(t.doc, at));
  return t.scrollIntoView();
}

/** Enter in a cell: the cell below, adding a row at the end, as in a spreadsheet. */
export const enterInCell: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  if (state.selection.$from.parent.type !== schema.nodes.table_cell && !(state.selection instanceof CellSelection)) return false;
  const at = cellBelow(state, 1);
  if (!dispatch) return true;
  if (at != null) dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)).scrollIntoView());
  else {
    const tr = withNewRow(state, (added) => cellBelow(added, 1));
    if (tr) dispatch(tr);
  }
  return true;
};

/** Tab: the next cell; at the last cell, a new row. Shift+Tab: the cell before. */
export function tabInTable(dir: -1 | 1): Command {
  return (state, dispatch, view) => {
    if (!isInTable(state)) return false;
    // The cursor goes to the end of the next cell's text (not selecting it, so typing does not replace it).
    if (goToNextCell(dir)(state, dispatch && ((tr) => dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.selection.to)))), view)) return true;
    if (dir < 0 || !dispatch) return true;
    const tr = withNewRow(state, (added) => {
      // The first cell of the new row.
      const rect = selectedRect(added);
      return rect.tableStart + rect.map.map[(rect.map.height - 1) * rect.map.width] + 1;
    });
    if (tr) dispatch(tr);
    return true;
  };
}

/** Up / Down out of a cell's single line: the cell above or below. */
export function verticalInCell(dir: -1 | 1): Command {
  return (state, dispatch, view) => {
    if (!isInTable(state) || !(state.selection instanceof TextSelection) || !state.selection.empty) return false;
    if (view && !view.endOfTextblock(dir < 0 ? 'up' : 'down')) return false;
    const at = cellBelow(state, dir);
    if (at == null) return false;
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)).scrollIntoView());
    return true;
  };
}

/** A new rows × cols table (LyX: Insert → Table), lined like LyX's default: a grid. */
export function newTable(rows: number, cols: number): PMNode {
  const cell = () => schema.nodes.table_cell.create();
  const rowNodes = Array.from({ length: rows }, () => schema.nodes.table_row.create({ rules: '\\hline' }, Array.from({ length: cols }, cell)));
  return schema.nodes.table.create(
    { cols: Array.from({ length: cols }, (_, k) => ({ pre: '|', col: k === 0 ? 'l' : 'c' })), tail: '|', bottom: '\\hline' },
    rowNodes,
  );
}

/** The selection's place in its table, for the table toolbar (null outside tables). */
export function tableInfo(state: EditorState): {
  row: number;
  col: number;
  rows: number;
  cols: number;
  lineAbove: boolean;
  lineBelow: boolean;
  lineLeft: boolean;
  lineRight: boolean;
  align: 'left' | 'center' | 'right';
  canMerge: boolean;
  canSplit: boolean;
} | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const { table, map } = rect;
  const c = columnsOf(table);
  const sel = state.selection;
  const cell = sel instanceof CellSelection ? sel.$anchorCell.nodeAfter : table.nodeAt(map.map[rect.top * map.width + rect.left]);
  return {
    row: rect.top,
    col: rect.left,
    rows: map.height,
    cols: map.width,
    lineAbove: FULL_RULE.test(table.child(rect.top).attrs.rules ?? ''),
    lineBelow: FULL_RULE.test((rect.bottom >= map.height ? table.attrs.bottom : table.child(rect.bottom).attrs.rules) ?? ''),
    lineLeft: !!bars(c.cols[rect.left].pre),
    lineRight: !!bars(rect.right >= c.cols.length ? c.tail : c.cols[rect.right].pre),
    align: columnAlign(c.cols[rect.left].col),
    canMerge: sel instanceof CellSelection && rect.bottom - rect.top === 1 && rect.right - rect.left > 1,
    canSplit: ((cell?.attrs.colspan as number) ?? 1) > 1,
  };
}
