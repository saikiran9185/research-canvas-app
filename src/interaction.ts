// The decisions the canvas makes when you press, type or pick a colour —
// pulled out of the component so they can be tested without a browser.
//
// Every function here exists because the logic it holds was, at some point,
// wrong in a way only clicking around could reveal. That loop is slow and
// expensive; these are the same rules, checkable in milliseconds.

import type { Item, Tool } from "./types";
import type { HandleId, Point } from "./geometry";
import { DOUBLE_CLICK_MS } from "./constants";

/** What a press on the board should start. */
export type Intent =
  | { kind: "pan" }
  | { kind: "draw" }
  | { kind: "shape" }
  | { kind: "marquee"; additive: boolean }
  | { kind: "move" }
  | { kind: "resize"; handle: HandleId }
  | { kind: "edit" }
  | { kind: "place"; tool: Extract<Tool, "text" | "note" | "comment"> };

export interface PressContext {
  /** Already selected — a press on it means "edit", not "select it again". */
  alreadySelected?: boolean;
  tool: Tool;
  /** Middle button, or space held — both mean "pan whatever the tool is". */
  middleButton: boolean;
  spaceDown: boolean;
  /** The camera is frozen; pan and zoom must do nothing. */
  locked: boolean;
  shiftKey: boolean;
  /** The item under the cursor, if the press landed on one. */
  hit: Item | null;
  /** A resize handle under the cursor takes priority over everything. */
  handle: HandleId | null;
  /** True when this press is the second of a double-click on the same item. */
  isDouble: boolean;
}

/**
 * What a pointer-down means.
 *
 * The ordering is the whole content of this function: a handle beats the item
 * under it, a double-click on text beats starting a drag, and panning beats
 * every tool because space and the middle button are modal.
 */
export function decidePress(c: PressContext): Intent | null {
  if (c.middleButton || c.tool === "hand" || c.spaceDown) {
    return c.locked ? null : { kind: "pan" };
  }
  switch (c.tool) {
    case "pen": return { kind: "draw" };
    case "rect": case "ellipse": case "arrow": return { kind: "shape" };
    case "text": case "note": case "comment": return { kind: "place", tool: c.tool };
    default: break;
  }
  if (c.handle) return { kind: "resize", handle: c.handle };
  // A locked item is not there as far as the pointer is concerned — the press
  // falls through to the board, which is the whole point of locking it.
  if (c.hit && !c.hit.locked) {
    // A second click on text or a note opens its editor rather than starting
    // another drag of something you are already holding.
    // Text opens for editing on a double-click, and also on a plain click when
    // it is ALREADY selected — the way every canvas tool behaves. That second
    // path matters more than it looks: double-click detection depends on two
    // presses landing close enough in time on the same element, which is
    // fragile, and this gives editing a route that does not depend on it at
    // all.
    if ((c.isDouble || c.alreadySelected) && (c.hit.type === "text" || c.hit.type === "note")) {
      return { kind: "edit" };
    }
    return { kind: "move" };
  }
  return { kind: "marquee", additive: c.shiftKey };
}

/**
 * Does this gesture need the pointer captured on the host?
 *
 * Capture is required by anything that keeps tracking after the cursor leaves
 * the element it started on — a drag, a resize, a rubber band. It is actively
 * harmful for anything that opens a text editor: a captured pointer delivers
 * the click to the capture target, the host is not focusable, so focus leaves
 * the textarea that just mounted and its blur handler closes the editor in the
 * same frame. That is why placing text or a note appeared to do nothing.
 */
export function shouldCapturePointer(intent: Intent): boolean {
  switch (intent.kind) {
    case "pan": case "draw": case "shape": case "marquee": case "resize": case "move":
      return true;
    case "place": case "edit":
      return false;
  }
}

/** Items a pointer may act on. Locked ones are visible but inert. */
export function selectable<T extends Item>(items: readonly T[]): T[] {
  return items.filter((i) => !i.locked);
}

/**
 * Double-click, detected from pointer-down rather than from the `dblclick`
 * event.
 *
 * Selecting an item captures the pointer on the host — it has to, so a drag
 * that leaves the item keeps tracking — and a captured pointer delivers the
 * click to the capture target. So `dblclick` never reached the text or the
 * note, and neither could be edited at all.
 */
