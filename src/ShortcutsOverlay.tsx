import { useEffect, useRef } from "react";

interface Props {
  onClose: () => void;
}

type Row = { key: string; label: string };

const TOOLS: Row[] = [
  { key: "V", label: "Select" },
  { key: "H", label: "Pan" },
  { key: "P", label: "Pen" },
  { key: "R", label: "Rectangle" },
  { key: "O", label: "Ellipse" },
  { key: "A", label: "Arrow" },
  { key: "T", label: "Text" },
  { key: "N", label: "Sticky note" },
];

const SELECTION: Row[] = [
  { key: "Drag", label: "Rubber-band select on empty canvas" },
  { key: "⇧ Click", label: "Add to / remove from the selection" },
  { key: "⌘A", label: "Select everything" },
  { key: "Esc", label: "Deselect" },
  { key: "⌫", label: "Delete the selection" },
];

const ARRANGE: Row[] = [
  { key: "⌘C / ⌘V", label: "Copy and paste" },
  { key: "⌘D", label: "Duplicate in place" },
  { key: "⌘G", label: "Group the selection" },
  { key: "⌘⇧G", label: "Ungroup" },
  { key: "⌘]", label: "Bring to front" },
  { key: "⌘[", label: "Send to back" },
  { key: "← ↑ → ↓", label: "Nudge by 1px (⇧ for 10)" },
];

const VIEW: Row[] = [
  { key: "Space (hold)", label: "Pan while held" },
  { key: "⌘ + scroll", label: "Zoom, or pinch on a trackpad" },
  { key: "⌘1", label: "Zoom to fit — the selection, or the whole board" },
  { key: "⌘Z / ⌘⇧Z", label: "Undo and redo" },
  { key: "⌘S", label: "Save now" },
  { key: "?", label: "Toggle this help" },
];

const SECTIONS: { title: string; rows: Row[] }[] = [
  { title: "Tools", rows: TOOLS },
  { title: "Selection", rows: SELECTION },
  { title: "Arrange", rows: ARRANGE },
  { title: "View", rows: VIEW },
];

export default function ShortcutsOverlay({ onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Move focus into the dialog so Escape and Tab belong to it, and hand focus
    // back to wherever it came from on close.
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="shortcuts-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="ghost-btn" onClick={onClose} aria-label="Close shortcuts help">
            &#10005;
          </button>
        </div>

        {SECTIONS.map((section) => (
          <div className="shortcuts-section" key={section.title}>
            <h3>{section.title}</h3>
            <ul>
              {section.rows.map((row) => (
                <li key={row.key}>
                  <kbd>{row.key}</kbd>
                  <span>{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
