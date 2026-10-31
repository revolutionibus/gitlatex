/**
 * The LyX-style editor's toolbar: the ☰ menu, the layout box (the current
 * paragraph's layout, LyX's left-most control), undo, text styles, then
 * menus of related tools (formulas, lists, inserts, alignment) and the PDF.
 * Each entry names its LyX shortcut. In a table a second row of table tools
 * appears, as LyX's table toolbar does, and alignment is the column's.
 */
import type { RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { redo, undo } from 'prosemirror-history';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, BetweenHorizontalEnd, ChevronDown, Plus, TextQuote, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Bold, Crosshair, Grid3x3, ImagePlus,
  IndentDecrease, IndentIncrease, Italic, Link, List, ListOrdered, Play, Quote, Redo2, Sigma, SquareSigma, StickyNote, Table2, TableCellsMerge, TableCellsSplit, Tag,
  Trash2, Undo2, CornerDownRight,
} from 'lucide-react';
import { clsx, useMenu, type MenuItem } from '../components/ui';
import { LAYOUT_GROUPS, type Theorems } from './layouts';
import { schema } from './schema';
import { changeDepth, insertFootnote, insertMath, insertNote, insertTexCode, setAlign, setLayout, toggleStyle } from './commands';
import type { HostAction } from './keys';
import {
  addColumn, addRow, alignColumns, mergeInRow, removeColumns, removeRows, removeTable, splitMerged, tableInfo, toggleAllLines, toggleColumnLine, toggleRowLine,
} from './table';

const KNOWN = new Set(LAYOUT_GROUPS.flatMap(([, names]) => names));

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor's selection: the button acts on it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40',
        active && 'bg-accent/15 text-fg',
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-4 w-px shrink-0 bg-line" />;

/** A toolbar button that opens a menu of related tools (formulas, lists, inserts, alignment). */
function Drop({ label, icon, active, items }: { label: string; icon: React.ReactNode; active?: boolean; items: () => (MenuItem | 'separator')[] }) {
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        // Keep the editor's selection: the menu acts on it.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => menu.open(e, items(), true)}
        className={clsx(
          'flex h-7 items-center justify-center gap-0.5 rounded pl-1.5 pr-1 text-[12px] text-muted hover:bg-hover hover:text-fg',
          active && 'bg-accent/15 text-fg',
        )}
      >
        {icon}
        <ChevronDown className="size-3 opacity-70" />
      </button>
      {menu.node}
    </>
  );
}

