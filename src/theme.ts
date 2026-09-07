// Theme handling. Three states, the same three every native app offers:
// follow the system, force light, force dark. The choice is written to
// <html data-theme> and every colour in App.css reads from tokens there.

export type Theme = "system" | "light" | "dark";

const KEY = "rc.theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable — fall through to the system default */
  }
  return "system";
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  // "system" means: set nothing, and let the prefers-color-scheme media query
  // in App.css decide. Anything else is an explicit override.
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* non-fatal */
  }
}


/** Is the app currently showing the dark palette? */
export function isDark(t: Theme): boolean {
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * The default ink for each palette.
 *
 * This matters more than it looks: near-black ink on a near-black canvas is
 * invisible, so a pen stroke, a line of text or an arrow appears to do nothing
 * at all. Drawing was never broken in dark mode — it just could not be seen.
 */
export const INK = { light: "#111827", dark: "#e7e9ec" } as const;

/** True when `c` is one of the defaults, i.e. the person has not chosen a colour. */
export function isDefaultInk(c: string): boolean {
  const v = c.toLowerCase();
  return v === INK.light.toLowerCase() || v === INK.dark.toLowerCase();
}


/**
 * The sentinel stored on an item drawn with the default ink.
 *
 * A colour written into a .canvas file is normally literal — red stays red in
 * either palette, which is what you want. But the *default* ink is not a
 * choice, it is "whatever reads on this paper": near-white in the dark, near-
 * black in the light. Storing the literal meant a note typed at night became
 * invisible by day. Storing this token instead makes those marks follow the
 * palette, and leaves every deliberate colour alone.
 */
export const INK_TOKEN = "ink";

/** What to actually paint with, given the palette now in force. */
export function resolveInk(color: string, dark: boolean): string {
  if (color === INK_TOKEN || isDefaultInk(color)) return dark ? INK.dark : INK.light;
  return color;
}

/**
 * Does this colour disappear against the current paper?
 *
 * Used to rescue older boards and pasted-in colours: an explicit near-black on
 * a near-black canvas is still a mark you cannot see, whatever the reason.
 */
export function contrastsWithPaper(color: string, dark: boolean): boolean {
  const hex = color.trim().replace("#", "");
  if (hex.length !== 3 && hex.length !== 6) return true; // named/oklch — assume fine
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Rec. 709 luma, which tracks perceived brightness far better than an average.
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return dark ? luma > 0.22 : luma < 0.86;
}
