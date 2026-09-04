// Reading text off a scanned page.
//
// A PDF exported from a scanner is a picture of a document: pdf.js finds no
// text layer, so there is nothing to select and nothing to quote. This is not
// an edge case — official notices, older papers and anything that went through
// a photocopier all arrive this way.
//
// Tesseract gives us the words and, crucially, their positions, which is what
// lets a highlight anchor to a real place on the page. Everything it needs is
// bundled in public/tesseract (see scripts/sync-assets.mjs), so this works with
// no network.

import type { Worker } from "tesseract.js";

/** One recognised word and where it sits, normalised 0..1 against the page. */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tesseract's own confidence, 0-100. */
  confidence: number;
  /** Index of the line this word belongs to, so lines can be reassembled. */
  line: number;
}

export interface OcrPage {
  words: OcrWord[];
  text: string;
}

const ASSETS = "/tesseract";
let workerPromise: Promise<Worker> | null = null;

/**
 * The shared worker. Starting it costs a couple of seconds and a few hundred
 * megabytes of wasm heap, so it is created once and reused for every page.
 */
async function getWorker(onStatus?: (s: string) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, {
        workerPath: `${ASSETS}/worker.min.js`,
        corePath: ASSETS,
        langPath: ASSETS,
        // The model is vendored uncompressed, so do not look for a .gz.
        gzip: false,
        logger: (m: { status: string; progress: number }) => {
          if (!onStatus) return;
          const pct = Math.round((m.progress ?? 0) * 100);
          onStatus(`${m.status}${pct ? ` ${pct}%` : ""}`);
        },
      });
    })();
    // A failed start must not leave a poisoned promise behind.
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Recognise a rendered page. `canvasOrUrl` is the page image as displayed. */
export async function recognisePage(
  image: HTMLCanvasElement | HTMLImageElement | string,
  onStatus?: (s: string) => void,
): Promise<OcrPage> {
  const worker = await getWorker(onStatus);
  const { data } = await worker.recognize(image, {}, { blocks: true });

  // Tesseract reports pixel boxes against the image it was given; normalise
  // them so a highlight survives zooming, resizing and a different screen —
  // the same contract every other anchor in the app follows.
  const el = typeof image === "string" ? null : image;
  const pw = (data as any).width ?? el?.width ?? 0;
  const ph = (data as any).height ?? el?.height ?? 0;

  const words: OcrWord[] = [];
  let lineIndex = 0;
  for (const block of (data as any).blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          const b = w.bbox;
          if (!b || !pw || !ph) continue;
          const text = String(w.text ?? "").trim();
          if (!text) continue;
          words.push({
            text,
            x: b.x0 / pw,
            y: b.y0 / ph,
            w: (b.x1 - b.x0) / pw,
            h: (b.y1 - b.y0) / ph,
            confidence: w.confidence ?? 0,
            line: lineIndex,
          });
        }
        lineIndex++;
      }
    }
  }

  return { words, text: data.text ?? "" };
}

/** Shut the worker down — it holds a lot of memory. */
export async function stopOcr() {
  const p = workerPromise;
  workerPromise = null;
  if (p) await (await p).terminate().catch(() => {});
}

/**
 * Build a selectable text layer from OCR words, laid out like pdf.js's own:
 * transparent, absolutely-positioned spans over the page. Once it exists the
 * browser's ordinary selection works, so the rest of the app — quoting,
 * anchoring, extraction — needs no special case for scanned pages.
 */
export function buildOcrTextLayer(
  container: HTMLDivElement,
  words: OcrWord[],
  displayW: number,
  displayH: number,
) {
  container.replaceChildren();
  container.style.width = `${displayW}px`;
  container.style.height = `${displayH}px`;

  let currentLine = -1;
  let lineEl: HTMLElement | null = null;

  for (const word of words) {
    // One element per line keeps selection contiguous, so dragging across a
    // sentence yields a sentence rather than a bag of words.
    if (word.line !== currentLine) {
      currentLine = word.line;
      lineEl = document.createElement("span");
      lineEl.className = "ocr-line";
      container.append(lineEl);
    }
    const el = document.createElement("span");
    el.className = "ocr-word";
    el.textContent = word.text;
    el.style.left = `${word.x * displayW}px`;
    el.style.top = `${word.y * displayH}px`;
    el.style.width = `${word.w * displayW}px`;
    el.style.height = `${word.h * displayH}px`;
    // Size the glyphs to the box so selection highlights match the printed
    // words rather than floating above or below them.
    el.style.fontSize = `${Math.max(6, word.h * displayH * 0.86)}px`;
    lineEl!.append(el);
    // A trailing space so copied text has word breaks in it.
    lineEl!.append(document.createTextNode(" "));
  }
}
