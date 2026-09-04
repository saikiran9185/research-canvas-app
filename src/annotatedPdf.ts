// Writing annotations back into the PDF itself.
//
// Everything else in this app keeps notes in its own sidecar files, which is
// right for collaboration but useless to someone who does not have the app.
// This produces an ordinary .pdf whose highlights and notes are REAL PDF
// annotations — Preview, Acrobat, Zotero and every other reader show them,
// and can edit and reply to them.
//
// Coordinates: our anchors are fractions of the displayed page, with the origin
// at the top-left. PDF space has its origin at the BOTTOM-left and is measured
// in points, and a page may declare a /Rotate. All three have to be undone.

import { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFNumber } from "pdf-lib";
import type { Annotation, MediaItem } from "./types";
import { storage } from "./storage";
import { fmtTime } from "./types";

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Map a normalised, top-left-origin rect onto PDF user space for `page`,
 * accounting for the page's rotation.
 */
function toPdfRect(r: Rect, pw: number, ph: number, rotation: number): Rect {
  // The displayed page is the rotated one, so for 90/270 the visible width is
  // the page's height and vice versa.
  const rot = ((rotation % 360) + 360) % 360;
  if (rot === 90) {
    return { x: r.y * pw, y: r.x * ph, w: r.h * pw, h: r.w * ph };
  }
  if (rot === 180) {
    return { x: (1 - r.x - r.w) * pw, y: r.y * ph, w: r.w * pw, h: r.h * ph };
  }
  if (rot === 270) {
    return { x: (1 - r.y - r.h) * pw, y: (1 - r.x - r.w) * ph, w: r.h * pw, h: r.w * ph };
  }
  // Unrotated: only the vertical flip.
  return { x: r.x * pw, y: (1 - r.y - r.h) * ph, w: r.w * pw, h: r.h * ph };
}

function hexToRgb01(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0.95, g: 0.75, b: 0.2 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** The note text a reader will see, including the quote it was attached to. */
function contentsFor(a: Annotation): string {
  const bits: string[] = [];
  if (a.quote) bits.push(`“${a.quote}”`);
  if (a.text) bits.push(a.text);
  if (a.anchor.time !== undefined) bits.push(`at ${fmtTime(a.anchor.time)}`);
  if (a.resolved) bits.push("(resolved)");
  return bits.join("\n\n") || "(no text)";
}

/**
 * Produce a copy of `item`'s PDF with every annotation written in.
 *
 * A note with a region becomes a Highlight (or a Square when it came from a
 * scribble rather than text); a note pinned to a point becomes a Text note,
 * the little sticky-note marker every reader knows.
 */
export async function buildAnnotatedPdf(
  item: MediaItem,
  annotations: Annotation[],
): Promise<Uint8Array> {
  const bytes = await storage.readBytes(item.src);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const context = pdf.context;

  const live = annotations.filter((a) => !a.deleted && a.anchor.itemId === item.id);
  let written = 0;

  for (const a of live) {
    const pageIndex = (a.anchor.page ?? 1) - 1;
    const page = pages[pageIndex];
    if (!page) continue;

    const { width: pw, height: ph } = page.getSize();
    const rotation = page.getRotation().angle;
    const color = hexToRgb01(a.color);
    const created = new Date(a.createdAt);
    // PDF date format: D:YYYYMMDDHHmmSS
    const pad = (n: number) => String(n).padStart(2, "0");
    const pdfDate = `D:${created.getFullYear()}${pad(created.getMonth() + 1)}${pad(created.getDate())}` +
      `${pad(created.getHours())}${pad(created.getMinutes())}${pad(created.getSeconds())}`;

    const common = {
      // Any text a person wrote goes in as a hex string, which pdf-lib encodes
      // as UTF-16BE. PDFString.of uses PDFDocEncoding, which silently mangles
      // anything outside Latin-1 — curly quotes turn into control characters
      // and non-Latin scripts are destroyed outright.
      T: PDFHexString.fromText(a.author),
      Contents: PDFHexString.fromText(contentsFor(a)),
      // A date is ASCII by definition and must stay a literal string.
      M: PDFString.of(pdfDate),
      C: context.obj([color.r, color.g, color.b]),
      CA: PDFNumber.of(0.4),
      // Printable, so the notes survive being printed to paper.
      F: PDFNumber.of(4),
    };

    const hasRegion = a.anchor.w > 0.002 && a.anchor.h > 0.002;

    if (hasRegion) {
      const r = toPdfRect(a.anchor, pw, ph, rotation);
      const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;

      // A Highlight is defined by QuadPoints, in the order
      // upper-left, upper-right, lower-left, lower-right.
      const quad = context.obj([x1, y2, x2, y2, x1, y1, x2, y1]) as PDFArray;

      const dict = context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of(a.quote ? "Highlight" : "Square"),
        Rect: context.obj([x1, y1, x2, y2]),
        ...(a.quote ? { QuadPoints: quad } : { IC: context.obj([color.r, color.g, color.b]) }),
        ...common,
      });
      page.node.addAnnot(context.register(dict));
      written++;
    } else {
      // A point note. PDF readers draw a fixed-size icon, so the Rect only
      // needs to mark the spot.
      const r = toPdfRect({ ...a.anchor, w: 0, h: 0 }, pw, ph, rotation);
      const dict = context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("Text"),
        Name: PDFName.of("Comment"),
        Rect: context.obj([r.x, r.y - 20, r.x + 20, r.y]),
        Open: false,
        ...common,
        CA: PDFNumber.of(1),
      });
      page.node.addAnnot(context.register(dict));
      written++;
    }
  }

  // Say where the file came from, so a reader can trace it back.
  pdf.setProducer("Research Canvas");
  pdf.setModificationDate(new Date());
  if (written) {
    const existing = pdf.getSubject?.() ?? "";
    pdf.setSubject(
      `${existing ? `${existing} — ` : ""}${written} annotation${written === 1 ? "" : "s"} from Research Canvas`,
    );
  }

  return pdf.save({ useObjectStreams: false });
}

/** How many of these annotations can actually be written into the PDF. */
export function writableCount(item: MediaItem, annotations: Annotation[]): number {
  return annotations.filter(
    (a) => !a.deleted && a.anchor.itemId === item.id && a.anchor.page !== undefined,
  ).length;
}
