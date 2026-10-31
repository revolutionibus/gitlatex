/**
 * LaTeX → LyX-style blocks (what LyX's tex2lyx does, for the constructs the
 * editor can show). Anything else becomes a TeX-code (ERT) inset holding the
 * source verbatim, so nothing is lost.
 *
 * The body is cut into chunks — a paragraph, a heading, a whole list or
 * theorem, a display formula, a run of comment lines — and every block made
 * from a chunk carries `data-chunk`. The writer (tex-export.ts) puts a chunk's
 * original text back unless its blocks were edited, so opening and saving a
 * file in the LyX editor changes only what was changed.
 */
import {
  HEAD_CMD, HEAD_NAMES, KNOWN, LAYOUT_GROUPS, THM, ZW, TEX_SIZE, envWrap, ENVVIS,
  mkAtom, mkBlock, mkDisplay, mkERT, mkInset, mkLB, mkMath, mkSC, mkSpecial,
} from './model';
import { TABULAR_ENVS, mkTabular, type TabCell } from './tabular';

export interface Chunk {
  /** The chunk's source text. */
  src: string;
  /** The whitespace before it. */
  gap: string;
  /** What the writer produces for the chunk's blocks right after loading (set by the editor). */
  gen?: string;
}

export interface TexDoc {
  /** Everything up to and including `\begin{document}` ('' for a file without one, e.g. an \input chapter). */
  head: string;
  /** `\end{document}` and everything after it. */
  tail: string;
  /** Whitespace between the last chunk and `tail`. */
  trailing: string;
  blocks: HTMLElement[];
  chunks: Chunk[];
  /** Theorem-like environments: environment name → layout name. */
  theorems: Record<string, string>;
  /** Math macros from the preamble, for MathLive. */
  macros: Record<string, string | { args: number; def: string }>;
}

/* ---------- Theorems ---------- */
const THM_DEFAULT: Record<string, string> = {
  theorem: 'Theorem', thm: 'Theorem', lemma: 'Lemma', lem: 'Lemma', corollary: 'Corollary', cor: 'Corollary',
  proposition: 'Proposition', prop: 'Proposition', conjecture: 'Conjecture', conj: 'Conjecture', claim: 'Claim',
  definition: 'Definition', defn: 'Definition', def: 'Definition', example: 'Example', ex: 'Example', exa: 'Example',
  exercise: 'Exercise', problem: 'Problem', prob: 'Problem', remark: 'Remark', rem: 'Remark', proof: 'Proof',
};

/** Theorem environments the preamble defines (`\newtheorem{thm}{Theorem}` → thm: Theorem), plus the usual names. */
export function theoremsOf(head: string): Record<string, string> {
  const out: Record<string, string> = { ...THM_DEFAULT };
  const re = /\\(?:new|sp)theorem\*?\s*\{([^}]+)\}\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;
  for (let m = re.exec(head); m; m = re.exec(head)) {
    const env = m[1].trim();
    const title = m[2].replace(/\\[a-zA-Z]+\s*|[{}]/g, '').trim() || env;
    out[env] = title.charAt(0).toUpperCase() + title.slice(1);
  }
  return out;
}

/** Make the document's own theorem names (e.g. "Hypothesis") real layouts. */
export function registerTheorems(theorems: Record<string, string>) {
  const group = LAYOUT_GROUPS.find((g) => g[0] === 'Reasoning')!;
  for (const name of Object.values(theorems)) {
    if (KNOWN.has(name)) continue;
    KNOWN.add(name);
    THM[name] = 'plain';
    group[1].push(name);
  }
}

/** `\newcommand{\R}{\mathbb{R}}`, `\DeclareMathOperator{\tr}{tr}`, `\def\eps{\varepsilon}` → MathLive macros. */
export function macrosOf(head: string): TexDoc['macros'] {
  const out: TexDoc['macros'] = {};
  const r = new Reader(head);
  for (let i = 0; i < head.length; i++) {
    if (head[i] === '%') {
      i = eol(head, i);
      continue;
    }
    if (head[i] !== '\\') continue;
    const m = /^\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def)\*?/.exec(head.slice(i, i + 22));
    if (!m) continue;
    r.i = i + m[0].length;
    r.ws();
    let name = '';
    if (head[r.i] === '{') name = r.group().trim();
    else name = /^\\[a-zA-Z]+/.exec(head.slice(r.i))?.[0] ?? '';
    if (!name.startsWith('\\')) continue;
    if (head[r.i] === '\\') r.i += name.length;
    r.ws();
    let args = 0;
    if (m[1] !== 'def' && head[r.i] === '[') {
      args = parseInt(r.opt(), 10) || 0;
      r.ws();
      if (head[r.i] === '[') {
        r.opt(); // default for an optional argument: not supported by MathLive, keep the arity
        r.ws();
      }
    } else if (m[1] === 'def') {
      const params = /^(#\d)+/.exec(head.slice(r.i))?.[0] ?? '';
      args = params.length / 2;
      r.i += params.length;
    }
    if (head[r.i] !== '{') continue;
    const body = r.group();
    i = r.i - 1;
    const def = m[1] === 'DeclareMathOperator' ? `\\operatorname{${body}}` : body;
    out[name.slice(1)] = args ? { args, def } : def;
  }
  return out;
}

/* ---------- Reading primitives ---------- */
const eol = (s: string, i: number) => {
  const j = s.indexOf('\n', i);
  return j < 0 ? s.length : j;
};

