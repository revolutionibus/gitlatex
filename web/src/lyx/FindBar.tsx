/**
 * The find & replace bar of the LyX-style editor (Ctrl+F). Enter finds the
 * next match, Shift+Enter the one before; Esc closes it and goes back to
 * the text with the match selected.
 */
import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { clsx } from '../components/ui';
import { findKey, findNext, replaceAll, replaceOne, setQuery } from './find';

export function FindBar({ view, onClose, status }: { view: EditorView; onClose(): void; status(message: string): void }) {
  // Start from the selected text, as LyX does.
  const [text, setText] = useState(() => {
    const { from, to } = view.state.selection;
    const sel = view.state.doc.textBetween(from, to, ' ');
    return sel.includes('\n') ? '' : sel;
  });
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const [wholeWords, setWhole] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    setQuery({ text, caseSensitive, wholeWords })(view.state, view.dispatch);
  }, [text, caseSensitive, wholeWords, view]);
  // Highlights go when the bar closes.
  useEffect(() => () => void (!view.isDestroyed && setQuery({ text: '', caseSensitive: false, wholeWords: false })(view.state, view.dispatch)), [view]);

  const f = findKey.getState(view.state);
  const count = f?.matches.length ?? 0;
  const close = () => {
    onClose();
    view.focus();
  };
  const next = (dir: 1 | -1) => {
    if (!findNext(dir)(view.state, view.dispatch)) status(text ? `“${text}” is not in the document` : '');
  };
  const keys = (e: React.KeyboardEvent, replace: boolean) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (replace) replaceOne(replacement)(view.state, view.dispatch);
      else next(e.shiftKey ? -1 : 1);
    }
  };
  const field = 'focus-ring h-6 w-48 rounded border border-line bg-panel-2 px-2 text-[12.5px] text-fg placeholder:text-faint';
  const toggle = (on: boolean) => clsx('h-6 rounded px-1.5 text-[11.5px]', on ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-hover');

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel-2/60 px-2 py-1" role="search" aria-label="Find and replace">
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => keys(e, false)} placeholder="Find" aria-label="Find" className={field} />
      <span className="w-16 text-[11.5px] text-faint" data-testid="lyx-find-count">
        {text ? (count ? `${(f!.current >= 0 ? f!.current : 0) + 1} of ${count}` : 'no matches') : ''}
      </span>
      <button type="button" title="Previous (Shift+Enter)" aria-label="Previous match" onClick={() => next(-1)} className="rounded p-1 text-muted hover:bg-hover"><ChevronUp className="size-3.5" /></button>
      <button type="button" title="Next (Enter)" aria-label="Next match" onClick={() => next(1)} className="rounded p-1 text-muted hover:bg-hover"><ChevronDown className="size-3.5" /></button>
      <button type="button" aria-pressed={caseSensitive} title="Match case" aria-label="Match case" onClick={() => setCase(!caseSensitive)} className={toggle(caseSensitive)}>Aa</button>
      <button type="button" aria-pressed={wholeWords} title="Whole words" aria-label="Whole words" onClick={() => setWhole(!wholeWords)} className={toggle(wholeWords)}>“w”</button>
      <span className="mx-1 h-4 w-px bg-line" />
      <input value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => keys(e, true)} placeholder="Replace with" aria-label="Replace with" className={field} />
      <button type="button" disabled={!count} onClick={() => replaceOne(replacement)(view.state, view.dispatch)} className="h-6 rounded px-2 text-[12px] text-muted hover:bg-hover disabled:opacity-40">
        Replace
      </button>
      <button
        type="button"
        disabled={!count}
        onClick={() => status(`Replaced ${replaceAll(view.state, view.dispatch, replacement)} × “${text}”`)}
        className="h-6 rounded px-2 text-[12px] text-muted hover:bg-hover disabled:opacity-40"
      >
        All
      </button>
      <div className="flex-1" />
      <button type="button" title="Close (Esc)" aria-label="Close find" onClick={close} className="rounded p-1 text-muted hover:bg-hover"><X className="size-3.5" /></button>
    </div>
  );
}
