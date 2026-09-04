// The library: every board in a folder as a grid of thumbnails.
//
// Thumbnails are rendered from the board files themselves, off the same
// renderer the PDF export uses, so what you see is genuinely the board — not a
// stale screenshot. They are generated lazily, a few at a time, and cached in
// memory so browsing back and forth is instant.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasDoc } from "./types";
import { storage, type DirEntry } from "./storage";
import { renderBoard } from "./render";

interface Props {
  currentDir: string;
  workspace: string;
  entries: DirEntry[];
  onOpenCanvas: (path: string) => void;
  onEnterFolder: (path: string) => void;
  onNewCanvas: () => void;
  onDelete: (e: DirEntry) => void;
  /** Every board in this folder and below, as one PDF. */
  onExportWorkspace: () => void;
  onClose: () => void;
}

/** path -> data URL. Module-level so it survives the panel closing and reopening. */
const thumbs = new Map<string, string>();
/** Boards whose thumbnail could not be made; don't retry them in a loop. */
const failed = new Set<string>();

interface Meta {
  items: number;
  name: string;
}

export default function Library({
  currentDir, workspace, entries, onOpenCanvas, onEnterFolder, onNewCanvas,
  onDelete, onExportWorkspace, onClose,
}: Props) {
  const [, force] = useState(0);
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map());
  const [query, setQuery] = useState("");
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const boards = useMemo(() => entries.filter((e) => !e.is_dir), [entries]);
  const folders = useMemo(() => entries.filter((e) => e.is_dir), [entries]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { folders, boards };
    return {
      folders: folders.filter((f) => f.name.toLowerCase().includes(q)),
      boards: boards.filter((b) => b.name.toLowerCase().includes(q)),
    };
  }, [folders, boards, query]);

  // Render thumbnails one at a time so a folder of heavy boards never locks
  // the UI; each finished thumbnail paints as soon as it is ready.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const b of boards) {
        if (cancelled || !alive.current) return;
        if (thumbs.has(b.path) || failed.has(b.path)) continue;
        try {
          const doc = JSON.parse(await storage.readText(b.path)) as CanvasDoc;
          setMeta((m) => new Map(m).set(b.path, { items: doc.items.length, name: doc.name }));
          if (!doc.items.length) { failed.add(b.path); force((n) => n + 1); continue; }
          const r = await renderBoard(doc, 640, 40);
          if (cancelled || !alive.current) return;
          thumbs.set(b.path, r.canvas.toDataURL("image/jpeg", 0.72));
        } catch {
          failed.add(b.path);
        }
        force((n) => n + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [boards]);

  const rel = currentDir === workspace ? "Home" : currentDir.slice(workspace.length + 1);

  return (
    <div className="library">
      <div className="lib-head">
        <div>
          <h2>{rel}</h2>
          <span className="lib-sub">
            {boards.length} board{boards.length === 1 ? "" : "s"}
            {folders.length ? ` · ${folders.length} folder${folders.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <div className="lib-head-actions">
          <input
            className="cp-search lib-search"
            placeholder="Search boards…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="ghost-btn"
            onClick={onExportWorkspace}
            disabled={!boards.length && !folders.length}
            title="Every board in this folder and below, as one PDF"
          >Export all as PDF</button>
          <button className="cta small" onClick={onNewCanvas}>+ New canvas</button>
          <button className="ghost-btn" onClick={onClose} title="Back to the canvas">✕</button>
        </div>
      </div>

      <div className="lib-grid">
        {shown.folders.map((f) => (
          <button key={f.path} className="lib-card lib-folder" onDoubleClick={() => onEnterFolder(f.path)} onClick={() => onEnterFolder(f.path)}>
            <div className="lib-thumb folder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="lib-name">{f.name}</div>
          </button>
        ))}

        {shown.boards.map((b) => {
          const t = thumbs.get(b.path);
          const m = meta.get(b.path);
          return (
            <div key={b.path} className="lib-card" onDoubleClick={() => onOpenCanvas(b.path)}>
              <button className="lib-thumb" onClick={() => onOpenCanvas(b.path)} title="Open">
                {t
                  ? <img src={t} alt="" draggable={false} />
                  : <span className="lib-thumb-empty">
                      {failed.has(b.path) ? (m && m.items === 0 ? "Empty board" : "No preview") : "…"}
                    </span>}
              </button>
              <div className="lib-name">
                {b.name.replace(/\.canvas$/, "")}
                {m && <span className="lib-count">{m.items} item{m.items === 1 ? "" : "s"}</span>}
              </div>
              <button
                className="lib-del"
                title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete(b); thumbs.delete(b.path); failed.delete(b.path); }}
              >×</button>
            </div>
          );
        })}

        {!shown.boards.length && !shown.folders.length && (
          <div className="lib-empty">
            {query ? `Nothing matches “${query}”.` : "This folder is empty. Create a canvas to begin."}
          </div>
        )}
      </div>
    </div>
  );
}

/** Drop a board's cached thumbnail so it re-renders next time (after an edit). */
export function invalidateThumb(path: string) {
  thumbs.delete(path);
  failed.delete(path);
}
