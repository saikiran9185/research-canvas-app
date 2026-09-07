// What the board makes of what you pasted.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const tmp = mkdtempSync(join(process.cwd(), "node_modules", ".rc-paste-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const ts = join(tmp, "paste.ts");
writeFileSync(ts, readFileSync("src/paste.ts", "utf8"));
const out = join(tmp, "paste.mjs");
execSync(`npx esbuild ${ts} --format=esm --loader:.ts=ts --outfile=${out}`, { stdio: "pipe" });
const P = await import(out);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const file = (name, type = "") => ({ name, type });
const accept = (n) => /\.(png|jpe?g|gif|webp|mp4|mov|mp3|wav|pdf)$/i.test(n);

// ---- urls ---------------------------------------------------------------

check("a bare http(s) link is a link", () => {
  assert.ok(P.asUrl("https://example.com/a"));
  assert.ok(P.asUrl("http://example.com"));
});

check("prose containing a link is prose, not a link", () => {
  // Turning it into a link card would throw away everything around it.
  assert.equal(P.asUrl("see https://example.com for more"), null);
});

check("dangerous and useless schemes are refused", () => {
  // A board must never make javascript: or file: one click away.
  for (const s of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "vbscript:x"]) {
    assert.equal(P.asUrl(s), null, `${s} must not become a link`);
  }
});

check("nonsense is not a url", () => {
  assert.equal(P.asUrl("hello"), null);
  assert.equal(P.asUrl(""), null);
  assert.equal(P.asUrl("   "), null);
});

check("surrounding whitespace is forgiven", () => {
  assert.ok(P.asUrl("  https://example.com  "));
});

// ---- labels -------------------------------------------------------------

check("a link is labelled by host and page, not by its whole url", () => {
  assert.equal(P.labelForUrl(new URL("https://www.example.com/some-long-page.html")),
               "example.com · some long page");
});

check("a bare domain is labelled by the domain", () => {
  assert.equal(P.labelForUrl(new URL("https://example.com/")), "example.com");
});

check("an unreadable slug falls back to the host", () => {
  const u = new URL("https://example.com/" + "x".repeat(80));
  assert.equal(P.labelForUrl(u), "example.com");
});

check("video links are recognised", () => {
  assert.ok(P.isVideoUrl(new URL("https://youtu.be/abc")));
  assert.ok(P.isVideoUrl(new URL("https://www.youtube.com/watch?v=abc")));
  assert.ok(P.isVideoUrl(new URL("https://vimeo.com/123")));
  assert.ok(P.isVideoUrl(new URL("https://cdn.example.com/clip.mp4")));
  assert.ok(!P.isVideoUrl(new URL("https://example.com/article")));
});

// ---- classification -----------------------------------------------------

check("an image beats the url that came with it", () => {
  // Copying an image in a browser puts BOTH on the clipboard. The bitmap is
  // what you meant; taking the text turns a pasted screenshot into a link.
  const r = P.classifyPaste([file("shot.png", "image/png")], "https://example.com/shot.png", accept);
  assert.equal(r.kind, "files");
  assert.equal(r.files.length, 1);
});

check("an image with no name is still accepted on its type", () => {
  const r = P.classifyPaste([file("", "image/png")], "", accept);
  assert.equal(r.kind, "files");
});

check("a file the board cannot use is ignored", () => {
  const r = P.classifyPaste([file("thing.exe", "application/x-msdownload")], "hello", accept);
  assert.equal(r.kind, "text");
});

check("a lone url becomes a link", () => {
  const r = P.classifyPaste([], "https://example.com/page", accept);
  assert.equal(r.kind, "link");
  assert.equal(r.url, "https://example.com/page");
  assert.ok(r.label.includes("example.com"));
});

check("ordinary text becomes text", () => {
  assert.deepEqual(P.classifyPaste([], "some notes", accept), { kind: "text", text: "some notes" });
});

check("an empty clipboard does nothing at all", () => {
  assert.equal(P.classifyPaste([], "", accept).kind, "nothing");
  assert.equal(P.classifyPaste([], "   \n ", accept).kind, "nothing");
});

// ---- naming -------------------------------------------------------------

check("a pasted image gets a name that sorts by when", () => {
  const n = P.nameForPastedImage("image/png", new Date(2026, 8, 7, 14, 5, 9));
  assert.equal(n, "Pasted 2026-09-07 14.05.09.png");
});

check("a strange mime type cannot produce a strange filename", () => {
  const n = P.nameForPastedImage("image/../../evil");
  assert.ok(!n.includes("/") && !n.includes(".."), n);
});

// ---- youtube ------------------------------------------------------------

check("every shape of YouTube link is recognised", () => {
  const id = "dQw4w9WgXcQ";
  for (const u of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&list=PL123`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
  ]) assert.equal(P.youtubeId(u), id, u);
});

check("things that are not YouTube are not YouTube", () => {
  for (const u of ["https://vimeo.com/123", "https://example.com/watch?v=dQw4w9WgXcQ", "not a url"]) {
    assert.equal(P.youtubeId(u), null, u);
  }
});

check("a malformed id is refused rather than embedded", () => {
  // An id is exactly 11 characters of a known alphabet; anything else would
  // be putting an arbitrary path into an iframe URL.
  assert.equal(P.youtubeId("https://youtu.be/short"), null);
  assert.equal(P.youtubeId("https://youtu.be/../../evil"), null);
  assert.equal(P.youtubeId("https://www.youtube.com/watch?v=" + "x".repeat(40)), null);
});

check("a timestamp survives the paste", () => {
  // A timestamped link is timestamped on purpose; losing it loses the reason
  // it was saved.
  assert.equal(P.youtubeStart("https://youtu.be/dQw4w9WgXcQ?t=90"), 90);
  assert.equal(P.youtubeStart("https://youtu.be/dQw4w9WgXcQ?t=1m30s"), 90);
  assert.equal(P.youtubeStart("https://youtu.be/dQw4w9WgXcQ?t=1h2m3s"), 3723);
  assert.equal(P.youtubeStart("https://youtu.be/dQw4w9WgXcQ"), 0);
  assert.equal(P.youtubeStart("https://youtu.be/x?t=garbage"), 0);
});

check("the embed is cookie-free and starts where it was told", () => {
  const e = P.youtubeEmbed("dQw4w9WgXcQ", 90);
  assert.ok(e.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?"),
            "a board should not drop tracking cookies for every clip pinned to it");
  assert.ok(e.includes("start=90"));
  assert.ok(!P.youtubeEmbed("dQw4w9WgXcQ", 0).includes("start="));
});

console.log(`\n${passed} paste checks passed`);
