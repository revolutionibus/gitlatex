/**
 * The ProseMirror schema of the LyX-style editor.
 *
 * Blocks follow LyX: every paragraph is one `paragraph` node whose `layout`
 * attribute says what it is (Standard, Section, Itemize, Theorem…) and whose
 * `depth` nests it under the paragraphs before it. Display formulas and TeX
 * code boxes are blocks of their own. Inline content is text with marks
 * (emphasis, bold…) and inline nodes: formulas, TeX code, footnotes, labels,
 * references, citations and URLs.
 */
import { Schema, type DOMOutputSpec, type Node as PMNode } from 'prosemirror-model';

const depthAttrs = {
  depth: { default: 0 },
  /** Written right after the block before it, without a blank line (text around a display formula). */
  joinPrev: { default: false },
};

/** How a table's rules show: '' none, '1' a line, '2' a double line, 'thick' (booktabs top and bottom), 'part' (\cline). */
export function ruleKind(rules: string | null): string {
  if (!rules) return '';
  const full = rules.match(/\\(hline|toprule|midrule|bottomrule|specialrule)\b/g) ?? [];
  if (full.length > 1) return '2';
  if (full.length) return /\\(toprule|bottomrule)/.test(full[0]!) ? 'thick' : '1';
  return /\\c(line|midrule)\b/.test(rules) ? 'part' : '';
}

