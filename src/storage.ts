// Thin wrappers around the Rust file-system commands + dialog pickers.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
          "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
          "mp4", "mov", "webm", "m4v",
          "mp3", "wav", "m4a", "aac", "ogg",
        ],
      },
    ],
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export function mediaKind(name: string): "image" | "video" | "audio" | null {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg"].includes(ext)) return "audio";
  return null;
}
