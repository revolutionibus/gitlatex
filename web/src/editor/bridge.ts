/**
 * A tiny bridge so non-React code (actions, wizards, quick fixes) can reach
 * the live Monaco editor instance.
 */
import type { monaco } from './monaco';

type Editor = monaco.editor.IStandaloneCodeEditor;

let editor: Editor | null = null;
/** The cursor's line in the active file when another editor (the LyX-style one) has it. */
let cursorLine: (() => number) | null = null;
/** Inserts LaTeX at the cursor of a non-Monaco editor (the LyX-style one) while it shows the active file. */
let texInserter: ((tex: string, select?: string) => boolean) | null = null;
/** Range of the "/query" text that opened the slash menu (replaced on insert). */
let pendingSlashRange: monaco.IRange | null = null;

export const editorBridge = {
  set(e: Editor | null) {
    editor = e;
  },
  get(): Editor | null {
    return editor;
  },
  /** Let a non-Monaco editor report the cursor's line (null to hand it back to Monaco). */
  setCursorLine(fn: (() => number) | null) {
    cursorLine = fn;
  },
  /** The line of the active file the cursor is on, whichever editor shows it. */
  cursorLine(): number | null {
    return cursorLine ? cursorLine() : (editor?.getPosition()?.lineNumber ?? null);
  },
  /** Let a non-Monaco editor take insertions (null to hand them back to Monaco). */
  setTexInserter(fn: ((tex: string, select?: string) => boolean) | null) {
    texInserter = fn;
  },
  setSlashRange(r: monaco.IRange | null) {
    pendingSlashRange = r;
  },
  takeSlashRange(): monaco.IRange | null {
    const r = pendingSlashRange;
    pendingSlashRange = null;
    return r;
  },
  /** Insert a Monaco snippet at the cursor (or replacing `range`). */
  insertSnippet(snippet: string, range?: monaco.IRange | null) {
    if (texInserter) {
      const { tex, select } = snippetToTex(snippet);
      return texInserter(tex, select);
    }
    if (!editor) return false;
    editor.focus();
    if (range) editor.setSelection(range);
    const controller = editor.getContribution('snippetController2') as unknown as { insert(s: string): void } | null;
    if (controller) controller.insert(snippet);
    else editor.trigger('texbrowser', 'type', { text: snippet.replace(/\$\{\d+:?([^}]*)\}|\$\d/g, '$1') });
    return true;
  },
  insertText(text: string) {
    if (texInserter) return texInserter(text);
    if (!editor) return false;
    const sel = editor.getSelection();
    if (!sel) return false;
    editor.executeEdits('texbrowser', [{ range: sel, text, forceMoveMarkers: true }]);
    editor.focus();
    return true;
  },
};

/**
 * A Monaco snippet as plain LaTeX: placeholders become their default text, and the
 * first one is what to select. A `\label{}` made of placeholders is left out (the
 * LyX-style editor adds labels with Tab).
 */
export function snippetToTex(snippet: string): { tex: string; select?: string } {
  // snippet escapes (\\ \$ \} for \ $ }) are set aside so they are not read as placeholders
  const ESC: Record<string, string> = { '\\': '\ue000', $: '\ue001', '}': '\ue002' };
  const unescape = (t: string) => t.replace(/[\ue000-\ue002]/g, (c) => ({ '\ue000': '\\', '\ue001': '$', '\ue002': '}' })[c]!);
  snippet = snippet.replace(/\\([\\$}])/g, (_m, c: string) => ESC[c]);
  // a choice ${1|a,b,c|} becomes its first option
  const choices = new Set<number>();
  snippet = snippet.replace(/\$\{(\d+)\|([^|]*?)(?:,[^|]*)?\|\}/g, (_m, i: string, first: string) => {
    choices.add(+i);
    return `\${${i}:${first}}`;
  });
  snippet = snippet.replace(/\\label\{[^{}]*\$\{[^}]*\}[^{}]*\}/g, '');
  const values = new Map<number, string>();
  for (const m of snippet.matchAll(/\$\{(\d+):([^}]*)\}/g)) if (!values.has(+m[1])) values.set(+m[1], m[2]);
  // What to type over: the first placeholder with text that the LyX editor shows once and
  // as text, so not inside an [option] list, not a choice, and not repeated elsewhere ($1).
  const candidates: number[] = [];
  for (const m of snippet.matchAll(/\$\{(\d+):([^}]*)\}/g)) {
    const i = +m[1];
    const before = snippet.slice(0, m.index);
    const inOptions = before.lastIndexOf('[') > before.lastIndexOf(']');
    const mirrored = new RegExp(`\\$(${i}(?!\\d)|\\{${i}\\})`).test(snippet);
    if (i > 0 && m[2] && !inOptions && !choices.has(i) && !mirrored) candidates.push(i);
  }
  const firstIdx = candidates.sort((a, b) => a - b)[0];
  const tex = snippet
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    // a repeated tab stop ($1, ${1}) shows the same text as its placeholder
    .replace(/\$\{(\d+)\}|\$(\d+)/g, (_m, a?: string, b?: string) => values.get(+(a ?? b!)) ?? '');
  const select = firstIdx !== undefined ? values.get(firstIdx) : undefined;
  return { tex: unescape(tex), select: select ? unescape(select) : undefined };
}
