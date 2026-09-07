// The rules the canvas follows when you press, type, or pick a colour.
//
// Every case here is a bug that shipped and had to be found by hand. Finding
// them that way is the slow, expensive loop this file exists to replace.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "rc-int-"));
function load(name, strip) {
  const src = strip(readFileSync(`src/${name}.ts`, "utf8"));
  const ts = join(tmp, `${name}.ts`);
  writeFileSync(ts, src);
  const out = join(tmp, `${name}.mjs`);
  execSync(`npx esbuild ${ts} --format=esm --loader:.ts=ts --outfile=${out}`, { stdio: "pipe" });
  return import(out);
}

const I = await load("interaction", (s) =>
  s.replace('import type { Item, Tool } from "./types";', "")
   .replace('import type { HandleId, Point } from "./geometry";', ""));
const T = await load("theme", (s) => s);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };

const base = {
  tool: "select", middleButton: false, spaceDown: false, locked: false,
  shiftKey: false, hit: null, handle: null, isDouble: false,
};
const press = (over) => I.decidePress({ ...base, ...over });
const note = { id: "n", type: "note", x: 0, y: 0, w: 10, h: 10, text: "", color: "#ffe27a" };
const text = { id: "t", type: "text", x: 0, y: 0, w: 10, text: "", color: "#111827", fontSize: 20 };
const shape = { id: "s", type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, color: "#111827", size: 2, fill: "none" };
const stroke = { id: "k", type: "stroke", points: [0, 0], color: "#111827", size: 4 };

// ---- what a press means -------------------------------------------------

check("space or the middle button pans, whatever the tool is", () => {
  assert.equal(press({ spaceDown: true, tool: "pen" }).kind, "pan");
  assert.equal(press({ middleButton: true, tool: "rect" }).kind, "pan");
  assert.equal(press({ tool: "hand" }).kind, "pan");
});

check("a locked camera refuses to pan rather than panning anyway", () => {
  assert.equal(press({ tool: "hand", locked: true }), null);
  assert.equal(press({ spaceDown: true, locked: true }), null);
});

check("a lock does not stop you drawing", () => {
  assert.equal(press({ tool: "pen", locked: true }).kind, "draw");
});

check("a resize handle beats the empty background under it", () => {
  assert.equal(press({ handle: "nw" }).kind, "resize");
  assert.equal(press({ handle: "nw" }).handle, "nw");
});

check("empty background rubber-bands rather than panning", () => {
  // Panning here was why selecting several things was impossible.
  assert.equal(press({}).kind, "marquee");
  assert.equal(press({}).additive, false);
  assert.equal(press({ shiftKey: true }).additive, true);
});

check("pressing an item starts a move", () => {
  assert.equal(press({ hit: note }).kind, "move");
});

check("a second press on text or a note opens its editor", () => {
  assert.equal(press({ hit: text, isDouble: true }).kind, "edit");
  assert.equal(press({ hit: note, isDouble: true }).kind, "edit");
});

check("a second press on a shape is still a move, not an edit", () => {
  assert.equal(press({ hit: shape, isDouble: true }).kind, "move");
});

check("every placing tool places", () => {
  for (const tool of ["text", "note", "comment"]) {
    const i = press({ tool });
    assert.equal(i.kind, "place");
    assert.equal(i.tool, tool);
  }
});

check("drawing tools draw, and are not confused with each other", () => {
  assert.equal(press({ tool: "pen" }).kind, "draw");
  for (const tool of ["rect", "ellipse", "arrow"]) {
    assert.equal(press({ tool }).kind, "shape");
  }
});

// ---- pointer capture ----------------------------------------------------

check("gestures that leave the element capture the pointer", () => {
  for (const i of [{ kind: "pan" }, { kind: "draw" }, { kind: "shape" },
                   { kind: "marquee", additive: false }, { kind: "resize", handle: "nw" },
                   { kind: "move" }]) {
    assert.ok(I.shouldCapturePointer(i), `${i.kind} needs capture to keep tracking`);
  }
});

check("opening an editor must NOT capture the pointer", () => {
  // Capture sends the click to the host, which is not focusable, so focus
  // leaves the textarea that just mounted and its blur handler shuts the
  // editor in the same frame. This is why text input never fired.
  assert.ok(!I.shouldCapturePointer({ kind: "place", tool: "text" }));
  assert.ok(!I.shouldCapturePointer({ kind: "place", tool: "note" }));
  assert.ok(!I.shouldCapturePointer({ kind: "place", tool: "comment" }));
  assert.ok(!I.shouldCapturePointer({ kind: "edit" }));
});

// ---- double-click detection ---------------------------------------------

check("two quick presses on the same item are a double-click", () => {
  assert.ok(I.isDoubleClick({ id: "a", at: 1000 }, "a", 1200));
});

check("two slow presses are not", () => {
  assert.ok(!I.isDoubleClick({ id: "a", at: 1000 }, "a", 1000 + I.DOUBLE_CLICK_MS + 1));
});

