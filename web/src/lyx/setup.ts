/**
 * The ProseMirror plugins of the LyX-style editor: LyX's keyboard and typing
 * rules (keys.ts), history, tables (table.ts), and the numbering LyX shows
 * (sections, items, theorems, formulas, footnotes).
 */
import { baseKeymap, chainCommands, newlineInCode } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { tableEditing } from 'prosemirror-tables';
import { cellLooks, enterInCell, tabInTable, verticalInCell } from './table';
import type { Theorems } from './layouts';
import { numberBlocks } from './numbering';
import { schema } from './schema';
import { lyxEnter } from './commands';
import { lyxKeys, type KeyHost } from './keys';

/** Numbers and environment starts, as data attributes the stylesheet shows. */
function numbering(theorems: () => Theorems) {
  const build = (doc: PMNode) => {
    const decos: Decoration[] = [];
    const numbers = numberBlocks(doc, theorems());
    doc.forEach((child, offset, i) => {
      const n = numbers[i];
      const attrs: Record<string, string> = {};
      if (n.label != null) attrs['data-num'] = n.label;
      if (n.envStart) attrs['data-env-start'] = '';
      if (Object.keys(attrs).length) decos.push(Decoration.node(offset, offset + child.nodeSize, attrs));
    });
    let footnotes = 0;
    doc.descendants((node, pos) => {
      if (node.type === schema.nodes.footnote && node.attrs.kind !== 'marginpar') decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': String(++footnotes) }));
    });
    // Captions: "Figure 1:", "Table 2:", counted per kind as LaTeX does.
    const floats = { figure: 0, table: 0 };
    doc.forEach((child, offset) => {
      if (child.type !== schema.nodes.float) return;
      const kind = String(child.attrs.env).startsWith('table') ? 'table' : 'figure';
      const n = ++floats[kind];
      child.descendants((node, pos) => {
        if (node.type === schema.nodes.paragraph && node.attrs.layout === 'Caption') {
          const at = offset + 1 + pos;
          decos.push(Decoration.node(at, at + node.nodeSize, { 'data-num': `${kind === 'table' ? 'Table' : 'Figure'} ${n}:` }));
        }
      });
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/** Each table cell's alignment and vertical lines, from its column spec. */
function tableLooks() {
  const build = (doc: PMNode) => {
    const decos: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type !== schema.nodes.table) return node.type === schema.nodes.float || node.type === schema.nodes.doc;
      for (const c of cellLooks(node)) {
        const at = pos + 1 + c.pos;
        const cell = node.nodeAt(c.pos)!;
        const cls = [c.left && 'lyx-vl', c.right && 'lyx-vr'].filter(Boolean).join(' ');
        decos.push(Decoration.node(at, at + cell.nodeSize, { style: `text-align: ${c.align}`, ...(cls ? { class: cls } : {}) }));
      }
      return false;
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/** The editor's plugins; `extra` are the pane's own (find, bookmarks). */
export function plugins(theorems: () => Theorems, host: KeyHost, extra: Plugin[] = []): Plugin[] {
  return [
    // In a table, Tab, Enter and Up/Down move between cells (before LyX's own Tab and Enter).
    keymap({
      Tab: tabInTable(1),
      'Shift-Tab': tabInTable(-1),
      Enter: enterInCell,
      ArrowUp: verticalInCell(-1),
      ArrowDown: verticalInCell(1),
    }),
    ...lyxKeys(theorems, host),
    history(),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      Enter: chainCommands(newlineInCode, lyxEnter(theorems)),
    }),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    numbering(theorems),
    tableLooks(),
    tableEditing(),
    ...extra,
  ];
}
