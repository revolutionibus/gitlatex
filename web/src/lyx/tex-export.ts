/**
 * LyX-style blocks → LaTeX.
 *
 * `genRun` writes LaTeX for a run of blocks (the logic of LyX's LaTeX export).
 * `exportTex` writes a whole file: blocks are grouped into runs by the source
 * chunk they came from (`data-chunk`); a run whose LaTeX is what it was right
 * after loading is written as the original source text, so formatting,
 * comments and line breaks of untouched parts survive. Packages and theorem
 * definitions that new content needs are added to the preamble.
 */
import { FRONT, HEAD_CMD, LISTS, SC, SIZE_TEX, THM, ENVS, headLevel, isTextBlock, latexOf, stripEnv } from './model';
import type { Chunk } from './tex-import';

/** What the generated LaTeX needs from the preamble. */
export interface Needs {
  ulem?: boolean;
  url?: boolean;
  hyperref?: boolean;
  color?: boolean;
  graphicx?: boolean;
  lyxarrow?: boolean;
  lyxcode?: boolean;
  amsmath?: boolean;
  /** Theorem environments used: env → layout. */
  theorems?: Record<string, string>;
}

export function escTex(s: string) {
  return s
    .replace(/\u200B/g, '')
    .replace(/\u00a0/g, '~')
    .replace(/\n/g, ' ')
    .replace(/[\\{}$&#^_%~<>\u201c\u201d\u2018\u2019]/g, (c) =>
      ({
        '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '#': '\\#', '^': '\\textasciicircum{}',
        _: '\\_', '%': '\\%', '~': '\\textasciitilde{}', '<': '\\textless{}', '>': '\\textgreater{}',
        '\u201c': '``', '\u201d': "''", '\u2018': '`', '\u2019': "'",
      })[c]!,
    );
}

const ertText = (n: Element) => (n.querySelector('.ibody')?.textContent ?? '').replace(/\u200B/g, '');

export function inlineTex(node: Node, F: Needs): string {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      out += escTex((n as Text).data);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as HTMLElement;
    const c = el.classList;
    if (c.contains('mwrap')) {
      const v = latexOf(el.querySelector('math-field'));
      if (v.trim()) out += '$' + v + '$';
      continue;
    }
    if (c.contains('sc')) {
      const k = el.dataset.sc!;
      if (k === 'menusep') F.lyxarrow = true;
      out += SC[k] ? SC[k].tex : '';
      continue;
    }
    if (c.contains('lb')) {
      out += el.dataset.lb === 'linebreak' ? '\\linebreak{}\n' : '\\\\\n';
      continue;
    }
    if (c.contains('inset')) {
      out += insetTex(el, F);
      continue;
    }
    if (el.tagName === 'BR') continue;
    const inner = inlineTex(el, F);
    if (!/\S/.test(inner)) {
      out += inner;
      continue;
    }
    const tag = el.tagName;
    if (tag === 'EM') out += '\\emph{' + inner + '}';
    else if (tag === 'I') out += '\\textit{' + inner + '}';
    else if (tag === 'STRONG' || tag === 'B') out += '\\textbf{' + inner + '}';
    else if (tag === 'U') out += '\\underline{' + inner + '}';
    else if (tag === 'S') {
      F.ulem = true;
      out += '\\sout{' + inner + '}';
    } else if (tag === 'SUB') out += '\\textsubscript{' + inner + '}';
    else if (tag === 'SUP') out += '\\textsuperscript{' + inner + '}';
    else if (c.contains('ftt')) out += '\\texttt{' + inner + '}';
    else if (c.contains('fsf')) out += '\\textsf{' + inner + '}';
    else if (c.contains('frm')) out += '\\textrm{' + inner + '}';
    else if (c.contains('noun')) out += '\\textsc{' + inner + '}';
    else if (c.contains('uuline')) {
      F.ulem = true;
      out += '\\uuline{' + inner + '}';
    } else if (c.contains('uwave')) {
      F.ulem = true;
      out += '\\uwave{' + inner + '}';
    } else {
      const sz = [...c].find((x) => x.startsWith('sz-'));
      out += sz && SIZE_TEX[sz.slice(3)] ? '{\\' + SIZE_TEX[sz.slice(3)] + ' ' + inner + '}' : inner;
    }
  }
  return out;
}

