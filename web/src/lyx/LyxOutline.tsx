/**
 * LyX's outline pane (View → Outline): the document's sections, numbered,
 * with its figures and tables. Click an entry to go there; the arrows move
 * the section at the cursor up or down, or promote and demote it, with
 * everything under it (LyX's outline-up / -down / -out / -in).
 */
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Image, Table2, X } from 'lucide-react';
import { clsx } from '../components/ui';
import { layout as layoutNamed, type Theorems } from './layouts';
import { numberBlocks } from './numbering';
import { schema } from './schema';

interface Entry {
  pos: number;
  level: number;
  label: string;
  text: string;
  kind: 'heading' | 'figure' | 'table';
}

function entries(view: EditorView, theorems: Theorems): Entry[] {
  const { doc } = view.state;
  const numbers = numberBlocks(doc, theorems);
  const out: Entry[] = [];
  const floats = { figure: 0, table: 0 };
  doc.forEach((b, pos, i) => {
    if (b.type === schema.nodes.paragraph) {
      const l = layoutNamed(b.attrs.layout, theorems);
      if (l.kind === 'heading') out.push({ pos, level: l.level ?? 0, label: numbers[i]?.label ?? '', text: b.textContent || '(empty)', kind: 'heading' });
    } else if (b.type === schema.nodes.float) {
      const kind = String(b.attrs.env).startsWith('table') ? 'table' : 'figure';
      const n = ++floats[kind];
      let caption = '';
      b.descendants((c) => {
        if (!caption && c.type === schema.nodes.paragraph && c.attrs.layout === 'Caption') caption = c.textContent;
        return !caption;
      });
      out.push({ pos, level: 9, label: `${kind === 'table' ? 'Table' : 'Figure'} ${n}`, text: caption, kind });
    }
  });
  return out;
}

export function LyxOutline({ view, theorems, onRun, onClose }: { view: EditorView; theorems: Theorems; onRun(line: string): void; onClose(): void }) {
  const list = entries(view, theorems);
  const head = view.state.selection.head;
  // The section the cursor is in: the last heading before it.
  let current = -1;
  list.forEach((e, k) => {
    if (e.kind === 'heading' && e.pos <= head) current = k;
  });
  const minLevel = Math.min(...list.filter((e) => e.kind === 'heading').map((e) => e.level), 9);
  const go = (e: Entry) => {
    const inside = e.pos + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(inside))).scrollIntoView());
    view.focus();
    // Put the heading at the top of the view, not just in it.
    const dom = view.nodeDOM(e.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start' });
  };
  const tool = (label: string, line: string, icon: React.ReactNode) => (
    <button type="button" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={() => onRun(line)} className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
      {icon}
    </button>
  );
  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-line bg-panel-2/40" aria-label="Outline">
      <div className="flex h-8 items-center gap-0.5 border-b border-line px-2">
        <span className="mr-auto text-[11px] font-semibold uppercase tracking-wider text-muted">Outline</span>
        {tool('Move section up (Alt+P ↑)', 'outline-up', <ArrowUp className="size-3.5" />)}
        {tool('Move section down (Alt+P ↓)', 'outline-down', <ArrowDown className="size-3.5" />)}
        {tool('Promote section (Alt+P ←)', 'outline-out', <ArrowLeft className="size-3.5" />)}
        {tool('Demote section (Alt+P →)', 'outline-in', <ArrowRight className="size-3.5" />)}
        <button type="button" title="Close the outline" aria-label="Close the outline" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1 text-[12.5px]">
        {!list.length && <li className="px-3 py-2 text-faint">No sections, figures or tables yet.</li>}
        {list.map((e, k) => (
          <li key={`${e.pos}`}>
            <button
              type="button"
              onClick={() => go(e)}
              title={e.text}
              style={{ paddingLeft: `${0.6 + (e.kind === 'heading' ? e.level - minLevel : 1) * 0.9}rem` }}
              className={clsx('flex w-full items-center gap-1.5 truncate py-0.5 pr-2 text-left hover:bg-hover', k === current ? 'bg-accent/10 text-fg' : e.kind === 'heading' ? 'text-fg' : 'text-muted')}
            >
              {e.kind === 'figure' && <Image className="size-3 shrink-0" />}
              {e.kind === 'table' && <Table2 className="size-3 shrink-0" />}
              {e.label && <span className="shrink-0 tabular-nums text-faint">{e.label}{e.kind !== 'heading' ? ':' : ''}</span>}
              <span className="truncate">{e.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
