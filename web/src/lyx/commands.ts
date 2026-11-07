/**
 * Editing commands of the LyX-style editor, as ProseMirror commands: layouts,
 * nesting, moving paragraphs and sections, Enter, text styles, special
 * characters and inserting formulas and TeX code.
 */
import type { MarkType, Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { isEnvKind, layout as layoutNamed, type Theorems } from './layouts';
import { schema } from './schema';

type Theorem = () => Theorems;

/** The top-level blocks the selection touches: [index, position, node]. */
function selectedBlocks(state: EditorState): [number, number, PMNode][] {
  const { from, to } = state.selection;
  const out: [number, number, PMNode][] = [];
  state.doc.forEach((node, pos, index) => {
    if (pos + node.nodeSize > from && pos <= to) out.push([index, pos, node]);
  });
  // An empty selection between blocks (gap cursor) still means the block it is at.
  if (!out.length) {
    const $from = state.selection.$from;
    const index = Math.min($from.index(0), state.doc.childCount - 1);
    let pos = 0;
    for (let k = 0; k < index; k++) pos += state.doc.child(k).nodeSize;
    out.push([index, pos, state.doc.child(index)]);
  }
  return out;
}

const isPar = (n: PMNode | null | undefined): n is PMNode => n?.type === schema.nodes.paragraph;
/** Text goes into paragraphs and table cells. */
const takesInline = (n: PMNode | null | undefined) => n?.type === schema.nodes.paragraph || n?.type === schema.nodes.table_cell;
const depthOf = (n: PMNode) => (n.attrs.depth as number) ?? 0;

/** Give every selected paragraph layout `name`. */
export function setLayout(name: string): Command {
  return (state, dispatch) => {
    // Paragraphs at any depth: a caption inside a float too.
    const blocks: [number, number, PMNode][] = [];
    state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => {
      if (isPar(n)) blocks.push([0, pos, n]);
      return !isPar(n);
    });
    if (!blocks.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const [, pos, n] of blocks) {
        if (n.attrs.layout === name) continue;
        // The environment-specific attributes only make sense for the layout they came with.
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, layout: name, env: null, envOpt: null, envPre: null, item: null });
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Nest the selected blocks one level deeper (dir 1) or less deep (-1). As in
 * LyX, a block can be at most one level deeper than the block before it.
 */
export function changeDepth(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const blocks = selectedBlocks(state);
    const tr = state.tr;
    let changed = false;
    for (const [index, pos, n] of blocks) {
      const prev = index > 0 ? tr.doc.child(index - 1) : null;
      const max = prev ? depthOf(prev) + 1 : 0;
      const depth = Math.max(0, Math.min(max, depthOf(n) + dir));
      if (depth === depthOf(n)) continue;
      tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...n.attrs, depth });
      changed = true;
    }
    if (!changed) return false;
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Swap the block range [start, end) with the block before it (dir -1) or after it (1), keeping the selection on it. */
function moveRange(state: EditorState, start: number, end: number, dir: 1 | -1, otherEnd: number, dispatch?: (tr: Transaction) => void) {
  const doc = state.doc;
  const posOf = (i: number) => {
    let p = 0;
    for (let k = 0; k < i; k++) p += doc.child(k).nodeSize;
    return p;
  };
  // The neighbouring range [a, b) that changes places with ours.
  const [a, b] = dir === -1 ? [otherEnd, start] : [end, otherEnd];
  const from = posOf(Math.min(a, start));
  const to = posOf(Math.max(b, end));
  const moved = doc.slice(posOf(start), posOf(end)).content;
  const other = doc.slice(posOf(a), posOf(b)).content;
  if (dispatch) {
    const tr = state.tr.replaceWith(from, to, dir === -1 ? moved.append(other) : other.append(moved));
    const { anchor, head } = state.selection;
    const shift = dir === -1 ? -other.size : other.size;
    const sel = TextSelection.between(tr.doc.resolve(anchor + shift), tr.doc.resolve(head + shift));
    dispatch(tr.setSelection(sel).scrollIntoView());
  }
  return true;
}

/** Move the current paragraph (or block) up or down by one. */
export function moveParagraph(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const blocks = selectedBlocks(state);
    const start = blocks[0][0];
    const end = blocks[blocks.length - 1][0] + 1;
    if (dir === -1 ? start === 0 : end >= state.doc.childCount) return false;
    return moveRange(state, start, end, dir, dir === -1 ? start - 1 : end + 1, dispatch);
  };
}