function insetTex(n: HTMLElement, F: Needs): string {
  const t = n.dataset.inset;
  const body = n.querySelector(':scope > .ibody');
  const d = n.dataset;
  switch (t) {
    case 'Foot':
      return '\\footnote{' + inlineTex(body!, F).trim() + '}';
    case 'Marginal':
      return '\\marginpar{' + inlineTex(body!, F).trim() + '}';
    case 'Note':
      if (d.note === 'Greyedout') {
        F.color = true;
        return '{\\color{gray}' + inlineTex(body!, F) + '}';
      }
      return '';
    case 'ERT':
      return ertText(n);
    case 'URL':
      F.url = true;
      return '\\url{' + body!.textContent!.replace(/\u200B/g, '').trim() + '}';
    case 'Label':
      return '\\label{' + d.name + '}';
    case 'Ref':
      return '\\' + (d.cmd || 'ref') + '{' + d.name + '}';
    case 'Href':
      F.hyperref = true;
      return '\\href{' + d.target + '}{' + escTex(d.name || d.target || '') + '}';
    case 'Cite':
      return '\\' + (d.cmd || 'cite') + (d.opt || '') + '{' + (d.keys || '') + '}';
    case 'Graphics':
      F.graphicx = true;
      return '\\includegraphics' + (d.star ? '*' : '') + (d.opt ? '[' + d.opt + ']' : '') + '{' + d.path + '}';
    case 'Caption':
      return '\\caption' + (d.opt != null ? '[' + d.opt + ']' : '') + '{' + inlineTex(body!, F).trim() + '}';
    case 'Float': {
      const env = (d.float || 'figure') + (d.star ? '*' : '');
      return '\\begin{' + env + '}' + (d.opt ? '[' + d.opt + ']' : '') + '\n' + inlineTex(body!, F).trim() + '\n\\end{' + env + '}';
    }
    case 'Raw':
      return d.raw ? d.raw : '';
  }
  return '';
}

/** The environment a block's layout is written in (`thm` when the preamble calls Theorem that). */
export function envName(b: HTMLElement, envFor: (layout: string) => string | null): string | null {
  if (!isTextBlock(b)) return null;
  const t = b.dataset.type!;
  if (THM[t]) return b.dataset.env || envFor(t) || t.toLowerCase();
  return LISTS[t] || ENVS[t] || null;
}

export function displayTex(b: HTMLElement): string[] {
  const latex = latexOf(b.querySelector('math-field')).trim();
  const d = b.dataset;
  const lab = d.label ? '\\label{' + d.label + '}' : '';
  if (d.env) {
    const name = d.env + (d.numbered ? '' : '*');
    return [`\\begin{${name}}${d.envarg || ''}`, stripEnv(latex) + lab, `\\end{${name}}`];
  }
  if (d.envname) return [`\\begin{${d.envname}}`, latex + lab, `\\end{${d.envname}}`];
  if (d.numbered) return ['\\begin{equation}', latex + lab, '\\end{equation}'];
  if (lab) return ['\\begin{equation*}', latex + lab, '\\end{equation*}'];
  if (d.delim === '$$') return ['$$' + latex + '$$'];
  return ['\\[', latex, '\\]'];
}

const isErtBlock = (b: HTMLElement) => {
  if (b.dataset.type !== 'Standard') return false;
  const kids = [...b.childNodes].filter((n) => !(n.nodeType === 3 && !(n as Text).data.replace(/\u200B/g, '').trim()) && n.nodeName !== 'BR');
  return kids.length === 1 && (kids[0] as HTMLElement).dataset?.inset === 'ERT';
};

