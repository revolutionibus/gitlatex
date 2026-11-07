/**
 * The numbers LyX shows while you write: sections, enumerate items,
 * theorems, numbered formulas and footnotes, worked out the way LaTeX will
 * number them, plus which paragraphs start an environment.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { isEnvKind, layout as layoutNamed, type Theorems } from './layouts';
import { schema } from './schema';

export interface BlockNumber {
  /** What is shown before the paragraph: "2.1", "Theorem 3", "(a)", "•"… */
  label: string | null;
  /** The paragraph begins a new environment (list, theorem, quote…). */
  envStart: boolean;
}

const roman = (n: number) =>
  [['m', 1000], ['cm', 900], ['d', 500], ['cd', 400], ['c', 100], ['xc', 90], ['l', 50], ['xl', 40], ['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]].reduce(
    (acc, [s, v]) => {
      while (acc.n >= (v as number)) {
        acc.out += s;
        acc.n -= v as number;
      }
      return acc;
    },
    { out: '', n },
  ).out;
const alpha = (n: number) => String.fromCharCode(96 + ((n - 1) % 26) + 1);
/** LaTeX's enumerate labels by nesting level (taken as the paragraph's depth). */
const ENUM = [(n: number) => `${n}.`, (n: number) => `(${alpha(n)})`, (n: number) => `${roman(n)}.`, (n: number) => `${alpha(n).toUpperCase()}.`];
const BULLETS = ['•', '–', '∗', '·'];
const UNNUMBERED_DISPLAY = /^(\\\[|\$\$|displaymath|.*\*)$/;

/** Numbers for the document's top-level blocks, by index. */
export function numberBlocks(doc: PMNode, theorems: Theorems): BlockNumber[] {
  const blocks: PMNode[] = [];
  doc.forEach((b) => blocks.push(b));
  const levels = blocks.filter((b) => b.type === schema.nodes.paragraph).map((b) => layoutNamed(b.attrs.layout, theorems)).filter((l) => l.kind === 'heading' && !l.starred && l.level! > 0);
  // Numbering starts at the highest level the document uses (chapters in a book, sections in an article).
  const base = levels.length ? Math.min(...levels.map((l) => l.level!)) : 2;
  const heads = [0, 0, 0, 0, 0, 0, 0];
  const theoremCount = new Map<string, number>();
  const enumCount: number[] = [];
  let equations = 0;

  return blocks.map((b, k) => {
    if (b.type === schema.nodes.math_display) {
      const numbered = !UNNUMBERED_DISPLAY.test(b.attrs.env) || !!b.attrs.label;
      return { label: numbered ? `(${++equations})` : null, envStart: false };
    }
    if (b.type !== schema.nodes.paragraph) return { label: null, envStart: false };
    const l = layoutNamed(b.attrs.layout, theorems);
    const depth = b.attrs.depth as number;
    if (l.kind === 'heading') {
      if (l.starred) return { label: null, envStart: false };
      if (l.level === 0) return { label: `Part ${roman(++heads[0]).toUpperCase()}`, envStart: false };
      heads[l.level!]++;
      for (let d = l.level! + 1; d < heads.length; d++) heads[d] = 0;
      return { label: l.level! < base ? null : heads.slice(base, l.level! + 1).join('.'), envStart: false };
    }
    if (!isEnvKind(l)) return { label: null, envStart: false };
    // Does it continue the environment of the paragraph before it at its depth?
    let prev = k - 1;
    while (prev >= 0 && (blocks[prev].attrs.depth as number) > depth) prev--;
    const p = blocks[prev];
    const envStart = !(p && p.type === schema.nodes.paragraph && p.attrs.layout === b.attrs.layout && p.attrs.depth === depth && !b.attrs.startsEnv);
    if (l.kind === 'item') {
      if (b.attrs.item != null) return { label: b.attrs.item || '', envStart };
      if (l.name === 'Itemize') return { label: BULLETS[depth % BULLETS.length], envStart };
      if (l.name === 'Enumerate') {
        // The nesting level counts enumerate lists only, as LaTeX does.
        enumCount[depth] = envStart ? 1 : (enumCount[depth] ?? 0) + 1;
        return { label: ENUM[Math.min(depth, ENUM.length - 1)](enumCount[depth]), envStart };
      }
      return { label: '', envStart };
    }
    if (l.theorem && envStart) {
      if (l.name === 'Proof') return { label: b.attrs.envOpt ? `Proof (${b.attrs.envOpt}).` : 'Proof.', envStart };
      const n = (theoremCount.get(l.name) ?? 0) + 1;
      theoremCount.set(l.name, n);
      return { label: `${l.name} ${n}${b.attrs.envOpt ? ` (${b.attrs.envOpt})` : ''}.`, envStart };
    }
    return { label: envStart && l.name === 'Abstract' ? 'Abstract' : null, envStart };
  });
}
