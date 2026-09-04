// pdf.js loads two sets of data files at runtime rather than bundling them:
//
//   standard_fonts/  the Base-14 fonts (Helvetica, Times, Courier…). Without
//                    these, any PDF that relies on a standard font renders blank.
//   cmaps/           character maps for CJK and other non-Latin encodings.
//
// A local-first app must not fetch those from a CDN, so we copy them out of
// node_modules into public/ before every dev run and build. They are generated,
// so they stay out of git — this script rebuilds them from the dependency.

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "node_modules/pdfjs-dist");
const to = resolve(root, "public/pdfjs");

const exists = async (p) => !!(await stat(p).catch(() => null));

if (!(await exists(from))) {
  console.error("pdfjs-dist is not installed — run `npm install` first.");
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const dir of ["standard_fonts", "cmaps"]) {
  await cp(resolve(from, dir), resolve(to, dir), { recursive: true });
}
console.log("pdf.js assets synced to public/pdfjs/");