/** LaTeX for a run of blocks. */
export function genRun(blocks: HTMLElement[], F: Needs, envFor: (layout: string) => string | null): string {
  const out: string[] = [];
  const stack: { env: string; depth: number }[] = [];
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };
  const closeEnv = () => {
    const e = stack.pop()!;
    out.push(`\\end{${e.env}}`);
  };
  for (const b of blocks) {
    const t = b.dataset.type!;
    const d = +(b.dataset.depth || 0);
    if (t === '_display') {
      while (stack.length && stack[stack.length - 1].depth > d) closeEnv();
      F.amsmath = F.amsmath || !!b.dataset.env;
      out.push(...displayTex(b));
      continue;
    }
    if (b.dataset.cont && isTextBlock(b)) {
      const c = inlineTex(b, F).trim();
      if (c) out.push(c);
      continue;
    }
    if (FRONT[t]) {
      while (stack.length) closeEnv();
      blank();
      out.push(`\\${FRONT[t]}${b.dataset.opt != null ? '[' + b.dataset.opt + ']' : ''}{${inlineTex(b, F).trim()}}`);
      continue;
    }
    const env = isTextBlock(b) ? envName(b, envFor) : null;
    const top = () => stack[stack.length - 1];
    while (stack.length && (top().depth > d || (top().depth === d && top().env !== env))) closeEnv();
    if (headLevel(t) != null) while (stack.length) closeEnv();
    if (env && top() && top().env === env && top().depth === d && b.dataset.newenv && !LISTS[t]) closeEnv();
    if (env && !(top() && top().depth === d && top().env === env)) {
      if (!(LISTS[t] && stack.length)) blank(); // a nested list follows its item directly
      let open = `\\begin{${env}}`;
      if (THM[t] && b.dataset.arg != null) open += '[' + b.dataset.arg + ']';
      if (b.dataset.envarg) open += b.dataset.envarg;
      out.push(open);
      stack.push({ env, depth: d });
      if (THM[t]) (F.theorems ??= {})[env] = t;
      if (env === 'lyxcode') F.lyxcode = true;
    } else if (!(env && LISTS[t])) blank();
    if (t === '_toc') {
      out.push('\\tableofcontents');
      continue;
    }
    if (t === '_newpage') {
      out.push('\\' + (b.dataset.variant || 'newpage'));
      continue;
    }
    if (t === '_line') {
      out.push('\\noindent\\rule[0.5ex]{1\\columnwidth}{1pt}');
      continue;
    }
    if (isErtBlock(b)) {
      out.push(ertText(b.querySelector('.inset[data-inset="ERT"]')!));
      continue;
    }
    const lvl = headLevel(t);
    if (lvl != null) {
      // labels at the end of a heading go after it: \section{Intro}\label{sec:intro}
      const clone = b.cloneNode(true) as HTMLElement;
      const labels: string[] = [];
      for (;;) {
        let last = clone.lastChild;
        while (last && ((last.nodeType === 3 && !(last as Text).data.replace(/\u200B/g, '').trim()) || last.nodeName === 'BR')) {
          const p = last.previousSibling;
          last.remove();
          last = p;
        }
        if (last && (last as HTMLElement).dataset?.inset === 'Label') {
          labels.unshift('\\label{' + (last as HTMLElement).dataset.name + '}');
          last.remove();
        } else break;
      }
      const opt = b.dataset.opt != null ? '[' + b.dataset.opt + ']' : '';
      out.push(`\\${HEAD_CMD[lvl]}${t.endsWith('*') ? '*' : ''}${opt}{${inlineTex(clone, F).trim()}}${labels.join('')}`);
      continue;
    }
    let c = inlineTex(b, F).trim();
    if (LISTS[t]) {
      if (t === 'Description') {
        const m = /^(\S+)\s*([\s\S]*)$/.exec(c) || ['', '', ''];
        out.push(`\\item[${m[1]}]${m[2] ? ' ' + m[2] : ''}`);
      } else out.push('\\item' + (b.dataset.itemopt != null ? '[' + b.dataset.itemopt + ']' : '') + (c ? ' ' + c : ''));
      continue;
    }
    if (b.dataset.noindent) c = '\\noindent ' + c;
    if (b.dataset.align && !env) {
      const al = ({ center: 'center', left: 'flushleft', right: 'flushright' } as Record<string, string>)[b.dataset.align];
      if (al) {
        out.push(`\\begin{${al}}`, c, `\\end{${al}}`);
        continue;
      }
    }
    if (c) out.push(c);
  }
  while (stack.length) closeEnv();
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** Whether a block without a chunk should join the run before it (a new list item, a continuation…). */
function joins(prev: HTMLElement, b: HTMLElement, envFor: (layout: string) => string | null) {
  if (b.dataset.cont || +(b.dataset.depth || 0) > 0 || b.dataset.type === '_display') return true;
  if (prev.dataset.type === '_display' && isTextBlock(b) && b.dataset.cont) return true;
  const e = envName(b, envFor);
  return !!e && e === envName(prev, envFor) && (prev.dataset.depth || '0') === (b.dataset.depth || '0') && !b.dataset.newenv;
}