check("two quick presses on different items are not", () => {
  assert.ok(!I.isDoubleClick({ id: "a", at: 1000 }, "b", 1050));
});

check("a clock that goes backwards does not fake a double-click", () => {
  assert.ok(!I.isDoubleClick({ id: "a", at: 5000 }, "a", 1000));
});

// ---- the invisible pen --------------------------------------------------

check("the pen can never be set to invisible", () => {
  // A width slider that reached 0 made drawing look broken when it worked.
  assert.equal(I.widthForTool("pen", 0), 1);
  assert.equal(I.widthForTool("pen", 4), 4);
});

check("a shape may legitimately have no outline", () => {
  assert.equal(I.widthForTool("rect", 0), 0);
});

// ---- style controls -----------------------------------------------------

check("ink recolours strokes, outlines and text", () => {
  assert.equal(I.applyInk(stroke, "#f00").color, "#f00");
  assert.equal(I.applyInk(shape, "#f00").color, "#f00");
  assert.equal(I.applyInk(text, "#f00").color, "#f00");
});

check("ink leaves a sticky note's paper alone", () => {
  assert.equal(I.applyInk(note, "#f00").color, "#ffe27a");
});

check("fill fills a shape, including with none", () => {
  assert.equal(I.applyFill(shape, "#eee").fill, "#eee");
  assert.equal(I.applyFill(shape, "none").fill, "none");
});

check("fill repapers a note, but cannot make it transparent", () => {
  assert.equal(I.applyFill(note, "#dbeafe").color, "#dbeafe");
  assert.equal(I.applyFill(note, "none").color, "#ffe27a");
});

check("width touches only what has a width", () => {
  assert.equal(I.applyWidth(stroke, 8).size, 8);
  assert.equal(I.applyWidth(shape, 8).size, 8);
  assert.deepEqual(I.applyWidth(text, 8), text);
});

check("restyling never mutates the original", () => {
  const before = { ...shape };
  I.applyInk(shape, "#f00"); I.applyFill(shape, "#eee"); I.applyWidth(shape, 9);
  assert.deepEqual(shape, before);
});

// ---- where the undo point goes ------------------------------------------

check("a resize takes its undo point the moment the handle is grabbed", () => {
  assert.ok(I.shouldTakeUndoPoint("resize", false, 0, 3));
  assert.ok(!I.shouldTakeUndoPoint("resize", true, 99, 3), "and only once");
});

check("a move waits until it is actually a drag", () => {
  // Taking it on every press would fill the history with clicks that changed
  // nothing; taking it at the END made undo restore the move it should reverse.
  assert.ok(!I.shouldTakeUndoPoint("move", false, 1, 3), "a click is not a drag");
  assert.ok(I.shouldTakeUndoPoint("move", false, 3, 3), "this one is");
  assert.ok(!I.shouldTakeUndoPoint("move", true, 50, 3), "and only once");
});

check("drawing and panning leave the history alone", () => {
  for (const kind of ["draw", "shape", "pan", "marquee"]) {
    assert.ok(!I.shouldTakeUndoPoint(kind, false, 100, 3));
  }
});

check("travel is measured in screen pixels, so the slop feels equal at any zoom", () => {
  assert.equal(I.travelled({ x: 0, y: 0 }, { x: 3, y: 4 }, 1), 5);
  assert.equal(I.travelled({ x: 0, y: 0 }, { x: 3, y: 4 }, 2), 10);
});

// ---- ink that follows the palette ---------------------------------------

check("default ink flips with the palette", () => {
  assert.equal(T.resolveInk(T.INK_TOKEN, true), T.INK.dark);
  assert.equal(T.resolveInk(T.INK_TOKEN, false), T.INK.light);
});

check("an older board's literal default ink flips too", () => {
  assert.equal(T.resolveInk(T.INK.light, true), T.INK.dark);
  assert.equal(T.resolveInk(T.INK.dark, false), T.INK.light);
});

check("a deliberate colour is never repainted", () => {
  for (const dark of [true, false]) assert.equal(T.resolveInk("#ef4444", dark), "#ef4444");
});

check("near-black is unreadable on dark paper, and near-white on light", () => {
  assert.ok(!T.contrastsWithPaper("#000000", true));
  assert.ok(!T.contrastsWithPaper("#ffffff", false));
  assert.ok(T.contrastsWithPaper("#ffffff", true));
  assert.ok(T.contrastsWithPaper("#000000", false));
});

check("a mid-tone reads on both papers", () => {
  assert.ok(T.contrastsWithPaper("#ef4444", true));
  assert.ok(T.contrastsWithPaper("#ef4444", false));
});

check("shorthand hex is understood, and nonsense is left alone", () => {
  assert.ok(!T.contrastsWithPaper("#000", true));
  assert.ok(T.contrastsWithPaper("rebeccapurple", true), "named colours are assumed fine");
});

console.log(`\n${passed} interaction checks passed`);
