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
import {
  FIT_PADDING_PX, GRID_BASE, GRID_MAJOR_EVERY, GRID_MAX_SCREEN_PX,
  GRID_MIN_SCREEN_PX, MAX_ZOOM, MIN_ITEM_SIZE, MIN_TEXT_WIDTH, MIN_ZOOM,
  TEXT_HINT_PX, TEXT_LEGIBLE_PX, ZOOM_OUT_HEADROOM,
} from "./constants";

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

/**
 * A fallback height for text nobody has measured yet.
 *
 * It is only ever a guess, and it is a guess with a bias built into it: the
 * old version divided the box width by `fontSize * 0.55` to get characters per
 * line, and 0.55 is the average advance width of *Latin* lowercase. Telugu,
 * Devanagari and CJK are all wider than that, and Telugu additionally stacks
 * matras above and below the baseline — so the guess ran short in both
 * directions and the selection box around a paragraph enclosed part of it.
 *
 * There is no width ratio that is right for every script, so this no longer
 * pretends to know one. It assumes a wide glyph and generous line spacing,
 * because a box slightly too large is a cosmetic flaw while a box too small
 * makes text unselectable at its edges. Anything on screen gets measured for
 * real (see `measured` below) and this is used only until that happens.
 */
export function estimateTextHeight(text: string, w: number, fontSize: number): number {
  const CONSERVATIVE_ADVANCE = 0.85; // wide enough for Telugu and CJK alike
  const LINE_HEIGHT = 1.5;           // room for stacked marks above and below
  const perLine = Math.max(1, Math.floor(w / (fontSize * CONSERVATIVE_ADVANCE)));
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.max(fontSize * LINE_HEIGHT, lines * fontSize * LINE_HEIGHT);
}

/**
 * Heights measured from what the font engine actually rendered, in world
 * units, keyed by item id.
 *
 * Passing this in is what makes the box around a paragraph correct for any
 * script rather than for the one whose metrics happened to be hardcoded.
 */
export type Measured = ReadonlyMap<string, number>;

