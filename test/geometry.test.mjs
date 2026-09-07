// The maths the canvas rests on: bounding boxes, hit testing, resizing from
// any handle, and the snapping that makes a board feel laid out rather than
// scattered. Every case here is a bug that was actually shipped, or a rule the
// interaction layer now depends on.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "rc-geom-"));
const src = readFileSync("src/geometry.ts", "utf8")
  .replace('import type { Camera, Item } from "./types";', "");
const tsFile = join(tmp, "geometry.ts");
writeFileSync(tsFile, src);
const outFile = join(tmp, "geometry.mjs");
execSync(`npx esbuild ${tsFile} --format=esm --loader:.ts=ts --outfile=${outFile}`, { stdio: "pipe" });
const G = await import(outFile);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };

const stroke = (points, size = 4) => ({ id: "s", type: "stroke", points, color: "#000", size });
const note = (x, y, w, h) => ({ id: "n", type: "note", x, y, w, h, text: "", color: "#fff" });
const arrow = (x, y, w, h) => ({ id: "a", type: "shape", shape: "arrow", x, y, w, h, color: "#000", size: 2 });

// ---- bounding boxes -----------------------------------------------------

check("an empty stroke has a zero box, not an infinite one", () => {
  const b = G.bbox(stroke([]));
  assert.deepEqual(b, { x: 0, y: 0, w: 0, h: 0 });
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.w));
});

check("a one-point stroke (a dot) has a finite box", () => {
  const b = G.bbox(stroke([10, 10]));
  assert.ok(Number.isFinite(b.w) && b.w > 0, "a dot must still occupy space");
});

check("stroke box includes half the nib on every side", () => {
  const b = G.bbox(stroke([0, 0, 10, 10], 4));
  assert.deepEqual(b, { x: -2, y: -2, w: 14, h: 14 });
});

check("a shape drawn right-to-left still has a positive box", () => {
  const b = G.bbox({ id: "r", type: "shape", shape: "rect", x: 100, y: 100, w: -40, h: -20, color: "#000", size: 2 });
  assert.deepEqual(b, { x: 60, y: 80, w: 40, h: 20 });
});

check("text height grows with its content instead of being a fixed 40", () => {
  const one = G.bbox({ id: "t", type: "text", x: 0, y: 0, w: 200, text: "one line", color: "#000", fontSize: 20 });
  const many = G.bbox({ id: "t", type: "text", x: 0, y: 0, w: 200, text: "a\nb\nc\nd\ne", color: "#000", fontSize: 20 });
  assert.ok(many.h > one.h, "five lines must be taller than one");
  assert.notEqual(one.h, 40);
});

check("union spans every member", () => {
  const u = G.union([note(0, 0, 10, 10), note(90, 40, 10, 10)]);
  assert.deepEqual(u, { x: 0, y: 0, w: 100, h: 50 });
});

check("union of nothing is null, not an infinite box", () => {
  assert.equal(G.union([]), null);
});

// ---- camera -------------------------------------------------------------

check("screen and world round-trip through the camera", () => {
  const cam = { x: 133, y: -42, zoom: 2.5 };
  const p = { x: 17.5, y: -3.25 };
  const back = G.toWorld(G.toScreen(p, cam), cam);
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});

check("cameraFor frames a box inside the viewport", () => {
  const cam = G.cameraFor({ x: 0, y: 0, w: 1000, h: 500 }, 800, 600, 80);
  const tl = G.toScreen({ x: 0, y: 0 }, cam);
  const br = G.toScreen({ x: 1000, y: 500 }, cam);
  assert.ok(tl.x >= 0 && tl.y >= 0 && br.x <= 800 && br.y <= 600, "must fit on screen");
});

// ---- resizing -----------------------------------------------------------

check("every handle moves the edge it names", () => {
  const r = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(G.resizeRect(r, "e", 20, 0, 20), { x: 0, y: 0, w: 120, h: 100 });
  assert.deepEqual(G.resizeRect(r, "w", 20, 0, 20), { x: 20, y: 0, w: 80, h: 100 });
  assert.deepEqual(G.resizeRect(r, "n", 0, 20, 20), { x: 0, y: 20, w: 100, h: 80 });
  assert.deepEqual(G.resizeRect(r, "s", 0, 20, 20), { x: 0, y: 0, w: 100, h: 120 });
  assert.deepEqual(G.resizeRect(r, "nw", 10, 10, 20), { x: 10, y: 10, w: 90, h: 90 });
});

check("a box cannot be collapsed or turned inside out", () => {
  const out = G.resizeRect({ x: 0, y: 0, w: 100, h: 100 }, "e", -500, 0, 20);
  assert.equal(out.w, 20);
  assert.ok(out.h >= 20);
});

check("dragging the west handle past the east edge pins the left side", () => {
  const out = G.resizeRect({ x: 0, y: 0, w: 100, h: 100 }, "w", 500, 0, 20);
  assert.equal(out.w, 20);
  assert.equal(out.x, 80, "the box must stay anchored to its unmoved edge");
});

