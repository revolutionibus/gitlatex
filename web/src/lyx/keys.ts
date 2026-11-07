/**
 * LyX's keyboard (its standard CUA bindings) for the LyX-style editor, and
 * LyX's typing rules.
 *
 * Some LyX shortcuts are sequences: Alt+P, release, then a key that picks a
 * paragraph layout (Alt+P S for Standard, Alt+P 2 for Section…); Alt+C for
 * fonts. The pending keys are shown in the status bar.
 */
import { keymap } from 'prosemirror-keymap';
import { chainCommands } from 'prosemirror-commands';
import { Plugin, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';
import type { Theorems } from './layouts';
import {
  changeDepth, defaultFont, insertFootnote, insertInline, insertMath, insertNote, insertTexCode, insertText, lyxEnter, moveParagraph, moveSection, setAlign, setLayout,
  shiftSection, toggleNumbering, toggleStyle,
} from './commands';
import { alignColumns } from './table';

/** Inserts that ask for something first (a name, an address, a picker). */
export type HostAction = 'label' | 'ref' | 'cite' | 'zotero' | 'url' | 'href' | 'graphics' | 'figure' | 'table';

/** What the keys need from the pane around the editor. */
export interface KeyHost {
  status(message: string): void;
  focusLayoutBox(): void;
  compile(): void;
  act(action: HostAction): void;
  /** Run a LyX function by its command line (lfuns.ts): `bookmark-save 1`. */
  lfun(line: string): boolean;
  /** The typing rules the user has on (Settings → Editor). */
  typing(): TypingPrefs;
}

/** LyX's typing rules, each of which can be turned off. */
export interface TypingPrefs {
  /** `$` starts a formula. */
  dollarMath: boolean;
  /** `"` gives typographic quotes. */
  smartQuotes: boolean;
  /** A space at a paragraph's start, or after another space, is ignored. */
  spaceRules: boolean;
}

const HEADINGS = ['Part', 'Chapter', 'Section', 'Subsection', 'Subsubsection', 'Paragraph', 'Subparagraph'];

/** A key as the sequence tables name it: `s`, `S`, `2`, `*`, `ArrowUp`, `Space`. */
function keyName(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.shiftKey ? e.code.slice(3) : e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code) && !e.shiftKey) return e.code.slice(5);
  if (e.key === ' ') return 'Space';
  return e.key;
}

const ert = (tex: string) => () => schema.nodes.ert_inline.create(null, schema.text(tex));

/** Remove the sans-serif and typewriter fonts (Alt+C R: back to roman). */
const roman: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (dispatch) {
    const tr = state.tr;
    for (const m of [schema.marks.sans, schema.marks.typewriter]) {
      if (empty) tr.removeStoredMark(m);
      else tr.removeMark(from, to, m);
    }
    dispatch(tr);
  }
  return true;
};

function sequences(theorems: () => Theorems, host: KeyHost): Record<string, Record<string, Command>> {
  const act = (action: HostAction): Command => () => (host.act(action), true);
  const P: Record<string, Command> = {
    s: setLayout('Standard'),
    i: setLayout('Itemize'),
    b: setLayout('Itemize'),
    e: setLayout('Enumerate'),
    n: setLayout('Enumerate'),
    d: setLayout('Description'),
    t: setLayout('Title'),
    A: setLayout('Author'),
    D: setLayout('Date'),
    a: setLayout('Abstract'),
    q: setLayout('Quote'),
    Q: setLayout('Quotation'),
    v: setLayout('Verse'),
    ArrowUp: moveSection(-1, theorems),
    ArrowDown: moveSection(1, theorems),
    ArrowLeft: shiftSection(-1, theorems),
    ArrowRight: shiftSection(1, theorems),
    Space: () => (host.focusLayoutBox(), true),
  };
  HEADINGS.forEach((h, level) => (P[String(level)] = setLayout(h)));
  const starred: Record<string, Command> = {};
  HEADINGS.forEach((h, level) => (starred[String(level)] = setLayout(`${h}*`)));
  return {
    P,
    'P*': starred,
    C: {
      c: toggleStyle(schema.marks.noun),
      s: toggleStyle(schema.marks.sans),
      r: roman,
      Space: defaultFont,
    },
    M: { n: toggleNumbering },
    // Insert: the letter underlined in LyX's Insert menu.
    I: {
      f: insertFootnote('footnote'),
      m: insertFootnote('marginpar'),
      n: insertNote,
      x: insertTexCode,
      l: act('label'),
      r: act('ref'),
      c: act('cite'),
      z: act('zotero'),
      u: act('url'),
      h: act('href'),
      g: act('graphics'),
      t: act('table'),
    },
    // Alignment: of the paragraph, or in a table of the column.
    A: {
      l: chainCommands(alignColumns('l'), setAlign('flushleft')),
      c: chainCommands(alignColumns('c'), setAlign('center')),
      r: chainCommands(alignColumns('r'), setAlign('flushright')),
      j: chainCommands(alignColumns('l'), setAlign(null)),
      e: chainCommands(alignColumns('l'), setAlign(null)),
    },
  };
}

/** The prefix keys and what they start. */
const PREFIXES: Record<string, string> = { KeyP: 'P', KeyC: 'C', KeyM: 'M', KeyI: 'I', KeyA: 'A' };
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