export interface Run {
  blocks: HTMLElement[];
  /** The chunk every block came from, or null when the run mixes chunks or has new blocks. */
  chunk: string | null;
  /** The chunk of the first block, for its leading whitespace. */
  firstChunk: string | null;
}

export function runsOf(blocks: HTMLElement[], envFor: (layout: string) => string | null): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  let prev: HTMLElement | null = null;
  for (const b of blocks) {
    const id = b.dataset.chunk ?? null;
    const curIds: Set<string | null> | null = cur ? new Set(cur.blocks.map((x) => x.dataset.chunk ?? null)) : null;
    const same = cur && prev && id !== null && curIds!.size === 1 && curIds!.has(id) && prev.dataset.chunk === id;
    const attach = cur && prev && (id === null || prev.dataset.chunk == null) && joins(prev, b, envFor);
    if (cur && (same || attach)) {
      cur.blocks.push(b);
      if (cur.chunk !== id) cur.chunk = null;
    } else {
      cur = { blocks: [b], chunk: id, firstChunk: id };
      runs.push(cur);
    }
    prev = b;
  }
  return runs;
}

export interface ExportResult {
  text: string;
  /** The 1-based line each block starts on (approximate inside unchanged chunks). */
  lines: Map<HTMLElement, number>;
}

export interface ExportDoc {
  head: string;
  tail: string;
  trailing: string;
  chunks: Chunk[];
  envFor: (layout: string) => string | null;
}

const countLines = (s: string) => {
  let n = 0;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
};

export function exportTex(blocks: HTMLElement[], doc: ExportDoc): ExportResult {
  const F: Needs = {};
  const parts: string[] = [];
  const lines = new Map<HTMLElement, number>();
  let line = 1 + countLines(doc.head);
  for (const run of runsOf(blocks, doc.envFor)) {
    const ch = run.chunk != null ? doc.chunks[+run.chunk] : null;
    const first = run.firstChunk != null ? doc.chunks[+run.firstChunk] : null;
    const runF: Needs = {};
    const gen = genRun(run.blocks, runF, doc.envFor);
    const keep = !!ch && ch.gen === gen;
    if (!keep) mergeNeeds(F, runF);
    const gap = first ? first.gap : parts.length ? '\n\n' : '';
    const text = keep ? ch!.src : gen;
    line += countLines(gap);
    for (const b of run.blocks) lines.set(b, line);
    parts.push(gap + text);
    line += countLines(text);
  }
  const head = ensurePreamble(doc.head, F);
  const body = parts.join('');
  let trailing = doc.trailing;
  if (doc.tail && !trailing.includes('\n')) trailing = '\n';
  return { text: head + body + trailing + doc.tail, lines };
}

