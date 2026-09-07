import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A ref that always holds the latest value, written safely.
 *
 * The obvious version — `const r = useRef(v); r.current = v;` — writes during
 * render, and a React render can be abandoned and re-run. When that happens
 * the ref keeps the value from a render that never committed, so an event
 * handler reading it acts on state the user never saw. It is a rare bug and an
 * extremely confusing one, because the same code works every other time.
 *
 * useLayoutEffect writes after the DOM is committed and before the browser can
 * dispatch the next event, so a pointer handler always reads a value that
 * actually rendered. A passive effect would not be soon enough for that.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}