/** Heading level of block `n` (lower is higher), or null. */
function headingLevel(n: PMNode, theorems: Theorems): number | null {
  if (!isPar(n)) return null;
  const l = layoutNamed(n.attrs.layout, theorems);
  return l.kind === 'heading' ? l.level! : null;
}

/** The section around block `index`: its heading and everything up to the next heading of the same or a higher level. */
function sectionAt(doc: PMNode, index: number, theorems: Theorems): [number, number] | null {
  let start = index;
  while (start >= 0 && headingLevel(doc.child(start), theorems) == null) start--;
  if (start < 0) return null;
  const level = headingLevel(doc.child(start), theorems)!;
  let end = start + 1;
  while (end < doc.childCount && (headingLevel(doc.child(end), theorems) ?? Infinity) > level) end++;
  return [start, end];
}

/** Move the section the cursor is in, with everything in it, before the previous section or after the next one. */
export function moveSection(dir: 1 | -1, theorems: Theorem): Command {
  return (state, dispatch) => {
    const t = theorems();
    const here = sectionAt(state.doc, selectedBlocks(state)[0][0], t);
    if (!here) return false;
    const [start, end] = here;
    const level = headingLevel(state.doc.child(start), t)!;
    if (dir === -1) {
      // The previous sibling section starts at the previous heading of the same or a higher level.
      let prev = start - 1;
      while (prev >= 0 && (headingLevel(state.doc.child(prev), t) ?? Infinity) > level) prev--;
      if (prev < 0 || headingLevel(state.doc.child(prev), t) !== level) return false;
      return moveRange(state, start, end, -1, prev, dispatch);
    }
    if (end >= state.doc.childCount || headingLevel(state.doc.child(end), t) !== level) return false;
    const next = sectionAt(state.doc, end, t)!;
    return moveRange(state, start, end, 1, next[1], dispatch);
  };
}

/** Promote (dir -1: subsection → section) or demote (1) the section the cursor is in, with its subsections. */
export function shiftSection(dir: 1 | -1, theorems: Theorem): Command {
  return (state, dispatch) => {
    const t = theorems();
    const here = sectionAt(state.doc, selectedBlocks(state)[0][0], t);
    if (!here) return false;
    const [start, end] = here;
    const names = ['Part', 'Chapter', 'Section', 'Subsection', 'Subsubsection', 'Paragraph', 'Subparagraph'];
    const tr = state.tr;
    let pos = 0;
    for (let k = 0; k < start; k++) pos += state.doc.child(k).nodeSize;
    for (let k = start; k < end; k++) {
      const n = state.doc.child(k);
      const level = headingLevel(n, t);
      if (level != null) {
        const next = level + dir;
        if (next < 0 || next >= names.length) return false;
        const starred = String(n.attrs.layout).endsWith('*');
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, layout: names[next] + (starred ? '*' : '') });
      }
      pos += n.nodeSize;
    }
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/** The layout a new paragraph after `p` gets: lists and environments go on; anything else is followed by Standard. */
function nextLayout(p: PMNode, theorems: Theorems, inverse = false) {
  const keep = isEnvKind(layoutNamed(p.attrs.layout, theorems));
  return (inverse ? !keep : keep) ? p.attrs.layout : 'Standard';
}

/**
 * Enter, as in LyX. A new paragraph that keeps a list's or environment's
 * layout and depth (another item), Standard after anything else. Enter on an
 * empty item or environment paragraph steps out: one level up into the
 * enclosing list or environment, or back to Standard.
 * With `inverse` (Alt+Enter) the other choice is made: leave a list in one step.
 */
