// Verifies the conflict-free merge: the guarantee that two people editing the
// same board out of a synced folder converge on the same notes.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Transpile the TS source with esbuild (vite already ships it) and import it,
// so the test exercises the real shipped function, not a copy.
const tmp = mkdtempSync(join(tmpdir(), "rc-test-"));
const src = readFileSync("src/annotations.ts", "utf8")
  // The tauri invoke import cannot resolve under plain node; the function under
  // test is pure and never calls it.
  .replace('import { invoke } from "@tauri-apps/api/core";', "const invoke = async () => { throw new Error('not used'); };")
  .replace('import type { Annotation } from "./types";', "")
  .replace('import { uid } from "./types";', "const uid = () => Math.random().toString(36).slice(2);");
const tsFile = join(tmp, "annotations.ts");
writeFileSync(tsFile, src);
const outFile = join(tmp, "annotations.mjs");
execSync(`npx esbuild ${tsFile} --format=esm --loader:.ts=ts --outfile=${outFile}`, { stdio: "pipe" });
const { mergeAnnotationFiles } = await import(outFile);

const line = (o) => JSON.stringify(o);
const base = { anchor: { itemId: "v1", x: 0, y: 0, w: 0, h: 0 }, color: "#000" };

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };

check("keeps notes from every author", () => {
  const saikiran = [line({ ...base, id: "a", authorId: "s", author: "Saikiran", createdAt: 1, updatedAt: 1, text: "mine" })].join("\n");
  const nanki = [line({ ...base, id: "b", authorId: "n", author: "Nanki", createdAt: 2, updatedAt: 2, text: "theirs" })].join("\n");
  const out = mergeAnnotationFiles([saikiran, nanki]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((a) => a.text), ["mine", "theirs"]);
});

check("an edit supersedes the earlier line with the same id", () => {
  const f = [
    line({ ...base, id: "a", authorId: "s", author: "S", createdAt: 1, updatedAt: 1, text: "first" }),
    line({ ...base, id: "a", authorId: "s", author: "S", createdAt: 1, updatedAt: 9, text: "corrected" }),
  ].join("\n");
  const out = mergeAnnotationFiles([f]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "corrected");
});

check("a tombstone removes the note", () => {
  const f = [
    line({ ...base, id: "a", authorId: "s", author: "S", createdAt: 1, updatedAt: 1, text: "oops" }),
    line({ ...base, id: "a", authorId: "s", author: "S", createdAt: 1, updatedAt: 5, text: "oops", deleted: true }),
  ].join("\n");
  assert.equal(mergeAnnotationFiles([f]).length, 0);
});

check("file order does not change the result (convergence)", () => {
  const a = line({ ...base, id: "x", authorId: "s", author: "S", createdAt: 3, updatedAt: 3, text: "A" });
  const b = line({ ...base, id: "y", authorId: "n", author: "N", createdAt: 1, updatedAt: 1, text: "B" });
  const c = line({ ...base, id: "z", authorId: "k", author: "K", createdAt: 2, updatedAt: 2, text: "C" });
  const one = mergeAnnotationFiles([a, b, c]).map((x) => x.id);
  const two = mergeAnnotationFiles([c, a, b]).map((x) => x.id);
  const three = mergeAnnotationFiles([b, c, a]).map((x) => x.id);
  assert.deepEqual(one, two);
  assert.deepEqual(two, three);
  assert.deepEqual(one, ["y", "z", "x"]); // sorted by createdAt
});

check("a same-millisecond clash resolves identically on both machines", () => {
  const s = line({ ...base, id: "a", authorId: "aaa", author: "A", createdAt: 1, updatedAt: 7, text: "from-aaa" });
  const n = line({ ...base, id: "a", authorId: "zzz", author: "Z", createdAt: 1, updatedAt: 7, text: "from-zzz" });
  assert.equal(mergeAnnotationFiles([s, n])[0].text, "from-zzz");
  assert.equal(mergeAnnotationFiles([n, s])[0].text, "from-zzz");
});

check("a torn line from an interrupted sync does not lose the rest", () => {
  const f = [
    line({ ...base, id: "a", authorId: "s", author: "S", createdAt: 1, updatedAt: 1, text: "good" }),
    '{"id":"b","authorId":"s","createdAt":2,"text":"trunc',
    line({ ...base, id: "c", authorId: "s", author: "S", createdAt: 3, updatedAt: 3, text: "also good" }),
  ].join("\n");
  const out = mergeAnnotationFiles([f]);
  assert.deepEqual(out.map((a) => a.text), ["good", "also good"]);
});

check("blank files and blank lines are harmless", () => {
  assert.equal(mergeAnnotationFiles(["", "\n\n", "  \n"]).length, 0);
});

console.log(`\n${passed} merge tests passed`);
