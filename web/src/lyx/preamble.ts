/**
 * What the preamble needs for what the LyX-style editor writes: a theorem
 * layout the document has not defined gets `\usepackage{amsthm}` and its
 * `\newtheorem`, and graphics, booktabs rules, URLs and hyperlinks get their
 * packages, as LyX adds them. Nothing already there is added twice.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { layout as layoutNamed, type Theorems } from './layouts';
import { schema } from './schema';

const uncommented = (preamble: string) => preamble.replace(/(^|[^\\])%.*$/gm, '$1');

/** Packages loaded with \usepackage / \RequirePackage. */
export function packagesIn(preamble: string): Set<string> {
  const out = new Set<string>();
  for (const m of uncommented(preamble).matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
    for (const p of m[1].split(',')) out.add(p.trim());
  }
  return out;
}

/** Environments defined with \newtheorem (or \newtheorem*). */
export function theoremsDefinedIn(preamble: string): Set<string> {
  return new Set([...uncommented(preamble).matchAll(/\\newtheorem\*?\s*\{([^}]+)\}/g)].map((m) => m[1].trim()));
}

/** Classes that define their own theorem environments. */
const CLASS_THEOREMS = /\\documentclass\s*(?:\[[^\]]*\]\s*)?\{(llncs|svjour3?|svmono|svmult|amsart|amsbook|amsproc)\}/;
/** Classes that load graphicx and hyperref themselves. */
const CLASS_GRAPHICS = /\\documentclass\s*(?:\[[^\]]*\]\s*)?\{beamer\}/;

/** Packages the document's insets need and the preamble does not load. */
function insetPackages(doc: PMNode, loaded: Set<string>, preamble: string): string[] {
  const need = new Set<string>();
  doc.descendants((n) => {
    if (n.type === schema.nodes.graphics) need.add('graphicx');
    if (n.type === schema.nodes.url) need.add('url');
    if (n.marks.some((m) => m.type === schema.marks.href)) need.add('hyperref');
    if (n.type === schema.nodes.table) {
      const rules = [n.attrs.bottom ?? ''];
      n.forEach((row) => rules.push(row.attrs.rules ?? ''));
      if (/\\(toprule|midrule|bottomrule|cmidrule)\b/.test(rules.join(' '))) need.add('booktabs');
      if (n.attrs.env === 'tabularx') need.add('tabularx');
    }
    return true;
  });
  // hyperref provides \url too; beamer loads graphicx and hyperref.
  if (loaded.has('hyperref') || need.has('hyperref')) need.delete('url');
  if (loaded.has('graphics')) need.delete('graphicx');
  if (CLASS_GRAPHICS.test(preamble)) ['graphicx', 'hyperref', 'url'].forEach((p) => need.delete(p));
  return ['graphicx', 'booktabs', 'tabularx', 'url', 'hyperref'].filter((p) => need.has(p) && !loaded.has(p));
}

/**
 * `prefix` (everything up to \begin{document}) with the lines the document
 * now needs added just before \begin{document}. A file without
 * \begin{document} (an \input chapter) is left as it is.
 */
export function withPreambleNeeds(
  prefix: string,
  doc: PMNode,
  theorems: Theorems,
  envsInUse: ReadonlySet<string> = new Set(),
  packagesInUse: ReadonlySet<string> = new Set(),
): string {
  const begin = prefix.lastIndexOf('\\begin{document}');
  if (begin < 0) return prefix;
  const preamble = prefix.slice(0, begin);
  // What the file already used works, however it is loaded (the class, a .sty).
  const loaded = new Set([...packagesIn(preamble), ...packagesInUse]);
  const lines = insetPackages(doc, loaded, preamble).map((p) => `\\usepackage{${p}}`);
  if (!CLASS_THEOREMS.test(preamble)) {
    const defined = theoremsDefinedIn(preamble);
    const used = new Map<string, string>();
    doc.forEach((b) => {
      if (b.type !== schema.nodes.paragraph) return;
      const l = layoutNamed(b.attrs.layout, theorems);
      if (l.theorem) used.set(b.attrs.env ?? l.latex!, l.name);
    });
    // An environment the file already used is defined somehow (tcolorbox, the class…).
    const needTheorems = [...used].filter(([env]) => env !== 'proof' && !defined.has(env) && !envsInUse.has(env));
    const needProof = used.has('proof') && !envsInUse.has('proof');
    if ((needTheorems.length || needProof) && !loaded.has('amsthm')) lines.push('\\usepackage{amsthm}');
    for (const [env, name] of needTheorems) lines.push(`\\newtheorem{${env}}{${name}}`);
  }
  if (!lines.length) return prefix;
  // Just before \begin{document}, on lines of their own.
  const lineStart = prefix.lastIndexOf('\n', begin - 1) + 1;
  return prefix.slice(0, lineStart) + lines.join('\n') + '\n' + prefix.slice(lineStart);
}