check("a stroke can be resized — its points scale with the box", () => {
  const s = stroke([0, 0, 10, 0, 10, 10]);
  const from = G.bbox(s);
  const to = { x: from.x, y: from.y, w: from.w * 2, h: from.h * 2 };
  const out = G.fitTo(s, from, to);
  assert.notDeepEqual(out.points, s.points, "the old code returned strokes untouched");
  assert.ok(Math.abs(G.bbox(out).w - to.w) < 1e-6);
});

check("scaling a stroke scales its nib too", () => {
  const s = stroke([0, 0, 10, 10], 4);
  const from = G.bbox(s);
  const out = G.fitTo(s, from, { ...from, w: from.w * 4, h: from.h * 4 });
  assert.ok(out.size > 4, "a blown-up sketch must not keep a hairline nib");
});

check("an arrow keeps pointing the way it was drawn", () => {
  const a = arrow(100, 100, -50, -50); // drawn up and to the left
  const from = G.bbox(a);
  const out = G.fitTo(a, from, { ...from, w: from.w * 2, h: from.h * 2 });
  assert.ok(out.w < 0 && out.h < 0, "direction must survive a resize");
});

check("resizing a group maps every member through one transform", () => {
  const a = note(0, 0, 50, 50), b = note(50, 50, 50, 50);
  const box = G.union([a, b]);
  const doubled = { x: box.x, y: box.y, w: box.w * 2, h: box.h * 2 };
  const out = [a, b].map((i) => G.fitTo(i, box, doubled));
  assert.deepEqual(G.union(out), doubled);
});

// ---- hit testing --------------------------------------------------------

check("a click near a stroke selects it; a click far away does not", () => {
  const items = [stroke([0, 0, 100, 0])];
  assert.ok(G.hitTest(items, { x: 50, y: 1 }, 6));
  assert.equal(G.hitTest(items, { x: 50, y: 400 }, 6), null);
});

check("a lone dot is clickable", () => {
  assert.ok(G.hitTest([stroke([10, 10])], { x: 10, y: 11 }, 6));
});

check("hit testing returns the topmost item", () => {
  const under = { ...note(0, 0, 100, 100), id: "under" };
  const over = { ...note(0, 0, 100, 100), id: "over" };
  assert.equal(G.hitTest([under, over], { x: 50, y: 50 }, 0).id, "over");
});

check("an arrow is grabbable along its line, not just its box", () => {
  const a = arrow(0, 0, 100, 100);
  assert.ok(G.hitTest([a], { x: 50, y: 50 }, 2), "on the line");
  assert.equal(G.hitTest([a], { x: 5, y: 95 }, 2), null, "inside the box but off the line");
});

// ---- snapping -----------------------------------------------------------

check("a near-miss alignment is pulled into line", () => {
  const moving = { x: 3, y: 200, w: 100, h: 50 };
  const snap = G.snapMove(moving, [{ x: 0, y: 0, w: 100, h: 50 }], 6);
  assert.equal(snap.dx, -3, "left edges should line up");
  assert.ok(snap.guides.some((g) => g.axis === "x"));
});

check("a far miss is left alone", () => {
  const snap = G.snapMove({ x: 400, y: 400, w: 10, h: 10 }, [{ x: 0, y: 0, w: 10, h: 10 }], 6);
  assert.equal(snap.dx, 0);
  assert.equal(snap.dy, 0);
  assert.equal(snap.guides.length, 0);
});

check("centres snap to centres", () => {
  // Mover's centre is at x=54; the other's centre is at x=50.
  const snap = G.snapMove({ x: 4, y: 300, w: 100, h: 20 }, [{ x: 0, y: 0, w: 100, h: 20 }], 6);
  assert.equal(snap.dx, -4);
});

check("guides span both the mover and what it lined up with", () => {
  const snap = G.snapMove({ x: 2, y: 500, w: 100, h: 50 }, [{ x: 0, y: 0, w: 100, h: 50 }], 6);
  const g = snap.guides.find((x) => x.axis === "x");
  assert.ok(g.from < 0 && g.to > 550, "the line must reach both boxes");
});

check("nothing to snap to means no movement", () => {
  const snap = G.snapMove({ x: 10, y: 10, w: 10, h: 10 }, [], 6);
  assert.deepEqual([snap.dx, snap.dy, snap.guides.length], [0, 0, 0]);
});

// ---- translate / marquee ------------------------------------------------

check("translating a stroke moves every point and mutates nothing", () => {
  const s = stroke([0, 0, 10, 10]);
  const out = G.translate(s, 5, -5);
  assert.deepEqual(out.points, [5, -5, 15, 5]);
  assert.deepEqual(s.points, [0, 0, 10, 10], "the original must be untouched");
});

check("a marquee catches what it touches and misses what it does not", () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.ok(G.overlaps(G.bbox(note(90, 90, 50, 50)), box), "a corner overlap counts");
  assert.ok(!G.overlaps(G.bbox(note(200, 200, 10, 10)), box));
});

check("a marquee dragged up-and-left is still a valid box", () => {
  assert.deepEqual(G.normalize({ x: 100, y: 100 }, { x: 20, y: 40 }), { x: 20, y: 40, w: 80, h: 60 });
});

console.log(`\n${passed} geometry checks passed`);
