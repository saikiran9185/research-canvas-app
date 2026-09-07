// Frames: a named region that holds whatever is put in it.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const tmp = mkdtempSync(join(process.cwd(), "node_modules", ".rc-fr-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const consts = readFileSync("src/constants.ts", "utf8").replace(/^\/\/.*$/gm, "");
const src = readFileSync("src/geometry.ts", "utf8")
  .replace('import type { Camera, Item } from "./types";', "")
  .replace(/import \{[\s\S]*?\} from "\.\/constants";/, consts);
writeFileSync(join(tmp, "g.ts"), src);
const out = join(tmp, "g.mjs");
execSync(`npx esbuild ${join(tmp, "g.ts")} --format=esm --loader:.ts=ts --outfile=${out}`, { stdio: "pipe" });
const G = await import(out);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const note = (id, x, y, w = 20, h = 20) => ({ id, type: "note", x, y, w, h, text: "", color: "#fff" });
const frame = (id, x, y, w, h) => ({ id, type: "frame", x, y, w, h, title: "S" });
const ids = (arr) => arr.map((i) => i.id).sort();

const F = frame("f", 0, 0, 100, 100);

check("membership is decided by the centre, not by overlap", () => {
  // A card that merely brushes a corner is not in the section; one whose
  // middle is inside is. That is the rule you can predict by looking.
  assert.ok(G.isInFrame(note("a", 40, 40), F), "middle inside");
  assert.ok(!G.isInFrame(note("b", -15, -15), F), "only a corner overlapping");
  assert.ok(G.isInFrame(note("c", 85, 85), F), "mostly out but centred in");
});

check("a card exactly on the edge belongs to the frame", () => {
  assert.ok(G.isInFrame(note("e", 90, 90, 20, 20), F), "centre at 100,100 is on the edge");
});

check("a frame holds what is inside it and nothing else", () => {
  const items = [F, note("in", 10, 10), note("out", 500, 500)];
  assert.deepEqual(ids(G.frameContents(items, "f")), ["in"]);
});

check("a frame never holds itself or another frame", () => {
  const items = [F, frame("g", 10, 10, 20, 20), note("in", 40, 40)];
  assert.deepEqual(ids(G.frameContents(items, "f")), ["in"]);
});

check("a section inside a section does not steal its child's cards", () => {
  // Nesting resolves to the SMALLEST containing frame, so an outer section
  // does not claim what an inner one already holds.
  const outer = frame("outer", 0, 0, 200, 200);
  const inner = frame("inner", 0, 0, 50, 50);
  const items = [outer, inner, note("deep", 10, 10), note("shallow", 120, 120)];
  assert.deepEqual(ids(G.frameContents(items, "inner")), ["deep"]);
  assert.deepEqual(ids(G.frameContents(items, "outer")), ["shallow"]);
});

check("asking about something that is not a frame gives nothing", () => {
  const items = [F, note("a", 10, 10)];
  assert.deepEqual(G.frameContents(items, "a"), []);
  assert.deepEqual(G.frameContents(items, "nope"), []);
});

check("dragging a frame takes its contents with it", () => {
  const items = [F, note("in", 10, 10), note("out", 900, 900)];
  const moving = G.withFrameContents(items, new Set(["f"]));
  assert.deepEqual([...moving].sort(), ["f", "in"]);
});

check("dragging a card does not drag the frame around it", () => {
  const items = [F, note("in", 10, 10)];
  assert.deepEqual([...G.withFrameContents(items, new Set(["in"]))], ["in"]);
});

check("dragging nested frames takes both levels", () => {
  const outer = frame("outer", 0, 0, 200, 200);
  const inner = frame("inner", 0, 0, 50, 50);
  const items = [outer, inner, note("deep", 10, 10), note("shallow", 120, 120)];
  const moving = G.withFrameContents(items, new Set(["outer", "inner"]));
  assert.deepEqual([...moving].sort(), ["deep", "inner", "outer", "shallow"]);
});

check("an empty frame moves alone without complaint", () => {
  assert.deepEqual([...G.withFrameContents([F], new Set(["f"]))], ["f"]);
});

console.log(`\n${passed} frame checks passed`);