const slug = (layout: string) => layout.toLowerCase().replace(/\*$/, '-star').replace(/[^a-z0-9-]/g, '');

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        layout: { default: 'Standard' },
        ...depthAttrs,
        /** The environment it was written in, when not its layout's usual one (`thm` for Theorem). */
        env: { default: null },
        /** The environment's optional argument: a theorem's title, a list's [options]. */
        envOpt: { default: null },
        /** TeX between \begin{…} and the first paragraph or \item (comments, \setlength…). */
        envPre: { default: null },
        /** A description item's term, or an \item[…] label. */
        item: { default: null },
        /** Starts a new environment even when the paragraph before has the same layout. */
        startsEnv: { default: false },
        /** center / flushleft / flushright (LaTeX's environments of those names); null is the default. */
        align: { default: null },
      },
      parseDOM: [
        {
          tag: 'div.lyx-par',
          getAttrs: (dom) => ({ layout: (dom as HTMLElement).dataset.layout ?? 'Standard', depth: Number((dom as HTMLElement).dataset.depth ?? 0) }),
        },
        { tag: 'p' },
      ],
      toDOM: (node): DOMOutputSpec => [
        'div',
        {
          class: `lyx-par lyx-l-${slug(node.attrs.layout)}`,
          'data-layout': node.attrs.layout,
          'data-depth': String(node.attrs.depth),
          ...(node.attrs.startsEnv ? { 'data-starts-env': '' } : {}),
          ...(node.attrs.item ? { 'data-item': node.attrs.item } : {}),
          ...(node.attrs.envOpt ? { 'data-env-opt': node.attrs.envOpt } : {}),
          ...(node.attrs.align ? { 'data-align': node.attrs.align } : {}),
          style: `--lyx-depth: ${node.attrs.depth}`,
        },
        0,
      ],
    },

    /** A display formula: \[…\], equation, align… */
    math_display: {
      group: 'block',
      atom: true,
      attrs: {
        latex: { default: '' },
        /** `\[` for \[…\], `$$` for $$…$$, else the environment (equation, align*…). */
        env: { default: '\\[' },
        label: { default: null },
        ...depthAttrs,
      },
      toDOM: (node): DOMOutputSpec => ['div', { class: 'lyx-display', 'data-env': node.attrs.env, style: `--lyx-depth: ${node.attrs.depth}` }, node.attrs.latex],
    },

    /** LaTeX kept as written (LyX's "TeX code" / ERT inset), as a block. */
    ert_block: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { ...depthAttrs },
      parseDOM: [{ tag: 'pre.lyx-ert', preserveWhitespace: 'full' }],
      toDOM: (node): DOMOutputSpec => ['pre', { class: 'lyx-ert', style: `--lyx-depth: ${node.attrs.depth}` }, ['code', 0]],
    },

    /** A LyX note: not printed. Written as % comment lines. */
    note: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { ...depthAttrs },
      parseDOM: [{ tag: 'div.lyx-note', preserveWhitespace: 'full' }],
      toDOM: (node): DOMOutputSpec => ['div', { class: 'lyx-note', style: `--lyx-depth: ${node.attrs.depth}` }, ['div', { class: 'lyx-note-body' }, 0]],
    },

    /** A figure or table float: its contents (graphics, a table, a caption) in a box. */
    float: {
      group: 'block',
      content: 'block+',
      defining: true,
      isolating: true,
      attrs: {
        /** figure, table, figure*… */
        env: { default: 'figure' },
        /** Placement: [t], [ht]… without the brackets. */
        placement: { default: null },
        /** How its lines are indented in the file, kept for the lines written again. */
        indent: { default: '' },
        ...depthAttrs,
      },
      parseDOM: [{ tag: 'div.lyx-float' }],
      toDOM: (node): DOMOutputSpec => ['div', { class: 'lyx-float', 'data-env': node.attrs.env, style: `--lyx-depth: ${node.attrs.depth}` }, 0],
    },

    /**
     * A tabular, edited cell by cell (prosemirror-tables). Its column spec is
     * kept as columns (table.ts) so columns can be added and aligned.
     */
    table: {
      group: 'block',
      content: 'table_row+',
      tableRole: 'table',
      isolating: true,
      attrs: {
        /** tabular, tabular*, tabularx. */
        env: { default: 'tabular' },
        /** The width argument of tabular* and tabularx. */
        width: { default: null },
        /** [t], [b]… without the brackets. */
        pos: { default: null },
        /** The columns: the separators before each (| @{…}) and the column itself (l, >{…}p{3cm}…). */
        cols: { default: [] },
        /** Separators after the last column. */
        tail: { default: '' },
        /** Rules after the last row (\hline, \bottomrule…). */
        bottom: { default: null },
        /** How its rows are indented under \begin{tabular}, kept for the rows written again. */
        indent: { default: '' },
        align: { default: null },
        ...depthAttrs,
      },
      parseDOM: [{ tag: 'table' }],
      toDOM: (node): DOMOutputSpec => [
        'div',
        { class: 'lyx-table', style: `--lyx-depth: ${node.attrs.depth}`, ...(node.attrs.align ? { 'data-align': node.attrs.align } : {}) },
        ['table', { 'data-bottom': ruleKind(node.attrs.bottom) }, ['tbody', 0]],
      ],
    },

    table_row: {
      content: 'table_cell+',
      tableRole: 'row',
      attrs: {
        /** Rules (and comments) written before the row: \hline, \midrule, \cline{2-3}… */
        rules: { default: null },
        /** What follows the row's \\ ([2pt], *); null for a last row written without \\. */
        endOpt: { default: '' },
      },
      parseDOM: [{ tag: 'tr' }],
      toDOM: (node): DOMOutputSpec => ['tr', { 'data-rule': ruleKind(node.attrs.rules) }, 0],
    },

    table_cell: {
      content: 'inline*',
      tableRole: 'cell',
      isolating: true,
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        /** The \multicolumn it was read from: its span and column spec. */
        mc: { default: null },
      },
      parseDOM: [
        { tag: 'td', getAttrs: (dom) => ({ colspan: Number((dom as HTMLElement).getAttribute('colspan') ?? 1) }) },
        { tag: 'th', getAttrs: (dom) => ({ colspan: Number((dom as HTMLElement).getAttribute('colspan') ?? 1) }) },
      ],
      toDOM: (node): DOMOutputSpec => ['td', node.attrs.colspan > 1 ? { colspan: String(node.attrs.colspan) } : {}, 0],
    },

    text: { group: 'inline' },

    /** \\ inside a paragraph. */
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: (): DOMOutputSpec => ['br'],
    },

    /** $…$ or \(…\). */
    math_inline: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { latex: { default: '' }, delim: { default: '$' } },
      toDOM: (node): DOMOutputSpec => ['span', { class: 'lyx-math' }, node.attrs.latex],
    },

    /** LaTeX kept as written, inside a paragraph. */
    ert_inline: {
      inline: true,
      group: 'inline',
      // Edited in an editor of its own (inline-editor-view.ts): browsers cannot type into an empty inline box.
      atom: true,
      content: 'text*',
      marks: '',
      code: true,
      parseDOM: [{ tag: 'code.lyx-ert-inline', preserveWhitespace: 'full' }],
      toDOM: (): DOMOutputSpec => ['code', { class: 'lyx-ert-inline' }, 0],
    },

    /** A footnote, or a margin note (`kind: 'marginpar'`). */
    footnote: {
      inline: true,
      group: 'inline',
      atom: true,
      content: 'inline*',
      attrs: { kind: { default: 'footnote' } },
      parseDOM: [{ tag: 'span.lyx-footnote' }],
      toDOM: (node): DOMOutputSpec => ['span', { class: 'lyx-footnote', 'data-kind': node.attrs.kind }, 0],
    },

    /** \includegraphics[options]{path}. */
    graphics: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { path: { default: '' }, options: { default: null } },
      toDOM: (node): DOMOutputSpec => ['span', { class: 'lyx-graphics', title: node.attrs.path }, node.attrs.path],
    },

    label: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { name: { default: '' } },
      toDOM: (node): DOMOutputSpec => ['span', { class: 'lyx-label', title: 'Label' }, node.attrs.name],
    },

    ref: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { cmd: { default: 'ref' }, key: { default: '' } },
      toDOM: (node): DOMOutputSpec => ['span', { class: 'lyx-ref', title: `\\${node.attrs.cmd}` }, node.attrs.key],
    },

    cite: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { cmd: { default: 'cite' }, keys: { default: '' }, pre: { default: null }, post: { default: null } },
      toDOM: (node): DOMOutputSpec => ['span', { class: 'lyx-cite', title: `\\${node.attrs.cmd}` }, node.attrs.keys],
    },

    url: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { url: { default: '' } },
      toDOM: (node): DOMOutputSpec => ['span', { class: 'lyx-url' }, node.attrs.url],
    },
  },

  marks: {
    emph: { parseDOM: [{ tag: 'em' }], toDOM: () => ['em', 0] },
    italic: { parseDOM: [{ tag: 'i' }], toDOM: () => ['i', 0] },
    bold: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    noun: { parseDOM: [{ tag: 'span.lyx-noun' }], toDOM: () => ['span', { class: 'lyx-noun' }, 0] },
    typewriter: { parseDOM: [{ tag: 'tt' }], toDOM: () => ['tt', 0] },
    sans: { parseDOM: [{ tag: 'span.lyx-sans' }], toDOM: () => ['span', { class: 'lyx-sans' }, 0] },
    underline: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
    href: {
      attrs: { url: { default: '' } },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ url: (dom as HTMLElement).getAttribute('href') }) }],
      toDOM: (mark) => ['a', { href: mark.attrs.url, class: 'lyx-href', title: mark.attrs.url, rel: 'noopener noreferrer' }, 0],
    },
  },
});

/** The LaTeX command for each mark, outermost first when several apply. */
export const MARK_COMMANDS: Record<string, string> = {
  emph: 'emph', italic: 'textit', bold: 'textbf', noun: 'textsc', typewriter: 'texttt', sans: 'textsf', underline: 'underline',
};

export type Node = PMNode;
