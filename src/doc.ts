// Reading word-processor and plain-text documents.
//
// .docx is a zip of XML, which mammoth converts to clean HTML in the browser —
// no server, no Word, no conversion service. Plain text and Markdown are read
// straight through. The legacy binary .doc format has no browser-side reader,
// so it imports as a file card you can still pin notes to.

import { storage } from "./storage";

export interface DocContent {
  /** Sanitised-enough HTML for display. */
  html: string;
  /** True when this is a real rendering rather than a "cannot read" notice. */
  readable: boolean;
}

const cache = new Map<string, Promise<DocContent>>();

function ext(path: string): string {
  return path.toLowerCase().split(".").pop() || "";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Very small Markdown subset — headings, bold, italic, code, lists, links. */
function markdownToHtml(src: string): string {
  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (!line) { out.push(""); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");

  function inline(t: string): string {
    return t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<span class=\"doc-link\">$1</span>");
  }
}

export function loadDoc(path: string): Promise<DocContent> {
  let p = cache.get(path);
  if (!p) {
    p = read(path);
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

async function read(path: string): Promise<DocContent> {
  const e = ext(path);

  if (e === "docx") {
    // Loaded on demand — mammoth is only needed when a Word file is opened.
    const mammoth = await import("mammoth/mammoth.browser.js");
    const bytes = await storage.readBytes(path);
    const result = await (mammoth as any).convertToHtml({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    return { html: result.value || "<p><em>This document is empty.</em></p>", readable: true };
  }

  if (e === "txt" || e === "md" || e === "markdown" || e === "rtf") {
    const text = await storage.readText(path);
    if (e === "md" || e === "markdown") return { html: markdownToHtml(text), readable: true };
    if (e === "rtf") return { html: `<pre>${escapeHtml(stripRtf(text))}</pre>`, readable: true };
    return { html: `<pre>${escapeHtml(text)}</pre>`, readable: true };
  }

  // Legacy binary .doc — nothing in the browser can read it faithfully.
  return {
    html:
      "<p><strong>This is a legacy <code>.doc</code> file.</strong></p>" +
      "<p>Nothing in the app can render it faithfully. Save it as <code>.docx</code> " +
      "or <code>.pdf</code> and re-import to read and highlight it here. " +
      "You can still pin notes to this card in the meantime.</p>",
    readable: false,
  };
}

/** Crude RTF de-fanging: enough to read the words, not to preserve layout. */
function stripRtf(rtf: string): string {
  return rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
