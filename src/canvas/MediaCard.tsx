// The media cards: what an image, a video, a PDF, a document or a 3D model
// looks like sitting on the board.
//
// Pure presentation. Nothing here knows about selection, dragging, the camera
// or the document — it is handed an item and draws it, which is why it can
// live away from the 1,000 lines of interaction that used to surround it.

import { useEffect, useState } from "react";
import type { MediaItem } from "../types";
import { useMediaSrc } from "../media";
import { renderPage } from "../pdf";
import { loadDoc } from "../doc";

/**
 * First-page preview of a PDF card.
 *
 * The raster has to follow the camera: rendered once at a fixed width, the page
 * turns to mush the moment you zoom in on it — which is exactly when you want
 * to read it. The target width is quantised to doubling steps so panning and
 * pinching do not trigger a re-render on every frame.
 */
export function PdfThumb({ item, zoom }: { item: MediaItem; zoom: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  // The width the card actually occupies in device pixels, rounded up to the
  // next power of two so there are only a handful of distinct render sizes.
  const wanted = Math.min(4096, Math.max(
    512,
    2 ** Math.ceil(Math.log2(Math.max(1, item.w * zoom * dpr))),
  ));

  useEffect(() => {
    let alive = true;
    renderPage(item.src, item.page ?? 1, wanted)
      .then((r) => { if (alive) { setUrl(r.url); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [item.src, item.page, wanted]);

  if (failed) return <div className="pdf-card pdf-failed">{item.name}</div>;
  if (!url) return <div className="pdf-card">Loading {item.name}…</div>;
  return <img className="pdf-page" src={url} alt={item.name} draggable={false} />;
}


/** A readable preview of a document card, so the board shows the words. */
export function DocThumb({ item }: { item: MediaItem }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDoc(item.src)
      .then((c) => { if (alive) setHtml(c.html); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [item.src]);

  if (failed) return <div className="pdf-card pdf-failed">{item.name}</div>;
  if (html === null) return <div className="pdf-card">Reading {item.name}…</div>;
  return (
    <div className="doc-card">
      <div className="doc-card-name">{item.name}</div>
      <div className="doc-card-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}


/** An image card. Recovers by itself if the asset protocol cannot serve it. */
export function MediaImage({ item }: { item: MediaItem }) {
  const { src, onError, failed } = useMediaSrc(item.src);
  if (failed) return <div className="pdf-card pdf-failed">Could not load {item.name}</div>;
  return <img src={src} onError={onError} draggable={false} alt={item.name} />;
}

export function MediaVideo({ item }: { item: MediaItem }) {
  const { src, onError, failed } = useMediaSrc(item.src);
  if (failed) return <div className="pdf-card pdf-failed">Could not load {item.name}</div>;
  return <video src={src} onError={onError} controls onPointerDown={(e) => e.stopPropagation()} />;
}

export function MediaAudio({ item }: { item: MediaItem }) {
  const { src, onError, failed } = useMediaSrc(item.src);
  return (
    <div className="audio-card" onPointerDown={(e) => e.stopPropagation()}>
      <div className="audio-name">♪ {item.name}</div>
      {failed
        ? <div className="pdf-failed">Could not load this file</div>
        : <audio src={src} onError={onError} controls />}
    </div>
  );
}