class Reader {
  i = 0;
  constructor(public s: string) {}
  get done() {
    return this.i >= this.s.length;
  }
  ws() {
    while (this.i < this.s.length && /[ \t\r\n]/.test(this.s[this.i])) this.i++;
  }
  /** Spaces and at most one newline: TeX's whitespace between a command and its arguments. */
  wsInline() {
    let j = this.i;
    while (j < this.s.length && /[ \t]/.test(this.s[j])) j++;
    if (this.s[j] === '\r') j++;
    if (this.s[j] === '\n') {
      j++;
      while (j < this.s.length && /[ \t]/.test(this.s[j])) j++;
      if (this.s[j] === '\n' || this.s[j] === '\r') return; // a blank line ends the argument list
    }
    this.i = j;
  }
  /** At `{`: return the group's content and move past `}`. */
  group(): string {
    const end = matchBrace(this.s, this.i);
    const inner = this.s.slice(this.i + 1, end);
    this.i = Math.min(this.s.length, end + 1);
    return inner;
  }
  /** At `[`: return the bracket's content and move past `]` (braces inside are skipped). */
  opt(): string {
    const end = matchBracket(this.s, this.i);
    const inner = this.s.slice(this.i + 1, end);
    this.i = Math.min(this.s.length, end + 1);
    return inner;
  }
  /** At `\`: the command name (letters, or one other character), without moving. */
  peekCmd(): string {
    const m = /^\\([a-zA-Z@]+|.)/s.exec(this.s.slice(this.i, this.i + 40));
    return m ? m[1] : '';
  }
  startsWith(t: string) {
    return this.s.startsWith(t, this.i);
  }
}

/** Index of the `}` closing the `{` at `i` (skips escapes and comments); s.length when unbalanced. */
function matchBrace(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') j++;
    else if (c === '%') j = eol(s, j);
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return s.length;
}

function matchBracket(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') j++;
    else if (c === '{') j = matchBrace(s, j);
    else if (c === ']') return j;
  }
  return s.length;
}

/** Index just past the `\end{env}` matching the `\begin{env}` whose name ends at `i` (nesting aware). */
function matchEnd(s: string, i: number, env: string): number {
  const verbatim = /^(verbatim|lstlisting|minted|comment|Verbatim|alltt)\*?$/.test(env);
  const esc = env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = verbatim ? new RegExp(`\\\\end\\s*\\{${esc}\\}`, 'g') : new RegExp(`\\\\(begin|end)\\s*\\{${esc}\\}|%[^\\n]*|\\\\.`, 'g');
  re.lastIndex = i;
  let depth = 1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (verbatim) return m.index + m[0].length;
    if (m[1] === 'begin') depth++;
    else if (m[1] === 'end' && --depth === 0) return m.index + m[0].length;
  }
  return s.length;
}

/* ---------- Classifying environments and commands ---------- */
const MATH_ENVS = new Set(['equation', 'align', 'gather', 'multline', 'flalign', 'alignat', 'eqnarray', 'displaymath', 'math']);
const LIST_ENVS: Record<string, string> = { itemize: 'Itemize', enumerate: 'Enumerate', description: 'Description' };
const PARA_ENVS: Record<string, string> = { quote: 'Quote', quotation: 'Quotation', verse: 'Verse', abstract: 'Abstract' };
const ALIGN_ENVS: Record<string, string> = { center: 'center', flushleft: 'left', flushright: 'right' };
const FLOAT_ENVS = new Set(['figure', 'table']);
/** Environments that start a new paragraph (everything else inside a paragraph is inline TeX code). */
function isBlockEnv(env: string, theorems: Record<string, string>) {
  const base = env.replace(/\*$/, '');
  return !!(LIST_ENVS[base] || PARA_ENVS[base] || ALIGN_ENVS[base] || FLOAT_ENVS.has(base) || theorems[env] || /^(verbatim|lstlisting|minted|Verbatim|tabular|tabularx|longtable|thebibliography|tikzpicture|minipage|algorithm|algorithmic)\*?$/.test(env));
}
const HEADS = new Set(HEAD_CMD);
const FRONT_CMDS: Record<string, string> = { title: 'Title', author: 'Author', date: 'Date' };
const BLOCK_CMDS = new Set(['maketitle', 'tableofcontents', 'newpage', 'clearpage', 'cleardoublepage', 'pagebreak', 'appendix', 'bibliography', 'bibliographystyle', 'printbibliography', 'input', 'include', 'subfile', 'par']);

const ACCENT: Record<string, string> = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', u: '̆', H: '̋', r: '̊', k: '̨' };
/** Symbol commands from packages (amssymb, pifont…): shown as the glyph, written back as the command. */
const GLYPH: Record<string, string> = { checkmark: '\u2713', cmark: '\u2713', xmark: '\u2717' };
const SYMBOL: Record<string, string> = {
  textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textless: '<', textgreater: '>', textbar: '|', textbraceleft: '{', textbraceright: '}',
  textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ',
  S: '§', P: '¶', copyright: '©', pounds: '£', textregistered: '®', texttrademark: '™', textdegree: '°',
};
const FORMAT: Record<string, () => HTMLElement> = {
  textbf: () => document.createElement('strong'),
  emph: () => document.createElement('em'),
  textit: () => document.createElement('i'),
  textsl: () => document.createElement('i'),
  underline: () => document.createElement('u'),
  uline: () => document.createElement('u'),
  sout: () => document.createElement('s'),
  textsubscript: () => document.createElement('sub'),
  textsuperscript: () => document.createElement('sup'),
  texttt: () => span('ftt'),
  textsf: () => span('fsf'),
  textrm: () => span('frm'),
  textsc: () => span('noun'),
  uuline: () => span('uuline'),
  uwave: () => span('uwave'),
};
/** Old-style switches inside a group: {\bf …}, {\em …}, {\large …}. */
const SWITCH: Record<string, () => HTMLElement> = {
  bf: FORMAT.textbf, bfseries: FORMAT.textbf, it: FORMAT.textit, itshape: FORMAT.textit, em: FORMAT.emph, sl: FORMAT.textsl, slshape: FORMAT.textsl,
  tt: FORMAT.texttt, ttfamily: FORMAT.texttt, sf: FORMAT.textsf, sffamily: FORMAT.textsf, rm: FORMAT.textrm, rmfamily: FORMAT.textrm, sc: FORMAT.textsc, scshape: FORMAT.textsc,
};
const REF_CMDS = /^(ref|eqref|pageref|autoref|cref|Cref|nameref|vref|labelcref|cpageref)$/;
const CITE_CMDS = /^(cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite|nocite|Cite|Parencite|Textcite|Autocite|smartcite|supercite)$/;

function span(cls: string) {
  const s = document.createElement('span');
  s.className = cls;
  return s;
}

/* ---------- Tables ---------- */