/** Alt+P, Alt+C, Alt+M sequences. */
function sequencePlugin(theorems: () => Theorems, host: KeyHost) {
  const table = sequences(theorems, host);
  let pending: string | null = null;
  return new Plugin({
    props: {
      handleKeyDown(view: EditorView, e: KeyboardEvent) {
        if (pending) {
          if (MODIFIERS.has(e.key)) return false;
          const prefix = pending;
          pending = null;
          if (e.key === 'Escape') return host.status(''), true;
          const key = keyName(e);
          if (prefix === 'P' && key === '*') {
            pending = 'P*';
            host.status('Alt+P * …  (0–6: unnumbered heading)');
            return true;
          }
          const cmd = table[prefix]?.[key];
          const label = `Alt+${prefix.replace('*', ' *')} ${key}`;
          if (!cmd) return host.status(`${label} is not a shortcut here`), true;
          host.status(cmd(view.state, view.dispatch, view) ? '' : `${label}: nothing to do here`);
          return true;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && PREFIXES[e.code]) {
          pending = PREFIXES[e.code];
          host.status(`Alt+${pending} …`);
          return true;
        }
        return false;
      },
    },
  });
}

/**
 * LyX's typing rules: a space at the start of a paragraph or after another
 * space is ignored (LaTeX would ignore it), `"` gives typographic quotes, and
 * `$` starts a formula.
 */
function typingRules(host: KeyHost) {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        const { state } = view;
        const $from = state.doc.resolve(from);
        // TeX code is typed as is.
        if ($from.parent.type.spec.code || !$from.parent.inlineContent) return false;
        const prefs = host.typing();
        if (text === ' ' && from === to && prefs.spaceRules) {
          const before = from > $from.start() ? state.doc.textBetween(from - 1, from, '\0', '\0') : '';
          if (from === $from.start()) return host.status('A paragraph does not start with a space: LaTeX ignores it'), true;
          if (before === ' ' || before === ' ') return host.status('Two spaces in a row are ignored, as in LaTeX. Use Ctrl+Space for a protected space.'), true;
        }
        if (text === '"' && prefs.smartQuotes) {
          const before = from > $from.start() ? state.doc.textBetween(from - 1, from, '\0', '\0') : '';
          const open = !before || /[\s([{—–-]/.test(before);
          view.dispatch(state.tr.insertText(open ? '“' : '”', from, to).scrollIntoView());
          return true;
        }
        if (text === '$' && prefs.dollarMath) return insertMath(false)(state, view.dispatch);
        return false;
      },
    },
  });
}

/** Ctrl+Shift+1…5 saves a bookmark, Alt+1…5 (or Ctrl+1…5 where the browser allows) goes back to it. */
function bookmarkKeys(host: KeyHost): Record<string, Command> {
  const keys: Record<string, Command> = {};
  for (let n = 1; n <= 5; n++) {
    keys[`Shift-Mod-${n}`] = () => host.lfun(`bookmark-save ${n}`);
    keys[`Alt-${n}`] = () => (host.lfun(`bookmark-goto ${n}`), true);
    keys[`Mod-${n}`] = () => (host.lfun(`bookmark-goto ${n}`), true);
  }
  return keys;
}

/** Keys that do nothing in LyX (Tab does not indent) say why. */
const explain =
  (host: KeyHost, message: string): Command =>
  () => (host.status(message), true);

/** The LyX-style editor's keyboard, before ProseMirror's own keys. */
export function lyxKeys(theorems: () => Theorems, host: KeyHost): Plugin[] {
  const compile: Command = () => (host.compile(), true);
  return [
    sequencePlugin(theorems, host),
    typingRules(host),
    keymap({
      'Mod-e': toggleStyle(schema.marks.emph),
      'Mod-b': toggleStyle(schema.marks.bold),
      'Mod-u': toggleStyle(schema.marks.underline),
      'Shift-Mod-p': toggleStyle(schema.marks.typewriter),
      'Mod-m': insertMath(false),
      'Shift-Mod-m': insertMath('\\['),
      'Mod-Alt-n': insertMath('equation'),
      'Mod-l': insertTexCode,
      'Mod-Enter': insertInline(() => schema.nodes.hard_break.create()),
      'Mod-Space': insertText(' '),
      'Alt-.': insertText('…'),
      'Mod-.': insertInline(ert('\\@.')),
      'Mod--': insertInline(ert('\\-')),
      'Alt-Enter': lyxEnter(theorems, true),
      'Shift-Alt-ArrowRight': changeDepth(1),
      'Shift-Alt-ArrowLeft': changeDepth(-1),
      'Alt-ArrowUp': moveParagraph(-1),
      'Alt-ArrowDown': moveParagraph(1),
      'Mod-s': compile,
      // LyX's command buffer, find, and bookmarks (run through lfuns.ts).
      'Alt-x': () => host.lfun('command-execute'),
      'Mod-f': () => host.lfun('dialog-show findreplace'),
      ...bookmarkKeys(host),
      F2: compile,
      Tab: explain(host, 'Tab does not indent in LyX: nesting comes from the layout and depth (Alt+Shift+→)'),
      'Shift-Tab': explain(host, 'Alt+Shift+← un-nests a paragraph'),
      'Mod-k': (state, dispatch) => {
        const { $head } = state.selection;
        if ($head.parent.type !== schema.nodes.paragraph) return false;
        if (dispatch) dispatch(state.tr.delete($head.pos, $head.end()));
        return true;
      },
    }),
  ];
}
