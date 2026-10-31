import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { readTex } from '../../src/lyx/tex-reader';
import { writeTex } from '../../src/lyx/tex-writer';
import { schema } from '../../src/lyx/schema';

const DOC = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amsthm}
\newtheorem{hyp}{Hypothesis}
\begin{document}

\title{A Test}
\maketitle

% A comment before the introduction.
\section{Introduction}\label{sec:intro}
Some \emph{emphasised} and \textbf{bold \emph{nested}} text with $x^2$ inline,
a footnote\footnote{See \cite[p.~3]{knuth}.}, a reference to
Section~\ref{sec:intro} and \url{https://example.com}. Costs 5\% \& more\ldots{}
Line one\\
line two.

A paragraph with a display
\[
  E = mc^2
\]
that continues after it.

\begin{itemize}
  \item First item
  \item Second item with a nested list:
  \begin{enumerate}[label=(\alph*)]
    \item Inner one
    \item Inner two
  \end{enumerate}
  \item[Custom] Labelled item
\end{itemize}

\begin{hyp}[Main]
Our hypothesis.

It has two paragraphs.
\end{hyp}

\begin{proof}
Obvious.
\end{proof}

\begin{equation}
  a + b = c \label{eq:sum}
\end{equation}

\begin{figure}[ht]
  \centering
  \includegraphics[width=0.5\linewidth]{plot}
  \caption{A plot.}
\end{figure}

\begin{quote}
To be or not to be.
\end{quote}

\href{https://gitlatex.org}{Our \textit{site}} and \LaTeX{} rule.
\end{document}
`;

const children = (doc: PMNode) => {
  const out: PMNode[] = [];
  doc.forEach((c) => out.push(c));
  return out;
};

/** The document with child `i` replaced by `node` (every other child keeps its identity). */
const replaceChild = (doc: PMNode, i: number, node: PMNode) => doc.copy(doc.content.replaceChild(i, node));
const withText = (p: PMNode, text: string) => p.type.create(p.attrs, text ? schema.text(text) : null);

describe('LyX-style editor: reading and writing LaTeX', () => {
  it('writes an untouched document back byte for byte', () => {
    const read = readTex(DOC);
    expect(writeTex(read, read.doc)).toBe(DOC);
  });

  it('round-trips every built-in template unchanged', () => {
    const dir = path.join(__dirname, '../../src/templates/files');
    const files: string[] = [];
    const walk = (d: string) =>
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.tex') && files.push(path.join(d, e.name))));
    walk(dir);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const read = readTex(text);
      expect(writeTex(read, read.doc), path.relative(dir, f)).toBe(text);
    }
  });

  it('reads layouts, depths and insets as LyX shows them', () => {
    const { doc } = readTex(DOC);
    const pars = children(doc).filter((n) => n.type === schema.nodes.paragraph);
    const at = (text: string) => pars.find((p) => p.textContent.includes(text))!;
    expect(at('A Test').attrs.layout).toBe('Title');
    expect(at('Introduction').attrs.layout).toBe('Section');
    expect(at('First item').attrs).toMatchObject({ layout: 'Itemize', depth: 0, startsEnv: true });
    expect(at('Inner one').attrs).toMatchObject({ layout: 'Enumerate', depth: 1, envOpt: 'label=(\\alph*)' });
    expect(at('Labelled item').attrs).toMatchObject({ layout: 'Itemize', item: 'Custom' });
    expect(at('Our hypothesis').attrs).toMatchObject({ layout: 'Hypothesis', env: 'hyp', envOpt: 'Main' });
    expect(at('two paragraphs').attrs.layout).toBe('Hypothesis');
    expect(at('Obvious').attrs.layout).toBe('Proof');
    expect(at('To be').attrs.layout).toBe('Quote');
    expect(at('continues after it').attrs.joinPrev).toBe(true);

    const intro = at('emphasised');
    const kinds = new Set<string>();
    intro.descendants((n) => void kinds.add(n.type.name));
    for (const k of ['math_inline', 'footnote', 'cite', 'ref', 'url', 'hard_break']) expect(kinds).toContain(k);
    expect(intro.textContent).toContain('5% & more…');

    const displays = children(doc).filter((n) => n.type === schema.nodes.math_display);
    expect(displays.map((d) => [d.attrs.env, d.attrs.label])).toEqual([['\\[', null], ['equation', 'eq:sum']]);
    const figure = children(doc).find((n) => n.type === schema.nodes.float)!;
    expect(figure.attrs).toMatchObject({ env: 'figure', placement: 'ht' });
    const inFigure: string[] = [];
    figure.descendants((n) => void inFigure.push(n.type.name === 'paragraph' ? `p:${n.attrs.layout}` : n.type.name));
    expect(inFigure).toEqual(expect.arrayContaining(['ert_block', 'graphics', 'p:Caption']));
    expect(children(doc).find((n) => n.type === schema.nodes.note)?.textContent).toBe('A comment before the introduction.');
  });

  it('rewrites only a float whose caption changed, keeping its other lines', () => {
    const read = readTex(DOC);
    const blocks = children(read.doc);
    const i = blocks.findIndex((b) => b.type === schema.nodes.float);
    const float = blocks[i];
    const inner: PMNode[] = [];
    float.forEach((c) => inner.push(c));
    const k = inner.findIndex((c) => c.attrs.layout === 'Caption');
    inner[k] = inner[k].type.create(inner[k].attrs, schema.text('A better plot.'));
    const out = writeTex(read, replaceChild(read.doc, i, float.type.create(float.attrs, inner)));
    // Its other lines come back as written, indented as they were.
    expect(out).toContain('\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.5\\linewidth]{plot}\n  \\caption{A better plot.}\n\\end{figure}');
    expect(out.slice(0, out.indexOf('\\begin{figure}'))).toBe(DOC.slice(0, DOC.indexOf('\\begin{figure}')));
  });

  it('reads and writes notes, margin notes, graphics and alignment', () => {
    const tex = '\\begin{document}\n% one\n% two\n\nText\\marginpar{side} and \\includegraphics[scale=2]{a.png}.\n\n\\begin{center}\nMiddle.\n\\end{center}\n\\end{document}\n';
    const read = readTex(tex);
    expect(writeTex(read, read.doc)).toBe(tex);
    const blocks = children(read.doc);
    expect(blocks.map((b) => b.type.name === 'paragraph' ? `p:${b.attrs.align ?? '-'}` : b.type.name)).toEqual(['note', 'p:-', 'p:center']);
    // Edited, each is written back as LaTeX.
    const note = schema.nodes.note.create(null, schema.text('first\n\nthird'));
    const text = blocks[1].type.create(blocks[1].attrs, blocks[1].content.addToEnd(schema.text(' More.')));
    const middle = blocks[2].type.create(blocks[2].attrs, schema.text('Centred.'));
    const out = writeTex(read, schema.nodes.doc.create(null, [note, text, middle]));
    expect(out).toBe('\\begin{document}\n% first\n%\n% third\n\nText\\marginpar{side} and \\includegraphics[scale=2]{a.png}. More.\n\n\\begin{center}\nCentred.\n\\end{center}\n\\end{document}\n');
  });

  it('rewrites only the paragraph that changed', () => {
    const read = readTex(DOC);
    const blocks = children(read.doc);
    const i = blocks.findIndex((b) => b.textContent.startsWith('To be'));
    const out = writeTex(read, replaceChild(read.doc, i, withText(blocks[i], 'Brevity is the soul of wit.')));
    expect(out).toBe(DOC.replace('To be or not to be.', 'Brevity is the soul of wit.'));
  });

  it('rewrites a changed list item, keeping the other items as written', () => {
    const read = readTex(DOC);
    const blocks = children(read.doc);
    const i = blocks.findIndex((b) => b.textContent === 'First item');
    const out = writeTex(read, replaceChild(read.doc, i, withText(blocks[i], 'Changed first')));
    expect(out).toContain('\\begin{itemize}\n\\item Changed first\n\\item Second item with a nested list:');
    expect(out).toContain('\\begin{enumerate}[label=(\\alph*)]\n    \\item Inner one\n    \\item Inner two\n  \\end{enumerate}');
    expect(out).toContain('\\item[Custom] Labelled item\n\\end{itemize}');
    // Everything outside the list is untouched.
    expect(out.slice(0, out.indexOf('\\begin{itemize}'))).toBe(DOC.slice(0, DOC.indexOf('\\begin{itemize}')));
    expect(out.slice(out.indexOf('\\begin{hyp}'))).toBe(DOC.slice(DOC.indexOf('\\begin{hyp}')));
  });

  it('keeps a new item in the list it was added to', () => {
    const read = readTex(DOC);
    const blocks = children(read.doc);
    const i = blocks.findIndex((b) => b.textContent === 'Labelled item');
    const item = schema.nodes.paragraph.create({ layout: 'Itemize', depth: 0 }, schema.text('Fourth'));
    blocks.splice(i + 1, 0, item);
    const out = writeTex(read, schema.nodes.doc.create(null, blocks));
    expect(out).toContain('\\item[Custom] Labelled item\n\\item Fourth\n\\end{itemize}');
    expect(out.match(/\\begin\{itemize\}/g)!.length).toBe(1);
  });

  it('writes new content as clean LaTeX, escaping special characters', () => {
    const read = readTex('\\begin{document}\nOld.\n\\end{document}\n');
    const p = schema.nodes.paragraph.create({ layout: 'Section' }, [schema.text('Costs & 50% '), schema.text('more', [schema.marks.emph.create()])]);
    const theorem = schema.nodes.paragraph.create({ layout: 'Theorem', startsEnv: true }, schema.text('True.'));
    const formula = schema.nodes.math_display.create({ latex: 'x = 1', env: '\\[', label: 'eq:one' });
    const out = writeTex(read, schema.nodes.doc.create(null, [p, theorem, formula]));
    // A theorem the file did not define brings its \newtheorem (and amsthm) along.
    expect(out).toBe('\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}\n\\begin{document}\n\\section{Costs \\& 50\\% \\emph{more}}\n\\begin{theorem}\nTrue.\n\\end{theorem}\n\n\\begin{equation}\n\\label{eq:one}\nx = 1\n\\end{equation}\n\\end{document}\n');
  });

  it('adds amsthm and \\newtheorem for a theorem layout the document does not define', () => {
    const tex = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nOld.\n\\end{document}\n';
    const read = readTex(tex);
    const lemma = schema.nodes.paragraph.create({ layout: 'Lemma' }, schema.text('True.'));
    const proof = schema.nodes.paragraph.create({ layout: 'Proof' }, schema.text('Clear.'));
    const out = writeTex(read, schema.nodes.doc.create(null, [lemma, proof]));
    expect(out.startsWith('\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{amsthm}\n\\newtheorem{lemma}{Lemma}\n\\begin{document}\n')).toBe(true);
    // Already defined: nothing added.
    const defined = readTex('\\usepackage{amsthm}\n\\newtheorem{lemma}{Lemma}\n\\begin{document}\nOld.\n\\end{document}\n');
    expect(writeTex(defined, schema.nodes.doc.create(null, [lemma])).startsWith('\\usepackage{amsthm}\n\\newtheorem{lemma}{Lemma}\n\\begin{document}')).toBe(true);
  });

  it('writes typographic quotes as LaTeX quotes', () => {
    const read = readTex('\\begin{document}\nOld.\n\\end{document}\n');
    const p = schema.nodes.paragraph.create(null, schema.text('\u201cHi\u201d, she said \u2018no\u2019.'));
    expect(writeTex(read, schema.nodes.doc.create(null, [p]))).toBe("\\begin{document}\n``Hi'', she said `no'.\n\\end{document}\n");
  });

  it('keeps \\verb whole, so editing its paragraph cannot escape what is inside', () => {
    const read = readTex('\\begin{document}\nUse \\verb|a_b{}| here.\n\\end{document}\n');
    const p = children(read.doc)[0];
    const edited = p.type.create(p.attrs, p.content.addToEnd(schema.text(' Done.')));
    expect(writeTex(read, replaceChild(read.doc, 0, edited))).toBe('\\begin{document}\nUse \\verb|a_b{}| here. Done.\n\\end{document}\n');
  });

  it('reads a file without \\begin{document} (an \\input chapter) as all body', () => {
    const text = '\\chapter{One}\nText.\n';
    const read = readTex(text);
    expect(read.prefix).toBe('');
    expect(children(read.doc)[0].attrs.layout).toBe('Chapter');
    expect(writeTex(read, read.doc)).toBe(text);
  });
});