export function lyxEnter(theorems: Theorem, inverse = false): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const p = $from.parent;
    if (!isPar(p) || !$from.sameParent($to)) return false;
    const t = theorems();
    const depth = depthOf(p);
    if (!dispatch) return true;
    if (!inverse && p.content.size === 0 && isEnvKind(layoutNamed(p.attrs.layout, t))) {
      const pos = $from.before();
      const index = $from.index(0);
      let outer: PMNode | null = null;
      for (let k = index - 1; k >= 0; k--) {
        const b = state.doc.child(k);
        if (depthOf(b) < depth) {
          outer = b;
          break;
        }
      }
      const layout = depth > 0 && isPar(outer) && depthOf(outer) === depth - 1 && isEnvKind(layoutNamed(outer.attrs.layout, t)) ? outer.attrs.layout : 'Standard';
      dispatch(state.tr.setNodeMarkup(pos, undefined, { ...p.attrs, layout, depth: Math.max(0, depth - 1), startsEnv: false, item: null }));
      return true;
    }
    const tr = state.tr.deleteSelection();
    tr.split(tr.mapping.map($from.pos), 1, [{ type: schema.nodes.paragraph, attrs: { layout: nextLayout(p, t, inverse), depth } }]);
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * A text style, as LyX applies it: on the selection, or with nothing
 * selected, on what is typed next.
 */
export function toggleStyle(type: MarkType): Command {
  return (state, dispatch) => {
    const { empty, $cursor, ranges } = state.selection as TextSelection;
    if (empty && $cursor) {
      if (dispatch) dispatch(state.tr[type.isInSet(state.storedMarks ?? $cursor.marks()) ? 'removeStoredMark' : 'addStoredMark'](type.create()));
      return true;
    }
    const has = ranges.some((r) => state.doc.rangeHasMark(r.$from.pos, r.$to.pos, type));
    if (dispatch) {
      const tr = state.tr;
      for (const r of ranges) tr[has ? 'removeMark' : 'addMark'](r.$from.pos, r.$to.pos, type.create());
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Back to the default font: no emphasis, bold, small caps, typewriter… (links stay). */
export const defaultFont: Command = (state, dispatch) => {
  const types = Object.values(schema.marks).filter((m) => m !== schema.marks.href);
  if (dispatch) {
    const tr = state.tr;
    const { from, to, empty } = state.selection;
    if (empty) types.forEach((t) => tr.removeStoredMark(t));
    else types.forEach((t) => tr.removeMark(from, to, t));
    dispatch(tr);
  }
  return true;
};

/** Insert text at the cursor (a protected space, an ellipsis…). */
export const insertText =
  (text: string): Command =>
  (state, dispatch) => {
    if (dispatch) dispatch(state.tr.insertText(text).scrollIntoView());
    return true;
  };

/** Insert an inline node (a line break, TeX code) at the cursor. */
export const insertInline =
  (node: () => PMNode): Command =>
  (state, dispatch) => {
    if (!takesInline(state.selection.$from.parent)) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node(), true).scrollIntoView());
    return true;
  };

/**
 * A formula at the cursor: inline ($…$) or display (\[…\], or `env`). The
 * selected text, if any, becomes its LaTeX. The new formula is selected, so
 * its node view puts the cursor in it.
 */
export function insertMath(display: false | string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    // A display formula does not go in a table cell.
    if (display ? !isPar($from.parent) : !takesInline($from.parent)) return false;
    const latex = state.doc.textBetween(state.selection.from, state.selection.to, ' ');
    if (!dispatch) return true;
    let tr = state.tr;
    if (!display) {
      tr = tr.replaceSelectionWith(schema.nodes.math_inline.create({ latex }), false);
      const pos = tr.selection.from - 1;
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView());
      return true;
    }
    // A display formula is part of its paragraph: it sits between the text
    // before and after it, written without blank lines (joinPrev).
    tr = tr.deleteSelection();
    const at = tr.selection.$from;
    const p = at.parent;
    const depth = depthOf(p) + (isEnvKind(layoutNamed(p.attrs.layout, {})) ? 1 : 0);
    const formula = (joinPrev: boolean) => schema.nodes.math_display.create({ latex, env: display, depth, joinPrev });
    let pos: number;
    if (p.content.size === 0) {
      // An empty paragraph becomes the formula.
      pos = at.before();
      tr.replaceWith(pos, at.after(), formula(p.attrs.joinPrev));
    } else if (at.parentOffset === p.content.size) {
      pos = at.after();
      tr.insert(pos, formula(true));
    } else if (at.parentOffset === 0) {
      // Before the text: the formula takes the paragraph's place, the text continues after it.
      pos = at.before();
      tr.setNodeMarkup(pos, undefined, { ...p.attrs, joinPrev: true });
      tr.insert(pos, formula(p.attrs.joinPrev));
    } else {
      // In the middle: split, and the second half continues after the formula.
      // The spaces at the split go: the formula is on lines of its own.
      let a = at.pos;
      let b = at.pos;
      while (a > at.start() && tr.doc.textBetween(a - 1, a) === ' ') a--;
      while (b < at.end() && tr.doc.textBetween(b, b + 1) === ' ') b++;
      if (b > a) tr.delete(a, b);
      tr.split(a, 1, [{ type: schema.nodes.paragraph, attrs: { layout: 'Standard', depth, joinPrev: true } }]);
      pos = a + 1;
      tr.insert(pos, formula(true));
    }
    dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView());
    return true;
  };
}