export { DOUBLE_CLICK_MS };

export function isDoubleClick(
  last: { id: string; at: number },
  id: string,
  now: number,
): boolean {
  return last.id === id && now - last.at < DOUBLE_CLICK_MS && now >= last.at;
}

/**
 * The width a tool should actually draw with.
 *
 * A shape may legitimately have no outline. A pen stroke may not — that is
 * not a thin line, it is an invisible one, and it looked exactly like the pen
 * being broken.
 */
export function widthForTool(tool: Tool, size: number): number {
  if (tool === "pen") return Math.max(1, size);
  return Math.max(0, size);
}

/**
 * Which items a style control touches.
 *
 * The controls used to configure only the *next* item drawn, so clicking "no
 * fill" with a shape selected appeared to do nothing at all. They set the
 * default and restyle the selection; these say what "restyle" means for each
 * kind of item.
 */
export function applyInk(item: Item, color: string): Item {
  // A note's `color` is its paper, not its ink — the fill control owns that.
  if (item.type === "stroke" || item.type === "shape" || item.type === "text") {
    return { ...item, color };
  }
  return item;
}

export function applyWidth(item: Item, size: number): Item {
  if (item.type === "stroke" || item.type === "shape") return { ...item, size };
  return item;
}

export function applyFill(item: Item, fill: string): Item {
  if (item.type === "shape") return { ...item, fill };
  // "No fill" is meaningless for a sticky note, which is defined by its paper.
  if (item.type === "note" && fill !== "none") return { ...item, color: fill };
  return item;
}

/**
 * Where an undo point belongs in a gesture.
 *
 * A drag streams dozens of intermediate boards, so it is applied with history
 * off. Taking the undo point at the *end* records the already-moved board as
 * the state to return to, which makes undo a no-op — moving something became
 * quietly unundoable. It has to be taken before the first pixel moves, and
 * only once the press has actually become a drag, so a plain click does not
 * litter the history.
 */
export function shouldTakeUndoPoint(
  intent: Intent["kind"],
  hasMovedYet: boolean,
  travelledPx: number,
  slopPx: number,
): boolean {
  if (intent === "resize") return !hasMovedYet;
  if (intent === "move") return !hasMovedYet && travelledPx >= slopPx;
  return false;
}

/** Screen distance a press has travelled, for telling a click from a drag. */
export const travelled = (a: Point, b: Point, zoom: number): number =>
  Math.hypot(b.x - a.x, b.y - a.y) * zoom;


// ---- floating panels ----------------------------------------------------

export interface Box { x: number; y: number; w: number; h: number; }

/**
 * Keep a floating panel reachable.
 *
 * A remembered position outlives the thing that produced it: the window gets
 * smaller, a monitor is unplugged, or — as happened here — the positioning
 * scheme changes underneath it and the old coordinates now mean somewhere
 * else. The panel then sits off-screen, and because its drag handle went with
 * it there is no way to bring it back. So a restored position is checked
 * against the viewport it is about to be used in, and a position that would
 * put the panel out of reach is refused rather than honoured.
 *
 * Returns null when the panel should fall back to its default place.
 */
export function reachablePosition(
  pos: { x: number; y: number } | null,
  panel: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 8,
): { x: number; y: number } | null {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  if (viewport.w <= 0 || viewport.h <= 0) return pos;

  const maxX = viewport.w - panel.w - margin;
  const maxY = viewport.h - panel.h - margin;
  // Too big to fit at all: the default placement handles it better.
  if (maxX < margin || maxY < margin) return null;

  const clamped = {
    x: Math.max(margin, Math.min(maxX, pos.x)),
    y: Math.max(margin, Math.min(maxY, pos.y)),
  };
  // Wildly out of range means the stored value belongs to a different world;
  // snapping it to an edge would be arbitrary, so start over instead.
  const drift = Math.hypot(clamped.x - pos.x, clamped.y - pos.y);
  return drift > Math.max(viewport.w, viewport.h) / 2 ? null : clamped;
}
