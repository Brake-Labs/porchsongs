/**
 * Lazy access to pdf.js.
 *
 * Loaded through a dynamic import so the worker, which is over a megabyte, is
 * fetched the first time somebody opens a stored tab and never by the people who
 * only keep chord charts.
 *
 * The worker is referenced with Vite's `?url` so it is emitted as a real asset
 * and served same-origin. That matters twice: the production CSP is
 * `script-src 'self'`, which a CDN worker would violate, and a same-origin asset
 * is one the service worker can precache for offline play.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

let _pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!_pdfjs) {
    _pdfjs = (async () => {
      const [pdfjs, workerUrl] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return _pdfjs;
}

/** Parse bytes into a pdf.js document. The caller owns destroying it. */
export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  return await pdfjs.getDocument({
    // A copy, because pdf.js transfers the buffer to its worker and detaches it.
    // Without this, re-rendering the same tab after a resize throws on a
    // zero-length buffer, which presents as a page that renders once and then
    // goes blank.
    data: data.slice(0),
  }).promise;
}

/**
 * Tear a document down and release its worker resources.
 *
 * pdf.js 6 moved `destroy` off the document and onto the loading task, so this
 * wrapper exists to keep that version detail out of the component.
 */
export async function closePdf(pdf: PDFDocumentProxy): Promise<void> {
  await pdf.loadingTask.destroy();
}

/**
 * Render one page into a canvas, fitted to `containerWidth`.
 *
 * Rendered at the device pixel ratio rather than at CSS size: tab is fret numbers
 * over staff lines read at arm's length, and a canvas rasterised at 1x on a
 * retina screen is exactly where that becomes unreadable.
 */
export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  containerWidth: number,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = containerWidth / unscaled.width;
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 3);

  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a 2D canvas context');

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  }).promise;
}