/** Turn the selected display formula into a numbered one, or back (Alt+M N). */
export const toggleNumbering: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type !== schema.nodes.math_display) return false;
  const env = sel.node.attrs.env as string;
  const unnumbered = env === '\\[' || env === '$$' || env.endsWith('*') || env === 'displaymath';
  const next = unnumbered ? (env.endsWith('*') ? env.slice(0, -1) : 'equation') : env === 'equation' ? '\\[' : `${env}*`;
  if (dispatch) dispatch(state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, env: next, label: unnumbered ? sel.node.attrs.label : null }));
  return true;
};

/**
 * TeX code at the cursor (Ctrl+L): inline in a paragraph, holding the
 * selected text, with the cursor inside it.
 */
export const insertTexCode: Command = (state, dispatch) => {
  const { $from, from, to } = state.selection;
  if (!takesInline($from.parent)) return false;
  if (!dispatch) return true;
  const text = state.doc.textBetween(from, to, ' ');
  const node = schema.nodes.ert_inline.create(null, text ? schema.text(text) : null);
  const tr = state.tr.replaceSelectionWith(node, false);
  // Selected, the box opens for typing (inline-editor-view.ts).
  dispatch(tr.setSelection(NodeSelection.create(tr.doc, tr.selection.from - node.nodeSize)).scrollIntoView());
  return true;
};

// ---- insets --------------------------------------------------------------------------------

/**
 * A footnote (or margin note) at the cursor, holding the selected text, with
 * the cursor inside it.
 */
export function insertFootnote(kind: 'footnote' | 'marginpar' = 'footnote'): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!takesInline($from.parent) || !$from.sameParent($to)) return false;
    if (!dispatch) return true;
    const content = state.selection.content().content.firstChild?.content ?? null;
    const node = schema.nodes.footnote.create({ kind }, content);
    const tr = state.tr.replaceSelectionWith(node, false);
    // Selected, the footnote opens for typing (inline-editor-view.ts).
    dispatch(tr.setSelection(NodeSelection.create(tr.doc, tr.selection.from - node.nodeSize)).scrollIntoView());
    return true;
  };
}

/** A LyX note (not printed) after the current block, or in place of an empty paragraph, with the cursor in it. */
export const insertNote: Command = (state, dispatch) => {
  const [[, pos, node]] = selectedBlocks(state);
  if (!dispatch) return true;
  const note = schema.nodes.note.create({ depth: node.attrs.depth ?? 0 });
  const empty = isPar(node) && node.content.size === 0;
  const at = empty ? pos : pos + node.nodeSize;
  const tr = empty ? state.tr.replaceWith(pos, pos + node.nodeSize, note) : state.tr.insert(at, note);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
  return true;
};

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 3)
    .join('-');

/**
 * The label LyX would suggest where the cursor is: `sec:` + the heading's
 * words in a section, `eq:` for a formula, `fig:`/`tab:` in a float, `thm:`
 * and friends in a theorem.
 */
export function suggestLabel(state: EditorState, theorems: Theorems): string {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type === schema.nodes.math_display) return 'eq:';
  const $h = sel.$head;
  for (let d = $h.depth; d > 0; d--) {
    const n = $h.node(d);
    if (n.type === schema.nodes.float) return String(n.attrs.env).startsWith('table') ? 'tab:' : 'fig:';
  }
  const p = $h.parent;
  if (!isPar(p)) return '';
  const l = layoutNamed(p.attrs.layout, theorems);
  const words = slug(p.textContent);
  if (l.kind === 'heading') {
    const prefix = ['part', 'chap', 'sec', 'subsec', 'subsubsec', 'par', 'subpar'][l.level!];
    return `${prefix}:${words}`;
  }
  if (l.theorem) return `${{ Theorem: 'thm', Lemma: 'lem', Corollary: 'cor', Proposition: 'prop', Definition: 'def', Remark: 'rem', Example: 'ex' }[l.name] ?? slug(l.name)}:${words}`;
  if (isEnvKind(l) && l.kind === 'item') return 'item:';
  return '';
}

