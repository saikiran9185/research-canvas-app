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
