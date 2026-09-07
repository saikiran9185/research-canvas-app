// Stacking order that two people can edit at once.
//
// Order used to BE the array order in the file, which cannot merge: two people
// who both reorder produce two lists and the last save silently wins. These
// checks pin down the replacement — and the migration, since every board
// written before this exists without indices.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Built inside the project rather than in /tmp: order.ts imports the CC0
// fractional-indexing package, and node module resolution only finds it from
// somewhere under this directory.
const tmp = mkdtempSync(join(process.cwd(), "node_modules", ".rc-order-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const src = readFileSync("src/order.ts", "utf8")
  .replace('import type { CanvasDoc, Item } from "./types";', "");
const ts = join(tmp, "order.ts");
writeFileSync(ts, src);
const out = join(tmp, "order.mjs");
// Bundle the CC0 fractional-indexing dependency in, pointing esbuild at the
// project's node_modules since the transpiled copy lives in a temp dir.
execSync(`npx esbuild ${ts} --format=esm --bundle --loader:.ts=ts --outfile=${out}`, { stdio: "pipe" });
const O = await import(out);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const it = (id, index) => ({ id, type: "note", x: 0, y: 0, w: 10, h: 10, text: "", color: "#fff", ...(index !== undefined ? { index } : {}) });
const ids = (arr) => arr.map((x) => x.id);

// ---- migration ----------------------------------------------------------

check("a board with no indices gets them from the order it was saved in", () => {
  const before = [it("a"), it("b"), it("c")];
  const after = O.syncIndices(before);
  assert.deepEqual(ids(after), ["a", "b", "c"], "nothing may move on screen");
  assert.ok(after.every((x) => typeof x.index === "string" && x.index.length));
  assert.ok(O.indicesAreValid(after));
});

check("migrating a board that is already current changes nothing at all", () => {
  const doc = { version: 1, name: "n", camera: { x: 0, y: 0, zoom: 1 }, items: O.syncIndices([it("a"), it("b")]) };
  // Same object identity: opening a current board must not mark it dirty and
  // start a save, which for a synced folder is a conflict for everyone else.
  assert.equal(O.migrateDoc(doc), doc);
});

check("items that already hold a good index keep it", () => {
  const seeded = O.syncIndices([it("a"), it("b")]);
  const mixed = [seeded[0], it("new"), seeded[1]];
  const after = O.syncIndices(mixed);
  assert.equal(after[0].index, seeded[0].index, "existing indices must not be rewritten");
  assert.deepEqual(ids(after), ["a", "new", "b"]);
  assert.ok(O.indicesAreValid(after));
});

// ---- ordering -----------------------------------------------------------

check("order comes from the index, not the array position", () => {
  const s = O.syncIndices([it("a"), it("b"), it("c")]);
  const shuffled = [s[2], s[0], s[1]];
  assert.deepEqual(ids(O.ordered(shuffled)), ["a", "b", "c"]);
});

check("an already-sorted array is returned untouched", () => {
  const s = O.syncIndices([it("a"), it("b")]);
  assert.equal(O.ordered(s), s, "the common case must cost nothing");
});

check("equal indices are broken by id, so two machines agree", () => {
  const tie = [it("z", "a0"), it("b", "a0")];
  assert.deepEqual(ids(O.ordered(tie)), ["b", "z"]);
});

// ---- reordering ---------------------------------------------------------

check("bring to front and send to back do what they say", () => {
  const s = O.syncIndices([it("a"), it("b"), it("c")]);
  assert.deepEqual(ids(O.ordered(O.reorder(s, new Set(["a"]), "front"))), ["b", "c", "a"]);
  assert.deepEqual(ids(O.ordered(O.reorder(s, new Set(["c"]), "back"))), ["c", "a", "b"]);
});

check("moving several keeps their order among themselves", () => {
  const s = O.syncIndices([it("a"), it("b"), it("c"), it("d")]);
  const r = O.ordered(O.reorder(s, new Set(["a", "c"]), "front"));
  assert.deepEqual(ids(r), ["b", "d", "a", "c"]);
});

check("a reorder touches only the items that moved", () => {
  const s = O.syncIndices([it("a"), it("b"), it("c")]);
  const r = O.reorder(s, new Set(["a"]), "front");
  const byId = Object.fromEntries(r.map((x) => [x.id, x.index]));
  assert.equal(byId.b, s[1].index, "b must keep its index");
  assert.equal(byId.c, s[2].index, "c must keep its index");
  assert.notEqual(byId.a, s[0].index);
});

check("reordering everything, or nothing, is safe", () => {
  const s = O.syncIndices([it("a"), it("b")]);
  assert.deepEqual(ids(O.reorder(s, new Set(), "front")), ["a", "b"]);
  assert.deepEqual(ids(O.reorder(s, new Set(["a", "b"]), "front")), ["a", "b"]);
});

// ---- new items ----------------------------------------------------------

check("a new item lands on top", () => {
  const s = O.syncIndices([it("a"), it("b")]);
  const fresh = { ...it("new"), index: O.indexOnTop(s) };
  assert.deepEqual(ids(O.ordered([...s, fresh])), ["a", "b", "new"]);
});

check("the first item on an empty board gets a valid index", () => {
  const i = O.indexOnTop([]);
  assert.ok(typeof i === "string" && i.length > 0);
});

// ---- the point of all this ----------------------------------------------

check("two people reordering different items converge", () => {
  // This is the case array order could not survive: each side saves only the
  // items it touched, and the merge is a union — no list to reconcile.
  const base = O.syncIndices([it("a"), it("b"), it("c"), it("d")]);
  const mine = O.reorder(base, new Set(["a"]), "front");
  const theirs = O.reorder(base, new Set(["d"]), "back");

  // Each side contributes only the items it actually changed, judged against
  // the shared base — the same shape as the append-only annotation merge.
  const wasAt = new Map(base.map((x) => [x.id, x.index]));
  const merged = new Map(base.map((x) => [x.id, x]));
  for (const side of [mine, theirs]) {
    for (const x of side) if (x.index !== wasAt.get(x.id)) merged.set(x.id, x);
  }

  const result = ids(O.ordered([...merged.values()]));
  assert.deepEqual(result, ["d", "b", "c", "a"], "both intentions survive");
});

check("many reorders in a row stay valid and do not explode in length", () => {
  let s = O.syncIndices(Array.from({ length: 12 }, (_, n) => it(`i${n}`)));
  for (let n = 0; n < 60; n++) {
    s = O.reorder(s, new Set([`i${n % 12}`]), n % 2 ? "front" : "back");
    assert.ok(O.indicesAreValid(O.ordered(s)), `invalid after ${n + 1} reorders`);
  }
  const longest = Math.max(...s.map((x) => x.index.length));
  assert.ok(longest < 30, `indices grew to ${longest} chars`);
});

console.log(`\n${passed} order checks passed`);
