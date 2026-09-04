// Exporting a whole board as a PDF.
//
// The point of this file is the sentence "send it to someone who doesn't have
// the app". The result must open in any PDF reader, on any machine, offline,
// and still show what was said about what: the board as a picture, then one
// page of evidence per annotated moment with the highlight drawn on the frame,
// then a plain index of every note.

import { jsPDF } from "jspdf";
import type { Annotation, CanvasDoc, MediaItem } from "./types";
import { fmtTime } from "./types";
import { renderBoard, mediaStill, drawAnnotationOverlay } from "./render";

// A4 in points, which is jsPDF's unit here.
const A4 = { w: 595.28, h: 841.89 };
const M = 48; // page margin

export interface ExportOptions {
  includeBoard: boolean;
  includeEvidence: boolean;
  includeIndex: boolean;
  onProgress?: (msg: string) => void;
}

interface Group {
  item: MediaItem;
  page?: number;
  time?: number;
  notes: Annotation[];
}

/**
 * Group annotations into "one still frame each": the same PDF page, or the
 * same moment in a video (rounded to a quarter second, so notes left on the
 * same frame share one evidence page instead of repeating it).
 */
function groupForEvidence(doc: CanvasDoc, annotations: Annotation[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const a of annotations) {
    const item = doc.items.find((i) => i.id === a.anchor.itemId);
    if (!item || item.type !== "media") continue;
    const t = a.anchor.time !== undefined ? Math.round(a.anchor.time * 4) / 4 : undefined;
    const key = `${item.id}|${a.anchor.page ?? ""}|${t ?? ""}`;
    let g = byKey.get(key);
    if (!g) { g = { item, page: a.anchor.page, time: t, notes: [] }; byKey.set(key, g); }
    g.notes.push(a);
  }
  return [...byKey.values()].sort((x, y) =>
    x.item.name.localeCompare(y.item.name) ||
    (x.page ?? 0) - (y.page ?? 0) ||
    (x.time ?? 0) - (y.time ?? 0));
}

function jpeg(canvas: HTMLCanvasElement, quality = 0.92): string {
  return canvas.toDataURL("image/jpeg", quality);
}

