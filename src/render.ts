// Rasterising the board.
//
// The app draws the canvas with DOM elements and SVG, which is right for
// editing but cannot be handed to anyone. To export, we redraw the same items
// onto a 2D canvas at whatever resolution we like. Everything here is pure
// drawing — no React, no app state — so the PDF export and any future
// PNG export can share it.

import type { CanvasDoc, Item, MediaItem, ShapeItem } from "./types";
import { fileUrl } from "./storage";
import { renderPage } from "./pdf";

export interface Box { x: number; y: number; w: number; h: number }

export function itemBox(it: Item): Box {
  if (it.type === "stroke") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < it.points.length; i += 2) {
      minX = Math.min(minX, it.points[i]); maxX = Math.max(maxX, it.points[i]);
      minY = Math.min(minY, it.points[i + 1]); maxY = Math.max(maxY, it.points[i + 1]);
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (it.type === "text") return { x: it.x, y: it.y, w: it.w, h: estimateTextHeight(it.text, it.fontSize, it.w) };
  if (it.type === "excerpt") return { x: it.x, y: it.y, w: it.w, h: it.h };
  if (it.type === "shape") {
    const x = it.w < 0 ? it.x + it.w : it.x;
    const y = it.h < 0 ? it.y + it.h : it.y;
    return { x, y, w: Math.abs(it.w), h: Math.abs(it.h) };
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

function estimateTextHeight(text: string, fontSize: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.max(fontSize * 1.4, lines * fontSize * 1.35);
}

export function boardBounds(doc: CanvasDoc): Box {
  if (!doc.items.length) return { x: 0, y: 0, w: 1200, h: 800 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of doc.items) {
    const b = itemBox(it);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

// --- loading media into something drawable --------------------------------

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/**
 * Grab a single video frame as an image. Used both for the board overview
 * (frame 0 as a poster) and for the evidence page of a timecoded note.
 */
export function captureVideoFrame(path: string, time: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    // Seeking to exactly 0 sometimes yields an undecoded (black) frame, so
    // nudge past the first frame when the caller asked for the very start.
    const target = time > 0 ? time : 0.04;
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 640;
      c.height = v.videoHeight || 360;
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      v.src = "";
      resolve(c);
    };

    v.onloadeddata = () => { v.currentTime = Math.min(target, Math.max(0, (v.duration || target) - 0.01)); };
    v.onseeked = done;
    v.onerror = () => { if (!settled) { settled = true; reject(new Error(`could not read ${path}`)); } };
    // A video that never fires `seeked` must not hang the whole export.
    window.setTimeout(() => { if (!settled) { try { done(); } catch { reject(new Error("timed out")); } } }, 6000);
    v.src = fileUrl(path);
  });
}

/** Whatever a medium looks like as a still, at roughly `width` pixels across. */
export async function mediaStill(
  item: MediaItem,
  width: number,
  time?: number,
  page?: number,
): Promise<CanvasImageSource & { width: number; height: number }> {
  if (item.kind === "image") return await loadImage(fileUrl(item.src)) as any;
  if (item.kind === "video") return await captureVideoFrame(item.src, time ?? 0) as any;
  if (item.kind === "pdf") {
    const r = await renderPage(item.src, page ?? item.page ?? 1, width);
    return await loadImage(r.url) as any;
  }
  // Audio and 3D have no still yet — draw a labelled placeholder card instead.
  return placeholderCard(item, width) as any;
}

function placeholderCard(item: MediaItem, width: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round(width * 0.35);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#d4d4d8";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "center";
  ctx.font = `600 ${Math.round(width * 0.035)}px -apple-system, Helvetica, sans-serif`;
  ctx.fillText(item.kind === "audio" ? `♪ ${item.name}` : `▣ ${item.name}`, c.width / 2, c.height / 2);
  return c;
}

// --- drawing the board ----------------------------------------------------

/** Word-wrap `text` to `maxWidth` using the context's current font. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface BoardRender {
  canvas: HTMLCanvasElement;
  /** Maps a world point onto the rendered pixel grid. */
  bounds: Box;
  scale: number;
  failed: string[];
}

/**
 * Draw the whole board onto one canvas. `maxSide` caps the long edge so a
 * sprawling board still produces a sane file; 3000px is roughly 250 dpi across
 * an A4 landscape page, which is what "high quality" means for print.
 */
