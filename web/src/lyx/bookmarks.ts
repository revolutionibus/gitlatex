/**
 * LyX's bookmarks (Navigate → Bookmarks): five numbered places in the file,
 * saved with Ctrl+Shift+1…5 and gone back to with Alt+1…5. They move with
 * the text as it is edited, show as a small number at their place, and are
 * kept per file (as a paragraph number and offset) for the next visit.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** A bookmark's place that survives the file being read again: the top-level block and the offset in it. */
interface Address {
  block: number;
  offset: number;
}

type Marks = Map<number, number>;

export const bookmarksKey = new PluginKey<Marks>('lyx-bookmarks');

const storageKey = (file: string) => `gitlatex.lyx.bookmarks:${file}`;

function load(file: string, doc: PMNode): Marks {
  const out: Marks = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(file)) ?? '{}') as Record<string, Address>;
    for (const [n, a] of Object.entries(saved)) {
      if (a.block >= doc.childCount) continue;
      let pos = 0;
      for (let k = 0; k < a.block; k++) pos += doc.child(k).nodeSize;
      out.set(Number(n), Math.min(pos + a.offset, pos + doc.child(a.block).nodeSize - 1));
    }
  } catch {
    // Nothing saved, or not readable: no bookmarks.
  }
  return out;
}

function save(file: string, doc: PMNode, marks: Marks) {
  const out: Record<string, Address> = {};
  for (const [n, pos] of marks) {
    const $pos = doc.resolve(Math.min(pos, doc.content.size));
    const block = $pos.index(0);
    out[n] = { block, offset: pos - $pos.posAtIndex(block, 0) };
  }
  try {
    if (marks.size) localStorage.setItem(storageKey(file), JSON.stringify(out));
    else localStorage.removeItem(storageKey(file));
  } catch {
    // Storage full or blocked: the bookmarks last for this visit.
  }
}

type Meta = { set: number; pos: number } | { clear: true };

/** The bookmarks of `file`. */
export function bookmarksPlugin(file: string) {
  return new Plugin<Marks>({
    key: bookmarksKey,
    state: {
      init: (_, state) => load(file, state.doc),
      apply(tr, old, _o, state) {
        const meta = tr.getMeta(bookmarksKey) as Meta | undefined;
        let marks = old;
        if (tr.docChanged) {
          marks = new Map();
          for (const [n, pos] of old) {
            const r = tr.mapping.mapResult(pos);
            if (!r.deleted) marks.set(n, r.pos);
          }
        }
        if (meta) {
          marks = 'clear' in meta ? new Map() : new Map(marks).set(meta.set, meta.pos);
        }
        if (meta || (tr.docChanged && old.size)) save(file, state.doc, marks);
        return marks;
      },
    },
    props: {
      decorations(state) {
        const marks = bookmarksKey.getState(state);
        if (!marks?.size) return null;
        return DecorationSet.create(
          state.doc,
          [...marks].map(([n, pos]) =>
            Decoration.widget(pos, () => {
              const el = document.createElement('span');
              el.className = 'lyx-bookmark';
              el.textContent = String(n);
              el.title = `Bookmark ${n} (Alt+${n})`;
              return el;
            }, { side: -1, key: `bm${n}`, ignoreSelection: true }),
          ),
        );
      },
    },
  });
}

/** Save bookmark `n` at the cursor. */
export const saveBookmark = (state: EditorState, n: number): Transaction => state.tr.setMeta(bookmarksKey, { set: n, pos: state.selection.head });

/** The transaction going to bookmark `n`, or null if it is not set. */
export function gotoBookmark(state: EditorState, n: number): Transaction | null {
  const pos = bookmarksKey.getState(state)?.get(n);
  if (pos == null) return null;
  return state.tr.setSelection(Selection.near(state.doc.resolve(Math.min(pos, state.doc.content.size)))).scrollIntoView();
}

export const clearBookmarks = (state: EditorState): Transaction => state.tr.setMeta(bookmarksKey, { clear: true });

/** The bookmarks that are set, with the text where each is. */
export function bookmarkList(state: EditorState): { n: number; text: string }[] {
  const marks = bookmarksKey.getState(state);
  if (!marks) return [];
  return [...marks]
    .sort((a, b) => a[0] - b[0])
    .map(([n, pos]) => {
      const $pos = state.doc.resolve(Math.min(pos, state.doc.content.size));
      return { n, text: $pos.parent.textContent.slice(0, 50) };
    });
}
