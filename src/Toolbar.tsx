import type { ReactElement } from "react";
import type { Tool } from "./types";

interface Props {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  size: number;
  setSize: (n: number) => void;
  onImportMedia: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onZoomFit: () => void;
  annotationCount: number;
  showAnnotations: boolean;
  onToggleAnnotations: () => void;
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
  { id: "annotate", label: "Annotate media", hint: "C", icon: <g fill="none" strokeWidth="1.6"><path d="M4 5h16v10h-8l-4 4v-4H4z" /><circle cx="12" cy="10" r="1.4" fill="currentColor" stroke="none" /></g> },
];

const SWATCHES = ["#111827", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff"];

export default function Toolbar(p: Props) {
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={"tool-btn" + (p.tool === t.id ? " active" : "")}
          title={`${t.label} (${t.hint})`}
          onClick={() => p.setTool(t.id)}
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" fill="currentColor">{t.icon}</svg>
        </button>
      ))}

      <button className="tool-btn" title="Import image / video / audio" onClick={p.onImportMedia}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.6" fill="currentColor" stroke="none" />
          <path d="M4 17l5-5 4 4 3-3 4 4" />
        </svg>
      </button>

      <div className="tool-divider" />

      <div className="color-well" title="Color">
        <input type="color" value={p.color} onChange={(e) => p.setColor(e.target.value)} />
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button key={c} className={"swatch" + (p.color.toLowerCase() === c ? " active" : "")} style={{ background: c }} onClick={() => p.setColor(c)} />
        ))}
      </div>

      <div className="size-control" title="Stroke size">
        <input type="range" min={1} max={24} value={p.size} onChange={(e) => p.setSize(Number(e.target.value))} />
      </div>

      <button
        className={"tool-btn" + (p.showAnnotations ? " active" : "")}
        title="Annotations panel"
        onClick={p.onToggleAnnotations}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        {p.annotationCount > 0 && <span className="tool-badge">{p.annotationCount}</span>}
      </button>

      <div className="tool-divider" />

      <button className="tool-btn" title="Undo (⌘Z)" disabled={!p.canUndo} onClick={p.onUndo}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-1" /></svg>
      </button>
      <button className="tool-btn" title="Redo (⌘⇧Z)" disabled={!p.canRedo} onClick={p.onRedo}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h1" /></svg>
      </button>
      <button className="tool-btn" title="Zoom to fit" onClick={p.onZoomFit}>
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>
    </div>
  );
}
