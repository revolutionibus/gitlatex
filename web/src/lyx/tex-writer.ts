/**
 * The LyX-style editor's document → LaTeX.
 *
 * The flat run of paragraphs is first grouped back into what LaTeX needs:
 * consecutive paragraphs with the same environment layout (Itemize, Theorem,
 * Quote…) at the same depth form one environment, and deeper blocks nest
 * under the paragraph above them. Then every group whose nodes are exactly
 * those of a unit the reader recorded is written as that unit's original
 * text; only what was edited is generated, as one clean line per paragraph.
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { isEnvKind, layout as layoutNamed, type Layout, type Theorems } from './layouts';
import { MARK_COMMANDS, schema } from './schema';
import type { UnitKind, Units } from './tex-reader';
import { withPreambleNeeds } from './preamble';
import { writeTable } from './table';

// ---- grouping ------------------------------------------------------------------------------

interface Member {
  head: PMNode;
  children: Group[];
  nodes: PMNode[];
}

type Group =
  | { kind: 'env'; layout: Layout; members: Member[]; nodes: PMNode[] }
  /** center / flushleft / flushright around aligned paragraphs. */
  | { kind: 'align'; env: string; groups: Group[]; nodes: PMNode[] }
  /** A block, with the blocks written straight after it (around a display formula). */
  | { kind: 'chain'; nodes: PMNode[] };

const depthOf = (n: PMNode) => (n.attrs.depth as number) ?? 0;

function group(blocks: readonly PMNode[], theorems: Theorems): Group[] {
  let i = 0;
  const envLayout = (n: PMNode | undefined) => {
    if (n?.type !== schema.nodes.paragraph) return null;
    const l = layoutNamed(n.attrs.layout, theorems);
    return isEnvKind(l) ? l : null;
  };
  const level = (minDepth: number): Group[] => {
    const out: Group[] = [];
    while (i < blocks.length && depthOf(blocks[i]) >= minDepth) {
      const b = blocks[i];
      const l = envLayout(b);
      if (l) {
        const d = depthOf(b);
        const members: Member[] = [];
        while (i < blocks.length) {
          const h = blocks[i];
          if (envLayout(h)?.name !== l.name || depthOf(h) !== d || (members.length && h.attrs.startsEnv)) break;
          i++;
          const children = level(d + 1);
          members.push({ head: h, children, nodes: [h, ...children.flatMap((c) => c.nodes)] });
        }
        out.push({ kind: 'env', layout: l, members, nodes: members.flatMap((m) => m.nodes) });
      } else {
        const nodes = [b];
        i++;
        while (i < blocks.length && blocks[i].attrs.joinPrev && !envLayout(blocks[i]) && depthOf(blocks[i]) >= minDepth) nodes.push(blocks[i++]);
        out.push({ kind: 'chain', nodes });
      }
    }
    return wrapAligned(out);
  };
  const out: Group[] = [];
  // Blocks shallower than the ones before them start a new level.
  while (i < blocks.length) out.push(...level(0));
  return out;
}

/** Consecutive groups with the same alignment go into one center / flushleft / flushright. */
function wrapAligned(groups: Group[]): Group[] {
  const out: Group[] = [];
  for (const g of groups) {
    // Paragraphs and tables can be aligned.
    const align = (g.nodes[0].attrs.align as string | null | undefined) ?? null;
    const last = out[out.length - 1];
    if (!align) out.push(g);
    else if (last?.kind === 'align' && last.env === align) {
      last.groups.push(g);
      last.nodes.push(...g.nodes);
    } else out.push({ kind: 'align', env: align, groups: [g], nodes: [...g.nodes] });
  }
  return out;
}

// ---- writing --------------------------------------------------------------------------------

class Writer {
  constructor(
    readonly units: Units,
    readonly theorems: Theorems,
  ) {}

  /** The original text of the unit of this kind made of exactly these nodes, if there is one. */
  reuse(nodes: readonly PMNode[], kind: UnitKind): string | null {
    const unit = this.units.get(nodes[0])?.find((u) => u.kind === kind && u.nodes.length === nodes.length && u.nodes.every((n, k) => n === nodes[k]));
    return unit ? unit.src : null;
  }

  reuseGroup(g: Group) {
    return this.reuse(g.nodes, g.kind === 'chain' ? 'block' : 'env');
  }

