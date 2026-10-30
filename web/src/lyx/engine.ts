// @ts-nocheck — ported from the standalone lyx-web.html prototype (plain DOM code); the typed edges are LyxHost and LyxEditor.
/**
 * The LyX-style WYSIWYM editor: LyX's menus, toolbars, key bindings (cua.bind),
 * paragraph layouts, insets and MathLive formulas, editing one .tex file.
 *
 * The document lives in the DOM (see model.ts). `load` reads LaTeX into it
 * (tex-import.ts) and `getText` writes it back (tex-export.ts); the host
 * (LyxPane) moves text between the editor and the file's Monaco model.
 */
import {
  ZW, LAYOUT_GROUPS, KNOWN, HEAD, HEAD_NAMES, LISTS, THM, ENVS, FRONT, ATOMBLK, headLevel, envOf, SC,
  envWrap, stripEnv, latexOf, setMathHook, isTextBlock,
  mkBlock, mkMath, mkDisplay, mkSC, mkLB, mkInset, mkERT, mkAtom, mkSpecial,
} from './model';
import { parseTex, registerTheorems, theoremsOf, macrosOf } from './tex-import';
import { exportTex, genRun, inlineTex as texInline } from './tex-export';
import { BIND_TEXT } from './bindings';
import { cellBodies, cellBody, newTabular, rowsOf, tabularOp } from './tabular';

export interface LyxHost {
  /** The file's name, for exports and the documents list. */
  fileName: string;
  /** The document changed (the host debounces and calls getText). */
  onChange(): void;
  /** Ctrl+S: write the file and compile. */
  save(): void;
  /** View / Update: compile and show the PDF. */
  compile(): void;
  /** SyncTeX forward search to a line of the file. */
  showInPdf(line: number): void;
  /** Switch this file to the LaTeX source editor. */
  openSource(): void;
  /** Citation keys from the project's .bib files. */
  bibKeys(): { key: string; label: string }[];
  /** The project's .bib files (paths relative to this file, without .bib). */
  bibFiles(): string[];
  /** Image files in the project, relative to this file. */
  images(): string[];
  /** A displayable URL for an \includegraphics path (a promise while it is rendered, e.g. a PDF figure), or null. */
  imageUrl(path: string): string | null | Promise<string | null>;
  /** The citation command that fits the preamble (cite, citep with natbib, autocite with biblatex). */
  defaultCite(): string;
  /** The Zotero library on this machine (through the gitlatex server). */
  zotero: {
    status(): Promise<{ running: boolean; betterBibtex: boolean; localApi: boolean; message: string | null }>;
    search(q: string): Promise<{ source: string; items: { id: string; key: string | null; title: string; creators: string[]; year: string; where: string }[] }>;
    /** Add the items to the project's .bib file; resolves to their citation keys. */
    importItems(ids: string[], source: string): Promise<string[]>;
  };
  /** The MathLive module (for MathML export). */
  mathlive: unknown;
}

export interface LyxEditor {
  /** Read LaTeX into the editor; `keepView` keeps the caret and scroll position (for outside changes). */
  load(text: string, keepView?: boolean): void;
  /** The document as LaTeX (untouched parts as they were read). */
  getText(): string;
  /** The line of the file the caret's paragraph starts on. */
  caretPosition(): { line: number; column: number };
  /** Move to the paragraph that contains a line of the file. */
  reveal(line: number, column?: number): void;
  /**
   * Insert LaTeX at the caret, as the app's command palette and wizards do in the
   * source editor. Paragraph-level LaTeX (a heading, a list, an equation) becomes
   * paragraphs beside the caret's; anything else goes inline. `select` is text to
   * select afterwards, ready to type over (e.g. a heading's "Title").
   */
  insertTex(tex: string, select?: string): boolean;
  focus(): void;
  destroy(): void;
}

const TEMPLATE = String.raw`
<div class="lx-app">
  <div class="menubar" id="menubar" role="menubar"></div>
  <div class="toolbars" id="toolbars">
    <div class="tb" id="tbStandard">
      <span class="grip"></span>
      <select id="layoutCombo" title="Paragraph layout (Alt+P, Space)"></select>
      <button class="tbtn" data-lfun="buffer-write"><i>save</i></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="undo"><i>undo</i></button>
      <button class="tbtn" data-lfun="redo"><i>redo</i></button>
      <button class="tbtn" data-lfun="cut"><i>content_cut</i></button>
      <button class="tbtn" data-lfun="copy"><i>content_copy</i></button>
      <button class="tbtn" data-lfun="paste"><i>content_paste</i></button>
      <button class="tbtn" data-lfun="dialog-show findreplace"><i>search</i></button>
      <button class="tbtn" data-lfun="bookmark-goto 0"><i>arrow_back</i></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="font-emph"><i>format_italic</i></button>
      <button class="tbtn" data-lfun="font-noun"><i>match_case</i></button>
      <button class="tbtn" data-lfun="font-bold"><i>format_bold</i></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="math-mode"><i>functions</i></button>
      <button class="tbtn" data-lfun="dialog-show-new-inset graphics"><i>image</i></button>
      <button class="tbtn" data-lfun="float-insert figure"><i>add_photo_alternate</i></button>
      <button class="tbtn" data-lfun="tabular-insert"><i>table</i></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="forward-search"><i>my_location</i></button>
      <button class="tbtn" data-lfun="toolbar-toggle math" data-toggle="1"><i>calculate</i></button>
    </div>
    <div class="tb" id="tbExtra">
      <span class="grip"></span>
      <button class="tbtn" data-lfun="buffer-view"><i>visibility</i></button>
      <button class="tbtn" data-lfun="buffer-update"><i>refresh</i></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="layout Itemize"><i>format_list_bulleted</i></button>
      <button class="tbtn" data-lfun="layout Enumerate"><i>format_list_numbered</i></button>
      <button class="tbtn" data-lfun="depth-decrement"><i>format_indent_decrease</i></button>
      <button class="tbtn" data-lfun="depth-increment"><i>format_indent_increase</i></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="footnote-insert"><i>superscript</i></button>
      <button class="tbtn" data-lfun="marginalnote-insert"><i>view_sidebar</i></button>
      <button class="tbtn" data-lfun="note-insert Note"><i>sticky_note_2</i></button>
      <button class="tbtn" data-lfun="label-insert"><i>label</i></button>
      <button class="tbtn" data-lfun="dialog-show-new-inset ref"><i>arrow_circle_right</i></button>
      <button class="tbtn" data-lfun="dialog-show-new-inset citation"><i>format_quote</i></button>
      <button class="tbtn" data-lfun="zotero-cite"><span class="txt zot">Z</span></button>
      <button class="tbtn" data-lfun="flex-insert URL"><i>link</i></button>
      <button class="tbtn" data-lfun="ert-insert"><span class="txt">TeX</span></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="paragraph-params \align left"><i>format_align_left</i></button>
      <button class="tbtn" data-lfun="paragraph-params \align center"><i>format_align_center</i></button>
      <button class="tbtn" data-lfun="paragraph-params \align right"><i>format_align_right</i></button>
      <span class="sep"></span>
      <button class="tbtn" data-lfun="dialog-show spellchecker" data-toggle="1"><i>spellcheck</i></button>
      <button class="tbtn" data-lfun="dialog-show document"><i>tune</i></button>
    </div>
  </div>
  <div class="findbar" id="findbar" hidden>
    <span>Find:</span><input type="text" id="findText" spellcheck="false">
    <span>Replace:</span><input type="text" id="replaceText" spellcheck="false">
    <button id="findPrev" title="Find previous (Shift+F3)">&#9650;</button>
    <button id="findNextBtn" title="Find next (F3)">&#9660;</button>
    <button id="replaceBtn">Replace</button>
    <button id="replaceAllBtn">Replace all</button>
    <label><input type="checkbox" id="findCase"> Case sensitive</label>
    <label><input type="checkbox" id="findWord"> Whole words</label>
    <button id="findClose" title="Close (Esc)">&#10005;</button>
  </div>
  <div class="workspace">
    <aside class="pane" id="outlinePane" hidden>
      <div class="pane-head">
        <span>Outline</span>
        <select id="outlineMode">
          <option value="toc">Table of Contents</option>
          <option value="labels">Labels and References</option>
          <option value="math">Equations</option>
          <option value="foot">Footnotes</option>
          <option value="notes">Notes</option>
          <option value="ert">TeX Code</option>
        </select>
        <button class="x" data-lfun="dialog-toggle toc" title="Close">&#10005;</button>
      </div>
      <div id="outline"></div>
    </aside>
    <div class="center">
      <div id="workarea"><div id="editor" contenteditable="true" spellcheck="false" aria-label="Document"></div></div>
    </div>
    <aside class="pane" id="sourcePane" hidden>
      <div class="pane-head"><span>LaTeX Source</span><button class="x" data-lfun="dialog-toggle view-source" title="Close">&#10005;</button></div>
      <pre id="source"></pre>
    </aside>
  </div>
  <div class="mathbars" id="mathbars" hidden>
    <div class="tb" id="mathbar1"><span class="grip"></span></div>
    <div class="tb" id="mathbar2"><span class="grip"></span></div>
  </div>
  <div class="statusbar">
    <span id="status"></span>
    <input id="minibuf" list="lfunList" hidden spellcheck="false" autocomplete="off">
    <span id="statusRight"></span>
  </div>
  <div id="menuLayer"></div>
  <dialog id="dlg"><form method="dialog" id="dlgForm"><div class="dlg-title" id="dlgTitle"></div><div class="dlg-body" id="dlgBody"></div><div class="dlg-buttons" id="dlgButtons"></div></form></dialog>
  <datalist id="lfunList"></datalist>
  <input type="file" id="fileInput" hidden>
</div>`.replace(/<i>([a-z_0-9]+)<\/i>/g, '<i class="material-symbols-outlined">$1</i>').replace(/id="([A-Za-z0-9]+)"/g, 'id="lx-$1"').replace(/list="([A-Za-z]+)"/g, 'list="lx-$1"');

