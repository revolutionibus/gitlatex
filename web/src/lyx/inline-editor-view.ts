/**
 * Footnotes and inline TeX code in the LyX-style editor: insets with text
 * inside a line of text. Browsers cannot put the caret inside an empty
 * inline element, so (as in ProseMirror's footnote example) each is an atom
 * with an editor of its own: selected (clicked, inserted, or reached with
 * the arrow keys) it opens for editing; Esc, or an arrow key past its edge,
 * goes back to the text around it. Its edits are steps of the main document,
 * so undo, saving and collaboration see them like any other.
 */
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { EditorView, type NodeView } from 'prosemirror-view';
import { StepMap } from 'prosemirror-transform';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { schema } from './schema';

export class InlineEditorView implements NodeView {
  dom: HTMLElement;
  private body: HTMLElement;
  private inner: EditorView | null = null;

  constructor(
    private node: PMNode,
    private outer: EditorView,
    private getPos: () => number | undefined,
  ) {
    const ert = node.type === schema.nodes.ert_inline;
    this.dom = document.createElement(ert ? 'code' : 'span');
    this.dom.className = ert ? 'lyx-ert-inline' : 'lyx-footnote';
    if (!ert) this.dom.dataset.kind = node.attrs.kind;
    this.body = document.createElement('span');
    this.body.className = 'lyx-inset-body';
    this.dom.appendChild(this.body);
    this.renderStatic();
  }

  /** The contents as they are shown while the inset is not being edited. */
  private renderStatic() {
    this.body.replaceChildren(DOMSerializer.fromSchema(schema).serializeFragment(this.node.content));
    this.dom.classList.toggle('lyx-inset-empty', this.node.content.size === 0);
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
    if (!this.inner) this.open();
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
    if (this.inner) this.close();
  }

  private open() {
    this.body.replaceChildren();
    const leave = (forward: boolean) => () => {
      const pos = this.getPos();
      if (pos == null) return false;
      const { state } = this.outer;
      const at = state.doc.resolve(forward ? pos + this.node.nodeSize : pos);
      this.outer.dispatch(state.tr.setSelection(Selection.near(at, forward ? 1 : -1)));
      this.outer.focus();
      return true;
    };
    const atEdge = (end: boolean) => (state: EditorState) => {
      const { $head, empty } = state.selection;
      return empty && (end ? $head.pos === state.doc.content.size : $head.pos === 0);
    };
    this.inner = new EditorView(this.body, {
      state: EditorState.create({
        doc: this.node,
        selection: Selection.atEnd(this.node),
        plugins: [
          keymap({
            // Undo and redo are the main document's.
            'Mod-z': () => undo(this.outer.state, this.outer.dispatch),
            'Mod-y': () => redo(this.outer.state, this.outer.dispatch),
            'Shift-Mod-z': () => redo(this.outer.state, this.outer.dispatch),
            Escape: leave(true),
            Enter: this.node.type === schema.nodes.ert_inline ? (s, d) => (d?.(s.tr.insertText('\n')), true) : leave(true),
            ArrowRight: (s) => atEdge(true)(s) && leave(true)(),
            ArrowLeft: (s) => atEdge(false)(s) && leave(false)(),
          }),
          keymap(baseKeymap),
        ],
      }),
      dispatchTransaction: (tr) => this.dispatchInner(tr),
      handleDOMEvents: {
        mousedown: () => {
          // Clicks inside go to this editor, not to the main one.
          if (this.outer.hasFocus()) this.inner?.focus();
          return false;
        },
      },
    });
    this.inner.focus();
  }

  private close() {
    this.inner?.destroy();
    this.inner = null;
    this.renderStatic();
  }

  /** An edit inside: applied here, and as the same steps (shifted) to the main document. */
  private dispatchInner(tr: Transaction) {
    if (!this.inner) return;
    const { state, transactions } = this.inner.state.applyTransaction(tr);
    this.inner.updateState(state);
    if (tr.getMeta('fromOutside')) return;
    const pos = this.getPos();
    if (pos == null) return;
    const outerTr = this.outer.state.tr;
    const offset = StepMap.offset(pos + 1);
    for (const t of transactions) for (const step of t.steps) outerTr.step(step.map(offset)!);
    if (outerTr.docChanged) this.outer.dispatch(outerTr);
  }

  update(node: PMNode) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    if (this.inner) {
      // A change from the main document (undo, a re-read file) reaches the open editor.
      const state = this.inner.state;
      const start = node.content.findDiffStart(state.doc.content);
      if (start != null) {
        let { a: endA, b: endB } = node.content.findDiffEnd(state.doc.content)!;
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) {
          endA += overlap;
          endB += overlap;
        }
        this.inner.dispatch(state.tr.replace(start, endB, node.slice(start, endA)).setMeta('fromOutside', true));
      }
    } else this.renderStatic();
    return true;
  }

  destroy() {
    if (this.inner) this.close();
  }

  stopEvent(e: Event) {
    return !!this.inner && this.inner.dom.contains(e.target as Node);
  }

  ignoreMutation() {
    return true;
  }
}