  /** Groups at one level, each reused or generated, separated as LaTeX needs. */
  groups(groups: Group[], tight = false, indent = ''): string {
    let out = '';
    groups.forEach((g, k) => {
      const reused = this.reuseGroup(g);
      // Indented as the lines around them: a reused unit's later lines already are.
      const text = reused != null ? indent + reused : this.generate(g).replace(/^(?=.)/gm, indent);
      // In a float (tight) the lines follow each other: \centering, the graphic, the caption.
      if (out) out = separate(out, tight ? 1 : this.gap(groups[k - 1], g));
      out += text.trimEnd();
    });
    return out;
  }

  /**
   * Newlines between two groups: one (the next line) after a heading, before
   * a list nested in an item, or around a display formula; else a blank line
   * (a new paragraph).
   */
  gap(prev: Group | undefined, next: Group, inItem = false): 1 | 2 {
    if (next.nodes[0].attrs.joinPrev) return 1;
    if (inItem && next.kind === 'env') return 1;
    const last = prev?.nodes[prev.nodes.length - 1];
    if (last?.type === schema.nodes.paragraph && layoutNamed(last.attrs.layout, this.theorems).kind === 'heading') return 1;
    return 2;
  }

  generate(g: Group): string {
    if (g.kind === 'align') return `\\begin{${g.env}}\n${this.groups(g.groups)}\n\\end{${g.env}}`;
    if (g.kind === 'chain') {
      return g.nodes.map((n, k) => (k ? (n.attrs.joinPrev ? '\n' : '\n\n') : '') + this.block(n)).join('');
    }
    const first = g.members[0].head;
    const env = first.attrs.env ?? g.layout.latex!;
    const header = `\\begin{${env}}${first.attrs.envOpt != null ? `[${first.attrs.envOpt}]` : ''}${first.attrs.envPre ?? ''}`;
    const items = g.layout.kind === 'item';
    const members = g.members.map((m) => (this.reuse(m.nodes, 'member') ?? this.member(m, items)).trimEnd());
    return `${header}\n${members.join(items ? '\n' : '\n\n')}\n\\end{${env}}`;
  }

  /** An item or environment paragraph with what is nested under it. */
  member(m: Member, item: boolean): string {
    const text = this.inline(m.head);
    let out = item ? `\\item${m.head.attrs.item != null ? `[${m.head.attrs.item}]` : ''}${text ? ` ${text}` : ''}` : text;
    if (m.children.length) out = separate(out, this.gap(undefined, m.children[0], item)) + this.groups(m.children);
    return out;
  }

  block(n: PMNode): string {
    if (n.type === schema.nodes.math_display) return display(n);
    if (n.type === schema.nodes.ert_block) return n.textContent;
    if (n.type === schema.nodes.table) return writeTable(n, (cell) => this.inline(cell));
    // A LyX note is not printed: comment lines.
    if (n.type === schema.nodes.note) return n.textContent.split('\n').map((line) => (line ? `% ${line}` : '%')).join('\n');
    if (n.type === schema.nodes.float) {
      const inner: PMNode[] = [];
      n.forEach((c) => inner.push(c));
      const placement = n.attrs.placement != null ? `[${n.attrs.placement}]` : '';
      return `\\begin{${n.attrs.env}}${placement}\n${this.groups(group(inner, this.theorems), true, n.attrs.indent)}\n\\end{${n.attrs.env}}`;
    }
    const l = layoutNamed(n.attrs.layout, this.theorems);
    if (l.kind === 'heading' || l.kind === 'front') {
      // Labels written inside the heading's text go right after it.
      const labels: string[] = [];
      const text = this.inline(n, (child) => {
        if (child.type !== schema.nodes.label) return false;
        labels.push(`\\label{${child.attrs.name}}`);
        return true;
      });
      const short = (l.kind === 'heading' || l.name === 'Caption') && n.attrs.envOpt != null ? `[${n.attrs.envOpt}]` : '';
      return `\\${l.latex}${l.starred ? '*' : ''}${short}{${text}}${labels.join('')}`;
    }
    return this.inline(n);
  }

  /** A block's inline content as LaTeX; `skip` leaves some children out. */
  inline(parent: PMNode, skip?: (child: PMNode) => boolean): string {
    let out = '';
    let open: readonly Mark[] = [];
    const children: PMNode[] = [];
    parent.forEach((c) => {
      if (!skip?.(c)) children.push(c);
    });
    const setMarks = (want: readonly Mark[]) => {
      let keep = 0;
      while (keep < open.length && keep < want.length && open[keep].eq(want[keep])) keep++;
      out += '}'.repeat(open.length - keep);
      for (const m of want.slice(keep)) out += m.type === schema.marks.href ? `\\href{${m.attrs.url}}{` : `\\${MARK_COMMANDS[m.type.name]}{`;
      open = want;
    };
    children.forEach((c, k) => {
      setMarks(c.marks);
      const tex = c.isText ? escapeText(c.text!) : this.inlineNode(c);
      out += tex;
      // A command name right before a letter would swallow it: \LaTeX text, not \LaTeXtext.
      const next = children[k + 1];
      if (/\\[A-Za-z@]+$/.test(tex) && next?.isText && /^[A-Za-z]/.test(next.text!)) out += '{}';
    });
    setMarks([]);
    return out;
  }

