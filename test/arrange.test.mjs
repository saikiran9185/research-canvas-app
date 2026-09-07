// Tidying: align, distribute, snap to grid.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const tmp = mkdtempSync(join(process.cwd(), "node_modules", ".rc-arr-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
// Inline geometry and constants so the test exercises the real shipped maths.
const consts = readFileSync("src/constants.ts", "utf8").replace(/^\/\/.*$/gm, "");
const geom = readFileSync("src/geometry.ts", "utf8")
  .replace('import type { Camera, Item } from "./types";', "")
  .replace(/import \{[\s\S]*?\} from "\.\/constants";/, consts);
const src = readFileSync("src/arrange.ts", "utf8")
  .replace(/import \{[\s\S]*?\} from "\.\/geometry";\n/g, "")
  .replace('import type { Item } from "./types";', "");
writeFileSync(join(tmp, "arrange.ts"), geom + "\n" + src);
const out = join(tmp, "arrange.mjs");
execSync(`npx esbuild ${join(tmp, "arrange.ts")} --format=esm --loader:.ts=ts --outfile=${out}`, { stdio: "pipe" });
const A = await import(out);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const box = (id, x, y, w = 40, h = 40, extra = {}) =>
  ({ id, type: "note", x, y, w, h, text: "", color: "#fff", ...extra });
const at = (items, id) => items.find((i) => i.id === id);
const all = (items) => new Set(items.map((i) => i.id));

// ---- align --------------------------------------------------------------

check("aligning left puts every left edge on the leftmost one", () => {
  const items = [box("a", 0, 0), box("b", 50, 60), box("c", 120, 10)];
  const out = A.align(items, all(items), "left");
  for (const i of out) assert.equal(i.x, 0);
});

check("aligning right lines up right edges, not left ones", () => {
  // Different widths is the case that catches a wrong implementation.
  const items = [box("a", 0, 0, 100, 40), box("b", 10, 60, 20, 40)];
  const out = A.align(items, all(items), "right");
  assert.equal(at(out, "a").x + 100, 100);
  assert.equal(at(out, "b").x + 20, 100);
});

check("centring uses centres, and only moves along one axis", () => {
  const items = [box("a", 0, 0, 100, 40), box("b", 0, 60, 20, 40)];
  const out = A.align(items, all(items), "hcenter");
  assert.equal(at(out, "a").x + 50, 50);
  assert.equal(at(out, "b").x + 10, 50);
  assert.equal(at(out, "b").y, 60, "vertical position must not change");
});

check("alignment is relative to the selection, not the viewport", () => {
  // Aligning to the window would move the whole group somewhere unasked.
  const items = [box("a", 500, 500), box("b", 600, 700)];
  const out = A.align(items, all(items), "top");
  assert.equal(at(out, "a").y, 500);
  assert.equal(at(out, "b").y, 500);
});

check("one item alone has nothing to align to", () => {
  const items = [box("a", 33, 44)];
  assert.equal(A.align(items, all(items), "left"), items);
});

check("locked items are left alone", () => {
  const items = [box("a", 0, 0), box("b", 90, 0), box("c", 45, 0, 40, 40, { locked: true })];
  const out = A.align(items, all(items), "left");
  assert.equal(at(out, "c").x, 45, "a locked item must not be moved");
});

check("unselected items are left alone", () => {
  const items = [box("a", 0, 0), box("b", 90, 0), box("c", 45, 0)];
  const out = A.align(items, new Set(["a", "b"]), "left");
  assert.equal(at(out, "c").x, 45);
});

// ---- distribute ---------------------------------------------------------

check("gaps are evened out between edges, not centres", () => {
  // Centres look wrong the moment sizes differ, which on a research board
  // they always do — a video card beside a sticky note.
  const items = [box("a", 0, 0, 10, 10), box("b", 40, 0, 50, 10), box("c", 200, 0, 10, 10)];
  const out = A.distribute(items, all(items), "horizontal");
  const g1 = at(out, "b").x - (at(out, "a").x + 10);
  const g2 = at(out, "c").x - (at(out, "b").x + 50);
  assert.ok(Math.abs(g1 - g2) < 1e-9, `gaps ${g1} and ${g2} should match`);
});

check("the outermost two do not move — they define the span", () => {
  const items = [box("a", 0, 0), box("b", 37, 0), box("c", 300, 0)];
  const out = A.distribute(items, all(items), "horizontal");
  assert.equal(at(out, "a").x, 0);
  assert.equal(at(out, "c").x, 300);
});

check("vertical distribution works the same way on the other axis", () => {
  const items = [box("a", 0, 0), box("b", 0, 33), box("c", 0, 300)];
  const out = A.distribute(items, all(items), "vertical");
  assert.equal(at(out, "a").y, 0);
  assert.equal(at(out, "c").y, 300);
  const g1 = at(out, "b").y - 40, g2 = 300 - (at(out, "b").y + 40);
  assert.ok(Math.abs(g1 - g2) < 1e-9);
});

check("fewer than three things have no gaps to even out", () => {
  const items = [box("a", 0, 0), box("b", 90, 0)];
  assert.equal(A.distribute(items, all(items), "horizontal"), items);
});

check("distribution does not care what order they were selected in", () => {
  const items = [box("c", 300, 0), box("a", 0, 0), box("b", 37, 0)];
  const out = A.distribute(items, all(items), "horizontal");
  assert.equal(at(out, "a").x, 0);
  assert.equal(at(out, "c").x, 300);
});

// ---- grid ---------------------------------------------------------------

check("snapping rounds to the nearest line, not down to it", () => {
  assert.equal(A.snapTo(23, 20), 20);
  assert.equal(A.snapTo(31, 20), 40);
  assert.equal(A.snapTo(-9, 20), -0);
});

check("a zero or negative step changes nothing", () => {
  assert.equal(A.snapTo(37, 0), 37);
  const items = [box("a", 37, 41)];
  assert.equal(A.snapToGrid(items, all(items), 0), items);
});

check("snapping moves the corner, which is where alignment is read", () => {
  const items = [box("a", 23, 31, 55, 55)];
  const out = A.snapToGrid(items, all(items), 20);
  assert.equal(at(out, "a").x, 20);
  assert.equal(at(out, "a").y, 40);
  assert.equal(at(out, "a").w, 55, "size must not change");
});

check("already-aligned items are returned untouched", () => {
  const items = [box("a", 40, 60)];
  assert.equal(A.snapToGrid(items, all(items), 20), items);
});

console.log(`\n${passed} arrange checks passed`);
