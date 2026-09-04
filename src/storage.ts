// Thin wrappers around the Rust file-system commands + dialog pickers.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { MediaKind } from "./types";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export const storage = {
  defaultWorkspace: () => invoke<string>("default_workspace"),
  listDir: (path: string) => invoke<DirEntry[]>("list_dir", { path }),
  readText: (path: string) => invoke<string>("read_file_text", { path }),
  writeText: (path: string, contents: string) =>
    invoke<void>("write_file_text", { path, contents }),
  makeDir: (path: string) => invoke<void>("make_dir", { path }),
  importMedia: (workspace: string, src: string) =>
    invoke<string>("import_media", { workspace, src }),
  pathExists: (path: string) => invoke<boolean>("path_exists", { path }),
  deletePath: (path: string) => invoke<void>("delete_path", { path }),
  renamePath: (from: string, to: string) =>
    invoke<void>("rename_path", { from, to }),
  // Content-addressed import: the same file imported twice is stored once.
  importMediaHashed: (workspace: string, src: string) =>
    invoke<string>("import_media_hashed", { workspace, src }),
  writeBytes: (path: string, contents: Uint8Array) =>
    invoke<void>("write_file_bytes", { path, contents: Array.from(contents) }),
};

// Turn an absolute disk path into a URL the webview can load (asset protocol).
export function fileUrl(path: string): string {
  return convertFileSrc(path);
}

// Open the OS folder picker; returns the chosen folder path or null.
export async function pickFolder(): Promise<string | null> {
  const res = await open({ directory: true, multiple: false });
  return typeof res === "string" ? res : null;
}

// Open the OS file picker for media; returns absolute paths.
export async function pickMediaFiles(): Promise<string[]> {
  const res = await open({
    multiple: true,
    filters: [
      {
        name: "Media",
        extensions: [
          ...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, ...PDF_EXT, ...MODEL_EXT,
        ],
      },
    ],
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

// Every format the canvas accepts. Images cover the common web-safe set plus
// the ones designers actually hand over (heic/tiff/avif render if the webview
// can decode them; they still import and export either way).
export const IMAGE_EXT = [
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "heif",
  "tif", "tiff", "ico",
];
export const VIDEO_EXT = ["mp4", "mov", "webm", "m4v", "mkv", "avi"];
export const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "aiff"];
export const PDF_EXT = ["pdf"];
export const MODEL_EXT = ["glb", "gltf", "obj", "stl", "fbx", "usdz", "ply"];

export function mediaKind(name: string): MediaKind | null {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (PDF_EXT.includes(ext)) return "pdf";
  if (MODEL_EXT.includes(ext)) return "model";
  return null;
}

/** Default card size on the canvas for each kind of medium. */
export function defaultSize(kind: MediaKind): { w: number; h: number } {
  switch (kind) {
    case "audio": return { w: 340, h: 96 };
    case "video": return { w: 480, h: 300 };
    case "pdf":   return { w: 420, h: 545 };
    case "model": return { w: 360, h: 300 };
    default:      return { w: 340, h: 260 };
  }
}

/** Ask where to write an export, then write it. Returns the path, or null. */
export async function saveTextAs(
  defaultName: string,
  contents: string,
  ext: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return null;
  await storage.writeText(path, contents);
  return path;
}

/** Ask where to write a binary export (the board PDF), then write it. */
export async function saveBytesAs(
  defaultName: string,
  bytes: Uint8Array,
  ext: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return null;
  await storage.writeBytes(path, bytes);
  return path;
}
