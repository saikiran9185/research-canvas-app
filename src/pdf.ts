// PDF rendering, wrapped so the rest of the app never touches pdf.js directly.
//
// pdf.js ships its worker as a separate file. Vite gives us a URL for it with
// the `?url` suffix and bundles it — everything stays inside the app, nothing
// is fetched from a CDN at runtime, which is the whole point of a local tool.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { storage } from "./storage";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

// The Base-14 fonts and the CJK character maps ship with the app (see
// scripts/sync-pdfjs-assets.mjs). Without them a PDF that uses Helvetica —
// which is most of them — renders as a blank page.
const PDF_ASSETS = {
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
};

const cache = new Map<string, Promise<PdfDoc>>();

/**
 * Open a PDF from an absolute disk path (cached — the same file opens once).
 *
 * The bytes are read through the Rust backend rather than handed to pdf.js as
 * an `asset://` URL: pdf.js fetches a URL with its own network layer, which
 * does not understand Tauri's custom scheme, so the URL form fails silently on
 * a packaged app. Reading the file ourselves works everywhere.
 */
export function openPdf(path: string): Promise<PdfDoc> {
  let doc = cache.get(path);
  if (!doc) {
    doc = (async () => {
      const bytes = await storage.readBytes(path);
      return pdfjs.getDocument({ data: bytes, ...PDF_ASSETS }).promise;
    })();
    // A failed open must not poison the cache — the next attempt should retry.
    doc.catch(() => cache.delete(path));
    cache.set(path, doc);
  }
  return doc;
}

export interface RenderedPage {
  /** A data URL for the rendered page. */
  url: string;
  width: number;
  height: number;
}

/**
 * Render one 1-based page to a PNG data URL.
 * `targetWidth` drives the resolution: thumbnails ask small, the reading view
 * asks for the width it is about to display so highlights land pixel-accurate.
 */
export async function renderPage(
  path: string,
  pageNumber: number,
  targetWidth: number,
): Promise<RenderedPage> {
  const doc = await openPdf(path);
  const clamped = Math.min(Math.max(1, pageNumber), doc.numPages);
  const page = await doc.getPage(clamped);

  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  // pdf.js v6 wants the canvas itself, not a context, and paints the page
  // background for us — PDFs assume paper, so ask for white rather than the
  // transparent default, which reads as black over a dark stage.
  await page.render({ canvas, viewport, background: "#ffffff" }).promise;

  return { url: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

export async function pageCount(path: string): Promise<number> {
  return (await openPdf(path)).numPages;
}

/** A page's intrinsic size in PDF points, for fitting it to the window. */
export async function pageSize(path: string, pageNumber: number): Promise<{ w: number; h: number }> {
  const doc = await openPdf(path);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  const v = page.getViewport({ scale: 1 });
  return { w: v.width, h: v.height };
}

/** Text on a page, so a highlight can carry the words it covers. */
export async function pageText(path: string, pageNumber: number): Promise<string> {
  const doc = await openPdf(path);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  const content = await page.getTextContent();
  return content.items.map((i: any) => ("str" in i ? i.str : "")).join(" ");
}

/**
 * Render pdf.js's invisible text layer into `container`, aligned to a page
 * already displayed at `displayWidth` CSS pixels.
 *
 * This is what makes a PDF selectable rather than a picture of a page: pdf.js
 * lays transparent, correctly-positioned spans over the rendered image, so the
 * browser's own selection machinery does the work and a highlight can carry the
 * real words rather than a screenshot of them.
 */
export async function renderTextLayer(
  path: string,
  pageNumber: number,
  displayWidth: number,
  container: HTMLDivElement,
): Promise<number> {
  const doc = await openPdf(path);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));

  const base = page.getViewport({ scale: 1 });
  const scale = displayWidth / base.width;
  const viewport = page.getViewport({ scale });

  container.replaceChildren();

  // `setLayerDimensions` writes width/height as
  //     round(down, var(--total-scale-factor) * Npx, var(--scale-round-x))
  // and pdf.js does NOT define those variables — the embedder must, on the
  // container or an ancestor. Leave them out and every span collapses to zero
  // size: the page looks fine (it is a separate image) but nothing is
  // selectable, because there is nothing there to select.
  container.style.setProperty("--total-scale-factor", String(scale));
  container.style.setProperty("--scale-round-x", "1px");
  container.style.setProperty("--scale-round-y", "1px");

  pdfjs.setLayerDimensions(container, viewport);

  const layer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  });
  await layer.render();

  const spans = container.querySelectorAll("span").length;

  // Guard the failure mode that caused this function to be rewritten: if the
  // custom properties above are missing or renamed by a pdfjs upgrade, the
  // spans still exist but collapse to zero size, so the page looks perfect and
  // selection silently does nothing. Fail loudly instead.
  if (spans > 0 && container.offsetWidth === 0) {
    throw new Error(
      "pdf.js text layer laid out at zero width — the --total-scale-factor " +
      "contract with setLayerDimensions has changed; see renderTextLayer",
    );
  }

  // Zero spans is a different thing entirely: a scanned page with no embedded
  // text. The UI says so rather than leaving the reader wondering.
  return spans;
}
