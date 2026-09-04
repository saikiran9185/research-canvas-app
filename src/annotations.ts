// The annotation layer: comments pinned to a moment or a region in a medium.
//
// Storage rules, and why they are what they are:
//
//   * Each author writes ONE file and only that file. Two people sharing a
//     board folder (Syncthing / git / Dropbox / a USB stick) therefore never
//     write the same bytes, so there is nothing to merge and nothing to lose.
//   * Files are append-only JSONL. An edit or a delete is a new line carrying
//     the same `id`; whichever line has the newest `updatedAt` wins. That makes
//     the format replayable and makes a future sync server trivial — it only
//     ever has to relay lines.
//   * Reading a board = read every *.jsonl in its comments folder, replay them
//     in timestamp order, drop the tombstones.

import { invoke } from "@tauri-apps/api/core";
import type { Annotation } from "./types";
import { uid } from "./types";

// --- who am I ------------------------------------------------------------
// Identity is local and self-declared. No account, no server, no company.

const ID_KEY = "rc.identity";

export interface Identity {
  id: string;
  name: string;
  color: string;
}

const AUTHOR_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

export function getIdentity(): Identity {
  try {
    const raw = localStorage.getItem(ID_KEY);
    if (raw) return JSON.parse(raw) as Identity;
  } catch {
    /* first run, or storage unavailable */
  }
  const id = uid();
  const fresh: Identity = {
    id,
    name: "Me",
    color: AUTHOR_COLORS[Math.floor(Math.random() * AUTHOR_COLORS.length)],
  };
  saveIdentity(fresh);
  return fresh;
}

export function saveIdentity(i: Identity) {
  try {
    localStorage.setItem(ID_KEY, JSON.stringify(i));
  } catch {
    /* non-fatal: the session still works, the name just won't stick */
  }
}

/** A stable colour for anyone else's comments, derived from their id. */
export function colorForAuthor(authorId: string): string {
  let h = 0;
  for (let i = 0; i < authorId.length; i++) h = (h * 31 + authorId.charCodeAt(i)) >>> 0;
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
}

// --- disk ----------------------------------------------------------------

export async function commentsDir(canvasPath: string): Promise<string> {
  return invoke<string>("comments_dir", { canvasPath });
}

function myFile(dir: string, authorId: string): string {
  return `${dir}/${authorId}.jsonl`;
}

/**
 * Replay a set of author files into the board's current annotations.
 *
 * This is the whole merge algorithm, and it is deliberately tiny: group every
 * line by `id`, keep the one with the newest `updatedAt`, drop tombstones.
 * Because it depends only on the lines — never on which file they came from or
 * what order the files arrived in — two people syncing a folder converge on the
 * same result no matter who writes when. Ties break on authorId so that even a
 * same-millisecond clash resolves identically on both machines.
 *
 * Pure and side-effect free, so it can be tested without a filesystem.
 */
export function mergeAnnotationFiles(fileContents: string[]): Annotation[] {
  const byId = new Map<string, Annotation>();

  for (const text of fileContents) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let a: Annotation;
      try {
        a = JSON.parse(trimmed) as Annotation;
      } catch {
        continue; // a torn line from an interrupted sync — skip it, keep the rest
      }
      if (!a || typeof a.id !== "string" || !a.id) continue;
      const prev = byId.get(a.id);
      if (!prev) { byId.set(a.id, a); continue; }
      const at = a.updatedAt ?? 0;
      const pt = prev.updatedAt ?? 0;
      if (at > pt || (at === pt && (a.authorId ?? "") > (prev.authorId ?? ""))) {
        byId.set(a.id, a);
      }
    }
  }

  return [...byId.values()]
    .filter((a) => !a.deleted)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Load every author's annotations for a board and replay them. */
export async function loadAnnotations(canvasPath: string): Promise<Annotation[]> {
  const dir = await commentsDir(canvasPath);
  const files = await invoke<string[]>("list_comment_files", { dir });
  const contents: string[] = [];
  for (const f of files) {
    contents.push(await invoke<string>("read_file_or_empty", { path: f }));
  }
  return mergeAnnotationFiles(contents);
}

/** Append one annotation (new, edited, or tombstoned) to the author's own file. */
export async function appendAnnotation(canvasPath: string, a: Annotation): Promise<void> {
  const dir = await commentsDir(canvasPath);
  await invoke<void>("append_line", {
    path: myFile(dir, a.authorId),
    line: JSON.stringify(a),
  });
}

/** Newest mtime across every author file — cheap "did anything sync in?" probe. */
export async function annotationsMtime(canvasPath: string): Promise<number> {
  const dir = await commentsDir(canvasPath);
  const files = await invoke<string[]>("list_comment_files", { dir });
  let newest = 0;
  for (const f of files) {
    const m = await invoke<number>("file_mtime", { path: f });
    if (m > newest) newest = m;
  }
  return newest;
}

/**
 * Squash the current author's file down to one line per live annotation.
 * Only ever touches this author's file, so it stays conflict-free.
 */
export async function compactMine(canvasPath: string, authorId: string, all: Annotation[]) {
  const dir = await commentsDir(canvasPath);
  const mine = all.filter((a) => a.authorId === authorId && !a.deleted);
  await invoke<void>("rewrite_lines", {
    path: myFile(dir, authorId),
    lines: mine.map((a) => JSON.stringify(a)),
  });
}

// --- factory -------------------------------------------------------------

export function newAnnotation(
  me: Identity,
  anchor: Annotation["anchor"],
  text = "",
  extra: Partial<Annotation> = {},
): Annotation {
  const now = Date.now();
  return {
    id: uid(),
    authorId: me.id,
    author: me.name,
    createdAt: now,
    updatedAt: now,
    text,
    color: me.color,
    anchor,
    ...extra,
  };
}

// --- export --------------------------------------------------------------

/**
 * All annotations on a board as Markdown — the thing you paste into a thesis,
 * mail to a supervisor, or commit next to the board.
 */
export function toMarkdown(
  boardName: string,
  annotations: Annotation[],
  labelFor: (a: Annotation) => string,
): string {
  const lines: string[] = [`# ${boardName} — notes`, ""];
  lines.push(`_${annotations.length} annotation${annotations.length === 1 ? "" : "s"}, exported ${new Date().toLocaleString()}_`, "");

  const groups = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const key = a.anchor.itemId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  for (const [, list] of groups) {
    lines.push(`## ${labelFor(list[0]).split(" · ")[0]}`, "");
    for (const a of list) {
      const where = labelFor(a).split(" · ").slice(1).join(" · ");
      lines.push(`- **${a.author}**${where ? ` (${where})` : ""}${a.resolved ? " ✓" : ""}`);
      for (const l of (a.text || "_no text_").split("\n")) lines.push(`  ${l}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