/** Composite any drawable onto a white canvas so JPEG never turns alpha black. */
function flatten(src: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

export async function exportBoardPdf(
  doc: CanvasDoc,
  annotations: Annotation[],
  opts: ExportOptions,
): Promise<Uint8Array> {
  const say = opts.onProgress ?? (() => {});
  const live = annotations.filter((a) => !a.deleted);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });

  // ---- cover ----
  say("Building cover…");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(30);
  pdf.text(doc.name, M, 130, { maxWidth: A4.w - M * 2 });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(110);
  pdf.text(
    [
      new Date().toLocaleString(),
      `${doc.items.length} item${doc.items.length === 1 ? "" : "s"} on the canvas` +
        ` · ${live.length} note${live.length === 1 ? "" : "s"}`,
      "Exported from Research Canvas — an offline, open-source infinite canvas.",
    ],
    M, 162,
  );

  const authors = [...new Map(live.map((a) => [a.authorId, a])).values()];
  if (authors.length) {
    let y = 215;
    pdf.setTextColor(60);
    pdf.setFontSize(10);
    pdf.text("Notes by", M, y);
    y += 16;
    for (const a of authors) {
      const rgb = hexToRgb(a.color);
      pdf.setFillColor(rgb.r, rgb.g, rgb.b);
      pdf.circle(M + 4, y - 3, 4, "F");
      pdf.setTextColor(40);
      pdf.text(`${a.author} — ${live.filter((x) => x.authorId === a.authorId).length}`, M + 15, y);
      y += 16;
    }
  }
  pdf.setTextColor(0);

  // ---- the board itself, on a landscape page ----
  if (opts.includeBoard && doc.items.length) {
    say("Rendering the board…");
    const board = await renderBoard(doc, 3400);
    pdf.addPage([A4.h, A4.w], "landscape");
    const pw = A4.h, ph = A4.w;
    const fit = fitInto(board.canvas.width, board.canvas.height, pw - M * 2, ph - M * 2 - 22);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("The board", M, M - 12);
    pdf.addImage(jpeg(board.canvas), "JPEG", (pw - fit.w) / 2, M + 6, fit.w, fit.h, undefined, "FAST");
    if (board.failed.length) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(180, 60, 60);
      pdf.text(`Could not render: ${board.failed.join(", ")}`, M, ph - M + 12);
      pdf.setTextColor(0);
    }
  }

  // ---- evidence: one still per annotated moment ----
  if (opts.includeEvidence) {
    const groups = groupForEvidence(doc, live);
    let n = 0;
    for (const g of groups) {
      n++;
      say(`Capturing evidence ${n}/${groups.length} — ${g.item.name}…`);
      pdf.addPage([A4.w, A4.h], "portrait");

      // heading
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(g.item.name, M, M + 4, { maxWidth: A4.w - M * 2 });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      pdf.setTextColor(120);
      const where = [
        g.item.kind.toUpperCase(),
        g.page !== undefined ? `page ${g.page}` : "",
        g.time !== undefined ? `at ${fmtTime(g.time)}` : "",
      ].filter(Boolean).join("  ·  ");
      pdf.text(where, M, M + 20);
      pdf.setTextColor(0);

      // the still, with every note on it drawn over the top
      let cursorY = M + 34;
      try {
        const still = await mediaStill(g.item, 1600, g.time, g.page);
        const flat = flatten(still);
        const ctx = flat.getContext("2d")!;
        g.notes.forEach((a, i) => {
          drawAnnotationOverlay(ctx, a, 0, 0, flat.width, flat.height, String(i + 1));
        });
        const fit = fitInto(flat.width, flat.height, A4.w - M * 2, 420);
        pdf.addImage(jpeg(flat), "JPEG", M, cursorY, fit.w, fit.h, undefined, "FAST");
        cursorY += fit.h + 20;
      } catch {
        pdf.setFontSize(9.5);
        pdf.setTextColor(180, 60, 60);
        pdf.text("(the frame could not be rendered — the notes are below)", M, cursorY + 12);
        pdf.setTextColor(0);
        cursorY += 30;
      }

      // the notes for this still
      for (const [i, a] of g.notes.entries()) {
        cursorY = writeNote(pdf, a, i + 1, cursorY, M, A4.w - M * 2, A4.h - M);
      }
    }
  }

  // ---- plain index of every note ----
  if (opts.includeIndex && live.length) {
    say("Writing the index…");
    pdf.addPage([A4.w, A4.h], "portrait");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text("All notes", M, M + 6);
    let y = M + 30;

    const byItem = new Map<string, Annotation[]>();
    for (const a of live) {
      const k = a.anchor.itemId;
      if (!byItem.has(k)) byItem.set(k, []);
      byItem.get(k)!.push(a);
    }

    for (const [itemId, list] of byItem) {
      const item = doc.items.find((i) => i.id === itemId);
      const name = item && item.type === "media" ? item.name : "On the canvas";
      if (y > A4.h - M - 60) { pdf.addPage([A4.w, A4.h], "portrait"); y = M; }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text(name, M, y, { maxWidth: A4.w - M * 2 });
      y += 16;
      for (const [i, a] of list.entries()) {
        y = writeNote(pdf, a, i + 1, y, M, A4.w - M * 2, A4.h - M);
      }
      y += 8;
    }
  }

  say("Finishing…");
  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

/** One note block; returns the new y, adding a page when it runs off the bottom. */
function writeNote(
  pdf: jsPDF, a: Annotation, index: number,
  y: number, x: number, width: number, bottom: number,
): number {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const body = pdf.splitTextToSize(a.text || "(scribble only)", width - 26) as string[];
  const needed = 16 + body.length * 13 + 8;
  if (y + needed > bottom) { pdf.addPage([A4.w, A4.h], "portrait"); y = 48; }

  const rgb = hexToRgb(a.color);
  pdf.setFillColor(rgb.r, rgb.g, rgb.b);
  pdf.circle(x + 7, y + 3, 7, "F");
  pdf.setTextColor(255);
  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "bold");
  pdf.text(String(index), x + 7, y + 5.5, { align: "center" });

  pdf.setTextColor(30);
  pdf.setFontSize(10);
  const meta = [
    a.author,
    a.anchor.page !== undefined ? `p.${a.anchor.page}` : "",
    a.anchor.time !== undefined ? fmtTime(a.anchor.time) : "",
    a.resolved ? "resolved" : "",
  ].filter(Boolean).join("  ·  ");
  pdf.text(meta, x + 20, y + 6);

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(70);
  pdf.text(body, x + 20, y + 20);
  pdf.setTextColor(0);
  return y + 20 + body.length * 13 + 10;
}

function fitInto(w: number, h: number, maxW: number, maxH: number) {
  const s = Math.min(maxW / w, maxH / h);
  return { w: w * s, h: h * s };
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 60, g: 60, b: 60 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