/** Rules between rows: \hline, \cline{…}, booktabs rules, comment lines. */
const RULE_RE = /^\s*(?:\\(?:hline|toprule|midrule|bottomrule)(?![a-zA-Z])(?:\s*\[[^\]]*\])?|\\(?:cline|cmidrule)(?:\s*\([^)]*\))?\s*\{[^}]*\}|\\(?:addlinespace|specialrule)(?![a-zA-Z])(?:\s*\[[^\]]*\])?(?:\s*\{[^}]*\})*|%[^\n]*(?:\n|$))/;

/** A tabular body → rows of cell sources, with the rules before each row and after the last. */
function splitTabular(body: string): { rows: { rules: string; cells: string[]; end: string }[]; after: string } {
  const rows: { rules: string; cells: string[]; end: string }[] = [];
  let i = 0;
  for (;;) {
    const rules: string[] = [];
    for (let m = RULE_RE.exec(body.slice(i)); m; m = RULE_RE.exec(body.slice(i))) {
      rules.push(m[0].trim());
      i += m[0].length;
    }
    const cells: string[] = [];
    let cs = i;
    let end: string | null = null;
    while (i < body.length && end === null) {
      const c = body[i];
      if (c === '\\' && body[i + 1] === '\\') {
        // the end of the row: \\, \\*, \\[2pt]
        cells.push(body.slice(cs, i));
        let j = i + 2;
        if (body[j] === '*') j++;
        let k = j;
        while (body[k] === ' ' || body[k] === '\t') k++;
        if (body[k] === '[') j = matchBracket(body, k) + 1;
        end = body.slice(i, j);
        i = j;
      } else if (c === '\\') {
        const bm = /^\\begin\s*\{([^}]*)\}/.exec(body.slice(i, i + 80));
        i = bm ? matchEnd(body, i + bm[0].length, bm[1]) : i + 2;
      } else if (c === '{') i = matchBrace(body, i) + 1;
      else if (c === '%') i = eol(body, i) + 1;
      else if (c === '&') {
        cells.push(body.slice(cs, i));
        cs = ++i;
      } else i++;
    }
    if (end === null) {
      const last = body.slice(cs);
      if (!cells.length && !last.trim()) return { rows, after: rules.join(' ') };
      cells.push(last);
      rows.push({ rules: rules.join(' '), cells, end: '' });
      return { rows, after: '' };
    }
    rows.push({ rules: rules.join(' '), cells, end });
  }
}

function tabCell(src: string, ctx: Ctx): TabCell {
  let t = src.trim();
  let span: number | undefined;
  let mc: string | undefined;
  const m = /^\\multicolumn\s*\{\s*(\d+)\s*\}\s*\{/.exec(t);
  if (m) {
    const r = new Reader(t);
    r.i = m[0].length - 1;
    const spec = r.group();
    r.wsInline();
    if (t[r.i] === '{') {
      const inner = r.group();
      if (!t.slice(r.i).trim()) {
        span = +m[1];
        mc = spec;
        t = inner.trim();
      }
    }
  }
  const body = document.createDocumentFragment();
  parseInline(t, body, ctx);
  return { body, span, mc };
}

/** A table environment whose name ends at `i`, as a table inset (null when it cannot be read as one). */
function readTabular(s: string, i: number, env: string, ctx: Ctx): { node: HTMLElement; end: number } | null {
  const r = new Reader(s);
  r.i = i;
  if (env !== 'tabular') {
    // the width of tabular*, tabularx, tabulary
    r.wsInline();
    if (s[r.i] !== '{') return null;
    r.group();
  }
  const save = r.i;
  r.wsInline();
  if (s[r.i] === '[') r.opt();
  else r.i = save;
  const args = s.slice(i, r.i).trim();
  r.wsInline();
  if (s[r.i] !== '{') return null;
  const spec = r.group();
  const end = matchEnd(s, r.i, env);
  const em = /\\end\s*\{[^}]*\}$/.exec(s.slice(r.i, end));
  if (!em) return null;
  const { rows, after } = splitTabular(s.slice(r.i, end - em[0].length));
  if (!rows.length) return null;
  const node = mkTabular(env, args, spec, rows.map((row) => ({ rules: row.rules, end: row.end, cells: row.cells.map((c) => tabCell(c, ctx)) })), after);
  return { node, end };
}

/* ---------- Inline content ---------- */

