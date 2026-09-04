// Build the app and put it straight into /Applications.
//
// Exists because the alternative is a manual ritual after every change: open
// the bundle folder, drag the .app across, confirm the replace, dismiss
// Gatekeeper. One command instead.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = "Research Canvas.app";
const built = resolve(root, "src-tauri/target/release/bundle/macos", APP);
const installed = `/Applications/${APP}`;

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", cwd: root, ...opts });
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); } catch { /* best effort */ } };

console.log("→ closing any running copy");
quiet(`pkill -f ${JSON.stringify(installed)}`);

// A DMG left mounted from an earlier build makes bundling fail. Detach ours.
try {
  const info = execSync("hdiutil info", { encoding: "utf8" });
  for (const line of info.split("\n")) {
    const m = /^(\/dev\/disk\d+)\s/.exec(line);
    if (m && info.includes("Research Canvas")) quiet(`hdiutil detach ${m[1]} -force`);
  }
} catch { /* hdiutil not available or nothing mounted */ }

console.log("→ building (this takes a couple of minutes the first time)");
// tauri build exits non-zero when it cannot sign the updater artifact, which
// needs a private key only releases have. The .app itself is still produced,
// so judge success by whether the bundle exists.
spawnSync("npm", ["run", "tauri", "build"], { stdio: "inherit", cwd: root });

if (!existsSync(built)) {
  console.error(`\n✗ build did not produce ${APP} — see the output above`);
  process.exit(1);
}

console.log("→ installing to /Applications");
rmSync(installed, { recursive: true, force: true });
cpSync(built, installed, { recursive: true });

// Ad-hoc signature + clear quarantine so macOS opens it without a warning.
quiet(`codesign --force --deep --sign - ${JSON.stringify(installed)}`);
quiet(`xattr -dr com.apple.quarantine ${JSON.stringify(installed)}`);

if (!process.argv.includes("--no-open")) {
  console.log("→ launching");
  run(`open -a ${JSON.stringify(installed)}`);
}
console.log(`\n✓ ${APP} installed. No dragging required.`);
