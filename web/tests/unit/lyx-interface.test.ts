import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { readTex } from '../../src/lyx/tex-reader';
import { writeTex } from '../../src/lyx/tex-writer';
import { findKey, findMatches, findNext, findPlugin, replaceAll, replaceOne, setQuery } from '../../src/lyx/find';
import { bookmarkList, bookmarksPlugin, gotoBookmark, saveBookmark } from '../../src/lyx/bookmarks';
import { completions, parseCommand, runCommand, type LfunContext } from '../../src/lyx/lfuns';
import { readHead, writeHead } from '../../src/lyx/DocumentSettings';
import { plainText } from '../../src/lyx/export';

const doc = (body: string) => `\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\n\\begin{document}\n${body}\\end{document}\n`;

function editor(tex: string, plugins: Plugin[] = [findPlugin()]) {
  const read = readTex(tex);
  let state = EditorState.create({ doc: read.doc, plugins });
  const dispatch = (tr: Parameters<EditorView['dispatch']>[0]) => (state = state.apply(tr));
  return { read, get state() { return state; }, dispatch, tex: () => writeTex(read, state.doc) };
}

describe('LyX-style find & replace', () => {
  const tex = doc('\\section{Cats}\nA cat sat. Cats \\emph{cat}alogue $cat$.\n\n\\begin{itemize}\n\\item One cat\\footnote{The cat.}\n\\end{itemize}\n');

  it('finds text in paragraphs, items and footnotes, but not inside formulas', () => {
    const e = editor(tex);
    expect(findMatches(e.state.doc, { text: 'cat', caseSensitive: false, wholeWords: false })).toHaveLength(6);
    expect(findMatches(e.state.doc, { text: 'cat', caseSensitive: true, wholeWords: false })).toHaveLength(4);
    expect(findMatches(e.state.doc, { text: 'cat', caseSensitive: false, wholeWords: true })).toHaveLength(3);
  });

  it('goes to the next match and replaces one, then all', () => {
    const e = editor(tex);
    setQuery({ text: 'cat', caseSensitive: true, wholeWords: true })(e.state, e.dispatch);
    expect(findKey.getState(e.state)!.matches).toHaveLength(3);
    findNext(1)(e.state, e.dispatch);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe('cat');
    replaceOne('dog')(e.state, e.dispatch);
    expect(e.tex()).toContain('A dog sat.');
    expect(replaceAll(e.state, e.dispatch, 'dog')).toBe(2);
    expect(e.tex()).toContain('\\item One dog\\footnote{The dog.}');
    expect(e.tex()).toContain('$cat$');
  });
});

describe('LyX-style command buffer', () => {
  const ctx = (state: () => EditorState, dispatch: (tr: never) => void, log: string[] = []) =>
    ({
      get view() {
        return { state: state(), dispatch, focus: () => undefined } as unknown as EditorView;
      },
      theorems: () => ({}),
      toggle: (p: string) => log.push(`toggle ${p}`),
      isOpen: () => false,
      bookmarkGoto: () => false,
    }) as unknown as LfunContext;

  it('reads a command line: the longest name, then its argument', () => {
    expect(parseCommand('layout Section')).toMatchObject({ lfun: { name: 'layout' }, arg: 'Section' });
    expect(parseCommand('dialog-toggle view-source')).toMatchObject({ lfun: { name: 'dialog-toggle view-source' }, arg: '' });
    expect(parseCommand('no-such-thing')).toBeNull();
  });

  it('completes names, then arguments', () => {
    const e = editor(doc('Text.\n'));
    const c = ctx(() => e.state, e.dispatch as never);
    expect(completions('font-e', c)).toEqual(['font-emph']);
    expect(completions('layout Subs', c).sort()).toEqual(['layout Subsection', 'layout Subsection*', 'layout Subsubsection', 'layout Subsubsection*']);
    expect(completions('tabular-feature append-', c)).toEqual(['tabular-feature append-row', 'tabular-feature append-column']);
  });

  it('runs a command on the editor', () => {
    const e = editor(doc('Intro text.\n'));
    e.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)));
    const log: string[] = [];
    const c = ctx(() => e.state, e.dispatch as never, log);
    expect(runCommand('layout section', c)).toBe(true);
    expect(e.tex()).toContain('\\section{Intro text.}');
    expect(runCommand('dialog-toggle toc', c)).toBe(true);
    expect(log).toEqual(['toggle outline']);
    // In no table: nothing to do.
    expect(runCommand('tabular-feature append-row', c)).toBe(false);
  });
});

describe('LyX-style document settings', () => {
  it('reads and writes the class, options and preamble, keeping the body', () => {
    const tex = doc('Body.\n');
    const head = readHead(tex)!;
    expect(head).toEqual({ docClass: 'article', options: '11pt', preamble: '\\usepackage{amsmath}\n' });
    const out = writeHead(tex, { docClass: 'report', options: 'a4paper', preamble: '\\usepackage{amsmath}\n\\usepackage{xcolor}' });
    expect(out).toBe('\\documentclass[a4paper]{report}\n\\usepackage{amsmath}\n\\usepackage{xcolor}\n\\begin{document}\nBody.\n\\end{document}\n');
    expect(readHead('Just a chapter.\n')).toBeNull();
  });
});

describe('LyX-style export and bookmarks', () => {
  it('exports plain text with LyX\'s numbering', () => {
    const e = editor(doc('\\section{Intro}\nSee \\cite{knuth} and $x^2$.\n\n\\begin{enumerate}\n\\item First\n\\item Second\n\\end{enumerate}\n% not printed\n'));
    expect(plainText(e.state.doc, e.read.theorems)).toBe('1 Intro\n\nSee [knuth] and x^2.\n\n1. First\n\n2. Second\n');
  });

  it('keeps a bookmark on its text while text before it changes', () => {
    localStorage.clear();
    const e = editor(doc('First paragraph.\n\nSecond paragraph.\n'), [bookmarksPlugin('test:main.tex')]);
    let at = -1;
    e.state.doc.descendants((n, pos) => {
      if (n.isText && n.text!.startsWith('Second')) at = pos;
    });
    e.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, at)));
    e.dispatch(saveBookmark(e.state, 2));
    e.dispatch(e.state.tr.insertText('Inserted. ', 1));
    e.dispatch(gotoBookmark(e.state, 2)!);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.from + 6)).toBe('Second');
    expect(bookmarkList(e.state)).toEqual([{ n: 2, text: 'Second paragraph.' }]);
    // Kept for the next visit.
    const again = editor(e.tex(), [bookmarksPlugin('test:main.tex')]);
    expect(bookmarkList(again.state)).toEqual([{ n: 2, text: 'Second paragraph.' }]);
  });
});