/** Parse inline LaTeX (no paragraph breaks) into `out`. */
function parseInline(src: string, out: Node, ctx: Ctx) {
  const r = new Reader(src);
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const t = buf.replace(/[ \t\r\n]+/g, ' ');
    const last = out.lastChild;
    if (last && last.nodeType === 3) (last as Text).data += t;
    else out.appendChild(document.createTextNode(t));
    buf = '';
  };
  const put = (n: Node) => {
    flush();
    out.appendChild(n);
  };
  while (!r.done) {
    const c = src[r.i];
    if (c === '%') {
      const e = eol(src, r.i);
      put(mkERT(src.slice(r.i, Math.min(src.length, e + 1))));
      r.i = e + 1;
      continue;
    }
    if (c === '~') {
      put(mkSC('protected'));
      r.i++;
      continue;
    }
    if (c === '$') {
      if (src[r.i + 1] === '$') {
        // $$…$$ inside inline content (rare): keep it as code
        const e = src.indexOf('$$', r.i + 2);
        const end = e < 0 ? src.length : e + 2;
        put(mkERT(src.slice(r.i, end)));
        r.i = end;
        continue;
      }
      const e = findDollar(src, r.i + 1);
      put(mkMath(src.slice(r.i + 1, e), true));
      r.i = Math.min(src.length, e + 1);
      continue;
    }
    if (c === '{') {
      const start = r.i;
      const inner = r.group();
      const sw = /^\s*\\([a-zA-Z]+)(?![a-zA-Z])\s*/.exec(inner);
      if (sw && (SWITCH[sw[1]] || TEX_SIZE[sw[1]])) {
        const el = SWITCH[sw[1]] ? SWITCH[sw[1]]() : span('sz-' + TEX_SIZE[sw[1]]);
        parseInline(inner.slice(sw[0].length), el, ctx);
        put(el);
      } else if (!inner.trim()) {
        if (inner) buf += ' ';
        else put(mkERT(src.slice(start, r.i))); // {} after text: keep it
      } else parseInline(inner, out, ctx); // a plain group: just its content
      continue;
    }
    if (c === '`') {
      buf += src[r.i + 1] === '`' ? '“' : '‘';
      r.i += src[r.i + 1] === '`' ? 2 : 1;
      continue;
    }
    if (c === "'" && src[r.i + 1] === "'") {
      buf += '”';
      r.i += 2;
      continue;
    }
    if (c !== '\\') {
      buf += c;
      r.i++;
      continue;
    }
    // ---- a command
    const start = r.i;
    const name = r.peekCmd();
    if (!/^[a-zA-Z@]/.test(name)) {
      r.i += 1 + name.length;
      if (name === '\\') {
        let star = false;
        if (src[r.i] === '*') {
          star = true;
          r.i++;
        }
        if (src[r.i] === '[') {
          r.opt();
          put(mkERT(src.slice(start, r.i)));
        } else if (star) put(mkERT(src.slice(start, r.i)));
        else put(mkLB('newline'));
      } else if ('%&$#_{}'.includes(name)) buf += name;
      else if (name === ',') put(mkSC('thin'));
      else if (name === ' ' || name === '\n') put(mkSC('normal'));
      else if (name === '-') put(mkSC('hyph'));
      else if (name === '/') put(mkSC('lig'));
      else if (name === '@' && src[r.i] === '.') {
        r.i++;
        put(mkSC('eos'));
      } else if (name === '(') {
        const e = src.indexOf('\\)', r.i);
        const end = e < 0 ? src.length : e;
        put(mkMath(src.slice(r.i, end), true));
        r.i = Math.min(src.length, end + 2);
      } else if (ACCENT[name] && accentArg(r)) buf += accentArg(r, true);
      else put(mkERT(src.slice(start, r.i)));
      continue;
    }
    r.i += 1 + name.length;
    let star = false;
    if (src[r.i] === '*') {
      star = true;
      r.i++;
    }
    const args = () => {
      // optional and mandatory arguments as written, for TeX code
      for (;;) {
        const save = r.i;
        r.wsInline();
        if (src[r.i] === '{') r.group();
        else if (src[r.i] === '[') r.opt();
        else {
          r.i = save;
          break;
        }
      }
      return src.slice(start, r.i);
    };
    const req = (): string | null => {
      const save = r.i;
      r.wsInline();
      if (src[r.i] === '{') return r.group();
      r.i = save;
      return null;
    };
    const optArg = (): string | null => {
      const save = r.i;
      r.wsInline();
      if (src[r.i] === '[') return r.opt();
      r.i = save;
      return null;
    };
    if (FORMAT[name] && !star) {
      const arg = req();
      if (arg == null) {
        put(mkERT(src.slice(start, r.i)));
        continue;
      }
      const el = FORMAT[name]();
      parseInline(arg, el, ctx);
      put(el);
    } else if ((name === 'footnote' || name === 'marginpar') && !star) {
      const o = optArg();
      const arg = o == null ? req() : null;
      if (arg == null) {
        put(mkERT(args()));
        continue;
      }
      const body = document.createDocumentFragment();
      parseInline(arg, body, ctx);
      put(mkInset(name === 'footnote' ? 'Foot' : 'Marginal', undefined, body));
    } else if (name === 'url') {
      const arg = req();
      if (arg == null) put(mkERT(src.slice(start, r.i)));
      else put(mkInset('URL', undefined, document.createTextNode(arg)));
    } else if (name === 'href') {
      const target = req();
      const text = target == null ? null : req();
      if (text == null) put(mkERT(src.slice(start, r.i)));
      else {
        const tmp = document.createElement('span');
        parseInline(text, tmp, ctx);
        put(mkAtom('Href', { target: target!, name: tmp.textContent!.replace(/​/g, '') }));
      }
    } else if (name === 'label') {
      const arg = req();
      put(arg == null ? mkERT(src.slice(start, r.i)) : mkAtom('Label', { name: arg.trim() }));
    } else if (REF_CMDS.test(name) && !star) {
      const arg = req();
      put(arg == null ? mkERT(src.slice(start, r.i)) : mkAtom('Ref', { name: arg.trim(), cmd: name }));
    } else if (CITE_CMDS.test(name)) {
      let opts = '';
      for (let k = 0; k < 2; k++) {
        const save = r.i;
        const o = optArg();
        if (o == null) break;
        opts += src.slice(save, r.i).trim();
      }
      const keys = req();
      if (keys == null) put(mkERT(src.slice(start, r.i)));
      else put(mkAtom('Cite', { cmd: name + (star ? '*' : ''), keys: keys.replace(/\s+/g, ''), opt: opts }));
    } else if (name === 'includegraphics') {
      const o = optArg();
      const path = req();
      if (path == null) put(mkERT(src.slice(start, r.i)));
      else put(mkAtom('Graphics', { path: path.trim(), opt: o == null ? '' : o, star: star ? '1' : '' }));
    } else if (name === 'caption' && !star) {
      const o = optArg();
      const arg = req();
      if (arg == null) {
        put(mkERT(src.slice(start, r.i)));
        continue;
      }
      const body = document.createDocumentFragment();
      parseInline(arg, body, ctx);
      const ins = mkInset('Caption', undefined, body);
      if (o != null) ins.dataset.opt = o;
      put(ins);
    } else if (name === 'newline' || name === 'linebreak') {
      if (name === 'linebreak' && src[r.i] === '[') put(mkERT(args()));
      else {
        if (src.startsWith('{}', r.i)) r.i += 2;
        put(mkLB(name));
      }
    } else if ((name === 'ldots' || name === 'dots' || name === 'textellipsis' || name === 'slash' || name === 'textcompwordmark' || name === 'lyxarrow') && !star) {
      if (src.startsWith('{}', r.i)) r.i += 2;
      put(mkSC({ ldots: 'dots', dots: 'dots', textellipsis: 'dots', slash: 'slash', textcompwordmark: 'lig', lyxarrow: 'menusep' }[name]!));
    } else if (name === 'nobreakdash' && src[r.i] === '-') {
      r.i++;
      put(mkSC('nbdash'));
    } else if (name === 'textvisiblespace') {
      if (src.startsWith('{}', r.i)) r.i += 2;
      put(mkSC('visible'));
    } else if (SYMBOL[name] && !star) {
      if (src.startsWith('{}', r.i)) r.i += 2;
      else if (/^[a-zA-Z]/.test(name)) {
        // a control word eats the spaces after it
        while (src[r.i] === ' ') r.i++;
      }
      buf += SYMBOL[name];
    } else if (GLYPH[name] && !star) {
      if (src.startsWith('{}', r.i)) r.i += 2;
      put(mkAtom('Sym', { tex: src.slice(start, r.i), glyph: GLYPH[name] }));
    } else if (ACCENT[name] && name.length === 1 && accentArg(r)) {
      buf += accentArg(r, true);
    } else if (name === 'begin') {
      const save = r.i;
      const envName = req();
      if (envName == null) {
        r.i = save;
        put(mkERT(src.slice(start, r.i)));
        continue;
      }
      if (MATH_ENVS.has(envName.replace(/\*$/, ''))) {
        // display math inside inline content (a footnote, a caption): keep it as code
        r.i = matchEnd(src, r.i, envName);
        put(mkERT(src.slice(start, r.i)));
        continue;
      }
      const tab = TABULAR_ENVS.test(envName) ? readTabular(src, r.i, envName, ctx) : null;
      if (tab) {
        r.i = tab.end;
        put(tab.node);
        continue;
      }
      r.i = matchEnd(src, r.i, envName);
      put(mkERT(src.slice(start, r.i)));
    } else {
      put(mkERT(args()));
    }
  }
  flush();
}

