import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { CanvasDoc, Item, Tool, ShapeItem } from "./types";
import { uid } from "./types";
import { fileUrl } from "./storage";

interface Props {
  doc: CanvasDoc;
  setDoc: (next: CanvasDoc, history?: boolean) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  size: number;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---- geometry helpers ---------------------------------------------------
function strokePath(points: number[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`;
  return d;
}

function bbox(item: Item): { x: number; y: number; w: number; h: number } {
  if (item.type === "stroke") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < item.points.length; i += 2) {
      minX = Math.min(minX, item.points[i]);
      maxX = Math.max(maxX, item.points[i]);
      minY = Math.min(minY, item.points[i + 1]);
      maxY = Math.max(maxY, item.points[i + 1]);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (item.type === "text") return { x: item.x, y: item.y, w: item.w, h: 40 };
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

function normRect(s: ShapeItem): ShapeItem {
  const x = s.w < 0 ? s.x + s.w : s.x;
  const y = s.h < 0 ? s.y + s.h : s.y;
  return { ...s, x, y, w: Math.abs(s.w), h: Math.abs(s.h) };
}

function translate(item: Item, dx: number, dy: number): Item {
  if (item.type === "stroke") {
    return { ...item, points: item.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
  }
  return { ...item, x: item.x + dx, y: item.y + dy };
}

// ---- component ----------------------------------------------------------
export default function Canvas({
  doc, setDoc, tool, setTool, color, size, selectedId, setSelectedId,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const [draft, setDraft] = useState<Item | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // active drag state (drawing / panning / moving / resizing)
  const drag = useRef<any>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const cam = doc.camera;

  function screenToWorld(clientX: number, clientY: number) {
    const rect = hostRef.current!.getBoundingClientRect();
    const c = docRef.current.camera;
    return { x: (clientX - rect.left - c.x) / c.zoom, y: (clientY - rect.top - c.y) / c.zoom };
  }

  // --- zoom & pan via wheel (non-passive so we can preventDefault) --------
  useEffect(() => {
    const host = hostRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = docRef.current.camera;
      const rect = host.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const wx = (sx - c.x) / c.zoom, wy = (sy - c.y) / c.zoom;
        const zoom = clamp(c.zoom * Math.exp(-e.deltaY * 0.01), 0.05, 8);
        setDoc({ ...docRef.current, camera: { x: sx - wx * zoom, y: sy - wy * zoom, zoom } }, false);
      } else {
        setDoc({ ...docRef.current, camera: { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY } }, false);
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [setDoc]);

  // --- keyboard: space to pan, delete to remove -------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) setSpaceDown(true);
      if ((e.key === "Backspace" || e.key === "Delete") && selectedId && !isTyping(e)) {
        e.preventDefault();
        setDoc({ ...docRef.current, items: docRef.current.items.filter((i) => i.id !== selectedId) });
        setSelectedId(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [selectedId, setDoc, setSelectedId]);

  // --- background pointer (draw / place / pan) --------------------------
  function onHostPointerDown(e: React.PointerEvent) {
    if (editingId) commitEditing();
    const panning = e.button === 1 || tool === "hand" || spaceDown;
    const p = screenToWorld(e.clientX, e.clientY);
    hostRef.current!.setPointerCapture(e.pointerId);

    if (panning) {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, cam: { ...docRef.current.camera } };
      return;
    }
    switch (tool) {
      case "pen":
        drag.current = { mode: "draw" };
        setDraft({ id: uid(), type: "stroke", points: [p.x, p.y], color, size });
        break;
      case "rect":
      case "ellipse":
      case "arrow": {
        const shape = tool === "arrow" ? "arrow" : tool;
        drag.current = { mode: "shape" };
        setDraft({ id: uid(), type: "shape", shape, x: p.x, y: p.y, w: 0, h: 0, color, size } as ShapeItem);
        break;
      }
      case "text": {
        const id = uid();
        setDoc({ ...docRef.current, items: [...docRef.current.items, { id, type: "text", x: p.x, y: p.y, w: 220, text: "", color, fontSize: 20 }] });
        setSelectedId(id); setEditingId(id); setTool("select");
        break;
      }
      case "note": {
        const id = uid();
        setDoc({ ...docRef.current, items: [...docRef.current.items, { id, type: "note", x: p.x, y: p.y, w: 180, h: 180, text: "", color: "#ffe27a" }] });
        setSelectedId(id); setEditingId(id); setTool("select");
        break;
      }
      default: // select on empty background → deselect + pan
        setSelectedId(null);
        drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, cam: { ...docRef.current.camera } };
    }
  }

  function onHostPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = screenToWorld(e.clientX, e.clientY);
    if (d.mode === "pan") {
      setDoc({ ...docRef.current, camera: { ...docRef.current.camera, x: d.cam.x + (e.clientX - d.sx), y: d.cam.y + (e.clientY - d.sy) } }, false);
    } else if (d.mode === "draw") {
      setDraft((cur) => (cur && cur.type === "stroke" ? { ...cur, points: [...cur.points, p.x, p.y] } : cur));
    } else if (d.mode === "shape") {
      setDraft((cur) => (cur && cur.type === "shape" ? { ...cur, w: p.x - cur.x, h: p.y - cur.y } : cur));
    } else if (d.mode === "move") {
      const dx = p.x - d.startWorld.x, dy = p.y - d.startWorld.y;
      setDoc({ ...docRef.current, items: docRef.current.items.map((i) => (i.id === d.id ? translate(d.orig, dx, dy) : i)) }, false);
    } else if (d.mode === "resize") {
      const dx = p.x - d.startWorld.x, dy = p.y - d.startWorld.y;
      setDoc({ ...docRef.current, items: docRef.current.items.map((i) => (i.id === d.id ? resize(d.orig, dx, dy) : i)) }, false);
    }
  }

  function onHostPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "draw" && draft && draft.type === "stroke") {
      if (draft.points.length >= 4) setDoc({ ...docRef.current, items: [...docRef.current.items, draft] });
      setDraft(null);
    } else if (d.mode === "shape" && draft && draft.type === "shape") {
      if (Math.abs(draft.w) > 4 || Math.abs(draft.h) > 4) {
        setDoc({ ...docRef.current, items: [...docRef.current.items, normRect(draft)] });
      }
      setDraft(null);
    }
  }

  function resize(item: Item, dx: number, dy: number): Item {
    if (item.type === "stroke") return item;
    if (item.type === "text") return { ...item, w: Math.max(60, item.w + dx) };
    if (item.type === "shape" || item.type === "note" || item.type === "media") {
      return { ...item, w: Math.max(20, item.w + dx), h: Math.max(20, item.h + dy) };
    }
    return item;
  }

  // --- per-item interactions (select mode) -------------------------------
  function itemPointerDown(e: React.PointerEvent, item: Item) {
    if (tool !== "select" || spaceDown) return;
    e.stopPropagation();
    setSelectedId(item.id);
    hostRef.current!.setPointerCapture(e.pointerId);
    drag.current = { mode: "move", id: item.id, orig: item, startWorld: screenToWorld(e.clientX, e.clientY) };
  }

  function handlePointerDown(e: React.PointerEvent, item: Item) {
    e.stopPropagation();
    hostRef.current!.setPointerCapture(e.pointerId);
    drag.current = { mode: "resize", id: item.id, orig: item, startWorld: screenToWorld(e.clientX, e.clientY) };
  }

  function commitEditing() {
    setEditingId(null);
  }

  function setItemText(id: string, text: string) {
    setDoc({ ...docRef.current, items: docRef.current.items.map((i) => (i.id === id && (i.type === "text" || i.type === "note") ? { ...i, text } : i)) }, false);
  }

  const items = draft ? [...doc.items, draft] : doc.items;
  const vectors = items.filter((i) => i.type === "stroke" || i.type === "shape");
  const blocks = items.filter((i) => i.type === "text" || i.type === "note" || i.type === "media");

  const cursor = spaceDown || tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      style={{ cursor }}
      onPointerDown={onHostPointerDown}
      onPointerMove={onHostPointerMove}
      onPointerUp={onHostPointerUp}
    >
      {/* dotted infinite background follows the camera */}
      <div
        className="canvas-grid"
        style={{
          backgroundPosition: `${cam.x}px ${cam.y}px`,
          backgroundSize: `${24 * cam.zoom}px ${24 * cam.zoom}px`,
        }}
      />

      <div className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`, transformOrigin: "0 0" }}>
        {/* vector layer: strokes + shapes */}
        <svg className="vector-layer" overflow="visible" width="0" height="0">
          {vectors.map((it) =>
            it.type === "stroke" ? (
              <g key={it.id}>
                {/* wide invisible hit area for easy selection */}
                <path d={strokePath(it.points)} stroke="transparent" strokeWidth={Math.max(it.size, 14)} fill="none" style={{ pointerEvents: tool === "select" ? "stroke" : "none", cursor: "move" }} onPointerDown={(e) => itemPointerDown(e, it)} />
                <path d={strokePath(it.points)} stroke={it.color} strokeWidth={it.size} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} />
              </g>
            ) : (
              <ShapeView key={it.id} item={it as ShapeItem} selectable={tool === "select"} onDown={(e) => itemPointerDown(e, it)} />
            )
          )}
        </svg>

        {/* block layer: text / notes / media */}
        {blocks.map((it) => {
          const b = bbox(it);
          const selected = it.id === selectedId;
          return (
            <div key={it.id} className={"block" + (selected ? " selected" : "")} style={{ left: b.x, top: b.y, width: b.w, ...(it.type !== "text" ? { height: b.h } : {}) }} onPointerDown={(e) => itemPointerDown(e, it)}>
              {it.type === "text" && (
                editingId === it.id ? (
                  <textarea autoFocus className="text-edit" style={{ color: it.color, fontSize: it.fontSize }} value={it.text} onChange={(e) => setItemText(it.id, e.target.value)} onBlur={commitEditing} onPointerDown={(e) => e.stopPropagation()} />
                ) : (
                  <div className="text-view" style={{ color: it.color, fontSize: it.fontSize }} onDoubleClick={() => { setEditingId(it.id); setSelectedId(it.id); }}>
                    {it.text || <span className="placeholder">Text</span>}
                  </div>
                )
              )}
              {it.type === "note" && (
                <div className="note" style={{ background: it.color }} onDoubleClick={() => { setEditingId(it.id); setSelectedId(it.id); }}>
                  {editingId === it.id ? (
                    <textarea autoFocus className="note-edit" value={it.text} onChange={(e) => setItemText(it.id, e.target.value)} onBlur={commitEditing} onPointerDown={(e) => e.stopPropagation()} />
                  ) : (
                    <div className="note-text">{it.text || <span className="placeholder">Note…</span>}</div>
                  )}
                </div>
              )}
              {it.type === "media" && (
                <div className="media">
                  {it.kind === "image" && <img src={fileUrl(it.src)} draggable={false} alt={it.name} />}
                  {it.kind === "video" && <video src={fileUrl(it.src)} controls onPointerDown={(e) => e.stopPropagation()} />}
                  {it.kind === "audio" && (
                    <div className="audio-card" onPointerDown={(e) => e.stopPropagation()}>
                      <div className="audio-name">♪ {it.name}</div>
                      <audio src={fileUrl(it.src)} controls />
                    </div>
                  )}
                </div>
              )}
              {selected && it.type !== "text" && <div className="resize-handle" onPointerDown={(e) => handlePointerDown(e, it)} />}
              {selected && it.type === "text" && <div className="resize-handle" onPointerDown={(e) => handlePointerDown(e, it)} />}
            </div>
          );
        })}

        {/* selection outline for vector items */}
        {selectedId && vectors.find((v) => v.id === selectedId) && (() => {
          const it = vectors.find((v) => v.id === selectedId)!;
          const b = bbox(it);
          return (
            <div className="vector-selection" style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
              {it.type === "shape" && <div className="resize-handle" onPointerDown={(e) => handlePointerDown(e, it)} />}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
}

function ShapeView({ item, selectable, onDown }: { item: ShapeItem; selectable: boolean; onDown: (e: React.PointerEvent) => void }) {
  const s = normRect(item);
  const common = {
    stroke: s.color,
    strokeWidth: s.size,
    fill: "transparent",
    style: { pointerEvents: (selectable ? "visible" : "none") as any, cursor: "move" },
    onPointerDown: onDown,
  };
  if (s.shape === "rect") return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={4} {...common} />;
  if (s.shape === "ellipse") return <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} {...common} />;
  // arrow: item stored raw so direction is preserved
  const x1 = item.x, y1 = item.y, x2 = item.x + item.w, y2 = item.y + item.h;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = 6 + item.size * 2.2;
  const a1x = x2 - head * Math.cos(ang - Math.PI / 7), a1y = y2 - head * Math.sin(ang - Math.PI / 7);
  const a2x = x2 - head * Math.cos(ang + Math.PI / 7), a2y = y2 - head * Math.sin(ang + Math.PI / 7);
  return (
    <g style={{ pointerEvents: selectable ? "visible" : "none", cursor: "move" }} onPointerDown={onDown}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={item.color} strokeWidth={item.size} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`} fill={item.color} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(item.size, 14)} />
    </g>
  );
}
