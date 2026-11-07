import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { readTex } from '../../src/lyx/tex-reader';
import { writeTex } from '../../src/lyx/tex-writer';
import { schema } from '../../src/lyx/schema';
import {
  addColumn, addRow, alignColumns, enterInCell, mergeInRow, parseColumns, removeColumns, removeRows, splitRows, tabInTable, toggleAllLines, toggleColumnLine,
  toggleRowLine, writeColumns,
} from '../../src/lyx/table';

const doc = (body: string) => `\\begin{document}\n${body}\\end{document}\n`;

const GRID = doc('\\begin{tabular}{|l|c|}\n\\hline\nA & B \\\\\n\\hline\n1 & 2 \\\\\n\\hline\n\\end{tabular}\n');

/** An editor with the cursor in the cell holding `at`. */
function editor(tex: string, at: string) {
  const read = readTex(tex);
  let cursor = -1;
  read.doc.descendants((n, pos) => {
    if (cursor < 0 && n.isText && n.text!.includes(at)) cursor = pos + n.text!.indexOf(at);
  });
  if (cursor < 0) throw new Error(`no "${at}"`);
  let state = EditorState.create({ doc: read.doc, selection: TextSelection.create(read.doc, cursor) });
  const run = (cmd: Command) => cmd(state, (tr) => (state = state.apply(tr)));
  const type = (text: string) => run((s, d) => (d?.(s.tr.insertText(text)), true));
  return { run, type, tex: () => writeTex(read, state.doc), state: () => state, read };
}

const tableOf = (tex: string) => {
  let table = null as ReturnType<typeof readTex>['doc'] | null;
  readTex(tex).doc.descendants((n) => {
    if (n.type === schema.nodes.table) table = n;
    return !table;
  });
  return table;
};