export function LyxToolbar({
  view,
  theorems,
  layoutBox,
  onCompile,
  onShowInPdf,
  onAct,
  more,
}: {
  view: EditorView | null;
  theorems: Theorems;
  layoutBox: RefObject<HTMLSelectElement | null>;
  onCompile(): void;
  onShowInPdf(): void;
  onAct(action: HostAction): void;
  /** The ☰ menu, first (so it stays on the first row when the toolbar wraps). */
  more?: React.ReactNode;
}) {
  const state = view?.state;
  const run = (cmd: Command) => () => {
    if (!view) return;
    cmd(view.state, view.dispatch, view);
    view.focus();
  };
  const $head = state?.selection.$head;
  const par = $head?.parent.type === schema.nodes.paragraph ? $head.parent : null;
  const current = par?.attrs.layout ?? '';
  const marks = state ? (state.storedMarks ?? $head!.marks()) : [];
  const has = (name: keyof typeof schema.marks) => marks.some((m) => m.type === schema.marks[name]);
  const table = state ? tableInfo(state) : null;
  // The document's own theorem types (\newtheorem{hyp}{Hypothesis}) join the Reasoning group.
  const custom = [...new Set(Object.values(theorems))].filter((n) => !KNOWN.has(n)).sort();

  return (
    // Wraps onto a second row when narrow, like LyX's two toolbars.
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-0.5 border-b border-line bg-panel px-2 py-1" role="toolbar" aria-label="LyX editor">
      {more}
      <select
        ref={layoutBox}
        value={current}
        disabled={!par}
        onChange={(e) => {
          run(setLayout(e.target.value))();
        }}
        onKeyDown={(e) => e.key === 'Escape' && view?.focus()}
        title="Paragraph layout (Alt+P, then a key; Alt+P Space opens this box)"
        aria-label="Paragraph layout"
        className="focus-ring mr-1 h-7 w-32 shrink-0 rounded-md border border-line bg-panel-2 px-1.5 text-[12.5px] text-fg"
      >
        {!par && <option value="">—</option>}
        {par && !KNOWN.has(current) && !custom.includes(current) && <option value={current}>{current}</option>}
        {LAYOUT_GROUPS.map(([group, names]) => {
          const options = (group === 'Reasoning' ? [...names, ...custom] : names).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ));
          return group ? (
            <optgroup key={group} label={group}>
              {options}
            </optgroup>
          ) : (
            options
          );
        })}
      </select>

      <Btn label="Undo (Ctrl+Z)" onClick={run(undo)} disabled={!view}><Undo2 className="size-3.5" /></Btn>
      <Btn label="Redo (Ctrl+Y)" onClick={run(redo)} disabled={!view}><Redo2 className="size-3.5" /></Btn>
      <Sep />
      <Btn label="Emphasize (Ctrl+E)" active={has('emph')} onClick={run(toggleStyle(schema.marks.emph))}><Italic className="size-3.5" /></Btn>
      <Btn label="Small caps / noun (Alt+C C)" active={has('noun')} onClick={run(toggleStyle(schema.marks.noun))}>
        <span className="text-[11px] font-semibold [font-variant:small-caps]">Aa</span>
      </Btn>
      <Btn label="Bold (Ctrl+B)" active={has('bold')} onClick={run(toggleStyle(schema.marks.bold))}><Bold className="size-3.5" /></Btn>
      <Sep />
      <Drop
        label="Formula: inline, display, numbered; TeX code"
        icon={<Sigma className="size-3.5" />}
        items={() => [
          { label: 'Inline formula', shortcut: 'Ctrl+M or $', icon: <Sigma className="size-3.5" />, onSelect: run(insertMath(false)) },
          { label: 'Display formula', shortcut: 'Ctrl+Shift+M', icon: <SquareSigma className="size-3.5" />, onSelect: run(insertMath('\\[')) },
          { label: 'Numbered formula', shortcut: 'Ctrl+Alt+N', icon: <span className="text-[10px]">(1)</span>, onSelect: run(insertMath('equation')) },
          'separator',
          { label: 'TeX code', shortcut: 'Ctrl+L', icon: <span className="font-mono text-[9px] font-bold text-[var(--lyx-ert,#c0392b)]">TeX</span>, onSelect: run(insertTexCode) },
        ]}
      />
      <Drop
        label="Lists and nesting"
        icon={current === 'Enumerate' ? <ListOrdered className="size-3.5" /> : <List className="size-3.5" />}
        active={current === 'Itemize' || current === 'Enumerate' || current === 'Description'}
        items={() => [
          { label: current === 'Itemize' ? 'Bulleted list (off)' : 'Bulleted list', shortcut: 'Alt+P I', icon: <List className="size-3.5" />, onSelect: run(setLayout(current === 'Itemize' ? 'Standard' : 'Itemize')) },
          { label: current === 'Enumerate' ? 'Numbered list (off)' : 'Numbered list', shortcut: 'Alt+P E', icon: <ListOrdered className="size-3.5" />, onSelect: run(setLayout(current === 'Enumerate' ? 'Standard' : 'Enumerate')) },
          { label: current === 'Description' ? 'Description list (off)' : 'Description list', shortcut: 'Alt+P D', icon: <TextQuote className="size-3.5" />, onSelect: run(setLayout(current === 'Description' ? 'Standard' : 'Description')) },
          'separator',
          { label: 'Deeper: nest under the paragraph above', shortcut: 'Alt+Shift+→', icon: <IndentIncrease className="size-3.5" />, onSelect: run(changeDepth(1)) },
          { label: 'Less deep', shortcut: 'Alt+Shift+←', icon: <IndentDecrease className="size-3.5" />, onSelect: run(changeDepth(-1)) },
        ]}
      />
      <Drop
        label="Insert: footnote, note, label, reference, citation, link, figure, table"
        icon={<Plus className="size-3.5" />}
        items={() => [
          { label: 'Footnote', shortcut: 'Alt+I F', icon: <span className="text-[10px]">x<sup>2</sup></span>, onSelect: run(insertFootnote('footnote')) },
          { label: 'Margin note', shortcut: 'Alt+I M', icon: <span className="text-[10px]">⇥</span>, onSelect: run(insertFootnote('marginpar')) },
          { label: 'Note (not printed)', shortcut: 'Alt+I N', icon: <StickyNote className="size-3.5" />, onSelect: run(insertNote) },
          'separator',
          { label: 'Label…', shortcut: 'Alt+I L', icon: <Tag className="size-3.5" />, onSelect: () => onAct('label') },
          { label: 'Cross-reference…', shortcut: 'Alt+I R', icon: <CornerDownRight className="size-3.5" />, onSelect: () => onAct('ref') },
          { label: 'Citation…', shortcut: 'Alt+I C', icon: <Quote className="size-3.5" />, onSelect: () => onAct('cite') },
          { label: 'Citation from Zotero…', shortcut: 'Alt+I Z', icon: <span className="text-[11px] font-bold text-danger">Z</span>, onSelect: () => onAct('zotero') },
          'separator',
          { label: 'URL…', shortcut: 'Alt+I U', icon: <Link className="size-3.5" />, onSelect: () => onAct('url') },
          { label: 'Hyperlink on the selection…', shortcut: 'Alt+I H', icon: <Link className="size-3.5" />, onSelect: () => onAct('href') },
          'separator',
          { label: 'Figure…', shortcut: 'Alt+I G', icon: <ImagePlus className="size-3.5" />, onSelect: () => onAct('figure') },
          { label: 'Table…', shortcut: 'Alt+I T', icon: <Table2 className="size-3.5" />, onSelect: () => onAct('table') },
        ]}
      />
      {(() => {
        // In a table the alignment is the column's; elsewhere the paragraph's.
        const align = table ? table.align : par?.attrs.align === 'flushleft' ? 'left' : par?.attrs.align === 'center' ? 'center' : par?.attrs.align === 'flushright' ? 'right' : null;
        const Icon = align === 'center' ? AlignCenter : align === 'right' ? AlignRight : align === 'left' ? AlignLeft : AlignJustify;
        const what = table ? 'column' : 'paragraph';
        return (
          <Drop
            label={`Alignment of the ${what} (Alt+A …)`}
            icon={<Icon className="size-3.5" />}
            active={!table && align != null}
            items={() =>
              table
                ? [
                    { label: 'Column left', shortcut: 'Alt+A L', icon: <AlignLeft className="size-3.5" />, onSelect: run(alignColumns('l')) },
                    { label: 'Column centred', shortcut: 'Alt+A C', icon: <AlignCenter className="size-3.5" />, onSelect: run(alignColumns('c')) },
                    { label: 'Column right', shortcut: 'Alt+A R', icon: <AlignRight className="size-3.5" />, onSelect: run(alignColumns('r')) },
                  ]
                : [
                    { label: 'Left', shortcut: 'Alt+A L', icon: <AlignLeft className="size-3.5" />, disabled: !par, onSelect: run(setAlign('flushleft')) },
                    { label: 'Centred', shortcut: 'Alt+A C', icon: <AlignCenter className="size-3.5" />, disabled: !par, onSelect: run(setAlign('center')) },
                    { label: 'Right', shortcut: 'Alt+A R', icon: <AlignRight className="size-3.5" />, disabled: !par, onSelect: run(setAlign('flushright')) },
                    { label: 'Default (justified)', shortcut: 'Alt+A J', icon: <AlignJustify className="size-3.5" />, disabled: !par, onSelect: run(setAlign(null)) },
                  ]
            }
          />
        );
      })()}
      <div className="flex-1" />
      <Btn label="Show in PDF" onClick={onShowInPdf}><Crosshair className="size-3.5" /></Btn>
      <Btn label="View / Update: compile (Ctrl+S)" onClick={onCompile}><Play className="size-3.5" /></Btn>
      {table && (
        <div className="flex basis-full flex-wrap items-center gap-0.5 border-t border-line/60 pt-1" role="group" aria-label="Table">
          <span className="mr-1 text-[11.5px] text-faint">
            Table · row {table.row + 1}/{table.rows}, column {table.col + 1}/{table.cols}
          </span>
          <Btn label="Add row above" onClick={run(addRow(-1))}><BetweenHorizontalStart className="size-3.5" /></Btn>
          <Btn label="Add row below (Tab in the last cell, or Enter in the last row)" onClick={run(addRow(1))}><BetweenHorizontalEnd className="size-3.5" /></Btn>
          <Btn label="Delete row" onClick={run(removeRows)}><span className="text-[11px]">−row</span></Btn>
          <Sep />
          <Btn label="Add column left" onClick={run(addColumn(-1))}><BetweenVerticalStart className="size-3.5" /></Btn>
          <Btn label="Add column right" onClick={run(addColumn(1))}><BetweenVerticalEnd className="size-3.5" /></Btn>
          <Btn label="Delete column" onClick={run(removeColumns)}><span className="text-[11px]">−col</span></Btn>
          <Sep />
          <Btn label="Line above the row" active={table.lineAbove} onClick={run(toggleRowLine('top'))}><span className="lyx-tb-line" data-side="top" /></Btn>
          <Btn label="Line below the row" active={table.lineBelow} onClick={run(toggleRowLine('bottom'))}><span className="lyx-tb-line" data-side="bottom" /></Btn>
          <Btn label="Line left of the column" active={table.lineLeft} onClick={run(toggleColumnLine('left'))}><span className="lyx-tb-line" data-side="left" /></Btn>
          <Btn label="Line right of the column" active={table.lineRight} onClick={run(toggleColumnLine('right'))}><span className="lyx-tb-line" data-side="right" /></Btn>
          <Btn label="All lines on / off" onClick={run(toggleAllLines)}><Grid3x3 className="size-3.5" /></Btn>
          <Sep />
          <Btn label="Merge the selected cells of a row (multicolumn); drag or Shift+click to select cells" disabled={!table.canMerge} onClick={run(mergeInRow)}><TableCellsMerge className="size-3.5" /></Btn>
          <Btn label="Split the merged cell" disabled={!table.canSplit} onClick={run(splitMerged)}><TableCellsSplit className="size-3.5" /></Btn>
          <Sep />
          <Btn label="Delete table" onClick={run(removeTable)}><Trash2 className="size-3.5" /></Btn>
        </div>
      )}
    </div>
  );
}
