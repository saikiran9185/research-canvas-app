// In-app dialogs.
//
// Tauri's webview does not implement window.prompt / confirm / alert — they
// return null (or nothing) with no error, which silently breaks every flow
// built on them. So the app ships its own, promise-based and callable from
// anywhere, including code that runs outside React.

import { useCallback, useEffect, useRef, useState } from "react";

type Kind = "prompt" | "confirm" | "alert";

interface Request {
  kind: Kind;
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  okLabel?: string;
  danger?: boolean;
}

type Resolver = (v: string | boolean | null) => void;

let present: ((r: Request, resolve: Resolver) => void) | null = null;

/** Ask for a line of text. Resolves to the text, or null if cancelled. */
export function askText(
  title: string,
  opts: { message?: string; value?: string; placeholder?: string; okLabel?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!present) return resolve(null);
    present({ kind: "prompt", title, ...opts }, (v) => resolve(typeof v === "string" ? v : null));
  });
}

/** Ask yes/no. Resolves false if the host is not mounted, which is the safe answer. */
export function askConfirm(
  title: string,
  opts: { message?: string; okLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!present) return resolve(false);
    present({ kind: "confirm", title, ...opts }, (v) => resolve(v === true));
  });
}

/** Tell the person something they must acknowledge. */
export function showAlert(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!present) return resolve();
    present({ kind: "alert", title, message }, () => resolve());
  });
}

/** Mount once, near the root. Everything above is inert until this exists. */
export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<Resolver | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    present = (r, resolve) => {
      resolver.current = resolve;
      setText(r.value ?? "");
      setReq(r);
    };
    return () => { present = null; };
  }, []);

  const finish = useCallback((value: string | boolean | null) => {
    const r = resolver.current;
    resolver.current = null;
    setReq(null);
    r?.(value);
  }, []);

  useEffect(() => {
    if (req?.kind === "prompt") {
      // Select the suggested name so typing replaces it, the way a rename field does.
      const id = window.setTimeout(() => inputRef.current?.select(), 10);
      return () => window.clearTimeout(id);
    }
  }, [req]);

  if (!req) return null;

  const cancel = () => finish(req.kind === "confirm" ? false : null);
  const accept = () => finish(req.kind === "prompt" ? text : true);

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={req.title}>
        <h3>{req.title}</h3>
        {req.message && <p>{req.message}</p>}
        {req.kind === "prompt" && (
          <input
            ref={inputRef}
            autoFocus
            value={text}
            placeholder={req.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); accept(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
          />
        )}
        <div className="dialog-actions">
          {req.kind !== "alert" && <button className="ghost-btn" onClick={cancel}>Cancel</button>}
          <button
            className={"cta small" + (req.danger ? " danger" : "")}
            autoFocus={req.kind !== "prompt"}
            onClick={accept}
            disabled={req.kind === "prompt" && !text.trim()}
          >
            {req.okLabel ?? (req.kind === "alert" ? "OK" : req.kind === "confirm" ? "Yes" : "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