function mergeNeeds(a: Needs, b: Needs) {
  for (const [k, v] of Object.entries(b)) {
    if (k === 'theorems') a.theorems = { ...a.theorems, ...(v as Record<string, string>) };
    else if (v) (a as Record<string, unknown>)[k] = v;
  }
}

/* ---------- Preamble ---------- */
const hasPackage = (head: string, pkg: string) => new RegExp(`\\\\(usepackage|RequirePackage)\\s*(\\[[^\\]]*\\])?\\s*\\{[^}]*\\b${pkg}\\b[^}]*\\}`).test(head);
const CLASS_THEOREMS = /\\documentclass\s*(\[[^\]]*\])?\s*\{(llncs|svjour3?|svmult|svmono|elsarticle-thm)\}/;

/** Add what new content needs (packages, \newtheorem) just before \begin{document}. */
export function ensurePreamble(head: string, F: Needs): string {
  const at = head.search(/\\begin\s*\{document\}/);
  if (at < 0) return head;
  const add: string[] = [];
  const pkg = (name: string, opt = '') => {
    if (!hasPackage(head, name)) add.push(`\\usepackage${opt}{${name}}`);
  };
  if (F.amsmath && !hasPackage(head, 'amsmath') && !hasPackage(head, 'mathtools')) pkg('amsmath');
  if (F.ulem) pkg('ulem', '[normalem]');
  if (F.graphicx && !hasPackage(head, 'graphics')) pkg('graphicx');
  if (F.color && !hasPackage(head, 'color')) pkg('xcolor');
  if (F.hyperref) pkg('hyperref');
  else if (F.url && !hasPackage(head, 'hyperref')) pkg('url');
  const thms = Object.entries(F.theorems ?? {}).filter(([env]) => !new RegExp(`\\\\(new|sp)theorem\\*?\\s*\\{${env}\\}`).test(head));
  if (thms.length && !CLASS_THEOREMS.test(head)) {
    if (!hasPackage(head, 'amsthm') && !hasPackage(head, 'ntheorem')) add.push('\\usepackage{amsthm}');
    const byStyle: Record<string, string[]> = { plain: [], definition: [], remark: [] };
    let shared = /\\newtheorem\s*\{(theorem|thm)\}/.exec(head)?.[1] ?? '';
    for (const [env, layout] of thms) {
      const style = THM[layout];
      if (style === 'proof') continue; // amsthm defines proof
      if (!shared && style === 'plain') {
        byStyle.plain.unshift(`\\newtheorem{${env}}{${layout}}`);
        shared = env;
      } else byStyle[style].push(`\\newtheorem{${env}}${shared && shared !== env ? `[${shared}]` : ''}{${layout}}`);
    }
    for (const style of ['plain', 'definition', 'remark']) if (byStyle[style].length) add.push(`\\theoremstyle{${style}}`, ...byStyle[style]);
    if (byStyle.definition.length || byStyle.remark.length) add.push('\\theoremstyle{plain}');
  }
  if (F.lyxarrow && !/\\lyxarrow/.test(head)) add.push('\\DeclareRobustCommand*{\\lyxarrow}{\\leavevmode\\,$\\triangleright$\\,\\allowbreak}');
  if (F.lyxcode && !/\{lyxcode\}/.test(head))
    add.push('\\newenvironment{lyxcode}{\\par\\begin{list}{}{\\setlength{\\rightmargin}{\\leftmargin}\\setlength{\\listparindent}{0pt}\\raggedright\\setlength{\\itemsep}{0pt}\\setlength{\\parsep}{0pt}\\normalfont\\ttfamily}\\item[]}{\\end{list}}');
  if (!add.length) return head;
  const before = head.slice(0, at);
  const sep = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '' : '\n';
  return before + sep + add.join('\n') + '\n\n' + head.slice(at);
}