/** The argument of an accent at the reader (a letter, or {letter}), as an accented character when `take`. */
function accentArg(r: Reader, take = false): string {
  const s = r.s;
  const name = s.slice(s.lastIndexOf('\\', r.i - 1) + 1, r.i);
  let j = r.i;
  if (/^[a-zA-Z]$/.test(name)) while (s[j] === ' ') j++;
  let ch = '';
  let end = j;
  if (s[j] === '{') {
    const m = /^\{\s*(\\[ij]|[a-zA-Z])\s*\}/.exec(s.slice(j, j + 8));
    if (!m) return '';
    ch = m[1];
    end = j + m[0].length;
  } else if (/[a-zA-Z]/.test(s[j] ?? '') && !/^[a-zA-Z]$/.test(name)) {
    ch = s[j];
    end = j + 1;
  } else if (/[a-zA-Z]/.test(s[j] ?? '') && j > r.i) {
    ch = s[j];
    end = j + 1;
  } else return '';
  if (ch === '\\i') ch = 'i';
  if (ch === '\\j') ch = 'j';
  if (take) r.i = end;
  return (ch + ACCENT[name]).normalize('NFC');
}

/** Index of the `$` closing inline math that starts at `i`. */
function findDollar(s: string, i: number): number {
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === '$') return j;
  }
  return s.length;
}

/* ---------- Paragraph flow ---------- */
interface Ctx {
  theorems: Record<string, string>;
}

interface Frame {
  layout: string;
  depth: number;
  /** Close at `\end{…}` of this environment. */
  end?: string;
  /** Stop at \item (inside a list). */
  list?: boolean;
  /** Extra attributes for every block of the frame (e.g. data-align). */
  attrs?: Record<string, string>;
  /** Attributes for the frame's first block only. */
  first?: Record<string, string>;
}

/**
 * Where the paragraph starting at `i` ends: a blank line, a heading, a block
 * environment, `\end{…}` or `\item`. Display math stays inside; its ranges are returned.
 */
function scanPara(s: string, i: number, ctx: Ctx, frame: Frame): { end: number; displays: [number, number][] } {
  const displays: [number, number][] = [];
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '%') {
      i = eol(s, i);
      continue;
    }
    if (c === '\n') {
      let j = i + 1;
      while (j < n && /[ \t\r]/.test(s[j])) j++;
      if (j >= n || s[j] === '\n') return { end: i, displays };
      i++;
      continue;
    }
    if (c === '{') {
      i = matchBrace(s, i) + 1;
      continue;
    }
    if (c === '$') {
      if (s[i + 1] === '$') {
        const e = s.indexOf('$$', i + 2);
        const end = e < 0 ? n : e + 2;
        displays.push([i, end]);
        i = end;
      } else i = findDollar(s, i + 1) + 1;
      continue;
    }
    if (c !== '\\') {
      i++;
      continue;
    }
    const m = /^\\([a-zA-Z@]+|.)/s.exec(s.slice(i, i + 40));
    const name = m ? m[1] : '';
    if (name === '(') {
      const e = s.indexOf('\\)', i);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (name === '[') {
      const e = s.indexOf('\\]', i);
      const end = e < 0 ? n : e + 2;
      displays.push([i, end]);
      i = end;
      continue;
    }
    if (name === 'begin' || name === 'end') {
      const em = /^\\(?:begin|end)\s*\{([^}]*)\}/.exec(s.slice(i, i + 80));
      const env = em ? em[1] : '';
      if (name === 'end') return { end: i, displays };
      if (MATH_ENVS.has(env.replace(/\*$/, ''))) {
        const end = matchEnd(s, i + em![0].length, env);
        displays.push([i, end]);
        i = end;
        continue;
      }
      if (isBlockEnv(env, ctx.theorems)) return { end: i, displays };
      i = em ? matchEnd(s, i + em[0].length, env) : i + 6;
      continue;
    }
    if (name === 'item' && frame.list) return { end: i, displays };
    if (HEADS.has(name) || FRONT_CMDS[name] || BLOCK_CMDS.has(name)) return { end: i, displays };
    i += 1 + name.length;
  }
  return { end: n, displays };
}

