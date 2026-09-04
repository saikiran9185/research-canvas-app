// The focus view: one medium, full attention, and every way to pin a note to it.
//
// Whatever the medium, the geometry is the same — a "stage" rectangle with a
// transparent annotation layer on top. Everything drawn on that layer is stored
// in 0..1 coordinates relative to the stage, so a highlight survives resizing
// the window, zooming the canvas, or opening the board on someone else's screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Annotation, MediaItem } from "./types";
import { fmtTime } from "./types";
import { useMediaSrc } from "./media";
import { renderPage, pageCount, pageSize, renderTextLayer } from "./pdf";
import "./textLayer.css";
import { loadDoc, type DocContent } from "./doc";
import { newAnnotation, type Identity } from "./annotations";
import { cropRegion } from "./render";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

type Mode = "cursor" | "region" | "pin" | "draw";

/** How close the playhead must be for a timed note to show on the frame. */
const TIME_TOLERANCE = 0.4;

interface Props {
  item: MediaItem;
  annotations: Annotation[];
  me: Identity;
  focusId: string | null;
  /** When set, open showing this page / timecode (a followed backlink). */
  openAt?: Annotation["anchor"] | null;
  onClose: () => void;
  onAdd: (a: Annotation) => void;
  onUpdate: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
  /** Lift a piece of this file onto the canvas, keeping a link back here. */
  onExtract: (e: {
    anchor: Annotation["anchor"];
    text: string;
    image?: string;
    sourceName: string;
  }) => void;
}

interface Pending {
  x: number; y: number; w: number; h: number;
  time?: number;
  page?: number;
  scribbles?: { points: number[]; color: string; size: number }[];
  /** The words the reader actually selected, when there are any. */
  quote?: string;
  text: string;
}