/**
 * Label the place the cursor is: a selected display formula gets it as its
 * label (and a number); in a heading, caption or theorem it goes at the end
 * of the paragraph, as LyX puts it; elsewhere at the cursor.
 */
export function insertLabel(name: string, theorems: Theorem): Command {
  return (state, dispatch) => {
    if (!name) return false;
    const sel = state.selection;
    if (sel instanceof NodeSelection && sel.node.type === schema.nodes.math_display) {
      const env = sel.node.attrs.env as string;
      const numbered = env === '\\[' || env === '$$' || env === 'displaymath' ? 'equation' : env.replace(/\*$/, '');
      if (dispatch) dispatch(state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, label: name, env: numbered }));
      return true;
    }
    const $h = sel.$head;
    if (!isPar($h.parent)) return false;
    if (!dispatch) return true;
    const l = layoutNamed($h.parent.attrs.layout, theorems());
    const atEnd = l.kind === 'heading' || l.kind === 'front' || !!l.theorem;
    const node = schema.nodes.label.create({ name });
    dispatch((atEnd ? state.tr.insert($h.end(), node) : state.tr.replaceSelectionWith(node, false)).scrollIntoView());
    return true;
  };
}

/** Rename label `from` to `to`, with every reference to it (as LyX does). */
export function renameLabel(from: string, to: string): Command {
  return (state, dispatch) => {
    if (!to || to === from) return false;
    const tr = state.tr;
    state.doc.descendants((n, pos) => {
      if (n.type === schema.nodes.label && n.attrs.name === from) tr.setNodeMarkup(pos, undefined, { name: to });
      else if (n.type === schema.nodes.math_display && n.attrs.label === from) tr.setNodeMarkup(pos, undefined, { ...n.attrs, label: to });
      else if (n.type === schema.nodes.ref) {
        const keys = String(n.attrs.key).split(',').map((k) => k.trim());
        if (keys.includes(from)) tr.setNodeMarkup(pos, undefined, { ...n.attrs, key: keys.map((k) => (k === from ? to : k)).join(',') });
      }
    });
    if (!tr.docChanged) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

/** Where label `name` is defined in the document (a label inset or a formula's label), or -1. */
export function findLabel(doc: PMNode, name: string): number {
  let at = -1;
  doc.descendants((n, pos) => {
    if (at >= 0) return false;
    if ((n.type === schema.nodes.label && n.attrs.name === name) || (n.type === schema.nodes.math_display && n.attrs.label === name)) at = pos;
    return true;
  });
  return at;
}

/** A URL inset at the cursor (\url{…}). */
export const insertUrl =
  (url: string): Command =>
  (state, dispatch) =>
    insertInline(() => schema.nodes.url.create({ url }))(state, dispatch);

/** Make the selected text a hyperlink (\href); with nothing selected, insert the address as a link. */
export function insertHyperlink(url: string): Command {
  return (state, dispatch) => {
    if (!url || !takesInline(state.selection.$from.parent)) return false;
    if (!dispatch) return true;
    const mark = schema.marks.href.create({ url });
    const { from, to, empty } = state.selection;
    dispatch((empty ? state.tr.insert(from, schema.text(url, [mark])) : state.tr.addMark(from, to, mark)).scrollIntoView());
    return true;
  };
}

/** Align the selected paragraphs: center, flushleft, flushright, or null for the default. */
export function setAlign(align: 'center' | 'flushleft' | 'flushright' | null): Command {
  return (state, dispatch) => {
    const pars: [number, PMNode][] = [];
    state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => {
      if (isPar(n)) pars.push([pos, n]);
      return !isPar(n);
    });
    if (!pars.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const [pos, n] of pars) tr.setNodeMarkup(pos, undefined, { ...n.attrs, align });
      dispatch(tr);
    }
    return true;
  };
}
