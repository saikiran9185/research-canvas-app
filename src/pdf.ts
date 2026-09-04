// PDF rendering, wrapped so the rest of the app never touches pdf.js directly.
//
// pdf.js ships its worker as a separate file. Vite gives us a URL for it with
// the `?url` suffix and bundles it — everything stays inside the app, nothing
// is fetched from a CDN at runtime, which is the whole point of a local tool.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { fileUrl } from "./storage";

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

/** Open a PDF from an absolute disk path (cached — the same file opens once). */
export function openPdf(path: string): Promise<PdfDoc> {
  let doc = cache.get(path);
  if (!doc) {
    doc = pdfjs.getDocument({ url: fileUrl(path), ...PDF_ASSETS }).promise;
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

/** Text on a page, so a highlight can carry the words it covers. */
export async function pageText(path: string, pageNumber: number): Promise<string> {
  const doc = await openPdf(path);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  const content = await page.getTextContent();
  return content.items.map((i: any) => ("str" in i ? i.str : "")).join(" ");
}