export function createLyxEditor(root: HTMLElement, host: LyxHost): LyxEditor {
  root.classList.add('lyx-root');
  root.innerHTML = TEMPLATE;
  const $ = s => root.querySelector(s);
  const $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const ed = $('#lx-editor');
  const workarea = $('#lx-workarea');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const ML = host.mathlive;
  const isText = isTextBlock;
  const cleanups = [];
  function listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); }

  /* ---------- State ---------- */
  /** The file around the blocks: preamble, \end{document}, chunks of source (see tex-import.ts). */
  let tex = { head: '', tail: '', trailing: '', chunks: [], theorems: {}, macros: {} };
  /** Theorem layouts the preamble names differently (Theorem → thm). */
  let thmEnv = {};
  /** For the LyX-format export: the preamble between \documentclass and \begin{document}. */
  const docSettings = {
    fontsize: 'default', papersize: 'default',
    get preamble() { const at = tex.head.search(/\\begin\s*\{document\}/); const m = /\\documentclass[^\n]*\n?/.exec(tex.head); return at < 0 ? '' : tex.head.slice(m ? m.index + m[0].length : 0, at); },
  };
  let prefs = { dollarMath: true, backslashTex: false, zoom: 100 };
  let savedRange = null, curBlock = null, pendingMath = null;
  /** The formula last edited, while nothing else in the editor has been since (the app's command palette takes the focus from it). */
  let lastMath = null;
  let loading = false, dirty = false;
  const bookmarks = {};
  let lastPos = null;

  const SC_ARG = { hyphenation: 'hyph', 'ligature-break': 'lig', slash: 'slash', nobreakdash: 'nbdash', 'end-of-sentence': 'eos', dots: 'dots', 'menu-separator': 'menusep' };
  const SC_LYX = { ldots: 'dots', endofsentence: 'eos', softhyphen: 'hyph', ligaturebreak: 'lig', slash: 'slash', nobreakdash: 'nbdash', menuseparator: 'menusep' };
  const SC_LYX_OLD = { '\\ldots{}': 'dots', '\\@.': 'eos', '\\-': 'hyph', '\\textcompwordmark{}': 'lig', '\\slash{}': 'slash', '\\nobreakdash-': 'nbdash', '\\menuseparator': 'menusep' };

  /* ---------- Text formatting ---------- */
  const FONTS = {
    'font-emph': { tag: 'EM', name: 'Emphasized' }, 'font-bold': { tag: 'STRONG', name: 'Bold' },
    'font-underline': { tag: 'U', name: 'Underline' }, 'font-strikeout': { tag: 'S', name: 'Strikeout' },
    'font-typewriter': { cls: 'ftt', name: 'Typewriter' }, 'font-sans': { cls: 'fsf', name: 'Sans Serif' },
    'font-roman': { cls: 'frm', name: 'Roman' }, 'font-noun': { cls: 'noun', name: 'Noun' },
    'font-underunderline': { cls: 'uuline', name: 'Double underline' }, 'font-underwave': { cls: 'uwave', name: 'Wavy underline' },
  };
  const SIZES = ['tiny', 'scriptsize', 'footnotesize', 'small', 'normal', 'large', 'larger', 'largest', 'huge', 'giant'];
  const SIZE_TEX = { tiny: 'tiny', scriptsize: 'scriptsize', footnotesize: 'footnotesize', small: 'small', large: 'large', larger: 'Large', largest: 'LARGE', huge: 'huge', giant: 'Huge' };
  const FMT_SEL = 'em,strong,b,i,u,s,sub,sup,span.ftt,span.fsf,span.frm,span.noun,span.uuline,span.uwave,span[class^="sz-"]';


  /* =====================================================================
     Utilities
     ===================================================================== */
  function status(msg) { $('#lx-status').textContent = msg || ''; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function isEmptyBlock(b) {
    return !b.querySelector('math-field,.sc,.inset,.lb') && b.textContent.replace(/\u200B/g, '').trim() === '';
  }
  function activeMath() {
    const a = document.activeElement;
    if (a && a.tagName === 'MATH-FIELD' && ed.contains(a)) return a;
    if (pendingMath && pendingMath.isConnected) return pendingMath;
    return null;
  }
  function withMath(fn) {
    const saved = $$('math-field', ed).map(m => [m, latexOf(m)]);
    const r = fn();
    const fix = () => saved.forEach(([m, v]) => { if (m.isConnected && latexOf(m) !== v) { try { m.value = v; } catch (e) {} } });
    fix(); requestAnimationFrame(fix);
    return r;
  }
  function download(name, text, type = 'text/plain') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  const baseName = () => host.fileName.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  const roman = n => { const m = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; };
  const alpha = n => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } return s; };

  /* =====================================================================
     Caret and selection helpers
     ===================================================================== */
  function selRange(restore) {
    const s = getSelection();
    if (s.rangeCount) {
      const r = s.getRangeAt(0);
      if (ed.contains(r.startContainer) && r.startContainer !== ed) return r;
    }
    if (!restore) return null;
    if (savedRange && ed.contains(savedRange.startContainer)) {
      ed.focus({ preventScroll: true });
      s.removeAllRanges(); s.addRange(savedRange.cloneRange());
      return s.getRangeAt(0);
    }
    let last = [...ed.children].reverse().find(isText);
    if (!last) { last = mkBlock('Standard'); ed.appendChild(last); }
    caretEnd(last);
    return s.rangeCount ? s.getRangeAt(0) : null;
  }
  function setCaret(node, offset) {
    if (!ed.contains(document.activeElement) || document.activeElement.tagName === 'MATH-FIELD') ed.focus({ preventScroll: true });
    const r = document.createRange();
    r.setStart(node, offset); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    savedRange = r.cloneRange();
  }
  function setSel(r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); savedRange = r.cloneRange(); }
  function caretStart(b) {
    if (!b) return;
    if (b.dataset.type === '_display') { focusMath(b.querySelector('math-field'), 'start'); return; }
    if (!isText(b)) { const n = b.nextElementSibling; if (n) caretStart(n); return; }
    const f = firstText(b);
    if (f) setCaret(f, f.data.startsWith(ZW) ? 1 : 0); else setCaret(b, 0);
  }
  function caretEnd(b) {
    if (!b) return;
    if (b.dataset.type === '_display') { focusMath(b.querySelector('math-field'), 'end'); return; }
    if (!isText(b)) { const p = b.previousElementSibling; if (p) caretEnd(p); return; }
    let last = b.lastChild;
    while (last && last.nodeName === 'BR') last = last.previousSibling;
    if (!last) { setCaret(b, 0); return; }
    if (last.nodeType === 3) { setCaret(last, last.data.length); return; }
    if (last.isContentEditable && last.lastChild) {
      const w = document.createTreeWalker(last, NodeFilter.SHOW_TEXT); let t = null;
      while (w.nextNode()) if (!w.currentNode.parentElement.closest('[contenteditable=false]') || w.currentNode.parentElement.closest('[contenteditable=false]') === null) t = w.currentNode;
      if (t && !t.parentElement.closest('.mwrap,.sc,.lb,.inset')) { setCaret(t, t.data.length); return; }
    }
    setCaret(b, [...b.childNodes].indexOf(last) + 1);
  }
  function firstText(b) {
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      if (n.parentElement.closest('[contenteditable=false]') && n.parentElement.closest('[contenteditable=false]') !== b) return null;
      return n;
    }
    return null;
  }
  function caretBeside(el, after) {
    let t = after ? el.nextSibling : el.previousSibling;
    if (!t || t.nodeType !== 3) { t = document.createTextNode(ZW); after ? el.after(t) : el.before(t); }
    if (after) setCaret(t, t.data.startsWith(ZW) ? 1 : 0);
    else setCaret(t, t.data.length);
  }
  /** Bumped by every click, so a formula's pending focus does not override where the user clicked. */
  let clicks = 0;
  /**
   * Focus a formula. MathLive's focus() does nothing while it still believes it has the
   * focus (after the focus moved to, say, a label field beside it), so its keyboard sink
   * is focused directly when needed.
   */
  function focusField(mf) {
    mf.focus({ preventScroll: true });
    if (document.activeElement !== mf) mf.shadowRoot?.querySelector('.ML__keyboard-sink')?.focus({ preventScroll: true });
  }
  function focusMath(mf, where) {
    if (!mf) return;
    pendingMath = mf;
    const at = clicks;
    customElements.whenDefined('math-field').then(() => requestAnimationFrame(() => {
      if (!mf.isConnected || clicks !== at) return;
      focusField(mf);
      try {
        if (where === 'start') mf.executeCommand('moveToMathfieldStart');
        else if (where === 'end') mf.executeCommand('moveToMathfieldEnd');
        else if (where === 'all') mf.executeCommand('selectAll');
      } catch (e) {}
    }));
  }
  function currentBlock() {
    const am = activeMath();
    if (am) return am.closest('.blk');
    const r = selRange(false) || (savedRange && ed.contains(savedRange.startContainer) ? savedRange : null);
    if (!r) return null;
    let n = r.startContainer;
    if (n === ed) n = ed.children[Math.min(r.startOffset, ed.children.length - 1)];
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const b = el && el.closest('.blk');
    return b && b.parentElement === ed ? b : null;
  }
  function textContainer(node) {
    const el = node.nodeType === 3 ? node.parentElement : node;
    return el.closest('.ibody') || el.closest('.blk');
  }
  function inIbody() {
    const r = selRange(false); if (!r) return null;
    const el = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    return el.closest('.ibody');
  }
  function textBefore(container, r) {
    r = r || selRange(false);
    const pre = document.createRange();
    pre.setStart(container, 0);
    pre.setEnd(r.startContainer, r.startOffset);
    const frag = pre.cloneContents();
    return { text: pre.toString().replace(/\u200B/g, ''), atom: !!frag.querySelector && !!frag.querySelector('.mwrap,.sc,.inset,.lb') };
  }
  function textAfter(container, r) {
    r = r || selRange(false);
    const post = document.createRange();
    post.setStart(r.endContainer, r.endOffset);
    post.setEnd(container, container.childNodes.length);
    const frag = post.cloneContents();
    return { text: post.toString().replace(/\u200B/g, ''), atom: !!frag.querySelector('.mwrap,.sc,.inset,.lb') };
  }
  function caretPos() {
    const am = activeMath();
    const b = currentBlock();
    if (!b) return { i: 0, o: 0 };
    const i = [...ed.children].indexOf(b);
    if (am || !isText(b)) return { i, o: -1 };
    const r = selRange(false) || savedRange;
    if (!r) return { i, o: 0 };
    const pre = document.createRange(); pre.setStart(b, 0);
    try { pre.setEnd(r.startContainer, r.startOffset); } catch (e) { return { i, o: 0 }; }
    const o = pre.toString().length;
    // a selection within the paragraph is kept too (e.g. the "Title" to type over when a reload follows an insert)
    if (!r.collapsed && b.contains(r.endContainer)) { try { pre.setEnd(r.endContainer, r.endOffset); return { i, o, e: pre.toString().length }; } catch (e) { /* caret only */ } }
    return { i, o };
  }
  function setCaretPos(p) {
    const b = ed.children[Math.min(p.i, ed.children.length - 1)];
    if (!b) return;
    if (p.o < 0 || !isText(b)) { caretStart(b); return; }
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let acc = 0;
    while (w.nextNode()) {
      const n = w.currentNode, len = n.data.length;
      // inside an inset's editable body (a TeX-code box, a footnote) the caret can go in; elsewhere in an inset it cannot
      const ce = n.parentElement.closest('[contenteditable]');
      const locked = ce && ce.contentEditable === 'false' ? ce : null;
      if (acc + len >= p.o) {
        if (locked && locked !== b && b.contains(locked)) { const host = locked.closest('.mwrap,.sc,.lb,.inset') || locked; caretBeside(host, true); return; }
        setCaret(n, p.o - acc);
        if (p.e > p.o) {
          const end = textPoint(b, p.e);
          if (end) { const r = document.createRange(); r.setStart(n, p.o - acc); r.setEnd(end[0], end[1]); setSel(r); }
        }
        return;
      }
      acc += len;
    }
    caretEnd(b);
  }
  /** The text node and offset `o` characters into paragraph `b`. */
  function textPoint(b, o) {
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let acc = 0;
    while (w.nextNode()) { const n = w.currentNode; if (acc + n.data.length >= o) return [n, o - acc]; acc += n.data.length; }
    return null;
  }
  function gotoBlock(b) {
    if (!b) return;
    lastPos = caretPos();
    b.scrollIntoView({ block: 'center' });
    caretStart(b);
  }
  function selectedBlocks() {
    const r = selRange(false) || savedRange;
    const cur = currentBlock();
    if (!r || r.collapsed || activeMath()) return cur ? [cur] : [];
    const blk = n => { const el = n.nodeType === 1 ? n : n.parentElement; const b = el && el.closest('.blk'); return b && b.parentElement === ed ? b : null; };
    const a = blk(r.startContainer), z = blk(r.endContainer);
    if (!a || !z) return cur ? [cur] : [];
    const out = []; let n = a;
    while (n) { out.push(n); if (n === z) break; n = n.nextElementSibling; }
    return out;
  }

  /* =====================================================================
     Undo / redo (snapshot based)
     ===================================================================== */
  const undoStack = [], redoStack = [];
  let lastSnapTime = 0, lastSnapKind = '';
  function serialize(root = ed) {
    const clone = root.cloneNode(true);
    const orig = $$('math-field', root);
    $$('math-field', clone).forEach((m, i) => {
      const cls = m.className, src = orig[i].dataset.tex;
      [...m.attributes].forEach(a => m.removeAttribute(a.name));
      m.className = cls;
      if (src !== undefined) m.dataset.tex = src;
      m.textContent = latexOf(orig[i]);
    });
    $$('.current', clone).forEach(x => x.classList.remove('current'));
    return clone.innerHTML;
  }
  function hydrate(root = ed) { $$('math-field', root).forEach(wire); }
  function snapshot() { return { html: serialize(), caret: caretPos() }; }
  function pushUndo(kind = 'cmd') {
    const now = Date.now();
    if (kind === 'type' && lastSnapKind === 'type' && now - lastSnapTime < 1500) { lastSnapTime = now; return; }
    undoStack.push(snapshot());
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    lastSnapTime = now; lastSnapKind = kind;
  }
  function restoreSnap(s) {
    ed.innerHTML = s.html; hydrate(); refresh(); setCaretPos(s.caret); markDirty();
  }
  function undo() {
    if (!undoStack.length) { status('No further undo information'); return; }
    redoStack.push(snapshot()); restoreSnap(undoStack.pop()); lastSnapKind = ''; status('Undo');
  }
  function redo() {
    if (!redoStack.length) { status('No further redo information'); return; }
    undoStack.push(snapshot()); restoreSnap(redoStack.pop()); lastSnapKind = ''; status('Redo');
  }


  /* =====================================================================
     Math wiring
     ===================================================================== */
  function wire(mf) {
    if (mf._w) return;
    mf._w = 1;
    mf.addEventListener('focusin', () => {
      if (pendingMath === mf) pendingMath = null;
      lastMath = mf;
      pushUndo('math');
      showMathbars(true);
      setCurrent(mf.closest('.blk'));
      updateCombo();
    });
    mf.addEventListener('focusout', () => setTimeout(() => {
      const a = document.activeElement;
      if (!(a && a.tagName === 'MATH-FIELD')) showMathbars(false);
    }, 60));
    // an edited formula is written as MathLive serialises it; untouched ones keep their source text
    mf.addEventListener('input', () => { delete mf.dataset.tex; markDirty(); scheduleRefresh(); });
    // Tab with no placeholder left to fill in a display formula: name its label
    mf.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !mf.classList.contains('display')) return;
      let latex = ''; try { latex = mf.getValue('latex'); } catch (err) { /* not ready */ }
      if (/\\placeholder/.test(latex)) return;
      e.preventDefault(); e.stopPropagation();
      editEqLabelInline(mf.closest('.blk'));
    }, true);
    mf.addEventListener('move-out', e => {
      e.preventDefault();
      const d = e.detail && e.detail.direction;
      leaveMath(mf, d === 'forward' || d === 'downward');
    });
    customElements.whenDefined('math-field').then(() => {
      try { mf.menuItems = []; } catch (e) {}
      try { mf.smartFence = true; } catch (e) {}
      applyMacros(mf);
    });
  }
  function applyMacros(mf) {
    if (!tex.macros || !Object.keys(tex.macros).length) return;
    try { mf.macros = { ...mf.macros, ...tex.macros }; } catch (e) {}
  }

  function leaveMath(mf, forward = true) {
    const b = mf.closest('.blk');
    mf.blur(); pendingMath = null;
    if (b && b.dataset.type === '_display') {
      let t = forward ? b.nextElementSibling : b.previousElementSibling;
      if (!t || !isText(t)) {
        t = mkBlock(b.dataset.ctx || 'Standard');
        if (b.dataset.depth) t.dataset.depth = b.dataset.depth;
        if (forward) { t.dataset.cont = '1'; b.after(t); } else b.before(t);
        refresh();
      }
      forward ? caretStart(t) : caretEnd(t);
    } else {
      const w = mf.closest('.mwrap');
      if (w) caretBeside(w, forward);
    }
  }
  const MATH_TPL = {
    '\\frac': '\\frac{#@}{#?}', '\\sqrt': '\\sqrt{#@}', '\\root': '\\sqrt[#?]{#@}', '\\prime': "'",
    '\\cases': '\\begin{cases}#@ & #?\\\\ #? & #?\\end{cases}', '\\aligned': '\\begin{aligned}#@ & #?\\end{aligned}',
    '\\alignedat': '\\begin{aligned}#@ & #?\\end{aligned}', '\\gathered': '\\begin{gathered}#@\\end{gathered}',
    '\\split': '\\begin{aligned}#@ & #?\\end{aligned}', '\\underbar': '\\underline{#@}', '\\sum': '\\sum', '\\int': '\\int',
    '\\lim': '\\lim_{#?}', '\\binom': '\\binom{#@}{#?}', '\\text': '\\text{#@}', '\\mathbb': '\\mathbb{#@}',
  };
  function mathTpl(x) {
    if (MATH_TPL[x]) return MATH_TPL[x];
    if (/^\\(hat|bar|dot|ddot|check|breve|vec|tilde|acute|grave|widehat|widetilde|overline|underline|mathbf|mathrm|mathcal|mathsf|mathit|mathtt|mathfrak|mathscr|boldsymbol)$/.test(x)) return x + '{#@}';
    return x;
  }
  function mathInsert(tpl) {
    let mf = activeMath();
    if (!mf) { mf = insertInlineMath(''); if (!mf) return; }
    customElements.whenDefined('math-field').then(() => requestAnimationFrame(() => {
      try { mf.focus(); mf.executeCommand(['insert', tpl, { selectionMode: 'placeholder', focus: true }]); }
      catch (e) { try { mf.insert(tpl, { selectionMode: 'placeholder' }); } catch (e2) {} }
      markDirty(); scheduleRefresh();
    }));
  }
  function mathCmd(cmd) {
    const mf = activeMath(); if (!mf) return;
    try { mf.executeCommand(cmd); } catch (e) {}
    markDirty(); scheduleRefresh();
  }

  /* ---------- Inserting and converting formulas ---------- */
  function insertInlineMath(latex) {
    const r = selRange(true); if (!r) return null;
    const b = currentBlock();
    if (!b || !isText(b)) return null;
    pushUndo();
    let init = latex;
    if (init == null) init = r.collapsed ? '' : r.toString().replace(/\u200B/g, '');
    if (!r.collapsed) r.deleteContents();
    const w = mkMath(init);
    r.insertNode(w);
    removeLoneBr(b);
    ensureCaretRoom(w.parentNode);
    refresh();
    focusMath(w.firstChild, 'end');
    return w.firstChild;
  }
  function splitAt(b, node, offset) {
    const tail = document.createRange();
    tail.setStart(node, offset); tail.setEnd(b, b.childNodes.length);
    const frag = withMath(() => tail.extractContents());
    const nb = mkBlock(b.dataset.type); nb.innerHTML = '';
    nb.append(frag);
    if (b.dataset.depth) nb.dataset.depth = b.dataset.depth;
    hydrate(nb);
    fixEmpty(nb); fixEmpty(b);
    return nb;
  }
  function insertDisplay(numbered, env) {
    const am = activeMath();
    if (am && am.classList.contains('inline')) { mutateMath(am, env || 'equation', numbered); return; }
    if (am) { const db = am.closest('.blk'); if (numbered) { db.dataset.numbered = '1'; refresh(); } return; }
    const r = selRange(true); const b = currentBlock();
    pushUndo();
    let init = r && !r.collapsed ? r.toString().replace(/\u200B/g, '') : '';
    if (r && !r.collapsed) r.deleteContents();
    if (env) init = envWrap(env, init || '#? & #?');
    const disp = mkDisplay(init, numbered, env);
    if (!b) ed.append(disp);
    else if (!isText(b)) b.after(disp);
    else if (isEmptyBlock(b) && !b.dataset.cont) { if (b.dataset.depth) disp.dataset.depth = b.dataset.depth; b.replaceWith(disp); }
    else {
      const after = textAfter(b, getSelection().getRangeAt(0));
      if (b.dataset.depth) disp.dataset.depth = b.dataset.depth;
      if (!after.text.trim() && !after.atom) b.after(disp);
      else {
        const rr = getSelection().getRangeAt(0);
        const nb = splitAt(b, rr.startContainer, rr.startOffset);
        nb.dataset.cont = '1';
        b.after(disp); disp.after(nb);
      }
    }
    refresh();
    focusMath(disp.querySelector('math-field'), 'end');
  }
  function mutateMath(mf, kind, numbered) {
    const isInline = mf.classList.contains('inline');
    const latex = latexOf(mf);
    pushUndo();
    if (kind === 'simple') {
      if (isInline) return;
      const db = mf.closest('.blk');
      const prev = db.previousElementSibling, next = db.nextElementSibling;
      const w = mkMath(stripEnv(latex));
      if (prev && isText(prev) && headLevel(prev.dataset.type) == null) {
        removeLoneBr(prev);
        prev.append(document.createTextNode(' '), w, document.createTextNode(' '));
        if (next && next.dataset.cont) { withMath(() => { while (next.firstChild) prev.append(next.firstChild); }); next.remove(); removeLoneBr(prev); }
      } else {
        const nb = mkBlock('Standard', w); nb.innerHTML = ''; nb.append(w); db.before(nb);
      }
      db.remove();
      refresh(); focusMath(w.firstChild, 'end');
      return;
    }
    const env = (kind === 'equation' || kind === 'none') ? '' : kind;
    if (isInline) {
      const w = mf.closest('.mwrap'); const b = w.closest('.blk');
      const disp = mkDisplay(env ? envWrap(env, latex || '#?') : latex, numbered || false, env);
      if (b.dataset.depth) disp.dataset.depth = b.dataset.depth;
      const nb = splitAt(b, w.parentNode, [...w.parentNode.childNodes].indexOf(w) + 1);
      w.remove(); fixEmpty(b);
      const nbEmpty = isEmptyBlock(nb);
      if (isEmptyBlock(b) && !b.dataset.cont) b.replaceWith(disp); else b.after(disp);
      if (!nbEmpty) { nb.dataset.cont = '1'; disp.after(nb); }
      refresh(); focusMath(disp.querySelector('math-field'), 'end');
    } else {
      const db = mf.closest('.blk');
      const inner = stripEnv(latex);
      const nl = env ? envWrap(env, inner) : inner;
      if (env) db.dataset.env = env; else delete db.dataset.env;
      if (numbered) db.dataset.numbered = '1';
      if (nl !== latex) { try { mf.value = nl; } catch (e) {} }
      refresh(); focusMath(mf, 'end');
    }
  }


  function removeLoneBr(b) { [...b.childNodes].forEach(n => { if (n.nodeName === 'BR' && b.childNodes.length > 1) n.remove(); }); }
  function fixEmpty(b) {
    if (!isText(b)) return;
    [...b.childNodes].forEach(n => { if (n.nodeType === 3 && n.data === '') n.remove(); });
    if (!b.childNodes.length || (isEmptyBlock(b) && !b.querySelector('br'))) { if (!b.textContent.replace(/\u200B/g, '')) b.innerHTML = '<br>'; }
  }
  function ensureCaretRoom(container) {
    if (!container || !container.children) return;
    [...container.children].forEach(w => {
      if (!w.matches('.mwrap,.inset,.sc,.lb')) return;
      if (!w.previousSibling || w.previousSibling.nodeType !== 3) w.before(document.createTextNode(ZW));
      if (!w.nextSibling || w.nextSibling.nodeType !== 3) w.after(document.createTextNode(ZW));
    });
  }
  function normalize() {
    [...ed.childNodes].forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('blk')) return;
      if (n.nodeType === 3 && !n.data.trim()) { n.remove(); return; }
      if (n.nodeType === 8) { n.remove(); return; }
      const b = mkBlock('Standard'); b.innerHTML = '';
      n.replaceWith(b);
      if (n.nodeType === 1 && n.tagName === 'DIV') { while (n.firstChild) b.append(n.firstChild); } else b.append(n);
      fixEmpty(b);
    });
    if (!ed.firstElementChild) ed.appendChild(mkBlock('Standard'));
    $$('span[style]:not([class]), font', ed).forEach(s => { s.replaceWith(...s.childNodes); });
    $$('.blk', ed).forEach(b => {
      b.removeAttribute('style');
      if (!b.dataset.type) b.dataset.type = 'Standard';
      if (isText(b)) { ensureCaretRoom(b); if (!b.childNodes.length) b.innerHTML = '<br>'; }
      if (isText(b) && !KNOWN.has(b.dataset.type)) b.classList.add('unknown-layout'); else b.classList.remove('unknown-layout');
    });
    $$('.ibody', ed).forEach(ib => { if (!ib.childNodes.length) ib.textContent = ZW; ensureCaretRoom(ib); });
    $$('.blk[data-ert]', ed).forEach(b => { if (!b.querySelector('.inset[data-inset="ERT"]')) delete b.dataset.ert; });
    $$('math-field', ed).forEach(wire);
  }

  function renumber() {
    let part = 0; const sec = [0, 0, 0, 0, 0, 0, 0];
    const top = [...ed.children].some(b => headBaseOf(b) === 'Chapter') ? 1 : 2;
    let appendix = false, thm = 0, eq = 0, foot = 0;
    const enumN = [], lastAt = [];
    const labelNum = {};
    let prevText = null, prev = null;
    for (const b of ed.children) {
      const t = b.dataset.type, d = +b.dataset.depth || 0;
      if (d) b.style.setProperty('--depth', d); else b.style.removeProperty('--depth');
      b.className = b.className.replace(/\bthm-\w+|\bin-plain\b/g, '').trim();
      if (!appendix && (b.dataset.appendix || (b.dataset.ert && plainText(b.querySelector('.ibody') || b) === '\\appendix'))) { appendix = true; sec[top] = 0; }
      let num = '';
      if (t === '_display') {
        let ctx = 'Standard';
        if (prev && prev.dataset.type === '_display') ctx = prev.dataset.ctx || 'Standard';
        else if (prev && isText(prev) && headLevel(prev.dataset.type) == null && !FRONT[prev.dataset.type]) ctx = prev.dataset.type;
        b.dataset.ctx = ctx;
        if (THM[ctx] === 'plain') b.classList.add('in-plain');
        const no = b.querySelector('.eqno'), lb = b.querySelector('.eqlabel');
        if (b.dataset.numbered) { eq++; if (no) no.textContent = '(' + eq + ')'; } else if (no) no.textContent = '';
        if (lb && !lb.classList.contains('editing')) { lb.textContent = b.dataset.label ? b.dataset.label : ''; lb.title = b.dataset.label ? 'Label (Tab at the end of the formula, or double-click, to rename)' : ''; }
        if (b.dataset.label) labelNum[b.dataset.label] = b.dataset.numbered ? String(eq) : '';
        b.dataset.num = b.dataset.numbered ? String(eq) : '';
        prev = b; continue;
      }
      if (!isText(b)) { prev = b; if (d === 0) lastAt.length = 0; continue; }
      for (let j = d + 1; j < lastAt.length; j++) { lastAt[j] = undefined; enumN[j] = 0; }
      const cont = !!b.dataset.cont;
      const lvl = headLevel(t);
      if (lvl != null) {
        if (!t.endsWith('*')) {
          if (lvl === 0) { part++; num = 'Part ' + roman(part); }
          else if (lvl >= top && lvl <= top + 2) {
            sec[lvl]++; for (let k = lvl + 1; k < 7; k++) sec[k] = 0;
            const parts = [];
            for (let k = top; k <= lvl; k++) parts.push(k === top && appendix ? alpha(sec[k]).toUpperCase() : String(sec[k]));
            num = (lvl === 1 ? 'Chapter ' : '') + parts.join('.');
          }
        }
      } else if (THM[t]) {
        b.classList.add('thm-' + THM[t]);
        const continues = !b.dataset.newenv && (cont || (prevText && prevText.dataset.type === t && (+prevText.dataset.depth || 0) === d && prev && (prev === prevText || prev.dataset.type === '_display')));
        if (!continues) {
          if (t === 'Proof') num = (b.dataset.arg || 'Proof') + '.';
          else { thm++; num = `${t} ${thm}${b.dataset.arg ? ' (' + b.dataset.arg + ')' : ''}.`; }
        }
        if (t !== 'Proof') b._thm = thm;
      } else if (t === 'Enumerate') {
        if (!cont) { enumN[d] = lastAt[d] === 'Enumerate' && !b.dataset.newenv ? (enumN[d] || 0) + 1 : 1; }
        const n = enumN[d] || 1;
        num = cont ? '' : b.dataset.itemopt != null ? b.dataset.itemopt : [`${n}.`, `(${alpha(n)})`, `${roman(n).toLowerCase()}.`, `${alpha(n).toUpperCase()}.`][d % 4];
        b._enum = n;
      } else if (t === 'Itemize') {
        num = cont ? '' : b.dataset.itemopt != null ? b.dataset.itemopt : ['\u2022', '\u2013', '\u2217', '\u00b7'][d % 4];
      } else if (t === 'Abstract') {
        num = (prevText && prevText.dataset.type === 'Abstract') || cont ? '' : 'Abstract.';
      }
      if (!cont) lastAt[d] = t;
      b.dataset.num = num;
      if (t === 'Standard' && !cont && !b.dataset.noindent && !b.dataset.align && !b.dataset.ert && prevText && prevText.dataset.type === 'Standard' && !prevText.dataset.ert && prev === prevText && (+prevText.dataset.depth || 0) === d) b.dataset.indent = '1';
      else delete b.dataset.indent;
      $$('.atom[data-inset="Label"]', b).forEach(l => {
        let v = '';
        if (lvl != null) v = num.replace(/^(Part|Chapter) /, '');
        else if (THM[t] && t !== 'Proof') v = String(thm);
        else if (t === 'Enumerate') v = String(b._enum || '');
        labelNum[l.dataset.name] = v;
      });
      prevText = b; prev = b;
    }
    const floats = { figure: 0, table: 0 };
    $$('.inset[data-inset="Float"]', ed).forEach(f => {
      const kind = f.dataset.float === 'table' ? 'table' : 'figure', name = kind === 'table' ? 'Table' : 'Figure';
      const n = ++floats[kind];
      const fl = f.querySelector(':scope > .ilabel'); if (fl) fl.textContent = name;
      $$('.inset[data-inset="Caption"] > .ilabel', f).forEach(l => { l.textContent = `${name} ${n}:`; });
      $$('.atom[data-inset="Label"]', f).forEach(l => { labelNum[l.dataset.name] = String(n); });
    });
    $$('.inset[data-inset="Caption"]', ed).forEach(c => { if (!c.closest('.inset[data-inset="Float"]')) c.querySelector(':scope > .ilabel').textContent = 'Caption:'; });
    $$('.inset[data-inset="Foot"] > .ilabel', ed).forEach(l => { l.textContent = 'foot ' + (++foot); });
    $$('.atom[data-inset="Label"]:not(.editing)', ed).forEach(l => { l.textContent = l.dataset.name; l.title = 'Label: ' + l.dataset.name + ' (Tab or double-click to rename)'; });
    $$('.atom[data-inset="Ref"]', ed).forEach(r => {
      const v = labelNum[r.dataset.name];
      const shown = v == null || v === '' ? '??' : v;
      r.textContent = r.dataset.cmd === 'eqref' ? `(${shown})` : r.dataset.cmd === 'pageref' ? 'page ' + shown : shown;
      r.title = (r.dataset.cmd || 'ref') + ': ' + r.dataset.name;
    });
    $$('.atom[data-inset="Cite"]', ed).forEach(c => {
      c.textContent = '[' + (c.dataset.keys || '').split(',').filter(Boolean).join(', ') + ']';
      c.title = '\\' + (c.dataset.cmd || 'cite') + (c.dataset.opt || '') + ' \u2014 double-click to edit';
    });
    $$('.atom[data-inset="Graphics"]', ed).forEach(showGraphics);
    $$('.blk[data-type="_toc"] .tocl', ed).forEach(tl => {
      tl.innerHTML = [...ed.children].filter(b => { const l = headLevel(b.dataset.type); return l != null && l >= 1 && l <= top + 1; })
        .map(b => `<div style="padding-left:${Math.max(0, headLevel(b.dataset.type) - top) * 1.2}em">${esc((b.dataset.num ? b.dataset.num.replace(/^Chapter /, '') + '  ' : '') + plainText(b))}</div>`).join('');
    });
  }
  const headBaseOf = b => (b.dataset.type || '').replace(/\*$/, '');
  /** Show an \includegraphics inset as the image (when the project has it). */
  function showGraphics(a) {
    const url = host.imageUrl(a.dataset.path);
    // the host's URL changes when the file appears or changes
    const key = a.dataset.path + '|' + (a.dataset.opt || '');
    if (a._shown === key && a._url === url && a.firstChild) return;
    a._shown = key; a._url = url;
    const w = /(?:^|,)\s*width\s*=\s*([\d.]+)\s*\\(?:linewidth|textwidth|columnwidth|hsize)/.exec(a.dataset.opt || '');
    a.style.width = w ? Math.min(100, +w[1] * 100) + '%' : '';
    a.title = a.dataset.path + (a.dataset.opt ? ' [' + a.dataset.opt + ']' : '') + ' \u2014 double-click to change';
    const show = (u) => {
      a.textContent = '';
      if (u) {
        const img = document.createElement('img');
        img.src = u; img.alt = a.dataset.path; img.draggable = false;
        a.classList.add('has-img');
        a.append(img);
      } else {
        a.classList.remove('has-img');
        a.textContent = '\u25A3 ' + a.dataset.path;
      }
    };
    if (url && typeof url.then === 'function') {
      show(null);
      url.then(u => { if (a._url === url) show(u); });
    } else show(url);
  }

  function plainText(el) { return el.textContent.replace(/\u200B/g, '').trim(); }

  let refreshTimer = null;
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 160); }
  function refresh() {
    clearTimeout(refreshTimer);
    normalize(); renumber(); buildOutline(); updateSource(); updateToolbarState(); changed();
  }

  /** Tell the host the document changed (not while loading: loading is not an edit). */
  function changed() { if (!loading && dirty) host.onChange(); }
  function markDirty() { if (loading) return; dirty = true; host.onChange(); }

  function setCurrent(b) {
    if (b === curBlock) return;
    const old = curBlock;
    curBlock = b;
    if (old && old.isConnected && old !== b && isText(old) && isEmptyBlock(old) && ed.children.length > 1 && !old.querySelector('br + *')) {
      const n = old.nextElementSibling, p = old.previousElementSibling;
      const keep = (n && n.dataset.type === '_display') || (p && p.dataset.type === '_display' && old.dataset.cont);
      if (!keep && old !== ed.lastElementChild) { old.remove(); scheduleRefresh(); }
    }
  }


  /* =====================================================================
     Typing behaviour (LyX rules)
     ===================================================================== */
  function insertPlain(t) {
    const r = selRange(true); if (!r) return;
    pushUndo('type');
    if (!r.collapsed) r.deleteContents();
    const n = r.startContainer, o = r.startOffset;
    if (n.nodeType === 3) { n.insertData(o, t); setCaret(n, o + t.length); }
    else { const tn = document.createTextNode(t); r.insertNode(tn); setCaret(tn, t.length); }
    const b = currentBlock(); if (b) removeLoneBr(b);
    markDirty(); scheduleRefresh();
  }
  function insertNodeAtCaret(node) {
    const r = selRange(true); if (!r) return;
    const b = currentBlock(); if (!b || !isText(b)) { status('Command disabled'); return; }
    pushUndo();
    if (!r.collapsed) r.deleteContents();
    r.insertNode(node);
    removeLoneBr(b);
    ensureCaretRoom(node.parentNode);
    caretBeside(node, true);
    markDirty(); refresh();
  }
  function nextLayout(t, atEnd, inverse) {
    const keep = !!(LISTS[t] || THM[t] || ENVS[t]);
    const head = headLevel(t) != null || !!FRONT[t];
    let same = keep || (!atEnd && head);
    if (!KNOWN.has(t)) same = true;
    if (inverse) same = !same;
    return same ? t : 'Standard';
  }
  function paragraphBreak(inverse) {
    const r = selRange(true); if (!r) return;
    const b = currentBlock(); if (!b || !isText(b)) return;
    pushUndo();
    if (!r.collapsed) r.deleteContents();
    const t = b.dataset.type, d = +b.dataset.depth || 0;
    if (isEmptyBlock(b) && !inverse) {
      if (LISTS[t]) { if (d > 0) { if (d - 1) b.dataset.depth = d - 1; else delete b.dataset.depth; } else b.dataset.type = 'Standard'; refresh(); updateCombo(); }
      else if (t !== 'Standard') { b.dataset.type = 'Standard'; delete b.dataset.cont; refresh(); updateCombo(); }
      return;
    }
    const rr = getSelection().getRangeAt(0);
    const after = textAfter(b, rr), before = textBefore(b, rr);
    const atEnd = !after.text && !after.atom;
    const atStart = !before.text && !before.atom;
    const nb = splitAt(b, rr.startContainer, rr.startOffset);
    nb.dataset.type = atStart && !atEnd ? t : nextLayout(t, atEnd, inverse);
    if (atStart && !atEnd && b.dataset.cont) { delete b.dataset.cont; nb.dataset.cont = '1'; }
    b.after(nb);
    refresh();
    caretStart(nb);
    updateCombo();
  }
  function smartQuote(single) {
    const ib = inIbody(); const b = currentBlock();
    const before = textBefore(ib || b).text;
    const open = !before || /[\s(\[{\u201c\u2018\u2013\u2014-]$/.test(before);
    return single ? (open ? '\u2018' : '\u2019') : (open ? '\u201c' : '\u201d');
  }
  function spaceBlocked() {
    const r = selRange(false); if (!r || !r.collapsed) return false;
    const ib = inIbody();
    if (ib && ib.parentElement.dataset.inset === 'ERT') return false;
    const b = currentBlock(); if (!b || !isText(b)) return false;
    const tb = textBefore(ib || b, r);
    if (!tb.text && !tb.atom) { status('You cannot insert a space at the beginning of a paragraph. Please read the Tutorial.'); return true; }
    if (/[ \u00a0]$/.test(tb.text) && !(tb.atom && /[ \u00a0]$/.test(tb.text) === false)) { status('You cannot type two spaces this way. Please read the Tutorial.'); return true; }
    return false;
  }
  function adjacentAtom(fwd) {
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return null;
    let n = s.anchorNode, o = s.anchorOffset;
    let sib = null;
    if (n.nodeType === 3) {
      const rest = fwd ? n.data.slice(o) : n.data.slice(0, o);
      if (rest.replace(/\u200B/g, '') !== '') return null;
      sib = fwd ? n.nextSibling : n.previousSibling;
      while (sib && sib.nodeType === 3 && sib.data.replace(/\u200B/g, '') === '') sib = fwd ? sib.nextSibling : sib.previousSibling;
      if (!sib && n.parentElement.classList.contains('ibody')) return leaveBody(n.parentElement, fwd);
    } else {
      sib = fwd ? n.childNodes[o] : n.childNodes[o - 1];
      if (!sib && n.classList && n.classList.contains('ibody')) return leaveBody(n, fwd);
    }
    if (sib && sib.nodeType === 1 && (sib.classList.contains('mwrap') || (sib.classList.contains('inset') && !sib.classList.contains('atom') && !sib.classList.contains('collapsed')))) return { enter: sib };
    return null;
  }
  /** Past the edge of an inset body: out of the inset, or into the next cell of a table. */
  function leaveBody(ib, fwd) {
    const tab = ib.parentElement.tagName === 'TD' ? ib.closest('.inset[data-inset="Tabular"]') : null;
    if (!tab) return { exit: ib.parentElement };
    const cells = cellBodies(tab), k = cells.indexOf(ib) + (fwd ? 1 : -1);
    return k >= 0 && k < cells.length ? { cell: cells[k] } : { exit: tab };
  }
  /** The table cell the caret is in. */
  function currentCell() {
    const ib = inIbody();
    return ib && ib.parentElement.tagName === 'TD' ? ib.parentElement : null;
  }
  function enterAtom(a, fwd) {
    if (a.exit) { caretBeside(a.exit, fwd); return; }
    const el = a.enter;
    if (el.classList.contains('mwrap')) { focusMath(el.firstChild, fwd ? 'start' : 'end'); return; }
    if (el.dataset.inset === 'Tabular') { const cells = cellBodies(el); enterAtom({ cell: fwd ? cells[0] : cells[cells.length - 1] }, fwd); return; }
    const body = a.cell || el.querySelector('.ibody');
    if (!body.firstChild) body.textContent = ZW;
    if (fwd) { const f = body.firstChild; if (f.nodeType === 3) setCaret(f, f.data.startsWith(ZW) ? 1 : 0); else setCaret(body, 0); }
    else { const l = body.lastChild; if (l.nodeType === 3) setCaret(l, l.data.length); else setCaret(body, body.childNodes.length); }
  }
  function caretOnEdgeLine(b, down) {
    const r = selRange(false); if (!r) return false;
    const rects = r.getClientRects();
    const br = b.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(b).lineHeight) || 24;
    if (rects.length) { const rc = rects[0]; return down ? rc.bottom > br.bottom - lh * 0.9 : rc.top < br.top + lh * 0.9; }
    const ta = down ? textAfter(b, r) : textBefore(b, r);
    return !ta.text && !ta.atom;
  }

  /* Editor-level keys that are not bindings */
  ed.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.target.tagName === 'MATH-FIELD') return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const ib = inIbody();
    if (e.key === 'Enter' && plain) {
      e.preventDefault();
      if (ib) { if (ib.parentElement.dataset.inset === 'ERT') insertPlain('\n'); return; }
      paragraphBreak(false); return;
    }
    if (e.key === 'Tab' && plain) {
      e.preventDefault();
      const td = currentCell();
      if (!td) {
        if (e.shiftKey || ib) return;
        const l = labelForTab();
        if (l) editLabelInline(l, false);
        else if (suggestLabel()) insertLabelInline();
        return;
      }
      const tab = td.closest('.inset[data-inset="Tabular"]'), cells = cellBodies(tab), k = cells.indexOf(cellBody(td)) + (e.shiftKey ? -1 : 1);
      if (k >= 0 && k < cells.length) enterAtom({ cell: cells[k] }, true);
      else if (!e.shiftKey) tableCmd('append-row', rowsOf(tab).pop().cells[0]);
      return;
    }
    if (e.key === ' ' && plain && !e.shiftKey && spaceBlocked()) { e.preventDefault(); return; }
    if (e.key === '"' && plain && !(ib && ib.parentElement.dataset.inset === 'ERT')) { e.preventDefault(); insertPlain(smartQuote(false)); return; }
    if (e.key === '$' && plain && prefs.dollarMath && !ib) { e.preventDefault(); run('math-mode'); return; }
    if (e.key === '\\' && plain && prefs.backslashTex && !ib) { e.preventDefault(); insertInset('ERT'); insertPlain('\\'); return; }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && plain && !e.shiftKey) {
      const a = adjacentAtom(e.key === 'ArrowRight');
      if (a) { e.preventDefault(); enterAtom(a, e.key === 'ArrowRight'); return; }
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && plain && !e.shiftKey && !ib) {
      const b = currentBlock(); const down = e.key === 'ArrowDown';
      const nb = b && (down ? b.nextElementSibling : b.previousElementSibling);
      if (nb && nb.dataset.type === '_display' && caretOnEdgeLine(b, down)) { e.preventDefault(); focusMath(nb.querySelector('math-field'), down ? 'start' : 'end'); return; }
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && plain) {
      const r = selRange(false); const b = currentBlock();
      if (!r || !b || !r.collapsed) return;
      if (ib) {
        const tb = e.key === 'Backspace' ? textBefore(ib, r) : textAfter(ib, r);
        if (!tb.text && !tb.atom) e.preventDefault();
        return;
      }
      if (e.key === 'Backspace') {
        const tb = textBefore(b, r);
        if (!tb.text && !tb.atom) {
          const p = b.previousElementSibling;
          if (!p) { e.preventDefault(); return; }
          if (!isText(p)) { e.preventDefault(); pushUndo(); p.remove(); refresh(); status(p.dataset.type === '_display' ? 'Formula deleted' : ''); return; }
          pushUndo();
          if (isEmptyBlock(b)) { e.preventDefault(); b.remove(); caretEnd(p); refresh(); return; }
          e.preventDefault();
          const mark = p.lastChild && p.lastChild.nodeName === 'BR' ? p.lastChild : null;
          if (mark) mark.remove();
          const lastBefore = p.lastChild;
          withMath(() => { while (b.firstChild) p.append(b.firstChild); });
          b.remove(); removeLoneBr(p);
          if (lastBefore) { if (lastBefore.nodeType === 3) setCaret(lastBefore, lastBefore.data.length); else caretBeside(lastBefore, true); } else caretStart(p);
          refresh(); return;
        }
      } else {
        const ta = textAfter(b, r);
        if (!ta.text && !ta.atom) {
          const n = b.nextElementSibling;
          if (!n) { e.preventDefault(); return; }
          if (!isText(n)) { e.preventDefault(); pushUndo(); n.remove(); refresh(); return; }
          e.preventDefault(); pushUndo();
          const pos = caretPos();
          removeLoneBr(b);
          if (b.lastChild && b.lastChild.nodeName === 'BR') b.lastChild.remove();
          withMath(() => { while (n.firstChild) b.append(n.firstChild); });
          n.remove(); removeLoneBr(b); fixEmpty(b);
          refresh(); setCaretPos(pos); return;
        }
      }
    }
  });
  ed.addEventListener('beforeinput', e => {
    if (e.target.tagName === 'MATH-FIELD') return;
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); return; }
    if (e.inputType === 'formatBold' || e.inputType === 'formatItalic' || e.inputType === 'formatUnderline') { e.preventDefault(); return; }
    pushUndo('type');
  });
  ed.addEventListener('input', e => { if (e.target.tagName === 'MATH-FIELD') return; markDirty(); scheduleRefresh(); });
  // Ctrl/Cmd+click shows the spot in the PDF (as in the source editor)
  ed.addEventListener('click', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.button !== 0) return;
    setTimeout(() => host.showInPdf(caretPosition().line), 0);
  });
  ed.addEventListener('mousedown', e => {
    const l = e.target.closest && e.target.closest('.ilabel');
    if (l) { e.preventDefault(); const ins = l.parentElement; ins.classList.toggle('collapsed'); if (ins.classList.contains('collapsed')) caretBeside(ins, true); markDirty(); }
  });
  ed.addEventListener('dblclick', e => {
    const el = e.target.closest && e.target.closest('.blk[data-type="_display"] .eqlabel');
    if (el) { e.preventDefault(); editEqLabelInline(el.closest('.blk')); return; }
    const a = e.target.closest && e.target.closest('.atom');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.inset === 'Ref') gotoLabel(a.dataset.name);
    else if (a.dataset.inset === 'Label') editLabelAtom(a);
    else if (a.dataset.inset === 'Cite') citationDialog(a);
    else if (a.dataset.inset === 'Graphics') graphicsDialog(a);
    else if (a.dataset.inset === 'Href') hrefInsert(a);
  });

  /* ---------- Clipboard ---------- */
  function fragmentData(r) {
    const frag = r.cloneContents();
    const orig = $$('math-field', ed).filter(m => r.intersectsNode(m));
    $$('math-field', frag).forEach((m, i) => { const cls = m.className; [...m.attributes].forEach(a => m.removeAttribute(a.name)); m.className = cls; m.textContent = latexOf(orig[i]); });
    const div = document.createElement('div'); div.append(frag);
    return { html: div.innerHTML, text: plainExportOf(div) };
  }
  ed.addEventListener('copy', e => {
    if (e.target.tagName === 'MATH-FIELD' || activeMath()) return;
    const r = selRange(false); if (!r || r.collapsed) return;
    e.preventDefault();
    const d = fragmentData(r);
    e.clipboardData.setData('text/plain', d.text);
    try { e.clipboardData.setData('application/x-lyx-web', d.html); } catch (er) {}
    window._lyxClip = { html: d.html, text: d.text };
  });
  ed.addEventListener('cut', e => {
    if (e.target.tagName === 'MATH-FIELD' || activeMath()) return;
    const r = selRange(false); if (!r || r.collapsed) return;
    e.preventDefault();
    const d = fragmentData(r);
    e.clipboardData.setData('text/plain', d.text);
    try { e.clipboardData.setData('application/x-lyx-web', d.html); } catch (er) {}
    window._lyxClip = { html: d.html, text: d.text };
    pushUndo(); deleteSelection(); refresh();
  });
  ed.addEventListener('paste', e => {
    if (e.target.tagName === 'MATH-FIELD' || activeMath()) return;
    e.preventDefault();
    let html = '';
    try { html = e.clipboardData.getData('application/x-lyx-web'); } catch (er) {}
    const text = e.clipboardData.getData('text/plain');
    if (!html && window._lyxClip && window._lyxClip.text === text) html = window._lyxClip.html;
    if (html) pasteFragment(html); else pasteText(text);
  });
  function deleteSelection() {
    const r = selRange(false); if (!r || r.collapsed) return;
    const blk = n => { const el = n.nodeType === 1 ? n : n.parentElement; const b = el && el.closest('.blk'); return b && b.parentElement === ed ? b : null; };
    const a = blk(r.startContainer), z = blk(r.endContainer);
    withMath(() => {
      r.deleteContents();
      if (a && z && a !== z && a.isConnected && z.isConnected) { while (z.firstChild) a.append(z.firstChild); z.remove(); }
    });
    if (a) { fixEmpty(a); removeLoneBr(a); }
    markDirty();
  }
  function pasteText(text) {
    if (!text) return;
    const ib = inIbody();
    if (ib) { insertPlain(ib.parentElement.dataset.inset === 'ERT' ? text : text.replace(/\s+/g, ' ')); return; }
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim());
    pushUndo();
    let first = true;
    for (const ln of lines) {
      if (!first) { if (!ln) continue; paragraphBreak(false); }
      if (ln) insertPlainNoUndo(ln);
      first = false;
    }
    refresh();
  }
  function insertPlainNoUndo(t) {
    const r = selRange(true); if (!r) return;
    if (!r.collapsed) r.deleteContents();
    const n = r.startContainer, o = r.startOffset;
    if (n.nodeType === 3) { n.insertData(o, t); setCaret(n, o + t.length); }
    else { const tn = document.createTextNode(t); r.insertNode(tn); setCaret(tn, t.length); }
    const b = currentBlock(); if (b) removeLoneBr(b);
    markDirty();
  }
  function pasteFragment(html) {
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    const r = selRange(true); if (!r) return;
    pushUndo();
    if (!r.collapsed) deleteSelection();
    const rr = getSelection().getRangeAt(0);
    const b = currentBlock();
    const blocks = [...tmp.children].filter(c => c.classList.contains('blk'));
    if (blocks.length && b) {
      const nb = splitAt(b, rr.startContainer, rr.startOffset);
      let anchor = b;
      [...tmp.childNodes].forEach(n => {
        let blkEl = n;
        if (!(n.nodeType === 1 && n.classList.contains('blk'))) { blkEl = mkBlock('Standard'); blkEl.innerHTML = ''; blkEl.append(n); }
        anchor.after(blkEl); anchor = blkEl;
      });
      anchor.after(nb);
      hydrate(ed);
      if (isEmptyBlock(b) && ed.children.length > 1) b.remove();
      const last = anchor;
      if (isEmptyBlock(nb)) nb.remove();
      refresh(); caretEnd(last);
    } else {
      const frag = document.createDocumentFragment();
      let lastNode = null;
      [...tmp.childNodes].forEach(n => { frag.append(n); lastNode = n; });
      rr.insertNode(frag);
      hydrate(ed);
      if (b) { removeLoneBr(b); ensureCaretRoom(b); }
      refresh();
      if (lastNode) { if (lastNode.nodeType === 3) setCaret(lastNode, lastNode.data.length); else caretBeside(lastNode, true); }
    }
    markDirty();
  }

  /* =====================================================================
     Fonts
     ===================================================================== */
  function fmtMatch(el, spec) {
    if (!el || el.nodeType !== 1) return false;
    if (spec.tag && el.tagName !== spec.tag && !(spec.tag === 'EM' && el.tagName === 'I') && !(spec.tag === 'STRONG' && el.tagName === 'B')) return false;
    if (spec.cls && !el.classList.contains(spec.cls)) return false;
    if (spec.prefix && ![...el.classList].some(c => c.startsWith(spec.prefix))) return false;
    if (!spec.tag && el.tagName !== 'SPAN') return false;
    return true;
  }
  function mkFmt(spec) {
    const el = document.createElement(spec.tag || 'span');
    if (spec.cls) el.classList.add(spec.cls);
    return el;
  }
  function closestFmt(node, spec, stop) {
    let n = node.nodeType === 3 ? node.parentNode : node;
    while (n && n !== stop && n !== ed) { if (fmtMatch(n, spec)) return n; n = n.parentNode; }
    return null;
  }
  function unwrapIn(root, spec) {
    const all = root.querySelectorAll ? [...root.querySelectorAll('*')] : [];
    all.filter(el => fmtMatch(el, spec)).forEach(el => el.replaceWith(...el.childNodes));
  }
  function textNodesInRange(r) {
    const root = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
    const out = [];
    if (r.commonAncestorContainer.nodeType === 3) return [r.commonAncestorContainer];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if (r.intersectsNode(w.currentNode)) out.push(w.currentNode);
    return out;
  }
  function rangeFormatted(r, spec, cont, any) {
    let seen = false;
    for (const t of textNodesInRange(r)) {
      let s = t.data;
      if (t === r.endContainer) s = s.slice(0, r.endOffset);
      if (t === r.startContainer) s = s.slice(r.startOffset - (t === r.endContainer ? 0 : 0));
      if (t === r.startContainer && t === r.endContainer) s = t.data.slice(r.startOffset, r.endOffset);
      if (!s.replace(/\u200B/g, '').trim()) continue;
      if (t.parentElement.closest('[contenteditable=false]') && t.parentElement.closest('[contenteditable=false]') !== cont && cont.contains(t.parentElement.closest('[contenteditable=false]'))) continue;
      seen = true;
      const f = !!closestFmt(t, spec, cont);
      if (any && f) return true;
      if (!any && !f) return false;
    }
    return any ? false : seen;
  }
  function insertAtSplit(r, spec, content) {
    const anc = closestFmt(r.startContainer, spec, textContainer(r.startContainer));
    if (anc) {
      const tail = document.createRange();
      tail.setStart(r.startContainer, r.startOffset); tail.setEnd(anc, anc.childNodes.length);
      const tf = tail.extractContents();
      const t2 = anc.cloneNode(false); t2.append(tf);
      anc.after(t2); anc.after(content);
      [anc, t2].forEach(x => { if (!x.textContent.replace(/\u200B/g, '') && !x.querySelector('.mwrap,.inset,.sc,.lb')) x.remove(); });
    } else r.insertNode(content);
  }
  function applyFont(spec, mode) {
    const r0 = selRange(true); if (!r0) return;
    const cont = textContainer(r0.startContainer);
    if (!cont || (cont.classList.contains('blk') && !isText(cont))) return;
    pushUndo();
    if (r0.collapsed) {
      const anc = closestFmt(r0.startContainer, spec, cont);
      if (anc && mode !== 'on') {
        const tail = document.createRange();
        tail.setStart(r0.startContainer, r0.startOffset); tail.setEnd(anc, anc.childNodes.length);
        const tf = withMath(() => tail.extractContents());
        const t2 = anc.cloneNode(false); t2.append(tf);
        anc.after(t2);
        const z = document.createTextNode(ZW); anc.after(z);
        if (!t2.textContent.replace(/\u200B/g, '')) t2.remove();
        if (!anc.textContent.replace(/\u200B/g, '') && !anc.querySelector('.mwrap,.inset,.sc,.lb')) anc.remove();
        setCaret(z, 1);
        status('Font: Default');
      } else if (!anc && mode !== 'off') {
        const el = mkFmt(spec); const z = document.createTextNode(ZW); el.append(z);
        r0.insertNode(el); setCaret(z, 1);
        status('Font: ' + spec.name);
      }
      return;
    }
    let r = r0.cloneRange();
    if (textContainer(r.endContainer) !== cont) r.setEnd(cont, cont.childNodes.length);
    const all = rangeFormatted(r, spec, cont, false);
    const remove = mode === 'off' || (mode !== 'on' && all);
    withMath(() => {
      const frag = r.extractContents();
      unwrapIn(frag, spec);
      const first = frag.firstChild, last = frag.lastChild;
      let content = frag;
      if (!remove) { const el = mkFmt(spec); el.append(frag); content = el; }
      if (remove) insertAtSplit(r, spec, content);
      else {
        const anc = closestFmt(r.startContainer, spec, cont);
        if (anc) insertAtSplit(r, spec, content); else r.insertNode(content);
      }
      const s = document.createRange();
      if (!remove) s.selectNodeContents(content);
      else if (first && last && first.isConnected && last.isConnected) { s.setStartBefore(first); s.setEndAfter(last); }
      else s.setStart(cont, 0);
      setSel(s);
    });
    hydrate(cont);
    status('Font: ' + (remove ? 'Default' : spec.name));
    markDirty(); refresh();
  }
  function fontDefault() {
    const r = selRange(true); if (!r || r.collapsed) { status('Font: Default'); return; }
    const cont = textContainer(r.startContainer);
    const specs = [...Object.values(FONTS), { prefix: 'sz-', name: 'size' }, { tag: 'SUB', name: 'Subscript' }, { tag: 'SUP', name: 'Superscript' }];
    for (const spec of specs) {
      const rr = selRange(true);
      if (rr && !rr.collapsed && rangeFormatted(rr, spec, cont, true)) applyFont(spec, 'off');
    }
    status('Font: Default');
  }
  function fontSize(sz) {
    if (!SIZES.includes(sz)) { status('Command disabled'); return; }
    const r = selRange(true); if (!r) return;
    const cont = textContainer(r.startContainer);
    if (!r.collapsed && rangeFormatted(r, { prefix: 'sz-' }, cont, true)) applyFont({ prefix: 'sz-', name: 'size' }, 'off');
    if (sz !== 'normal') applyFont({ cls: 'sz-' + sz, name: 'Size ' + sz }, 'on');
  }
  function mathFont(cmd) { mathInsert(cmd + '{#@}'); }

  /* =====================================================================
     Paragraph-level commands
     ===================================================================== */
  function setLayout(name) {
    if (!KNOWN.has(name)) { status(`Layout "${name}" not known`); return; }
    const bs = selectedBlocks().filter(isText);
    if (!bs.length) { status('Command disabled'); return; }
    pushUndo();
    bs.forEach(b => { b.dataset.type = name; delete b.dataset.cont; if (headLevel(name) != null || FRONT[name]) delete b.dataset.depth; });
    refresh(); updateCombo();
    if (!activeMath()) focusIn(bs[0]);
  }
  /**
   * Put the keyboard back in the editor with the caret in `b`, ready to type: where it
   * was if it is already in `b`, else at the end of its text. Needed after the layout
   * box or a menu took focus (choosing Chapter there used to leave typing nowhere).
   */
  function focusIn(b) {
    const s = getSelection();
    const r = s.rangeCount && b.contains(s.getRangeAt(0).startContainer) ? s.getRangeAt(0).cloneRange()
      : savedRange && b.contains(savedRange.startContainer) ? savedRange.cloneRange() : null;
    if (!r) { caretEndText(b); return; }
    if (document.activeElement !== ed) ed.focus({ preventScroll: true });
    setSel(r);
  }
  function insertTex(src, select) {
    // the palette took the focus from a formula: the insert goes there
    const am = activeMath() || (lastMath && lastMath.isConnected && !root.contains(document.activeElement) ? lastMath : null);
    if (am && /^\s*\\label\{[^{}]*\}\s*$/.test(src)) {
      if (am.classList.contains('display')) { editEqLabelInline(am.closest('.blk')); return true; }
      status('An inline formula cannot have a label; use a display formula'); return false;
    }
    if (am) {
      // in a formula: math goes in at its cursor; anything else does not belong there
      if (/^\s*(\\begin\{document\}|\\(begin\{(?!(cases|matrix|pmatrix|bmatrix|aligned)\})|section|chapter|title|item)\b)/.test(src)) { status('Command disabled in math'); return false; }
      pushUndo(); am.focus(); am.insert(src.trim().replace(/^\$|\$$/g, ''), { selectionMode: 'placeholder', format: 'latex' }); markDirty(); return true;
    }
    // math-only commands typed in text become inline math
    if (/^\s*\\(frac|dfrac|tfrac|int|iint|iiint|oint|sum|prod|lim|sqrt)(?![A-Za-z])/.test(src)) src = '$' + src.trim() + '$';
    // an environment, or anything that ends a line, is a paragraph of its own (not spliced into this one)
    const blockish = /^\s*\\begin\s*\{/.test(src) || /\n\s*$/.test(src);
    const r = selRange(true); const b = currentBlock();
    if (!r || !b) return false;
    // a bare label is named in place, as Insert ▸ Label does
    const lab = /^\s*\\label\{([^{}]*)\}\s*$/.exec(src);
    if (lab && isText(b)) { insertLabelInline(lab[1]); return true; }
    let made = parseTex(src).blocks;
    if (!made.length) {
      // an empty centred (or flush) block: an empty paragraph with that alignment, to type into
      const al = /\\begin\{(center|flushleft|flushright)\}/.exec(src);
      if (!al) return false;
      const nb = mkBlock('Standard'); nb.dataset.align = { center: 'center', flushleft: 'left', flushright: 'right' }[al[1]];
      made = [nb];
    }
    // fresh content: not tied to any chunk of the file's source
    made.forEach(m => { delete m.dataset.chunk; $$('[data-chunk]', m).forEach(n => delete n.dataset.chunk); });
    pushUndo();
    let scope, first;
    const at = [...ed.children].indexOf(b);
    if (made.length === 1 && made[0].dataset.type === 'Standard' && isText(b) && !blockish) {
      if (!r.collapsed) r.deleteContents();
      const nodes = [...made[0].childNodes].filter(n => n.nodeName !== 'BR');
      const frag = document.createDocumentFragment(); nodes.forEach(n => frag.append(n));
      r.insertNode(frag); removeLoneBr(b);
      scope = nodes;
    } else {
      if (isText(b) && isEmptyBlock(b)) b.replaceWith(...made);
      else if (isText(b) && !textBefore(b, r).text && !textBefore(b, r).atom) b.before(...made);
      else b.after(...made);
      scope = made; first = made[0];
    }
    $$('math-field', ed).forEach(applyMacros);
    markDirty(); refresh();
    // refresh may rebuild what was inserted: look again in the live document
    if (!scope.some(n => n.isConnected)) scope = first ? [...ed.children].slice(Math.max(0, at - 1), at + made.length + 1) : [b];
    if (first && !first.isConnected) first = scope.find(n => n.isConnected && n !== b) || scope[0];
    if (select && selectIn(scope, select)) return true;
    // the text to type over is a formula: select its contents
    const mf = scope.map(n => n.nodeType === 1 ? (n.matches('math-field') ? n : n.querySelector('math-field')) : null).find(Boolean);
    if (mf) {
      // point the caret at a new display formula first, so a reload (e.g. a package being added) comes back to it
      const host = mf.closest('.blk');
      if (host && host.dataset.type === '_display') setCaret(host, 0);
      focusMath(mf, select ? 'all' : 'end'); return true;
    }
    if (first) { if (first.dataset.type === '_display') focusMath(first.querySelector('math-field'), 'end'); else if (isText(first)) caretEndText(first); else caretStart(first); }
    else { const last = scope[scope.length - 1]; if (last.nodeType === 3) setCaret(last, last.data.length); else caretBeside(last, true); }
    return true;
  }
  /** Select the first occurrence of `text` in these nodes (text outside insets only). */
  function selectIn(nodes, text) {
    for (const n of nodes) {
      const texts = n.nodeType === 3 ? [n] : [];
      if (n.nodeType === 1) { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); while (w.nextNode()) if (!w.currentNode.parentElement.closest('.atom,.mwrap,.ilabel,math-field')) texts.push(w.currentNode); }
      // a whole word, so "text" in \textcolor{red}{text} is the argument, not the command
      const word = new RegExp('(?<![A-Za-z\\\\])' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])');
      for (const t of texts) {
        const m = word.exec(t.data); const i = m ? m.index : -1; if (i < 0) continue;
        if (document.activeElement !== ed) ed.focus({ preventScroll: true });
        const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + text.length); setSel(r);
        return true;
      }
    }
    return false;
  }
  /** The caret at the end of the paragraph's text, before any labels that end it. */
  function caretEndText(b) {
    let last = b.lastChild;
    const skip = n => n && (n.nodeName === 'BR' || (n.nodeType === 3 && n.data.replace(/\u200B/g, '') === '') || (n.nodeType === 1 && n.dataset.inset === 'Label'));
    while (skip(last)) last = last.previousSibling;
    if (!last) { const l = b.querySelector(':scope > .atom[data-inset="Label"]'); if (l) caretBeside(l, false); else caretEnd(b); return; }
    if (last.nodeType === 3) setCaret(last, last.data.length);
    else caretBeside(last, true);
  }
  function depthChange(delta) {
    const bs = selectedBlocks();
    if (!bs.length) return;
    pushUndo();
    let changed = false;
    for (const b of bs) {
      const d = +b.dataset.depth || 0, nd = d + delta;
      if (nd < 0) continue;
      if (delta > 0) {
        const p = b.previousElementSibling;
        if (!p || (+p.dataset.depth || 0) < d || nd > 6 || headLevel(b.dataset.type) != null) continue;
      }
      if (nd) b.dataset.depth = nd; else delete b.dataset.depth;
      changed = true;
    }
    if (!changed) { undoStack.pop(); status('Command disabled'); return; }
    refresh();
  }
  function paragraphParams(arg) {
    const m = /^\\(\S+)\s*(.*)$/.exec(arg.trim());
    if (!m) return;
    const bs = selectedBlocks().filter(isText);
    if (!bs.length) return;
    if (m[1] === 'align') {
      pushUndo();
      bs.forEach(b => { if (m[2] === 'default') delete b.dataset.align; else b.dataset.align = m[2]; });
    } else if (m[1] === 'indent-toggle') {
      pushUndo();
      bs.forEach(b => { if (b.dataset.noindent) delete b.dataset.noindent; else b.dataset.noindent = '1'; });
    } else { status('Command disabled'); return; }
    refresh();
  }
  function sectionOf(b) {
    let n = b;
    while (n && headLevel(n.dataset.type) == null) n = n.previousElementSibling;
    return n;
  }
  function sectionRange(h) {
    const lvl = headLevel(h.dataset.type);
    const arr = [h];
    let n = h.nextElementSibling;
    while (n) { const l = headLevel(n.dataset.type); if (l != null && l <= lvl) break; arr.push(n); n = n.nextElementSibling; }
    return arr;
  }
  function outline(cmd) {
    const b = currentBlock(); if (!b) return;
    const h = sectionOf(b);
    if (!h) { status('Command disabled'); return; }
    const lvl = headLevel(h.dataset.type);
    const star = h.dataset.type.endsWith('*') ? '*' : '';
    const names = Object.keys(HEAD);
    pushUndo();
    if (cmd === 'in' || cmd === 'out') {
      const arr = sectionRange(h).filter(x => headLevel(x.dataset.type) != null);
      const dl = cmd === 'in' ? 1 : -1;
      if (arr.some(x => { const l = headLevel(x.dataset.type) + dl; return l < 0 || l > 5; })) { undoStack.pop(); status('Command disabled'); return; }
      arr.forEach(x => { const l = headLevel(x.dataset.type) + dl; x.dataset.type = names[l] + (x.dataset.type.endsWith('*') ? '*' : ''); });
    } else {
      const arr = sectionRange(h);
      if (cmd === 'up') {
        let p = h.previousElementSibling;
        while (p && !(headLevel(p.dataset.type) != null && headLevel(p.dataset.type) <= lvl)) p = p.previousElementSibling;
        if (!p || headLevel(p.dataset.type) < lvl) { undoStack.pop(); status('Command disabled'); return; }
        withMath(() => arr.forEach(x => p.before(x)));
      } else {
        const q = arr[arr.length - 1].nextElementSibling;
        if (!q || headLevel(q.dataset.type) !== lvl) { undoStack.pop(); status('Command disabled'); return; }
        const qarr = sectionRange(q);
        withMath(() => qarr.forEach(x => h.before(x)));
      }
    }
    void star;
    refresh(); caretEnd(h); h.scrollIntoView({ block: 'nearest' });
  }
  function moveParagraph(up) {
    const b = currentBlock(); if (!b) return;
    const pos = caretPos();
    const sib = up ? b.previousElementSibling : b.nextElementSibling;
    if (!sib) { status('Command disabled'); return; }
    pushUndo();
    withMath(() => { up ? sib.before(b) : sib.after(b); });
    refresh();
    setCaretPos({ i: [...ed.children].indexOf(b), o: pos.o });
  }
  function wordCase(kind) {
    const f = kind === 'upcase' ? s => s.toUpperCase() : kind === 'lowcase' ? s => s.toLowerCase() : s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const r = selRange(true); if (!r) return;
    pushUndo();
    if (!r.collapsed) {
      textNodesInRange(r).forEach(t => {
        const a = t === r.startContainer ? r.startOffset : 0, z = t === r.endContainer ? r.endOffset : t.data.length;
        t.data = t.data.slice(0, a) + (kind === 'capitalize' ? t.data.slice(a, z).replace(/\S+/g, f) : f(t.data.slice(a, z))) + t.data.slice(z);
      });
    } else {
      const n = r.startContainer; if (n.nodeType !== 3) return;
      const o = r.startOffset; const s = n.data;
      let a = o; while (a > 0 && /[\w\u00C0-\u024F]/.test(s[a - 1])) a--;
      let z = o; while (z < s.length && /[\w\u00C0-\u024F]/.test(s[z])) z++;
      if (a === z) { while (z < s.length && !/[\w\u00C0-\u024F]/.test(s[z])) z++; a = z; while (z < s.length && /[\w\u00C0-\u024F]/.test(s[z])) z++; }
      n.data = s.slice(0, a) + f(s.slice(a, z)) + s.slice(z);
      setCaret(n, z);
    }
    markDirty(); scheduleRefresh();
  }
  function paragraphNav(down) {
    const b = currentBlock(); if (!b) return;
    if (!down) {
      const tb = isText(b) ? textBefore(b) : { text: '' };
      if (tb.text || tb.atom) { caretStart(b); return; }
      const p = b.previousElementSibling; if (p) caretStart(p);
    } else { const n = b.nextElementSibling; if (n) caretStart(n); else caretEnd(b); }
  }
  function lineDeleteForward() {
    const r = selRange(true); if (!r) return;
    const c = inIbody() || currentBlock(); if (!c || !isText(currentBlock())) return;
    pushUndo();
    const t = document.createRange(); t.setStart(r.startContainer, r.startOffset); t.setEnd(c, c.childNodes.length);
    t.deleteContents(); fixEmpty(currentBlock()); markDirty(); scheduleRefresh();
  }

  /* ---------- Insets ---------- */
  function insertInset(type, variant) {
    const r = selRange(true); if (!r) return;
    const b = currentBlock(); if (!b || !isText(b)) { status('Command disabled'); return; }
    pushUndo();
    let content = null;
    if (!r.collapsed) {
      content = withMath(() => r.extractContents());
      if (type === 'ERT' || type === 'URL') content = document.createTextNode(plainExportOf(wrapFrag(content)));
    }
    const ins = mkInset(type, variant, content);
    r.insertNode(ins);
    hydrate(ins);
    removeLoneBr(b); ensureCaretRoom(ins.parentNode);
    refresh();
    enterAtom({ enter: ins }, false);
  }
  function wrapFrag(f) { const d = document.createElement('div'); d.append(f); return d; }
  function insetAtCaret() {
    const ib = inIbody(); if (ib) return ib.parentElement;
    const a = adjacentAtomAny(); return a;
  }
  function adjacentAtomAny() {
    const s = getSelection(); if (!s.rangeCount) return null;
    const n = s.anchorNode, o = s.anchorOffset;
    const cands = n.nodeType === 3 ? [n.nextSibling, n.previousSibling] : [n.childNodes[o], n.childNodes[o - 1]];
    return cands.find(c => c && c.nodeType === 1 && c.classList.contains('inset')) || null;
  }
  function insetToggle(mode) {
    const ins = insetAtCaret();
    if (!ins || ins.classList.contains('atom')) { status('Command disabled'); return; }
    const coll = mode === 'close' ? true : mode === 'open' ? false : !ins.classList.contains('collapsed');
    ins.classList.toggle('collapsed', coll);
    if (coll) caretBeside(ins, true);
    markDirty();
  }
  function insetDissolve() {
    const ins = insetAtCaret();
    if (!ins || ins.classList.contains('atom')) { status('Command disabled'); return; }
    pushUndo();
    const body = ins.querySelector('.ibody');
    const nodes = [...body.childNodes];
    withMath(() => ins.replaceWith(...nodes));
    refresh();
  }
  function insertBlockAfter(el) {
    const b = currentBlock();
    pushUndo();
    if (!b) ed.append(el);
    else if (isText(b) && isEmptyBlock(b) && !b.dataset.cont) b.replaceWith(el);
    else b.after(el);
    if (!el.nextElementSibling) el.after(mkBlock('Standard'));
    refresh(); caretStart(el.nextElementSibling);
  }
  function toggleAppendix() {
    const b = currentBlock(); if (!b) return;
    pushUndo();
    if (b.dataset.appendix) delete b.dataset.appendix;
    else { $$('[data-appendix]', ed).forEach(x => delete x.dataset.appendix); b.dataset.appendix = '1'; }
    refresh();
  }

  /* ---------- Labels and references ---------- */
  function allLabels() {
    const out = [];
    for (const b of ed.children) {
      if (b.dataset.type === '_display' && b.dataset.label) out.push({ name: b.dataset.label, el: b });
      $$('.atom[data-inset="Label"]', b).forEach(l => out.push({ name: l.dataset.name, el: l }));
    }
    return out;
  }
  function suggestLabel() {
    const b = currentBlock(); if (!b) return '';
    const t = b.dataset.type;
    const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
    if (t === '_display') return 'eq:';
    if (headLevel(t) != null) return ['part:', 'chap:', 'sec:', 'subsec:', 'subsubsec:', 'par:', 'subpar:'][headLevel(t)] + slug(plainText(b));
    if (THM[t]) return ({ Theorem: 'thm:', Lemma: 'lem:', Corollary: 'cor:', Proposition: 'prop:', Definition: 'def:', Example: 'exa:', Remark: 'rem:' })[t] || 'thm:';
    if (t === 'Enumerate') return 'enu:';
    return '';
  }
  async function labelInsert() {
    const am = activeMath();
    const b = currentBlock();
    // The label is typed in place: in text, and beside a display formula's number.
    if (!am && b && isText(b)) { insertLabelInline(); return; }
    if (am && am.classList.contains('display')) { editEqLabelInline(am.closest('.blk')); return; }
    const name = await promptDialog('Label', 'Label:', suggestLabel());
    if (!name) return;
    if (allLabels().some(l => l.name === name)) { status(`The label "${name}" already exists.`); }
    if (am && am.classList.contains('display')) {
      pushUndo(); const db = am.closest('.blk'); renameEqLabel(db, name); db.dataset.numbered = '1'; refresh(); focusMath(am, 'end'); return;
    }
    if (am) { status('Command disabled'); return; }
    if (!b || !isText(b)) return;
    insertNodeAtCaret(mkAtom('Label', { name }));
  }
  async function editLabelAtom(a) {
    const name = await promptDialog('Label', 'Label:', a.dataset.name);
    renameLabel(a, name);
  }
  /** Rename a label and the references to it. */
  function renameLabel(a, name) {
    if (!name || name === a.dataset.name) return;
    if (allLabels().some(l => l.el !== a && l.name === name)) status(`The label "${name}" already exists.`);
    pushUndo();
    $$(`.atom[data-inset="Ref"]`, ed).filter(r => r.dataset.name === a.dataset.name).forEach(r => { r.dataset.name = name; });
    a.dataset.name = name; refresh();
  }
  /** Give a display formula a label (or a new name), and point the references to the old name at the new one. */
  function renameEqLabel(db, name) {
    const old = db.dataset.label;
    if (allLabels().some(l => l.el !== db && l.name === name)) status(`The label "${name}" already exists.`);
    if (old && old !== name) $$(`.atom[data-inset="Ref"]`, ed).filter(r => r.dataset.name === old).forEach(r => { r.dataset.name = name; });
    db.dataset.label = name;
  }
  /**
   * Name a display formula's label in place, beside its number (a new label numbers the
   * formula). Enter or Tab keeps it, Escape cancels; either goes back into the formula.
   */
  function editEqLabelInline(db) {
    const lb = db && db.querySelector('.eqlabel'); const mf = db && db.querySelector('math-field');
    if (!lb || lb.classList.contains('editing')) return;
    const old = db.dataset.label || '';
    const start = old || 'eq:';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'label-edit'; inp.value = start; inp.spellcheck = false;
    inp.setAttribute('aria-label', 'Equation label');
    inp.size = Math.max(10, start.length + 2);
    lb.classList.add('editing'); lb.textContent = ''; lb.append(inp);
    let done = false;
    const finish = (keep, away = false) => {
      if (done) return; done = true;
      const name = inp.value.trim().replace(/[{}\\]/g, '');
      lb.classList.remove('editing'); inp.remove();
      if (keep && name && name !== old && name !== 'eq:') { pushUndo(); renameEqLabel(db, name); db.dataset.numbered = '1'; markDirty(); }
      refresh();
      // straight back into the formula, so typing goes on there
      if (!away && mf) { focusField(mf); try { mf.executeCommand('moveToMathfieldEnd'); } catch (e) { /* not ready */ } }
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ['beforeinput', 'input', 'keyup', 'mousedown', 'click', 'dblclick'].forEach(t => inp.addEventListener(t, e => e.stopPropagation()));
    inp.addEventListener('input', () => { inp.size = Math.max(10, inp.value.length + 2); });
    inp.addEventListener('blur', () => finish(true, true));
    pendingMath = null;
    inp.focus();
    if (old) inp.select(); else inp.setSelectionRange(start.length, start.length);
  }
  /** A new label at the caret, named in place (the suggested name is selected, ready to type over). */
  function insertLabelInline(name) {
    const b = currentBlock(); if (!b || !isText(b)) { status('Command disabled'); return; }
    const a = mkAtom('Label', { name: suggestLabel() || name || 'lbl:' });
    insertNodeAtCaret(a);
    editLabelInline(a, true);
  }
  /**
   * Edit a label's name right where it is. Enter, Tab or clicking away keeps the
   * name; Escape cancels (and removes a label that was just inserted). The caret
   * then goes back to the text just after the label.
   */
  function editLabelInline(a, isNew) {
    if (a.classList.contains('editing')) return;
    const old = a.dataset.name || '';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'label-edit'; inp.value = old; inp.spellcheck = false;
    inp.setAttribute('aria-label', 'Label name');
    inp.size = Math.max(8, old.length + 2);
    a.classList.add('editing'); a.textContent = ''; a.append(inp);
    let done = false;
    // `away`: focus went elsewhere (a click), so the caret is left where that put it
    const finish = (keep, away = false) => {
      if (done) return; done = true;
      const name = inp.value.trim();
      a.classList.remove('editing'); inp.remove();
      if (isNew && (!keep || !name)) { const t = a.nextSibling; a.remove(); if (!away && t && t.nodeType === 3) setCaret(t, 0); refresh(); markDirty(); return; }
      if (keep && name && name !== old) { renameLabel(a, name); markDirty(); }
      else refresh();
      if (!away) caretBeside(a, true);
    };
    const stop = e => e.stopPropagation();
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ['beforeinput', 'input', 'keyup', 'mousedown', 'click', 'dblclick'].forEach(t => inp.addEventListener(t, stop));
    inp.addEventListener('input', () => { inp.size = Math.max(8, inp.value.length + 2); });
    inp.addEventListener('blur', () => finish(true, true));
    inp.focus();
    // a fresh "sec:intro" selects "intro"; an existing name is selected whole
    const colon = old.indexOf(':');
    if (isNew && colon >= 0) inp.setSelectionRange(colon + 1, old.length); else inp.select();
  }
  /** The label for Tab to edit: the one beside the caret, or else the paragraph's own. */
  function labelForTab() {
    const near = adjacentAtomAny();
    if (near && near.dataset.inset === 'Label') return near;
    const b = currentBlock();
    return b && isText(b) ? b.querySelector(':scope > .atom[data-inset="Label"]') : null;
  }
  async function refInsert() {
    const labels = allLabels();
    if (!labels.length) { status('No labels in the document. Insert one with Insert \u25B8 Label first.'); return; }
    const body = document.createElement('div');
    body.innerHTML = `<label class="row" style="grid-template-columns:1fr"><span>Available labels:</span></label>
      <select class="lst" name="label" size="9">${labels.map((l, i) => `<option value="${esc(l.name)}" ${i === 0 ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <label class="row" style="margin-top:10px"><span>Reference format:</span><select name="cmd">
        <option value="ref">&lt;reference&gt;</option><option value="eqref">(&lt;reference&gt;)</option><option value="pageref">&lt;page&gt;</option></select></label>`;
    const res = await openDialog({ title: 'Cross-reference', body, buttons: [['Cancel', ''], ['Insert', 'ok', true]] });
    if (res.value !== 'ok') return;
    const name = res.form.label.value, cmd = res.form.cmd.value;
    if (!name) return;
    insertNodeAtCaret(mkAtom('Ref', { name, cmd }));
  }
  function gotoLabel(name) {
    const l = allLabels().find(x => x.name === name);
    if (!l) { status('Label not found'); return; }
    lastPos = caretPos();
    const b = l.el.classList.contains('blk') ? l.el : l.el.closest('.blk');
    b.scrollIntoView({ block: 'center' });
    if (l.el.classList.contains('blk')) caretStart(b); else caretBeside(l.el, true);
  }
  async function labelGoto() {
    const labels = allLabels();
    if (!labels.length) { status('No labels in the document.'); return; }
    const body = document.createElement('div');
    body.innerHTML = `<select class="lst" name="label" size="10">${labels.map((l, i) => `<option ${i === 0 ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
    const res = await openDialog({ title: 'Go to Label', body, buttons: [['Cancel', ''], ['Go to', 'ok', true]] });
    if (res.value === 'ok' && res.form.label.value) gotoLabel(res.form.label.value);
  }
  function nextInset(sel) {
    const r = selRange(false) || savedRange;
    const all = $$(sel, ed);
    if (!all.length) { status('No further item of this kind.'); return; }
    let target = all[0];
    if (r) {
      const ref = document.createRange(); ref.setStart(r.endContainer, r.endOffset);
      target = all.find(x => ref.comparePoint(x, 0) > 0 || (x.compareDocumentPosition(r.endContainer) & Node.DOCUMENT_POSITION_PRECEDING)) || all[0];
    }
    lastPos = caretPos();
    target.scrollIntoView({ block: 'center' });
    caretBeside(target, true);
  }

  /* =====================================================================
     Find and replace
     ===================================================================== */
  let currentMatch = null;
  function openFind() {
    const fb = $('#lx-findbar'); fb.hidden = false;
    const r = selRange(false);
    if (r && !r.collapsed && !r.toString().includes('\n')) $('#lx-findText').value = r.toString().replace(/\u200B/g, '');
    $('#lx-findText').focus(); $('#lx-findText').select();
  }
  function closeFind() {
    $('#lx-findbar').hidden = true;
    try { CSS.highlights && CSS.highlights.delete('lyxfind'); } catch (e) {}
    if (currentMatch && currentMatch.startContainer.isConnected) { ed.focus({ preventScroll: true }); setSel(currentMatch); }
    else selRange(true);
    currentMatch = null;
  }
  function searchTextNodes(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('math-field,.sc,.lb,.atom,.ilabel,.eqno,.eqlabel,.toch,.tocl') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  function findMatches(q, cs, ww) {
    const res = [];
    if (!q) return res;
    for (const b of ed.children) {
      if (!isText(b)) continue;
      const nodes = searchTextNodes(b);
      let s = ''; const map = [];
      for (const n of nodes) { map.push([n, s.length]); s += n.data; }
      const hay = cs ? s : s.toLowerCase(), nd = cs ? q : q.toLowerCase();
      let from = 0, idx;
      while ((idx = hay.indexOf(nd, from)) >= 0) {
        from = idx + Math.max(1, nd.length);
        if (ww) { const a = s[idx - 1], z = s[idx + nd.length]; if ((a && /\w/.test(a)) || (z && /\w/.test(z))) continue; }
        const loc = (pos, isEnd) => { for (const [n, off] of map) { const len = n.data.length; if (isEnd ? (pos > off && pos <= off + len) : (pos >= off && pos < off + len)) return [n, pos - off]; } const l = map[map.length - 1]; return [l[0], l[0].data.length]; };
        const r = document.createRange();
        const [sn, so] = loc(idx, false), [en, eo] = loc(idx + nd.length, true);
        r.setStart(sn, so); r.setEnd(en, eo);
        res.push(r);
      }
    }
    return res;
  }
  function findNext(forward = true) {
    const q = $('#lx-findText').value;
    if (!q) { openFind(); return; }
    const ms = findMatches(q, $('#lx-findCase').checked, $('#lx-findWord').checked);
    if (!ms.length) { status('String not found.'); currentMatch = null; try { CSS.highlights && CSS.highlights.delete('lyxfind'); } catch (e) {} return; }
    const ref = currentMatch && currentMatch.startContainer.isConnected ? currentMatch : (selRange(false) || savedRange);
    let pick = null, wrapped = false;
    if (ref) {
      const pt = document.createRange();
      if (forward) { pt.setStart(ref.endContainer, ref.endOffset); pick = ms.find(m => pt.comparePoint(m.startContainer, m.startOffset) >= 0 && !(currentMatch && m.startContainer === currentMatch.startContainer && m.startOffset === currentMatch.startOffset)); }
      else { pt.setStart(ref.startContainer, ref.startOffset); pick = [...ms].reverse().find(m => pt.comparePoint(m.endContainer, m.endOffset) <= 0 && !(currentMatch && m.startContainer === currentMatch.startContainer && m.startOffset === currentMatch.startOffset)); }
    }
    if (!pick) { pick = forward ? ms[0] : ms[ms.length - 1]; wrapped = !!ref; }
    currentMatch = pick;
    showMatch(pick);
    status(wrapped ? (forward ? 'End of document reached; search continued from the beginning.' : 'Beginning of document reached; search continued from the end.') : '');
  }
  function showMatch(r) {
    try { if (window.Highlight && CSS.highlights) CSS.highlights.set('lyxfind', new Highlight(r)); } catch (e) {}
    savedRange = r.cloneRange();
    if ($('#lx-findbar').hidden || document.activeElement === ed) setSel(r);
    const rect = r.getBoundingClientRect(), wr = workarea.getBoundingClientRect();
    if (rect.top < wr.top + 20 || rect.bottom > wr.bottom - 20) workarea.scrollTop += rect.top - wr.top - wr.height / 2;
  }
  function replaceOne() {
    const q = $('#lx-findText').value, rep = $('#lx-replaceText').value;
    if (!currentMatch || !currentMatch.startContainer.isConnected) { findNext(true); return; }
    pushUndo();
    const r = currentMatch;
    r.deleteContents();
    const t = document.createTextNode(rep); r.insertNode(t);
    const after = document.createRange(); after.setStartAfter(t); after.collapse(true);
    currentMatch = after;
    markDirty(); refresh();
    void q; findNext(true);
  }
  function replaceAll() {
    const q = $('#lx-findText').value, rep = $('#lx-replaceText').value;
    const ms = findMatches(q, $('#lx-findCase').checked, $('#lx-findWord').checked);
    if (!ms.length) { status('String not found.'); return; }
    pushUndo();
    ms.reverse().forEach(r => { r.deleteContents(); r.insertNode(document.createTextNode(rep)); });
    ed.normalize(); currentMatch = null;
    try { CSS.highlights && CSS.highlights.delete('lyxfind'); } catch (e) {}
    markDirty(); refresh();
    status(ms.length === 1 ? '1 string has been replaced.' : `${ms.length} strings have been replaced.`);
  }
  $('#lx-findNextBtn').onclick = () => findNext(true);
  $('#lx-findPrev').onclick = () => findNext(false);
  $('#lx-replaceBtn').onclick = replaceOne;
  $('#lx-replaceAllBtn').onclick = replaceAll;
  $('#lx-findClose').onclick = closeFind;
  $('#lx-findText').addEventListener('input', () => { currentMatch = null; });


  /* =====================================================================
     LaTeX: reading and writing the file
     ===================================================================== */
  function envFor(layout) { return thmEnv[layout] || null; }
  function readPreamble() {
    // the preamble's own theorem names win over the defaults
    thmEnv = {};
    const own = theoremsOf(tex.head.replace(/\\begin\s*\{document\}[\s\S]*$/, ''));
    const re = /\\(?:new|sp)theorem\*?\s*\{([^}]+)\}/g;
    for (let m = re.exec(tex.head); m; m = re.exec(tex.head)) { const env = m[1].trim(); if (own[env] && !thmEnv[own[env]]) thmEnv[own[env]] = env; }
    registerTheorems(tex.theorems);
    tex.macros = macrosOf(tex.head);
    fillLayoutCombo();
  }
  function exportDoc() {
    return exportTex([...ed.children], { head: tex.head, tail: tex.tail, trailing: tex.trailing, chunks: tex.chunks, envFor });
  }
  function getLatex() { return exportDoc().text; }
  /* ---------- Caret ↔ file position ----------
     A block maps to the line its LaTeX starts on (several blocks of an untouched
     chunk share the chunk's line). Inside that span the caret is matched by the
     last word before it and how many times that word occurred so far. */
  const WORD = /[\p{L}\p{N}]+/gu;
  const lineStarts = text => { const a = [0]; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) a.push(i + 1); return a; };
  const blockPlain = b => { const r = document.createRange(); r.selectNodeContents(b); return r.toString(); };
  /** The blocks that start on the same line as `b`, and the offsets of their LaTeX in `text`. */
  function spanOf(b, lines, starts, text) {
    const all = [...ed.children];
    const l = lines.get(b) || 1;
    const group = all.filter(x => lines.get(x) === l);
    let to = text.length;
    for (const x of all) { const lx = lines.get(x); if (lx != null && lx > l) { to = starts[lx - 1] ?? to; break; } }
    return { group, from: starts[l - 1] ?? 0, to };
  }
  /**
   * Offset just after `word` in the n-th word of `s` that starts with it (the caret may be
   * inside a word, so `word` is what precedes the caret). TeX command names are skipped when `tex`.
   */
  function nthWord(s, word, n, tex) {
    let k = 0;
    for (const m of s.matchAll(WORD)) {
      if (!m[0].startsWith(word) || (tex && s[m.index - 1] === '\\')) continue;
      if (++k === n) return m.index + word.length;
    }
    return -1;
  }
  const countPrefixed = (words, word) => words.filter(w => w[0].startsWith(word)).length;
  /** LaTeX with what the document view does not show as text blanked out (same length, so offsets hold). */
  const texVisible = s => s.replace(/\\(?:begin|end)\s*\{[^}]*\}(?:\[[^\]]*\])?|\\(?:item|section|subsection|subsubsection|chapter|part|paragraph|caption)\*?\s*\[[^\]]*\]|\\(?:ref|eqref|pageref|autoref|cref|Cref|nameref|vref)\s*\{[^}]*\}|\\[a-zA-Z@]+/g, m => ' '.repeat(m.length));
  function caretPosition() {
    const b = currentBlock() || ed.firstElementChild;
    const { text, lines } = exportDoc();
    const starts = lineStarts(text);
    const { group, from, to } = spanOf(b, lines, starts, text);
    let off = from;
    const am = activeMath();
    const r = selRange(false) || savedRange;
    if (am) {
      const lt = latexOf(am).trim().slice(0, 40);
      const k = lt ? text.indexOf(lt, from) : -1;
      if (k >= 0 && k < to) off = k;
    } else if (isText(b) && r && b.contains(r.startContainer)) {
      // plain text from the start of the span to the caret
      const before = group.slice(0, group.indexOf(b)).map(blockPlain).join(' ') + ' ' + textBefore(b, r).text;
      const words = [...before.matchAll(WORD)];
      const last = words[words.length - 1];
      if (last) {
        const k = nthWord(texVisible(text.slice(from, to)), last[0], countPrefixed(words, last[0]), true);
        if (k >= 0) {
          off = from + k;
          const tail = before.slice(last.index + last[0].length);
          if (tail && text[off] === tail[0]) off++;
        }
      }
    }
    let line = 1;
    while (line < starts.length && starts[line] <= off) line++;
    return { line, column: off - starts[line - 1] + 1 };
  }
  /** Put the caret where line:column of the file is (as near as the document allows). */
  function revealPosition(line, column = 1) {
    const { text, lines } = exportDoc();
    const starts = lineStarts(text);
    let target = ed.firstElementChild;
    for (const b of ed.children) { const l = lines.get(b); if (l != null && l <= line) target = b; }
    if (!target) return;
    const { group, from } = spanOf(target, lines, starts, text);
    const off = Math.min(text.length, (starts[line - 1] ?? text.length) + Math.max(0, column - 1));
    const texBefore = texVisible(text.slice(from, Math.max(from, off)));
    const words = [...texBefore.matchAll(WORD)].filter(m => texBefore[m.index - 1] !== '\\');
    const last = words[words.length - 1];
    lastPos = caretPos();
    if (last) {
      let n = countPrefixed(words, last[0]);
      for (const b of group) {
        if (!isText(b)) continue;
        const plain = blockPlain(b);
        const count = countPrefixed([...plain.matchAll(WORD)], last[0]);
        if (n > count) { n -= count; continue; }
        const o = nthWord(plain, last[0], n, false);
        if (o >= 0) {
          b.scrollIntoView({ block: 'center' });
          setCaretPos({ i: [...ed.children].indexOf(b), o });
          setCurrent(b); updateCombo();
          return;
        }
      }
    }
    // before the first word of the span (or a formula, a TeX box…): the start of the line's block
    const b = group.find(x => x !== undefined) || target;
    b.scrollIntoView({ block: 'center' });
    caretStart(b);
    setCurrent(b); updateCombo();
  }
  /** TeX for one inset (for the LyX export of insets LyX would show differently). */
  function texOfInset(n) { const w = document.createElement('span'); w.append(n.cloneNode(true)); return texInline(w, {}); }
  function load(text, keepView) {
    const pos = keepView ? caretPos() : null;
    const scroll = workarea.scrollTop;
    const hadFocus = root.contains(document.activeElement);
    // a formula about to get the focus (just inserted) gets it again after the reload
    const pendingAt = keepView && pendingMath && pendingMath.isConnected ? [...ed.children].indexOf(pendingMath.closest('.blk')) : -1;
    loading = true;
    try {
      const doc = parseTex(text);
      tex = doc;
      readPreamble();
      ed.innerHTML = '';
      doc.blocks.forEach(b => ed.append(b));
      if (!ed.firstElementChild) ed.append(mkBlock('Standard'));
      $$('math-field', ed).forEach(applyMacros);
      undoStack.length = 0; redoStack.length = 0;
      curBlock = null; savedRange = null; pendingMath = null;
      refresh();
      // what each chunk looks like as LaTeX now: an unchanged chunk is written back as its source text
      const byChunk = new Map();
      for (const b of ed.children) { const id = b.dataset.chunk; if (id != null) { if (!byChunk.has(id)) byChunk.set(id, []); byChunk.get(id).push(b); } }
      tex.chunks.forEach((ch, i) => { ch.gen = genRun(byChunk.get(String(i)) || [], {}, envFor); });
      dirty = false;
    } finally {
      loading = false;
    }
    workarea.scrollTop = keepView ? scroll : 0;
    const pendingMf = pendingAt >= 0 ? ed.children[pendingAt]?.querySelector('math-field') : null;
    if (pendingMf) focusMath(pendingMf, 'start');
    else if (pos && hadFocus) setCaretPos(pos);
    updateCombo();
    updateSource(true);
  }

  /* =====================================================================
     Export: LyX file format (LyX 2.3, format 544)
     ===================================================================== */
  const LYX_ATTRS = ['family', 'series', 'size', 'emph', 'bar', 'strikeout', 'uuline', 'uwave', 'noun'];
  function fmtToLyx(el) {
    const t = el.tagName, c = el.classList;
    if (t === 'EM' || t === 'I') return { emph: 'on' };
    if (t === 'STRONG' || t === 'B') return { series: 'bold' };
    if (t === 'U') return { bar: 'under' };
    if (t === 'S') return { strikeout: 'on' };
    if (c.contains('ftt')) return { family: 'typewriter' };
    if (c.contains('fsf')) return { family: 'sans' };
    if (c.contains('frm')) return { family: 'roman' };
    if (c.contains('noun')) return { noun: 'on' };
    if (c.contains('uuline')) return { uuline: 'on' };
    if (c.contains('uwave')) return { uwave: 'on' };
    const sz = [...c].find(x => x.startsWith('sz-'));
    if (sz) return { size: sz.slice(3) };
    return {};
  }
  function syncFont(want, st, out) {
    for (const a of LYX_ATTRS) {
      const w = want[a] || null, s = st[a] || null;
      if (w !== s) { out.push(`\\${a} ${w || 'default'}`); st[a] = w; }
    }
  }
  function lyxText(s, out) {
    s = s.replace(/\u200B/g, '').replace(/\u00a0/g, ' ');
    if (!s) return;
    const parts = s.split(/(\\|[\u201c\u201d\u2018\u2019])/);
    for (const p of parts) {
      if (!p) continue;
      if (p === '\\') out.push('\\backslash');
      else if (p === '\u201c') out.push('\\begin_inset Quotes eld', '\\end_inset', '');
      else if (p === '\u201d') out.push('\\begin_inset Quotes erd', '\\end_inset', '');
      else if (p === '\u2018') out.push('\\begin_inset Quotes els', '\\end_inset', '');
      else if (p === '\u2019') out.push('\\begin_inset Quotes ers', '\\end_inset', '');
      else out.push(p);
    }
  }
  function lyxBody(body, out, collapsed, ert) {
    out.push('status ' + (collapsed ? 'collapsed' : 'open'), '');
    if (ert) {
      const lines = body.textContent.replace(/\u200B/g, '').split('\n');
      lines.forEach(l => { out.push('\\begin_layout Plain Layout'); lyxText(l, out); out.push('\\end_layout', ''); });
    } else {
      out.push('\\begin_layout Plain Layout');
      const st = {}; lyxWalk(body, {}, out, st); syncFont({}, st, out);
      out.push('\\end_layout', '');
    }
    out.push('\\end_inset');
  }
  function lyxWalk(node, want, out, st) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { const s = n.data.replace(/\u200B/g, ''); if (!s) continue; syncFont(want, st, out); lyxText(s, out); continue; }
      if (n.nodeType !== 1) continue;
      const c = n.classList;
      if (c.contains('mwrap')) { syncFont(want, st, out); out.push('\\begin_inset Formula $' + latexOf(n.querySelector('math-field')) + '$', '\\end_inset'); continue; }
      if (c.contains('sc')) { syncFont(want, st, out); out.push(...(SC[n.dataset.sc] ? SC[n.dataset.sc].lyx : [])); continue; }
      if (c.contains('lb')) { out.push('\\begin_inset Newline ' + (n.dataset.lb || 'newline'), '\\end_inset', ''); continue; }
      if (c.contains('inset')) {
        const t = n.dataset.inset, body = n.querySelector('.ibody'), coll = c.contains('collapsed');
        syncFont(want, st, out);
        if (t === 'Foot' || t === 'Marginal') { out.push('\\begin_inset ' + t); lyxBody(body, out, coll); }
        else if (t === 'Note') { out.push('\\begin_inset Note ' + (n.dataset.note || 'Note')); lyxBody(body, out, coll); }
        else if (t === 'ERT') { out.push('\\begin_inset ERT'); lyxBody(body, out, coll, true); }
        else if (t === 'URL') { out.push('\\begin_inset Flex URL'); lyxBody(body, out, coll); }
        else if (t === 'Label') out.push('\\begin_inset CommandInset label', 'LatexCommand label', `name "${n.dataset.name}"`, '', '\\end_inset');
        else if (t === 'Ref') out.push('\\begin_inset CommandInset ref', 'LatexCommand ' + (n.dataset.cmd || 'ref'), `reference "${n.dataset.name}"`, 'plural "false"', 'caps "false"', 'noprefix "false"', '', '\\end_inset');
        else if (t === 'Href') out.push('\\begin_inset CommandInset href', 'LatexCommand href', `name "${(n.dataset.name || '').replace(/"/g, '\\"')}"`, `target "${n.dataset.target}"`, 'literal "false"', '', '\\end_inset');
        else if (t === 'Cite') out.push('\\begin_inset CommandInset citation', 'LatexCommand ' + (n.dataset.cmd || 'cite'), `key "${n.dataset.keys}"`, 'literal "false"', '', '\\end_inset');
        else if (t === 'Graphics') out.push('\\begin_inset Graphics', `\tfilename ${n.dataset.path}`, '', '\\end_inset');
        else if (t === 'Raw') out.push(...(n.dataset.raw || '').split('\n'));
        else { out.push('\\begin_inset ERT', 'status collapsed', '', '\\begin_layout Plain Layout'); lyxText(texOfInset(n), out); out.push('\\end_layout', '', '\\end_inset'); }
        out.push('');
        continue;
      }
      if (n.tagName === 'SUB' || n.tagName === 'SUP') {
        syncFont(want, st, out);
        out.push('\\begin_inset script ' + (n.tagName === 'SUP' ? 'superscript' : 'subscript'), '', '\\begin_layout Plain Layout');
        const s2 = {}; lyxWalk(n, {}, out, s2); syncFont({}, s2, out);
        out.push('\\end_layout', '', '\\end_inset', '');
        continue;
      }
      if (n.tagName === 'BR') continue;
      lyxWalk(n, { ...want, ...fmtToLyx(n) }, out, st);
    }
  }
  function displayLyx(b) {
    const latex = latexOf(b.querySelector('math-field')).trim();
    const env = b.dataset.env, num = !!b.dataset.numbered, lab = b.dataset.label ? '\\label{' + b.dataset.label + '}' : '';
    let lines;
    if (env) { const name = env + (num ? '' : '*'); lines = [`\\begin_inset Formula \\begin{${name}}`, stripEnv(latex) + lab, `\\end{${name}}`]; }
    else if (num || lab) lines = ['\\begin_inset Formula \\begin{equation}', latex + lab, '\\end{equation}'];
    else lines = ['\\begin_inset Formula \\[', latex, '\\]'];
    return [...lines, '', '\\end_inset', ''];
  }
  function getLyx() {
    const paras = [];
    for (const b of ed.children) {
      const t = b.dataset.type, last = paras[paras.length - 1];
      if (t === '_display') {
        if (last && last.layout !== '_special' && headLevel(last.layout) == null && !FRONT[last.layout] && (+b.dataset.depth || 0) === last.depth) last.items.push(b);
        else paras.push({ layout: b.dataset.ctx && !LISTS[b.dataset.ctx] ? b.dataset.ctx : 'Standard', depth: +b.dataset.depth || 0, items: [b], src: b });
        continue;
      }
      if (b.dataset.cont && last && last.layout !== '_special') { last.items.push(b); continue; }
      if (!isText(b)) { paras.push({ layout: 'Standard', depth: +b.dataset.depth || 0, items: [b], src: b, special: true }); continue; }
      paras.push({ layout: t, depth: +b.dataset.depth || 0, items: [b], src: b });
    }
    const out = [];
    let depth = 0;
    for (const p of paras) {
      while (depth < p.depth) { out.push('\\begin_deeper'); depth++; }
      while (depth > p.depth) { out.push('\\end_deeper'); depth--; }
      out.push('\\begin_layout ' + p.layout);
      const s = p.src;
      if (s.dataset.appendix) out.push('\\start_of_appendix');
      if (s.dataset.noindent) out.push('\\noindent');
      if (s.dataset.align) out.push('\\align ' + s.dataset.align);
      for (const it of p.items) {
        const t = it.dataset.type;
        if (t === '_display') out.push(...displayLyx(it));
        else if (t === '_toc') out.push('\\begin_inset CommandInset toc', 'LatexCommand tableofcontents', '', '\\end_inset', '');
        else if (t === '_newpage') out.push('\\begin_inset Newpage ' + (it.dataset.variant || 'newpage'), '\\end_inset', '');
        else if (t === '_line') out.push('\\begin_inset CommandInset line', 'LatexCommand rule', 'offset "0.5ex"', 'width "100col%"', 'height "1pt"', '', '\\end_inset', '');
        else { const st = {}; lyxWalk(it, {}, out, st); syncFont({}, st, out); }
      }
      out.push('\\end_layout', '');
    }
    while (depth > 0) { out.push('\\end_deeper'); depth--; }
    const H = ['#LyX 2.3 created this file. For more info see http://www.lyx.org/', '\\lyxformat 544', '\\begin_document', '\\begin_header',
      '\\save_transient_properties true', '\\origin unavailable', '\\textclass article'];
    if (docSettings.preamble.trim()) H.push('\\begin_preamble', docSettings.preamble.trim(), '\\end_preamble');
    H.push('\\use_default_options true', '\\begin_modules', 'theorems-ams', '\\end_modules', '\\maintain_unincluded_children false',
      '\\language english', '\\language_package default', '\\inputencoding auto', '\\fontencoding global',
      '\\font_roman "default" "default"', '\\font_sans "default" "default"', '\\font_typewriter "default" "default"', '\\font_math "auto" "auto"',
      '\\font_default_family default', '\\use_non_tex_fonts false', '\\font_sc false', '\\font_osf false', '\\font_sf_scale 100 100', '\\font_tt_scale 100 100',
      '\\use_microtype false', '\\use_dash_ligatures true', '\\graphics default', '\\default_output_format default', '\\output_sync 0',
      '\\bibtex_command default', '\\index_command default', '\\paperfontsize ' + docSettings.fontsize, '\\spacing single', '\\use_hyperref false',
      '\\papersize ' + docSettings.papersize, '\\use_geometry false', '\\use_package amsmath 1', '\\use_package amssymb 1', '\\use_package cancel 1',
      '\\use_package esint 1', '\\use_package mathdots 1', '\\use_package mathtools 1', '\\use_package mhchem 1', '\\use_package stackrel 1',
      '\\use_package stmaryrd 1', '\\use_package undertilde 1', '\\cite_engine basic', '\\cite_engine_type default', '\\biblio_style plain',
      '\\use_bibtopic false', '\\use_indices false', '\\paperorientation portrait', '\\suppress_date false', '\\justification true',
      '\\use_refstyle 1', '\\use_minted 0', '\\index Index', '\\shortcut idx', '\\color #008000', '\\end_index', '\\secnumdepth 3', '\\tocdepth 3',
      '\\paragraph_separation indent', '\\paragraph_indentation default', '\\is_math_indent 0', '\\math_numbering_side default', '\\quotes_style english',
      '\\dynamic_quotes 0', '\\papercolumns 1', '\\papersides 1', '\\paperpagestyle default', '\\tracking_changes false', '\\output_changes false',
      '\\html_math_output 0', '\\html_css_as_file 0', '\\html_be_strict false', '\\end_header', '', '\\begin_body', '');
    return H.join('\n') + '\n' + out.join('\n') + '\n\\end_body\n\\end_document\n';
  }

  /* =====================================================================
     Import: LyX file format
     ===================================================================== */
  function parseLyx(text) {
    const L = text.replace(/\r/g, '').split('\n');
    const settings = { fontsize: 'default', papersize: 'default', preamble: '' };
    let i = 0;
    for (; i < L.length && L[i] !== '\\begin_body'; i++) {
      const ln = L[i];
      if (ln.startsWith('\\paperfontsize ')) settings.fontsize = ln.slice(15).trim();
      else if (ln.startsWith('\\papersize ')) settings.papersize = ln.slice(11).trim();
      else if (ln === '\\begin_preamble') { const pre = []; i++; while (i < L.length && L[i] !== '\\end_preamble') pre.push(L[i++]); settings.preamble = pre.join('\n'); }
    }
    i++;
    const blocks = [];
    let depth = 0;
    while (i < L.length) {
      const ln = L[i];
      if (ln.startsWith('\\begin_layout ')) {
        const layout = ln.slice(14).trim(); i++;
        const ctx = { L, i };
        const p = parseParagraph(ctx);
        i = ctx.i;
        emitParagraph(blocks, layout, depth, p);
      } else if (ln === '\\begin_deeper') { depth++; i++; }
      else if (ln === '\\end_deeper') { depth = Math.max(0, depth - 1); i++; }
      else if (ln === '\\end_body') break;
      else i++;
    }
    return { blocks, settings };
  }
  function collectInset(ctx) {
    const lines = [ctx.L[ctx.i]]; let lvl = 1; ctx.i++;
    while (ctx.i < ctx.L.length && lvl > 0) {
      const ln = ctx.L[ctx.i];
      if (ln.startsWith('\\begin_inset')) lvl++;
      else if (ln === '\\end_inset') lvl--;
      lines.push(ln); ctx.i++;
    }
    return lines;
  }
  function parseParagraph(ctx) {
    const segs = [];
    let frag = document.createDocumentFragment();
    const params = {};
    const st = {};
    const pushText = s => {
      if (!s) return;
      let node = document.createTextNode(s);
      const wraps = [];
      if (st.emph === 'on' || st.shape === 'italic' || st.shape === 'slanted') wraps.push(document.createElement('em'));
      if (st.series === 'bold') wraps.push(document.createElement('strong'));
      if (st.bar === 'under') wraps.push(document.createElement('u'));
      if (st.strikeout === 'on') wraps.push(document.createElement('s'));
      const cls = { typewriter: 'ftt', sans: 'fsf', roman: 'frm' }[st.family];
      if (cls) { const s2 = document.createElement('span'); s2.className = cls; wraps.push(s2); }
      if (st.noun === 'on') { const s2 = document.createElement('span'); s2.className = 'noun'; wraps.push(s2); }
      if (st.uuline === 'on') { const s2 = document.createElement('span'); s2.className = 'uuline'; wraps.push(s2); }
      if (st.uwave === 'on') { const s2 = document.createElement('span'); s2.className = 'uwave'; wraps.push(s2); }
      if (st.size && SIZES.includes(st.size) && st.size !== 'normal') { const s2 = document.createElement('span'); s2.className = 'sz-' + st.size; wraps.push(s2); }
      const sig = wraps.map(w => w.tagName + '.' + w.className).join('>');
      const last = frag.lastChild;
      if (!wraps.length && last && last.nodeType === 3) { last.data += s; return; }
      if (wraps.length && last && last._sig === sig) { let t = last; while (t.firstChild) t = t.lastChild; if (t.nodeType === 3) { t.data += s; return; } }
      for (const w of wraps.reverse()) { w.append(node); node = w; }
      if (wraps.length) node._sig = sig;
      frag.append(node);
    };
    while (ctx.i < ctx.L.length) {
      const ln = ctx.L[ctx.i];
      if (ln === '\\end_layout') { ctx.i++; break; }
      if (ln === '') { ctx.i++; continue; }
      if (ln.startsWith('\\begin_inset')) {
        const lines = collectInset(ctx);
        const r = parseInset(lines, st);
        if (r.display) { segs.push({ inline: frag }); frag = document.createDocumentFragment(); segs.push({ display: r.display }); }
        else if (r.block) { segs.push({ inline: frag }); frag = document.createDocumentFragment(); segs.push({ block: r.block }); }
        else if (r.node) frag.append(r.node);
        else if (r.text) pushText(r.text);
        continue;
      }
      if (ln === '\\backslash') { pushText('\\'); ctx.i++; continue; }
      let m;
      if ((m = /^\\(emph|series|shape|family|bar|strikeout|uuline|uwave|noun|size|color|lang|xout|numeric)\s+(.*)$/.exec(ln))) { st[m[1]] = m[2] === 'default' ? null : m[2]; ctx.i++; continue; }
      if ((m = /^\\align\s+(\S+)/.exec(ln))) { params.align = m[1]; ctx.i++; continue; }
      if (ln === '\\noindent') { params.noindent = true; ctx.i++; continue; }
      if (ln === '\\start_of_appendix') { params.appendix = true; ctx.i++; continue; }
      if ((m = /^\\SpecialChar\s+(.*)$/.exec(ln))) {
        const v = m[1].trim();
        const k = SC_LYX[v] || SC_LYX_OLD[v];
        if (k) frag.append(mkSC(k));
        else pushText({ LyX: 'LyX', TeX: 'TeX', LaTeX: 'LaTeX', LaTeX2e: 'LaTeX2e', '\\LyX{}': 'LyX', '\\TeX{}': 'TeX', '\\LaTeX{}': 'LaTeX', '\\LaTeXe{}': 'LaTeX2e' }[v] || v.replace(/^\\/, ''));
        ctx.i++; continue;
      }
      if (ln.startsWith('\\')) { ctx.i++; continue; }
      pushText(ln); ctx.i++;
    }
    segs.push({ inline: frag });
    return { segs, params };
  }
  function innerParagraphs(lines) {
    const ctx = { L: lines, i: 0 };
    const frags = [];
    while (ctx.i < lines.length) {
      if (lines[ctx.i].startsWith('\\begin_layout')) { ctx.i++; const p = parseParagraph(ctx); const f = document.createDocumentFragment(); p.segs.forEach(s => { if (s.inline) f.append(s.inline); else if (s.display) { const w = mkMath(latexOf(s.display.querySelector('math-field'))); f.append(w); } }); frags.push(f); }
      else ctx.i++;
    }
    return frags;
  }
  function ertText(lines) {
    const paras = []; let cur = null;
    for (const ln of lines) {
      if (ln.startsWith('\\begin_layout')) { cur = ''; continue; }
      if (ln === '\\end_layout') { if (cur != null) paras.push(cur); cur = null; continue; }
      if (cur == null) continue;
      if (ln === '\\backslash') cur += '\\';
      else if (ln.startsWith('\\')) continue;
      else cur += ln;
    }
    return paras.join('\n');
  }
  function parseInset(lines, st) {
    const head = lines[0].replace(/^\\begin_inset\s+/, '');
    const inner = lines.slice(1, -1);
    const kv = k => { const l = inner.find(x => x.startsWith(k + ' ')); return l ? l.slice(k.length + 1).replace(/^"|"$/g, '') : ''; };
    const coll = inner.includes('status collapsed');
    if (head.startsWith('Formula')) {
      let f = (head.slice(7).trim() + '\n' + inner.join('\n')).trim();
      let m;
      if ((m = /^\$([\s\S]*)\$$/.exec(f)) || (m = /^\\\(([\s\S]*)\\\)$/.exec(f))) return { node: mkMath(m[1].trim()) };
      let label = '';
      f = f.replace(/\\label\{([^}]*)\}/, (x, n) => { label = n; return ''; });
      if ((m = /^\\\[([\s\S]*)\\\]$/.exec(f))) return { display: mkDisplay(m[1].trim(), false, '', label) };
      if ((m = /^\\begin\{(equation\*?)\}([\s\S]*)\\end\{\1\}$/.exec(f))) return { display: mkDisplay(m[2].trim(), !m[1].endsWith('*'), '', label) };
      if ((m = /^\\begin\{(eqnarray|align|alignat|flalign|gather|multline)(\*?)\}(\{[^}]*\})?([\s\S]*)\\end\{\1\2\}$/.exec(f))) return { display: mkDisplay(envWrap(m[1], m[4].trim()), !m[2], m[1], label) };
      return { display: mkDisplay(f, false, '', label) };
    }
    const bodyInset = (type, variant) => {
      const ins = mkInset(type, variant, null);
      const body = ins.querySelector('.ibody'); body.textContent = '';
      if (type === 'ERT') body.textContent = ertText(inner) || ZW;
      else { const ps = innerParagraphs(inner); ps.forEach((p, k) => { if (k) body.append(' '); body.append(p); }); if (!body.childNodes.length) body.textContent = ZW; }
      if (coll) ins.classList.add('collapsed');
      return { node: ins };
    };
    if (head === 'Foot' || head === 'Marginal') return bodyInset(head);
    if (head.startsWith('Note')) return bodyInset('Note', head.split(/\s+/)[1] || 'Note');
    if (head === 'ERT') return bodyInset('ERT');
    if (head === 'Flex URL') return bodyInset('URL');
    if (head.startsWith('Flex ') || head.startsWith('CharStyle ')) {
      const name = head.replace(/^(Flex|CharStyle)\s+/, '').trim();
      const wrap = { Code: ['span', 'ftt'], Noun: ['span', 'noun'], Emph: ['em', ''], Strong: ['strong', ''], 'Strikethrough': ['s', ''], Typewriter: ['span', 'ftt'] }[name];
      const el = wrap ? document.createElement(wrap[0]) : document.createDocumentFragment();
      if (wrap && wrap[1]) el.className = wrap[1];
      innerParagraphs(inner).forEach((p, k) => { if (k) el.append(' '); el.append(p); });
      return wrap ? { node: el } : { node: (() => { const s = document.createElement('span'); s.append(el); return s; })() };
    }
    if (head === 'CommandInset label') return { node: mkAtom('Label', { name: kv('name') }) };
    if (head === 'CommandInset ref') { const c = kv('LatexCommand') || 'ref'; return { node: mkAtom('Ref', { name: kv('reference'), cmd: ['ref', 'eqref', 'pageref'].includes(c) ? c : 'ref' }) }; }
    if (head === 'CommandInset href') return { node: mkAtom('Href', { name: kv('name'), target: kv('target') }) };
    if (head === 'CommandInset toc') return { block: mkSpecial('_toc') };
    if (head === 'CommandInset line') return { block: mkSpecial('_line') };
    if (head.startsWith('Newpage')) return { block: mkSpecial('_newpage', head.split(/\s+/)[1]) };
    if (head.startsWith('Newline')) return { node: mkLB(head.split(/\s+/)[1] || 'newline') };
    if (head.startsWith('space')) {
      const a = head.slice(5).trim();
      const k = a === '~' ? 'protected' : a.startsWith('\\thinspace') ? 'thin' : a.startsWith('\\textvisiblespace') ? 'visible' : a.startsWith('\\space') ? 'normal' : 'protected';
      return { node: mkSC(k) };
    }
    if (head.startsWith('Quotes')) {
      const c = head.split(/\s+/)[1] || 'eld';
      const left = c[1] === 'l', dbl = c[2] !== 's';
      return { text: dbl ? (left ? '\u201c' : '\u201d') : (left ? '\u2018' : '\u2019') };
    }
    if (head.startsWith('script')) {
      const el = document.createElement(head.includes('super') ? 'sup' : 'sub');
      innerParagraphs(inner).forEach(p => el.append(p));
      return { node: el };
    }
    return { node: mkAtom('Raw', { kind: head.split(/\s+/)[0] === 'CommandInset' ? head.split(/\s+/)[1] : head.split(/\s+/)[0], raw: lines.join('\n') }) };
  }
  function emitParagraph(blocks, layout, depth, p) {
    let first = true, sawDisplay = false;
    for (const s of p.segs) {
      if (s.display) {
        if (depth) s.display.dataset.depth = depth;
        blocks.push(s.display); sawDisplay = true; first = false; continue;
      }
      if (s.block) { blocks.push(s.block); first = false; continue; }
      const f = s.inline;
      const empty = !f.childNodes.length || (f.textContent.replace(/\u200B/g, '').trim() === '' && !f.querySelector('*'));
      if (empty && (!first || p.segs.length > 1)) continue;
      const b = mkBlock(layout); b.innerHTML = ''; b.append(f);
      if (!b.childNodes.length) b.innerHTML = '<br>';
      if (depth) b.dataset.depth = depth;
      if (first) {
        if (p.params.align && p.params.align !== 'default') b.dataset.align = p.params.align;
        if (p.params.noindent) b.dataset.noindent = '1';
        if (p.params.appendix) b.dataset.appendix = '1';
      }
      if (!first && sawDisplay) b.dataset.cont = '1';
      blocks.push(b); first = false;
    }
  }

  /* =====================================================================
     Export: plain text and HTML
     ===================================================================== */
  function plainExportOf(node) {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { s += n.data.replace(/\u200B/g, ''); continue; }
      if (n.nodeType !== 1) continue;
      const c = n.classList;
      if (c.contains('blk')) {
        const t = n.dataset.type;
        if (t === '_display') { s += '\n' + latexOf(n.querySelector('math-field')) + '\n'; continue; }
        const prefix = n.dataset.num && n.dataset.num !== '' ? n.dataset.num + ' ' : '';
        s += (s ? '\n' : '') + '  '.repeat(+n.dataset.depth || 0) + prefix + plainExportOf(n).trim() + '\n';
        continue;
      }
      if (c.contains('mwrap')) { s += '$' + latexOf(n.querySelector('math-field')) + '$'; continue; }
      if (c.contains('sc')) { s += SC[n.dataset.sc] ? SC[n.dataset.sc].txt : ''; continue; }
      if (c.contains('lb')) { s += '\n'; continue; }
      if (c.contains('inset')) {
        const t = n.dataset.inset;
        if (t === 'Foot') s += '[footnote: ' + plainExportOf(n.querySelector('.ibody')).trim() + ']';
        else if (t === 'URL') s += plainExportOf(n.querySelector('.ibody'));
        else if (t === 'Ref' || t === 'Href') s += n.textContent;
        else if (t === 'Tabular') s += '\n' + rowsOf(n).map(tr => [...tr.cells].map(td => plainExportOf(cellBody(td)).trim()).join('\t')).join('\n') + '\n';
        continue;
      }
      if (n.tagName === 'BR') continue;
      s += plainExportOf(n);
    }
    return s;
  }
  function getText() { return plainExportOf(ed).replace(/\n{3,}/g, '\n\n').trim() + '\n'; }
  function toMathML(latex, display) {
    try { if (ML && ML.convertLatexToMathMl) return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${ML.convertLatexToMathMl(latex)}</math>`; } catch (e) {}
    return `<code>${esc(display ? '\\[' + latex + '\\]' : '$' + latex + '$')}</code>`;
  }
  function inlineHtml(node, notes) {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { s += esc(n.data.replace(/\u200B/g, '')); continue; }
      if (n.nodeType !== 1) continue;
      const c = n.classList;
      if (c.contains('mwrap')) { s += toMathML(latexOf(n.querySelector('math-field')), false); continue; }
      if (c.contains('sc')) { s += esc(SC[n.dataset.sc] ? (n.dataset.sc === 'protected' ? '\u00a0' : SC[n.dataset.sc].txt) : ''); continue; }
      if (c.contains('lb')) { s += '<br>'; continue; }
      if (c.contains('inset')) {
        const t = n.dataset.inset;
        if (t === 'Foot' || t === 'Marginal') { notes.push(inlineHtml(n.querySelector('.ibody'), notes)); s += `<sup><a href="#fn${notes.length}" id="fr${notes.length}">${notes.length}</a></sup>`; }
        else if (t === 'URL') { const u = n.querySelector('.ibody').textContent.replace(/\u200B/g, '').trim(); s += `<a href="${esc(u)}">${esc(u)}</a>`; }
        else if (t === 'Href') s += `<a href="${esc(n.dataset.target)}">${esc(n.dataset.name || n.dataset.target)}</a>`;
        else if (t === 'Ref') s += esc(n.textContent);
        else if (t === 'Label') s += `<a id="${esc(n.dataset.name)}"></a>`;
        else if (t === 'Note' && n.dataset.note === 'Greyedout') s += `<span style="color:gray">${inlineHtml(n.querySelector('.ibody'), notes)}</span>`;
        else if (t === 'Tabular') s += '<table style="border-collapse:collapse;display:inline-table">' + rowsOf(n).map(tr => '<tr>' + [...tr.cells].map(td => `<td${td.colSpan > 1 ? ` colspan="${td.colSpan}"` : ''} style="${esc(td.getAttribute('style') || '')};padding:2px 8px">${inlineHtml(cellBody(td), notes)}</td>`).join('') + '</tr>').join('') + '</table>';
        continue;
      }
      if (n.tagName === 'BR') continue;
      const inner = inlineHtml(n, notes);
      const tag = n.tagName.toLowerCase();
      if (['em', 'i', 'strong', 'b', 'u', 's', 'sub', 'sup'].includes(tag)) s += `<${tag}>${inner}</${tag}>`;
      else if (c.contains('ftt')) s += `<code>${inner}</code>`;
      else if (c.contains('noun')) s += `<span style="font-variant:small-caps">${inner}</span>`;
      else s += inner;
    }
    return s;
  }
  function getHtml() {
    const notes = [];
    const body = [];
    for (const b of ed.children) {
      const t = b.dataset.type, d = +b.dataset.depth || 0;
      const style = d ? ` style="margin-left:${d * 1.8}em"` : '';
      if (t === '_display') { body.push(`<div class="disp"${style}>${toMathML(latexOf(b.querySelector('math-field')), true)}${b.dataset.numbered ? `<span class="eqn">(${b.dataset.num})</span>` : ''}</div>`); continue; }
      if (t === '_toc') { body.push('<nav class="toc">' + b.querySelector('.tocl').innerHTML + '</nav>'); continue; }
      if (t === '_newpage') { body.push('<div style="page-break-after:always"></div>'); continue; }
      if (t === '_line') { body.push('<hr>'); continue; }
      const c = inlineHtml(b, notes);
      const num = b.dataset.num ? `<span class="lbl">${esc(b.dataset.num)}</span> ` : '';
      const lvl = headLevel(t);
      if (lvl != null) { const h = Math.min(6, lvl + 1); body.push(`<h${h}>${num}${c}</h${h}>`); continue; }
      if (t === 'Title') { body.push(`<h1 class="title">${c}</h1>`); continue; }
      if (t === 'Author' || t === 'Date') { body.push(`<p class="author">${c}</p>`); continue; }
      const cls = THM[t] ? ' class="thm thm-' + THM[t] + '"' : t === 'LyX-Code' ? ' class="code"' : ENVS[t] ? ' class="quote"' : LISTS[t] ? ' class="item"' : '';
      body.push(`<p${cls}${style}${b.dataset.align ? ` align="${b.dataset.align === 'block' ? 'justify' : b.dataset.align}"` : ''}>${num}${c}</p>`);
    }
    const fn = notes.length ? '<hr><ol class="notes">' + notes.map((n, k) => `<li id="fn${k + 1}">${n} <a href="#fr${k + 1}">\u21A9</a></li>`).join('') + '</ol>' : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(baseName())}</title><style>
  body{font:17px/1.6 Georgia,"Times New Roman",serif;max-width:46em;margin:3em auto;padding:0 1.5em;color:#111}
  .title{text-align:center;font-family:system-ui,sans-serif}.author{text-align:center;font-style:italic}
  .lbl{font-weight:bold;margin-right:.3em}.thm-plain{font-style:italic}.thm-plain .lbl,.thm-definition .lbl{font-style:normal}
  .thm-remark .lbl,.thm-proof .lbl{font-style:italic;font-weight:normal}.disp{position:relative;text-align:center;margin:1em 0}.eqn{position:absolute;right:0;top:50%;transform:translateY(-50%)}
  .quote{margin-left:2.5em;margin-right:2.5em}.code{font-family:monospace;white-space:pre-wrap}.item{margin:.2em 0 .2em 1.8em;text-indent:-1.6em}
  .notes{font-size:.9em}@media print{.bar{display:none}}.bar{position:fixed;top:8px;right:8px}
  </style></head><body><div class="bar"><button onclick="print()">Print / Save as PDF</button></div>${body.join('\n')}${fn}</body></html>`;
  }


  /* =====================================================================
     Files
     ===================================================================== */
  function exportAs(fmt) {
    if (fmt === 'pdflatex' || fmt === 'latex') download(baseName() + '.tex', getLatex(), 'text/x-tex');
    else if (fmt === 'lyx23x' || fmt === 'lyx') download(baseName() + '.lyx', getLyx(), 'application/x-lyx');
    else if (fmt === 'text') download(baseName() + '.txt', getText());
    else if (fmt === 'xhtml') download(baseName() + '.html', getHtml(), 'text/html');
    else { status('Command disabled'); return; }
    status('Document exported.');
  }
  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = $('#lx-fileInput'); inp.value = ''; inp.accept = accept;
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
    });
  }
  async function insertFile(kind) {
    const f = await pickFile(kind === 'lyx' ? '.lyx' : '.txt,text/plain');
    if (!f) return;
    const text = await f.text();
    if (kind === 'lyx') {
      const p = parseLyx(text);
      const b = currentBlock();
      pushUndo();
      let anchor = b;
      p.blocks.forEach(x => { if (anchor) anchor.after(x); else ed.append(x); anchor = x; });
      refresh(); markDirty();
    } else {
      const paras = kind === 'para' ? text.replace(/\r/g, '').split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()) : text.replace(/\r/g, '').split('\n');
      pasteText(paras.join('\n'));
    }
  }

  /* =====================================================================
     Dialogs
     ===================================================================== */
  let dlgResolve = null;
  function openDialog({ title, body, buttons, onOpen }) {
    const dlg = $('#lx-dlg');
    if (dlg.open) dlg.close('');
    $('#lx-dlgTitle').textContent = title;
    const bd = $('#lx-dlgBody'); bd.innerHTML = '';
    if (typeof body === 'string') bd.innerHTML = body; else bd.append(body);
    const bt = $('#lx-dlgButtons'); bt.innerHTML = '';
    (buttons || [['Close', 'close', true]]).forEach(([label, value, def]) => {
      const b = document.createElement('button');
      b.type = 'submit'; b.value = value; b.textContent = label; if (def) b.className = 'def';
      bt.append(b);
    });
    dlg.returnValue = '';
    dlg.showModal();
    const firstField = bd.querySelector('input,select,textarea');
    (firstField || bt.querySelector('.def') || bt.lastChild).focus();
    if (onOpen) onOpen(bd);
    return new Promise(res => { dlgResolve = res; });
  }
  $('#lx-dlg').addEventListener('close', () => {
    const r = dlgResolve; dlgResolve = null;
    const form = $('#lx-dlgForm');
    const fields = {};
    [...form.elements].forEach(el => { if (el.name) fields[el.name] = el.type === 'checkbox' ? { value: el.checked, checked: el.checked } : el; });
    if (r) r({ value: $('#lx-dlg').returnValue, form: fields });
    if (!document.activeElement || document.activeElement === document.body) selRange(true);
  });
  $('#lx-dlgForm').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      const def = $('#lx-dlgButtons .def'); if (def) def.click();
    }
  });
  async function promptDialog(title, label, def) {
    const res = await openDialog({ title, body: `<label class="row"><span>${esc(label)}</span><input type="text" name="v" value="${esc(def || '')}" spellcheck="false"></label>`,
      buttons: [['Cancel', ''], ['OK', 'ok', true]], onOpen: bd => { const i = bd.querySelector('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
    if (res.value !== 'ok') return null;
    return res.form.v.value.trim() || null;
  }

  async function documentSettings() {
    const at = tex.head.search(/\\begin\s*\{document\}/);
    if (at < 0) {
      openDialog({ title: 'Document Settings', body: `<p>This file has no preamble: it is part of a larger document (it is included with <code>\\input</code> or <code>\\include</code>).</p><p>Open the main file to change the document class or the preamble.</p>` });
      return;
    }
    const m = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(tex.head);
    const start = m ? m.index + m[0].length : 0;
    const pre = tex.head.slice(start, at).replace(/^\n/, '').replace(/\n+$/, '');
    const res = await openDialog({ title: 'Document Settings', body: `
      <fieldset><legend>Document Class</legend>
        <label class="row"><span>Class:</span><input type="text" name="cls" value="${esc(m ? m[2] : '')}" spellcheck="false"></label>
        <label class="row"><span>Class options:</span><input type="text" name="opts" value="${esc(m ? m[1] || '' : '')}" placeholder="11pt, a4paper" spellcheck="false"></label></fieldset>
      <fieldset><legend>LaTeX Preamble</legend><textarea name="preamble" spellcheck="false" rows="14">${esc(pre)}</textarea>
        <p class="hint">Packages, macros and theorem definitions. New layouts (theorems, lists, links) add what they need here when you use them.</p></fieldset>`,
      buttons: [['Cancel', ''], ['OK', 'ok', true]] });
    if (res.value !== 'ok') return;
    const cls = res.form.cls.value.trim(), opts = res.form.opts.value.trim();
    const dc = cls ? `\\documentclass${opts ? '[' + opts + ']' : ''}{${cls}}` : '';
    const before = m ? tex.head.slice(0, m.index) : '';
    const head = before + dc + '\n' + res.form.preamble.value.replace(/\s+$/, '') + '\n\n' + tex.head.slice(at);
    if (head === tex.head) return;
    tex.head = head;
    tex.theorems = { ...tex.theorems, ...theoremsOf(head) };
    readPreamble();
    $$('math-field', ed).forEach(applyMacros);
    markDirty(); refresh();
    status('Document settings changed.');
  }

  async function paragraphSettings() {
    const b = currentBlock(); if (!b || !isText(b)) { status('Command disabled'); return; }
    const al = b.dataset.align || 'default';
    const res = await openDialog({ title: 'Paragraph Settings', body: `
      <fieldset><legend>Alignment</legend>${['default', 'block', 'left', 'right', 'center'].map(a => `<label style="display:block"><input type="radio" name="align" value="${a}" ${al === a ? 'checked' : ''}> ${{ default: 'Default', block: 'Justified', left: 'Left', right: 'Right', center: 'Center' }[a]}</label>`).join('')}</fieldset>
      <label><input type="checkbox" name="indent" ${b.dataset.noindent ? '' : 'checked'}> Indent paragraph</label>`, buttons: [['Cancel', ''], ['OK', 'ok', true]] });
    if (res.value !== 'ok') return;
    pushUndo();
    const sel = $('#lx-dlgForm').querySelector('input[name=align]:checked');
    const a = sel ? sel.value : 'default';
    if (a === 'default') delete b.dataset.align; else b.dataset.align = a;
    if (res.form.indent.checked) delete b.dataset.noindent; else b.dataset.noindent = '1';
    markDirty(); refresh();
  }

  async function preferencesDialog() {
    const res = await openDialog({ title: 'Preferences', body: `
      <fieldset><legend>Look and Feel</legend>
        <label class="row"><span>Screen zoom (%):</span><input type="number" name="zoom" min="50" max="300" step="10" value="${prefs.zoom}"></label>
        <p class="hint">The color scheme follows gitlatex's theme.</p></fieldset>
      <fieldset><legend>Editing</legend>
        <label><input type="checkbox" name="dollar" ${prefs.dollarMath ? 'checked' : ''}> Typing $ starts a formula (LyX itself types a literal $)</label><br>
        <label><input type="checkbox" name="bs" ${prefs.backslashTex ? 'checked' : ''}> Typing \\ starts a TeX-code box</label></fieldset>`,
      buttons: [['Cancel', ''], ['OK', 'ok', true]] });
    if (res.value !== 'ok') return;
    prefs.zoom = Math.max(50, Math.min(300, +res.form.zoom.value || 100)); prefs.dollarMath = res.form.dollar.checked; prefs.backslashTex = res.form.bs.checked;
    applyPrefs(); savePrefs();
  }

  function statisticsDialog() {
    const r = selRange(false);
    const src = r && !r.collapsed ? r.toString() : plainExportOf(ed);
    const text = src.replace(/\u200B/g, '').replace(/\$[^$]*\$/g, ' ');
    const words = (text.match(/\S+/g) || []).length;
    const chars = text.replace(/\n/g, '').length, nob = text.replace(/\s/g, '').length;
    const formulas = $$('math-field', ed).length;
    openDialog({ title: 'Statistics', body: `<table>
      <tr><th>${r && !r.collapsed ? 'Selection' : 'Document'}</th><th></th></tr>
      <tr><td>Words</td><td>${words}</td></tr><tr><td>Characters (including blanks)</td><td>${chars}</td></tr>
      <tr><td>Characters (excluding blanks)</td><td>${nob}</td></tr><tr><td>Formulas</td><td>${formulas}</td></tr></table>` });
  }
  function shortcutsDialog() {
    const rows = BINDS.map(b => {
      const name = lfunName(b.lfun);
      const st = NATIVE.has(name) ? 'browser' : isImplemented(b.lfun) ? '' : 'na';
      return `<tr data-q="${esc((keyLabel(b.seq) + ' ' + b.lfun).toLowerCase())}"><td class="k">${esc(keyLabel(b.seq))}</td><td class="${st}">${esc(b.lfun)}${st === 'na' ? ' <i>(not in this web version)</i>' : ''}</td></tr>`;
    }).join('');
    openDialog({ title: 'Keyboard Shortcuts (cua.bind)', body: `<input type="text" placeholder="Filter, for example Alt+P or math-insert" id="lx-kbFilter" style="margin-bottom:8px">
      <table><thead><tr><th>Shortcut</th><th>LyX function</th></tr></thead><tbody id="lx-kbRows">${rows}</tbody></table>`,
      onOpen: bd => { const f = bd.querySelector('#lx-kbFilter'); f.addEventListener('input', () => { const q = f.value.toLowerCase(); $$('#lx-kbRows tr').forEach(tr => { tr.hidden = !!q && !tr.dataset.q.includes(q); }); }); } });
  }
  function aboutDialog() {
    openDialog({ title: 'About the LyX-style editor', body: `<p><b>LyX-style editor for gitlatex</b></p>
      <p>An independent, browser-based recreation of the LyX document processor's interface. It is not affiliated with the LyX project.</p>
      <p>Key bindings follow LyX's own <code>cua.bind</code>, <code>menus.bind</code> and <code>math.bind</code> files, and the menus follow LyX's <code>stdmenus.inc</code>. Formulas are edited with the open-source MathLive library.</p>
      <p>It edits the project's <code>.tex</code> files directly: what it cannot show as a layout, formula or inset stays as TeX code (the red boxes), and paragraphs you do not touch are written back exactly as they were.</p>` });
  }
  async function delimiterDialog() {
    const pairs = [['( )', '(', ')'], ['[ ]', '[', ']'], ['{ }', '\\{', '\\}'], ['\u27E8 \u27E9', '\\langle', '\\rangle'], ['| |', '|', '|'], ['\u2016 \u2016', '\\|', '\\|'], ['\u230A \u230B', '\\lfloor', '\\rfloor'], ['\u2308 \u2309', '\\lceil', '\\rceil']];
    const res = await openDialog({ title: 'Math Delimiter', body: `<select class="lst" name="d" size="8">${pairs.map((p, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${p[0]}</option>`).join('')}</select>`, buttons: [['Cancel', ''], ['Insert', 'ok', true]] });
    if (res.value !== 'ok') return;
    const p = pairs[+res.form.d.value];
    mathInsert(`\\left${p[1]}#@\\right${p[2]}`);
  }
  async function matrixDialog() {
    const res = await openDialog({ title: 'Math Matrix', body: `
      <label class="row"><span>Rows:</span><input type="number" name="r" value="2" min="1" max="12"></label>
      <label class="row"><span>Columns:</span><input type="number" name="c" value="2" min="1" max="12"></label>
      <label class="row"><span>Decoration:</span><select name="t"><option value="matrix">None</option><option value="pmatrix">( )</option><option value="bmatrix">[ ]</option><option value="Bmatrix">{ }</option><option value="vmatrix">| |</option><option value="Vmatrix">\u2016 \u2016</option></select></label>`,
      buttons: [['Cancel', ''], ['Insert', 'ok', true]] });
    if (res.value !== 'ok') return;
    const rows = Math.max(1, Math.min(12, +res.form.r.value || 2)), cols = Math.max(1, Math.min(12, +res.form.c.value || 2));
    const body = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 && j === 0 ? '#@' : '#?')).join('&')).join('\\\\');
    mathInsert(`\\begin{${res.form.t.value}}${body}\\end{${res.form.t.value}}`);
  }
  async function hrefInsert(atom) {
    const r = selRange(true);
    const sel = atom ? '' : r && !r.collapsed ? r.toString().replace(/\u200B/g, '') : '';
    const target = atom ? atom.dataset.target : /^https?:/.test(sel) ? sel : 'https://';
    const name = atom ? atom.dataset.name || '' : /^https?:/.test(sel) ? '' : sel;
    const res = await openDialog({ title: 'Hyperlink', body: `
      <label class="row"><span>Target (URL):</span><input type="text" name="target" value="${esc(target)}"></label>
      <label class="row"><span>Name:</span><input type="text" name="name" value="${esc(name)}"></label>`, buttons: [['Cancel', ''], ['OK', 'ok', true]] });
    if (res.value !== 'ok' || !res.form.target.value.trim()) return;
    const el = mkAtom('Href', { target: res.form.target.value.trim(), name: res.form.name.value.trim() });
    if (atom) { pushUndo(); atom.replaceWith(el); refresh(); return; }
    const rr = selRange(true); if (rr && !rr.collapsed) rr.deleteContents();
    insertNodeAtCaret(el);
  }


  /* ---------- Citations, graphics, floats, tables ---------- */
  const CITE_CMDS = [['cite', '\\cite'], ['citep', '\\citep (natbib)'], ['citet', '\\citet (natbib)'], ['parencite', '\\parencite (biblatex)'], ['textcite', '\\textcite (biblatex)'], ['autocite', '\\autocite (biblatex)'], ['nocite', '\\nocite (list only)']];
  async function citationDialog(atom) {
    const keys = host.bibKeys();
    const cur = atom ? (atom.dataset.keys || '').split(',').filter(Boolean) : [];
    const om = atom ? /^\[([^\]]*)\](?:\[([^\]]*)\])?$/.exec(atom.dataset.opt || '') : null;
    const pre = om && om[2] != null ? om[1] : '', post = om ? (om[2] != null ? om[2] : om[1]) : '';
    const cmd = atom ? atom.dataset.cmd || 'cite' : host.defaultCite();
    const known = new Set(keys.map(k => k.key));
    const body = document.createElement('div');
    body.innerHTML = `
      <input type="text" name="q" placeholder="Search keys, authors or titles" spellcheck="false" style="margin-bottom:6px">
      <select class="lst" name="keys" multiple size="10">${keys.map(k => `<option value="${esc(k.key)}" ${cur.includes(k.key) ? 'selected' : ''}>${esc(k.key)}${k.label ? ' \u2014 ' + esc(k.label) : ''}</option>`).join('')}</select>
      ${keys.length ? '' : '<p class="hint">No references in the project yet. Use <b>Zotero…</b> below to import from your Zotero library, or type keys below.</p>'}
      <label class="row" style="margin-top:8px"><span>Other keys:</span><input type="text" name="manual" value="${esc(cur.filter(k => !known.has(k)).join(','))}" placeholder="key1,key2" spellcheck="false"></label>
      <label class="row"><span>Command:</span><select name="cmd">${CITE_CMDS.map(([v, l]) => `<option value="${v}" ${v === cmd.replace(/\*$/, '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="row"><span>Text before:</span><input type="text" name="pre" value="${esc(pre)}" placeholder="see"></label>
      <label class="row"><span>Text after:</span><input type="text" name="post" value="${esc(post)}" placeholder="p.~3"></label>`;
    const res = await openDialog({ title: 'Citation', body, buttons: [['Cancel', ''], ['Zotero…', 'zotero'], [atom ? 'OK' : 'Insert', 'ok', true]], onOpen: bd => {
      const q = bd.querySelector('[name=q]'), sel = bd.querySelector('[name=keys]');
      q.addEventListener('input', () => { const s = q.value.toLowerCase(); [...sel.options].forEach(o => { o.hidden = !!s && !o.textContent.toLowerCase().includes(s); }); });
      q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); sel.focus(); } });
    } });
    if (res.value === 'zotero') { zoteroDialog(atom); return; }
    if (res.value !== 'ok') return;
    const picked = [...res.form.keys.selectedOptions].map(o => o.value);
    const manual = res.form.manual.value.split(/[,\s]+/).filter(Boolean);
    const all = [...new Set([...picked, ...manual])];
    if (!all.length) { status('No citation key chosen.'); return; }
    const p1 = res.form.pre.value.trim(), p2 = res.form.post.value.trim();
    const opt = p1 ? `[${p1}][${p2}]` : p2 ? `[${p2}]` : '';
    const el = mkAtom('Cite', { cmd: res.form.cmd.value, keys: all.join(','), opt });
    if (atom) { pushUndo(); atom.replaceWith(el); refresh(); markDirty(); return; }
    insertNodeAtCaret(el);
  }
  /** Search the Zotero library, import the chosen items into the project's .bib and cite them (or add them to `atom`). */
  async function zoteroDialog(atom) {
    const z = host.zotero;
    const picked = new Map();
    let source = 'localApi';
    const label = atom ? 'Add to citation' : 'Import & cite';
    const cmd0 = (atom ? atom.dataset.cmd || 'cite' : host.defaultCite()).replace(/\*$/, '');
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="hint zot-status" style="margin:0 0 6px">Connecting to Zotero…</p>
      <input type="text" name="zq" placeholder="Search your Zotero library by title, author, year…" spellcheck="false" autocomplete="off" disabled>
      <div class="zot-list"></div>
      ${atom ? '' : `<label class="row" style="margin-top:8px"><span>Command:</span><select name="cmd">${CITE_CMDS.map(([v, l]) => `<option value="${v}" ${v === cmd0 ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`}
      <p class="hint zot-mode"></p>`;
    const res = await openDialog({ title: 'Cite from Zotero', body, buttons: [['Cancel', ''], [label, 'ok', true]], onOpen: bd => {
      const st = bd.querySelector('.zot-status'), q = bd.querySelector('[name=zq]'), list = bd.querySelector('.zot-list'), mode = bd.querySelector('.zot-mode');
      const ok = $('#lx-dlgButtons .def');
      const sync = () => { ok.disabled = !picked.size; ok.textContent = label + (picked.size ? ` (${picked.size})` : ''); };
      sync();
      let ready = false, seq = 0, timer = null;
      const render = items => {
        list.innerHTML = '';
        if (!items.length) { list.innerHTML = `<div class="zot-empty">${q.value.trim() ? 'No matches.' : 'Type to search your Zotero library.'}</div>`; return; }
        for (const it of items) {
          const row = document.createElement('label');
          row.className = 'zot-item';
          row.innerHTML = `<input type="checkbox" ${picked.has(it.id) ? 'checked' : ''}><span><b>${esc(it.title || '(untitled)')}</b><small>${esc([it.creators.join(', '), it.year && '(' + it.year + ')', it.where].filter(Boolean).join(' '))}</small>${it.key ? `<code>${esc(it.key)}</code>` : ''}</span>`;
          row.querySelector('input').addEventListener('change', e => { if (e.target.checked) picked.set(it.id, it); else picked.delete(it.id); sync(); });
          list.append(row);
        }
      };
      const search = () => {
        if (!ready) return;
        const my = ++seq;
        list.classList.add('busy');
        z.search(q.value).then(r => {
          if (my !== seq) return;
          source = r.source;
          mode.textContent = (r.source === 'betterBibtex' ? 'Using Better BibTeX citation keys.' : 'Using Zotero’s local API. Install Better BibTeX for stable citation keys.') + ' Chosen items are added to the project’s .bib file.';
          render(r.items);
        }, err => { if (my === seq) list.innerHTML = `<div class="zot-empty err">${esc(err && err.message || String(err))}</div>`; })
          .finally(() => { if (my === seq) list.classList.remove('busy'); });
      };
      q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
      q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); clearTimeout(timer); search(); } });
      z.status().then(s => {
        ready = !!(s.betterBibtex || s.localApi);
        st.hidden = ready;
        st.textContent = ready ? '' : (s.message || 'Zotero is not available. Start Zotero on this computer and try again.');
        q.disabled = !ready;
        if (ready) { q.focus(); search(); }
      }, err => { st.textContent = 'Zotero is not available: ' + (err && err.message || String(err)); });
    } });
    if (res.value !== 'ok' || !picked.size) return;
    status('Importing from Zotero…');
    let keys;
    try { keys = await z.importItems([...picked.keys()], source); }
    catch (e) { status('Zotero import failed: ' + (e && e.message || String(e))); return; }
    if (!keys.length) { status('Zotero returned no entries.'); return; }
    if (atom && atom.isConnected) {
      const all = [...new Set([...(atom.dataset.keys || '').split(',').filter(Boolean), ...keys])];
      pushUndo();
      atom.replaceWith(mkAtom('Cite', { cmd: atom.dataset.cmd || 'cite', keys: all.join(','), opt: atom.dataset.opt || '' }));
      refresh(); markDirty();
    } else insertNodeAtCaret(mkAtom('Cite', { cmd: res.form.cmd ? res.form.cmd.value : 'cite', keys: keys.join(','), opt: '' }));
    status('Cited ' + keys.join(', ') + '.');
  }
  async function graphicsDialog(atom) {
    const imgs = host.images();
    const opt0 = atom ? atom.dataset.opt || '' : 'width=0.8\\linewidth';
    const wm = /(?:^|,)\s*width\s*=\s*([\d.]+)\s*\\(?:linewidth|textwidth|columnwidth)\s*/.exec(opt0);
    const width = wm ? Math.round(+wm[1] * 100) : '';
    const other = wm ? opt0.replace(wm[0], '').replace(/^\s*,\s*|\s*,\s*$/g, '') : opt0;
    const res = await openDialog({ title: 'Graphics', body: `
      <label class="row"><span>File:</span><input type="text" name="path" list="lx-imgList" value="${esc(atom ? atom.dataset.path : imgs[0] || '')}" spellcheck="false"></label>
      <datalist id="lx-imgList">${imgs.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      <label class="row"><span>Width (% of line):</span><input type="number" name="w" min="1" max="100" value="${width}" placeholder="natural size"></label>
      <label class="row"><span>More options:</span><input type="text" name="opt" value="${esc(other)}" placeholder="angle=90, trim=…" spellcheck="false"></label>
      ${imgs.length ? '' : '<p class="hint">No images in the project yet: drop image files on the file tree to add them.</p>'}`,
      buttons: [['Cancel', ''], [atom ? 'OK' : 'Insert', 'ok', true]] });
    if (res.value !== 'ok' || !res.form.path.value.trim()) return;
    const w = +res.form.w.value;
    const opt = [w ? `width=${+(w / 100).toFixed(3)}\\linewidth` : '', res.form.opt.value.trim()].filter(Boolean).join(',');
    const el = mkAtom('Graphics', { path: res.form.path.value.trim(), opt });
    if (atom) { pushUndo(); atom.replaceWith(el); refresh(); markDirty(); return; }
    insertNodeAtCaret(el);
  }
  function floatInsert(kind) {
    if (!inTextCtx()) { status('Command disabled'); return; }
    const body = document.createDocumentFragment();
    if (kind === 'figure') body.append(mkERT('\\centering'), document.createTextNode(' '));
    const cap = mkInset('Caption');
    body.append(cap);
    const fl = mkInset('Float', kind, body);
    fl.dataset.opt = 'tbp';
    insertBlockAfter(mkBlock('Standard', fl));
    enterAtom({ enter: cap }, true);
    status(kind === 'table' ? 'Table float inserted: type the caption, then add the table inside the float.' : 'Figure float inserted: type the caption, and insert graphics inside the float.');
  }
  /** `inset-modify tabular <op>` in the table cell `td` (the caret's by default). */
  function tableCmd(op, td = currentCell()) {
    if (!td) return false;
    const tab = td.closest('.inset[data-inset="Tabular"]');
    pushUndo();
    const to = tabularOp(tab, td, op);
    if (!to) { status('Command disabled'); return true; }
    refresh(); markDirty();
    enterAtom({ cell: to }, true);
    return true;
  }
  async function tableDialog() {
    const res = await openDialog({ title: 'Insert Table', body: `
      <label class="row"><span>Rows:</span><input type="number" name="r" value="3" min="1" max="50"></label>
      <label class="row"><span>Columns:</span><input type="number" name="c" value="3" min="1" max="20"></label>
      <p class="hint">Tab moves to the next cell; Edit ▸ Rows &amp; Columns adds and deletes them.</p>`, buttons: [['Cancel', ''], ['Insert', 'ok', true]] });
    if (res.value !== 'ok') return;
    const rows = Math.max(1, Math.min(50, +res.form.r.value || 3)), cols = Math.max(1, Math.min(20, +res.form.c.value || 3));
    const tab = newTabular(rows, cols);
    const ib = inIbody(), r = selRange(true);
    if (ib && r && ib.parentElement.dataset.inset === 'Float') {
      // inside a table float: the table goes where the caret is
      pushUndo();
      r.collapse(true); r.insertNode(tab);
      refresh(); markDirty();
    } else insertBlockAfter(mkBlock('Standard', tab));
    enterAtom({ enter: tab }, true);
  }
  async function bibtexInsert() {
    const files = host.bibFiles();
    const res = await openDialog({ title: 'BibTeX Bibliography', body: `
      <label class="row"><span>Databases:</span><input type="text" name="db" value="${esc(files.join(','))}" placeholder="refs" spellcheck="false"></label>
      <label class="row"><span>Style:</span><input type="text" name="st" value="plain" spellcheck="false"></label>`, buttons: [['Cancel', ''], ['Insert', 'ok', true]] });
    if (res.value !== 'ok') return;
    const b = mkBlock('Standard', mkERT(`\\bibliographystyle{${res.form.st.value.trim() || 'plain'}}\n\\bibliography{${res.form.db.value.trim()}}`)); b.dataset.ert = '1';
    insertBlockAfter(b);
  }
  async function includeInsert() {
    const name = await promptDialog('Child Document', 'File (\\input):', '');
    if (!name) return;
    const b = mkBlock('Standard', mkERT(`\\input{${name}}`)); b.dataset.ert = '1';
    insertBlockAfter(b);
  }

  /* =====================================================================
     Panes, toolbars, status
     ===================================================================== */
  function togglePane(id, force) {
    const p = $(id);
    p.hidden = force == null ? !p.hidden : !force;
    if (!p.hidden) { buildOutline(); updateSource(true); }
    updateToolbarState();
  }
  function buildOutline() {
    const pane = $('#lx-outlinePane'); if (pane.hidden) return;
    const mode = $('#lx-outlineMode').value;
    const box = $('#lx-outline'); box.innerHTML = '';
    const add = (text, el, lvl = 1) => {
      const d = document.createElement('div'); d.className = 'oi l' + lvl; d.textContent = text; d.title = text;
      d.onclick = () => { lastPos = caretPos(); const b = el.classList.contains('blk') ? el : el.closest('.blk'); b.scrollIntoView({ block: 'center' }); if (el === b) caretStart(b); else caretBeside(el, true); };
      box.append(d);
    };
    for (const b of ed.children) {
      const t = b.dataset.type;
      if (mode === 'toc') { const l = headLevel(t); if (l != null) add((b.dataset.num && !t.endsWith('*') ? b.dataset.num.replace(/^(Part|Chapter) /, '') + '  ' : '') + (plainText(b) || '(empty)'), b, Math.max(1, l)); }
      else if (mode === 'labels') {
        if (t === '_display' && b.dataset.label) add('Label: ' + b.dataset.label, b);
        $$('.atom[data-inset="Label"],.atom[data-inset="Ref"]', b).forEach(a => add((a.dataset.inset === 'Ref' ? '    Ref: ' : 'Label: ') + a.dataset.name, a));
      }
      else if (mode === 'math') {
        if (t === '_display') add((b.dataset.numbered ? '(' + b.dataset.num + ') ' : '') + latexOf(b.querySelector('math-field')).slice(0, 60), b);
      }
      else if (mode === 'foot') $$('.inset[data-inset="Foot"]', b).forEach(f => add(plainText(f.querySelector('.ibody')).slice(0, 60) || '(empty)', f));
      else if (mode === 'notes') $$('.inset[data-inset="Note"]', b).forEach(f => add(plainText(f.querySelector('.ibody')).slice(0, 60) || '(empty)', f));
      else if (mode === 'ert') $$('.inset[data-inset="ERT"]', b).forEach(f => add(plainText(f.querySelector('.ibody')).slice(0, 60) || '(empty)', f));
    }
    if (!box.childNodes.length) box.innerHTML = '<div class="empty">Nothing to show.</div>';
  }
  $('#lx-outlineMode').addEventListener('change', buildOutline);
  let sourceTimer = null;
  function updateSource(now) {
    if ($('#lx-sourcePane').hidden) return;
    clearTimeout(sourceTimer);
    sourceTimer = setTimeout(() => { $('#lx-source').textContent = getLatex(); }, now ? 0 : 350);
  }
  function showMathbars(on) {
    const forced = $('#lx-mathbars').dataset.forced === '1';
    $('#lx-mathbars').hidden = !(on || forced);
  }
  function updateCombo() {
    const b = currentBlock(); const sel = $('#lx-layoutCombo');
    if (!b) return;
    let t = b.dataset.type;
    if (t === '_display') t = b.dataset.ctx || 'Standard';
    if (ATOMBLK.has(t)) t = 'Standard';
    if (![...sel.options].some(o => o.value === t)) { const o = document.createElement('option'); o.value = o.textContent = t; sel.append(o); }
    sel.value = t;
    $('#lx-statusRight').textContent = (activeMath() ? 'Math  \u00b7  ' : '') + t + (b.dataset.depth ? '  \u00b7  depth ' + b.dataset.depth : '') + '  \u00b7  ' + prefs.zoom + '%';
  }
  function updateToolbarState() {
    $$('.tbtn[data-lfun]').forEach(btn => {
      const lf = btn.dataset.lfun;
      btn.disabled = !isImplemented(lf);
      if (btn.dataset.toggle) btn.classList.toggle('on', !!checked(lf));
    });
  }

  function fillLayoutCombo() {
    const sel = $('#lx-layoutCombo'); sel.innerHTML = '';
    LAYOUT_GROUPS.forEach(([g, items]) => {
      const parent = g ? Object.assign(document.createElement('optgroup'), { label: g }) : sel;
      items.forEach(n => { const o = document.createElement('option'); o.value = o.textContent = n; parent.append(o); });
      if (g) sel.append(parent);
    });
  }
  function wireLayoutCombo() {
    const sel = $('#lx-layoutCombo');
    sel.addEventListener('change', () => { selRange(true); setLayout(sel.value); });
    sel.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); selRange(true); } });
  }

  const MATHBAR1 = [['\\,', '\u2423', 'Thin space'], ['\\pm', '\u00b1'], ['\\times', '\u00d7'], ['\\cdot', '\u00b7'], ['\\leq', '\u2264'], ['\\geq', '\u2265'], ['\\neq', '\u2260'], ['\\approx', '\u2248'], ['\\equiv', '\u2261'],
    ['\\in', '\u2208'], ['\\subseteq', '\u2286'], ['\\to', '\u2192'], ['\\Rightarrow', '\u21d2'], ['\\Leftrightarrow', '\u21d4'], ['\\infty', '\u221e'], ['\\partial', '\u2202'], ['\\nabla', '\u2207'], ['\\ldots', '\u2026'], ['|',],
    ['\\alpha', '\u03b1'], ['\\beta', '\u03b2'], ['\\gamma', '\u03b3'], ['\\delta', '\u03b4'], ['\\epsilon', '\u03b5'], ['\\theta', '\u03b8'], ['\\lambda', '\u03bb'], ['\\mu', '\u03bc'], ['\\pi', '\u03c0'], ['\\sigma', '\u03c3'], ['\\phi', '\u03c6'], ['\\omega', '\u03c9'], ['\\Delta', '\u0394'], ['\\Sigma', '\u03a3'], ['\\Omega', '\u03a9']];
  const MATHBAR2 = [['lfun:math-number-toggle', '(#)', 'Toggle numbering (Alt+M N)', 'small'], ['|'], ['lfun:math-subscript', 'x\u2093', 'Subscript (Alt+M X)'], ['lfun:math-superscript', 'x\u207f', 'Superscript (Alt+M E)'],
    ['\\sqrt{#@}', '\u221a\u25a1', 'Square root (Alt+M S)'], ['\\sqrt[#?]{#@}', '\u207f\u221a\u25a1', 'Root (Alt+M R)'], ['\\frac{#@}{#?}', 'a\u2044b', 'Fraction (Alt+M F)'], ['|'],
    ['\\sum', '\u2211', 'Sum (Alt+M U)'], ['\\int', '\u222b', 'Integral (Alt+M I)'], ['\\prod', '\u220f'], ['\\lim_{#?}', 'lim', 'Limit', 'small'], ['|'],
    ['\\left(#@\\right)', '( )'], ['\\left[#@\\right]', '[ ]'], ['\\left\\{#@\\right\\}', '{ }'], ['\\left\\langle#@\\right\\rangle', '\u27e8 \u27e9'], ['\\left|#@\\right|', '| |'], ['lfun:dialog-show mathdelimiter', '[\u2026]', 'Delimiters\u2026', 'small'], ['|'],
    ['lfun:dialog-show mathmatrix', '\u229e', 'Matrix\u2026'], ['\\begin{cases}#@ & #?\\\\ #? & #?\\end{cases}', '{:', 'Cases environment'], ['lfun:inset-modify tabular append-row', '+row', 'Add row', 'small'], ['lfun:inset-modify tabular append-column', '+col', 'Add column', 'small'], ['|'],
    ['\\text{#@}', 'Text', 'Text in math', 'small'], ['\\mathbb{#@}', '\u211d', 'Blackboard bold'], ['\\mathcal{#@}', '\ud835\udc9e', 'Calligraphic'], ['\\mathbf{#@}', '\ud835\udc01', 'Bold'], ['|'],
    ['lfun:math-keyboard', '\u2328', 'On-screen math keyboard']];
  function buildMathbars() {
    const fill = (bar, defs) => defs.forEach(d => {
      if (d[0] === '|') { const s = document.createElement('span'); s.className = 'sep'; bar.append(s); return; }
      const b = document.createElement('button'); b.className = 'tbtn' + (d[3] ? ' ' + d[3] : ''); b.type = 'button';
      b.textContent = d[1] || d[0]; b.title = d[2] || d[0];
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => { if (d[0].startsWith('lfun:')) run(d[0].slice(5)); else mathInsert(d[0]); });
      bar.append(b);
    });
    fill($('#lx-mathbar1'), MATHBAR1); fill($('#lx-mathbar2'), MATHBAR2);
  }


  /* =====================================================================
     Key-binding engine
     ===================================================================== */
  const BINDS = [];
  const NATIVE = new Set(['char-right-select', 'char-left-select', 'up-select', 'down-select', 'word-right', 'word-left', 'word-right-select', 'word-left-select',
    'line-begin-select', 'line-end-select', 'screen-up-select', 'screen-down-select', 'buffer-begin', 'buffer-end', 'buffer-begin-select', 'buffer-end-select',
    'copy', 'cut', 'paste', 'clipboard-paste', 'primary-selection-paste', 'word-delete-forward', 'word-delete-backward', 'paragraph-up-select', 'paragraph-down-select', 'inset-begin-select', 'inset-end-select']);
  function parseTok(s) {
    const m = { C: 0, M: 0, S: 0 };
    let r;
    while ((r = /^(~?)([CMSA])-(?=.)/.exec(s))) { const mod = r[2] === 'A' ? 'M' : r[2]; m[mod] = r[1] ? 2 : 1; s = s.slice(r[0].length); }
    const key = s.length === 1 && /[A-Za-z]/.test(s) ? s.toLowerCase() : s;
    const named = /^[A-Za-z0-9]$/.test(s) || /^(Right|Left|Up|Down|Return|space|BackSpace|Delete|Insert|Home|End|Prior|Next|Escape|Tab|BackTab|F\d+)$/.test(s);
    return { m, key, named };
  }
  function loadBindings() {
    const map = new Map();
    BIND_TEXT.split('\n').forEach(line => {
      const m = /^\\bind\s+"([^"]+)"\s+"((?:[^"\\]|\\.)*)"/.exec(line.trim());
      if (!m) return;
      const keys = m[1].trim(), lfun = m[2].replace(/\\"/g, '"');
      map.set(keys, lfun);
    });
    for (const [keys, lfun] of map) BINDS.push({ keys, lfun, seq: keys.split(/\s+/).map(parseTok) });
  }
  const CODEMAP = { ArrowRight: 'Right', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowDown: 'Down', Enter: 'Return', NumpadEnter: 'Return', Space: 'space', Backspace: 'BackSpace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', Escape: 'Escape', Tab: 'Tab', Minus: 'minus', Equal: 'equal',
    Period: 'period', Comma: 'comma', Slash: 'slash', Backslash: 'backslash', BracketLeft: 'bracketleft', BracketRight: 'bracketright', Quote: 'apostrophe', Semicolon: 'semicolon', Backquote: 'grave',
    NumpadAdd: 'plus', NumpadSubtract: 'minus', NumpadMultiply: 'asterisk' };
  const KEYMAP = { '+': 'plus', '*': 'asterisk', '(': 'parenleft', ')': 'parenright', '<': 'less', '>': 'greater', '"': 'quotedbl', "'": 'apostrophe', '[': 'bracketleft', ']': 'bracketright',
    '{': 'braceleft', '}': 'braceright', '|': 'bar', '\\': 'backslash', '&': 'ampersand', '_': 'underscore', '@': 'at', '$': 'dollar', '#': 'numbersign', '-': 'minus', '=': 'equal',
    '.': 'period', '/': 'slash', '~': 'asciitilde', '^': 'asciicircum', '!': 'exclam', '%': 'percent', ',': 'comma', ':': 'colon', ';': 'semicolon', '?': 'question', ' ': 'space' };
  function evNames(e) {
    const n = new Set(); const c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) n.add(c[3].toLowerCase());
    else if (/^Digit\d$/.test(c)) n.add(c[5]);
    else if (/^Numpad\d$/.test(c)) n.add(c[6]);
    else if (/^F\d+$/.test(c)) n.add(c);
    else if (CODEMAP[c]) n.add(CODEMAP[c]);
    if (c === 'Tab' && e.shiftKey) n.add('BackTab');
    const k = e.key;
    if (k && k.length === 1) {
      if (/[a-z]/i.test(k) && !e.altKey) n.add(k.toLowerCase());
      else if (/\d/.test(k) && !e.altKey) n.add(k);
      else if (KEYMAP[k]) n.add(KEYMAP[k]);
    } else if (k && /^F\d+$/.test(k)) n.add(k);
    return [...n];
  }
  function tokScore(bt, ev) {
    if (!ev.names.includes(bt.key)) return 0;
    for (const k of ['C', 'M']) { if (bt.m[k] === 2) continue; if (!!bt.m[k] !== ev[k]) return 0; }
    if (bt.m.S === 2) return 1;
    if (bt.m.S === 1) return ev.S ? 3 : 0;
    if (bt.named) return ev.S ? 0 : 3;
    return ev.S ? 1 : 2;
  }
  function lookup(seq) {
    let best = null, bestScore = 0, prefix = false;
    for (const b of BINDS) {
      if (b.seq.length < seq.length) continue;
      let score = 0, ok = true;
      for (let i = 0; i < seq.length; i++) { const s = tokScore(b.seq[i], seq[i]); if (!s) { ok = false; break; } score += s; }
      if (!ok) continue;
      if (b.seq.length === seq.length) { if (score > bestScore) { best = b; bestScore = score; } }
      else prefix = true;
    }
    return { exact: best, prefix };
  }
  const KEY_LABEL = { space: 'Space', period: '.', minus: '-', plus: '+', equal: '=', asterisk: '*', slash: '/', backslash: '\\', less: '<', greater: '>', quotedbl: '"', apostrophe: "'",
    parenleft: '(', bracketleft: '[', braceleft: '{', bar: '|', ampersand: '&', underscore: '_', at: '@', dollar: '$', numbersign: '#', Prior: 'PgUp', Next: 'PgDown',
    Return: 'Return', BackSpace: 'Backspace', BackTab: 'Shift+Tab', Escape: 'Esc' };
  function keyLabel(seq) {
    return seq.map(t => {
      const mods = [];
      if (t.m.C === 1) mods.push(isMac ? 'Cmd' : 'Ctrl');
      if (t.m.M === 1) mods.push(isMac ? 'Option' : 'Alt');
      if (t.m.S === 1) mods.push('Shift');
      const k = KEY_LABEL[t.key] || (t.key.length === 1 ? t.key.toUpperCase() : t.key);
      return [...mods, k].join('+');
    }).join(', ');
  }
  function shortcutFor(lfun) {
    const b = BINDS.find(x => x.lfun === lfun);
    return b ? keyLabel(b.seq) : '';
  }
  let pendingKeys = [], metaNext = false;
  const MATH_OK = /^(math-|buffer-|file-|dialog-|command-alternatives|command-execute|ui-|lyx-quit|escape|meta-prefix|bookmark-|screen-recenter|view-close|font-bold|font-emph|font-sans|font-roman|font-typewriter|font-boldsymbol|newline-insert|label-|inset-modify|scroll|toolbar-)/;
  function mathAllowed(lf) {
    if (lf.includes('buffer-end-select')) return false;
    if (lf.startsWith('command-sequence')) return MATH_OK.test(lf.slice(17).trim());
    return MATH_OK.test(lf);
  }
  function onKeyDown(e) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'].includes(e.key) || e.isComposing) {
      if (e.key === 'Alt') root.classList.add('show-mn');
      return;
    }
    // the app's command palette (LyX prints with Ctrl+P; here the PDF viewer does that)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) return;
    if (menuState.open) { menuKey(e); return; }
    if ($('#lx-dlg').open) return;
    const tgt = e.target;
    if (tgt === $('#lx-minibuf')) return;
    if (tgt.closest && tgt.closest('#lx-findbar')) {
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (tgt.id === 'replaceText') replaceOne(); else findNext(!e.shiftKey); }
      else if (e.key === 'F3') { e.preventDefault(); findNext(!e.shiftKey); }
      return;
    }
    if (tgt.tagName === 'SELECT' || (tgt.tagName === 'INPUT' && tgt.type !== 'checkbox')) return;
    const inMath = tgt.tagName === 'MATH-FIELD';
    const ev = { names: evNames(e), C: e.ctrlKey || e.metaKey, M: e.altKey || metaNext, S: e.shiftKey };
    const wasMeta = metaNext; metaNext = false;
    const seq = [...pendingKeys, ev];
    const r = lookup(seq);
    if (r.exact) {
      const lf = r.exact.lfun;
      if (!pendingKeys.length && !wasMeta && NATIVE.has(lfunName(lf))) return;
      if (inMath && !mathAllowed(lf)) { pendingKeys = []; return; }
      e.preventDefault(); e.stopPropagation();
      pendingKeys = [];
      if (!(lf === 'cancel' || lf === 'escape')) status('');
      run(lf);
      return;
    }
    if (r.prefix) {
      e.preventDefault(); e.stopPropagation();
      pendingKeys = seq;
      status(keyLabel(seq.map(evToTok)));
      return;
    }
    if (pendingKeys.length) {
      e.preventDefault(); e.stopPropagation();
      pendingKeys = [];
      status('Unknown function.');
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !inMath) {
      const n = ev.names.find(x => /^[a-z]$/.test(x));
      const mi = MENUBAR.findIndex(m => m.key === n);
      if (mi >= 0) { e.preventDefault(); openMenu(mi, true); return; }
    }
    if (e.key === 'F10' && !e.ctrlKey && !e.altKey) { e.preventDefault(); openMenu(0, true); }
  }
  function evToTok(ev) {
    const k = ev.names.find(x => x.length === 1) || ev.names[0] || '?';
    return { m: { C: ev.C ? 1 : 0, M: ev.M ? 1 : 0, S: ev.S && k.length > 1 ? 1 : 0 }, key: k };
  }
  listen(root, 'keydown', onKeyDown, true);
  listen(document, 'mousedown', () => { clicks++; }, true);
  listen(root, 'keyup', e => { if (e.key === 'Alt') root.classList.remove('show-mn'); });
  listen(window, 'blur', () => root.classList.remove('show-mn'));


  /* =====================================================================
     LyX functions (LFUNs)
     ===================================================================== */
  const lfunName = lf => lf.trim().split(/\s+/)[0];
  const lfunArg = lf => { const t = lf.trim(); const i = t.search(/\s/); return i < 0 ? '' : t.slice(i + 1).trim(); };
  const inTextCtx = () => { const b = currentBlock(); return !activeMath() && !!b && isText(b); };
  const inMathCtx = () => !!activeMath();
  const inDisplay = () => { const m = activeMath(); return !!m && m.classList.contains('display'); };
  const FONT_HANDLERS = {};
  Object.keys(FONTS).forEach(k => {
    FONT_HANDLERS[k] = { run: () => { if (activeMath()) { const map = { 'font-bold': '\\mathbf', 'font-sans': '\\mathsf', 'font-roman': '\\mathrm', 'font-typewriter': '\\mathtt', 'font-emph': '\\mathit' }; if (map[k]) mathFont(map[k]); else status('Command disabled'); return; } applyFont(FONTS[k]); },
      en: () => inTextCtx() || (inMathCtx() && ['font-bold', 'font-sans', 'font-roman', 'font-typewriter', 'font-emph'].includes(k)) || !!inIbody() };
  });
  const MATH_FONT_OK = ['mathcal', 'mathscr', 'mathfrak', 'mathrm', 'mathsf', 'mathbf', 'mathbb', 'textrm', 'textsf', 'texttt', 'textbf', 'textit', 'textnormal', 'mathnormal'];
  const H = {
    ...FONT_HANDLERS,
    'font-default': { run: fontDefault, en: () => inTextCtx() },
    'font-boldsymbol': { run: () => mathFont('\\boldsymbol'), en: inMathCtx },
    'font-size': { run: fontSize, en: a => inTextCtx() && SIZES.includes(a) },
    'script-insert': { run: a => applyFont({ tag: a === 'subscript' ? 'SUB' : 'SUP', name: a }), en: () => inTextCtx() },
    'buffer-write': { run: () => host.save() },
    'buffer-export': { run: exportAs, en: a => ['pdflatex', 'latex', 'lyx23x', 'lyx', 'text', 'xhtml'].includes(a) },
    'buffer-export-as': { run: async () => { const res = await openDialog({ title: 'Export Document As', body: `<label class="row"><span>Format:</span><select name="f"><option value="pdflatex">LaTeX (pdflatex) (*.tex)</option><option value="lyx23x">LyX 2.3.x (*.lyx)</option><option value="text">Plain text (*.txt)</option><option value="xhtml">LyXHTML (*.html)</option></select></label>`, buttons: [['Cancel', ''], ['Export', 'ok', true]] }); if (res.value === 'ok') exportAs(res.form.f.value); } },
    'file-insert': { run: () => insertFile('lyx'), en: () => inTextCtx() },
    'file-insert-plaintext': { run: () => insertFile('text'), en: () => inTextCtx() },
    'file-insert-plaintext-para': { run: () => insertFile('para'), en: () => inTextCtx() },
    'buffer-view': { run: () => host.compile() },
    'buffer-update': { run: () => host.compile() },
    'forward-search': { run: () => host.showInPdf(caretPosition().line) },
    'source-edit': { run: () => host.openSource() },
    'float-insert': { run: floatInsert, en: a => (a === 'figure' || a === 'table') && inTextCtx() },
    'caption-insert': { run: () => insertInset('Caption'), en: () => { const ib = inIbody(); return !!ib && !!ib.closest('.inset[data-inset="Float"]') && !ib.closest('.inset[data-inset="Caption"]'); } },
    'tabular-insert': { run: tableDialog, en: () => inTextCtx() },
    'undo': { run: () => { if (activeMath()) mathCmd('undo'); else undo(); } },
    'redo': { run: () => { if (activeMath()) mathCmd('redo'); else redo(); } },
    'copy': { run: () => { document.execCommand('copy'); } },
    'cut': { run: () => { document.execCommand('cut'); } },
    'paste': { run: async () => { try { const t = await navigator.clipboard.readText(); selRange(true); if (window._lyxClip && window._lyxClip.text === t) pasteFragment(window._lyxClip.html); else pasteText(t); } catch (e) { status('Use Ctrl+V to paste (the browser blocked clipboard access).'); } } },
    'clipboard-paste': { run: async () => { try { const t = await navigator.clipboard.readText(); selRange(true); pasteText(t); } catch (e) { status('Use Ctrl+Shift+V to paste plain text.'); } }, en: a => !a || a === 'paragraph' },
    'buffer-begin': { run: () => caretStart([...ed.children].find(isText) || ed.firstElementChild) },
    'buffer-end-select': { run: () => { const s = getSelection(); const last = ed.lastElementChild; try { s.extend(last, last.childNodes.length); } catch (e) {} } },
    'buffer-end': { run: () => caretEnd(ed.lastElementChild) },
    'inset-select-all': { run: () => { const c = inIbody() || currentBlock(); if (!c) return; const r = document.createRange(); r.selectNodeContents(c); setSel(r); }, en: () => !!currentBlock() && !activeMath() },
    'inset-begin': { run: () => { const ib = inIbody(); if (ib) { const f = ib.firstChild; if (f && f.nodeType === 3) setCaret(f, f.data.startsWith(ZW) ? 1 : 0); } else caretStart(currentBlock()); } },
    'inset-end': { run: () => { const ib = inIbody(); if (ib) { const l = ib.lastChild; if (l && l.nodeType === 3) setCaret(l, l.data.length); } else caretEnd(currentBlock()); } },
    'paragraph-up': { run: () => paragraphNav(false) },
    'paragraph-down': { run: () => paragraphNav(true) },
    'dialog-show': { run: a => DIALOGS[a] && DIALOGS[a](), en: a => !!DIALOGS[a] },
    'dialog-toggle': { run: a => { if (a === 'toc') togglePane('#lx-outlinePane'); else if (a === 'view-source') togglePane('#lx-sourcePane'); else if (a === 'findreplace') { $('#lx-findbar').hidden ? openFind() : closeFind(); } }, en: a => ['toc', 'view-source', 'findreplace'].includes(a) },
    'zotero-cite': { run: () => zoteroDialog(), en: () => inTextCtx() || !!inIbody() },
    'dialog-show-new-inset': { run: a => { if (a === 'ref') refInsert(); else if (a === 'line') insertBlockAfter(mkSpecial('_line')); else if (a === 'citation') citationDialog(); else if (a === 'graphics') graphicsDialog(); else if (a === 'bibtex') bibtexInsert(); else if (a === 'include') includeInsert(); },
      en: a => ['ref', 'citation', 'graphics'].includes(a) ? inTextCtx() || !!inIbody() : ['line', 'bibtex', 'include'].includes(a) && inTextCtx() },
    'word-find': { run: () => { if ($('#lx-findText').value) findNext(true); else openFind(); } },
    'word-find-forward': { run: () => { if ($('#lx-findText').value) findNext(true); else openFind(); } },
    'word-find-backward': { run: () => { if ($('#lx-findText').value) findNext(false); else openFind(); } },
    'inset-toggle': { run: insetToggle },
    'inset-forall': { run: a => { const open = /open$/.test(a); $$('.inset:not(.atom)', ed).forEach(i => i.classList.toggle('collapsed', !open)); markDirty(); } },
    'inset-dissolve': { run: insetDissolve, en: () => !!inIbody() },
    'changes-track': null,
    'quote-insert': { run: a => insertPlain(smartQuote(a === 'single')), en: () => inTextCtx() || !!inIbody() },
    'self-insert': { run: a => insertPlain(a), en: () => inTextCtx() || !!inIbody() },
    'specialchar-insert': { run: a => insertNodeAtCaret(mkSC(SC_ARG[a])), en: a => !!SC_ARG[a] && (inTextCtx() || !!inIbody()) },
    'space-insert': { run: a => insertNodeAtCaret(mkSC(a)), en: a => ['protected', 'normal', 'thin', 'visible'].includes(a) && (inTextCtx() || !!inIbody()) },
    'math-space': { run: () => mathInsert('\\,'), en: inMathCtx },
    'newline-insert': { run: a => { if (activeMath()) mathCmd('addRowAfter'); else insertNodeAtCaret(mkLB(a || 'newline')); } },
    'depth-increment': { run: () => depthChange(1), en: () => !!currentBlock() },
    'depth-decrement': { run: () => depthChange(-1), en: () => { const b = currentBlock(); return !!b && +b.dataset.depth > 0; } },
    'ert-insert': { run: () => insertInset('ERT'), en: () => inTextCtx() },
    'footnote-insert': { run: () => insertInset('Foot'), en: () => inTextCtx() },
    'marginalnote-insert': { run: () => insertInset('Marginal'), en: () => inTextCtx() },
    'note-insert': { run: a => insertInset('Note', a || 'Note'), en: () => inTextCtx() },
    'flex-insert': { run: () => insertInset('URL'), en: a => a === 'URL' && inTextCtx() },
    'href-insert': { run: hrefInsert, en: () => inTextCtx() },
    'label-insert': { run: labelInsert, en: () => inTextCtx() || inDisplay() },
    'label-goto': { run: labelGoto },
    'reference-next': { run: () => nextInset('.atom[data-inset="Ref"]') },
    'note-next': { run: () => nextInset('.inset[data-inset="Note"]') },
    'date-insert': { run: () => insertPlain(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })), en: () => inTextCtx() || !!inIbody() },
    'inset-insert': { run: () => insertBlockAfter(mkSpecial('_toc')), en: a => a === 'toc' },
    'newpage-insert': { run: a => insertBlockAfter(mkSpecial('_newpage', a)), en: a => ['newpage', 'pagebreak', 'clearpage', 'cleardoublepage'].includes(a) },
    'appendix': { run: toggleAppendix, en: () => !!currentBlock() },
    'screen-recenter': { run: () => { const r = selRange(false); if (!r) return; const rc = r.getBoundingClientRect(), wr = workarea.getBoundingClientRect(); workarea.scrollTop += rc.top - wr.top - wr.height / 2; } },
    'scroll': { run: a => { const [what, dir] = a.split(/\s+/); const amt = what === 'page' ? workarea.clientHeight * 0.9 : 30; workarea.scrollTop += dir === 'up' ? -amt : amt; } },
    'dialog-show spellchecker': null,
    'thesaurus-entry': null,
    'command-execute': { run: openMinibuffer },
    'ui-toggle': { run: a => { if (a === 'fullscreen') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); } }, en: a => a === 'fullscreen' },
    'buffer-zoom-in': { run: () => zoom(10) },
    'buffer-zoom-out': { run: () => zoom(-10) },
    'buffer-zoom': { run: a => zoom(null, +a || 100) },
    'paragraph-move-up': { run: () => moveParagraph(true) },
    'paragraph-move-down': { run: () => moveParagraph(false) },
    'paragraph-break': { run: a => paragraphBreak(a === 'inverse'), en: () => inTextCtx() },
    'line-delete-forward': { run: lineDeleteForward, en: () => inTextCtx() || !!inIbody() },
    'cancel': { run: cancelCmd },
    'escape': { run: () => { const m = activeMath(); if (m) leaveMath(m, true); else cancelCmd(); } },
    'meta-prefix': { run: () => { metaNext = true; status(isMac ? 'Option-' : 'Alt-'); } },
    'layout': { run: setLayout, en: a => inTextCtx() || (!!currentBlock() && !activeMath()) },
    'drop-layouts-choice': { run: () => { const s = $('#lx-layoutCombo'); s.focus(); try { s.showPicker(); } catch (e) {} } },
    'layout-paragraph': { run: paragraphSettings, en: () => inTextCtx() },
    'paragraph-params': { run: paragraphParams, en: a => /^\\(align|indent-toggle)/.test(a) && !!currentBlock() && !activeMath() },
    'outline-in': { run: () => outline('in') }, 'outline-out': { run: () => outline('out') },
    'outline-up': { run: () => outline('up') }, 'outline-down': { run: () => outline('down') },
    'word-upcase': { run: () => wordCase('upcase'), en: () => inTextCtx() || !!inIbody() },
    'word-lowcase': { run: () => wordCase('lowcase'), en: () => inTextCtx() || !!inIbody() },
    'word-capitalize': { run: () => wordCase('capitalize'), en: () => inTextCtx() || !!inIbody() },
    'bookmark-save': { run: a => { bookmarks[a] = caretPos(); status('Saved bookmark ' + a); } },
    'bookmark-goto': { run: a => {
      if (a === '0') { if (!lastPos) { status('No previous position to go back to.'); return; } const p = lastPos; lastPos = caretPos(); setCaretPos(p); const b = currentBlock(); if (b) b.scrollIntoView({ block: 'center' }); return; }
      const p = bookmarks[a]; if (!p) { status('Bookmark ' + a + ' is not set.'); return; }
      lastPos = caretPos(); setCaretPos(p); const b = currentBlock(); if (b) b.scrollIntoView({ block: 'center' }); status('Moved to bookmark ' + a);
    } },
    'bookmark-clear': { run: () => { Object.keys(bookmarks).forEach(k => delete bookmarks[k]); status('Bookmarks cleared'); } },
    'toolbar-toggle': { run: a => {
      if (a === 'math') { const mb = $('#lx-mathbars'); mb.dataset.forced = mb.dataset.forced === '1' ? '' : '1'; showMathbars(!!activeMath()); }
      else { const t = a === 'extra' ? '#lx-tbExtra' : '#lx-tbStandard'; $(t).hidden = !$(t).hidden; }
      updateToolbarState();
    }, en: a => ['math', 'extra', 'standard'].includes(a) },
    'help-open': { run: a => { if (a === 'Shortcuts') shortcutsDialog(); }, en: a => a === 'Shortcuts' },
    /* math */
    'math-mode': { run: a => {
      const m = activeMath();
      if (m) { if (a === 'on') return; try { m.executeCommand(['switchMode', m.mode === 'text' ? 'math' : 'text']); } catch (e) {} return; }
      if (a === 'off') return;
      insertInlineMath();
    }, en: () => inTextCtx() || inMathCtx() },
    'math-display': { run: () => { const m = activeMath(); if (m && m.classList.contains('display')) mutateMath(m, 'simple'); else insertDisplay(false, ''); }, en: () => inTextCtx() || inMathCtx() },
    'math-number-toggle': { run: () => { const m = activeMath(); if (!m || !m.classList.contains('display')) { status('Command disabled'); return; } const b = m.closest('.blk'); pushUndo(); if (b.dataset.numbered) { delete b.dataset.numbered; delete b.dataset.label; } else b.dataset.numbered = '1'; refresh(); }, en: inDisplay },
    'math-number-line-toggle': { run: () => run('math-number-toggle'), en: inDisplay },
    'math-insert': { run: a => mathInsert(mathTpl(a)), en: () => inTextCtx() || inMathCtx() },
    'math-delim': { run: a => {
      const parts = a.split(/\s+/); const tr = x => ({ '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', langle: '\\langle', rangle: '\\rangle' })[x] || x;
      mathInsert(`\\left${tr(parts[0])}#@\\right${tr(parts[1])}`);
    }, en: () => inTextCtx() || inMathCtx() },
    'math-subscript': { run: () => { if (activeMath()) mathCmd('moveToSubscript'); else mathInsert('#?_{#?}'); }, en: () => inTextCtx() || inMathCtx() },
    'math-superscript': { run: () => { if (activeMath()) mathCmd('moveToSuperscript'); else mathInsert('#?^{#?}'); }, en: () => inTextCtx() || inMathCtx() },
    'math-mutate': { run: a => { const m = activeMath(); if (!m) return; mutateMath(m, a === 'equation' ? 'equation' : a, a !== 'simple' && a !== 'equation' ? false : undefined); }, en: a => inMathCtx() && ['simple', 'equation', 'eqnarray', 'align', 'alignat', 'flalign', 'gather', 'multline'].includes(a) },
    'math-matrix': { run: a => { const [r, c] = (a || '2 2').split(/\s+/).map(Number); const body = Array.from({ length: r || 2 }, (_, i) => Array.from({ length: c || 2 }, (_, j) => (i + j === 0 ? '#@' : '#?')).join('&')).join('\\\\'); mathInsert(`\\begin{matrix}${body}\\end{matrix}`); }, en: () => inTextCtx() || inMathCtx() },
    'math-font-style': { run: a => { if (a === 'mathnormal') return; mathFont('\\' + (a === 'textnormal' ? 'text' : a)); }, en: a => inMathCtx() && MATH_FONT_OK.includes(a) && a !== 'mathnormal' },
    'math-keyboard': { run: () => { const kb = window.mathVirtualKeyboard; if (!kb) return; if (kb.visible) kb.hide(); else { if (!activeMath()) insertInlineMath(); setTimeout(() => kb.show(), 80); } } },
    'inset-modify': { run: a => { if (!activeMath() && tableCmd(a.replace(/^tabular /, ''))) return; const map = { 'tabular append-row': 'addRowAfter', 'tabular append-column': 'addColumnAfter', 'tabular delete-row': 'removeRow', 'tabular delete-column': 'removeColumn' }; if (map[a]) mathCmd(map[a]); }, en: a => /^tabular (append|delete)-(row|column)$/.test(a) && (inMathCtx() || !!currentCell()) },
  };
  delete H['dialog-show print']; delete H['changes-track']; delete H['dialog-show spellchecker']; delete H['thesaurus-entry'];
  const DIALOGS = {
    findreplace: openFind, print: () => host.compile(), spellchecker: toggleSpell, toc: () => togglePane('#lx-outlinePane', true),
    document: documentSettings, prefs: preferencesDialog, aboutlyx: aboutDialog, mathdelimiter: delimiterDialog, mathmatrix: matrixDialog,
  };
  const SPECIAL_EN = { 'dialog-show mathdelimiter': () => inTextCtx() || inMathCtx(), 'dialog-show mathmatrix': () => inTextCtx() || inMathCtx() };
  H['statistics'] = { run: statisticsDialog };
  function toggleSpell() { ed.spellcheck = !ed.spellcheck; status(ed.spellcheck ? 'Spell checking is on (your browser\u2019s spellchecker).' : 'Spell checking is off.'); updateToolbarState(); }
  function zoom(delta, abs) {
    prefs.zoom = abs != null ? abs : Math.max(50, Math.min(300, prefs.zoom + delta));
    applyPrefs(); savePrefs();
    status(`Zoom level is now ${prefs.zoom}% (default value 100%)`);
  }
  function cancelCmd() {
    const ib = inIbody();
    if (ib) { caretBeside(ib.parentElement, true); return; }
    const r = selRange(false);
    if (r && !r.collapsed) { r.collapse(false); setSel(r); }
    status('Cancel');
  }
  function isImplemented(lf) {
    lf = lf.trim();
    if (lf.startsWith('command-sequence')) return lf.slice(16).split(';').map(s => s.trim()).filter(Boolean).every(isImplemented);
    if (lf.startsWith('command-alternatives')) return lf.slice(20).split(';').map(s => s.trim()).filter(Boolean).some(isImplemented);
    const name = lfunName(lf), arg = lfunArg(lf);
    if (name === 'dialog-show') return !!DIALOGS[arg];
    if (NATIVE.has(name) && !H[name]) return true;
    return !!H[name];
  }
  function isEnabled(lf) {
    lf = lf.trim();
    if (lf.startsWith('command-sequence')) { const parts = lf.slice(16).split(';').map(s => s.trim()).filter(Boolean); return parts.length > 0 && parts.every(isImplemented) && isEnabled(parts[0]); }
    if (lf.startsWith('command-alternatives')) return lf.slice(20).split(';').map(s => s.trim()).filter(Boolean).some(isEnabled);
    if (SPECIAL_EN[lf]) return SPECIAL_EN[lf]();
    const name = lfunName(lf), arg = lfunArg(lf);
    if (name === 'dialog-show') return !!DIALOGS[arg];
    const h = H[name];
    if (!h) return NATIVE.has(name);
    if (h.en) { try { return !!h.en(arg); } catch (e) { return false; } }
    return true;
  }
  function checked(lf) {
    switch (lf) {
      case 'dialog-toggle toc': return !$('#lx-outlinePane').hidden;
      case 'dialog-toggle view-source': return !$('#lx-sourcePane').hidden;
      case 'ui-toggle fullscreen': return !!document.fullscreenElement;
      case 'math-number-toggle': { const m = activeMath(); return !!(m && m.closest('.blk').dataset.numbered); }
      case 'toolbar-toggle math': return $('#lx-mathbars').dataset.forced === '1';
      case 'toolbar-toggle standard': return !$('#lx-tbStandard').hidden;
      case 'toolbar-toggle extra': return !$('#lx-tbExtra').hidden;
      case 'dialog-show spellchecker': return ed.spellcheck;
    }
    if (lf.startsWith('layout ')) { const b = currentBlock(); return !!b && b.dataset.type === lf.slice(7); }
    return false;
  }
  function run(lf) {
    lf = lf.trim();
    if (lf.startsWith('command-sequence')) {
      const parts = lf.slice(16).split(';').map(s => s.trim()).filter(Boolean);
      for (const p of parts) run(p);
      return;
    }
    if (lf.startsWith('command-alternatives')) {
      const parts = lf.slice(20).split(';').map(s => s.trim()).filter(Boolean);
      const p = parts.find(isEnabled);
      if (p) run(p); else status('Command disabled');
      return;
    }
    if (!isImplemented(lf)) { status(lfunName(lf) && knownLyx(lf) ? `"${lf}" is not available in this web version.` : 'Unknown function.'); return; }
    if (!isEnabled(lf)) { status('Command disabled'); return; }
    const name = lfunName(lf), arg = lfunArg(lf);
    if (name === 'dialog-show') { DIALOGS[arg](); return; }
    const h = H[name];
    try { const r = h.run(arg); if (r && r.catch) r.catch(e => { console.error(e); status('Error: ' + e.message); }); }
    catch (e) { console.error(e); status('Error: ' + e.message); }
    setTimeout(() => { updateCombo(); updateToolbarState(); }, 0);
  }
  function knownLyx(lf) { return BINDS.some(b => lfunName(b.lfun) === lfunName(lf)) || ALL_MENU_LFUNS.has(lfunName(lf)); }


  /* ---------- Minibuffer (Alt+X) ---------- */
  function openMinibuffer() {
    const mb = $('#lx-minibuf');
    const names = new Set([...Object.keys(H), ...BINDS.map(b => b.lfun)]);
    $('#lx-lfunList').innerHTML = [...names].sort().map(n => `<option value="${esc(n)}">`).join('');
    $('#lx-status').hidden = true; mb.hidden = false; mb.value = ''; mb.placeholder = 'Type a LyX function, e.g. layout Section or math-insert \\alpha';
    mb.focus();
  }
  function closeMinibuffer() { $('#lx-minibuf').hidden = true; $('#lx-status').hidden = false; selRange(true); }
  $('#lx-minibuf').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeMinibuffer(); }
    else if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); closeMinibuffer(); if (v) setTimeout(() => run(v), 0); }
  });

  /* =====================================================================
     Menus (structure after LyX's stdmenus.inc)
     ===================================================================== */
  const MENUBAR = [
    { label: 'File', key: 'f', id: 'file' }, { label: 'Edit', key: 'e', id: 'edit' }, { label: 'View', key: 'v', id: 'view' },
    { label: 'Insert', key: 'i', id: 'insert' }, { label: 'Navigate', key: 'n', id: 'navigate' }, { label: 'Document', key: 'd', id: 'document' },
    { label: 'Tools', key: 't', id: 'tools' }, { label: 'Help', key: 'h', id: 'help' }];
  const MENUS = {
    file: [['Save|S', 'buffer-write'], ['View PDF|V', 'buffer-view'], ['-'], ['Edit LaTeX Source|L', 'source-edit'], ['-'],
      ['>Import|I', 'file_import'], ['>Export|E', 'file_export'], ['-'], ['Print...|P', 'dialog-show print']],
    file_import: [['LyX Document...|L', 'file-insert'], ['Plain Text...|P', 'file-insert-plaintext'], ['Plain Text, Join Lines...|J', 'file-insert-plaintext-para']],
    file_export: [['Export As...|s', 'buffer-export-as'], ['LaTeX (pdflatex)|L', 'buffer-export pdflatex'], ['LyX 2.3.x|2', 'buffer-export lyx23x'], ['LyXHTML|y', 'buffer-export xhtml'],
      ['Plain text|a', 'buffer-export text']],
    edit: [['Undo|U', 'undo'], ['Redo|R', 'redo'], ['-'], ['Cut', 'cut'], ['Copy', 'copy'], ['Paste', 'paste'], ['>Paste Recent|e', 'edit_pasterecent'], ['>Paste Special', 'edit_paste'], ['-'],
      ['Select Whole Inset', 'inset-select-all'], ['Select All', 'command-sequence buffer-begin ; buffer-end-select'], ['-'],
      ['Find & Replace (Quick)...|F', 'dialog-show findreplace'], ['Find & Replace (Advanced)...', 'dialog-show findreplaceadv'], ['-'],
      ['Move Paragraph Up|o', 'paragraph-move-up'], ['Move Paragraph Down|v', 'paragraph-move-down'], ['-'],
      ['>Text Style|S', 'edit_textstyles'], ['Paragraph Settings...|P', 'layout-paragraph'], ['-'],
      ['>?Table|T', 'edit_tabular'], ['>?Math|M', 'edit_math'], ['>?Rows & Columns|C', 'edit_tabular_features'], ['-'],
      ['?Increase List Depth|I', 'depth-increment'], ['?Decrease List Depth|D', 'depth-decrement'], ['?Dissolve Inset', 'inset-dissolve']],
    edit_paste: [['Plain Text|T', 'clipboard-paste'], ['Plain Text, Join Lines|J', 'clipboard-paste paragraph'], ['-'], ['Selection|S', 'primary-selection-paste'],
      ['-'], ['Unformatted Text|U', 'clipboard-paste-simple'], ['-'], ['Paste as PDF', 'paste pdf'], ['Paste as PNG', 'paste png'], ['Paste as JPEG', 'paste jpeg']],
    edit_pasterecent: [['@pasterecent']],
    edit_textstyles: [['Emph|E', 'font-emph'], ['Bold|B', 'font-bold'], ['Noun|N', 'font-noun'], ['Underline|U', 'font-underline'], ['Double Underline', 'font-underunderline'],
      ['Wavy Underline', 'font-underwave'], ['Strikeout|S', 'font-strikeout'], ['Typewriter|T', 'font-typewriter'], ['Sans Serif', 'font-sans'], ['Roman', 'font-roman'],
      ['Superscript', 'script-insert superscript'], ['Subscript', 'script-insert subscript'], ['Default Font|D', 'font-default'], ['-'],
      ['Dissolve Text Style', 'inset-dissolve charstyle'], ['Customized...|C', 'dialog-show character'], ['-'],
      ['Capitalize|a', 'word-capitalize'], ['Uppercase|U', 'word-upcase'], ['Lowercase|L', 'word-lowcase']],
    edit_tabular: [['Multicolumn|M', 'inset-modify tabular multicolumn'], ['Multirow|u', 'inset-modify tabular multirow']],
    edit_tabular_features: [['Add Row|A', 'inset-modify tabular append-row'], ['Delete Row|D', 'inset-modify tabular delete-row'], ['-'],
      ['Add Column|u', 'inset-modify tabular append-column'], ['Delete Column|e', 'inset-modify tabular delete-column']],
    edit_math: [['Number Whole Formula|N', 'math-number-toggle'], ['Number This Line|u', 'math-number-line-toggle'], ['>Change Limits Type|L', 'edit_math_limits'], ['-'],
      ['>Change Formula Type|F', 'edit_math_mutate'], ['-'], ['>Text Style|T', 'edit_math_fontstyles'], ['-'], ['>Use Computer Algebra System|S', 'edit_math_extern'], ['-'],
      ['Split Cell|C', 'cell-split'], ['-'], ['Add Row', 'inset-modify tabular append-row'], ['Delete Row', 'inset-modify tabular delete-row'],
      ['Add Column', 'inset-modify tabular append-column'], ['Delete Column', 'inset-modify tabular delete-column']],
    edit_math_limits: [['Default|t', 'math-limits empty'], ['Display|D', 'math-limits limits'], ['Inline|I', 'math-limits nolimits']],
    edit_math_fontstyles: [['Math Normal Font|N', 'math-font-style mathnormal'], ['-'], ['Math Calligraphic Family|C', 'math-font-style mathcal'], ['Math Formal Script Family|o', 'math-font-style mathscr'],
      ['Math Fraktur Family|F', 'math-font-style mathfrak'], ['Math Roman Family|R', 'math-font-style mathrm'], ['Math Sans Serif Family|S', 'math-font-style mathsf'], ['Math Blackboard Bold', 'math-font-style mathbb'], ['-'],
      ['Math Bold Series|B', 'math-font-style mathbf'], ['-'], ['Text Normal Font|T', 'math-font-style textnormal'], ['-'], ['Text Roman Family', 'math-font-style textrm'],
      ['Text Sans Serif Family', 'math-font-style textsf'], ['Text Typewriter Family', 'math-font-style texttt'], ['-'], ['Text Bold Series', 'math-font-style textbf'],
      ['Text Italic Shape', 'math-font-style textit']],
    edit_math_extern: [['Octave|O', 'math-extern octave'], ['Maxima|M', 'math-extern maxima'], ['Mathematica|a', 'math-extern mathematica']],
    edit_math_mutate: [['Inline Formula|I', 'math-mutate simple'], ['Displayed Formula|D', 'math-mutate equation'], ['Eqnarray Environment|E', 'math-mutate eqnarray'],
      ['AMS align Environment|a', 'math-mutate align'], ['AMS alignat Environment|t', 'math-mutate alignat'], ['AMS flalign Environment|f', 'math-mutate flalign'],
      ['AMS gather Environment|g', 'math-mutate gather'], ['AMS multline Environment|m', 'math-mutate multline']],
    view: [['Open All Insets|O', 'inset-forall * inset-toggle open'], ['Close All Insets|C', 'inset-forall * inset-toggle close'], ['-'],
      ['Unfold Math Macro|n', 'math-macro-unfold'], ['Fold Math Macro|d', 'math-macro-fold'], ['-'],
      ['Outline Pane|u', 'dialog-toggle toc'], ['Source Pane|S', 'dialog-toggle view-source'], ['Edit LaTeX Source|L', 'source-edit'], ['Messages Pane|g', 'dialog-toggle progress'], ['>Toolbars|b', 'toolbars'], ['-'],
      ['Zoom In', 'buffer-zoom-in'], ['Zoom Out', 'buffer-zoom-out'], ['Reset Zoom', 'buffer-zoom 100'], ['-'],
      ['Split View Into Left and Right Half|i', 'view-split horizontal'], ['Split View Into Upper and Lower Half|e', 'view-split vertical'], ['Fullscreen|l', 'ui-toggle fullscreen'], ['-'], ['@documents']],
    toolbars: [['Standard', 'toolbar-toggle standard'], ['Extra', 'toolbar-toggle extra'], ['Math (always visible)', 'toolbar-toggle math']],
    insert: [['>Math|h', 'insert_math'], ['>Special Character|p', 'insert_special'], ['>Formatting|o', 'insert_formatting'], ['>List / TOC|i', 'insert_toc'],
      ['>Float|a', 'insert_float'], ['>Note|N', 'insert_note'], ['>Branch|B', 'insert_branches'], ['>Custom Insets', 'insert_custom'], ['>File|e', 'insert_file'], ['>Box', 'insert_box'], ['-'],
      ['Citation...|C', 'dialog-show-new-inset citation'], ['Citation from Zotero...|Z', 'zotero-cite'], ['Cross-Reference...|R', 'dialog-show-new-inset ref'], ['Label...|L', 'label-insert'], ['Caption', 'caption-insert'],
      ['Index Entry|I', 'index-insert'], ['Nomenclature Entry...|y', 'nomencl-insert'], ['-'],
      ['Table...|T', 'tabular-insert'], ['Graphics...|G', 'dialog-show-new-inset graphics'], ['URL|U', 'flex-insert URL'], ['Hyperlink...|k', 'href-insert'],
      ['Footnote|F', 'footnote-insert'], ['Marginal Note|M', 'marginalnote-insert'], ['TeX Code|X', 'ert-insert'], ['Program Listing', 'listing-insert'], ['Date', 'date-insert'], ['Preview|w', 'preview-insert']],
    insert_special: [['Symbols...|b', 'dialog-show symbols'], ['Ellipsis|i', 'specialchar-insert dots'], ['End of Sentence|E', 'specialchar-insert end-of-sentence'],
      ['Ordinary Quote|Q', 'self-insert "'], ['Single Quote|S', 'quote-insert single'], ['Protected Hyphen|y', 'specialchar-insert nobreakdash'],
      ['Breakable Slash|a', 'specialchar-insert slash'], ['Menu Separator|M', 'specialchar-insert menu-separator'], ['Phonetic Symbols|P', 'ipa-insert']],
    insert_formatting: [['Superscript|S', 'script-insert superscript'], ['Subscript|u', 'script-insert subscript'], ['-'],
      ['Protected Space|P', 'space-insert protected'], ['Interword Space|w', 'space-insert normal'], ['Visible Space|i', 'space-insert visible'], ['Thin Space|T', 'space-insert thin'],
      ['Horizontal Space...|o', 'dialog-show-new-inset space'], ['Horizontal Line...|L', 'dialog-show-new-inset line'], ['Vertical Space...|V', 'dialog-show-new-inset vspace'], ['-'],
      ['Hyphenation Point|H', 'specialchar-insert hyphenation'], ['Ligature Break|k', 'specialchar-insert ligature-break'], ['Ragged Line Break|R', 'newline-insert newline'],
      ['Justified Line Break|J', 'newline-insert linebreak'], ['-'], ['New Page|N', 'newpage-insert newpage'], ['Page Break|a', 'newpage-insert pagebreak'],
      ['Clear Page|C', 'newpage-insert clearpage'], ['Clear Double Page|D', 'newpage-insert cleardoublepage']],
    insert_math: [['Inline Formula|I', 'math-mode on'], ['Display Formula|D', 'command-sequence math-mode on; math-mutate equation'],
      ['Numbered Formula|N', 'command-sequence math-mode on; math-mutate equation; math-number-toggle;'], ['Eqnarray Environment|E', 'command-sequence math-mode on; math-mutate eqnarray;'],
      ['AMS align Environment|a', 'command-sequence math-mode on; math-mutate align;'], ['AMS alignat Environment|t', 'command-sequence math-mode on; math-mutate alignat;'],
      ['AMS flalign Environment|f', 'command-sequence math-mode on; math-mutate flalign;'], ['AMS gather Environment|g', 'command-sequence math-mode on; math-mutate gather;'],
      ['AMS multline Environment|m', 'command-sequence math-mode on; math-mutate multline;'], ['-'],
      ['Array Environment|y', 'math-matrix 2 2'], ['Cases Environment|C', 'math-insert \\cases'], ['Aligned Environment|l', 'math-insert \\aligned'],
      ['AlignedAt Environment|v', 'math-insert \\alignedat'], ['Gathered Environment|h', 'math-insert \\gathered'], ['Split Environment|S', 'math-insert \\split'], ['-'],
      ['Delimiters...|r', 'dialog-show mathdelimiter'], ['Matrix...|x', 'dialog-show mathmatrix'], ['Macro|o', 'math-macro newmacroname newcommand']],
    insert_float: [['Figure|F', 'float-insert figure'], ['Table|T', 'float-insert table'], ['Figure Wrap Float', 'wrap-insert figure'], ['Table Wrap Float', 'wrap-insert table']],
    insert_toc: [['Table of Contents|C', 'inset-insert toc'], ['List of Figures', 'float-list figure'], ['List of Tables', 'float-list table'], ['Nomenclature|N', 'nomencl-print'], ['BibTeX Bibliography...|B', 'dialog-show-new-inset bibtex']],
    insert_file: [['LyX Document...|X', 'file-insert'], ['Plain Text...|T', 'file-insert-plaintext'], ['Plain Text, Join Lines...|J', 'file-insert-plaintext-para'], ['-'],
      ['External Material...|M', 'dialog-show-new-inset external'], ['Child Document...|d', 'dialog-show-new-inset include']],
    insert_box: [['Frameless|l', 'box-insert Frameless'], ['Simple Frame|F', 'box-insert Boxed'], ['Oval, Thin|a', 'box-insert ovalbox'], ['Drop Shadow|w', 'box-insert Shadowbox'], ['Shaded Background|B', 'box-insert Shaded']],
    insert_note: [['LyX Note|N', 'note-insert Note'], ['Comment|C', 'note-insert Comment'], ['Greyed Out|G', 'note-insert Greyedout']],
    insert_branches: [['Insert New Branch...|I', 'branch-add-insert']],
    insert_custom: [['@empty']],
    navigate: [['>Bookmarks|B', 'navigate_bookmarks'], ['Next Note|N', 'note-next'], ['Next Change|C', 'change-next'], ['Next Cross-Reference|R', 'reference-next'],
      ['Go to Label|L', 'label-goto'], ['Forward Search|F', 'forward-search'], ['-'], ['@toc']],
    navigate_bookmarks: [['Save Bookmark 1|S', 'bookmark-save 1'], ['Save Bookmark 2', 'bookmark-save 2'], ['Save Bookmark 3', 'bookmark-save 3'], ['Save Bookmark 4', 'bookmark-save 4'],
      ['Save Bookmark 5', 'bookmark-save 5'], ['Clear Bookmarks|C', 'bookmark-clear'], ['-'], ['Navigate Back|B', 'bookmark-goto 0'], ['@bookmarks']],
    document: [['>Change Tracking|C', 'document_change'], ['LaTeX Log|L', 'dialog-show latexlog'], ['Start Appendix Here|A', 'appendix'], ['-'],
      ['View [PDF]|V', 'buffer-view'], ['Update|U', 'buffer-update'], ['-'], ['Settings...|S', 'dialog-show document']],
    document_change: [['Track Changes|T', 'changes-track'], ['Merge Changes...|M', 'changes-merge'], ['Accept Change|A', 'change-accept'], ['Reject Change|R', 'change-reject'],
      ['Accept All Changes|c', 'all-changes-accept'], ['Reject All Changes|e', 'all-changes-reject'], ['Show Changes in Output|S', 'changes-output']],
    tools: [['Spellchecker...|S', 'dialog-show spellchecker'], ['Thesaurus...|T', 'thesaurus-entry'], ['Statistics...|a', 'statistics'], ['Check TeX|h', 'buffer-chktex'],
      ['TeX Information|I', 'dialog-show texinfo'], ['Compare...|C', 'dialog-show compare'], ['-'], ['Command Buffer (Alt+X)...', 'command-execute'], ['-'],
      ['Reconfigure|R', 'reconfigure'], ['Preferences...|P', 'dialog-show prefs']],
    help: [['Introduction|I', 'help-open Intro'], ['Tutorial|T', 'help-open Tutorial'], ["User's Guide|U", 'help-open UserGuide'], ['Additional Features|F', 'help-open Additional'],
      ['Embedded Objects|O', 'help-open EmbeddedObjects'], ['Math|M', 'help-open Math'], ['Customization|C', 'help-open Customization'], ['Shortcuts|S', 'help-open Shortcuts'],
      ['LyX Functions|y', 'help-open LFUNs'], ['LaTeX Configuration|L', 'help-open LaTeXConfig'], ['-'], ['About LyX|X', 'dialog-show aboutlyx']],
  };
  const ALL_MENU_LFUNS = new Set(Object.values(MENUS).flat().filter(x => x[1] && !x[0].startsWith('>')).map(x => lfunName(x[1])));
  const menuState = { open: false, top: -1, stack: [] };
  function mnLabel(label) {
    const [text, mn] = label.split('|');
    if (!mn) return esc(text);
    const i = text.toLowerCase().indexOf(mn.toLowerCase());
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<u class="mn">' + esc(text[i]) + '</u>' + esc(text.slice(i + 1));
  }
  function buildMenubar() {
    const bar = $('#lx-menubar');
    MENUBAR.forEach((m, i) => {
      const d = document.createElement('div');
      d.className = 'mtop'; d.innerHTML = mnLabel(m.label + '|' + m.key.toUpperCase());
      d.addEventListener('mousedown', e => { e.preventDefault(); if (menuState.open && menuState.top === i) closeMenus(); else openMenu(i, false); });
      d.addEventListener('mouseenter', () => { if (menuState.open && menuState.top !== i) openMenu(i, false); });
      bar.append(d);
    });
  }
  function dynamicItems(kind) {
    if (kind === 'toc') {
      const heads = [...ed.children].filter(b => headLevel(b.dataset.type) != null);
      if (!heads.length) return [{ label: '(No Table of Contents)', dis: true }];
      return heads.slice(0, 40).map(b => ({ label: '  '.repeat(Math.max(0, headLevel(b.dataset.type) - 1)) + ((b.dataset.num && !b.dataset.type.endsWith('*')) ? b.dataset.num.replace(/^Part /, '') + ' ' : '') + (plainText(b).slice(0, 50) || '(empty)'), fn: () => gotoBlock(b) }));
    }
    if (kind === 'bookmarks') return Object.keys(bookmarks).sort().map(k => ({ label: 'Go to Bookmark ' + k, lfun: 'bookmark-goto ' + k }));
    if (kind === 'documents') return [{ label: host.fileName, checked: true, fn: () => {} }];
    if (kind === 'recent') return [{ label: '(No recent files)', dis: true }];
    if (kind === 'pasterecent') return [{ label: '(Empty)', dis: true }];
    return [{ label: '(No items)', dis: true }];
  }
  function menuItems(id) {
    const out = [];
    for (const it of MENUS[id] || []) {
      if (it[0] === '-') { if (out.length && out[out.length - 1].sep !== true) out.push({ sep: true }); continue; }
      if (it[0].startsWith('@')) { out.push(...dynamicItems(it[0].slice(1))); continue; }
      let label = it[0];
      const sub = label.startsWith('>'); if (sub) label = label.slice(1);
      const opt = label.startsWith('?'); if (opt) label = label.slice(1);
      if (sub) {
        const children = menuItems(it[1]);
        const any = children.some(c => !c.sep && !c.dis);
        if (opt && !any) continue;
        out.push({ label, sub: it[1], dis: false });
      } else {
        const en = isImplemented(it[1]) && isEnabled(it[1]);
        if (opt && !en) continue;
        out.push({ label, lfun: it[1], dis: !en, na: !isImplemented(it[1]), checked: checked(it[1]) });
      }
    }
    while (out.length && out[out.length - 1].sep) out.pop();
    return out;
  }
  function renderMenu(items, x, y, level) {
    const m = document.createElement('div');
    m.className = 'menu'; m.setAttribute('role', 'menu');
    items.forEach((it, idx) => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'msep'; m.append(s); return; }
      const d = document.createElement('div');
      d.className = 'mi' + (it.dis ? ' dis' : '');
      d.dataset.idx = idx;
      const sc = it.lfun ? shortcutFor(it.lfun) : '';
      d.innerHTML = (it.checked ? '<span class="check">\u2713</span>' : '') + `<span>${mnLabel(it.label)}</span>` + (it.sub ? '<span class="arrow">\u25B6</span>' : sc ? `<span class="sc-key">${esc(sc)}</span>` : '');
      if (it.na) d.title = 'Not available in this web version';
      d.addEventListener('mouseenter', () => { highlight(level, idx); if (it.sub) openSub(level, idx); else closeSubsFrom(level + 1); });
      d.addEventListener('mousedown', e => e.preventDefault());
      d.addEventListener('click', () => activate(level, idx));
      m.append(d);
    });
    $('#lx-menuLayer').append(m);
    const r = m.getBoundingClientRect();
    if (x + r.width > innerWidth - 4) x = Math.max(4, level ? x - r.width - (menuState.stack[level - 1] ? menuState.stack[level - 1].el.getBoundingClientRect().width : 0) + 4 : innerWidth - r.width - 4);
    if (y + r.height > innerHeight - 4) y = Math.max(4, innerHeight - r.height - 4);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    return m;
  }
  function openMenu(i, kbd) {
    closeMenus(true);
    menuState.open = true; menuState.top = i;
    const top = $$('#lx-menubar .mtop')[i];
    $$('#lx-menubar .mtop').forEach((t, k) => t.classList.toggle('open', k === i));
    const r = top.getBoundingClientRect();
    const items = menuItems(MENUBAR[i].id);
    const el = renderMenu(items, r.left, r.bottom, 0);
    menuState.stack = [{ el, items, hl: -1 }];
    if (kbd) moveHl(0, 1);
  }
  function openSub(level, idx) {
    closeSubsFrom(level + 1);
    const st = menuState.stack[level]; const it = st.items[idx];
    const row = st.el.querySelector(`.mi[data-idx="${idx}"]`);
    const r = row.getBoundingClientRect();
    const items = menuItems(it.sub);
    const el = renderMenu(items, r.right - 2, r.top - 3, level + 1);
    menuState.stack[level + 1] = { el, items, hl: -1 };
  }
  function closeSubsFrom(level) { while (menuState.stack.length > level) { const s = menuState.stack.pop(); s.el.remove(); } }
  function closeMenus(keepFocus) {
    closeSubsFrom(0);
    menuState.open = false; menuState.top = -1;
    $$('#lx-menubar .mtop').forEach(t => t.classList.remove('open'));
    root.classList.remove('show-mn');
    if (!keepFocus && !activeMath()) selRange(true);
  }
  function highlight(level, idx) {
    const st = menuState.stack[level]; if (!st) return;
    st.hl = idx;
    $$('.mi', st.el).forEach(r => r.classList.toggle('hl', +r.dataset.idx === idx));
    const row = st.el.querySelector(`.mi[data-idx="${idx}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
  }
  function moveHl(level, dir) {
    const st = menuState.stack[level]; if (!st) return;
    const n = st.items.length; let i = st.hl;
    for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (!st.items[i].sep) { highlight(level, i); return; } }
  }
  function activate(level, idx) {
    const it = menuState.stack[level].items[idx];
    if (it.sub) { openSub(level, idx); moveHl(level + 1, 1); return; }
    if (it.dis) return;
    closeMenus(true);
    if (it.fn) { it.fn(); return; }
    if (!activeMath()) selRange(true);
    run(it.lfun);
  }
  function menuKey(e) {
    const lvl = menuState.stack.length - 1;
    const st = menuState.stack[lvl];
    const k = e.key;
    e.preventDefault(); e.stopPropagation();
    if (k === 'Escape') { if (lvl > 0) closeSubsFrom(lvl); else closeMenus(); return; }
    if (k === 'ArrowDown') { moveHl(lvl, 1); return; }
    if (k === 'ArrowUp') { moveHl(lvl, -1); return; }
    if (k === 'ArrowRight') { const it = st.items[st.hl]; if (it && it.sub) { openSub(lvl, st.hl); moveHl(lvl + 1, 1); } else openMenu((menuState.top + 1) % MENUBAR.length, true); return; }
    if (k === 'ArrowLeft') { if (lvl > 0) closeSubsFrom(lvl); else openMenu((menuState.top - 1 + MENUBAR.length) % MENUBAR.length, true); return; }
    if (k === 'Enter' || k === ' ') { if (st.hl >= 0) activate(lvl, st.hl); return; }
    if (k === 'Alt' || k === 'F10') { closeMenus(); return; }
    if (k.length === 1) {
      const ch = k.toLowerCase();
      const idx = st.items.findIndex(it => !it.sep && it.label.includes('|') && it.label.split('|')[1].toLowerCase() === ch);
      if (idx >= 0) { highlight(lvl, idx); activate(lvl, idx); return; }
      if (e.altKey) { const mi = MENUBAR.findIndex(m => m.key === ch); if (mi >= 0) openMenu(mi, true); }
    }
  }
  listen(document, 'mousedown', e => {
    if (menuState.open && !e.target.closest('.menu') && !e.target.closest('#lx-menubar')) closeMenus(true);
  });
  listen(window, 'resize', () => { if (menuState.open) closeMenus(true); });

  /* ---------- Toolbars ---------- */
  function wireToolbars() {
    const names = { 'buffer-write': 'Save and compile', 'forward-search': 'Show in PDF (Ctrl/Cmd+click)', 'dialog-show-new-inset citation': 'Insert citation', 'zotero-cite': 'Cite from Zotero', 'float-insert figure': 'Insert figure float', 'source-edit': 'Edit the LaTeX source', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste',
      'dialog-show findreplace': 'Find and replace', 'bookmark-goto 0': 'Navigate back', 'font-emph': 'Emphasize', 'font-noun': 'Noun', 'font-bold': 'Bold',
      'math-mode': 'Insert math', 'dialog-show-new-inset graphics': 'Insert graphics', 'tabular-insert': 'Insert table', 'dialog-toggle toc': 'Toggle outline pane',
      'dialog-toggle view-source': 'Toggle source pane', 'toolbar-toggle math': 'Always show the math toolbars', 'buffer-view': 'View (compile the PDF)', 'buffer-update': 'Update (compile the PDF)',
      'layout Itemize': 'Itemize list', 'layout Enumerate': 'Enumerate list', 'depth-decrement': 'Decrease depth', 'depth-increment': 'Increase depth',
      'footnote-insert': 'Insert footnote', 'marginalnote-insert': 'Insert margin note', 'note-insert Note': 'Insert LyX note', 'label-insert': 'Insert label',
      'dialog-show-new-inset ref': 'Insert cross-reference', 'flex-insert URL': 'Insert URL', 'ert-insert': 'Insert TeX code',
      'paragraph-params \\align left': 'Align left', 'paragraph-params \\align center': 'Center', 'paragraph-params \\align right': 'Align right',
      'dialog-show spellchecker': 'Spellchecker', 'dialog-show document': 'Document settings' };
    $$('.tbtn[data-lfun], .pane-head button[data-lfun]').forEach(b => {
      const lf = b.dataset.lfun;
      const sc = shortcutFor(lf);
      if (b.classList.contains('tbtn')) b.title = (names[lf] || lf) + (sc ? ' (' + sc + ')' : '');
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => { if (!activeMath()) selRange(true); run(lf); });
    });
  }


  /* =====================================================================
     Preferences and startup
     ===================================================================== */
  function applyPrefs() {
    root.style.setProperty('--zoom', prefs.zoom / 100);
    updateCombo();
  }
  function savePrefs() { try { localStorage.setItem('gitlatex.lyx.prefs', JSON.stringify(prefs)); } catch (e) {} }
  function loadPrefs() { try { Object.assign(prefs, JSON.parse(localStorage.getItem('gitlatex.lyx.prefs') || '{}')); } catch (e) {} }

  setMathHook(wire);
  loadBindings();
  loadPrefs();
  buildMenubar();
  fillLayoutCombo();
  wireLayoutCombo();
  buildMathbars();
  wireToolbars();
  applyPrefs();
  listen(document, 'selectionchange', () => {
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (!ed.contains(r.startContainer)) return;
    savedRange = r.cloneRange();
    if (document.activeElement && document.activeElement.tagName === 'MATH-FIELD') return;
    pendingMath = null; lastMath = null;
    setCurrent(currentBlock());
    updateCombo();
  });

  return {
    load,
    getText: getLatex,
    caretPosition,
    reveal: revealPosition,
    insertTex,
    focus() { if (!selRange(true)) caretStart(ed.firstElementChild); },
    destroy() {
      cleanups.forEach(f => f());
      clearTimeout(refreshTimer); clearTimeout(sourceTimer);
      if (menuState.open) closeMenus(true);
      setMathHook(() => {});
      root.innerHTML = '';
      root.classList.remove('lyx-root');
    },
  };
}
