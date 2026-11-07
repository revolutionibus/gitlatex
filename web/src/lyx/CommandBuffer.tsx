/**
 * LyX's command buffer (Alt+X): type a LyX function and its argument
 * (`layout Section`, `tabular-feature append-row`, `bookmark-goto 2`) and
 * press Enter. Tab completes, ↑ ↓ pick a completion (or go through the
 * history when there are none), Esc goes back to the text.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from '../components/ui';
import { completions, lfunNamed, parseCommand, type LfunContext } from './lfuns';

const HISTORY = 'gitlatex.lyx.commands';
const history = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

export function CommandBuffer({ ctx, onRun, onClose }: { ctx: LfunContext; onRun(line: string): boolean; onClose(): void }) {
  const [line, setLine] = useState('');
  const [pick, setPick] = useState(-1);
  const [back, setBack] = useState(-1);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const options = useMemo(() => (line.trim() ? completions(line, ctx).slice(0, 12) : []), [line, ctx]);
  const parsed = parseCommand(line);

  const run = (text: string) => {
    const p = parseCommand(text);
    if (!p) return setError(`Unknown command: ${text.trim().split(' ')[0]}`);
    if (p.lfun.arg && !p.arg && p.lfun.args) return setError(`${p.lfun.name} needs ${p.lfun.arg}`);
    const past = [text.trim(), ...history().filter((h) => h !== text.trim())].slice(0, 30);
    localStorage.setItem(HISTORY, JSON.stringify(past));
    // The pane says in its status bar if the command cannot run here.
    onClose();
    onRun(text);
  };

  return (
    <div className="relative shrink-0 border-t border-line bg-panel-2" data-testid="lyx-command-buffer">
      {options.length > 0 && (
        <ul className="absolute bottom-full left-0 z-20 mb-px max-h-72 w-[min(34rem,100%)] overflow-y-auto rounded-t-md border border-line bg-panel py-1 text-[12.5px] shadow-pop" role="listbox">
          {options.map((o, k) => {
            const l = parseCommand(o)?.lfun ?? lfunNamed(o);
            return (
              <li
                key={o}
                role="option"
                aria-selected={k === pick}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setLine(o + (l?.arg && o === l.name ? ' ' : ''));
                  input.current?.focus();
                }}
                className={clsx('flex cursor-pointer items-center gap-3 px-3 py-1', k === pick ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-hover')}
              >
                <span className="font-mono text-fg">{o}</span>
                {l?.arg && o === l.name && <span className="font-mono text-faint">{l.arg}</span>}
                <span className="ml-auto truncate text-faint">{l?.label}</span>
                {l?.keys && <span className="shrink-0 text-[11px] text-faint">{l.keys}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex h-7 items-center gap-2 px-3">
        <span className="font-mono text-[12px] text-accent">M-x</span>
        <input
          ref={input}
          value={line}
          aria-label="LyX command"
          placeholder="layout Section, font-emph, bookmark-goto 1… (Tab completes)"
          spellCheck={false}
          onChange={(e) => {
            setLine(e.target.value);
            setPick(-1);
            setError('');
          }}
          onBlur={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(pick >= 0 ? options[pick] : line);
            } else if (e.key === 'Tab') {
              e.preventDefault();
              const choice = pick >= 0 ? options[pick] : options.length === 1 ? options[0] : commonPrefix(options) || line;
              const l = parseCommand(choice)?.lfun;
              setLine(choice + (l?.arg && choice === l.name ? ' ' : ''));
              setPick(-1);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              if (options.length) setPick((p) => (p + d + options.length) % options.length);
              else {
                const past = history();
                const k = Math.max(-1, Math.min(past.length - 1, back - d));
                setBack(k);
                setLine(k >= 0 ? past[k] : '');
              }
            }
          }}
          className="h-6 min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-fg outline-none placeholder:text-faint"
        />
        {error ? (
          <span className="shrink-0 text-[11.5px] text-danger">{error}</span>
        ) : (
          parsed && <span className="shrink-0 truncate text-[11.5px] text-faint">{parsed.lfun.label}</span>
        )}
      </div>
    </div>
  );
}

function commonPrefix(items: string[]): string {
  if (!items.length) return '';
  let p = items[0];
  for (const s of items) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}