/** Parse the flow of paragraphs and environments in `s` from `r.i` for `frame`, appending blocks. */
function parseFlow(r: Reader, ctx: Ctx, frame: Frame, out: HTMLElement[]) {
  let first = true;
  const stamp = (b: HTMLElement) => {
    if (frame.depth) b.dataset.depth = String(frame.depth);
    if (frame.attrs) Object.assign(b.dataset, frame.attrs);
    if (first && frame.first) Object.assign(b.dataset, frame.first);
    first = false;
    return b;
  };
  for (;;) {
    r.ws();
    if (r.done) return;
    if (frame.end && /^\\end\s*\{/.test(r.s.slice(r.i, r.i + 6))) return;
    if (frame.list && /^\\item(?![a-zA-Z])/.test(r.s.slice(r.i, r.i + 6))) return;
    parseOne(r, ctx, frame, out, frame.layout, stamp); // always consumes input
  }
}

/** Parse one paragraph-level construct at `r.i` into `out`. */
function parseOne(r: Reader, ctx: Ctx, frame: Frame, out: HTMLElement[], layout: string, stamp: (b: HTMLElement) => HTMLElement) {
  const s = r.s;
  const start = r.i;
  if (s[start] === '%') {
    // a run of comment lines
    let e = start;
    for (;;) {
      e = eol(s, e);
      let j = e + 1;
      while (j < s.length && /[ \t]/.test(s[j])) j++;
      if (e < s.length && s[j] === '%') e = j;
      else break;
    }
    r.i = e;
    out.push(stamp(ertBlock(s.slice(start, e))));
    return;
  }
  if (s[start] === '\\') {
    const name = r.peekCmd();
    if (name === 'begin') {
      const em = /^\\begin\s*\{([^}]*)\}/.exec(s.slice(start, start + 80));
      const env = em ? em[1] : '';
      const base = env.replace(/\*$/, '');
      const bodyStart = start + (em ? em[0].length : 6);
      if (MATH_ENVS.has(base)) {
        r.i = matchEnd(s, bodyStart, env);
        out.push(stamp(displayBlock(s.slice(start, r.i))));
        return;
      }
      if (LIST_ENVS[env]) {
        r.i = bodyStart;
        let envarg = '';
        const save = r.i;
        r.wsInline();
        if (s[r.i] === '[') {
          r.opt();
          envarg = s.slice(save, r.i).trim();
        } else r.i = save;
        parseList(r, ctx, env, frame.depth, out, envarg);
        return;
      }
      const thm = ctx.theorems[env];
      if (thm || PARA_ENVS[env]) {
        r.i = bodyStart;
        const firstAttrs: Record<string, string> = { newenv: '1' };
        if (thm) {
          firstAttrs.env = env;
          const save = r.i;
          r.wsInline();
          if (s[r.i] === '[') firstAttrs.arg = r.opt();
          else r.i = save;
        }
        const inner: Frame = { layout: thm || PARA_ENVS[env], depth: frame.depth, end: env, first: firstAttrs, attrs: thm ? { env } : undefined };
        const before = out.length;
        parseFlow(r, ctx, inner, out);
        if (out.length === before) {
          // an empty environment
          const b = stamp(mkBlock(inner.layout));
          Object.assign(b.dataset, firstAttrs, inner.attrs);
          out.push(b);
        }
        skipEnd(r, env);
        return;
      }
      if (ALIGN_ENVS[env]) {
        r.i = bodyStart;
        const inner: Frame = { layout: frame.layout, depth: frame.depth, end: env, attrs: { align: ALIGN_ENVS[env] } };
        parseFlow(r, ctx, inner, out);
        skipEnd(r, env);
        return;
      }
      if (FLOAT_ENVS.has(base)) {
        r.i = bodyStart;
        let opt = '';
        const save = r.i;
        r.wsInline();
        if (s[r.i] === '[') opt = r.opt();
        else r.i = save;
        const end = matchEnd(s, r.i, env);
        let inner = s.slice(r.i, end).replace(new RegExp(`\\\\end\\s*\\{${base}\\*?\\}$`), '').trim();
        r.i = end;
        // the float shows its content centred anyway
        const centering = /^\\centering(?![a-zA-Z])\s*/.exec(inner);
        if (centering) inner = inner.slice(centering[0].length);
        const body = document.createDocumentFragment();
        parseInline(inner, body, ctx);
        const ins = mkInset('Float', base, body);
        if (centering) ins.dataset.centering = '1';
        if (opt) ins.dataset.opt = opt;
        if (env.endsWith('*')) ins.dataset.star = '1';
        const b = mkBlock('Standard', ins);
        out.push(stamp(b));
        return;
      }
      const tab = TABULAR_ENVS.test(env) ? readTabular(s, bodyStart, env, ctx) : null;
      if (tab) {
        r.i = tab.end;
        out.push(stamp(mkBlock('Standard', tab.node)));
        return;
      }
      // any other environment: TeX code
      r.i = matchEnd(s, bodyStart, env);
      out.push(stamp(ertBlock(s.slice(start, r.i))));
      return;
    }
    if (name === '[') {
      const e = s.indexOf('\\]', start);
      r.i = e < 0 ? s.length : e + 2;
      out.push(stamp(displayBlock(s.slice(start, r.i))));
      return;
    }
    if (name === 'end') {
      // a stray \end{…}
      const em = /^\\end\s*\{[^}]*\}/.exec(s.slice(start, start + 80));
      r.i = start + (em ? em[0].length : 4);
      out.push(stamp(ertBlock(s.slice(start, r.i))));
      return;
    }
    if (HEADS.has(name)) {
      r.i = start + 1 + name.length;
      let star = false;
      if (s[r.i] === '*') {
        star = true;
        r.i++;
      }
      r.wsInline();
      let opt: string | null = null;
      if (s[r.i] === '[') opt = r.opt();
      r.wsInline();
      if (s[r.i] !== '{') {
        out.push(stamp(ertBlock(s.slice(start, r.i))));
        return;
      }
      const title = r.group();
      const b = mkBlock(HEAD_NAMES[HEAD_CMD.indexOf(name)] + (star ? '*' : ''));
      b.innerHTML = '';
      parseInline(title, b, ctx);
      // \label right after the heading belongs to it
      for (;;) {
        const save = r.i;
        r.wsInline();
        const lm = /^\\label\s*\{([^}]*)\}/.exec(s.slice(r.i, r.i + 200));
        if (!lm) {
          r.i = save;
          break;
        }
        b.append(mkAtom('Label', { name: lm[1].trim() }));
        r.i += lm[0].length;
      }
      if (opt != null) b.dataset.opt = opt;
      out.push(stamp(fixBlock(b)));
      return;
    }
    if (FRONT_CMDS[name]) {
      r.i = start + 1 + name.length;
      r.wsInline();
      let opt: string | null = null;
      if (s[r.i] === '[') opt = r.opt();
      r.wsInline();
      if (s[r.i] !== '{') {
        out.push(stamp(ertBlock(s.slice(start, r.i))));
        return;
      }
      const b = mkBlock(FRONT_CMDS[name]);
      b.innerHTML = '';
      parseInline(r.group(), b, ctx);
      if (opt != null) b.dataset.opt = opt;
      out.push(stamp(fixBlock(b)));
      return;
    }
    if (name === 'tableofcontents' || name === 'newpage' || name === 'clearpage' || name === 'cleardoublepage' || name === 'pagebreak') {
      r.i = start + 1 + name.length;
      if (s.startsWith('{}', r.i)) r.i += 2;
      if (name === 'pagebreak' && s[r.i] === '[') {
        r.opt();
        out.push(stamp(ertBlock(s.slice(start, r.i))));
        return;
      }
      out.push(stamp(name === 'tableofcontents' ? mkSpecial('_toc') : mkSpecial('_newpage', name)));
      return;
    }
    if (BLOCK_CMDS.has(name)) {
      // \maketitle, \appendix, \bibliography{…}, \input{…}…: TeX code on its own line
      r.i = start + 1 + name.length;
      for (;;) {
        const save = r.i;
        r.wsInline();
        if (s[r.i] === '{') r.group();
        else if (s[r.i] === '[') r.opt();
        else {
          r.i = save;
          break;
        }
      }
      const src = s.slice(start, r.i);
      const child = /^\\(input|include|subfile)\{([^{}]+)\}$/.exec(src);
      out.push(stamp(child ? mkSpecial('_include', child[1], child[2].trim()) : ertBlock(src)));
      return;
    }
  }
  // ---- an ordinary paragraph (which may contain display math)
  const { end, displays } = scanPara(s, start, ctx, frame);
  if (end === start) {
    // nothing we can read as a paragraph here: take one character as code so the loop moves on
    r.i = start + 1;
    out.push(stamp(ertBlock(s[start])));
    return;
  }
  let pos = start;
  let first = true;
  const textBlock = (a: number, b: number) => {
    const t = s.slice(a, b);
    if (!t.trim()) return;
    let body = t;
    const bl = mkBlock(layout);
    bl.innerHTML = '';
    if (first) {
      const ni = /^\s*\\noindent(?![a-zA-Z])\s*/.exec(body);
      if (ni) {
        bl.dataset.noindent = '1';
        body = body.slice(ni[0].length);
      }
    } else bl.dataset.cont = '1';
    parseInline(body.trim(), bl, ctx);
    trimBlock(bl);
    out.push(stamp(fixBlock(bl)));
    first = false;
  };
  for (const [a, b] of displays) {
    textBlock(pos, a);
    out.push(stamp(displayBlock(s.slice(a, b))));
    first = false;
    pos = b;
  }
  textBlock(pos, end);
  r.i = end;
}

