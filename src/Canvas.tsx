import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useLatest } from "./useLatest";
import type { Annotation, CanvasDoc, Item, Tool, ShapeItem, MediaItem, ExcerptItem } from "./types";
import { fmtTime, uid } from "./types";
import { inkOutline, normRect, polylinePath, ShapeView } from "./canvas/items";
import { useCanvasCommands } from "./canvas/useCanvasCommands";
import {
  DRAG_SLOP_PX, EDITOR_SETTLE_MS, HANDLE_GRAB_PX, HIT_SLOP_PX, MAX_ZOOM,
  MIN_ITEM_SIZE, SNAP_PX, ZOOM_WHEEL_SENSITIVITY,
} from "./constants";
import { contrastsWithPaper, INK, INK_TOKEN, isDefaultInk, resolveInk } from "./theme";
import { decidePress, isDoubleClick, selectable, shouldCapturePointer, travelled, widthForTool } from "./interaction";
import { ordered } from "./order";
import { MediaImage, MediaVideo, MediaAudio, PdfThumb, DocThumb } from "./canvas/MediaCard";
import {
  bbox, CURSOR, expandToGroups, fitTo, HANDLES, handlePoint, minUsefulZoom,
  gridSpacing, normalize, overlaps, resizeRect, snapMove, toWorld, translate, union,
  type Guide, type HandleId, type Point, type Rect,
} from "./geometry";

interface Props {
  doc: CanvasDoc;
  setDoc: (next: CanvasDoc, history?: boolean) => void;
  /** Take an undo point for the board as it stands, before a gesture edits it. */
  pushHistory: () => void;
  /** Which palette is showing, so ink can be resolved at paint time. */
  dark: boolean;
  /** Freezes the camera, so a stray gesture cannot lose your place. */
  locked: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  size: number;
  fill: string;
  /** Selection is a set: a board is not usable if you can only ever hold one
   *  thing at a time. */
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  /** Open (unresolved) note count per item, for the badge on each card. */
  annotationCounts: Map<string, number>;
  /** Notes dropped straight onto the canvas rather than onto a file. */
  boardNotes: Annotation[];
  onOpenMedia: (itemId: string) => void;
  /** Follow an excerpt's backlink to where it was taken from. */
  onOpenExcerptSource: (ex: ExcerptItem) => void;
  /** Commit a new note dropped on the board. Empty text is discarded. */
  onBoardComment: (world: { x: number; y: number }, text: string) => void;
  /** Edit an existing bubble in place. Empty text deletes it. */
  onEditBoardComment: (a: Annotation, text: string) => void;
  onOpenAnnotation: (a: Annotation) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));






type Drag =
  | { mode: "pan"; sx: number; sy: number; cam: { x: number; y: number; zoom: number } }
  | { mode: "draw" }
  | { mode: "shape" }
  | { mode: "marquee"; origin: Point; additive: boolean; base: Set<string> }
  | { mode: "move"; origin: Point; snapshot: Item[]; moved: boolean }
  | { mode: "resize"; handle: HandleId; origin: Point; startBox: Rect; snapshot: Item[] };

