/**
 * Low-level LaTeX scanning for the LyX-style editor's reader: matching
 * braces, brackets, environments and math delimiters while skipping
 * comments and escaped characters. Every function takes the source and an
 * index, and returns an index into the same string (or -1 when unmatched).
 */

const isLetter = (c: string | undefined) => !!c && /[A-Za-z@]/.test(c);

/** After a comment starting at `i` (a `%`): the index past its newline. */
export function skipComment(s: string, i: number): number {
  const nl = s.indexOf('\n', i);
  return nl < 0 ? s.length : nl + 1;
}

/** A control sequence at `i` (a backslash): its name (letters, or one symbol) and where it ends. */
export function readCommand(s: string, i: number): { name: string; end: number } {
  let j = i + 1;
  if (isLetter(s[j])) {
    while (isLetter(s[j])) j++;
  } else if (j < s.length) j++;
  return { name: s.slice(i + 1, j), end: j };
}

/** Index past the group opened by `open` at `i`, with nested groups and escapes; -1 if unclosed. */
function matchPair(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '%') {
      j = skipComment(s, j) - 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** Past the `{…}` group at `i`. */
export const matchBrace = (s: string, i: number) => matchPair(s, i, '{', '}');

/** Past the `[…]` group at `i` (braces inside it are skipped whole, so `[a]b]` stays apart from `{]}`). */
export function matchBracket(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') j++;
    else if (c === '{') {
      const e = matchBrace(s, j);
      if (e < 0) return -1;
      j = e - 1;
    } else if (c === ']') return j + 1;
  }
  return -1;
}

/** Index of the first character after `i` that is not a space or tab (newlines count when `lines`). */
export function skipSpace(s: string, i: number, lines = true): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || (lines && (s[i] === '\n' || s[i] === '\r')))) i++;
  return i;
}

/** `\begin{env}` at `i`: the environment's name and where `\begin{…}` ends. */
export function readBegin(s: string, i: number): { env: string; end: number } | null {
  if (!s.startsWith('\\begin', i)) return null;
  const open = skipSpace(s, i + 6, false);
  if (s[open] !== '{') return null;
  const close = matchBrace(s, open);
  if (close < 0) return null;
  return { env: s.slice(open + 1, close - 1).trim(), end: close };
}

/**
 * The matching `\end{env}` for a `\begin{env}` whose body starts at `i`:
 * where the body stops and where `\end{env}` ends. Nested environments of
 * the same name are counted; verbatim-like ones are not looked inside.
 */
export function matchEnd(s: string, i: number, env: string): { bodyEnd: number; end: number } | null {
  const verbatim = /^(verbatim|Verbatim|lstlisting|minted|comment)\*?$/.test(env);
  let depth = 1;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (verbatim) {
      if (c === '\\' && s.startsWith(`\\end{${env}}`, j)) return { bodyEnd: j, end: j + env.length + 6 };
      continue;
    }
    if (c === '%') {
      j = skipComment(s, j) - 1;
      continue;
    }
    if (c !== '\\') continue;
    const b = readBegin(s, j);
    if (b) {
      if (b.env === env) depth++;
      j = b.end - 1;
      continue;
    }
    if (s.startsWith('\\end', j)) {
      const open = skipSpace(s, j + 4, false);
      if (s[open] === '{') {
        const close = matchBrace(s, open);
        if (close > 0 && s.slice(open + 1, close - 1).trim() === env && --depth === 0) return { bodyEnd: j, end: close };
        if (close > 0) j = close - 1;
      }
      continue;
    }
    j++; // skip the escaped character (\%, \{, \\…)
  }
  return null;
}

/**
 * `\verb|…|` (or `\verb*`) at `i`: past its closing delimiter, which must be
 * on the same line; -1 when `i` is not a \verb or it is unclosed.
 */
export function matchVerb(s: string, i: number): number {
  if (!s.startsWith('\\verb', i) || /[A-Za-z]/.test(s[i + 5] ?? '')) return -1;
  let j = i + 5;
  if (s[j] === '*') j++;
  const delim = s[j];
  if (!delim || /\s/.test(delim)) return -1;
  const close = s.indexOf(delim, j + 1);
  const nl = s.indexOf('\n', j + 1);
  return close < 0 || (nl >= 0 && nl < close) ? -1 : close + 1;
}

/** Past the inline formula opened at `i` by `$` or `\(`; -1 if unclosed. */
export function matchInlineMath(s: string, i: number): number {
  const paren = s.startsWith('\\(', i);
  for (let j = i + (paren ? 2 : 1); j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      if (paren && s[j + 1] === ')') return j + 2;
      j++;
    } else if (!paren && c === '$') return j + 1;
    else if (c === '%') j = skipComment(s, j) - 1;
  }
  return -1;
}

/** Past the display formula opened at `i` by `\[` or `$$`; -1 if unclosed. */
export function matchDisplayMath(s: string, i: number): number {
  const dollars = s.startsWith('$$', i);
  for (let j = i + 2; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      if (!dollars && s[j + 1] === ']') return j + 2;
      j++;
    } else if (dollars && c === '$' && s[j + 1] === '$') return j + 2;
    else if (c === '%') j = skipComment(s, j) - 1;
  }
  return -1;
}

/** Whether the newline at `i` ends a line followed by a blank one (a paragraph break). */
export function blankLineAt(s: string, i: number): boolean {
  if (s[i] !== '\n') return false;
  let j = i + 1;
  while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\r')) j++;
  return s[j] === '\n' || j >= s.length;
}
