// Getting local media into the webview.
//
// Tauri's `asset://` protocol is the efficient route — the webview streams the
// file straight off disk, which matters for video. But it depends on a scope
// setting and on the protocol being reachable at all, and when it fails it
// fails silently: the <img> simply never loads and you get a black rectangle
// with no error anywhere.
//
// So: try the asset URL first, and if the element reports an error, fall back
// to reading the bytes through Rust and handing over a blob URL. That always
// works, because it does not depend on any protocol handler.

import { useCallback, useEffect, useRef, useState } from "react";
import { storage, fileUrl } from "./storage";

/** path -> object URL, so a file is read once no matter how often it is shown. */
const blobs = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  ico: "image/x-icon",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
  mkv: "video/x-matroska", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", flac: "audio/flac", aiff: "audio/aiff",
  pdf: "application/pdf",
};

function mimeOf(path: string): string {
  return MIME[path.toLowerCase().split(".").pop() || ""] ?? "application/octet-stream";
}

/** Read a file through Rust and wrap it in an object URL (cached per path). */
export function blobUrlFor(path: string): Promise<string> {
  const have = blobs.get(path);
  if (have) return Promise.resolve(have);

  let p = pending.get(path);
  if (!p) {
    p = (async () => {
      const bytes = await storage.readBytes(path);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(path) }));
      blobs.set(path, url);
      pending.delete(path);
      return url;
    })();
    pending.set(path, p);
  }
  return p;
}

/**
 * A src for an <img>/<video>/<audio>, with automatic recovery.
 *
 * Use it as:
 *   const { src, onError } = useMediaSrc(item.src);
 *   <img src={src} onError={onError} />
 */
export function useMediaSrc(path: string) {
  const [src, setSrc] = useState(() => fileUrl(path));
  const [failed, setFailed] = useState(false);
  const recovering = useRef(false);

  useEffect(() => {
    // A new file: start from the cheap route again, unless we already have a
    // blob for it from an earlier failure.
    recovering.current = false;
    setFailed(false);
    setSrc(blobs.get(path) ?? fileUrl(path));
  }, [path]);

  const onError = useCallback(() => {
    if (recovering.current) { setFailed(true); return; }
    recovering.current = true;
    blobUrlFor(path)
      .then(setSrc)
      .catch(() => setFailed(true));
  }, [path]);

  return { src, onError, failed };
}
