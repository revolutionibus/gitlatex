import { describe, expect, it } from 'vitest';
import { parseTex, macrosOf, theoremsOf, graphicsPaths } from '../../src/lyx/tex-import';
import { exportTex, genRun, ensurePreamble } from '../../src/lyx/tex-export';
import { latexOf, mkBlock } from '../../src/lyx/model';
import { tabularOp } from '../../src/lyx/tabular';

const DOC = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amsthm}
\newtheorem{thm}{Theorem}
\newcommand{\R}{\mathbb{R}}
\begin{document}
\title{A note}
\author{Jane Doe \and John Roe}
\maketitle

% Introduction starts here
\section{Introduction}\label{sec:intro}
Let $f:[a,b]\to\R$ be continuous,
and let \emph{F} be an antiderivative.\footnote{See \cite[p.~3]{knuth84}.}
Then
\begin{equation}
  \int_a^b f = F(b)-F(a) \label{eq:ftc}
\end{equation}
by Theorem~\ref{thm:main}.

\begin{thm}[Main]\label{thm:main}
Every \textbf{continuous} function is integrable.
\end{thm}

\begin{itemize}
  \item First item
  \item Second item
  \begin{enumerate}
    \item Nested
  \end{enumerate}
\end{itemize}

\begin{figure}[ht]
  \centering
  \includegraphics[width=0.5\linewidth]{fig/plot.png}
  \caption{A plot}\label{fig:plot}
\end{figure}

\begin{tabular}{cc}
a & b \\
\end{tabular}

