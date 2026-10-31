import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { readTex } from '../../src/lyx/tex-reader';
import { writeTex } from '../../src/lyx/tex-writer';
import { schema } from '../../src/lyx/schema';
import {
  changeDepth, insertMath, insertTexCode, lyxEnter, moveParagraph, moveSection, setLayout, shiftSection, toggleNumbering, toggleStyle,
} from '../../src/lyx/commands';

const doc = (body: string) => `\\begin{document}\n${body}\\end{document}\n`;

/** An editor on `tex` with the cursor at the first occurrence of `at` (after `offset` more characters). */
function editor(tex: string, at: string, offset = 0) {
  const read = readTex(tex);
  let cursor = -1;
  read.doc.descendants((n, pos) => {
    if (cursor < 0 && n.isText && n.text!.includes(at)) cursor = pos + n.text!.indexOf(at) + offset;
  });
  if (cursor < 0) throw new Error(`no "${at}" in the document`);
  let state = EditorState.create({ doc: read.doc, selection: TextSelection.create(read.doc, cursor) });
  const run = (cmd: Command) => {
    const ok = cmd(state, (tr) => (state = state.apply(tr)));
    return ok;
  };
  return { run, tex: () => writeTex(read, state.doc), state: () => state };
}

const theorems = () => readTex('').theorems;

describe('LyX-style editor commands', () => {
  it('changes a paragraph\'s layout', () => {
    const e = editor(doc('Intro text.\n'), 'Intro');
    e.run(setLayout('Section'));
    expect(e.tex()).toBe(doc('\\section{Intro text.}\n'));
  });

  it('nests a paragraph under a list item, at most one level deeper than the one before', () => {
    const e = editor(doc('\\begin{itemize}\n\\item One\n\\item Two\n\\end{itemize}\n'), 'Two');
    e.run(changeDepth(1));
    e.run(changeDepth(1)); // no deeper than one level under "One"
    expect(e.state().doc.child(1).attrs.depth).toBe(1);
    e.run(setLayout('Itemize'));
    expect(e.tex()).toBe(doc('\\begin{itemize}\n\\item One\n\\begin{itemize}\n\\item Two\n\\end{itemize}\n\\end{itemize}\n'));
  });

  it('Enter in a list item starts another item; Enter on the empty one ends the list', () => {
    const e = editor(doc('\\begin{itemize}\n\\item One\n\\end{itemize}\n'), 'One', 3);
    e.run(lyxEnter(theorems));
    e.run((s, d) => (d?.(s.tr.insertText('Two')), true));
    e.run(lyxEnter(theorems));
    e.run(lyxEnter(theorems));
    e.run((s, d) => (d?.(s.tr.insertText('After.')), true));
    expect(e.tex()).toBe(doc('\\begin{itemize}\n\\item One\n\\item Two\n\\end{itemize}\n\nAfter.\n'));
  });

  it('Enter in a nested empty item continues the outer list', () => {
    const e = editor(doc('\\begin{itemize}\n\\item Outer\n\\begin{itemize}\n\\item Inner\n\\end{itemize}\n\\end{itemize}\n'), 'Inner', 5);
    e.run(lyxEnter(theorems));
    e.run(lyxEnter(theorems));
    e.run((s, d) => (d?.(s.tr.insertText('Back out')), true));
    expect(e.tex()).toContain('\\end{itemize}\n\\item Back out\n\\end{itemize}');
  });

  it('Enter after a heading gives a Standard paragraph; Alt+Enter leaves a list in one step', () => {
    const h = editor(doc('\\section{Intro}\n'), 'Intro', 5);
    h.run(lyxEnter(theorems));
    expect(h.state().doc.child(1).attrs.layout).toBe('Standard');
    const l = editor(doc('\\begin{itemize}\n\\item One\n\\end{itemize}\n'), 'One', 3);
    l.run(lyxEnter(theorems, true));
    expect(l.state().doc.child(1).attrs.layout).toBe('Standard');
  });

  it('moves a paragraph down and a section, with its contents, up', () => {
    const p = editor(doc('A.\n\nB.\n'), 'A.');
    p.run(moveParagraph(1));
    expect(p.tex()).toContain('B.');
    expect(p.tex().indexOf('B.')).toBeLessThan(p.tex().indexOf('A.'));

    const s = editor(doc('\\section{One}\nText one.\n\n\\section{Two}\nText two.\n\n\\subsection{Two.a}\nDeep.\n'), 'Two', 1);
    s.run(moveSection(-1, theorems));
    const out = s.tex();
    expect(out.indexOf('\\section{Two}')).toBeLessThan(out.indexOf('\\section{One}'));
    expect(out.indexOf('Deep.')).toBeLessThan(out.indexOf('\\section{One}'));
  });

  it('promotes a section with its subsections', () => {
    const e = editor(doc('\\subsection{A}\nText.\n\n\\subsubsection{B}\nMore.\n'), 'A');
    e.run(shiftSection(-1, theorems));
    expect(e.tex()).toBe(doc('\\section{A}\nText.\n\n\\subsection{B}\nMore.\n'));
  });

  it('applies a text style to the selection', () => {
    const e = editor(doc('Make this bold.\n'), 'this');
    e.run((s, d) => (d?.(s.tr.setSelection(TextSelection.create(s.doc, s.selection.from, s.selection.from + 4))), true));
    e.run(toggleStyle(schema.marks.bold));
    expect(e.tex()).toBe(doc('Make \\textbf{this} bold.\n'));
  });

  it('inserts an inline formula from the selection, and a display formula inside a paragraph', () => {
    const e = editor(doc('Let x be given.\n'), 'x');
    e.run((s, d) => (d?.(s.tr.setSelection(TextSelection.create(s.doc, s.selection.from, s.selection.from + 1))), true));
    e.run(insertMath(false));
    expect(e.state().selection).toBeInstanceOf(NodeSelection);
    expect(e.tex()).toBe(doc('Let $x$ be given.\n'));

    const d = editor(doc('Before after.\n'), ' after');
    d.run(insertMath('equation'));
    expect(d.tex()).toBe(doc('Before\n\\begin{equation}\n\n\\end{equation}\nafter.\n'));
  });

  it('numbers and un-numbers a display formula', () => {
    const e = editor(doc('Text\n\\[ x \\]\nmore.\n'), 'Text');
    let pos = -1;
    e.state().doc.forEach((n: PMNode, p: number) => {
      if (n.type === schema.nodes.math_display) pos = p;
    });
    e.run((s, d) => (d?.(s.tr.setSelection(NodeSelection.create(s.doc, pos))), true));
    e.run(toggleNumbering);
    expect(e.tex()).toContain('\\begin{equation}\nx\n\\end{equation}');
    e.run(toggleNumbering);
    expect(e.tex()).toContain('\\[\nx\n\\]');
  });

  it('wraps the selection in TeX code (Ctrl+L)', () => {
    const e = editor(doc('A raw bit here.\n'), 'raw');
    e.run((s, d) => (d?.(s.tr.setSelection(TextSelection.create(s.doc, s.selection.from, s.selection.from + 3))), true));
    e.run(insertTexCode);
    // The new box is selected (so it opens for typing) and holds the selected text as TeX.
    const sel = e.state().selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect((sel as NodeSelection).node.type).toBe(schema.nodes.ert_inline);
    expect((sel as NodeSelection).node.textContent).toBe('raw');
    expect(e.tex()).toBe(doc('A raw bit here.\n'));
  });
});
