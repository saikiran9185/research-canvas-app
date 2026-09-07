// What did you just paste?
//
// A canvas that only accepts files you dragged in is missing the way research
// actually arrives: you find something in a browser, you copy it, and you want
// it on the board. That is an image, a link, a video URL, or a line of text —
// and the board should work out which without being told.
//
// Kept free of React and the DOM so the decision can be tested, which is the
// half of this that is easy to get subtly wrong.

export type Pasted =
  | { kind: "files"; files: File[] }
  | { kind: "link"; url: string; label: string }
  | { kind: "text"; text: string }
  | { kind: "nothing" };

/** Hosts whose links are worth recognising as media rather than as pages. */
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com)$/i;

/** A URL we are willing to put on a board. */
export function asUrl(text: string): URL | null {
  const trimmed = text.trim();
  // A single token only: a paragraph that happens to contain a link is prose,
  // and turning it into a link card would lose the rest of it.
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    // Anything but http(s) is either useless on a board or actively unsafe to
    // make one click away — javascript:, file:, data: included.
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** True when a link points at something that plays rather than something that
 *  reads — used to label the card, not to embed anything. */
export function isVideoUrl(u: URL): boolean {
  return VIDEO_HOSTS.test(u.hostname) || /\.(mp4|webm|mov|m4v)$/i.test(u.pathname);
}

/**
 * A short, readable name for a link.
 *
 * The whole URL is unreadable on a card and the domain alone loses which page
 * it was, so this keeps the host plus the last meaningful path segment.
 */
export function labelForUrl(u: URL): string {
  const host = u.hostname.replace(/^www\./, "");
  const seg = u.pathname.split("/").filter(Boolean).pop();
  if (!seg) return host;
  const cleaned = decodeURIComponent(seg)
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 60) return host;
  return `${host} · ${cleaned}`;
}

/**
 * Classify a paste.
 *
 * Files win over text because a browser puts BOTH on the clipboard when you
 * copy an image — the bitmap and its source URL. The bitmap is what you meant;
 * taking the text instead is how a pasted screenshot becomes a link to it.
 */
export function classifyPaste(
  files: readonly File[],
  text: string,
  accept: (name: string) => boolean,
): Pasted {
  const usable = files.filter((f) => accept(f.name) || f.type.startsWith("image/"));
  if (usable.length) return { kind: "files", files: usable };

  const url = asUrl(text);
  if (url) return { kind: "link", url: url.href, label: labelForUrl(url) };

  const trimmed = text.replace(/\s+$/, "");
  return trimmed ? { kind: "text", text: trimmed } : { kind: "nothing" };
}

/** A pasted image arrives with no name; give it one that sorts by when. */
export function nameForPastedImage(type: string, at = new Date()): string {
  const ext = (type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const p = (n: number) => String(n).padStart(2, "0");
  return `Pasted ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} `
       + `${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}.${ext}`;
}

// ---- youtube ------------------------------------------------------------

/**
 * The video id inside a YouTube URL, or null.
 *
 * YouTube has accumulated a lot of shapes over the years — youtu.be short
 * links, /watch?v=, /embed/, /shorts/, /live/ — and a research board collects
 * links from all of them, so recognising only the canonical one would leave
 * most pastes as plain cards for no reason a person could see.
 */
export function youtubeId(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const ok = (id: string | undefined | null) =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;

  if (host === "youtu.be") return ok(u.pathname.slice(1).split("/")[0]);
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  if (u.pathname === "/watch") return ok(u.searchParams.get("v"));
  const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
  return m ? ok(m[2]) : null;
}

/** Where a link says to start, in whole seconds. `?t=1m30s` and `?t=90` both
 *  appear in the wild, and a timestamped link is usually timestamped on
 *  purpose — losing it loses the reason it was saved. */
export function youtubeStart(raw: string): number {
  let u: URL;
  try { u = new URL(raw); } catch { return 0; }
  const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? u.hash.match(/[?&]t=([^&]+)/)?.[1];
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * The embed address for a video.
 *
 * youtube-nocookie.com deliberately: a research board should not be dropping
 * tracking cookies for every clip someone pinned to it. `origin` is omitted
 * because the app is not served from a web origin the player would accept.
 */
export function youtubeEmbed(id: string, start = 0): string {
  const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
  if (start > 0) params.set("start", String(start));
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}