\end{document}
`;

function load(text: string) {
  const doc = parseTex(text);
  const ed = document.createElement('div');
  doc.blocks.forEach((b) => ed.append(b));
  const envFor = (layout: string) => Object.entries(doc.theorems).find(([, l]) => l === layout)?.[0] ?? null;
  const blocks = () => [...ed.children] as HTMLElement[];
  // what the editor does right after loading: remember each chunk's generated LaTeX
  for (const [i, ch] of doc.chunks.entries()) ch.gen = genRun(blocks().filter((b) => b.dataset.chunk === String(i)), {}, envFor);
  const save = () => exportTex(blocks(), { head: doc.head, tail: doc.tail, trailing: doc.trailing, chunks: doc.chunks, envFor }).text;
  return { doc, ed, blocks, save };
}

describe('LyX-style editor: LaTeX round trip', () => {
  it('writes an untouched file back byte for byte', () => {
    const { save } = load(DOC);
    expect(save()).toBe(DOC);
  });

  it('reads layouts, formulas and insets', () => {
    const { blocks } = load(DOC);
    const types = blocks().map((b) => b.dataset.type);
    expect(types).toContain('Title');
    expect(types).toContain('Author');
    expect(types).toContain('Section');
    expect(types).toContain('Theorem');
    expect(types.filter((t) => t === 'Itemize')).toHaveLength(2);
    const nested = blocks().find((b) => b.dataset.type === 'Enumerate')!;
    expect(nested.dataset.depth).toBe('1');
    const disp = blocks().find((b) => b.dataset.type === '_display')!;
    expect(disp.dataset.numbered).toBe('1');
    expect(disp.dataset.label).toBe('eq:ftc');
    const section = blocks().find((b) => b.dataset.type === 'Section')!;
    expect(section.querySelector('[data-inset="Label"]')?.getAttribute('data-name')).toBe('sec:intro');
    const para = disp.previousElementSibling as HTMLElement;
    expect(latexOf(para.querySelector('math-field'))).toBe('f:[a,b]\\to\\R');
    expect(para.querySelector('[data-inset="Foot"] [data-inset="Cite"]')?.getAttribute('data-keys')).toBe('knuth84');
    expect((disp.nextElementSibling as HTMLElement).dataset.cont).toBe('1');
    const thm = blocks().find((b) => b.dataset.type === 'Theorem')!;
    expect(thm.dataset.env).toBe('thm');
    expect(thm.dataset.arg).toBe('Main');
    const float = blocks().find((b) => b.querySelector('[data-inset="Float"]'))!;
    expect(float.querySelector('[data-inset="Graphics"]')?.getAttribute('data-path')).toBe('fig/plot.png');
    expect(float.querySelector('[data-inset="Caption"]')).not.toBeNull();
    const table = blocks().find((b) => b.querySelector('[data-inset="Tabular"]'))!;
    expect([...table.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['a', 'b']);
    // unknown constructs are TeX code, kept verbatim
    expect(blocks().some((b) => b.querySelector('.ibody')?.textContent === '% Introduction starts here')).toBe(true);
  });

  it('rewrites only the edited paragraph', () => {
    const { blocks, save } = load(DOC);
    const thm = blocks().find((b) => b.dataset.type === 'Theorem')!;
    thm.querySelector('strong')!.textContent = 'differentiable';
    const out = save();
    expect(out).toContain('\\begin{thm}[Main]\n\\label{thm:main} Every \\textbf{differentiable} function is integrable.\n\\end{thm}');
    // everything else is unchanged
    expect(out.replace(/\\begin\{thm\}[\s\S]*?\\end\{thm\}/, '')).toBe(DOC.replace(/\\begin\{thm\}[\s\S]*?\\end\{thm\}/, ''));
  });

  it('keeps a new list item inside its list', () => {
    const { ed, blocks, save } = load(DOC);
    const second = blocks().filter((b) => b.dataset.type === 'Itemize')[1];
    const nb = mkBlock('Itemize', 'Third item');
    second.after(nb);
    void ed;
    const out = save();
    expect(out).toContain('\\item Second item\n\\item Third item\n\\begin{enumerate}');
    expect(out.match(/\\begin\{itemize\}/g)).toHaveLength(1);
  });

  it('adds what new content needs to the preamble', () => {
    const head = '\\documentclass{article}\n\\begin{document}\n';
    const out = ensurePreamble(head, { theorems: { theorem: 'Theorem', definition: 'Definition' }, hyperref: true });
    expect(out).toBe(
      '\\documentclass{article}\n\\usepackage{hyperref}\n\\usepackage{amsthm}\n\\theoremstyle{plain}\n\\newtheorem{theorem}{Theorem}\n\\theoremstyle{definition}\n\\newtheorem{definition}[theorem]{Definition}\n\\theoremstyle{plain}\n\n\\begin{document}\n',
    );
  });

  it('reads files without \\begin{document} (included chapters)', () => {
    const text = '\\chapter{Methods}\n\nWe measure $x$.\n';
    const { save, blocks } = load(text);
    expect(blocks()[0].dataset.type).toBe('Chapter');
    expect(save()).toBe(text);
  });

  it('reads preamble macros and theorem names', () => {
    expect(macrosOf('\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\norm}[1]{\\|#1\\|}\n\\DeclareMathOperator{\\tr}{tr}')).toEqual({
      R: '\\mathbb{R}',
      norm: { args: 1, def: '\\|#1\\|' },
      tr: '\\operatorname{tr}',
    });
    expect(theoremsOf('\\newtheorem{hyp}{Hypothesis}').hyp).toBe('Hypothesis');
  });

  it('turns accents and quotes into characters', () => {
    const { blocks } = load("Universit\\'e de ``Paris'' -- Orsay\n");
    expect(blocks()[0].textContent).toBe('Université de \u201cParis\u201d -- Orsay');
  });
});

describe('LyX-style editor: tables', () => {
  const TABLE = String.raw`\begin{table}[h]
