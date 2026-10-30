/**
 * PDF viewer built on pdf.js's PDFViewer component: continuous scrolling, lazy
 * HiDPI rendering, selectable text, clickable links (\ref, \eqref, \cite with
 * hyperref, the table of contents, URLs), flicker-free updates after
 * recompiles (a still copy of the old pages covers the swap), zoom, and
 * SyncTeX hooks.
 *
 * Following a link or Show in PDF remembers where you were: the Back button
 * (or B while the PDF has focus) returns there.
 *
 * Bookmarks save spots to come back to, per project (src/pdf/bookmarks.ts).
 * While the PDF has focus:
 *   M          bookmark the selected text, or the line at the top of the view
 *   C          go to the previous bookmark (Shift+C: the next one)
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Bookmark as BookmarkIcon, BookmarkPlus, Undo2, X } from 'lucide-react';
// Must come first: pdf_viewer.mjs reads the library from a global set there.
import { pdfjs } from './pdfjs';
import * as pdfjsViewer from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import type { SyncRect } from '../latex/synctex';
import { changedPageTiles, type ChangeTile } from './changes';
import { figureTopAbove, graphicsBoxes } from './link-target';
import { clsx } from '../components/ui';
import { addBookmark, loadBookmarks, mergeLineRects, nearestBookmark, saveBookmarks, sortBookmarks, type Bookmark, type Rect } from './bookmarks';

export type Zoom = 'width' | 'page' | number;

export interface PdfViewerHandle {
  scrollToPage(page: number): void;
}

interface Viewer {
  eventBus: pdfjsViewer.EventBus;
  linkService: pdfjsViewer.PDFLinkService;
  pdfViewer: pdfjsViewer.PDFViewer;
}

/** What PDFViewer reports in "updateviewarea": the view's top-left, in PDF units. */
interface ViewLocation {
  pageNumber: number;
  left: number;
  top: number;
}

const MAX_BACK = 50;

/** The floating buttons over the PDF: Back, Bookmarks, and "Bookmark" under a selection. */
const PILL = 'focus-ring flex items-center gap-1.5 rounded-full border border-line bg-panel text-[12px] font-medium text-fg shadow-pop hover:border-accent';

function applyZoom(pdfViewer: pdfjsViewer.PDFViewer, zoom: Zoom) {
  if (zoom === 'width') pdfViewer.currentScaleValue = 'page-width';
  else if (zoom === 'page') pdfViewer.currentScaleValue = 'page-fit';
  else pdfViewer.currentScale = zoom;
}

function scrollToLocation(pdfViewer: pdfjsViewer.PDFViewer, l: ViewLocation) {
  pdfViewer.scrollPageIntoView({
    pageNumber: Math.min(l.pageNumber, pdfViewer.pagesCount),
    destArray: [null, { name: 'XYZ' }, l.left, l.top, null],
    allowNegativeOffset: true,
    ignoreDestinationZoom: true,
  });
}

/** Room left above a link's target (CSS px), so it is not flush with the edge. */
const LANDING_MARGIN = 24;
/** Give up on finding a figure above the target after this long, and just jump. */
const LANDING_TIMEOUT = 400;

/**
 * For an XYZ destination (what hyperref writes), where the view should
 * start: the figure right above the target if there is one, else the target.
 * Null for anything else, which pdf.js then handles as usual.
 */
