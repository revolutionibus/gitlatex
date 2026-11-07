/**
 * Document → Export → Plain text: the document as LyX writes it as text,
 * with section and item numbers, formulas as LaTeX, citations and
 * references in brackets, tables as tab-separated rows. Notes (not
 * printed) and TeX code are left out.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { layout as layoutNamed, type Theorems } from './layouts';
import { numberBlocks } from './numbering';

function inlineText(node: PMNode): string {
  let out = '';
  node.forEach((c) => {
    if (c.isText) out += c.text;
    else
      switch (c.type.name) {
        case 'math_inline':
          out += c.attrs.latex;
          break;
        case 'hard_break':
          out += '\n';
          break;
        case 'footnote':
          out += ` [${inlineText(c)}]`;
          break;
        case 'cite':
          out += `[${c.attrs.keys}]`;
          break;
        case 'ref':
          out += `[${c.attrs.key}]`;
          break;
        case 'url':
          out += c.attrs.url;
          break;
        case 'graphics':
          out += `[${c.attrs.path}]`;
          break;
      }
  });
  return out.replace(/ /g, ' ');
}

function blockText(b: PMNode, label: string | null, theorems: Theorems): string {
  const indent = '  '.repeat(b.attrs.depth ?? 0);
  switch (b.type.name) {
    case 'paragraph': {
      const l = layoutNamed(b.attrs.layout, theorems);
      const text = inlineText(b);
      if (l.kind === 'heading') return `${label ? `${label} ` : ''}${text}`;
      if (b.attrs.item) return `${indent}${b.attrs.item} ${text}`;
      return `${indent}${label ? `${label} ` : ''}${text}`;
    }
    case 'math_display':
      return `${indent}    ${b.attrs.latex}${label ? `    ${label}` : ''}`;
    case 'table': {
      const rows: string[] = [];
      b.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(inlineText(cell)));
        rows.push(indent + cells.join('\t'));
      });
      return rows.join('\n');
    }
    case 'float': {
      const inner: string[] = [];
      b.forEach((c) => {
        const t = blockText(c, null, theorems);
        if (t.trim()) inner.push(t);
      });
      return inner.join('\n');
    }
    default:
      // Notes and TeX code are not part of the text.
      return '';
  }
}

export function plainText(doc: PMNode, theorems: Theorems): string {
  const numbers = numberBlocks(doc, theorems);
  const out: string[] = [];
  doc.forEach((b, _, i) => {
    const t = blockText(b, numbers[i]?.label ?? null, theorems);
    if (t.trim()) out.push(t);
  });
  return `${out.join('\n\n')}\n`;
}

/** Save `text` as a file named `name` (the browser's download). */
export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