// ---- component ----------------------------------------------------------
export default function Canvas({
  doc, setDoc, pushHistory, dark, locked, tool, setTool, color, size, fill, selectedIds, setSelectedIds,
  annotationCounts, boardNotes, onOpenMedia, onOpenExcerptSource,
  onBoardComment, onEditBoardComment, onOpenAnnotation,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const docRef = useLatest(doc);
  const selRef = useLatest(selectedIds);

  const [draft, setDraft] = useState<Item | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /** An unsaved bubble being typed into, at the spot it was dropped. */
  const [draftComment, setDraftComment] = useState<{ x: number; y: number; text: string } | null>(null);
  /** An existing bubble being edited in place. */
  const [editingPin, setEditingPin] = useState<{ id: string; text: string } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  /**
   * Text heights as the font engine actually rendered them, in world units.
   *
   * Held here rather than written back into the board: a measurement is a fact
   * about this machine's fonts and this zoom level, not about the document,
   * and saving it would make simply opening a board dirty it for everyone
   * else syncing the folder.
   */
  const [measured, setMeasured] = useState<Map<string, number>>(new Map());
  const textEls = useRef(new Map<string, HTMLElement>());
  /** Which text items exist, so the observer is rebound when that changes —
   *  the count alone is not enough, since ids can change while it does not. */
  const textKey = doc.items.filter((i) => i.type === "text").map((i) => i.id).join(",");
  // Handles are hidden mid-gesture so they do not sit under the cursor while
  // the very box they belong to is being dragged.
  const [dragging, setDragging] = useState(false);

  const drag = useRef<Drag | null>(null);
  const clipboard = useRef<Item[]>([]);
  /** Last click, for detecting a double-click ourselves. */
  const lastClick = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  /** When the current editor opened, so a blur from the opening click can be
   *  told apart from the person actually clicking away. */
  const editorOpenedAt = useRef(0);
  const [spaceDown, setSpaceDown] = useState(false);

  const cam = doc.camera;

  /** Select, but never split a group. */
  const select = useCallback((ids: Set<string>) => {
    const next = expandToGroups(docRef.current.items, ids);
    selRef.current = next;
    setSelectedIds(next);
  }, [setSelectedIds]);

  /**
   * What to paint an item's ink with, under the palette in force.
   *
   * Items drawn with the default ink carry a token rather than a literal, so
   * they follow the palette. Anything with a deliberate colour keeps it — but
   * a colour that has no contrast against this paper at all is still a mark
   * you cannot see, so it falls back rather than vanishing.
   */
  const ink = useCallback((c: string) => {
    const resolved = resolveInk(c, dark);
    return contrastsWithPaper(resolved, dark) ? resolved : (dark ? INK.dark : INK.light);
  }, [dark]);

  /** Default ink is stored as a token; a chosen colour is stored literally. */
  const inkToStore = isDefaultInk(color) ? INK_TOKEN : color;

  const selectedItems = useMemo(
    () => doc.items.filter((i) => selectedIds.has(i.id)),
    [doc.items, selectedIds],
  );
  /** One box around everything selected — the thing you actually resize. */
  const selectionBox = useMemo(() => union(selectedItems, measured), [selectedItems, measured]);

  function screenToWorld(clientX: number, clientY: number): Point {
    const rect = hostRef.current!.getBoundingClientRect();
    return toWorld({ x: clientX - rect.left, y: clientY - rect.top }, docRef.current.camera);
  }

  function localPoint(clientX: number, clientY: number): Point {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** Which resize handle is under the cursor, in screen space. */
  function handleAt(local: Point): HandleId | null {
    const box = union(docRef.current.items.filter((i) => selRef.current.has(i.id)), measured);
    if (!box) return null;
    const c = docRef.current.camera;
    for (const h of HANDLES) {
      const p = handlePoint(box, h);
      const s = { x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y };
      if (Math.abs(s.x - local.x) <= HANDLE_GRAB_PX && Math.abs(s.y - local.y) <= HANDLE_GRAB_PX) return h;
    }
    return null;
  }

  useEffect(() => {
    const host = hostRef.current!;
    const ro = new ResizeObserver(() => setView({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host);
    setView({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Measure rendered text and keep the store in step with it. A ResizeObserver
  // rather than a render-time read, so it also catches the font loading late,
  // the window changing, and the text reflowing as it is typed.
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setMeasured((prev) => {
        let next: Map<string, number> | null = null;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.itemId;
          if (!id) continue;
          // Blocks are laid out in screen pixels, so convert back to world.
          const world = entry.contentRect.height / docRef.current.camera.zoom;
          if (!Number.isFinite(world) || world <= 0) continue;
          const was = prev.get(id);
          if (was !== undefined && Math.abs(was - world) < 0.5) continue;
          next ??= new Map(prev);
          next.set(id, world);
        }
        return next ?? prev;
      });
    });
    for (const el of textEls.current.values()) ro.observe(el);

    // Forget items that are gone, so the store cannot grow for the life of
    // the session on a board that is edited a lot.
    setMeasured((prev) => {
      const live = new Set(textEls.current.keys());
      if ([...prev.keys()].every((id) => live.has(id))) return prev;
      return new Map([...prev].filter(([id]) => live.has(id)));
    });

    return () => ro.disconnect();
  }, [textKey]);

  // --- zoom & pan via wheel (non-passive so we can preventDefault) --------
  useEffect(() => {
    const host = hostRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = docRef.current.camera;
      const rect = host.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const wx = (sx - c.x) / c.zoom, wy = (sy - c.y) / c.zoom;
        const floor = locked ? c.zoom
          : minUsefulZoom(union(docRef.current.items), host.clientWidth, host.clientHeight);
        const zoom = clamp(c.zoom * Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY), floor, locked ? c.zoom : MAX_ZOOM);
        setDoc({ ...docRef.current, camera: { x: sx - wx * zoom, y: sy - wy * zoom, zoom } }, false);
      } else {
        if (locked) return;
        setDoc({ ...docRef.current, camera: { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY } }, false);
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [setDoc, locked]);

  useCanvasCommands({
    docRef, selRef, hostRef, measured, setDoc, setSelectedIds,
    setEditingId, setSpaceDown, beginEditing, clipboard,
  });

  // --- pointer -----------------------------------------------------------
  function onHostPointerDown(e: React.PointerEvent) {
    if (editingId) setEditingId(null);
    const local = localPoint(e.clientX, e.clientY);
    const p = screenToWorld(e.clientX, e.clientY);

    // Nothing under the cursor reaches here: items stop propagation and are
    // handled by itemPointerDown, so `hit` is null by construction.
    const intent = decidePress({
      tool, middleButton: e.button === 1, spaceDown, locked,
      shiftKey: e.shiftKey, hit: null, handle: handleAt(local), isDouble: false,
    });
    if (!intent) return; // locked camera swallowed a pan

    // Capture only for gestures that keep tracking off the element. Capturing
    // for a placing tool sends the click to the host and blurs the editor that
    // is about to open.
    if (shouldCapturePointer(intent)) hostRef.current!.setPointerCapture(e.pointerId);

    if (intent.kind === "pan") {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, cam: { ...docRef.current.camera } };
      setDragging(true);
      return;
    }

    if (intent.kind === "resize" && selectionBox) {
      pushHistory();
      drag.current = { mode: "resize", handle: intent.handle, origin: p, startBox: selectionBox, snapshot: selectedItems };
      setDragging(true);
      return;
    }

    if (intent.kind === "marquee") {
      drag.current = { mode: "marquee", origin: p, additive: intent.additive, base: new Set(selectedIds) };
      setDragging(true);
      if (!intent.additive) setSelectedIds(new Set());
      return;
    }

    switch (tool) {
      case "pen":
        drag.current = { mode: "draw" };
        // A shape may legitimately have no outline; a pen stroke may not — that is
        // just an invisible mark. Clamp rather than let the tool draw nothing.
        setDraft({ id: uid(), type: "stroke", points: [p.x, p.y], color: inkToStore, size: widthForTool("pen", size) });
        return;
      case "rect":
      case "ellipse":
      case "arrow": {
        const shape = tool === "arrow" ? "arrow" : tool;
        drag.current = { mode: "shape" };
        setDraft({ id: uid(), type: "shape", shape, x: p.x, y: p.y, w: 0, h: 0, color: inkToStore, size, fill } as ShapeItem);
        return;
      }
      case "text": {
        const id = uid();
        setDoc({ ...docRef.current, items: [...docRef.current.items, { id, type: "text", x: p.x, y: p.y, w: 220, text: "", color: inkToStore, fontSize: 20 }] });
        setSelectedIds(new Set([id])); editorOpenedAt.current = Date.now(); setEditingId(id); setTool("select");
        return;
      }
      case "comment":
        // The bubble appears here and takes the typing directly.
        setDraftComment({ x: p.x, y: p.y, text: "" });
        setEditingPin(null);
        return;
      case "note": {
        const id = uid();
        setDoc({ ...docRef.current, items: [...docRef.current.items, { id, type: "note", x: p.x, y: p.y, w: 180, h: 180, text: "", color: "#ffe27a" }] });
        setSelectedIds(new Set([id])); editorOpenedAt.current = Date.now(); setEditingId(id); setTool("select");
        return;
      }
      default:
        break;
    }
  }

  function onHostPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const p = screenToWorld(e.clientX, e.clientY);

    if (!d) {
      if (tool === "select" && !spaceDown) {
        const h = handleAt(localPoint(e.clientX, e.clientY));
        setHoverCursor(h ? CURSOR[h] : null);
      } else if (hoverCursor) setHoverCursor(null);
      return;
    }

    if (d.mode === "pan") {
      setDoc({ ...docRef.current, camera: { ...docRef.current.camera, x: d.cam.x + (e.clientX - d.sx), y: d.cam.y + (e.clientY - d.sy) } }, false);
      return;
    }
    if (d.mode === "draw") {
      setDraft((cur) => (cur && cur.type === "stroke" ? { ...cur, points: [...cur.points, p.x, p.y] } : cur));
      return;
    }
    if (d.mode === "shape") {
      setDraft((cur) => (cur && cur.type === "shape" ? { ...cur, w: p.x - cur.x, h: p.y - cur.y } : cur));
      return;
    }
    if (d.mode === "marquee") {
      const box = normalize(d.origin, p);
      setMarquee(box);
      const inside = selectable(docRef.current.items).filter((i) => overlaps(bbox(i, measured), box)).map((i) => i.id);
      select(d.additive ? new Set([...d.base, ...inside]) : new Set(inside));
      return;
    }
    if (d.mode === "move") {
      let dx = p.x - d.origin.x;
      let dy = p.y - d.origin.y;
      if (!d.moved && travelled(d.origin, p, docRef.current.camera.zoom) < DRAG_SLOP_PX) return;
      if (!d.moved) pushHistory();
      d.moved = true;

      const sel = selRef.current;
      const box = union(d.snapshot.filter((i) => sel.has(i.id)), measured);
      if (box) {
        const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
        const others = docRef.current.items.filter((i) => !sel.has(i.id)).map((i) => bbox(i, measured));
        const snap = snapMove(moved, others, SNAP_PX / docRef.current.camera.zoom);
        dx += snap.dx;
        dy += snap.dy;
        setGuides(snap.guides);
      }
      setDoc({ ...docRef.current, items: d.snapshot.map((i) => (sel.has(i.id) ? translate(i, dx, dy) : i)) }, false);
      return;
    }
    if (d.mode === "resize") {
      const next = resizeRect(d.startBox, d.handle, p.x - d.origin.x, p.y - d.origin.y, MIN_ITEM_SIZE);
      const byId = new Map(d.snapshot.map((i) => [i.id, i]));
      setDoc({
        ...docRef.current,
        items: docRef.current.items.map((i) => {
          const original = byId.get(i.id);
          return original ? fitTo(original, d.startBox, next, measured) : i;
        }),
      }, false);
    }
  }

  function onHostPointerUp() {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setGuides([]);
    setMarquee(null);
    if (!d) return;

    if (d.mode === "draw" && draft && draft.type === "stroke") {
      // Keep a single tap: it is a dot, not a mistake.
      if (draft.points.length >= 2) setDoc({ ...docRef.current, items: [...docRef.current.items, draft] });
      setDraft(null);
      return;
    }
    if (d.mode === "shape" && draft && draft.type === "shape") {
      if (Math.abs(draft.w) > 4 || Math.abs(draft.h) > 4) {
        const made = draft.shape === "arrow" ? draft : normRect(draft);
        setDoc({ ...docRef.current, items: [...docRef.current.items, made] });
      }
      setDraft(null);
      return;
    }
    // Nothing to commit: move and resize already took their undo point at the
    // start of the gesture, and streamed every frame after it with history off.
  }

  /** Text and sticky notes are edited in place; this opens the editor. */
  function beginEditing(item: Item) {
    if (item.type !== "text" && item.type !== "note") return false;
    select(new Set([item.id]));
    editorOpenedAt.current = Date.now();
    setEditingId(item.id);
    return true;
  }

  /** A blur arriving with the opening click is not the person leaving. */
  function onEditorBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    if (Date.now() - editorOpenedAt.current < EDITOR_SETTLE_MS) {
      e.target.focus();
      return;
    }
    setEditingId(null);
  }

  /** Pointer down on an item, in select mode. */
  function itemPointerDown(e: React.PointerEvent, item: Item) {
    if (tool !== "select" || spaceDown || item.locked) return;
    e.stopPropagation();

    // Detect the double-click ourselves rather than relying on the dblclick
    // event: capturing the pointer on the host (which we must do, so a drag
    // that leaves the item keeps tracking) redirects the click to the host,
    // so dblclick never reaches the text or note and neither could be edited.
    // One clock. `e.timeStamp` is milliseconds since page load (~1e5) and
    // Date.now() is epoch (~1e12); the old `e.timeStamp || Date.now()` mixed
    // them, and a single fallback poisoned lastClick with a number twelve
    // orders of magnitude out — after which no two presses ever compared as a
    // double-click again, for the rest of the session.
    const now = Date.now();
    const intent = decidePress({
      tool, middleButton: false, spaceDown, locked, shiftKey: e.shiftKey,
      hit: item, handle: null,
      isDouble: isDoubleClick(lastClick.current, item.id, now),
      alreadySelected: selectedIds.has(item.id) && selectedIds.size === 1,
    });
    lastClick.current = { id: item.id, at: now };
    if (intent?.kind === "edit" && beginEditing(item)) return;

    hostRef.current!.setPointerCapture(e.pointerId);

    let next: Set<string>;
    if (e.shiftKey) {
      next = new Set(selectedIds);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
    } else {
      // Clicking inside an existing multi-selection keeps it, so the whole
      // group can be dragged in one gesture.
      next = selectedIds.has(item.id) ? new Set(selectedIds) : new Set([item.id]);
    }
    select(next);
    drag.current = {
      mode: "move",
      origin: screenToWorld(e.clientX, e.clientY),
      snapshot: docRef.current.items,
      moved: false,
    };
    setDragging(true);
  }

  function setItemText(id: string, text: string) {
    setDoc({ ...docRef.current, items: docRef.current.items.map((i) => (i.id === id && (i.type === "text" || i.type === "note") ? { ...i, text } : i)) }, false);
  }

  // World → screen, for laying blocks out in device pixels.
  const sx = (x: number) => x * cam.zoom + cam.x;
  const sy = (y: number) => y * cam.zoom + cam.y;

  /**
   * The world rectangle currently visible, which becomes the SVG viewBox.
   *
   * This is what makes the board vector rather than raster. The old layout put
   * everything inside a div carrying `transform: scale(zoom)`, and a CSS scale
   * rasterises its whole subtree once at 1x and then stretches that bitmap —
   * so strokes, arrows, text, images and even the selection outline turned to
   * mush the moment you zoomed in. Handing the camera to the SVG as a viewBox
   * instead means the vectors are re-rendered at device resolution at every
   * zoom level, and laying the DOM blocks out in screen pixels means their
   * text and images are, too.
   */
  /** The invisible band that makes a thin thing clickable, in WORLD units —
   *  computed from a constant screen width so the grab area feels the same at
   *  every zoom. A fixed world width was unclickable zoomed out and enormous
   *  zoomed in. */
  const grid = gridSpacing(cam.zoom);

  const hitBand = (size: number) => Math.max(size, (HIT_SLOP_PX * 2) / cam.zoom);

  const viewBox = `${-cam.x / cam.zoom} ${-cam.y / cam.zoom} ${Math.max(1, view.w / cam.zoom)} ${Math.max(1, view.h / cam.zoom)}`;

  // Painter's order. `ordered` returns the array untouched when it is already
  // sorted by index, which it is except immediately after a reorder.
  const items = ordered(draft ? [...doc.items, draft] : doc.items);
  const vectors = items.filter((i) => i.type === "stroke" || i.type === "shape");
  const blocks = items.filter((i) =>
    i.type === "text" || i.type === "note" || i.type === "media" || i.type === "excerpt");

  const cursor = hoverCursor
    ?? (spaceDown || tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair");

  /** A media card is a door: double-click opens it in the focus viewer. */
  function openMedia(e: React.MouseEvent, it: Item) {
    if (it.type !== "media") return;
    e.stopPropagation();
    onOpenMedia(it.id);
  }

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      style={{ cursor }}
      onPointerDown={onHostPointerDown}
      onPointerMove={onHostPointerMove}
      onPointerUp={onHostPointerUp}
      onPointerCancel={onHostPointerUp}
    >
      {/* dotted infinite background follows the camera */}
      {/* The grid steps by decades so the dots stay in a readable band at
          every zoom, instead of turning to mush zoomed out and vanishing
          zoomed in. */}
      <div
        className="canvas-grid"
        style={{
          backgroundPosition: `${cam.x}px ${cam.y}px`,
          backgroundSize: `${grid.world * cam.zoom}px ${grid.world * cam.zoom}px`,
        }}
      />

      {/* Vector layer: viewport-sized, camera carried by the viewBox, so every
          stroke and outline is re-rasterised at device resolution as you zoom
          rather than being a scaled-up picture of itself. */}
      <svg className="vector-layer" width={view.w} height={view.h} viewBox={viewBox} preserveAspectRatio="none">
          {vectors.map((it) =>
            it.type === "stroke" ? (
              <g key={it.id}>
                {/* wide invisible hit area for easy selection */}
                <path d={polylinePath(it.points)} stroke="transparent" strokeWidth={hitBand(it.size)} fill="none" strokeLinecap="round" style={{ pointerEvents: tool === "select" && !it.locked ? "stroke" : "none", cursor: "move" }} onPointerDown={(e) => itemPointerDown(e, it)} />
                {it.points.length >= 4 ? (
                  <path d={inkOutline(it.points, it.size)} fill={ink(it.color)} style={{ pointerEvents: "none" }} />
                ) : (
                  // A lone dot has no outline to fill; draw the nib itself.
                  <circle cx={it.points[0]} cy={it.points[1]} r={Math.max(0.5, it.size / 2)} fill={ink(it.color)} style={{ pointerEvents: "none" }} />
                )}
              </g>
            ) : (
              <ShapeView key={it.id} item={it as ShapeItem} ink={ink} hitBand={hitBand(it.size)} selectable={tool === "select" && !it.locked} onDown={(e) => itemPointerDown(e, it)} />
            )
          )}
        </svg>

      {/* Block layer: laid out in screen pixels. Text is rendered by the font
          engine at its on-screen size, and an image is drawn from its own
          pixels — neither is a bitmap of a smaller version blown up. */}
      <div className="world">
        {blocks.map((it) => {
          const b = bbox(it, measured);
          const selected = selectedIds.has(it.id);
          const z = cam.zoom;
          return (
            <div key={it.id} className={"block" + (selected ? " selected" : "") + (it.locked ? " is-locked" : "")} style={{ left: sx(b.x), top: sy(b.y), width: b.w * z, ...(it.type !== "text" ? { height: b.h * z } : {}) }} onPointerDown={(e) => itemPointerDown(e, it)}>
              {it.type === "text" && (
                editingId === it.id ? (
                  <textarea autoFocus className="text-edit" style={{ color: ink(it.color), fontSize: it.fontSize * cam.zoom }} value={it.text} onChange={(e) => setItemText(it.id, e.target.value)} onBlur={onEditorBlur} onPointerDown={(e) => e.stopPropagation()} />
                ) : (
                  <div
                    className="text-view"
                    data-item-id={it.id}
                    ref={(el) => {
                      if (el) textEls.current.set(it.id, el);
                      else textEls.current.delete(it.id);
                    }}
                    style={{ color: ink(it.color), fontSize: it.fontSize * cam.zoom }}
                  >
                    {it.text || <span className="placeholder">Text</span>}
                  </div>
                )
              )}
              {it.type === "note" && (
                <div className="note" style={{ background: it.color, fontSize: 14 * cam.zoom, borderRadius: 6 * cam.zoom }}>
                  {editingId === it.id ? (
                    <textarea autoFocus className="note-edit" style={{ fontSize: 14 * cam.zoom }} value={it.text} onChange={(e) => setItemText(it.id, e.target.value)} onBlur={onEditorBlur} onPointerDown={(e) => e.stopPropagation()} />
                  ) : (
                    <div className="note-text">{it.text || <span className="placeholder">Note…</span>}</div>
                  )}
                </div>
              )}
              {it.type === "excerpt" && (
                <div className="excerpt" style={{ borderColor: it.color }}>
                  {it.image && <img className="excerpt-image" src={it.image} alt="" draggable={false} />}
                  <div className="excerpt-text">{it.text}</div>
                  {/* The backlink is the whole point: this card is a view of a
                      place in a file, not a detached copy of it. */}
                  <button
                    className="excerpt-source"
                    style={{ color: it.color }}
                    title={`Back to ${it.sourceName}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onOpenExcerptSource(it); }}
                  >
                    ↩ {it.sourceName}
                    {it.source.page !== undefined && <span className="tc">p.{it.source.page}</span>}
                    {it.source.time !== undefined && <span className="tc">{fmtTime(it.source.time)}</span>}
                  </button>
                </div>
              )}
              {it.type === "media" && (
                <div className="media" onDoubleClick={(e) => openMedia(e, it)}>
                  {it.kind === "image" && <MediaImage item={it as MediaItem} />}
                  {it.kind === "video" && <MediaVideo item={it as MediaItem} />}
                  {it.kind === "audio" && <MediaAudio item={it as MediaItem} />}
                  {it.kind === "pdf" && <PdfThumb item={it as MediaItem} zoom={cam.zoom} />}
                  {it.kind === "doc" && <DocThumb item={it as MediaItem} />}
                  {it.kind === "model" && (
                    <div className="model-card">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 12l9-5M12 12v10M12 12L3 7" />
                      </svg>
                      <div className="model-name">{it.name}</div>
                    </div>
                  )}
                  <button
                    className="media-open"
                    title="Open and annotate"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => openMedia(e, it)}
                  >Annotate</button>
                  {!!annotationCounts.get(it.id) && (
                    <button
                      className="media-badge"
                      title={`${annotationCounts.get(it.id)} open note(s)`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openMedia(e, it)}
                    >{annotationCounts.get(it.id)}</button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* comments dropped straight onto the canvas */}
        {boardNotes.map((a) => (
          <button
            key={a.id}
            className="board-pin"
            style={{ left: sx(a.anchor.worldX ?? 0), top: sy(a.anchor.worldY ?? 0), background: a.color }}
            title={`${a.author}: ${a.text}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { setEditingPin({ id: a.id, text: a.text }); setDraftComment(null); }}
            onDoubleClick={() => onOpenAnnotation(a)}
          >
            {editingPin?.id === a.id ? (
              <textarea
                autoFocus
                className="pin-edit"
                value={editingPin.text}
                onChange={(e) => setEditingPin({ id: a.id, text: e.target.value })}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={() => { onEditBoardComment(a, editingPin.text); setEditingPin(null); }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") { setEditingPin(null); }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
                }}
              />
            ) : (
              <span className="board-pin-text">{a.text}</span>
            )}
          </button>
        ))}

        {/* A new bubble, typed into where it was dropped. */}
        {draftComment && (
          <div
            className="board-pin is-draft"
            style={{ left: sx(draftComment.x), top: sy(draftComment.y), background: "#2563eb" }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <textarea
              autoFocus
              className="pin-edit"
              placeholder="What's here?"
              value={draftComment.text}
              onChange={(e) => setDraftComment({ ...draftComment, text: e.target.value })}
              onBlur={() => { onBoardComment(draftComment, draftComment.text); setDraftComment(null); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") { setDraftComment(null); }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
              }}
            />
          </div>
        )}

        {/* Alignment guides, drawn only while something is actually moving. */}
        {guides.map((g, n) => (
          <div
            key={n}
            className="snap-guide"
            style={g.axis === "x"
              ? { left: sx(g.at), top: sy(g.from), height: (g.to - g.from) * cam.zoom, width: 0 }
              : { top: sy(g.at), left: sx(g.from), width: (g.to - g.from) * cam.zoom, height: 0 }}
          />
        ))}

        {/* One outline per selected item, so you can see what is in the set. */}
        {selectedIds.size > 1 && selectedItems.map((it) => {
          const b = bbox(it, measured);
          return <div key={it.id} className="member-outline" style={{ left: sx(b.x), top: sy(b.y), width: b.w * cam.zoom, height: b.h * cam.zoom }} />;
        })}

        {/* The selection box: one frame around everything held, with handles
            on all eight sides. Resizing it maps every member through the same
            transform, so a group scales as a group. */}
        {selectionBox && !dragging && (
          <div
            className="selection-box"
            style={{ left: sx(selectionBox.x), top: sy(selectionBox.y), width: selectionBox.w * cam.zoom, height: selectionBox.h * cam.zoom }}
          >
            {/* No counter-scaling any more: in screen space a handle is simply
                the size it is drawn. */}
            {HANDLES.map((h) => {
              const p = handlePoint({ x: 0, y: 0, w: selectionBox.w * cam.zoom, h: selectionBox.h * cam.zoom }, h);
              return (
                <div
                  key={h}
                  className="resize-handle"
                  style={{ left: p.x, top: p.y, cursor: CURSOR[h], transform: "translate(-50%, -50%)" }}
                />
              );
            })}
          </div>
        )}

        {/* rubber band */}
        {marquee && (
          <div className="marquee" style={{ left: sx(marquee.x), top: sy(marquee.y), width: marquee.w * cam.zoom, height: marquee.h * cam.zoom }} />
        )}
      </div>
    </div>
  );
}


