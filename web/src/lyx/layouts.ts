/**
 * Paragraph layouts of the LyX-style editor, and how each is written in LaTeX.
 *
 * As in LyX, a document is a flat run of paragraphs. Each has a layout (what
 * it is: Standard, Section, Itemize, Theorem…) and a depth (how deeply it is
 * nested under the paragraphs before it). Environments (itemize, theorem,
 * quote…) are not nodes of their own: consecutive paragraphs with the same
 * environment layout form one when the document is written out.
 */

export type LayoutKind =
  /** Plain paragraph. */
  | 'standard'
  /** \section{…} and friends. */
  | 'heading'
  /** \item of itemize / enumerate / description. */
  | 'item'
  /** A paragraph of an environment (quote, theorem, abstract…). */
  | 'env'
  /** \title{…}, \author{…}, \date{…}. */
  | 'front';

export interface Layout {
  name: string;
  kind: LayoutKind;
  /** Heading level, 0 (part) to 6 (subparagraph). */
  level?: number;
  starred?: boolean;
  /** The LaTeX command (headings, front matter) or environment (items, env). */
  latex?: string;
  /** Theorem-like: numbered, and named in the document as `name` is. */
  theorem?: boolean;
}

const HEADINGS = ['Part', 'Chapter', 'Section', 'Subsection', 'Subsubsection', 'Paragraph', 'Subparagraph'];

const LAYOUTS: Layout[] = [
  { name: 'Standard', kind: 'standard' },
  ...HEADINGS.map((name, level): Layout => ({ name, kind: 'heading', level, latex: name.toLowerCase() })),
  ...HEADINGS.map((name, level): Layout => ({ name: `${name}*`, kind: 'heading', level, starred: true, latex: name.toLowerCase() })),
  { name: 'Itemize', kind: 'item', latex: 'itemize' },
  { name: 'Enumerate', kind: 'item', latex: 'enumerate' },
  { name: 'Description', kind: 'item', latex: 'description' },
  { name: 'Quote', kind: 'env', latex: 'quote' },
  { name: 'Quotation', kind: 'env', latex: 'quotation' },
  { name: 'Verse', kind: 'env', latex: 'verse' },
  { name: 'Abstract', kind: 'env', latex: 'abstract' },
  { name: 'Title', kind: 'front', latex: 'title' },
  { name: 'Author', kind: 'front', latex: 'author' },
  { name: 'Date', kind: 'front', latex: 'date' },
  // A float's caption: written as \caption{…} like the front matter.
  { name: 'Caption', kind: 'front', latex: 'caption' },
];

/** amsthm's usual environments and the layout each is shown as. */
export const DEFAULT_THEOREMS: Record<string, string> = {
  theorem: 'Theorem', lemma: 'Lemma', corollary: 'Corollary', proposition: 'Proposition', conjecture: 'Conjecture', claim: 'Claim',
  definition: 'Definition', example: 'Example', exercise: 'Exercise', problem: 'Problem', remark: 'Remark', proof: 'Proof',
};

/** The layout box's groups, in LyX's order. */
export const LAYOUT_GROUPS: [string, string[]][] = [
  ['', ['Standard', 'Quotation', 'Quote', 'Verse']],
  ['Sectioning', HEADINGS],
  ['Unnumbered', HEADINGS.map((h) => `${h}*`)],
  ['List', ['Itemize', 'Enumerate', 'Description']],
  ['Front matter', ['Title', 'Author', 'Date', 'Abstract']],
  ['Reasoning', ['Claim', 'Conjecture', 'Corollary', 'Definition', 'Example', 'Exercise', 'Lemma', 'Problem', 'Proof', 'Proposition', 'Remark', 'Theorem']],
];

const BY_NAME = new Map(LAYOUTS.map((l) => [l.name, l]));
const BY_ENV = new Map(LAYOUTS.filter((l) => l.kind === 'item' || l.kind === 'env').map((l) => [l.latex!, l]));
const HEADING_BY_CMD = new Map(LAYOUTS.filter((l) => l.kind === 'heading').map((l) => [`${l.latex}${l.starred ? '*' : ''}`, l]));
const FRONT_BY_CMD = new Map(LAYOUTS.filter((l) => l.kind === 'front').map((l) => [l.latex!, l]));

/**
 * The theorem environments a document can use: its own \newtheorem
 * definitions on top of amsthm's usual names (env name → layout name).
 */
export type Theorems = Record<string, string>;

/** The layout called `name`; theorem layouts are looked up in `theorems`. */
export function layout(name: string, theorems: Theorems = DEFAULT_THEOREMS): Layout {
  const known = BY_NAME.get(name);
  if (known) return known;
  const env = Object.keys(theorems).find((e) => theorems[e] === name) ?? name.toLowerCase();
  return { name, kind: 'env', latex: env, theorem: true };
}

/** The layout an environment's paragraphs have, or null when it is not one of ours. */
export function layoutOfEnv(env: string, theorems: Theorems): Layout | null {
  const known = BY_ENV.get(env);
  if (known) return known;
  const name = theorems[env];
  return name ? { name, kind: 'env', latex: env, theorem: true } : null;
}

/** `section`, `section*`… → the heading layout. */
export const headingOfCommand = (cmd: string) => HEADING_BY_CMD.get(cmd) ?? null;
/** `title`, `author`, `date` → the front matter layout. */
export const frontOfCommand = (cmd: string) => FRONT_BY_CMD.get(cmd) ?? null;

/** Layouts written as an environment around one or more paragraphs. */
export const isEnvKind = (l: Layout) => l.kind === 'item' || l.kind === 'env';