export default function MediaViewer({
  item, annotations, me, focusId, openAt, onClose, onAdd, onUpdate, onDelete, onExtract,
}: Props) {
  const isTimed = item.kind === "video" || item.kind === "audio";
  const paged = item.kind === "pdf" || item.kind === "doc";
  const [mode, setMode] = useState<Mode>(isTimed || paged ? "cursor" : "region");
  const [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState<string | null>(focusId);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const stageRef = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ mode: Mode; startX: number; startY: number } | null>(null);

  // --- media playback ----------------------------------------------------
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  // --- pdf ---------------------------------------------------------------
  const [page, setPage] = useState(item.page ?? 1);
  const [pages, setPages] = useState(item.pageCount ?? 0);
  const [pageImg, setPageImg] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  /** The page's intrinsic size in points, used to fit it to the window. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  /** The area available to show the page in, in CSS pixels. */
  const [avail, setAvail] = useState({ w: 900, h: 700 });
  /** Number of selectable text spans; 0 means a scanned page. */
  const [textSpans, setTextSpans] = useState<number | null>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Image / video / audio source, with the asset-protocol fallback.
  const mediaSrc = useMediaSrc(item.src);

  // Measure the space the page has to live in, and keep measuring — the window
  // can be resized and the rail can appear.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setAvail({
        w: Math.max(200, el.clientWidth - padX),
        h: Math.max(200, el.clientHeight - padY),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * The width the page is DISPLAYED at, in CSS pixels: fit to the available
   * box, then scaled by the zoom control.
   */
  const displayW = useMemo(() => {
    if (!natural) return 0;
    const fit = Math.min(avail.w, avail.h * (natural.w / natural.h));
    return Math.max(120, Math.round(fit * zoom));
  }, [natural, avail, zoom]);

  // --- word / text documents ---------------------------------------------
  // The page is rendered at a FIXED width so text never reflows: a highlight
  // stored as a fraction of the page must land on the same words next time.
  const [docContent, setDocContent] = useState<DocContent | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    if (item.kind !== "doc") return;
    let ok = true;
    loadDoc(item.src)
      .then((c) => { if (ok) { setDocContent(c); setDocError(null); } })
      .catch((e) => { if (ok) setDocError(String(e)); });
    return () => { ok = false; };
  }, [item.src, item.kind]);

  // Page count and intrinsic size — cheap, and needed before anything can be
  // laid out.
  useEffect(() => {
    if (item.kind !== "pdf") return;
    let alive = true;
    (async () => {
      try {
        const [n, size] = await Promise.all([pageCount(item.src), pageSize(item.src, page)]);
        if (!alive) return;
        setPages(n);
        setNatural(size);
        setPdfError(null);
      } catch (e) {
        if (alive) setPdfError(String(e));
      }
    })();
    return () => { alive = false; };
  }, [item.src, item.kind, page]);

  // Rasterise the page at the DISPLAY size times the device pixel ratio.
  // Rendering at a fixed guess is what made pages look soft: on a Retina screen
  // a 1050px image shown 800px wide is stretched across 1600 device pixels.
  useEffect(() => {
    if (item.kind !== "pdf" || !displayW) return;
    let alive = true;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    // Cap the raster so a huge zoom cannot allocate an unreasonable canvas.
    const px = Math.min(6000, Math.round(displayW * dpr));
    const id = window.setTimeout(() => {
      renderPage(item.src, page, px)
        .then((r) => { if (alive) { setPageImg(r.url); setPdfError(null); } })
        .catch((e) => { if (alive) setPdfError(String(e)); });
    }, 60); // coalesce bursts while the window is being dragged
    return () => { alive = false; window.clearTimeout(id); };
  }, [item.src, item.kind, page, displayW]);

  /**
   * Lay the selectable text over the rendered page. It has to be re-run
   * whenever the displayed size changes, because pdf.js positions the spans in
   * CSS pixels against a specific width.
   */
  useEffect(() => {
    const el = textLayerRef.current;
    if (item.kind !== "pdf" || !el || !displayW) return;
    let alive = true;
    renderTextLayer(item.src, page, displayW, el)
      .then((n) => { if (alive) setTextSpans(n); })
      .catch(() => {
        // No text layer (a scanned page) — region highlighting still works.
        if (alive) { el.replaceChildren(); setTextSpans(0); }
      });
    return () => { alive = false; };
  }, [item.kind, item.src, page, displayW]);

  /**
   * Turn a live text selection into a pending note: the union of the selection
   * rectangles becomes the anchor, and the selected words become the quote.
   */
  const captureSelection = useCallback(() => {
    if (item.kind !== "pdf") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const layer = textLayerRef.current;
    if (!layer || !sel.anchorNode || !layer.contains(sel.anchorNode)) return;

    const stage = stageRef.current!.getBoundingClientRect();
    const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return;

    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));

    const quote = sel.toString().replace(/\s+/g, " ").trim();
    sel.removeAllRanges();
    if (!quote) return;

    setPending({
      x: (left - stage.left) / stage.width,
      y: (top - stage.top) / stage.height,
      w: (right - left) / stage.width,
      h: (bottom - top) / stage.height,
      page,
      quote,
      text: "",
    });
  }, [item.kind, page]);

  // A followed backlink: open straight at the page or moment it points to.
  useEffect(() => {
    if (!openAt) return;
    if (openAt.page !== undefined) setPage(openAt.page);
    if (openAt.time !== undefined && mediaRef.current) {
      mediaRef.current.currentTime = openAt.time;
      setTime(openAt.time);
    }
  }, [openAt]);

  // Jump to whatever the clicked-through annotation is anchored to.
  useEffect(() => {
    if (!focusId) return;
    const a = annotations.find((x) => x.id === focusId);
    if (!a) return;
    setSelected(a.id);
    if (a.anchor.page) setPage(a.anchor.page);
    if (a.anchor.time !== undefined && mediaRef.current) {
      mediaRef.current.currentTime = a.anchor.time;
      setTime(a.anchor.time);
    }
  }, [focusId, annotations]);

  // --- coordinate helpers ------------------------------------------------
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
  }, []);

  /** The anchor context (page / timecode) a new note should capture. */
  const anchorContext = useCallback(() => {
    const ctx: { time?: number; page?: number } = {};
    if (isTimed) ctx.time = mediaRef.current?.currentTime ?? time;
    if (item.kind === "pdf") ctx.page = page;
    return ctx;
  }, [isTimed, item.kind, page, time]);

  // --- drawing on the annotation layer -----------------------------------
  function layerPointerDown(e: React.PointerEvent) {
    if (mode === "cursor") { setSelected(null); return; }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toNorm(e.clientX, e.clientY);

    // Pause before annotating a moving image, so the note lands on the frame
    // the person is actually looking at.
    if (isTimed && playing) { mediaRef.current?.pause(); setPlaying(false); }

    if (mode === "pin") {
      setPending({ x: p.x, y: p.y, w: 0, h: 0, text: "", ...anchorContext() });
      drawing.current = null;
      return;
    }
    drawing.current = { mode, startX: p.x, startY: p.y };
    if (mode === "region") {
      setPending({ x: p.x, y: p.y, w: 0, h: 0, text: "", ...anchorContext() });
    } else {
      setPending((cur) => ({
        x: 0, y: 0, w: 1, h: 1, text: cur?.text ?? "",
        ...anchorContext(),
        scribbles: [...(cur?.scribbles ?? []), { points: [p.x, p.y], color: me.color, size: 3 }],
      }));
    }
  }

  function layerPointerMove(e: React.PointerEvent) {
    const d = drawing.current;
    if (!d) return;
    const p = toNorm(e.clientX, e.clientY);
    if (d.mode === "region") {
      setPending((cur) => cur && ({
        ...cur,
        x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y),
        w: Math.abs(p.x - d.startX), h: Math.abs(p.y - d.startY),
      }));
    } else if (d.mode === "draw") {
      setPending((cur) => {
        if (!cur?.scribbles?.length) return cur;
        const s = [...cur.scribbles];
        const last = s[s.length - 1];
        s[s.length - 1] = { ...last, points: [...last.points, p.x, p.y] };
        return { ...cur, scribbles: s };
      });
    }
  }

  function layerPointerUp() {
    const d = drawing.current;
    drawing.current = null;
    // A region drag that never really moved is a mis-click, not an annotation.
    if (d?.mode === "region") {
      setPending((cur) => (cur && cur.w < 0.005 && cur.h < 0.005 ? null : cur));
    }
  }

  function commitPending() {
    if (!pending) return;
    const text = pending.text.trim();
    if (!text && !pending.scribbles?.length) { setPending(null); return; }
    onAdd(newAnnotation(
      me,
      {
        itemId: item.id,
        x: pending.x, y: pending.y, w: pending.w, h: pending.h,
        ...(pending.time !== undefined ? { time: pending.time } : {}),
        ...(pending.page !== undefined ? { page: pending.page } : {}),
      },
      text,
      {
        ...(pending.scribbles?.length ? { scribbles: pending.scribbles } : {}),
        ...(pending.quote ? { quote: pending.quote } : {}),
      },
    ));
    setPending(null);
    setMode("cursor");
  }

  /**
   * Lift something out of this file and onto the canvas. The excerpt keeps the
   * anchor, so the card on the board is a view of *this* place in the file
   * rather than a detached copy of it.
   */
  const extract = useCallback(async (
    anchor: Annotation["anchor"],
    text: string,
  ) => {
    const image = await cropRegion(item, anchor, { time: anchor.time, page: anchor.page });
    onExtract({ anchor, text, image, sourceName: item.name });
  }, [item, onExtract]);

  async function extractPending() {
    if (!pending) return;
    const anchor = {
      itemId: item.id,
      x: pending.x, y: pending.y, w: pending.w, h: pending.h,
      ...(pending.time !== undefined ? { time: pending.time } : {}),
      ...(pending.page !== undefined ? { page: pending.page } : {}),
    };
    await extract(anchor, pending.quote || pending.text.trim() || item.name);
    setPending(null);
    setMode("cursor");
  }

  /** One click on the toolbar: pin a note at the current moment, centred. */
  function commentHere() {
    if (isTimed && playing) { mediaRef.current?.pause(); setPlaying(false); }
    setPending({ x: 0.5, y: 0.5, w: 0, h: 0, text: "", ...anchorContext() });
  }

  // --- which annotations belong on the frame right now --------------------
  const visible = useMemo(() => annotations.filter((a) => {
    if (a.id === selected) return true;
    if (a.anchor.page !== undefined && a.anchor.page !== page) return false;
    if (a.anchor.time !== undefined && Math.abs(a.anchor.time - time) > TIME_TOLERANCE) return false;
    return true;
  }), [annotations, page, time, selected]);

  // --- keyboard ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["TEXTAREA", "INPUT"].includes((e.target as HTMLElement)?.tagName);
      if (e.key === "Escape") {
        if (pending) setPending(null);
        else if (editing) setEditing(null);
        else onClose();
        return;
      }
      if (typing) return;
      if (e.key === " " && isTimed) { e.preventDefault(); togglePlay(); }
      if (item.kind === "pdf") {
        if (e.key === "ArrowRight") setPage((p) => Math.min(pages || p, p + 1));
        if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
      }
      if (isTimed) {
        // Arrow keys nudge a frame at a time (assume 30fps for the step).
        if (e.key === "ArrowRight") step(e.shiftKey ? 1 : 1 / 30);
        if (e.key === "ArrowLeft") step(e.shiftKey ? -1 : -1 / 30);
      }
      if (e.key.toLowerCase() === "c") commentHere();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function togglePlay() {
    const m = mediaRef.current;
    if (!m) return;
    if (m.paused) { m.play(); setPlaying(true); } else { m.pause(); setPlaying(false); }
  }

  function step(delta: number) {
    const m = mediaRef.current;
    if (!m) return;
    m.pause(); setPlaying(false);
    m.currentTime = Math.min(m.duration || 0, Math.max(0, m.currentTime + delta));
    setTime(m.currentTime);
  }

  function seekTo(t: number) {
    const m = mediaRef.current;
    if (!m) return;
    m.currentTime = t;
    setTime(t);
  }

  function openAnnotation(a: Annotation) {
    setSelected(a.id);
    if (a.anchor.page) setPage(a.anchor.page);
    if (a.anchor.time !== undefined) seekTo(a.anchor.time);
  }

  // --- render ------------------------------------------------------------
  const timed = annotations
    .filter((a) => a.anchor.time !== undefined)
    .sort((a, b) => (a.anchor.time! - b.anchor.time!));

  return (
    <div className="viewer-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="viewer">
        {/* ---- header ---- */}
        <div className="viewer-head">
          <div className="viewer-title" title={item.src}>
            <span className={`kind-chip kind-${item.kind}`}>{item.kind}</span>
            {item.name}
          </div>
          <div className="viewer-head-actions">
            <button className="ghost-btn" onClick={() => revealItemInDir(item.src).catch(() => {})}>
              Show file
            </button>
            <button className="ghost-btn" onClick={onClose}>Close ⎋</button>
          </div>
        </div>

        <div className="viewer-body">
          {/* ---- stage ---- */}
          <div className="viewer-stage-wrap">
            <div className="viewer-tools">
              {(["cursor", "region", "pin", "draw"] as Mode[]).map((m) => (
                <button
                  key={m}
                  className={"vtool" + (mode === m ? " active" : "")}
                  onClick={() => { setMode(m); if (m !== "draw") setPending(null); }}
                  title={{
                    cursor: item.kind === "pdf" ? "Select text to quote it in a note" : "Look around",
                    region: "Highlight a region, then write a note",
                    pin: "Drop a pin exactly here",
                    draw: "Scribble on this frame",
                  }[m]}
                >
                  {{ cursor: item.kind === "pdf" ? "Select text" : "Look", region: "Highlight", pin: "Pin", draw: "Scribble" }[m]}
                </button>
              ))}
              <div className="vtool-spacer" />
              <button className="vtool primary" onClick={commentHere} title="Comment here (C)">
                + Comment{isTimed ? ` at ${fmtTime(time)}` : item.kind === "pdf" ? ` on p.${page}` : ""}
              </button>
            </div>

            <div className="viewer-stage-scroll" ref={scrollRef}>
              <div
                ref={stageRef}
                className={"viewer-stage mode-" + mode}
                style={item.kind === "pdf" && displayW ? { width: displayW } : undefined}
                onPointerDown={layerPointerDown}
                onPointerMove={layerPointerMove}
                onPointerUp={layerPointerUp}
              >
                {/* the medium itself */}
                {item.kind === "image" && (
                  <img
                    className="stage-media"
                    src={mediaSrc.src}
                    onError={mediaSrc.onError}
                    alt={item.name}
                    draggable={false}
                  />
                )}
                {item.kind === "video" && (
                  <video
                    className="stage-media"
                    ref={mediaRef as React.RefObject<HTMLVideoElement>}
                    src={mediaSrc.src}
                    onError={mediaSrc.onError}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                )}
                {item.kind === "audio" && (
                  <div className="stage-audio">
                    <div className="stage-audio-name">♪ {item.name}</div>
                    <audio
                      ref={mediaRef as React.RefObject<HTMLAudioElement>}
                      src={mediaSrc.src}
                      onError={mediaSrc.onError}
                      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                      onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                    />
                  </div>
                )}
                {item.kind === "pdf" && (
                  pdfError
                    ? <div className="stage-fallback">Could not read this PDF.<br /><small>{pdfError}</small></div>
                    : pageImg
                      ? <>
                          {/* The image is sized in CSS pixels while the bitmap
                              behind it is rendered at device resolution, so the
                              page is sharp and the text layer lines up exactly. */}
                          <img
                            className="stage-media pdf-render"
                            src={pageImg}
                            alt={`page ${page}`}
                            draggable={false}
                            style={{ width: displayW, height: "auto" }}
                          />
                          {/* Invisible, selectable text sitting exactly over the
                              rendered page. Live only in "Select text" mode, so
                              the highlight and scribble tools can still drag. */}
                          <div
                            ref={textLayerRef}
                            className="textLayer"
                            style={{ pointerEvents: mode === "cursor" ? "auto" : "none" }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseUp={captureSelection}
                          />
                        </>
                      : <div className="stage-fallback">Rendering page {page}…</div>
                )}
                {item.kind === "doc" && (
                  docError
                    ? <div className="stage-fallback">Could not read this document.<br /><small>{docError}</small></div>
                    : docContent
                      ? <div className="doc-page" dangerouslySetInnerHTML={{ __html: docContent.html }} />
                      : <div className="stage-fallback">Reading {item.name}…</div>
                )}
                {item.kind === "model" && (
                  <div className="stage-fallback">
                    <strong>{item.name}</strong>
                    <p>3D preview is not built yet — comments you pin here are stored
                    against the file and will light up once it lands.</p>
                  </div>
                )}

                {/* annotation layer */}
                <svg className="anno-layer" viewBox="0 0 1 1" preserveAspectRatio="none">
                  {visible.map((a) => (
                    <AnnoShape
                      key={a.id}
                      a={a}
                      selected={a.id === selected}
                      onSelect={() => setSelected(a.id)}
                    />
                  ))}
                  {pending && <PendingShape p={pending} color={me.color} />}
                </svg>

                {/* numbered markers, so a note is findable even when tiny */}
                {visible.map((a, i) => (
                  <button
                    key={a.id}
                    className={"anno-marker" + (a.id === selected ? " selected" : "")}
                    style={{
                      left: `${(a.anchor.x + a.anchor.w) * 100}%`,
                      top: `${a.anchor.y * 100}%`,
                      background: a.color,
                    }}
                    title={`${a.author}: ${a.text}`}
                    onPointerDown={(e) => { e.stopPropagation(); setSelected(a.id); }}
                  >
                    {i + 1}
                  </button>
                ))}

                {/* composer, anchored to what is being annotated */}
                {pending && (
                  <div
                    className="composer"
                    style={{
                      left: `${Math.min(0.72, pending.x + pending.w) * 100}%`,
                      top: `${Math.min(0.8, pending.y) * 100}%`,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="composer-meta">
                      <span className="dot" style={{ background: me.color }} />
                      {me.name}
                      {pending.time !== undefined && <span className="tc">{fmtTime(pending.time)}</span>}
                      {pending.page !== undefined && <span className="tc">p.{pending.page}</span>}
                    </div>
                    {pending.quote && (
                      <blockquote className="composer-quote" title={pending.quote}>
                        {pending.quote}
                      </blockquote>
                    )}
                    <textarea
                      autoFocus
                      placeholder="What do you want to say about this?"
                      value={pending.text}
                      onChange={(e) => setPending({ ...pending, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitPending(); }
                      }}
                    />
                    <div className="composer-actions">
                      <button className="ghost-btn" onClick={() => setPending(null)}>Cancel</button>
                      <button
                        className="ghost-btn"
                        title="Put this on the canvas with a link back to here"
                        onClick={extractPending}
                      >→ Canvas</button>
                      <button className="cta small" onClick={commitPending}>Comment ⌘↵</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ---- transport: video / audio ---- */}
            {isTimed && (
              <div className="transport">
                <button className="vtool" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
                <button className="vtool" onClick={() => step(-1 / 30)} title="Previous frame">⟨</button>
                <button className="vtool" onClick={() => step(1 / 30)} title="Next frame">⟩</button>
                <span className="tc mono">{fmtTime(time)} / {fmtTime(duration)}</span>
                <Timeline
                  duration={duration}
                  time={time}
                  marks={timed}
                  onSeek={seekTo}
                  onPick={openAnnotation}
                />
              </div>
            )}

            {/* ---- pager: pdf ---- */}
            {item.kind === "pdf" && (
              <div className="transport">
                <button className="vtool" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>⟨</button>
                <span className="tc mono">Page {page}{pages ? ` / ${pages}` : ""}</span>
                <button className="vtool" onClick={() => setPage((p) => Math.min(pages || p + 1, p + 1))} disabled={!!pages && page >= pages}>⟩</button>

                <div className="zoom-group">
                  <button className="vtool" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5}>−</button>
                  <button className="vtool zoom-level" title="Fit to window" onClick={() => setZoom(1)}>
                    {Math.round(zoom * 100)}%
                  </button>
                  <button className="vtool" title="Zoom in" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} disabled={zoom >= 4}>+</button>
                </div>

                {textSpans === 0 && (
                  <span className="scan-warn" title="This page has no embedded text — it is probably a scan or an image-only export.">
                    No text layer — use Highlight
                  </span>
                )}
                <div className="page-dots">
                  {Array.from({ length: Math.min(pages, 60) }, (_, i) => i + 1).map((n) => {
                    const has = annotations.some((a) => a.anchor.page === n);
                    return (
                      <button
                        key={n}
                        className={"page-dot" + (n === page ? " current" : "") + (has ? " has" : "")}
                        title={`Page ${n}${has ? " — has notes" : ""}`}
                        onClick={() => setPage(n)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ---- comment rail ---- */}
          <div className="viewer-rail">
            <div className="rail-head">
              {annotations.length} note{annotations.length === 1 ? "" : "s"} on this file
            </div>
            <div className="rail-list">
              {annotations.length === 0 && (
                <p className="rail-empty">
                  Nothing here yet. Use <b>Highlight</b> to box a region, <b>Pin</b> to mark a
                  spot{isTimed ? ", or just hit " : ""}{isTimed && <b>+ Comment</b>}{isTimed ? " at the moment that matters." : "."}
                </p>
              )}
              {annotations.map((a) => (
                <div
                  key={a.id}
                  className={"rail-item" + (a.id === selected ? " selected" : "")}
                  onClick={() => openAnnotation(a)}
                >
                  <div className="rail-item-head">
                    <span className="dot" style={{ background: a.color }} />
                    <b>{a.author}</b>
                    {a.anchor.time !== undefined && <span className="tc">{fmtTime(a.anchor.time)}</span>}
                    {a.anchor.page !== undefined && <span className="tc">p.{a.anchor.page}</span>}
                    {a.resolved && <span className="tc done">resolved</span>}
                  </div>
                  {editing === a.id ? (
                    <>
                      <textarea
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="composer-actions">
                        <button className="ghost-btn" onClick={(e) => { e.stopPropagation(); setEditing(null); }}>Cancel</button>
                        <button
                          className="cta small"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdate({ ...a, text: editText, updatedAt: Date.now() });
                            setEditing(null);
                          }}
                        >Save</button>
                      </div>
                    </>
                  ) : (
                    <>
                      {a.quote && <blockquote className="rail-quote">{a.quote}</blockquote>}
                      <div className="rail-item-text">
                        {a.text || (a.quote ? <i>(highlight)</i> : <i>(scribble only)</i>)}
                      </div>
                    </>
                  )}
                  {a.authorId === me.id && editing !== a.id && (
                    <div className="rail-item-actions">
                      <button onClick={(e) => { e.stopPropagation(); setEditing(a.id); setEditText(a.text); }}>Edit</button>
                      <button
                        title="Put this on the canvas with a link back to here"
                        onClick={(e) => { e.stopPropagation(); extract(a.anchor, a.quote || a.text); }}
                      >→ Canvas</button>
                      <button onClick={(e) => { e.stopPropagation(); onUpdate({ ...a, resolved: !a.resolved, updatedAt: Date.now() }); }}>
                        {a.resolved ? "Reopen" : "Resolve"}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(a); }}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- pieces ---------------------------------------------------------------

function AnnoShape({ a, selected, onSelect }: { a: Annotation; selected: boolean; onSelect: () => void }) {
  const { x, y, w, h } = a.anchor;
  return (
    <g onPointerDown={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: "pointer" }}>
      {w > 0.001 && h > 0.001 && (
        <rect
          x={x} y={y} width={w} height={h}
          fill={a.color} fillOpacity={selected ? 0.28 : 0.16}
          stroke={a.color} strokeWidth={selected ? 0.004 : 0.002}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {a.scribbles?.map((s, i) => (
        <path
          key={i}
          d={pathOf(s.points)}
          fill="none"
          stroke={s.color}
          strokeWidth={0.004}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function PendingShape({ p, color }: { p: Pending; color: string }) {
  return (
    <g pointerEvents="none">
      {p.w > 0.001 && p.h > 0.001 && (
        <rect x={p.x} y={p.y} width={p.w} height={p.h}
          fill={color} fillOpacity={0.2} stroke={color} strokeWidth={0.003}
          strokeDasharray="0.01 0.008" vectorEffect="non-scaling-stroke" />
      )}
      {p.scribbles?.map((s, i) => (
        <path key={i} d={pathOf(s.points)} fill="none" stroke={s.color}
          strokeWidth={0.004} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  );
}

function pathOf(points: number[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`;
  return d;
}

/** Scrub bar with a tick for every timed note on this medium. */
function Timeline({
  duration, time, marks, onSeek, onPick,
}: {
  duration: number;
  time: number;
  marks: Annotation[];
  onSeek: (t: number) => void;
  onPick: (a: Annotation) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrub = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (duration || 0));
  };
  return (
    <div
      className="timeline"
      ref={ref}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons === 1) scrub(e.clientX); }}
    >
      <div className="timeline-track" />
      <div className="timeline-fill" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
      {marks.map((a) => (
        <button
          key={a.id}
          className="timeline-mark"
          style={{ left: `${duration ? (a.anchor.time! / duration) * 100 : 0}%`, background: a.color }}
          title={`${fmtTime(a.anchor.time!)} — ${a.author}: ${a.text}`}
          onPointerDown={(e) => { e.stopPropagation(); onPick(a); }}
        />
      ))}
      <div className="timeline-head" style={{ left: `${duration ? (time / duration) * 100 : 0}%` }} />
    </div>
  );
}
