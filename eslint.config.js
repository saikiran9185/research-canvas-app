// Lint rules chosen for the bugs this project actually had.
//
// Nearly every "sometimes it doesn't work" defect here has been a stale
// closure: an effect or handler capturing a value from an earlier render and
// acting on it later. react-hooks/exhaustive-deps finds those mechanically,
// which is cheaper than finding them by clicking around and reporting them.
import js from "@eslint/js";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default ts.config(
  { ignores: ["dist", "src-tauri", "node_modules", "test", "public", "scripts"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { window: "readonly", document: "readonly", localStorage: "readonly",
                 console: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
                 setInterval: "readonly", clearInterval: "readonly", requestAnimationFrame: "readonly",
                 ResizeObserver: "readonly", Image: "readonly", Blob: "readonly", URL: "readonly",
                 FileReader: "readonly", fetch: "readonly", alert: "readonly", confirm: "readonly",
                 prompt: "readonly", HTMLElement: "readonly", HTMLTextAreaElement: "readonly",
                 HTMLInputElement: "readonly", HTMLCanvasElement: "readonly", HTMLImageElement: "readonly",
                 HTMLVideoElement: "readonly", HTMLAudioElement: "readonly", HTMLDivElement: "readonly",
                 KeyboardEvent: "readonly", PointerEvent: "readonly", WheelEvent: "readonly",
                 MouseEvent: "readonly", DragEvent: "readonly", Event: "readonly",
                 navigator: "readonly", performance: "readonly", matchMedia: "readonly",
                 devicePixelRatio: "readonly", TextDecoder: "readonly", TextEncoder: "readonly",
                 Uint8Array: "readonly", ArrayBuffer: "readonly", DOMParser: "readonly",
                 CanvasRenderingContext2D: "readonly", SVGElement: "readonly", File: "readonly" },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The one that matters: a dependency array that lies is a stale closure
      // waiting to happen, and that is the shape of most bugs found here.
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Advisory, not a correctness rule: its own message says subscribing to
      // an external system and calling setState in the callback is a valid
      // reason to do this, which is exactly what the remaining cases are
      // (media load state, measurement, theme). Kept visible as a warning so
      // new ones get noticed, rather than silenced.
      "react-hooks/set-state-in-effect": "warn",
      // Flags uid() and Date.now() inside functions declared in the component
      // body. Those are event handlers — they run on a click, never during
      // render — but the rule cannot distinguish a handler from render logic
      // at that position. The idiomatic way to prove it is useCallback with a
      // hand-maintained dependency array on every pointer handler, which
      // reintroduces exactly the stale-closure class that caused most of this
      // week's bugs. A warning is the honest classification: worth reading,
      // not worth restructuring working interaction code to satisfy.
      "react-hooks/purity": "warn",
    },
  },
);
