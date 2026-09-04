// Vendor the runtime data files our libraries would otherwise fetch from a CDN.
//
// Research Canvas is meant to work with no network at all, so nothing may be
// downloaded while the app is running. Two libraries expect otherwise:
//
//   pdf.js       loads standard_fonts/ (the Base-14 fonts — without them any
//                PDF using Helvetica renders blank) and cmaps/ (CJK encodings).
//   tesseract.js loads its worker, its wasm core, and a language model.
//
// All of it is copied into public/ before every dev run and build. The language
// model is the one file not shipped in any npm package, so it is fetched once
// and cached in node_modules/.cache. That single download is the only moment a
// build needs the network; the app itself never does.

import { cp, mkdir, rm, stat, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = resolve(root, "public");
const exists = async (p) => !!(await stat(p).catch(() => null));

async function need(pkg) {
  const dir = resolve(root, "node_modules", pkg);
  if (!(await exists(dir))) {
    console.error(`${pkg} is not installed — run \`npm install\` first.`);
    process.exit(1);
  }
  return dir;
}

// ---- pdf.js -------------------------------------------------------------
{
  const from = await need("pdfjs-dist");
  const to = resolve(pub, "pdfjs");
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const dir of ["standard_fonts", "cmaps"]) {
    await cp(resolve(from, dir), resolve(to, dir), { recursive: true });
  }
  console.log("pdf.js fonts + cmaps → public/pdfjs/");
}

// ---- tesseract.js -------------------------------------------------------
{
  const js = await need("tesseract.js");
  const core = await need("tesseract.js-core");
  const to = resolve(pub, "tesseract");
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });

  await cp(resolve(js, "dist/worker.min.js"), resolve(to, "worker.min.js"));

  // Only the `-lstm` cores, and only the `.wasm.js` builds:
  //   * LSTM is the recognition engine modern Tesseract actually uses; the
  //     legacy cores are ~1MB larger each and are never selected.
  //   * `.wasm.js` embeds the binary, so the sibling `.wasm` files are dead
  //     weight — shipping all eight variants cost 37MB for no benefit.
  //
  // All THREE instruction-set variants are required. tesseract.js probes the
  // engine and asks for whichever it supports; ship the wrong subset and it
  // fails with a bare importScripts NetworkError from inside a worker, which
  // is close to undiagnosable. Chrome picks relaxedsimd — omitting it broke
  // OCR entirely, and the browser test is what caught it.
  const CORES = [
    "tesseract-core-relaxedsimd-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-lstm.wasm.js",
  ];
  for (const f of CORES) {
    if (await exists(resolve(core, f))) await cp(resolve(core, f), resolve(to, f));
    else console.error(`warning: ${f} missing from tesseract.js-core — OCR may not start`);
  }

  // The language model. tessdata_fast is a fraction of the size of the full
  // model and plenty for reading a scanned document.
  const MODEL = "eng.traineddata";
  const URL_ = `https://github.com/tesseract-ocr/tessdata_fast/raw/main/${MODEL}`;
  const cacheDir = resolve(root, "node_modules/.cache/research-canvas");
  const cached = resolve(cacheDir, MODEL);

  if (!(await exists(cached))) {
    console.log(`fetching ${MODEL} (one time, then cached)…`);
    const res = await fetch(URL_).catch((e) => {
      console.error(`could not download ${MODEL}: ${e.message}`);
      console.error("OCR of scanned PDFs will be unavailable; everything else still builds.");
      return null;
    });
    if (res?.ok) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cached, Buffer.from(await res.arrayBuffer()));
    } else if (res) {
      console.error(`could not download ${MODEL}: HTTP ${res.status}`);
    }
  }

  if (await exists(cached)) {
    await writeFile(resolve(to, MODEL), await readFile(cached));
    console.log("tesseract worker + core + eng model → public/tesseract/");
  } else {
    // Leave a marker so the app can say why OCR is missing instead of failing.
    await writeFile(resolve(to, "MISSING_MODEL"), "eng.traineddata was not downloaded\n");
    console.log("tesseract worker + core → public/tesseract/ (no language model)");
  }
}