\centering
\begin{tabular}{|l|c|r|}
\hline
Name & \multicolumn{2}{c|}{Score} \\ \hline\hline
Ann & $x^2$ & \textbf{9} \\[2pt]
\cline{2-3}
Bob & 1 & 2 \\
\hline
\end{tabular}
\caption{Results}
\end{table}
`;
  const tab = (ed: HTMLElement) => ed.querySelector<HTMLElement>('[data-inset="Tabular"]')!;
  const cells = (ed: HTMLElement) => [...tab(ed).querySelectorAll('tr')].map((tr) => [...tr.cells].map((td) => td.textContent));

  it('reads a tabular as a table inset and writes it back unchanged', () => {
    const { ed, save } = load(TABLE);
    expect(tab(ed).closest('[data-inset="Float"]')).not.toBeNull();
    expect(cells(ed)).toEqual([['Name', 'Score'], ['Ann', 'x^2', '9'], ['Bob', '1', '2']]);
    const [head, ann] = tab(ed).querySelectorAll('tr');
    expect(head.cells[1].colSpan).toBe(2);
    expect(ann.querySelector('math-field')).not.toBeNull();
    expect(head.cells[0].style.borderTop).toContain('solid');
    expect(head.cells[0].style.borderLeft).toContain('solid');
    expect(ann.cells[0].style.textAlign).toBe('left');
    expect(save()).toBe(TABLE);
  });

  it('writes an edited table with its rules and multicolumns', () => {
    const { ed, save } = load(TABLE);
    tab(ed).querySelectorAll('tr')[2].cells[0].querySelector('.ibody')!.textContent = 'Bo & Co';
    expect(save()).toContain(String.raw`\begin{tabular}{|l|c|r|}
\hline
Name & \multicolumn{2}{c|}{Score} \\
\hline \hline
Ann & $x^2$ & \textbf{9} \\[2pt]
\cline{2-3}
Bo \& Co & 1 & 2 \\
\hline
\end{tabular}`);
  });

  it('adds and deletes rows and columns', () => {
    const { ed, save } = load('\\begin{tabular}{|c|c|}\n\\hline\na & b \\\\\n\\hline\n\\end{tabular}\n');
    const t = tab(ed);
    const a = t.querySelector('td')!;
    tabularOp(t, a, 'append-row');
    tabularOp(t, a, 'append-column');
    expect(cells(ed)).toEqual([['a', '\u200B', 'b'], ['\u200B', '\u200B', '\u200B']]);
    expect(t.dataset.spec).toBe('|c|c|c|');
    tabularOp(t, t.querySelectorAll('tr')[1].cells[0], 'delete-row');
    tabularOp(t, a, 'delete-column');
    expect(cells(ed)).toEqual([['\u200B', 'b']]);
    expect(save()).toBe('\\begin{tabular}{|c|c|}\n\\hline\n & b \\\\\n\\hline\n\\end{tabular}\n');
  });

  it('shows symbol commands as glyphs and keeps the float\'s \\centering', () => {
    const src = '\\begin{table}[t]\n\\centering\n\\begin{tabular}{lc}\n\\toprule\nGR & \\checkmark \\\\\n\\bottomrule\n\\end{tabular}\n\\end{table}\n';
    const { ed, save } = load(src);
    expect(ed.querySelector('[data-inset="ERT"]')).toBeNull();
    expect(cells(ed)).toEqual([['GR', '\u2713']]);
    tab(ed).querySelector('td .ibody')!.textContent = 'General relativity';
    expect(save()).toBe(src.replace('GR', 'General relativity'));
  });

  it('keeps tables it cannot read as TeX code', () => {
    const { blocks, save } = load('\\begin{tabular}{cc\na & b\n');
    expect(blocks()[0].querySelector('[data-inset="Tabular"]')).toBeNull();
    expect(save()).toBe('\\begin{tabular}{cc\na & b\n');
  });
});

describe('graphicsPaths', () => {
  it('reads the \\graphicspath directories in order', () => {
    expect(graphicsPaths('\\usepackage{graphicx}\n\\graphicspath{{figures/}{./img/}}\n')).toEqual(['figures/', './img/']);
    expect(graphicsPaths('\\graphicspath{ {figs/} }')).toEqual(['figs/']);
  });
  it('ignores a commented-out \\graphicspath', () => {
    expect(graphicsPaths('% \\graphicspath{{old/}}\n')).toEqual([]);
    expect(graphicsPaths('no graphics here')).toEqual([]);
  });
});