function skipEnd(r: Reader, env: string) {
  r.ws();
  const m = /^\\end\s*\{([^}]*)\}/.exec(r.s.slice(r.i, r.i + 80));
  if (m && m[1] === env) r.i += m[0].length;
}

/** The items of a list environment; `r` is just after `\begin{env}[…]`. */
function parseList(r: Reader, ctx: Ctx, env: string, depth: number, out: HTMLElement[], envarg: string) {
  const layout = LIST_ENVS[env];
  let firstItem = true;
  for (;;) {
    r.ws();
    if (r.done) return;
    const em = /^\\end\s*\{([^}]*)\}/.exec(r.s.slice(r.i, r.i + 80));
    if (em) {
      r.i += em[0].length;
      if (em[1] === env) return;
      out.push(ertBlock(em[0])); // a stray \end{…}
      continue;
    }
    if (!/^\\item(?![a-zA-Z])/.test(r.s.slice(r.i, r.i + 6))) {
      // material before the first \item, or stray content: nested at depth + 1
      const before = out.length;
      parseOne(r, ctx, { layout: 'Standard', depth: depth + 1, end: env, list: true }, out, 'Standard', (b) => {
        b.dataset.depth = String(depth + 1);
        return b;
      });
      if (out.length === before) r.i++;
      continue;
    }
    r.i += 5;
    let label: string | null = null;
    const save = r.i;
    r.wsInline();
    if (r.s[r.i] === '[') label = r.opt();
    else r.i = save;
    // the item's first paragraph
    const itemBlocks: HTMLElement[] = [];
    const first: Record<string, string> = {};
    if (firstItem) {
      first.newenv = '1';
      if (envarg) first.envarg = envarg;
    }
    firstItem = false;
    const head = r.i;
    while (r.i < r.s.length && /[ \t]/.test(r.s[r.i])) r.i++;
    const startsBlock = r.s[r.i] === '\n' || r.done || /^\\(begin|end|item)(?![a-zA-Z])/.test(r.s.slice(r.i, r.i + 6));
    if (startsBlock && !/^\\begin\s*\{(equation|align|gather|multline|flalign|alignat|eqnarray)/.test(r.s.slice(r.i, r.i + 30))) {
      // an item whose first paragraph is empty (e.g. it starts with a nested list)
      r.i = head;
      const b = mkBlock(layout);
      itemBlocks.push(b);
    } else {
      r.i = head;
      parseOne(r, ctx, { layout, depth, end: env, list: true }, itemBlocks, layout, (b) => b);
      // display math and continuation lines in the first paragraph stay at the item's depth
    }
    if (itemBlocks.length) {
      const b = itemBlocks[0];
      if (b.dataset.type === layout) {
        if (label != null) {
          if (layout === 'Description') {
            const lab = document.createDocumentFragment();
            const parts = label.trim().split(/\s+/);
            parts.forEach((p, k) => {
              if (k) lab.append(mkSC('protected'));
              parseInline(p, lab, ctx);
            });
            if (b.firstChild && b.firstChild.nodeName === 'BR') b.innerHTML = '';
            b.prepend(lab, document.createTextNode(' '));
          } else b.dataset.itemopt = label;
        }
        Object.assign(b.dataset, first);
      } else {
        const ib = mkBlock(layout);
        Object.assign(ib.dataset, first);
        if (label != null) ib.dataset.itemopt = label;
        itemBlocks.unshift(ib);
      }
    }
    for (const b of itemBlocks) {
      if (depth) b.dataset.depth = String(depth);
      else delete b.dataset.depth;
      out.push(b);
    }
    // further paragraphs and nested lists of the item: depth + 1
    parseFlow(r, ctx, { layout: 'Standard', depth: depth + 1, end: env, list: true }, out);
  }
}

