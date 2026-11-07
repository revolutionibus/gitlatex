/**
 * Formulas in the LyX-style editor: ProseMirror node views around MathLive's
 * <math-field>. A formula is written back as typed only once it is edited
 * (the node's `latex` changes on MathLive's input events), so formulas you do
 * not touch keep their exact LaTeX.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Selection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { MathfieldElement } from 'mathlive';

type MathLive = typeof import('mathlive');
let loading: Promise<MathLive> | null = null;

/** MathLive (about 1 MB) loads the first time a file opens in the LyX style. Its fonts are bundled. */
export function loadMathLive(): Promise<MathLive> {
  loading ??= (async () => {
    await import('mathlive/fonts.css');
    const ML = await import('mathlive');
    // Fonts come from the bundle (fonts.css), and no sounds are played.
    ML.MathfieldElement.fontsDirectory = null;
    ML.MathfieldElement.soundsDirectory = null;
    ML.MathfieldElement.plonkSound = null;
    return ML;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Alt+M then a key, inside a formula: LyX's math shortcuts, as LaTeX for MathLive to insert. */
const MATH_KEYS: Record<string, string> = {
  f: '\\frac{#@}{#?}', s: '\\sqrt{#@}', r: '\\sqrt[#?]{#@}', u: '\\sum', i: '\\int', Space: '\\,',
  '(': '\\left(#@\\right)', '[': '\\left[#@\\right]', '{': '\\left\\{#@\\right\\}', '<': '\\left\\langle #@\\right\\rangle', '|': '\\left|#@\\right|',
};
/** Alt+M G then a letter: Greek (with Shift for capitals). */
const GREEK: Record<string, string> = {
  a: 'alpha', b: 'beta', g: 'gamma', d: 'delta', e: 'epsilon', z: 'zeta', h: 'eta', q: 'theta', i: 'iota', k: 'kappa', l: 'lambda', m: 'mu',
  n: 'nu', x: 'xi', p: 'pi', r: 'rho', s: 'sigma', t: 'tau', u: 'upsilon', f: 'phi', c: 'chi', y: 'psi', w: 'omega',
  G: 'Gamma', D: 'Delta', Q: 'Theta', L: 'Lambda', X: 'Xi', P: 'Pi', S: 'Sigma', U: 'Upsilon', F: 'Phi', Y: 'Psi', W: 'Omega',
};

export class MathView implements NodeView {
  dom: HTMLElement;
  private field: MathfieldElement;
  private label: HTMLElement | null = null;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    ML: MathLive,
    /** Show a message in the editor's status bar; `toggleNumbering` numbers a display formula (Alt+M N). */
    private host: { status(message: string): void; toggleNumbering(pos: number): void },
  ) {
    const display = node.type.name === 'math_display';
    this.dom = document.createElement(display ? 'div' : 'span');
    this.dom.className = display ? 'lyx-display' : 'lyx-math';
    const field = new ML.MathfieldElement();
    field.mathVirtualKeyboardPolicy = 'manual';
    field.value = node.attrs.latex;
    field.addEventListener('input', () => {
      const pos = this.getPos();
      const latex = field.getValue('latex');
      if (pos == null || latex === this.node.attrs.latex) return;
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, latex }));
    });
    // Arrow keys past the edge, or Esc, leave the formula for the text around it.
    field.addEventListener('move-out', (e) => {
      const dir = (e as CustomEvent<{ direction: string }>).detail?.direction;
      e.preventDefault();
      this.leave(dir === 'forward' || dir === 'downward');
    });
    // Alt+M sequences (and Alt+M G for Greek), as in LyX.
    let pending: '' | 'M' | 'MG' = '';
    field.addEventListener(
      'keydown',
      (e) => {
        if (['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) return;
        const stop = () => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        const key = /^Key[A-Z]$/.test(e.code) ? (e.shiftKey ? e.code.slice(3) : e.code.slice(3).toLowerCase()) : e.key === ' ' ? 'Space' : e.key;
        if (pending) {
          stop();
          const prefix = pending;
          pending = '';
          this.host.status('');
          if (prefix === 'MG') {
            if (GREEK[key]) field.executeCommand(['insert', `\\${GREEK[key]}`]);
            return;
          }
          if (key === 'g') {
            pending = 'MG';
            this.host.status('Alt+M G …  (a letter for its Greek letter)');
          } else if (key === 'n') {
            const pos = this.getPos();
            if (pos != null && this.node.type.name === 'math_display') this.host.toggleNumbering(pos);
          } else if (key === 'x') field.executeCommand('moveToSubscript');
          else if (key === 'e') field.executeCommand('moveToSuperscript');
          else if (MATH_KEYS[key]) field.executeCommand(['insert', MATH_KEYS[key]]);
          else this.host.status(`Alt+M ${key} is not a shortcut in a formula`);
          return;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyM') {
          stop();
          pending = 'M';
          this.host.status('Alt+M …  (F fraction, S root, U sum, I integral, X/E sub/superscript, G Greek, N number)');
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.leave(true);
        }
      },
      { capture: true },
    );
    this.field = field;
    this.dom.appendChild(field);
    if (display) this.setLabel(node.attrs.label);
  }

  private setLabel(name: string | null) {
    if (!name) {
      this.label?.remove();
      this.label = null;
      return;
    }
    if (!this.label) {
      this.label = document.createElement('span');
      this.label.className = 'lyx-label lyx-display-label';
      this.dom.appendChild(this.label);
    }
    this.label.textContent = name;
  }

  /** Put the text cursor just after (or before) the formula. */
  private leave(forward: boolean) {
    const pos = this.getPos();
    if (pos == null) return;
    const { state } = this.view;
    const at = state.doc.resolve(forward ? pos + this.node.nodeSize : pos);
    this.view.dispatch(state.tr.setSelection(Selection.near(at, forward ? 1 : -1)).scrollIntoView());
    this.view.focus();
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // Changes from elsewhere (undo, a re-read file) reach a formula not being edited.
    if (document.activeElement !== this.field && this.field.getValue('latex') !== node.attrs.latex) this.field.value = node.attrs.latex;
    if (node.type.name === 'math_display') this.setLabel(node.attrs.label);
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
    this.field.focus();
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  /** The formula handles its own keys and clicks. */
  stopEvent(e: Event) {
    return this.field.contains(e.target as Node) || e.target === this.field;
  }

  ignoreMutation() {
    return true;
  }
}
