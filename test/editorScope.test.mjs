// Who owns the keyboard.
//
// The bug this exists to prevent: an editor opens, focus does not land on it,
// and four global shortcut listeners each conclude from `event.target` that
// the keyboard is free — so typing "n" into a text box switches the tool to
// Sticky Note instead of typing an n.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const tmp = mkdtempSync(join(process.cwd(), "node_modules", ".rc-scope-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const ts = join(tmp, "editorScope.ts");
writeFileSync(ts, readFileSync("src/editorScope.ts", "utf8"));
const out = join(tmp, "editorScope.mjs");
execSync(`npx esbuild ${ts} --format=esm --loader:.ts=ts --outfile=${out}`, { stdio: "pipe" });
const S = await import(out);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const ev = (tag, editable = false) => ({ target: { tagName: tag, isContentEditable: editable } });

check("with nothing open, shortcuts run", () => {
  assert.ok(S.shortcutsAllowed(ev("DIV")));
  assert.ok(!S.keyboardIsClaimed());
});

check("an open editor stops shortcuts even when focus never arrived", () => {
  // This is the whole point: the event target says DIV, because focus is still
  // on the board. The claim is what saves it.
  const release = S.claimKeyboard();
  assert.ok(!S.shortcutsAllowed(ev("DIV")), "a claimed keyboard blocks shortcuts");
  release();
  assert.ok(S.shortcutsAllowed(ev("DIV")));
});

check("a focused field still blocks shortcuts with no claim", () => {
  // The old check kept as a second line of defence, for fields nobody claims
  // for — a rename prompt, a search box.
  assert.ok(!S.shortcutsAllowed(ev("TEXTAREA")));
  assert.ok(!S.shortcutsAllowed(ev("INPUT")));
  assert.ok(!S.shortcutsAllowed(ev("DIV", true)), "contenteditable counts");
});

check("two editors open at once both have to close", () => {
  const a = S.claimKeyboard();
  const b = S.claimKeyboard();
  a();
  assert.ok(!S.shortcutsAllowed(ev("DIV")), "one still holds it");
  b();
  assert.ok(S.shortcutsAllowed(ev("DIV")));
});

check("releasing twice cannot unbalance the count", () => {
  const a = S.claimKeyboard();
  const b = S.claimKeyboard();
  a(); a(); a();
  assert.ok(!S.shortcutsAllowed(ev("DIV")), "b still holds the keyboard");
  b();
  assert.ok(S.shortcutsAllowed(ev("DIV")));
});

check("an event with no target does not crash the handler", () => {
  assert.ok(S.shortcutsAllowed({ target: null }));
});

console.log(`\n${passed} keyboard-scope checks passed`);
