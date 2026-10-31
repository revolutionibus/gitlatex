/**
 * Find & replace in the LyX-style editor (LyX's Edit → Find & Replace). The
 * search runs over the text of every paragraph, table cell, footnote and
 * TeX code box; matches are highlighted, and the current one is selected.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface FindQuery {
  text: string;
  caseSensitive: boolean;
  wholeWords: boolean;
}

interface FindState {
  query: FindQuery;
  matches: { from: number; to: number }[];
  /** The match the selection is on (or the next one after it), -1 for none. */
  current: number;
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>('lyx-find');

/** An object (a formula, a reference…) in a block's text: it matches nothing. */
const OBJECT = '￼';

/** Every match of `query` in `doc`. */
export function findMatches(doc: PMNode, query: FindQuery): { from: number; to: number }[] {
  if (!query.text) return [];
  const out: { from: number; to: number }[] = [];
  const needle = query.caseSensitive ? query.text : query.text.toLowerCase();
  const word = /[\p{L}\p{N}_]/u;
  doc.descendants((node, pos) => {
    if (!node.inlineContent) return true;
    // The block's text, and where each character is in the document.
    let text = '';
    const at: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let k = 0; k < child.text!.length; k++) at.push(pos + 1 + offset + k);
        text += child.text;
      } else {
        at.push(pos + 1 + offset);
        text += OBJECT;
      }
    });
    const hay = query.caseSensitive ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + Math.max(1, needle.length))) {
      const end = i + needle.length;
      if (query.wholeWords && ((i > 0 && word.test(hay[i - 1])) || (end < hay.length && word.test(hay[end])))) continue;
      out.push({ from: at[i], to: at[end - 1] + 1 });
    }
    // Footnotes inside the block have text of their own.
    return true;
  });
  return out;
}

function build(doc: PMNode, query: FindQuery, selFrom: number): FindState {
  const matches = findMatches(doc, query);
  let current = matches.findIndex((m) => m.from >= selFrom);
  if (current < 0 && matches.length) current = 0;
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, k) => Decoration.inline(m.from, m.to, { class: k === current ? 'lyx-find lyx-find-current' : 'lyx-find' })),
  );
  return { query, matches, current, decorations };
}

const EMPTY: FindQuery = { text: '', caseSensitive: false, wholeWords: false };

export function findPlugin() {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ query: EMPTY, matches: [], current: -1, decorations: DecorationSet.empty }),
      apply(tr, old, _oldState, state) {
        const query = tr.getMeta(findKey) as FindQuery | undefined;
        if (query) return build(state.doc, query, state.selection.from);
        if (!old.query.text) return old;
        if (tr.docChanged) return build(state.doc, old.query, state.selection.from);
        if (tr.selectionSet) {
          // The match at the selection becomes the current one.
          const k = old.matches.findIndex((m) => m.from === state.selection.from && m.to === state.selection.to);
          if (k >= 0 && k !== old.current) return { ...build(state.doc, old.query, state.selection.from), current: k };
        }
        return old;
      },
    },
    props: {
      decorations(state) {
        return findKey.getState(state)?.decorations;
      },
    },
  });
}

/** Search for `query` (empty to stop highlighting). */
export const setQuery =
  (query: FindQuery): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.setMeta(findKey, query));
    return true;
  };

/** Select the next (or previous) match, wrapping around the document. */
export function findNext(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const f = findKey.getState(state);
    if (!f?.matches.length) return false;
    const { from, to } = state.selection;
    let k: number;
    if (dir > 0) {
      k = f.matches.findIndex((m) => m.from >= to && !(m.from === from && m.to === to));
      if (k < 0) k = 0;
    } else {
      k = -1;
      f.matches.forEach((m, i) => {
        if (m.to <= from && !(m.from === from && m.to === to)) k = i;
      });
      if (k < 0) k = f.matches.length - 1;
    }
    if (dispatch) dispatch(select(state, f.matches[k]));
    return true;
  };
}

const select = (state: EditorState, m: { from: number; to: number }): Transaction => state.tr.setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView();

/** Replace the selected match and select the next one (LyX: Replace). */
export function replaceOne(replacement: string): Command {
  return (state, dispatch) => {
    const f = findKey.getState(state);
    if (!f?.matches.length) return false;
    const { from, to } = state.selection;
    const on = f.matches.find((m) => m.from === from && m.to === to);
    // Not on a match yet: go to the next one first, as LyX does.
    if (!on) return findNext(1)(state, dispatch);
    if (dispatch) {
      const tr = state.tr.insertText(replacement, on.from, on.to);
      const next = findMatches(tr.doc, f.query).find((m) => m.from >= on.from + replacement.length) ?? findMatches(tr.doc, f.query)[0];
      if (next) tr.setSelection(TextSelection.create(tr.doc, next.from, next.to));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Replace every match (one undo step); returns how many. */
export function replaceAll(state: EditorState, dispatch: (tr: Transaction) => void, replacement: string): number {
  const f = findKey.getState(state);
  if (!f?.matches.length) return 0;
  const tr = state.tr;
  // Last first, so the earlier positions stay right.
  for (const m of [...f.matches].reverse()) tr.insertText(replacement, m.from, m.to);
  dispatch(tr);
  return f.matches.length;
}