export async function renderBoard(doc: CanvasDoc, maxSide = 3000, pad = 60): Promise<BoardRender> {
  const b = boardBounds(doc);
  const bounds = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const scale = Math.min(maxSide / bounds.w, maxSide / bounds.h, 4);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.w * scale));
  canvas.height = Math.max(1, Math.round(bounds.h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);

  const failed: string[] = [];

  // Media first, so strokes and annotations drawn over media stay on top —
  // the same stacking the editor shows.
  for (const it of doc.items) {
    if (it.type !== "media") continue;
    try {
      const still = await mediaStill(it, Math.max(600, Math.round(it.w * scale)));
      drawContain(ctx, still, it.x, it.y, it.w, it.h);
    } catch {
      failed.push(it.name);
      ctx.fillStyle = "#f4f4f5";
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "14px Helvetica, sans-serif";
      ctx.fillText(it.name, it.x + 10, it.y + 24);
    }
  }

  for (const it of doc.items) {
    if (it.type === "media") continue;
    drawItem(ctx, it);
  }

  ctx.restore();
  return { canvas, bounds, scale, failed };
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  x: number, y: number, w: number, h: number,
) {
  const ar = src.width / src.height;
  let dw = w, dh = w / ar;
  if (dh > h) { dh = h; dw = h * ar; }
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item) {
  if (it.type === "stroke") {
    if (it.points.length < 4) return;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = it.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(it.points[0], it.points[1]);
    for (let i = 2; i < it.points.length; i += 2) ctx.lineTo(it.points[i], it.points[i + 1]);
    ctx.stroke();
    return;
  }

  if (it.type === "shape") {
    const s = it as ShapeItem;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.fillStyle = s.color;
    const x = s.w < 0 ? s.x + s.w : s.x;
    const y = s.h < 0 ? s.y + s.h : s.y;
    const w = Math.abs(s.w), h = Math.abs(s.h);
    const filled = !!s.fill && s.fill !== "none";
    if (s.shape === "rect") {
      roundRect(ctx, x, y, w, h, 4);
      if (filled) { ctx.fillStyle = s.fill!; ctx.fill(); ctx.fillStyle = s.color; }
      if (s.size > 0) ctx.stroke();
    }
    else if (s.shape === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (filled) { ctx.fillStyle = s.fill!; ctx.fill(); ctx.fillStyle = s.color; }
      if (s.size > 0) ctx.stroke();
    } else {
      const x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = 6 + s.size * 2.2;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
    return;
  }

  if (it.type === "text") {
    ctx.fillStyle = it.color;
    ctx.font = `${it.fontSize}px -apple-system, Helvetica, sans-serif`;
    ctx.textBaseline = "top";
    let y = it.y;
    for (const line of wrap(ctx, it.text, it.w)) {
      ctx.fillText(line, it.x, y);
      y += it.fontSize * 1.35;
    }
    return;
  }

  if (it.type === "excerpt") {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, it.x, it.y, it.w, it.h, 10);
    ctx.fill();
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#374151";
    ctx.font = "italic 13px -apple-system, Helvetica, sans-serif";
    ctx.textBaseline = "top";
    let y = it.y + 14;
    for (const line of wrap(ctx, it.text, it.w - 28)) {
      if (y > it.y + it.h - 34) break;
      ctx.fillText(line, it.x + 14, y);
      y += 18;
    }
    ctx.fillStyle = it.color;
    ctx.font = "600 11px -apple-system, Helvetica, sans-serif";
    ctx.fillText(`↩ ${it.sourceName}`, it.x + 14, it.y + it.h - 22);
    return;
  }

  if (it.type === "note") {
    ctx.fillStyle = it.color;
    roundRect(ctx, it.x, it.y, it.w, it.h, 8);
    ctx.fill();
    ctx.fillStyle = "#3a3320";
    ctx.font = "15px -apple-system, Helvetica, sans-serif";
    ctx.textBaseline = "top";
    let y = it.y + 12;
    for (const line of wrap(ctx, it.text, it.w - 24)) {
      if (y > it.y + it.h - 18) break;
      ctx.fillText(line, it.x + 12, y);
      y += 21;
    }
  }
}

/** Draw an annotation's highlight box and scribbles over an already-drawn still. */
export function drawAnnotationOverlay(
  ctx: CanvasRenderingContext2D,
  anno: { anchor: { x: number; y: number; w: number; h: number }; color: string; scribbles?: { points: number[]; color: string; size: number }[] },
  x: number, y: number, w: number, h: number,
  label?: string,
) {
  const { anchor } = anno;
  if (anchor.w > 0.001 && anchor.h > 0.001) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = anno.color;
    ctx.fillRect(x + anchor.x * w, y + anchor.y * h, anchor.w * w, anchor.h * h);
    ctx.restore();
    ctx.strokeStyle = anno.color;
    ctx.lineWidth = Math.max(2, w * 0.003);
    ctx.strokeRect(x + anchor.x * w, y + anchor.y * h, anchor.w * w, anchor.h * h);
  }
  for (const s of anno.scribbles ?? []) {
    if (s.points.length < 4) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(2, w * 0.004);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + s.points[0] * w, y + s.points[1] * h);
    for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(x + s.points[i] * w, y + s.points[i + 1] * h);
    ctx.stroke();
  }
  if (label) {
    const cx = x + (anchor.x + anchor.w) * w;
    const cy = y + anchor.y * h;
    const r = Math.max(11, w * 0.016);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = anno.color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(r * 1.1)}px Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }
}


/**
 * Crop a normalised region out of a medium and return it as a data URL.
 * Used when an excerpt is lifted onto the canvas, so the card shows the actual
 * paragraph or frame rather than a description of it.
 */
export async function cropRegion(
  item: MediaItem,
  region: { x: number; y: number; w: number; h: number },
  opts: { time?: number; page?: number; maxWidth?: number } = {},
): Promise<string | undefined> {
  if (region.w < 0.004 || region.h < 0.004) return undefined;
  try {
    const still = await mediaStill(item, opts.maxWidth ?? 1600, opts.time, opts.page);
    const sx = Math.round(region.x * still.width);
    const sy = Math.round(region.y * still.height);
    const sw = Math.max(1, Math.round(region.w * still.width));
    const sh = Math.max(1, Math.round(region.h * still.height));

    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(still, sx, sy, sw, sh, 0, 0, sw, sh);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    // A crop is a nicety; the excerpt is still useful as text plus a backlink.
    return undefined;
  }
}
