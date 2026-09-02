import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

const TOOL_SHORTCUTS: { key: string; label: string }[] = [
  { key: "V", label: "Select" },
  { key: "H", label: "Pan" },
  { key: "P", label: "Pen" },
  { key: "R", label: "Rectangle" },
  { key: "O", label: "Ellipse" },
  { key: "A", label: "Arrow" },
  { key: "T", label: "Text" },
  { key: "N", label: "Sticky note" },
];

const ACTION_SHORTCUTS: { key: string; label: string }[] = [
  { key: "Space (hold)", label: "Pan while held" },
  { key: "⌘Z / Ctrl+Z", label: "Undo" },
  { key: "⌘⇧Z / Ctrl+Shift+Z", label: "Redo" },
  { key: "⌘S / Ctrl+S", label: "Save" },
  { key: "Delete / Backspace", label: "Delete selection" },
  { key: "?", label: "Toggle this help" },
];

export default function ShortcutsOverlay({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <button className="ghost-btn" onClick={onClose} aria-label="Close shortcuts help">
            &#10005;
          </button>
        </div>

        <div className="shortcuts-section">
          <h3>Tools</h3>
          <ul>
            {TOOL_SHORTCUTS.map((s) => (
              <li key={s.key}>
                <kbd>{s.key}</kbd>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="shortcuts-section">
          <h3>Actions</h3>
          <ul>
            {ACTION_SHORTCUTS.map((s) => (
              <li key={s.key}>
                <kbd>{s.key}</kbd>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
