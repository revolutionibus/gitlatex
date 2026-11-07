/**
 * Bookmarks in the PDF: spots the reader saves to come back to (M adds one,
 * C / Shift+C cycle through them). Kept per project and main file in this
 * browser, as a page and a point in PDF units, so they stay put across
 * recompiles (they drift only as far as the text above them moves). The
 * bookmarked text stays highlighted until the bookmark is deleted.
 */

/** [x0, y0, x1, y1] with x0 < x1 and y0 < y1. */
export type Rect = [number, number, number, number];

export interface Bookmark {
  id: string;
  page: number;
  /** PDF user space, points; y points up, at the top of the bookmarked line. */
  x: number;
  y: number;
  /** A snippet of the bookmarked text, for the list. */
  label: string;
  /** The bookmarked text's lines, PDF user space, to highlight. Absent on old bookmarks. */
  rects?: Rect[];
}

const PREFIX = 'gitlatex-pdf-bookmarks:';
const MAX = 100;
/** Two bookmarks this close (points, same page) are the same spot. */
const SAME_SPOT = 6;

export const bookmarksKey = (projectId: string, mainFile: string) => `${PREFIX}${projectId}:${mainFile}`;

export function loadBookmarks(key: string | null): Bookmark[] {
  if (!key) return [];
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(list) ? list.filter((b) => b && typeof b.page === 'number' && typeof b.y === 'number') : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(key: string | null, list: Bookmark[]) {
  if (!key) return;
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the bookmarks just do not persist.
  }
}

/** Document order: by page, then top to bottom (PDF y decreases downwards). */
export const sortBookmarks = (list: Bookmark[]) => [...list].sort((a, b) => a.page - b.page || b.y - a.y);

/** Add `b`, replacing a bookmark at (nearly) the same spot; the oldest go past MAX. */
export function addBookmark(list: Bookmark[], b: Bookmark): Bookmark[] {
  const rest = list.filter((o) => o.page !== b.page || Math.abs(o.y - b.y) > SAME_SPOT);
  return [...rest, b].slice(-MAX);
}

/**
 * The bookmark after (dir 1) or before (dir -1) the spot `here`, in document
 * order, wrapping around at the ends. Null when there are none.
 */
export function nearestBookmark(list: Bookmark[], here: { page: number; y: number }, dir: 1 | -1): Bookmark | null {
  const sorted = sortBookmarks(list);
  if (!sorted.length) return null;
  // 1 when b comes after here in the document, -1 before, 0 at the same spot (within 2pt).
  const order = (b: Bookmark) => (b.page !== here.page ? Math.sign(b.page - here.page) : Math.abs(here.y - b.y) <= 2 ? 0 : Math.sign(here.y - b.y));
  if (dir === 1) return sorted.find((b) => order(b) > 0) ?? sorted[0];
  return [...sorted].reverse().find((b) => order(b) < 0) ?? sorted[sorted.length - 1];
}

/**
 * One rect per line from the many a text selection reports (one per span):
 * rects that overlap vertically by half the shorter one and sit close
 * horizontally are joined. Works in any coordinates where y0 < y1.
 */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const lines: Rect[] = [];
  // Left to right, so each span meets the end of the line it continues.
  for (const r of [...rects].sort((a, b) => a[0] - b[0])) {
    const line = lines.find((l) => {
      const overlap = Math.min(l[3], r[3]) - Math.max(l[1], r[1]);
      const gap = Math.max(r[0] - l[2], l[0] - r[2]);
      return overlap >= Math.min(l[3] - l[1], r[3] - r[1]) / 2 && gap < 12;
    });
    if (line) {
      line[0] = Math.min(line[0], r[0]);
      line[1] = Math.min(line[1], r[1]);
      line[2] = Math.max(line[2], r[2]);
      line[3] = Math.max(line[3], r[3]);
    } else lines.push([...r]);
  }
  return lines.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
