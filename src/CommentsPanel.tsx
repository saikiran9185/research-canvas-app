// Every note on the board, in one list — the "all my evidence in one place"
// view. Grouped by the file it belongs to, filterable, and exportable.

import { useMemo, useState } from "react";
import type { Annotation, CanvasDoc, Item } from "./types";
import { fmtTime } from "./types";
import type { Identity } from "./annotations";

interface Props {
  doc: CanvasDoc;
  annotations: Annotation[];
  me: Identity;
  onOpen: (a: Annotation) => void;
  onUpdate: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
  onExport: (format: "md" | "json" | "csv" | "pdf") => void;
  onClose: () => void;
}

export default function CommentsPanel({
  doc, annotations, me, onOpen, onUpdate, onDelete, onExport, onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [author, setAuthor] = useState<string>("all");

  const itemsById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of doc.items) m.set(i.id, i);
    return m;
  }, [doc.items]);

  const authors = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of annotations) m.set(a.authorId, a.author);
    return [...m.entries()];
  }, [annotations]);

  const filtered = useMemo(() => annotations.filter((a) => {
    if (!showResolved && a.resolved) return false;
    if (author !== "all" && a.authorId !== author) return false;
    if (query) {
      const hay = `${a.text} ${a.author} ${labelOf(itemsById.get(a.anchor.itemId))}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  }), [annotations, showResolved, author, query, itemsById]);

  // Group by the medium each note is pinned to, so a file reads as a unit.
  const groups = useMemo(() => {
    const g = new Map<string, Annotation[]>();
    for (const a of filtered) {
      const k = a.anchor.itemId;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(a);
    }
    for (const list of g.values()) {
      list.sort((x, y) =>
        (x.anchor.page ?? 0) - (y.anchor.page ?? 0) ||
        (x.anchor.time ?? 0) - (y.anchor.time ?? 0) ||
        x.createdAt - y.createdAt);
    }
    return [...g.entries()];
  }, [filtered]);

  const unresolved = annotations.filter((a) => !a.resolved).length;

  return (
    <aside className="comments-panel">
      <div className="cp-head">
        <div>
          <b>Notes</b>
          <span className="cp-count">{unresolved} open · {annotations.length} total</span>
        </div>
        <button className="ghost-btn" onClick={onClose}>✕</button>
      </div>

      <div className="cp-filters">
        <input
          className="cp-search"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="cp-filter-row">
          <select value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="all">Everyone</option>
            {authors.map(([id, name]) => (
              <option key={id} value={id}>{id === me.id ? `${name} (you)` : name}</option>
            ))}
          </select>
          <label className="cp-check">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Resolved
          </label>
        </div>
      </div>

      <div className="cp-list">
        {groups.length === 0 && (
          <p className="rail-empty">
            No notes match. Open any file on the canvas and highlight, pin, or
            scribble on the exact moment you want to talk about.
          </p>
        )}
        {groups.map(([itemId, list]) => {
          const item = itemsById.get(itemId);
          return (
            <div key={itemId} className="cp-group">
              <div className="cp-group-head">
                {item && item.type === "media" && <span className={`kind-chip kind-${item.kind}`}>{item.kind}</span>}
                <span className="cp-group-name">{labelOf(item)}</span>
                <span className="cp-group-count">{list.length}</span>
              </div>
              {list.map((a) => (
                <div key={a.id} className={"cp-item" + (a.resolved ? " resolved" : "")} onClick={() => onOpen(a)}>
                  <div className="cp-item-head">
                    <span className="dot" style={{ background: a.color }} />
                    <b>{a.author}</b>
                    {a.anchor.page !== undefined && <span className="tc">p.{a.anchor.page}</span>}
                    {a.anchor.time !== undefined && <span className="tc">{fmtTime(a.anchor.time)}</span>}
                    <span className="cp-when">{when(a.createdAt)}</span>
                  </div>
                  <div className="cp-item-text">{a.text || <i>(scribble only)</i>}</div>
                  {a.authorId === me.id && (
                    <div className="rail-item-actions">
                      <button onClick={(e) => { e.stopPropagation(); onUpdate({ ...a, resolved: !a.resolved, updatedAt: Date.now() }); }}>
                        {a.resolved ? "Reopen" : "Resolve"}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(a); }}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="cp-foot">
        {/* A PDF is the share-with-anyone format: it opens offline, on any
            machine, with the board and every highlighted frame inside it. */}
        <button className="cta small wide" onClick={() => onExport("pdf")}>
          Export board as PDF
        </button>
        <div className="cp-foot-row">
          <span>Notes only</span>
          <button className="ghost-btn" onClick={() => onExport("md")}>Markdown</button>
          <button className="ghost-btn" onClick={() => onExport("csv")}>CSV</button>
          <button className="ghost-btn" onClick={() => onExport("json")}>JSON</button>
        </div>
      </div>
    </aside>
  );
}

function labelOf(item: Item | undefined): string {
  if (!item) return "Deleted file";
  if (item.type === "media") return item.name;
  if (item.type === "note" || item.type === "text") return item.text.slice(0, 40) || "Untitled";
  return "On the canvas";
}

function when(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return new Date(ts).toLocaleDateString();
}
