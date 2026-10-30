/**
 * pdf.js, set up once. pdf_viewer.mjs reads the library from
 * `globalThis.pdfjsLib` while it loads, so import this module before it.
 */
// The "legacy" build bundles polyfills (e.g. Map.prototype.getOrInsertComputed)
// that the modern build expects from the very newest browsers.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
(globalThis as { pdfjsLib?: typeof pdfjs }).pdfjsLib = pdfjs;

export { pdfjs };
