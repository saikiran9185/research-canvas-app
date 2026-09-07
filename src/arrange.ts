// Tidying a board: align, distribute, and snap to the grid.
//
// Snapping helps while you are dragging something; it cannot line up six cards
// you already placed. These are the commands that turn a pile into a layout,
// and they are pure functions over items so the maths can be checked without a
// browser.

import { bbox, type Measured, type Rect } from "./geometry";
import { translate } from "./geometry";
import type { Item } from "./types";

export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type Distribute = "horizontal" | "vertical";

/** The box that alignment happens inside: everything selected, together. */
function extent(items: readonly Item[], measured?: Measured): Rect | null {
  if (items.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const b = bbox(it, measured);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Line the selection up against one edge of its own bounding box.
 *
 * Deliberately relative to the selection rather than to the viewport: you are
 * arranging these things with respect to each other, and aligning to the
 * window would move the whole group somewhere you did not ask it to go.
 */
export function align(items: readonly Item[], ids: Set<string>, how: Align, measured?: Measured): Item[] {
  const chosen = items.filter((i) => ids.has(i.id) && !i.locked);
  const box = extent(chosen, measured);
  if (!box) return items as Item[];

  const moves = new Map<string, { dx: number; dy: number }>();
  for (const it of chosen) {
    const b = bbox(it, measured);
    let dx = 0, dy = 0;
    switch (how) {
      case "left": dx = box.x - b.x; break;
      case "right": dx = (box.x + box.w) - (b.x + b.w); break;
      case "hcenter": dx = (box.x + box.w / 2) - (b.x + b.w / 2); break;
      case "top": dy = box.y - b.y; break;
      case "bottom": dy = (box.y + box.h) - (b.y + b.h); break;
      case "vcenter": dy = (box.y + box.h / 2) - (b.y + b.h / 2); break;
    }
    if (dx || dy) moves.set(it.id, { dx, dy });
  }
  if (!moves.size) return items as Item[];
  return items.map((i) => {
    const m = moves.get(i.id);
    return m ? translate(i, m.dx, m.dy) : i;
  });
}

/**
 * Even the gaps out along one axis.
 *
 * Spacing is equalised between the *edges*, not between the centres. Centres
 * look wrong the moment the things being spread are different sizes, which on
 * a research board they always are — a video card next to a sticky note.
 * The outermost two do not move: they define the span being filled.
 */
export function distribute(items: readonly Item[], ids: Set<string>, axis: Distribute, measured?: Measured): Item[] {
  const chosen = items.filter((i) => ids.has(i.id) && !i.locked);
  if (chosen.length < 3) return items as Item[]; // two things have no gap to even out

  const horizontal = axis === "horizontal";
  const measure = (it: Item) => {
    const b = bbox(it, measured);
    return horizontal ? { start: b.x, size: b.w } : { start: b.y, size: b.h };
  };

  const sorted = [...chosen].sort((a, b) => measure(a).start - measure(b).start);
  const first = measure(sorted[0]);
  const last = measure(sorted[sorted.length - 1]);
  const span = (last.start + last.size) - first.start;
  const used = sorted.reduce((n, it) => n + measure(it).size, 0);
  const gap = (span - used) / (sorted.length - 1);

  const moves = new Map<string, number>();
  let cursor = first.start;
  for (const it of sorted) {
    const m = measure(it);
    const delta = cursor - m.start;
    if (delta) moves.set(it.id, delta);
    cursor += m.size + gap;
  }
  if (!moves.size) return items as Item[];
  return items.map((i) => {
    const d = moves.get(i.id);
    if (d === undefined) return i;
    return horizontal ? translate(i, d, 0) : translate(i, 0, d);
  });
}

/** Round a value to the nearest multiple of `step`. */
export const snapTo = (v: number, step: number): number =>
  step > 0 ? Math.round(v / step) * step : v;

/**
 * Put the selection on the grid.
 *
 * Aligns each item's top-left corner, not its centre: a corner is where you
 * read alignment from, and it is what the grid lines actually mark.
 */
export function snapToGrid(items: readonly Item[], ids: Set<string>, step: number, measured?: Measured): Item[] {
  if (step <= 0) return items as Item[];
  const moves = new Map<string, { dx: number; dy: number }>();
  for (const i of items) {
    if (!ids.has(i.id) || i.locked) continue;
    const b = bbox(i, measured);
    const dx = snapTo(b.x, step) - b.x;
    const dy = snapTo(b.y, step) - b.y;
    if (dx || dy) moves.set(i.id, { dx, dy });
  }
  // Nothing moved: hand back the same array. A new one would re-render the
  // board and mark it dirty, and a spurious save is a conflict for anyone
  // syncing the folder.
  if (!moves.size) return items as Item[];
  return items.map((i) => {
    const m = moves.get(i.id);
    return m ? translate(i, m.dx, m.dy) : i;
  });
}
