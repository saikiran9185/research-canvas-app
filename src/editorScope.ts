// Who owns the keyboard right now.
//
// This app grew four independent `window` keydown listeners — the canvas
// commands, the app shortcuts, the media viewer and the shortcuts sheet — and
// each decided for itself whether the user was typing by inspecting
// `event.target.tagName`. That works only while focus is where you assume it
// is. The moment an editor opens but focus does not land on it, every one of
// those listeners concludes the keyboard is free, and typing "n" into a text
// box silently switches the tool to Sticky Note instead.
//
// So ownership is stated once, here, instead of inferred four times. When an
// editor is open it holds the keyboard, and every global listener stands down
// whether or not focus ended up where it should have. Mature editors do this
// with a scoped command system; this is the same idea at the size this app is.

let openEditors = 0;

/** Mark an editor open. Returns the function that closes it again. */
export function claimKeyboard(): () => void {
  openEditors++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openEditors = Math.max(0, openEditors - 1);
  };
}

/** True when a text editor holds the keyboard and shortcuts must stand down. */
export function keyboardIsClaimed(): boolean {
  return openEditors > 0;
}

/**
 * Should this global shortcut handler act on this event?
 *
 * Checks the claim first and the event target second: the target check still
 * catches fields nobody claimed for (a rename prompt, a search box), and the
 * claim catches the case the target check cannot — an editor that is open but
 * has not been focused.
 */
export function shortcutsAllowed(e: KeyboardEvent): boolean {
  if (keyboardIsClaimed()) return false;
  const t = e.target as HTMLElement | null;
  if (!t) return true;
  return !(t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
}
