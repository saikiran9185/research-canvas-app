import { useEffect, useRef } from "react";
import { claimKeyboard } from "../editorScope";

/**
 * The textarea you type into on the board.
 *
 * Two things it does that an inline `<textarea autoFocus>` did not, both of
 * which were behind text editing failing repeatedly:
 *
 * **Focus is explicit.** `autoFocus` is a mount-time hint, and under
 * StrictMode a component mounts, unmounts and mounts again — so whether the
 * caret lands anywhere depended on timing. Focusing from an effect, keyed on
 * the editor's identity, happens after every commit that matters.
 *
 * **It claims the keyboard for as long as it is open.** Without that, an
 * editor that opened but did not receive focus left four global shortcut
 * listeners believing the keyboard was free — so typing "n" into a text box
 * switched the tool to Sticky Note rather than typing an n.
 */
export interface InlineEditorProps {
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  className: string;
  style?: React.CSSProperties;
  placeholder?: string;
  /** Enter commits instead of inserting a newline — right for a one-line
   *  comment bubble, wrong for a paragraph of notes. */
  submitOnEnter?: boolean;
}

export function InlineEditor({
  value, onChange, onDone, className, style, placeholder, submitOnEnter,
}: InlineEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const release = claimKeyboard();
    const el = ref.current;
    // A frame later, so the element is laid out and nothing else is still
    // settling focus after this commit.
    const id = requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => { cancelAnimationFrame(id); release(); };
  }, []);

  return (
    <textarea
      ref={ref}
      className={className}
      style={style}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      // Stopped here as well as claimed globally: a listener registered with
      // capture:true would otherwise still see these keys.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); onDone(); return; }
        if (submitOnEnter && e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onDone();
        }
      }}
    />
  );
}
