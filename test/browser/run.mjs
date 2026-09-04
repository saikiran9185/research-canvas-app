// Runs test/browser/textlayer.html in headless Chrome and reports the result.
//
// Why a browser test at all: the PDF text layer is pure layout. pdf.js writes
// the layer's size as `round(down, var(--total-scale-factor) * Npx, ...)` and
// does not define that variable — the embedder must. Get it wrong and the page
// still looks perfect while every text span collapses to zero size, so nothing
// is selectable and nothing throws. Only a real layout engine catches that.
//
// No test framework and no browser-driver dependency: Vite serves, Chrome runs,
// the DevTools protocol reads the result back.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

// Which page to run; both live in this folder.
const PAGE = process.argv[2] ?? "textlayer.html";

const CHROME = process.env.CHROME_PATH
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG = !!process.env.RC_DEBUG;
const log = (...a) => DEBUG && console.error("[run]", ...a);

/** An unused TCP port, so a stray server from an earlier run cannot wedge us. */
const freePort = () => new Promise((resolve, reject) => {
  const srv = createServer();
  srv.on("error", reject);
  srv.listen(0, "127.0.0.1", () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, ms = 20000) {
  const until = Date.now() + ms;
  let lastErr;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}${lastErr ? ` (${lastErr.message})` : ""}`);
}

const PORT = await freePort();
const DEBUG_PORT = await freePort();
// Chrome's debugging endpoint listens on IPv4 only. "localhost" can resolve to
// ::1 first on macOS, which fails with no useful error — always dial 127.0.0.1.
const HOST = "127.0.0.1";
const profile = mkdtempSync(join(tmpdir(), "rc-chrome-"));

let vite, chrome, done = false;

function cleanup() {
  try { chrome?.kill("SIGKILL"); } catch { /* already gone */ }
  try { vite?.kill("SIGKILL"); } catch { /* already gone */ }
  // Chrome writes to its profile as it dies; failing to remove a temp directory
  // must never mask the test result.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { /* the OS reaps it */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const hardStop = setTimeout(() => {
  if (done) return;
  console.error("browser test exceeded 240s — treating as a failure");
  cleanup();
  process.exit(1);
}, 240_000);

/** One Runtime.evaluate over CDP, with its own timeout. */
function evaluate(wsUrl, expression, ms = 10000) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(wsUrl);
    const timer = setTimeout(() => { sock.close(); reject(new Error("CDP evaluate timed out")); }, ms);
    sock.onopen = () => sock.send(JSON.stringify({
      id: 1, method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
    sock.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      sock.close();
      resolve(msg.result?.result?.value);
    };
    sock.onerror = () => { clearTimeout(timer); reject(new Error("CDP socket error")); };
  });
}

try {
  log("vite on", PORT);
  // --host pins Vite to IPv4. Left to itself it binds "localhost", which on
  // macOS can mean ::1 only, and then nothing dialling 127.0.0.1 can reach it —
  // including Chrome.
  vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", HOST],
    { stdio: ["ignore", "pipe", "pipe"] });
  vite.stdout.on("data", (d) => log("vite:", String(d).trim()));
  vite.stderr.on("data", (d) => log("vite!:", String(d).trim()));
  await waitFor("vite", async () => (await fetch(`http://${HOST}:${PORT}/`)).ok);

  log("chrome on", DEBUG_PORT);
  chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--remote-debugging-address=${HOST}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    // Retina: proves the page is rendered above its CSS size rather than soft.
    "--force-device-scale-factor=2",
    "--window-size=1200,1000",
    `http://${HOST}:${PORT}/test/browser/${PAGE}`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stderr.on("data", (d) => log("chrome:", String(d).trim()));
  chrome.on("exit", (code) => log("chrome exited", code));

  const target = await waitFor("the test page", async () => {
    const list = await (await fetch(`http://${HOST}:${DEBUG_PORT}/json/list`)).json();
    return list.find((t) => t.url.includes(PAGE));
  });

  // The page sets window.__done when every assertion has run.
  const report = await waitFor("the assertions", async () => {
    const v = await evaluate(target.webSocketDebuggerUrl,
      "window.__done ? document.getElementById('out').textContent : null");
    return v || null;
  }, 180_000);

  done = true;
  clearTimeout(hardStop);
  console.log(report);
  process.exitCode = /^\s*FAIL/m.test(report) ? 1 : 0;
} catch (e) {
  done = true;
  clearTimeout(hardStop);
  console.error("browser test failed to run:", e.message);
  console.error("re-run with RC_DEBUG=1 for vite and chrome output");
  process.exitCode = 1;
} finally {
  cleanup();
}