  inlineNode(n: PMNode): string {
    const a = n.attrs;
    switch (n.type.name) {
      case 'math_inline':
        return a.delim === '\\(' ? `\\(${a.latex}\\)` : `$${a.latex}$`;
      case 'ert_inline':
        // A comment runs to the end of the line, so the line has to end there.
        return n.textContent.startsWith('%') ? `${n.textContent}\n` : n.textContent;
      case 'hard_break':
        return '\\\\\n';
      case 'footnote':
        return `\\${a.kind === 'marginpar' ? 'marginpar' : 'footnote'}{${this.inline(n)}}`;
      case 'graphics':
        return `\\includegraphics${a.options != null ? `[${a.options}]` : ''}{${a.path}}`;
      case 'label':
        return `\\label{${a.name}}`;
      case 'ref':
        return `\\${a.cmd}{${a.key}}`;
      case 'cite':
        return `\\${a.cmd}${a.pre != null ? `[${a.pre}][${a.post ?? ''}]` : a.post != null ? `[${a.post}]` : ''}{${a.keys}}`;
      case 'url':
        return `\\url{${a.url}}`;
      default:
        return '';
    }
  }
}

/** `out` ending with at least `lines` newlines (one: next line; two: new paragraph). */
function separate(out: string, lines: number): string {
  const have = /\n*$/.exec(out)![0].length;
  if (have >= lines) return lines === 1 ? out.replace(/\n+$/, '\n') : out;
  return out + '\n'.repeat(lines - have);
}

function display(n: PMNode): string {
  const { latex, env, label } = n.attrs as { latex: string; env: string; label: string | null };
  if (env === '$$' && !label) return `$$${latex}$$`;
  if ((env === '\\[' || env === '$$') && !label) return `\\[\n${latex}\n\\]`;
  // A labelled formula has to be numbered to be referred to.
  const e = env === '\\[' || env === '$$' ? 'equation' : env;
  return `\\begin{${e}}\n${label ? `\\label{${label}}\n` : ''}${latex}\n\\end{${e}}`;
}

const ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', $: '\\$', '#': '\\#', _: '\\_',
  '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '\u00a0': '~', '\u2009': '\\,', '\u2026': '\\ldots{}',
  // Typographic quotes (typing " in the LyX-style editor) as LaTeX writes them.
  '\u201c': '``', '\u201d': "''", '\u2018': '`', '\u2019': "'",
};

/** Text as LaTeX: special characters escaped. */
export const escapeText = (t: string) => t.replace(/[\\{}%&$#_~^\u00a0\u2009\u2026\u201c\u201d\u2018\u2019]/g, (c) => ESCAPES[c]);

/**
 * Write the document back as the .tex file it was read from. With
 * `positions`, each top-level block's offset in the text is recorded (the
 * blocks of a list or theorem share the offset where it starts).
 */
export function writeTex(
  read: { prefix: string; suffix: string; units: Units; theorems: Theorems; envsInUse?: Set<string>; packagesInUse?: Set<string> },
  doc: PMNode,
  positions?: Map<PMNode, number>,
): string {
  const blocks: PMNode[] = [];
  doc.forEach((b) => blocks.push(b));
  const writer = new Writer(read.units, read.theorems);
  const groups = group(blocks, read.theorems);
  const prefix = withPreambleNeeds(read.prefix, doc, read.theorems, read.envsInUse, read.packagesInUse);
  let body = '';
  let lastReused = true;
  groups.forEach((g, k) => {
    const reused = writer.reuseGroup(g);
    // Top-level units keep the whitespace after them, so between two untouched
    // units nothing is added: an untouched file comes back unchanged.
    if (body && !(reused != null && lastReused)) body = separate(body, writer.gap(groups[k - 1], g));
    if (positions) {
      // A reused first unit starts with the whitespace before its block.
      const at = prefix.length + body.length + (reused ? reused.length - reused.trimStart().length : 0);
      for (const n of g.nodes) positions.set(n, at);
    }
    body += reused ?? writer.generate(g);
    lastReused = reused != null;
  });
  if (!lastReused && body && read.suffix) body = separate(body, 1);
  return prefix + body + read.suffix;
}