function trimBlock(b: HTMLElement) {
  const f = b.firstChild;
  if (f && f.nodeType === 3) (f as Text).data = (f as Text).data.replace(/^\s+/, '');
  const l = b.lastChild;
  if (l && l.nodeType === 3) (l as Text).data = (l as Text).data.replace(/\s+$/, '');
  [...b.childNodes].forEach((n) => n.nodeType === 3 && !(n as Text).data && n.remove());
}

function fixBlock(b: HTMLElement) {
  if (!b.childNodes.length) b.appendChild(document.createElement('br'));
  return b;
}

/** A paragraph holding only a TeX-code inset (a comment, an unknown environment, \maketitle…). */
function ertBlock(tex: string): HTMLElement {
  const b = mkBlock('Standard', mkERT(tex));
  b.dataset.ert = '1';
  return b;
}

/** A display formula from its source: \[…\], $$…$$ or a math environment. */
export function displayBlock(src: string): HTMLElement {
  let m: RegExpExecArray | null;
  if ((m = /^\\\[([\s\S]*)\\\]$/.exec(src)) || (m = /^\$\$([\s\S]*)\$\$$/.exec(src))) {
    const { tex, label } = takeLabel(m[1]);
    const b = mkDisplay(tex.trim(), false, '', label, true);
    b.dataset.delim = src.startsWith('$$') ? '$$' : '';
    return b;
  }
  m = /^\\begin\s*\{([a-z]+)(\*?)\}(\{[^}]*\})?([\s\S]*)\\end\s*\{\1\2\}$/.exec(src);
  if (!m) return ertBlock(src);
  const [, env, star, arg, inner] = m;
  const { tex, label } = takeLabel(inner);
  if (env === 'equation' || env === 'displaymath' || env === 'math') {
    const b = mkDisplay(tex.trim(), env === 'equation' && !star, '', label, true);
    if (env !== 'equation') b.dataset.envname = env;
    else if (star) b.dataset.envname = 'equation*';
    return b;
  }
  if (!ENVVIS[env]) return ertBlock(src);
  const b = mkDisplay(envWrap(env, tex.trim()), !star, env, label, true);
  if (arg) b.dataset.envarg = arg;
  return b;
}

/** Take a single \label out of a formula (several labels stay in the formula). */
function takeLabel(tex: string): { tex: string; label: string } {
  const all = tex.match(/\\label\s*\{[^}]*\}/g);
  if (!all || all.length !== 1) return { tex, label: '' };
  let label = '';
  const t = tex.replace(/\\label\s*\{([^}]*)\}/, (_x, n: string) => {
    label = n.trim();
    return '';
  });
  return { tex: t, label };
}

/* ---------- Whole files ---------- */

/** Split a .tex file and read its body into blocks. */
export function parseTex(text: string): TexDoc {
  let head = '';
  let body = text;
  let tail = '';
  const begin = /\\begin\s*\{document\}[^\n]*\n?/.exec(stripComments(text));
  if (begin) {
    head = text.slice(0, begin.index + begin[0].length);
    body = text.slice(head.length);
    const endRe = /\\end\s*\{document\}/g;
    const stripped = stripComments(body);
    let last: RegExpExecArray | null = null;
    for (let m = endRe.exec(stripped); m; m = endRe.exec(stripped)) last = m;
    if (last) {
      tail = body.slice(last.index);
      body = body.slice(0, last.index);
    }
  }
  const theorems = theoremsOf(head);
  const ctx: Ctx = { theorems };
  const r = new Reader(body);
  const blocks: HTMLElement[] = [];
  const chunks: Chunk[] = [];
  const frame: Frame = { layout: 'Standard', depth: 0 };
  for (;;) {
    const gapStart = r.i;
    r.ws();
    const gap = body.slice(gapStart, r.i);
    if (r.done) {
      return { head, tail, trailing: gap, blocks, chunks, theorems, macros: macrosOf(head) };
    }
    const start = r.i;
    const made: HTMLElement[] = [];
    parseOne(r, ctx, frame, made, 'Standard', (b) => b);
    let end = r.i;
    while (end > start && /[ \t\r\n]/.test(body[end - 1])) end--;
    r.i = end;
    const id = String(chunks.length);
    chunks.push({ src: body.slice(start, end), gap });
    for (const b of made) {
      b.dataset.chunk = id;
      blocks.push(b);
    }
  }
}

/** Blank out comments (keeping offsets) so \begin{document} in a comment is not found. */
function stripComments(s: string) {
  return s.replace(/(^|[^\\])(%[^\n]*)/g, (_m, a: string, c: string) => a + ' '.repeat(c.length));
}

export { ZW };

/** The directories of `\graphicspath{{a/}{b/}}`, in order. */
export function graphicsPaths(tex: string): string[] {
  const m = /^[^%\n]*?\\graphicspath\s*\{((?:\s*\{[^{}]*\})*)\s*\}/m.exec(tex);
  return m ? [...m[1].matchAll(/\{([^{}]*)\}/g)].map((d) => d[1].trim()).filter(Boolean) : [];
}
