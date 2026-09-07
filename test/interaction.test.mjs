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

// Inline the constants module so the tests exercise the real shipped values
// rather than a copy that can drift away from them.
const CONSTANTS = readFileSync("src/constants.ts", "utf8").replace(/^\/\/.*$/gm, "");
const I = await load("interaction", (s) =>
  s.replace('import type { Item, Tool } from "./types";', "")
   .replace('import type { HandleId, Point } from "./geometry";', "")
   .replace(/import \{[^}]*\} from "\.\/constants";/, CONSTANTS)
   .replace(/export \{ DOUBLE_CLICK_MS \};/, ""));
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

check("clicking already-selected text opens it, without needing a double-click", () => {
  // The route that does not depend on two presses landing close enough in
  // time — which is what kept breaking.
  assert.equal(press({ hit: text, alreadySelected: true }).kind, "edit");
  assert.equal(press({ hit: note, alreadySelected: true }).kind, "edit");
});

check("clicking already-selected anything else still moves it", () => {
  assert.equal(press({ hit: shape, alreadySelected: true }).kind, "move");
});

check("the first click on unselected text selects rather than edits", () => {
  assert.equal(press({ hit: text }).kind, "move");
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

// ---- locking ------------------------------------------------------------

const locked = { ...note, id: "lk", locked: true };

check("a locked item is invisible to the pointer", () => {
  // The point of locking: place a reference image, lock it, and every stroke
  // after that lands on the board instead of grabbing the image.
  assert.equal(press({ hit: locked }).kind, "marquee");
  assert.equal(press({ hit: locked, isDouble: true }).kind, "marquee");
});

check("an unlocked item still responds normally", () => {
  assert.equal(press({ hit: note }).kind, "move");
});

check("locking is a flag, not a deletion", () => {
  assert.deepEqual(I.selectable([note, locked]).map((i) => i.id), ["n"]);
  assert.equal(I.selectable([locked]).length, 0);
});

check("nothing locked means nothing filtered", () => {
  assert.equal(I.selectable([note, text, shape]).length, 3);
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

check("the double-click window matches the macOS default", () => {
  // 450 quietly failed anyone slower than the platform default: they got two
  // single clicks and no editor.
  assert.equal(I.DOUBLE_CLICK_MS, 500);
});

check("the grab area is bigger than the handle we draw", () => {
  // A target you can only hit dead-centre reads as unresponsive.
  assert.ok(I.HANDLE_GRAB_PX * 2 > I.HANDLE_DRAW_PX, "grab must exceed draw");
  assert.ok(I.HANDLE_GRAB_PX * 2 >= 20, "and clear a comfortable mouse target");
});

check("no nib width is zero", () => {
  // A zero-width pen is not a thin line, it is an invisible one.
  for (const n of I.NIB_SIZES) assert.ok(n >= 1, `${n} would draw nothing`);
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

// ---- a floating panel that cannot be lost -------------------------------

const rail = { w: 400, h: 46 };
const screen = { w: 1440, h: 900 };

check("a sensible position is kept as it is", () => {
  assert.deepEqual(I.reachablePosition({ x: 300, y: 800 }, rail, screen), { x: 300, y: 800 });
});

check("no stored position means the default place", () => {
  assert.equal(I.reachablePosition(null, rail, screen), null);
});

check("a slightly off-screen position is nudged back into view", () => {
  const out = I.reachablePosition({ x: 1430, y: 880 }, rail, screen);
  assert.ok(out.x + rail.w <= screen.w, "must be fully on screen");
  assert.ok(out.y + rail.h <= screen.h);
});

check("a position from another world is refused, not snapped", () => {
  // This is the actual bug: the positioning scheme changed underneath a stored
  // coordinate, the rail went off-screen, and its drag grip went with it — so
  // there was no way to bring it back.
  assert.equal(I.reachablePosition({ x: 9000, y: 9000 }, rail, screen), null);
  assert.equal(I.reachablePosition({ x: -4000, y: 60 }, rail, screen), null);
});

check("garbage in storage falls back rather than throwing", () => {
  assert.equal(I.reachablePosition({ x: NaN, y: 10 }, rail, screen), null);
  assert.equal(I.reachablePosition({ x: 10, y: Infinity }, rail, screen), null);
});

check("a panel too big for the window uses the default place", () => {
  assert.equal(I.reachablePosition({ x: 10, y: 10 }, { w: 2000, h: 40 }, screen), null);
});

check("a viewport not measured yet does not discard the position", () => {
  assert.deepEqual(I.reachablePosition({ x: 5, y: 5 }, rail, { w: 0, h: 0 }), { x: 5, y: 5 });
});

// ---- heading levels ------------------------------------------------------

check("every heading level has a distinct size, largest first", () => {
  const consts = readFileSync("src/constants.ts", "utf8");
  const levels = [...consts.matchAll(/\{ level: (\d), size: (\d+), label: "([^"]+)" \}/g)]
    .map(([, l, sz, label]) => ({ level: +l, size: +sz, label }));
  assert.equal(levels.length, 7, "H1-H6 plus body");
  const headings = levels.filter((l) => l.level > 0);
  for (let i = 1; i < headings.length; i++) {
    assert.ok(headings[i].size < headings[i - 1].size,
      `${headings[i].label} must be smaller than ${headings[i - 1].label}`);
  }
  assert.ok(levels.some((l) => l.level === 0 && l.label === "Body"));
});

check("the level steps stay apart at board sizes", () => {
  // Steps closer than about 1.15x stop reading as different levels at all.
  const consts = readFileSync("src/constants.ts", "utf8");
  const sizes = [...consts.matchAll(/\{ level: [1-6], size: (\d+),/g)].map((m) => +m[1]);
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i - 1] / sizes[i] >= 1.15,
      `${sizes[i - 1]} and ${sizes[i]} are too close to read as different levels`);
  }
});

console.log(`\n${passed} interaction checks passed`);
