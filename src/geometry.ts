// Everything about *where things are*.
//
// No React and no DOM, so the renderer, the input layer and the tests all
// agree on one definition of a bounding box, a hit, and a resize.
//
// Camera convention (unchanged from the rest of the app): `cam.x`/`cam.y` are
// a SCREEN-space translation, so screen = world * zoom + cam.
//   world → screen:  w * zoom + cam
//   screen → world:  (s - cam) / zoom

import type { Camera, Item } from "./types";

export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }

export const toWorld = (s: Point, cam: Camera): Point => ({
  x: (s.x - cam.x) / cam.zoom,
  y: (s.y - cam.y) / cam.zoom,
});

export const toScreen = (w: Point, cam: Camera): Point => ({
  x: w.x * cam.zoom + cam.x,
  y: w.y * cam.zoom + cam.y,
});

/** Text height is a guess until the DOM measures it; assume wrapped lines. */
function textHeight(text: string, w: number, fontSize: number): number {
  const perLine = Math.max(1, Math.floor(w / (fontSize * 0.55)));
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.max(fontSize * 1.35, lines * fontSize * 1.35);
}

/** The world-space box an item occupies. */
export function bbox(item: Item): Rect {
  if (item.type === "stroke") {
    const p = item.points;
    // An empty or single-point stroke used to return an Infinity box, which
    // poisoned every union, hit test and selection outline downstream.
    if (p.length < 2) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = p[0], minY = p[1], maxX = p[0], maxY = p[1];
    for (let i = 2; i < p.length; i += 2) {
      if (p[i] < minX) minX = p[i]; else if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1]; else if (p[i + 1] > maxY) maxY = p[i + 1];
    }
    const pad = item.size / 2;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  if (item.type === "shape") {
    // Arrows are stored raw so their direction survives; the box is normalised.
    return {
      x: item.w < 0 ? item.x + item.w : item.x,
      y: item.h < 0 ? item.y + item.h : item.y,
      w: Math.abs(item.w),
      h: Math.abs(item.h),
    };
  }
  if (item.type === "text") {
    return { x: item.x, y: item.y, w: item.w, h: textHeight(item.text, item.w, item.fontSize) };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function union(items: Item[]): Rect | null {
  if (!items.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const b = bbox(it);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const contains = (r: Rect, p: Point) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function normalize(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function translate(item: Item, dx: number, dy: number): Item {
  if (item.type === "stroke") {
    const points = item.points.slice();
    for (let i = 0; i < points.length; i += 2) { points[i] += dx; points[i + 1] += dy; }
    return { ...item, points };
  }
  return { ...item, x: item.x + dx, y: item.y + dy };
}

// ---- resize -------------------------------------------------------------

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const CURSOR: Record<HandleId, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", w: "ew-resize", e: "ew-resize",
};

/** Where a handle sits, in world units, on the edge of a box. */
export function handlePoint(r: Rect, h: HandleId): Point {
  const midX = r.x + r.w / 2, midY = r.y + r.h / 2;
  const right = r.x + r.w, bottom = r.y + r.h;
  switch (h) {
    case "nw": return { x: r.x, y: r.y };
    case "n": return { x: midX, y: r.y };
    case "ne": return { x: right, y: r.y };
    case "e": return { x: right, y: midY };
    case "se": return { x: right, y: bottom };
    case "s": return { x: midX, y: bottom };
    case "sw": return { x: r.x, y: bottom };
    case "w": return { x: r.x, y: midY };
  }
}

/** Apply a handle drag to a box. Keeps it non-negative and above `min`. */
export function resizeRect(r: Rect, h: HandleId, dx: number, dy: number, min: number): Rect {
  let { x, y, w, ...rest } = r;
  let hh = rest.h;
  if (h.includes("w")) { x += dx; w -= dx; }
  if (h.includes("e")) { w += dx; }
  if (h.includes("n")) { y += dy; hh -= dy; }
  if (h.includes("s")) { hh += dy; }
  if (w < min) { if (h.includes("w")) x -= min - w; w = min; }
  if (hh < min) { if (h.includes("n")) y -= min - hh; hh = min; }
  return { x, y, w, h: hh };
}

/**
 * Map an item from one box onto another. This is what lets *any* item resize
 * from *any* handle — including pen strokes, which previously could not be
 * resized at all because there was nothing to scale but their points.
 */
export function fitTo(item: Item, from: Rect, to: Rect): Item {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const mapX = (x: number) => to.x + (x - from.x) * sx;
  const mapY = (y: number) => to.y + (y - from.y) * sy;

  if (item.type === "stroke") {
    const points = item.points.slice();
    for (let i = 0; i < points.length; i += 2) {
      points[i] = mapX(points[i]);
      points[i + 1] = mapY(points[i + 1]);
    }
    // Scale the nib with the drawing, or a shrunk sketch turns into a blob.
    return { ...item, points, size: Math.max(0.5, item.size * Math.sqrt(Math.abs(sx * sy))) };
  }
  if (item.type === "shape") {
    // Signed w/h so an arrow keeps pointing the way it was drawn.
    const b = bbox(item);
    const flipX = item.w < 0, flipY = item.h < 0;
    const nx = mapX(b.x), ny = mapY(b.y);
    const nw = b.w * sx, nh = b.h * sy;
    return { ...item, x: flipX ? nx + nw : nx, y: flipY ? ny + nh : ny, w: flipX ? -nw : nw, h: flipY ? -nh : nh };
  }
  if (item.type === "text") {
    // Text reflows rather than stretching, so only its column width changes.
    return { ...item, x: mapX(item.x), y: mapY(item.y), w: Math.max(40, item.w * sx) };
  }
  return { ...item, x: mapX(item.x), y: mapY(item.y), w: Math.max(20, item.w * sx), h: Math.max(20, item.h * sy) };
}

// ---- hit testing --------------------------------------------------------

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Topmost item under a world point. `slop` is world units, so the grab area
 *  stays constant on screen however far out you are zoomed. */
export function hitTest(items: Item[], p: Point, slop: number): Item | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === "stroke") {
      const reach = it.size / 2 + slop;
      const pts = it.points;
      if (pts.length === 2 && Math.hypot(p.x - pts[0], p.y - pts[1]) <= reach) return it;
      for (let j = 0; j + 3 < pts.length; j += 2) {
        if (distToSegment(p, { x: pts[j], y: pts[j + 1] }, { x: pts[j + 2], y: pts[j + 3] }) <= reach) return it;
      }
      continue;
    }
    if (it.type === "shape" && it.shape === "arrow") {
      const reach = it.size / 2 + slop + 4;
      if (distToSegment(p, { x: it.x, y: it.y }, { x: it.x + it.w, y: it.y + it.h }) <= reach) return it;
      continue;
    }
    const b = bbox(it);
    if (contains({ x: b.x - slop, y: b.y - slop, w: b.w + slop * 2, h: b.h + slop * 2 }, p)) return it;
  }
  return null;
}

// ---- snapping -----------------------------------------------------------

export interface Guide {
  axis: "x" | "y";
  /** World coordinate of the line to draw. */
  at: number;
  /** Extent of the line, so it only spans the things it relates. */
  from: number;
  to: number;
}

export interface Snap { dx: number; dy: number; guides: Guide[]; }

/**
 * Nudge a moving box so its edges or centre line up with the things already on
 * the board — the single feature that most separates a canvas that feels
 * designed from one that feels like a pile of loose rectangles.
 *
 * `tolerance` is in world units (pass screen px / zoom) so the magnet feels the
 * same strength at every zoom level.
 */
export function snapMove(moving: Rect, others: Rect[], tolerance: number): Snap {
  const lanes = (r: Rect) => ({
    x: [r.x, r.x + r.w / 2, r.x + r.w],
    y: [r.y, r.y + r.h / 2, r.y + r.h],
  });
  const mine = lanes(moving);

  let best = { x: { dist: tolerance, delta: 0, at: 0, other: null as Rect | null },
               y: { dist: tolerance, delta: 0, at: 0, other: null as Rect | null } };

  for (const o of others) {
    const theirs = lanes(o);
    for (const axis of ["x", "y"] as const) {
      for (const m of mine[axis]) {
        for (const t of theirs[axis]) {
          const dist = Math.abs(t - m);
          if (dist < best[axis].dist) best[axis] = { dist, delta: t - m, at: t, other: o };
        }
      }
    }
  }

  const guides: Guide[] = [];
  if (best.x.other) {
    const o = best.x.other;
    guides.push({
      axis: "x", at: best.x.at,
      from: Math.min(moving.y, o.y) - 12,
      to: Math.max(moving.y + moving.h, o.y + o.h) + 12,
    });
  }
  if (best.y.other) {
    const o = best.y.other;
    guides.push({
      axis: "y", at: best.y.at,
      from: Math.min(moving.x, o.x) - 12,
      to: Math.max(moving.x + moving.w, o.x + o.w) + 12,
    });
  }
  return { dx: best.x.other ? best.x.delta : 0, dy: best.y.other ? best.y.delta : 0, guides };
}

/** The camera that fits `target` into a viewport, with breathing room. */
export function cameraFor(target: Rect, viewW: number, viewH: number, pad = 80): Camera {
  if (target.w <= 0 || target.h <= 0) {
    return { x: viewW / 2 - target.x, y: viewH / 2 - target.y, zoom: 1 };
  }
  const zoom = Math.min(4, Math.max(0.05, Math.min((viewW - pad * 2) / target.w, (viewH - pad * 2) / target.h)));
  return {
    zoom,
    x: viewW / 2 - (target.x + target.w / 2) * zoom,
    y: viewH / 2 - (target.y + target.h / 2) * zoom,
  };
}