async function landingFor(pdfViewer: pdfjsViewer.PDFViewer, dest: string | unknown[]) {
  const doc = pdfViewer.pdfDocument;
  if (!doc) return null;
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || (explicit[1] as { name?: string })?.name !== 'XYZ' || typeof explicit[3] !== 'number') return null;
  const ref = explicit[0];
  const pageIndex = Number.isInteger(ref) ? (ref as number) : ref && typeof ref === 'object' ? await doc.getPageIndex(ref as never) : null;
  if (pageIndex === null) return null;
  const targetY = explicit[3] as number;
  const page = await doc.getPage(pageIndex + 1);
  const opList = await Promise.race([page.getOperatorList(), new Promise<null>((r) => setTimeout(() => r(null), LANDING_TIMEOUT))]);
  const figureTop = opList ? figureTopAbove(graphicsBoxes(opList, pdfjs.OPS), targetY, page.view[3] - page.view[1]) : null;
  const x = typeof explicit[2] === 'number' ? explicit[2] : 0;
  return (el: HTMLElement) => {
    const pageView = pdfViewer.getPageView(pageIndex);
    if (!pageView?.div) return;
    const [, top] = pageView.viewport.convertToViewportPoint(x, figureTop ?? targetY);
    el.scrollTop = pageOrigin(el, pageView.div).top + top - LANDING_MARGIN;
  };
}

/** The selection, when it is text on a PDF page inside root. */
function pdfSelectionRange(root: HTMLElement | null) {
  const sel = document.getSelection();
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('.textLayer') && root.contains(el) ? range : null;
}

/** The page under screen height `y` in the scroller, or the next one below it (between pages). */
function pageAtScreenY(scroller: HTMLElement, y: number) {
  const pages = [...scroller.querySelectorAll<HTMLElement>('.page[data-page-number]')];
  return pages.find((div) => div.getBoundingClientRect().bottom >= y) ?? null;
}

type Viewport = pdfjsViewer.PDFPageView['viewport'];

/**
 * The lines covered by `screen` rects (client px) on a page, as PDF rects.
 * Stray giants (pdf.js's end-of-content filler joins a selection) are dropped.
 */
function textLines(div: HTMLElement, viewport: Viewport, screen: DOMRect[]): Rect[] {
  const page = div.getBoundingClientRect();
  const onPage = screen.filter((r) => r.width && r.height && r.bottom > page.top && r.top < page.bottom);
  const heights = onPage.map((r) => r.height).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? 0;
  const lines = mergeLineRects(onPage.filter((r) => r.height <= typical * 2.5).map((r) => [r.left, r.top, r.right, r.bottom]));
  const pdf = (x: number, y: number) => viewport.convertToPdfPoint(x - page.left - div.clientLeft, y - page.top - div.clientTop);
  return lines.map(([x0, y0, x1, y1]) => {
    const [a, b] = pdf(x0, y0);
    const [c, d] = pdf(x1, y1);
    return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  });
}

/**
 * Screen rects of exactly the selected characters. A range's own client rects
 * also cover every element it touches: a mouse selection in pdf.js's text
 * layer often ends in its hidden filler element, which would make whole spans
 * (whole lines) count as selected. So measure text nodes only, clipped to the
 * selection's ends.
 */
function selectedCharRects(range: Range): DOMRect[] {
  const common = range.commonAncestorContainer;
  const root = common.nodeType === Node.TEXT_NODE ? common.parentNode : common;
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || !node.parentElement?.closest('.textLayer')) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    if (!part.collapsed) rects.push(...part.getClientRects());
  }
  return rects;
}

/** Where a bookmark of these lines points: their top-left, in PDF units. */
const topLeft = (rects: Rect[]) => ({ x: Math.min(...rects.map((r) => r[0])), y: Math.max(...rects.map((r) => r[3])) });

const snippet = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
};

/** Top-left of a page's content, in the scroller's scroll coordinates. */
function pageOrigin(scroller: HTMLElement, div: HTMLElement) {
  const page = div.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  return {
    top: page.top - box.top + scroller.scrollTop + div.clientTop,
    left: page.left - box.left + scroller.scrollLeft + div.clientLeft,
  };
}

