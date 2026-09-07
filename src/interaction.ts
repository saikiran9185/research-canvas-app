// The decisions the canvas makes when you press, type or pick a colour —
// pulled out of the component so they can be tested without a browser.
//
// Every function here exists because the logic it holds was, at some point,
// wrong in a way only clicking around could reveal. That loop is slow and
// expensive; these are the same rules, checkable in milliseconds.

import type { Item, Tool } from "./types";
import type { HandleId, Point } from "./geometry";

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
  if (c.hit) {
    // A second click on text or a note opens its editor rather than starting
    // another drag of something you are already holding.
    if (c.isDouble && (c.hit.type === "text" || c.hit.type === "note")) return { kind: "edit" };
    return { kind: "move" };
  }
  return { kind: "marquee", additive: c.shiftKey };
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
export const DOUBLE_CLICK_MS = 450;

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
