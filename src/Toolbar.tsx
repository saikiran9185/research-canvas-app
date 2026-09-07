import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Tool } from "./types";
import { reachablePosition } from "./interaction";

interface Props {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  size: number;
  setSize: (n: number) => void;
  fill: string;
  setFill: (c: string) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  onImportMedia: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onZoomFit: () => void;
  locked: boolean;
  onToggleLock: () => void;
  onShowShortcuts: () => void;
  notesOpen: boolean;
  noteCount: number;
  onToggleNotes: () => void;
  /** Changes the labels: the controls restyle a selection when there is one. */
  hasSelection: boolean;
}

const TOOLS: { id: Tool; label: string; icon: ReactElement; hint: string }[] = [
  { id: "select", label: "Select", hint: "V", icon: <path d="M4 3l7 16 2-7 7-2z" /> },
  { id: "hand", label: "Pan", hint: "Space", icon: <path d="M8 12V6a1.5 1.5 0 013 0v5m0-1V5a1.5 1.5 0 013 0v6m0-2a1.5 1.5 0 013 0v5a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012-2l1 1" fill="none" strokeWidth="1.6" /> },
  { id: "pen", label: "Draw", hint: "P", icon: <path d="M4 20l4-1L19 8a2 2 0 00-3-3L5 16z" fill="none" strokeWidth="1.6" /> },
  { id: "rect", label: "Rectangle", hint: "R", icon: <rect x="4" y="6" width="16" height="12" rx="2" fill="none" strokeWidth="1.6" /> },
  { id: "ellipse", label: "Ellipse", hint: "O", icon: <ellipse cx="12" cy="12" rx="8" ry="7" fill="none" strokeWidth="1.6" /> },
  { id: "arrow", label: "Arrow", hint: "A", icon: <path d="M4 20L20 4M20 4h-7M20 4v7" fill="none" strokeWidth="1.6" /> },
  { id: "text", label: "Text", hint: "T", icon: <path d="M5 5h14M12 5v14" fill="none" strokeWidth="1.8" /> },
  { id: "note", label: "Sticky note", hint: "N", icon: <path d="M5 4h14v10l-5 6H5z" fill="none" strokeWidth="1.6" /> },
  { id: "comment", label: "Comment", hint: "C", icon: <path d="M4 5h16v11H9l-5 4z" fill="none" strokeWidth="1.6" /> },
];

const SWATCHES = ["#111827", "#e7e9ec", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
// Softer tints for fills, so a filled shape sits behind its own outline
// instead of shouting over the media underneath it.
const NIBS = [1, 2, 4, 8, 16];
const TEXT_SIZES = [14, 20, 28, 40, 64];

const FILLS = ["#fee2e2", "#fef3c7", "#d1fae5", "#dbeafe", "#ede9fe", "#fce7f3", "#e5e7eb"];

/** Where the rail sits, remembered between sessions. */
const POS_KEY = "rc.toolbar.pos";

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.x === "number" && typeof v?.y === "number" ? v : null;
  } catch { return null; }
}

