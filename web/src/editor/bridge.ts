/**
 * A tiny bridge so non-React code (actions, wizards, quick fixes) can reach
 * the live Monaco editor instance.
 */
import type { monaco } from './monaco';

type Editor = monaco.editor.IStandaloneCodeEditor;

let editor: Editor | null = null;
/** Range of the "/query" text that opened the slash menu (replaced on insert). */
let pendingSlashRange: monaco.IRange | null = null;
/** Set while another editor (the LyX-style one) shows the active file: the line its cursor is on. */
let cursorLineOverride: (() => number | null) | null = null;
/** Set while another editor shows the active file: where wizards and slash commands insert LaTeX. */
let texInserter: ((tex: string, select?: string) => boolean) | null = null;

/**
 * A Monaco snippet as plain LaTeX, for an editor without snippets: each
 * placeholder becomes its default text (a choice its first option), tab
 * stops vanish, and `select` is the first placeholder's text, to type over.
 */
export function snippetToTex(snippet: string): { tex: string; select?: string } {
  let select: string | undefined;
  // Escaped \$ and \} are set aside first, so `\$5` is a dollar, not tab stop 5.
  const tex = snippet
    .replace(/\\\$/g, '')
    .replace(/\\\}/g, '')
    .replace(/\$\{(\d+)\|([^,|}]*)[^|}]*\|\}/g, (_m, _n, first: string) => first)
    .replace(/\$\{(\d+):([^}]*)\}/g, (_m, n: string, text: string) => {
      if (select === undefined && n !== '0' && text) select = text;
      return text;
    })
    .replace(/\$\{\d+\}|\$\d+/g, '')
    .replace(//g, '$')
    .replace(//g, '}');
  return { tex, select: select?.replace(//g, '$').replace(//g, '}') };
}

export const editorBridge = {
  set(e: Editor | null) {
    editor = e;
  },
  get(): Editor | null {
    return editor;
  },
  /** Let another editor answer cursorLine() (null hands it back to Monaco). */
  setCursorLine(fn: (() => number | null) | null) {
    cursorLineOverride = fn;
  },
  /** The line of the active file the cursor is on, in whichever editor shows it. */
  cursorLine(): number | null {
    return cursorLineOverride ? cursorLineOverride() : (editor?.getPosition()?.lineNumber ?? null);
  },
  setSlashRange(r: monaco.IRange | null) {
    pendingSlashRange = r;
  },
  takeSlashRange(): monaco.IRange | null {
    const r = pendingSlashRange;
    pendingSlashRange = null;
    return r;
  },
  /** Whether another editor (the LyX-style one), not Monaco, shows the active file. */
  cursorLineIsElsewhere() {
    return texInserter != null;
  },
  /** Let another editor (the LyX-style one) take inserted LaTeX while it shows the active file (null hands it back). */
  setTexInserter(fn: ((tex: string, select?: string) => boolean) | null) {
    texInserter = fn;
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
    else editor.trigger('gitlatex', 'type', { text: snippet.replace(/\$\{\d+:?([^}]*)\}|\$\d/g, '$1') });
    return true;
  },
  insertText(text: string) {
    if (texInserter) return texInserter(text);
    if (!editor) return false;
    const sel = editor.getSelection();
    if (!sel) return false;
    editor.executeEdits('gitlatex', [{ range: sel, text, forceMoveMarkers: true }]);
    editor.focus();
    return true;
  },
};
