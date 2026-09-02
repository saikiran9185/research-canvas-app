// The annotation layer: highlights, pins and timecode markers drawn on top of
// a media item, plus the little editor that opens on the selected pin.
import type React from "react";
import type { Annotation, MediaItem } from "./types";
import { fmtTime } from "./types";

// How close (in seconds) playback must be for a video's frame pins to show.
const FRAME_WINDOW = 2;

interface Props {
  item: MediaItem;
  annotations: Annotation[];
  numberOf: (id: string) => number;
  zoom: number;
  selectedId: string | null;
  currentTime: number;
  duration: number;
  onSelect: (id: string | null) => void;
  onChangeText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onSeek: (t: number) => void;
}

export default function AnnotationOverlay(p: Props) {
  const { item, annotations, zoom } = p;
  if (!annotations.length) return null;

  // Counter-scale chrome so pins stay the same size (and clickable) at any zoom.
  const inv = 1 / zoom;
  const timed = annotations.filter((a) => a.time !== undefined);

  // On a video, a frame pin only belongs to its own moment.
  const visible = annotations.filter((a) => {
    if (!a.region) return false;
    if (item.kind !== "video" || a.time === undefined) return true;
    return a.id === p.selectedId || Math.abs(p.currentTime - a.time) <= FRAME_WINDOW;
  });

  return (
    <div className="anno-layer">
      {visible.map((a) => {
        const r = a.region!;
        const isBox = r.w > 0.001 && r.h > 0.001;
        const selected = a.id === p.selectedId;
        return (
          <div key={a.id}>
            {isBox && (
              <div
                className={"anno-region" + (selected ? " selected" : "")}
                style={{
                  left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`, height: `${r.h * 100}%`,
                  borderColor: a.color,
                  borderWidth: Math.max(1, 2 * inv),
                  background: selected ? `${a.color}22` : `${a.color}14`,
                }}
                onPointerDown={(e) => { e.stopPropagation(); p.onSelect(a.id); }}
              />
            )}
            <Pin
              a={a} n={p.numberOf(a.id)} inv={inv} selected={selected}
              left={`${r.x * 100}%`} top={`${r.y * 100}%`}
              onSelect={() => p.onSelect(a.id)}
            />
            {selected && (
              /* beside the region, never on top of what is being annotated */
              <Editor
                a={a} inv={inv}
                left={`${(r.x + r.w) * 100}%`} top={`${r.y * 100}%`}
                onChangeText={p.onChangeText} onDelete={p.onDelete} onClose={() => p.onSelect(null)}
              />
            )}
          </div>
        );
      })}

      {/* audio has no picture to point at — its pins live on the timeline */}
      {item.kind === "audio" && p.selectedId && annotations.some((a) => a.id === p.selectedId) && (() => {
        const a = annotations.find((x) => x.id === p.selectedId)!;
        const at = p.duration > 0 && a.time !== undefined ? a.time / p.duration : 0;
        return (
          <Editor
            a={a} inv={inv} left={`${at * 100}%`} top="100%"
            onChangeText={p.onChangeText} onDelete={p.onDelete} onClose={() => p.onSelect(null)}
          />
        );
      })()}

      {/* timecode strip under video / audio: every moment that carries a note */}
      {(item.kind === "video" || item.kind === "audio") && timed.length > 0 && (
        <div className="anno-timeline">
          <div className="anno-track" style={{ height: Math.max(2, 3 * inv) }} />
          {p.duration > 0 && (
            <div
              className="anno-playhead"
              style={{ left: `${(p.currentTime / p.duration) * 100}%`, width: Math.max(1, 2 * inv) }}
            />
          )}
          {timed.map((a) => (
            <button
              key={a.id}
              className={"anno-tick" + (a.id === p.selectedId ? " selected" : "")}
              style={{
                left: p.duration > 0 ? `${(a.time! / p.duration) * 100}%` : 0,
                transform: `translate(-50%, -50%) scale(${inv})`,
                background: a.color,
              }}
              title={`${fmtTime(a.time!)} — ${a.text || "note"}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); p.onSeek(a.time!); p.onSelect(a.id); }}
            >
              {p.numberOf(a.id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Pin({ a, n, inv, selected, left, top, onSelect }: {
  a: Annotation; n: number; inv: number; selected: boolean;
  left: string; top: string; onSelect: () => void;
}) {
  return (
    <button
      className={"anno-pin" + (selected ? " selected" : "")}
      style={{ left, top, transform: `translate(-50%, -50%) scale(${inv})`, background: a.color }}
      title={a.text || "Add a note"}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {n}
    </button>
  );
}

function Editor({ a, inv, left, top, onChangeText, onDelete, onClose }: {
  a: Annotation; inv: number; left: string; top: string;
  onChangeText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div
      className="anno-editor"
      style={{ left, top, transform: `translate(14px, -6px) scale(${inv})` }}
      onPointerDown={stop}
    >
      <div className="anno-editor-head">
        <span className="anno-dot" style={{ background: a.color }} />
        {a.time !== undefined && <span className="anno-time">{fmtTime(a.time)}</span>}
        <button className="anno-x" title="Delete note" onClick={() => onDelete(a.id)}>🗑</button>
        <button className="anno-x" title="Close" onClick={onClose}>✕</button>
      </div>
      <textarea
        autoFocus
        className="anno-text"
        placeholder="What do you notice here?"
        value={a.text}
        onChange={(e) => onChangeText(a.id, e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      />
    </div>
  );
}
