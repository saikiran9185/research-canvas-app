// Every keyboard command the board answers to, in one place.
//
// It was 122 lines inside Canvas.tsx, between the wheel handler and the
// pointer handlers, which is a strange place for the answer to "what does ⌘G
// do". Here the whole command set can be read at once, and adding one means
// touching a file that has nothing to do with dragging.
//
// The commands act through refs rather than through captured state on purpose:
// a listener bound once must not read values from the render that bound it.
// See useLatest for why that matters.

import { useEffect, type RefObject } from "react";
import type { CanvasDoc, Item } from "../types";
import { cameraFor, translate, union, type Measured } from "../geometry";
import { reorder } from "../order";
import { selectable } from "../interaction";
import { uid } from "../types";
import { shortcutsAllowed } from "../editorScope";

/** An open editor owns the keyboard; see editorScope.ts for why this is not
 *  decided by looking at the event target. */
export const isTyping = (e: KeyboardEvent): boolean => !shortcutsAllowed(e);

export interface CommandDeps {
  docRef: RefObject<CanvasDoc>;
  selRef: RefObject<Set<string>>;
  hostRef: RefObject<HTMLDivElement | null>;
  measured: Measured;
  setDoc: (next: CanvasDoc, history?: boolean) => void;
  setSelectedIds: (ids: Set<string>) => void;
  setEditingId: (id: string | null) => void;
  setSpaceDown: (down: boolean) => void;
  beginEditing: (item: Item) => boolean;
  clipboard: RefObject<Item[]>;
}

export function useCanvasCommands(deps: CommandDeps) {
  const {
    docRef, selRef, hostRef, measured, setDoc, setSelectedIds,
    setEditingId, setSpaceDown, beginEditing, clipboard,
  } = deps;

  /** Give a pasted or duplicated item a fresh identity. */
  const reid = (it: Item): Item => ({ ...it, id: uid() });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) setSpaceDown(true);
      if (isTyping(e)) return;
      const d = docRef.current;
      const sel = selRef.current;
      const mod = e.metaKey || e.ctrlKey;

      if ((e.key === "Backspace" || e.key === "Delete") && sel.size) {
        e.preventDefault();
        setDoc({ ...d, items: d.items.filter((i) => !sel.has(i.id)) });
        setSelectedIds(new Set());
        return;
      }

      if (e.key === "Escape") { setSelectedIds(new Set()); setEditingId(null); return; }

      if (e.key === "Enter" && sel.size === 1) {
        const only = d.items.find((i) => sel.has(i.id));
        if (only && beginEditing(only)) e.preventDefault();
        return;
      }

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(selectable(d.items).map((i) => i.id)));
        return;
      }

      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          if (!sel.size) return;
          setDoc({ ...d, items: d.items.map((i) => (sel.has(i.id) ? { ...i, groupId: undefined } : i)) });
        } else if (sel.size > 1) {
          const gid = uid();
          setDoc({ ...d, items: d.items.map((i) => (sel.has(i.id) ? { ...i, groupId: gid } : i)) });
        }
        return;
      }

      if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (e.shiftKey) {
          // The way back. A locked item cannot be selected, so unlocking has
          // to work on the board rather than on a selection — otherwise
          // locking something is a one-way door.
          setDoc({ ...d, items: d.items.map((i) => (i.locked ? { ...i, locked: undefined } : i)) });
        } else if (sel.size) {
          setDoc({ ...d, items: d.items.map((i) => (sel.has(i.id) ? { ...i, locked: true } : i)) });
          setSelectedIds(new Set());
        }
        return;
      }

      if (mod && e.key.toLowerCase() === "c" && sel.size) {
        clipboard.current = d.items.filter((i) => sel.has(i.id));
        return;
      }

      if (mod && e.key.toLowerCase() === "v" && clipboard.current.length) {
        e.preventDefault();
        const regroup = new Map<string, string>();
        const copies = clipboard.current.map((i) => {
          const copy = reid(translate(i, 24, 24));
          if (!i.groupId) return copy;
          if (!regroup.has(i.groupId)) regroup.set(i.groupId, uid());
          return { ...copy, groupId: regroup.get(i.groupId) };
        });
        setDoc({ ...d, items: [...d.items, ...copies] });
        setSelectedIds(new Set(copies.map((i) => i.id)));
        return;
      }

      if (mod && e.key.toLowerCase() === "d" && sel.size) {
        e.preventDefault();
        const copies = d.items.filter((i) => sel.has(i.id)).map((i) => reid(translate(i, 24, 24)));
        setDoc({ ...d, items: [...d.items, ...copies] });
        setSelectedIds(new Set(copies.map((i) => i.id)));
        return;
      }

      // Z-order changes each moved item's own stacking index rather than its
      // position in a shared list, so two people reordering the same board
      // converge instead of overwriting each other. See order.ts.
      if (mod && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        if (!sel.size) return;
        setDoc({ ...d, items: reorder(d.items, sel, e.key === "]" ? "front" : "back") });
        return;
      }

      // Zoom to fit: everything, or just the selection if there is one.
      if (mod && (e.key === "1" || e.key === "0")) {
        e.preventDefault();
        const host = hostRef.current;
        if (!host) return;
        const target = union(sel.size ? d.items.filter((i) => sel.has(i.id)) : d.items, measured);
        if (!target) return;
        setDoc({ ...d, camera: cameraFor(target, host.clientWidth, host.clientHeight) }, false);
        return;
      }

      // Arrow keys nudge — 1px, or 10 with shift.
      if (sel.size && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        setDoc({ ...d, items: d.items.map((i) => (sel.has(i.id) ? translate(i, dx, dy) : i)) });
      }
    };

    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceDown(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setDoc, setSelectedIds]);
}