describe('LyX-style tables', () => {
  it('reads column specs, with separators and starred groups', () => {
    const c = parseColumns('|l|>{\\centering}p{3cm}|*{2}{r}@{}')!;
    expect(c.cols.map((x) => x.col)).toEqual(['l', '>{\\centering}p{3cm}', 'r', 'r']);
    expect(c.cols.map((x) => x.pre)).toEqual(['|', '|', '|', '']);
    expect(c.tail).toBe('@{}');
    expect(writeColumns(parseColumns('|l|c|')!)).toBe('|l|c|');
    expect(parseColumns('l{')).toBeNull();
  });

  it('splits a body into rows, rules and cells', () => {
    const body = '\\toprule\nA & {x \\\\ y} \\\\[2pt]\n\\midrule\n1 & 2\\\\ \\bottomrule\n';
    const r = splitRows(body, 0, body.length)!;
    expect(r.rows.map((row) => row.rules)).toEqual(['\\toprule', '\\midrule']);
    expect(r.rows[0].cells.map((c) => body.slice(c.from, c.to).trim())).toEqual(['A', '{x \\\\ y}']);
    expect(r.rows[0].endOpt).toBe('[2pt]');
    expect(r.bottom).toBe('\\bottomrule');
  });

  it('reads a tabular as a table and writes it back unchanged', () => {
    const t = tableOf(GRID)!;
    expect(t.childCount).toBe(2);
    expect(t.child(0).attrs.rules).toBe('\\hline');
    expect(t.child(1).child(1).textContent).toBe('2');
    expect(writeTex(readTex(GRID), readTex(GRID).doc)).toBe(GRID);
  });

  it('keeps a tabular it cannot edit as TeX code', () => {
    const tex = doc('\\begin{tabular}{l}\nA & B & C \\\\\n\\end{tabular}\n');
    expect(tableOf(tex)).toBeNull();
    const read = readTex(tex);
    expect(read.doc.firstChild!.type).toBe(schema.nodes.ert_block);
    expect(writeTex(read, read.doc)).toBe(tex);
  });

  it('writes an edited cell, escaped, keeping the rules', () => {
    const e = editor(GRID, '2');
    e.type('50% ');
    expect(e.tex()).toBe(doc('\\begin{tabular}{|l|c|}\n\\hline\nA & B \\\\\n\\hline\n1 & 50\\% 2 \\\\\n\\hline\n\\end{tabular}\n'));
  });

  it('adds a row with the table\'s lines, and a column like its neighbour', () => {
    const e = editor(GRID, '2');
    e.run(addRow(1));
    e.run(addColumn(1));
    expect(e.tex()).toBe(doc('\\begin{tabular}{|l|c|c|}\n\\hline\nA & B & \\\\\n\\hline\n1 & 2 & \\\\\n\\hline\n& & \\\\\n\\hline\n\\end{tabular}\n'));
  });

  it('deletes a column and a row', () => {
    const e = editor(GRID, 'A');
    e.run(removeColumns);
    expect(e.tex()).toContain('\\begin{tabular}{|c|}');
    e.run(removeRows);
    // The line at the top stays with the new first row.
    expect(e.tex()).toBe(doc('\\begin{tabular}{|c|}\n\\hline\n2 \\\\\n\\hline\n\\end{tabular}\n'));
  });

  it('aligns columns and toggles lines', () => {
    const e = editor(GRID, 'B');
    e.run(alignColumns('r'));
    e.run(toggleColumnLine('right'));
    e.run(toggleRowLine('bottom'));
    expect(e.tex()).toBe(doc('\\begin{tabular}{|l|r}\n\\hline\nA & B \\\\\n1 & 2 \\\\\n\\hline\n\\end{tabular}\n'));
    e.run(toggleAllLines);
    expect(e.tex()).toBe(GRID.replace('{|l|c|}', '{|l|r|}'));
    e.run(toggleAllLines);
    expect(e.tex()).toBe(doc('\\begin{tabular}{lr}\nA & B \\\\\n1 & 2 \\\\\n\\end{tabular}\n'));
  });

  it('uses booktabs rules in a booktabs table', () => {
    const e = editor(doc('\\begin{tabular}{@{}lr@{}}\n\\toprule\nA & B \\\\\n\\midrule\n1 & 2 \\\\\n\\bottomrule\n\\end{tabular}\n'), '1');
    e.run(toggleRowLine('top'));
    e.run(toggleRowLine('top'));
    e.run(addColumn(-1));
    expect(e.tex()).toBe(doc('\\begin{tabular}{@{}llr@{}}\n\\toprule\n& A & B \\\\\n\\midrule\n& 1 & 2 \\\\\n\\bottomrule\n\\end{tabular}\n'));
  });

  it('merges cells of a row into a \\multicolumn and reads one back', () => {
    const e = editor(GRID, 'A');
    e.run((s, d) => {
      let a = -1;
      let b = -1;
      s.doc.descendants((n, pos) => {
        if (n.type !== schema.nodes.table_cell) return true;
        if (n.textContent === 'A') a = pos;
        if (n.textContent === 'B') b = pos;
        return false;
      });
      d?.(s.tr.setSelection(CellSelection.create(s.doc, a, b)));
      return true;
    });
    e.run(mergeInRow);
    const out = e.tex();
    expect(out).toContain('\\multicolumn{2}{|c|}{AB} \\\\');
    const back = tableOf(out)!;
    expect(back.child(0).childCount).toBe(1);
    expect(back.child(0).child(0).attrs).toMatchObject({ colspan: 2, mc: { span: 2, spec: '|c|' } });
    expect(writeTex(readTex(out), readTex(out).doc)).toBe(out);
  });

  it('Tab and Enter move between cells, adding a row at the end', () => {
    const e = editor(GRID, 'A');
    e.run(tabInTable(1));
    e.type('!');
    e.run(enterInCell);
    e.run(enterInCell);
    e.type('new');
    const t = e.state().doc.firstChild!;
    expect(t.childCount).toBe(3);
    expect(t.child(0).child(1).textContent).toBe('B!');
    expect(t.child(2).child(1).textContent).toBe('new');
  });

  it('keeps the indentation of a float and its rows when a cell changes', () => {
    const tex = doc('\\begin{table}[t]\n  \\centering\n  \\caption{C.}\\label{tab:c}\n  \\begin{tabular}{lr}\n    \\toprule\n    A & 1 \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n');
    const e = editor(tex, '1');
    e.type('2');
    expect(e.tex()).toBe(tex.replace('A & 1', 'A & 21'));
  });

  it('keeps a centred table centred', () => {
    const tex = doc('\\begin{center}\n\\begin{tabular}{ll}\na & b\n\\end{tabular}\n\\end{center}\n');
    const e = editor(tex, 'b');
    expect(e.tex()).toBe(tex);
    e.type('x');
    expect(e.tex()).toBe(doc('\\begin{center}\n\\begin{tabular}{ll}\na & xb\n\\end{tabular}\n\\end{center}\n'));
  });
});

describe('LyX-style editor: packages for new insets', () => {
  const pre = '\\documentclass{article}\n\\begin{document}\n';
  // The document with a paragraph holding a new picture added at the end.
  const withGraphic = (d: ReturnType<typeof readTex>['doc']) =>
    d.copy(d.content.addToEnd(schema.nodes.paragraph.create(null, schema.nodes.graphics.create({ path: 'a.png' }))));
  it('adds a package for what is newly used, not for what the file already used', () => {
    const fresh = readTex(`${pre}Text.\n\\end{document}\n`);
    expect(writeTex(fresh, withGraphic(fresh.doc))).toContain('\\usepackage{graphicx}\n\\begin{document}');
    const used = readTex(`${pre}\\includegraphics{b.png}\n\\end{document}\n`);
    expect(writeTex(used, withGraphic(used.doc))).not.toContain('\\usepackage{graphicx}');
  });
});