/** Still copy of the visible pages, laid over the scroller while new ones draw. */
function coverPages(scroller: HTMLElement): HTMLCanvasElement | null {
  const { clientWidth: w, clientHeight: h } = scroller;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  const box = scroller.getBoundingClientRect();
  const cover = document.createElement('canvas');
  cover.className = 'pointer-events-none absolute left-0 top-0 z-[1]';
  cover.width = Math.floor(w * dpr);
  cover.height = Math.floor(h * dpr);
  cover.style.width = `${w}px`;
  cover.style.height = `${h}px`;
  const ctx = cover.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(scroller.parentElement ?? scroller).backgroundColor;
  ctx.fillRect(0, 0, w, h);
  // Dark pages are a CSS filter on the canvas; copy it so the cover matches.
  scroller.querySelectorAll<HTMLCanvasElement>('.page canvas').forEach((canvas) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || r.bottom < box.top || r.top > box.bottom) return;
    ctx.filter = getComputedStyle(canvas).filter;
    ctx.drawImage(canvas, r.left - box.left, r.top - box.top, r.width, r.height);
  });
  scroller.after(cover);
  return cover;
}

/**
 * An overlay on a page, positioned in percent so it fits any zoom. pdf.js
 * clears foreign children when it re-lays a page out (on zoom), which suits
 * these short-lived highlights.
 */
function addOverlay(page: HTMLElement, className: string, box: { left: string; top: string; width: string; height: string }) {
  const el = document.createElement('div');
  el.className = `pointer-events-none absolute z-10 ${className}`;
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, box);
  page.appendChild(el);
  return el;
}

export const PdfViewer = forwardRef<
  PdfViewerHandle,
  {
    data: Uint8Array;
    version: number;
    cursorPage: number | null;
    zoom: Zoom;
    onZoomChange: (z: Zoom) => void;
    onPageChange: (page: number, total: number) => void;
    onScaleChange?: (scale: number) => void;
    onInverseSearch: (page: number, x: number, y: number) => void;
    target: { rects: SyncRect[]; nonce: number } | null;
    dark: boolean;
    /** Where this document's bookmarks are stored (per project and main file); null keeps none. */
    bookmarkKey?: string | null;
  }
