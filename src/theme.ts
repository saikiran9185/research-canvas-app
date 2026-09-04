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
