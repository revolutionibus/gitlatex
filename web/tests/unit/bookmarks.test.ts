import { beforeEach, describe, expect, it } from 'vitest';
import { addBookmark, bookmarksKey, loadBookmarks, mergeLineRects, nearestBookmark, saveBookmarks, sortBookmarks, type Bookmark } from '../../src/pdf/bookmarks';

const bm = (page: number, y: number, label = `p${page}@${y}`): Bookmark => ({ id: label, page, x: 72, y, label });

describe('bookmarks', () => {
  beforeEach(() => localStorage.clear());

  it('sorts in document order: page, then top to bottom', () => {
    const list = [bm(2, 500), bm(1, 300), bm(1, 700)];
    expect(sortBookmarks(list).map((b) => b.label)).toEqual(['p1@700', 'p1@300', 'p2@500']);
  });

  it('replaces a bookmark at the same spot instead of adding a second', () => {
    const list = addBookmark([bm(1, 500, 'old')], bm(1, 503, 'new'));
    expect(list.map((b) => b.label)).toEqual(['new']);
    expect(addBookmark(list, bm(1, 400)).length).toBe(2);
  });

  it('cycles forward and back from a spot, wrapping around', () => {
    const list = [bm(1, 700), bm(1, 300), bm(3, 500)];
    expect(nearestBookmark(list, { page: 1, y: 500 }, 1)?.label).toBe('p1@300');
    expect(nearestBookmark(list, { page: 1, y: 500 }, -1)?.label).toBe('p1@700');
    expect(nearestBookmark(list, { page: 3, y: 500 }, 1)?.label).toBe('p1@700'); // wraps
    expect(nearestBookmark(list, { page: 1, y: 700 }, -1)?.label).toBe('p3@500'); // wraps
    expect(nearestBookmark([], { page: 1, y: 0 }, 1)).toBeNull();
  });

  it('steps across pages whatever the gap', () => {
    const list = [bm(3, 700), bm(6, 700), bm(8, 700)];
    expect(nearestBookmark(list, { page: 6, y: 700 }, 1)?.label).toBe('p8@700');
    expect(nearestBookmark(list, { page: 6, y: 700 }, -1)?.label).toBe('p3@700');
  });

  it('standing on a bookmark moves to the next one, not the same', () => {
    const list = [bm(1, 700), bm(1, 300)];
    expect(nearestBookmark(list, { page: 1, y: 700 }, 1)?.label).toBe('p1@300');
  });

  it('merges a selection’s span rects into one rect per line', () => {
    const spans: [number, number, number, number][] = [
      [10, 100, 60, 112], // line 1, three spans
      [62, 101, 120, 112],
      [125, 100, 200, 113],
      [10, 116, 90, 128], // line 2
      [300, 100, 340, 112], // same height, far to the right: its own rect
    ];
    expect(mergeLineRects(spans)).toEqual([
      [10, 100, 200, 113],
      [300, 100, 340, 112],
      [10, 116, 90, 128],
    ]);
  });

  it('persists per project and main file', () => {
    const key = bookmarksKey('p1', 'main.tex');
    saveBookmarks(key, [bm(2, 100)]);
    expect(loadBookmarks(key)).toEqual([bm(2, 100)]);
    expect(loadBookmarks(bookmarksKey('p1', 'other.tex'))).toEqual([]);
    saveBookmarks(key, []);
    expect(localStorage.getItem(key)).toBeNull();
  });
});