>(function PdfViewer({ data, version, cursorPage, zoom, onZoomChange, onPageChange, onScaleChange, onInverseSearch, target, dark, bookmarkKey = null }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const taskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const location = useRef<ViewLocation | null>(null);
  const pendingTarget = useRef<{ rects: SyncRect[]; nonce: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where each link / Show in PDF jump started; Back pops the last one.
  // `page` is the page the reader was on (the location's page can be one
  // whose last sliver shows at the top), for the button's label.
  const [back, setBack] = useState<(ViewLocation & { page: number })[]>([]);
  const [pages, setPages] = useState(0);
  // pdf.js events outlive a render; they read the current props from here.
  const props = useRef({ zoom, cursorPage, onPageChange, onScaleChange });
  props.current = { zoom, cursorPage, onPageChange, onScaleChange };

  /** Remember the current view as a place to come back to. */
  const pushBack = useCallback(() => {
    const l = location.current;
    const page = viewerRef.current?.pdfViewer.currentPageNumber ?? l?.pageNumber;
    if (l && page) setBack((b) => [...b.slice(1 - MAX_BACK), { ...l, page }]);
  }, []);

  const goBack = useCallback(() => {
    const pdfViewer = viewerRef.current?.pdfViewer;
    setBack((b) => {
      const last = b[b.length - 1];
      if (last && pdfViewer?.pdfDocument) scrollToLocation(pdfViewer, last);
      return b.slice(0, -1);
    });
  }, []);

  // ---- create the viewer (once: it keeps listeners on the DOM below) ---------------------------
  useEffect(() => {
    if (viewerRef.current || !scroller.current) return;
    const eventBus = new pdfjsViewer.EventBus();
    const linkService = new pdfjsViewer.PDFLinkService({ eventBus, externalLinkTarget: pdfjsViewer.LinkTarget.BLANK });
    const pdfViewer = new pdfjsViewer.PDFViewer({
      container: scroller.current,
      eventBus,
      linkService,
      removePageBorders: true,
      // The annotation editor listens for paste and drop on the whole page,
      // which would steal them from the editor.
      annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    });
    linkService.setViewer(pdfViewer);
    // The link service reports every internal jump here before making it.
    linkService.setHistory({ pushCurrentPosition: pushBack, push() {}, pushPage() {} } as never);
    // Land links with some room above, and a \ref to a figure (which points at
    // its caption) on the whole figure. Worked out before the jump, so the
    // view moves once.
    const goToDestination = linkService.goToDestination.bind(linkService);
    linkService.goToDestination = async (dest) => {
      const land = await landingFor(pdfViewer, dest).catch(() => null);
      await goToDestination(dest);
      if (land && scroller.current) land(scroller.current);
    };

    eventBus.on('updateviewarea', ({ location: l }: { location: ViewLocation }) => (location.current = l));
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => props.current.onScaleChange?.(scale));
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => props.current.onPageChange(pageNumber, pdfViewer.pagesCount));
    viewerRef.current = { eventBus, linkService, pdfViewer };
  }, [pushBack]);

  useEffect(() => () => void taskRef.current?.destroy(), []);

  // ---- SyncTeX forward search -------------------------------------------------------------------
  const showTarget = useCallback(
    (t: { rects: SyncRect[]; nonce: number }) => {
      const v = viewerRef.current;
      const el = scroller.current;
      const first = t.rects[0];
      const firstView = v?.pdfViewer.getPageView(first.page - 1);
      if (!v || !el || !firstView?.div) return;
      pushBack(); // Show in PDF is a jump too, so Back comes back from it.
      const s = firstView.viewport.scale;
      el.scrollTo({ top: pageOrigin(el, firstView.div).top + first.y * s - el.clientHeight / 3, behavior: 'smooth' });
      for (const r of t.rects) {
        const pageView = v.pdfViewer.getPageView(r.page - 1);
        if (!pageView?.div) continue;
        const k = pageView.viewport.scale;
        const flash = addOverlay(pageView.div, 'synctex-flash rounded-sm', {
          left: `${r.x * k - 3}px`, top: `${r.y * k - 3}px`, width: `${r.w * k + 6}px`, height: `${r.h * k + 6}px`,
        });
        flash.addEventListener('animationend', () => flash.remove());
      }
    },
    [pushBack],
  );

  useEffect(() => {
    if (!target || !target.rects.length) return;
    if (viewerRef.current?.pdfViewer.pdfDocument) showTarget(target);
    else pendingTarget.current = target;
  }, [target, showTarget]);

  // ---- load document ----------------------------------------------------------------------
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    let cancelled = false;
    const task = pdfjs.getDocument({ data: data.slice() });
    task.promise.then(
      async (doc) => {
        if (cancelled) return void task.destroy();
        const oldDoc = v.pdfViewer.pdfDocument;
        const cursor = props.current.cursorPage;
        // What changed on the cursor's page, compared before the old document goes.
        const changePage = oldDoc && cursor ? Math.min(cursor, doc.numPages) : null;
        let tiles: ChangeTile[] = [];
        if (oldDoc && changePage && changePage <= oldDoc.numPages) {
          try {
            tiles = await changedPageTiles(await oldDoc.getPage(changePage), await doc.getPage(changePage));
          } catch {
            // A comparison failure must not prevent PDF display.
          }
        }
        if (cancelled) return void task.destroy();
        const oldTask = taskRef.current;
        // A rebuild keeps the reader where they were, without a blank flash.
        const keep = oldTask ? location.current : null;
        const cover = oldTask && scroller.current ? coverPages(scroller.current) : null;
        taskRef.current = task;
        setError(null);
        setBack([]); // old positions may not exist in the new document
        v.eventBus.on(
          'pagesinit',
          () => {
            if (taskRef.current !== task) return void cover?.remove();
            const { pdfViewer } = v;
            applyZoom(pdfViewer, props.current.zoom);
            // After a compile, show the page being edited; otherwise stay put.
            if (cursor) pdfViewer.scrollPageIntoView({ pageNumber: Math.min(cursor, pdfViewer.pagesCount) });
            else if (keep) scrollToLocation(pdfViewer, keep);
            // [data-page] is what the rest of the app (and the e2e tests) look for.
            for (let i = 0; i < pdfViewer.pagesCount; i++) {
              const div = pdfViewer.getPageView(i)?.div;
              if (div) div.dataset.page = String(i + 1);
            }
            const changed = changePage ? pdfViewer.getPageView(changePage - 1)?.div : null;
            if (changed && tiles.length) {
              const shown = tiles.map((t) =>
                addOverlay(changed, 'bg-accent/40', { left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, height: `${t.h}%` }),
              );
              setTimeout(() => shown.forEach((el) => el.remove()), 3000);
            }
            props.current.onPageChange(pdfViewer.currentPageNumber, pdfViewer.pagesCount);
            setPages(pdfViewer.pagesCount);
            if (pendingTarget.current) {
              showTarget(pendingTarget.current);
              pendingTarget.current = null;
            }
            if (cover) {
              const pageNumber = pdfViewer.currentPageNumber;
              const onRendered = (e: { pageNumber: number }) => e.pageNumber === pageNumber && done();
              const done = () => {
                clearTimeout(timer);
                v.eventBus.off('pagerendered', onRendered);
                cover.remove();
              };
              const timer = setTimeout(done, 2000);
              v.eventBus.on('pagerendered', onRendered);
            }
          },
          { once: true },
        );
        v.pdfViewer.setDocument(doc);
        v.linkService.setDocument(doc);
        if (oldTask) void oldTask.destroy();
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      // Only abort if this task never became the displayed document.
      if (taskRef.current !== task) void task.destroy();
    };
  }, [data, version, showTarget]);

  // ---- zoom ---------------------------------------------------------------------------------
  useEffect(() => {
    const pdfViewer = viewerRef.current?.pdfViewer;
    if (pdfViewer?.pdfDocument) applyZoom(pdfViewer, zoom);
  }, [zoom]);

  // Fit width / fit page follow the pane when it is resized.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastW && el.clientHeight === lastH) return;
      lastW = el.clientWidth;
      lastH = el.clientHeight;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const pdfViewer = viewerRef.current?.pdfViewer;
        const z = props.current.zoom;
        if (pdfViewer?.pdfDocument && typeof z !== 'number') applyZoom(pdfViewer, z);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Ctrl/Cmd + wheel zoom
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const scale = viewerRef.current?.pdfViewer.currentScale ?? 1;
      const next = Math.max(0.25, Math.min(5, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      onZoomChange(Math.round(next * 100) / 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoomChange]);

  useImperativeHandle(ref, () => ({
    scrollToPage(page: number) {
      // Through the link service, so Back can come back from it.
      viewerRef.current?.linkService.goToPage(page);
    },
  }));

  // ---- bookmarks --------------------------------------------------------------------------------
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks(bookmarkKey));
  const keyRef = useRef(bookmarkKey);
  useEffect(() => {
    keyRef.current = bookmarkKey;
    setBookmarks(loadBookmarks(bookmarkKey));
  }, [bookmarkKey]);
  /** Change the bookmarks and store them (under the key they were loaded from). */
  const updateBookmarks = (fn: (list: Bookmark[]) => Bookmark[]) =>
    setBookmarks((list) => {
      const next = fn(list);
      saveBookmarks(keyRef.current, next);
      return next;
    });
  // A recompile can drop pages; their bookmarks wait (hidden) until the pages are back.
  const shownBookmarks = sortBookmarks(bookmarks.filter((b) => b.page <= pages));
  const [listOpen, setListOpen] = useState(false);
  const [selectionAt, setSelectionAt] = useState<{ left: number; top: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** Briefly highlight the line at PDF height `y` on `page`. */
  const flashLine = (page: number, y: number) => {
    const pageView = viewerRef.current?.pdfViewer.getPageView(page - 1);
    if (!pageView?.div) return;
    const [, top] = pageView.viewport.convertToViewportPoint(0, y);
    const height = Math.max(12, 14 * pageView.viewport.scale);
    const flash = addOverlay(pageView.div, 'synctex-flash rounded-sm', { left: '6%', width: '88%', top: `${top - 2}px`, height: `${height}px` });
    flash.addEventListener('animationend', () => flash.remove());
  };

  /** Where the reader is: the page and PDF height just under the top of the view. */
  const viewSpot = () => {
    const el = scroller.current;
    const pdfViewer = viewerRef.current?.pdfViewer;
    if (!el || !pdfViewer) return null;
    const probe = el.getBoundingClientRect().top + LANDING_MARGIN;
    const div = pageAtScreenY(el, probe);
    const pageView = div && pdfViewer.getPageView(Number(div.dataset.pageNumber) - 1);
    if (!div || !pageView) return null;
    const r = div.getBoundingClientRect();
    const [x, y] = pageView.viewport.convertToPdfPoint(0, Math.max(0, probe - r.top - div.clientTop));
    return { page: Number(div.dataset.pageNumber), x, y, div, probe };
  };

  const goToBookmark = (b: Bookmark) => {
    const el = scroller.current;
    const pageView = viewerRef.current?.pdfViewer.getPageView(b.page - 1);
    if (!el || !pageView?.div) return;
    pushBack();
    const [, top] = pageView.viewport.convertToViewportPoint(b.x, b.y);
    el.scrollTop = pageOrigin(el, pageView.div).top + top - LANDING_MARGIN;
    flashLine(b.page, b.y);
  };

  /** Bookmark the selected text, or else the line at the top of the view. */
  const addBookmarkHere = () => {
    const el = scroller.current;
    const pdfViewer = viewerRef.current?.pdfViewer;
    if (!el || !pdfViewer?.pdfDocument) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let b: Bookmark | null = null;
    const range = pdfSelectionRange(el);
    const start = range?.startContainer;
    const div = (start && (start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement))?.closest<HTMLElement>('.page');
    const pageView = div && pdfViewer.getPageView(Number(div.dataset.pageNumber) - 1);
    const selected = range && div && pageView ? textLines(div, pageView.viewport, selectedCharRects(range)) : [];
    if (range && div && selected.length) {
      b = { id, page: Number(div.dataset.pageNumber), ...topLeft(selected), label: snippet(range.toString()), rects: selected };
    } else {
      const spot = viewSpot();
      if (!spot) return;
      const pv = pdfViewer.getPageView(spot.page - 1);
      // The first line of text at that spot: named after it, and highlighted.
      const spans = [...spot.div.querySelectorAll<HTMLElement>('.textLayer span')].filter((span) => span.textContent?.trim());
      const first = spans.find((span) => span.getBoundingClientRect().bottom > spot.probe);
      const box = first?.getBoundingClientRect();
      const line = box ? spans.filter((span) => {
        const r = span.getBoundingClientRect();
        return Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) >= Math.min(r.height, box.height) / 2;
      }) : [];
      const rects = pv && line.length ? textLines(spot.div, pv.viewport, line.map((span) => span.getBoundingClientRect())) : [];
      const label = snippet(line.map((span) => span.textContent).join(' '));
      b = rects.length
        ? { id, page: spot.page, ...topLeft(rects), label: label || `Page ${spot.page}`, rects }
        : { id, page: spot.page, x: spot.x, y: spot.y, label: label || `Page ${spot.page}` };
    }
    const added = b;
    updateBookmarks((list) => addBookmark(list, added));
    flashLine(added.page, added.y);
    document.getSelection()?.removeAllRanges();
    setSelectionAt(null);
  };

  // Bookmarked text stays highlighted. pdf.js clears a page's extra elements
  // whenever it re-renders it (zoom, scrolling back to it), so each render
  // repaints that page's highlights.
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const paintBookmarks = useCallback((pageNumber: number) => {
    const pageView = viewerRef.current?.pdfViewer.getPageView(pageNumber - 1);
    const div: HTMLElement | undefined = pageView?.div;
    if (!pageView || !div) return;
    div.querySelectorAll('.pdf-bookmark-hl').forEach((el) => el.remove());
    const [left, , right] = pageView.viewport.viewBox;
    for (const b of bookmarksRef.current) {
      if (b.page !== pageNumber) continue;
      // Old bookmarks have no lines: mark the line they start on.
      const rects: Rect[] = b.rects?.length ? b.rects : [[left + (right - left) * 0.06, b.y - 12, right - (right - left) * 0.06, b.y]];
      for (const r of rects) {
        const [x0, y0] = pageView.viewport.convertToViewportPoint(r[0], r[1]);
        const [x1, y1] = pageView.viewport.convertToViewportPoint(r[2], r[3]);
        addOverlay(div, 'pdf-bookmark-hl', {
          left: `${Math.min(x0, x1) - 1}px`, top: `${Math.min(y0, y1) - 1}px`, width: `${Math.abs(x1 - x0) + 2}px`, height: `${Math.abs(y1 - y0) + 2}px`,
        });
      }
    }
  }, []);
  useEffect(() => {
    const bus = viewerRef.current?.eventBus;
    if (!bus) return;
    const onRendered = ({ pageNumber }: { pageNumber: number }) => paintBookmarks(pageNumber);
    bus.on('pagerendered', onRendered);
    return () => bus.off('pagerendered', onRendered);
  }, [paintBookmarks]);
  useEffect(() => {
    for (let n = 1; n <= pages; n++) paintBookmarks(n);
  }, [bookmarks, pages, paintBookmarks]);

  const cycleBookmarks = (dir: 1 | -1) => {
    const spot = viewSpot();
    const b = spot && nearestBookmark(shownBookmarks, { page: spot.page, y: spot.y }, dir);
    if (b) goToBookmark(b);
  };

  /** Floats "Bookmark" under a text selection on a page. */
  const showSelectionButton = () => {
    const range = pdfSelectionRange(scroller.current);
    const rect = range && [...range.getClientRects()].filter((r) => r.width && r.height).pop();
    const box = wrapper.current?.getBoundingClientRect();
    if (!rect || !box || !wrapper.current) return setSelectionAt(null);
    setSelectionAt({
      left: Math.max(8, Math.min(rect.right - box.left - 50, wrapper.current.clientWidth - 120)),
      top: Math.min(rect.bottom - box.top + 6, wrapper.current.clientHeight - 40),
    });
  };
  useEffect(() => {
    const onSelectionChange = () => {
      if (!pdfSelectionRange(scroller.current)) setSelectionAt(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // The list closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node)) setListOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setListOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [listOpen]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !pages) return;
    if ((e.target as HTMLElement).closest('input, select, textarea, [contenteditable]')) return;
    const key = e.key.toLowerCase();
    if (key === 'b' && !e.shiftKey && back.length) goBack();
    else if (key === 'm' && !e.shiftKey) addBookmarkHere();
    else if (key === 'c' && shownBookmarks.length) cycleBookmarks(e.shiftKey ? 1 : -1);
    else return;
    e.preventDefault();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.page');
    const pageNumber = Number(pageEl?.dataset.pageNumber);
    const pageView = viewerRef.current?.pdfViewer.getPageView(pageNumber - 1);
    if (!pageEl || !pageView) return;
    const rect = pageEl.getBoundingClientRect();
    const s = pageView.viewport.scale;
    window.getSelection()?.removeAllRanges();
    onInverseSearch(pageNumber, (e.clientX - rect.left - pageEl.clientLeft) / s, (e.clientY - rect.top - pageEl.clientTop) / s);
  };

  const last = back[back.length - 1];
  return (
    <div ref={wrapper} onKeyDown={onKeyDown} className={dark ? 'pdf-pane pdf-dark relative h-full' : 'pdf-pane relative h-full'}>
      {/* PDFViewer refuses a scroller that is not absolutely positioned. */}
      <div
        ref={scroller}
        tabIndex={0}
        onDoubleClick={onDoubleClick}
        onPointerUp={() => setTimeout(showSelectionButton, 0)}
        onScroll={() => selectionAt && setSelectionAt(null)}
        className="absolute inset-0 overflow-auto outline-none"
        data-testid="pdf-viewer"
        title="Double-click to jump to the source · B back after a link · M bookmark · C / Shift+C cycle bookmarks"
      >
        <div className="pdfViewer" />
      </div>

      {selectionAt && (
        <button
          type="button"
          className={clsx(PILL, 'absolute z-20 py-1 pl-2 pr-2.5')}
          style={selectionAt}
          title="Bookmark this text (M)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addBookmarkHere}
        >
          <BookmarkPlus className="size-3.5 text-accent" /> Bookmark
        </button>
      )}

      {pages > 0 && (
        <div ref={listRef} className="absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2">
          {listOpen && (
            <div className="flex max-h-80 w-80 flex-col overflow-hidden rounded-lg border border-line bg-panel text-[12.5px] shadow-pop" role="dialog" aria-label="Bookmarks">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="flex-1 font-medium text-fg">Bookmarks</span>
                <button type="button" onClick={addBookmarkHere} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg" title="Bookmark the selected text, or the top of the view (M)">
                  <BookmarkPlus className="size-3.5" /> Add
                </button>
                {!!bookmarks.length && (
                  <button type="button" onClick={() => updateBookmarks(() => [])} className="rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-danger">
                    Clear
                  </button>
                )}
              </div>
              {shownBookmarks.length ? (
                <ol className="min-h-0 flex-1 overflow-y-auto py-1">
                  {shownBookmarks.map((b) => (
                    <li key={b.id} className="group flex items-center hover:bg-hover">
                      <button type="button" onClick={() => goToBookmark(b)} className="flex min-w-0 flex-1 items-baseline gap-2 px-3 py-1.5 text-left">
                        <span className="shrink-0 text-[11px] tabular-nums text-faint">p. {b.page}</span>
                        <span className="truncate text-fg">{b.label}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateBookmarks((list) => list.filter((o) => o.id !== b.id))}
                        className="mr-1.5 rounded p-1 text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Delete bookmark: ${b.label}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="px-3 py-3 text-muted">Select text and press M, or click Add, to save a spot. C and Shift+C step through your bookmarks.</p>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {last && (
              <button type="button" onClick={goBack} title="Back to where you were before the jump (B)" className={clsx(PILL, 'px-3 py-1')}>
                <Undo2 className="size-3.5 text-accent" />
                Back to page {last.page}
              </button>
            )}
            <button
              type="button"
              onClick={() => setListOpen((o) => !o)}
              aria-expanded={listOpen}
              title="Bookmarks (M to add, C / Shift+C to step through)"
              className={clsx(PILL, 'px-2.5 py-1', listOpen && 'border-accent')}
            >
              <BookmarkIcon className="size-3.5 text-accent" />
              {shownBookmarks.length || ''}
              <span className="sr-only">Bookmarks</span>
            </button>
          </div>
        </div>
      )}
      {error && <div className="absolute inset-0 z-20 bg-panel-2 p-6 text-sm text-danger">Could not display the PDF: {error}</div>}
    </div>
  );
});