export default function Toolbar(p: Props) {
  // null = parked at the default place along the bottom edge.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadPos);
  const [stylesOpen, setStylesOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // The style controls belong on screen when they can do something: a drawing
  // tool is armed, or something is selected to restyle. The rest of the time
  // they are just a wall of swatches over the board.
  const relevant = p.hasSelection || ["pen", "rect", "ellipse", "arrow", "text", "note"].includes(p.tool);
  useEffect(() => { if (!relevant) setStylesOpen(false); }, [relevant]);

  // A remembered position can outlive the window it was stored for — or the
  // positioning scheme, which is exactly what stranded this rail off-screen.
  // Check it against the viewport we are actually in, and fall back to the
  // default place rather than leaving the grip somewhere unreachable.
  useEffect(() => {
    const settle = () => {
      const el = railRef.current;
      if (!el) return;
      setPos((v) => {
        const ok = reachablePosition(v, { w: el.offsetWidth, h: el.offsetHeight },
                                     { w: window.innerWidth, h: window.innerHeight });
        if (!ok) { try { localStorage.removeItem(POS_KEY); } catch { /* non-fatal */ } }
        return ok;
      });
    };
    settle();
    window.addEventListener("resize", settle);
    return () => window.removeEventListener("resize", settle);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      const el = railRef.current;
      if (!d || !el) return;
      // Keep it reachable: the rail may never be dragged off the window.
      const maxX = window.innerWidth - el.offsetWidth - 8;
      const maxY = window.innerHeight - el.offsetHeight - 8;
      setPos({
        x: Math.max(8, Math.min(maxX, e.clientX - d.dx)),
        y: Math.max(8, Math.min(maxY, e.clientY - d.dy)),
      });
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setPos((v) => {
        try { if (v) localStorage.setItem(POS_KEY, JSON.stringify(v)); } catch { /* non-fatal */ }
        return v;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    const el = railRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    // Switch from the centred default to absolute coordinates on first grab,
    // so the rail does not jump out from under the cursor.
    setPos({ x: r.left, y: r.top });
  };

  const resetPos = () => {
    setPos(null);
    try { localStorage.removeItem(POS_KEY); } catch { /* non-fatal */ }
  };

  const style = pos ? { left: pos.x, top: pos.y, bottom: "auto", transform: "none" } : undefined;

  return (
    <div className="toolbar" ref={railRef} style={style}>
      {/* Drag anywhere by the grip; double-click it to park it again. */}
      <div
        className="toolbar-grip"
        onPointerDown={startDrag}
        onDoubleClick={resetPos}
        title="Drag to move · double-click to reset"
        role="button"
        aria-label="Move toolbar"
        tabIndex={0}
      >
        <svg viewBox="0 0 8 20" aria-hidden="true"><circle cx="2.4" cy="6" r="1.1" /><circle cx="5.6" cy="6" r="1.1" /><circle cx="2.4" cy="10" r="1.1" /><circle cx="5.6" cy="10" r="1.1" /><circle cx="2.4" cy="14" r="1.1" /><circle cx="5.6" cy="14" r="1.1" /></svg>
      </div>

      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={"tool-btn" + (p.tool === t.id ? " active" : "")}
          title={`${t.label} (${t.hint})`}
          aria-label={t.label}
          aria-pressed={p.tool === t.id}
          onClick={() => p.setTool(t.id)}
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="currentColor">{t.icon}</svg>
        </button>
      ))}

      <button className="tool-btn" title="Import image, video, audio, PDF or 3D model" aria-label="Import media" onClick={p.onImportMedia}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.6" fill="currentColor" stroke="none" />
          <path d="M4 17l5-5 4 4 3-3 4 4" />
        </svg>
      </button>

      <div className="tool-divider" />

      {/* One swatch stands in for the whole style panel, which opens above the
          rail. Keeps the rail the width of the tools rather than the width of
          every colour anyone might want. */}
      <button
        className={"style-trigger" + (stylesOpen ? " active" : "")}
        title={p.hasSelection ? "Restyle the selection" : "Colour, width and fill"}
        aria-label="Style"
        aria-expanded={stylesOpen}
        disabled={!relevant}
        onClick={() => setStylesOpen((v) => !v)}
      >
        <span className="style-ink" style={{ background: p.size === 0 ? "transparent" : p.color, borderColor: p.color }} />
        <span className="style-fill" style={{ background: p.fill === "none" ? "transparent" : p.fill }} />
      </button>

      {stylesOpen && relevant && (
        <div className="style-pop" role="group" aria-label="Style controls">
          <div className="style-section">
            <span className="style-label">Line</span>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button key={c} className={"swatch" + (p.color.toLowerCase() === c ? " active" : "")} style={{ background: c }} onClick={() => p.setColor(c)} title={c} aria-label={`Line ${c}`} />
              ))}
              <div className="color-well" title="Pick any line colour" style={{ background: p.color }}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15.5 4.5a2.1 2.1 0 013 3l-1.6 1.6-3-3zM13.8 6.2l3 3-7.4 7.4-3.6.6.6-3.6z" />
                </svg>
                <input type="color" value={p.color} onChange={(e) => p.setColor(e.target.value)} aria-label="Pick any line colour" />
              </div>
              <button
                className={"swatch no-fill" + (p.size === 0 ? " active" : "")}
                onClick={() => p.setSize(0)}
                title="No outline"
                aria-label="No outline"
              />
            </div>
          </div>

          {/* Fixed nibs, not a free slider. The slider ran down to 0, and 0
              means "no stroke" — so the pen could be set to invisible in one
              drag, and drawing looked broken when it was working. */}
          <div className="style-section">
            <span className="style-label">Width</span>
            <div className="size-row">
              {NIBS.map((n) => (
                <button
                  key={n}
                  className={"nib" + (p.size === n ? " active" : "")}
                  onClick={() => p.setSize(n)}
                  title={`${n} pt`}
                  aria-label={`${n} point stroke`}
                  aria-pressed={p.size === n}
                >
                  <span style={{ width: Math.min(16, 3 + n), height: Math.min(16, 3 + n) }} />
                </button>
              ))}
            </div>
          </div>

          {/* Text size, shown when it can do something: the text tool is armed,
              or text is selected. A scale rather than a slider, so labels on a
              board group by size instead of each being slightly its own. */}
          {p.tool === "text" || p.hasSelection ? (
            <div className="style-section">
              <span className="style-label">Text size</span>
              <div className="size-row">
                {TEXT_SIZES.map((n) => (
                  <button
                    key={n}
                    className={"text-size" + (p.fontSize === n ? " active" : "")}
                    onClick={() => p.setFontSize(n)}
                    title={`${n}px`}
                    aria-pressed={p.fontSize === n}
                  >A</button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="style-section">
            <span className="style-label">Fill</span>
            <div className="swatches">
              <button
                className={"swatch no-fill" + (p.fill === "none" ? " active" : "")}
                onClick={() => p.setFill("none")}
                title="No fill"
                aria-label="No fill"
              />
              {FILLS.map((c) => (
                <button key={c} className={"swatch" + (p.fill.toLowerCase() === c ? " active" : "")} style={{ background: c }} onClick={() => p.setFill(c)} title={c} aria-label={`Fill ${c}`} />
              ))}
              <div
                className={"color-well" + (p.fill === "none" ? " empty" : "")}
                title="Pick any fill colour"
                style={p.fill === "none" ? undefined : { background: p.fill }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15.5 4.5a2.1 2.1 0 013 3l-1.6 1.6-3-3zM13.8 6.2l3 3-7.4 7.4-3.6.6.6-3.6z" />
                </svg>
                <input
                  type="color"
                  value={p.fill === "none" ? "#ffffff" : p.fill}
                  onChange={(e) => p.setFill(e.target.value)}
                  aria-label="Pick any fill colour"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="tool-divider" />

      <button className="tool-btn" title="Undo (⌘Z)" disabled={!p.canUndo} onClick={p.onUndo}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-1" /></svg>
      </button>
      <button className="tool-btn" title="Redo (⌘⇧Z)" disabled={!p.canRedo} onClick={p.onRedo}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h1" /></svg>
      </button>
      <button className="tool-btn" title="Zoom to fit (⌘1)" aria-label="Zoom to fit" onClick={p.onZoomFit}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>
      {/* Freeze the view. Useful while drawing on a trackpad, where a stray
          two-finger drag otherwise sends the board somewhere you have to
          hunt for. */}
      <button
        className={"tool-btn" + (p.locked ? " active" : "")}
        title={p.locked ? "Camera locked — click to unlock" : "Lock the camera (stop pan and zoom)"}
        aria-label="Lock camera"
        aria-pressed={p.locked}
        onClick={p.onToggleLock}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          {p.locked
            ? <path d="M8 11V8a4 4 0 018 0v3" />
            : <path d="M8 11V8a4 4 0 017-2.6" />}
        </svg>
      </button>

      <button className="tool-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={p.onShowShortcuts}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7">
          <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
          <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" strokeLinecap="round" />
        </svg>
      </button>

      <div className="tool-divider" />

      <button
        className={"tool-btn notes-btn" + (p.notesOpen ? " active" : "")}
        title="All notes on this board"
        onClick={p.onToggleNotes}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
          <path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" />
        </svg>
        {p.noteCount > 0 && <span className="notes-count">{p.noteCount}</span>}
      </button>
    </div>
  );
}