/** The world-space box an item occupies. */
export function bbox(item: Item, measured?: Measured): Rect {
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
    const h = measured?.get(item.id) ?? estimateTextHeight(item.text, item.w, item.fontSize);
    return { x: item.x, y: item.y, w: item.w, h };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function union(items: Item[], measured?: Measured): Rect | null {
  if (!items.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const b = bbox(it, measured);
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
  let { x, y, w } = r;
  const rest = { h: r.h };
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
export function fitTo(item: Item, from: Rect, to: Rect, measured?: Measured): Item {
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
    const b = bbox(item, measured);
    const flipX = item.w < 0, flipY = item.h < 0;
    const nx = mapX(b.x), ny = mapY(b.y);
    const nw = b.w * sx, nh = b.h * sy;
    return { ...item, x: flipX ? nx + nw : nx, y: flipY ? ny + nh : ny, w: flipX ? -nw : nw, h: flipY ? -nh : nh };
  }
  if (item.type === "text") {
    // Text reflows rather than stretching, so only its column width changes.
    return { ...item, x: mapX(item.x), y: mapY(item.y), w: Math.max(MIN_TEXT_WIDTH, item.w * sx) };
  }
  return { ...item, x: mapX(item.x), y: mapY(item.y), w: Math.max(MIN_ITEM_SIZE, item.w * sx), h: Math.max(MIN_ITEM_SIZE, item.h * sy) };
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
export function hitTest(items: Item[], p: Point, slop: number, measured?: Measured): Item | null {
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
    const b = bbox(it, measured);
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

  const best = { x: { dist: tolerance, delta: 0, at: 0, other: null as Rect | null },
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
export function cameraFor(target: Rect, viewW: number, viewH: number, pad = FIT_PADDING_PX): Camera {
  if (target.w <= 0 || target.h <= 0) {
    return { x: viewW / 2 - target.x, y: viewH / 2 - target.y, zoom: 1 };
  }
  // One zoom range, shared with the wheel handler. These clamps disagreed —
  // 4 here against 8 there — so zoom-to-fit refused zoom levels you could
  // reach by scrolling.
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((viewW - pad * 2) / target.w, (viewH - pad * 2) / target.h)));
  return {
    zoom,
    x: viewW / 2 - (target.x + target.w / 2) * zoom,
    y: viewH / 2 - (target.y + target.h / 2) * zoom,
  };
}


// ---- grouping -----------------------------------------------------------

/**
 * Widen a selection to whole groups.
 *
 * Clicking one member of a group has to take the group with it, or "grouped"
 * means nothing. Applied at selection time rather than at drag time, so the
 * outline you see is the set that will actually move.
 */
export function expandToGroups(items: Item[], ids: Set<string>): Set<string> {
  const groups = new Set<string>();
  for (const it of items) if (ids.has(it.id) && it.groupId) groups.add(it.groupId);
  if (!groups.size) return ids;
  const out = new Set(ids);
  for (const it of items) if (it.groupId && groups.has(it.groupId)) out.add(it.id);
  return out;
}

// ---- zoom limits --------------------------------------------------------

/**
 * How far out it is still useful to zoom.
 *
 * An infinite canvas will happily let you zoom until the whole board is a
 * speck and you have no idea where anything is — the "I lost sight of it"
 * problem. The floor is the zoom at which everything already on the board
 * fits the viewport, halved, so there is room to pull back for context but
 * not to lose the work entirely. An empty board keeps the absolute floor.
 */
export function minUsefulZoom(content: Rect | null, viewW: number, viewH: number): number {
  if (!content || content.w <= 0 || content.h <= 0 || viewW <= 0 || viewH <= 0) return MIN_ZOOM;
  const fit = Math.min(viewW / content.w, viewH / content.h);
  return Math.max(MIN_ZOOM, Math.min(1, fit * ZOOM_OUT_HEADROOM));
}

/**
 * Grid spacing that stays readable at every zoom.
 *
 * A fixed world spacing fails at both ends — ours was 24 units, which became a
 * 5px mush zoomed out and a near-empty field zoomed in. So the spacing steps by
 * decades (1, 2, 5, 10, 20, 50, 100 …) until the dots land inside a comfortable
 * on-screen band, the way a map's scale bar jumps rather than sliding.
 *
 * Returns the spacing in WORLD units, plus how many of them make a major line.
 */
export function gridSpacing(zoom: number): { world: number; major: number } {
  if (!Number.isFinite(zoom) || zoom <= 0) return { world: GRID_BASE, major: GRID_MAJOR_EVERY };
  const steps = [1, 2, 5];
  let world = GRID_BASE;

  // Too dense: climb the ladder until the dots are far enough apart.
  let guard = 0;
  while (world * zoom < GRID_MIN_SCREEN_PX && guard++ < 40) {
    const decade = Math.pow(10, Math.floor(Math.log10(world)));
    const mantissa = world / decade;
    const next = steps.find((s) => s > mantissa + 1e-9);
    world = next ? next * decade : decade * 10;
  }
  // Too sparse: come back down.
  guard = 0;
  while (world * zoom > GRID_MAX_SCREEN_PX && world > 1e-6 && guard++ < 40) {
    const decade = Math.pow(10, Math.floor(Math.log10(world)));
    const mantissa = world / decade;
    const prev = [...steps].reverse().find((s) => s < mantissa - 1e-9);
    world = prev ? prev * decade : decade / 2;
  }
  return { world, major: GRID_MAJOR_EVERY };
}

// ---- level of detail ----------------------------------------------------

export type Detail = "full" | "greeked" | "block";

/**
 * How much of a card is worth drawing at this size on screen.
 *
 *   full     — draw everything
 *   greeked  — draw the shape of the text as bars, not the glyphs
 *   block    — draw the card as a plain block of its colour
 *
 * The threshold is on the RENDERED size, not on the zoom, so a 64pt heading
 * and a 12pt caption drop out at the zoom levels where each actually stops
 * being readable rather than at one arbitrary level for both.
 */
export function detailFor(fontSizePx: number): Detail {
  if (fontSizePx >= TEXT_LEGIBLE_PX) return "full";
  if (fontSizePx >= TEXT_HINT_PX) return "greeked";
  return "block";
}
