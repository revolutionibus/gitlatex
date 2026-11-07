import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import { readTex } from '../../src/lyx/tex-reader';
import { writeTex } from '../../src/lyx/tex-writer';
import { schema } from '../../src/lyx/schema';
import { insertFootnote, insertLabel, insertNote, renameLabel, setAlign, suggestLabel } from '../../src/lyx/commands';
import { snippetToTex } from '../../src/editor/bridge';
import { findGraphic, graphicsPaths, resolveInProject } from '../../src/lyx/images';
import type { Workspace } from '../../src/state/workspace';

const doc = (body: string) => `\\begin{document}\n${body}\\end{document}\n`;

function editor(tex: string, at: string, length = 0) {
  const read = readTex(tex);
  let cursor = -1;
  read.doc.descendants((n, pos) => {
    if (cursor < 0 && n.isText && n.text!.includes(at)) cursor = pos + n.text!.indexOf(at);
  });
  let state = EditorState.create({ doc: read.doc, selection: TextSelection.create(read.doc, cursor, cursor + length) });
  const run = (cmd: Command) => cmd(state, (tr) => (state = state.apply(tr)));
  return { run, tex: () => writeTex(read, state.doc), state: () => state, theorems: read.theorems };
}

describe('LyX-style editor insets', () => {
  it('puts the selected text in a footnote', () => {
    const e = editor(doc('A claim (see the appendix).\n'), 'see the appendix', 16);
    e.run(insertFootnote());
    expect(e.tex()).toBe(doc('A claim (\\footnote{see the appendix}).\n'));
  });

  it('suggests a label from the heading and puts it at the heading\'s end', () => {
    const e = editor(doc('\\section{Related Work}\nText.\n'), 'Related');
    const name = suggestLabel(e.state(), e.theorems);
    expect(name).toBe('sec:related-work');
    e.run(insertLabel(name, () => e.theorems));
    expect(e.tex()).toBe(doc('\\section{Related Work}\\label{sec:related-work}\nText.\n'));
  });

  it('labels a selected display formula, numbering it', () => {
    const e = editor(doc('Text\n\\[ x \\]\nmore.\n'), 'Text');
    let pos = -1;
    e.state().doc.forEach((n, p) => {
      if (n.type === schema.nodes.math_display) pos = p;
    });
    e.run((s, d) => (d?.(s.tr.setSelection(NodeSelection.create(s.doc, pos))), true));
    expect(suggestLabel(e.state(), e.theorems)).toBe('eq:');
    e.run(insertLabel('eq:x', () => e.theorems));
    expect(e.tex()).toContain('\\begin{equation}\n\\label{eq:x}\nx\n\\end{equation}');
  });

  it('renames a label with every reference to it', () => {
    const e = editor(doc('\\section{A}\\label{sec:a}\nSee \\ref{sec:a} and \\cref{sec:a,sec:b}.\n'), 'See');
    e.run(renameLabel('sec:a', 'sec:intro'));
    expect(e.tex()).toBe(doc('\\section{A}\\label{sec:intro}\nSee \\ref{sec:intro} and \\cref{sec:intro,sec:b}.\n'));
  });

  it('adds a LyX note, written as comments', () => {
    const e = editor(doc('Text.\n'), 'Text');
    e.run(insertNote);
    e.run((s, d) => (d?.(s.tr.insertText('remember this')), true));
    expect(e.tex()).toBe(doc('Text.\n\n% remember this\n'));
  });

  it('centers paragraphs in one center environment', () => {
    const e = editor(doc('One.\n\nTwo.\n\nThree.\n'), 'One', 0);
    e.run((s, d) => (d?.(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.child(1).nodeSize + 2))), true));
    e.run(setAlign('center'));
    expect(e.tex()).toBe(doc('\\begin{center}\nOne.\n\nTwo.\n\\end{center}\n\nThree.\n'));
  });
});

describe('snippetToTex', () => {
  it('fills placeholders, takes a choice\'s first option and selects the first placeholder', () => {
    expect(snippetToTex('\\section{${1:Title}}\n$0')).toEqual({ tex: '\\section{Title}\n', select: 'Title' });
    expect(snippetToTex('\\textcolor{${1|red,blue|}}{${2:text}}')).toEqual({ tex: '\\textcolor{red}{text}', select: 'text' });
    expect(snippetToTex('costs \\$5')).toEqual({ tex: 'costs $5', select: undefined });
  });
});

describe('finding graphics', () => {
  const files = new Set(['chapters/one.tex', 'figures/plot.pdf', 'img/logo.png']);
  const ws = { get: (p: string) => (files.has(p) ? { path: p } : undefined) } as unknown as Workspace;

  it('resolves .. within the project, and refuses to leave it', () => {
    expect(resolveInProject('chapters', '../figures/plot.pdf')).toBe('figures/plot.pdf');
    expect(resolveInProject('', '../outside.png')).toBeNull();
  });

  it('tries extensions and \\graphicspath folders as LaTeX does', () => {
    expect(graphicsPaths('\\graphicspath{{img/}{figures/}}')).toEqual(['img/', 'figures/']);
    expect(findGraphic(ws, 'chapters/one.tex', '../figures/plot', [])).toBe('figures/plot.pdf');
    expect(findGraphic(ws, 'main.tex', 'logo', ['img/'])).toBe('img/logo.png');
    expect(findGraphic(ws, 'main.tex', 'missing', ['img/'])).toBeNull();
  });
});
