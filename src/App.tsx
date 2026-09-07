import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "./useLatest";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import ShortcutsOverlay from "./ShortcutsOverlay";
import MediaViewer from "./MediaViewer";
import CommentsPanel from "./CommentsPanel";
import {
  storage, pickFolder, pickMediaFiles, mediaKind, defaultSize,
  saveTextAs, saveBytesAs, pickNewCanvasPath, type DirEntry,
} from "./storage";
import { getTheme, applyTheme, isDark, isDefaultInk, INK, type Theme } from "./theme";
import { applyFill, applyInk, applyWidth } from "./interaction";
import { migrateDoc, syncIndices } from "./order";
import { shortcutsAllowed } from "./editorScope";
import { align, distribute, snapToGrid, type Align, type Distribute } from "./arrange";
import { GRID_BASE } from "./constants";
import { DialogHost, askText, askConfirm, showAlert } from "./dialogs";
import Library, { invalidateThumb } from "./Library";
import {
  getIdentity, saveIdentity, loadAnnotations, appendAnnotation,
  annotationsMtime, newAnnotation, toMarkdown, type Identity,
} from "./annotations";
import { checkForUpdatesOnLaunch } from "./updater";
import type { Annotation, CanvasDoc, ExcerptItem, Item, MediaItem, Tool } from "./types";
import { emptyDoc, fmtTime, uid } from "./types";
import "./App.css";

/** How often to re-read the comment files, to pick up a collaborator's sync. */
const SYNC_POLL_MS = 2500;

export default function App() {
  const [workspace, setWorkspace] = useState<string>("");
  const workspaceRef = useLatest(workspace);
  const [currentDir, setCurrentDir] = useState<string>("");
  const [entries, setEntries] = useState<DirEntry[]>([]);

  const [doc, setDocState] = useState<CanvasDoc | null>(null);
  const [canvasPath, setCanvasPath] = useState<string | null>(null);
  const docRef = useLatest(doc);
  const pathRef = useLatest(canvasPath);

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<string>(() => (isDark(getTheme()) ? INK.dark : INK.light));
  const [size, setSize] = useState(3);
  const [fontSize, setFontSize] = useState(20);
  const [fill, setFill] = useState("none");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** Camera lock: freezes pan and zoom so a stray gesture cannot lose the board. */
  const [locked, setLocked] = useState(false);

  // --- annotation layer --------------------------------------------------
  const [me, setMe] = useState<Identity>(() => getIdentity());
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  // The library is the landing view: on launch you see your boards, not a blank canvas.
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [viewerItemId, setViewerItemId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Set when a backlink is followed, so the viewer opens at that page/moment. */
  const [pendingSourceAnchor, setPendingSourceAnchor] = useState<Annotation["anchor"] | null>(null);
  const lastMtime = useRef(0);

  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const [hist, setHist] = useState({ u: 0, r: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // --- appearance --------------------------------------------------------
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const [dark, setDark] = useState<boolean>(() => isDark(getTheme()));
  useEffect(() => { applyTheme(theme); setDark(isDark(theme)); }, [theme]);

  // Follow the palette with the default ink, but never overrule a colour the
  // person picked themselves.
  useEffect(() => {
    setColor((c) => (isDefaultInk(c) ? (isDark(theme) ? INK.dark : INK.light) : c));
  }, [theme]);

  // "Auto" also has to react to the OS flipping at sunset.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setDark(mq.matches);
      setColor((c) => (isDefaultInk(c) ? (mq.matches ? INK.dark : INK.light) : c));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  // --- boot: default workspace ------------------------------------------
  useEffect(() => {
    (async () => {
      const ws = await storage.defaultWorkspace();
      setWorkspace(ws);
      setCurrentDir(ws);
    })();
    // Deferred so the dialog host is mounted before the updater can ask anything.
    const id = window.setTimeout(checkForUpdatesOnLaunch, 1200);
    return () => window.clearTimeout(id);
  }, []);

  const refresh = useCallback(async (dir: string) => {
    try {
      setEntries(await storage.listDir(dir));
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    if (currentDir) refresh(currentDir);
  }, [currentDir, refresh]);

  // --- autosave ---------------------------------------------------------
  const scheduleSave = useCallback((d: CanvasDoc) => {
    if (!pathRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const path = pathRef.current;
    saveTimer.current = window.setTimeout(() => {
      storage.writeText(path, JSON.stringify(d, null, 2)).catch(() => {});
      invalidateThumb(path); // the library must not show yesterday's board
    }, 400);
  }, []);

  // --- doc mutation with history ----------------------------------------

  /**
   * Mark the board as it stands as an undo point.
   *
   * A drag streams dozens of intermediate states, so it has to be applied with
   * history off — but then the gesture leaves no undo step at all, and calling
   * setDoc(…, true) at the *end* records the already-moved board as the thing
   * to go back to, which makes undo a no-op. The undo point has to be taken
   * before the first pixel moves, which is what this is for.
   */
  const pushHistory = useCallback(() => {
    if (!docRef.current) return;
    past.current.push(JSON.stringify(docRef.current));
    if (past.current.length > 80) past.current.shift();
    future.current = [];
    setHist({ u: past.current.length, r: 0 });
  }, []);

  const setDoc = useCallback((next: CanvasDoc, history = true) => {
    // Give any item that lacks a stacking index one consistent with where it
    // already sits in the array. Doing it here rather than at every place that
    // creates an item means there is exactly one rule and no way to forget it:
    // something appended to the end sorts after everything, i.e. on top.
    // syncIndices returns the same array untouched when nothing needs fixing,
    // which is the case on every frame of a drag.
    const synced = syncIndices(next.items);
    if (synced !== next.items) next = { ...next, items: synced };

    if (history && docRef.current) {
      past.current.push(JSON.stringify(docRef.current));
      if (past.current.length > 80) past.current.shift();
      future.current = [];
      setHist({ u: past.current.length, r: 0 });
    }
    setDocState(next);
    scheduleSave(next);
  }, [scheduleSave]);

  const undo = useCallback(() => {
    if (!past.current.length || !docRef.current) return;
    future.current.push(JSON.stringify(docRef.current));
    const prev = JSON.parse(past.current.pop()!);
    setDocState(prev);
    scheduleSave(prev);
    setHist({ u: past.current.length, r: future.current.length });
  }, [scheduleSave]);

  const redo = useCallback(() => {
    if (!future.current.length || !docRef.current) return;
    past.current.push(JSON.stringify(docRef.current));
    const nxt = JSON.parse(future.current.pop()!);
    setDocState(nxt);
    scheduleSave(nxt);
    setHist({ u: past.current.length, r: future.current.length });
  }, [scheduleSave]);

  // --- annotations -------------------------------------------------------
  const reloadAnnotations = useCallback(async (path: string) => {
    try {
      setAnnotations(await loadAnnotations(path));
      lastMtime.current = await annotationsMtime(path);
    } catch {
      setAnnotations([]);
    }
  }, []);

  // Poll the comment folder so notes a collaborator synced in just appear.
  // Cheap: one mtime stat per author file, and a full re-read only on change.
  useEffect(() => {
    if (!canvasPath) return;
    const id = window.setInterval(async () => {
      try {
        const m = await annotationsMtime(canvasPath);
        if (m > lastMtime.current) {
          lastMtime.current = m;
          const fresh = await loadAnnotations(canvasPath);
          setAnnotations((prev) => {
            const added = fresh.filter((a) => a.authorId !== me.id && !prev.some((p) => p.id === a.id));
            if (added.length) say(`${added.length} new note${added.length === 1 ? "" : "s"} from ${added[0].author}`);
            return fresh;
          });
        }
      } catch {
        /* the folder may be mid-sync; the next tick will pick it up */
      }
    }, SYNC_POLL_MS);
    return () => window.clearInterval(id);
  }, [canvasPath, me.id, say]);

  /** Write an annotation and reflect it locally. Append-only — never rewrites. */
  const persist = useCallback(async (a: Annotation) => {
    if (!pathRef.current) return;
    setAnnotations((prev) => {
      const rest = prev.filter((p) => p.id !== a.id);
      return a.deleted ? rest : [...rest, a].sort((x, y) => x.createdAt - y.createdAt);
    });
    try {
      await appendAnnotation(pathRef.current, a);
      lastMtime.current = await annotationsMtime(pathRef.current);
    } catch (e) {
      say(`Could not save that note: ${e}`);
    }
  }, [say]);

  const addAnnotation = useCallback((a: Annotation) => { persist(a); }, [persist]);
  const updateAnnotation = useCallback((a: Annotation) => {
    persist({ ...a, updatedAt: Date.now() });
  }, [persist]);
  const deleteAnnotation = useCallback((a: Annotation) => {
    // A delete is a tombstone line, so it propagates through a synced folder
    // exactly like any other edit.
    persist({ ...a, deleted: true, updatedAt: Date.now() });
  }, [persist]);

  // --- style controls ----------------------------------------------------

  /**
   * A style control does two jobs, and doing only the first is why "no fill"
   * and the colour swatches appeared dead: it sets the default for the *next*
   * thing you draw, and it restyles whatever is selected right now. Every
   * canvas app works this way, and without the second half the controls look
   * broken rather than merely limited.
   */
  const restyle = useCallback((patch: (it: Item) => Item) => {
    const d = docRef.current;
    if (!d || !selectedIds.size) return;
    setDoc({ ...d, items: d.items.map((i) => (selectedIds.has(i.id) ? patch(i) : i)) });
  }, [selectedIds, setDoc]);

  const chooseColor = useCallback((c: string) => {
    setColor(c);
    restyle((i) => applyInk(i, c));
  }, [restyle]);

  const chooseSize = useCallback((n: number) => {
    setSize(n);
    restyle((i) => applyWidth(i, n));
  }, [restyle]);

  const chooseFontSize = useCallback((n: number) => {
    setFontSize(n);
    restyle((i) => (i.type === "text" ? { ...i, fontSize: n } : i));
  }, [restyle]);

  /** Tidying commands. They act on the selection and land one undo step. */
  const doAlign = useCallback((how: Align) => {
    const d = docRef.current;
    if (!d) return;
    const next = align(d.items, selectedIds, how);
    if (next !== d.items) setDoc({ ...d, items: next });
  }, [selectedIds, setDoc]);

  const doDistribute = useCallback((axis: Distribute) => {
    const d = docRef.current;
    if (!d) return;
    const next = distribute(d.items, selectedIds, axis);
    if (next !== d.items) setDoc({ ...d, items: next });
  }, [selectedIds, setDoc]);

  const doSnapToGrid = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const next = snapToGrid(d.items, selectedIds, GRID_BASE);
    if (next !== d.items) setDoc({ ...d, items: next });
  }, [selectedIds, setDoc]);

  const toggleTextStyle = useCallback((which: "bold" | "italic") => {
    const d = docRef.current;
    if (!d) return;
    const chosen = d.items.filter((i) => selectedIds.has(i.id) && i.type === "text");
    if (!chosen.length) return;
    // Turn the whole selection on unless it is already all on, which is what
    // makes a style button feel like one switch rather than several.
    const turnOn = !chosen.every((i) => i.type === "text" && i[which]);
    setDoc({ ...d, items: d.items.map((i) =>
      selectedIds.has(i.id) && i.type === "text" ? { ...i, [which]: turnOn || undefined } : i) });
  }, [selectedIds, setDoc]);

  const chooseFill = useCallback((c: string) => {
    setFill(c);
    restyle((i) => applyFill(i, c));
  }, [restyle]);

  // --- file / folder ops -------------------------------------------------
  const openCanvas = useCallback(async (path: string) => {
    const text = await storage.readText(path);
    try {
      // Boards written before stacking indices existed get them from the array
      // order they were saved in, so nothing moves and nothing is lost.
      const d = migrateDoc(JSON.parse(text) as CanvasDoc);
      past.current = []; future.current = []; setHist({ u: 0, r: 0 });
      setSelectedIds(new Set());
      setViewerItemId(null);
      setCanvasPath(path);
      setDocState(d);
      setLibraryOpen(false);
      await reloadAnnotations(path);
    } catch {
      showAlert("Could not open that canvas", "The file exists but is not valid canvas data.");
    }
  }, [reloadAnnotations]);

  /**
   * New canvas. The OS save panel picks the location, so a board can live
   * anywhere — including a folder that is already being synced to whoever
   * you want to work with.
   */
  async function newCanvas() {
    const path = await pickNewCanvasPath(currentDir);
    if (!path) return;
    const clean = (path.split("/").pop() || "Untitled").replace(/\.canvas$/i, "");
    const d = emptyDoc(clean);
    await storage.writeText(path, JSON.stringify(d, null, 2));
    await refresh(currentDir);
    past.current = []; future.current = []; setHist({ u: 0, r: 0 });
    setCanvasPath(path);
    setDocState(d);
    setAnnotations([]);
    setSelectedIds(new Set());
    setLibraryOpen(false);
  }

  async function newFolder() {
    const name = await askText("New folder", {
      message: `Created inside ${currentDir.split("/").pop()}.`,
      value: "New Folder",
      okLabel: "Create",
    });
    if (!name) return;
    await storage.makeDir(`${currentDir}/${name.replace(/[/\\:]/g, "-")}`);
    await refresh(currentDir);
    say(`Created “${name}”`);
  }

  async function deleteEntry(e: DirEntry) {
    const ok = await askConfirm(`Delete “${e.name}”?`, {
      message: e.is_dir
        ? "The folder and everything inside it will be removed. This cannot be undone."
        : "This cannot be undone.",
      okLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await storage.deletePath(e.path);
    if (e.path === canvasPath) { setCanvasPath(null); setDocState(null); setAnnotations([]); }
    await refresh(currentDir);
  }

  async function chooseWorkspace() {
    const dir = await pickFolder();
    if (!dir) return;
    setWorkspace(dir);
    setCurrentDir(dir);
    setCanvasPath(null);
    setDocState(null);
    setAnnotations([]);
  }

  // --- media import ------------------------------------------------------
  /**
   * Files that arrived on the clipboard rather than by drag.
   *
   * A dropped file has a path the backend can copy; a pasted image is bytes in
   * memory with no path at all, so it has to be written into the workspace
   * before it can be an item on the board.
   */
  const addPastedFiles = useCallback(async (files: File[], at: { x: number; y: number }) => {
    if (!docRef.current) { say("Open or create a canvas first."); return; }
    // Resolve the workspace rather than refuse. This handler is bound to a
    // long-lived window listener, so reading the state value directly could
    // see the empty string it started as — which is why pasting reported that
    // the app was still starting up long after it had.
    let ws = workspaceRef.current;
    if (!ws) {
      try { ws = await storage.defaultWorkspace(); setWorkspace(ws); } catch { /* handled below */ }
    }
    if (!ws) { say("Could not find your workspace folder."); return; }

    const made: Item[] = [];
    let offset = 0;
    for (const file of files) {
      const kind = mediaKind(file.name);
      if (!kind) continue;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const dest = `${ws}/.assets/${Date.now()}-${file.name}`;
        await storage.writeBytes(dest, bytes);
        const { w, h } = defaultSize(kind);
        made.push({
          id: uid(), type: "media", kind, src: dest, name: file.name,
          x: at.x - w / 2 + offset, y: at.y - h / 2 + offset, w, h,
          ...(kind === "pdf" ? { page: 1 } : {}),
        } as MediaItem);
        offset += 28;
      } catch (e) {
        say(`Could not paste ${file.name}: ${e}`);
      }
    }
    if (made.length) {
      setDoc({ ...docRef.current, items: [...docRef.current.items, ...made] });
      say(`Pasted ${made.length} file${made.length === 1 ? "" : "s"}`);
    }
  }, [workspaceRef, setDoc, say]);

  const addFiles = useCallback(async (files: string[], at?: { x: number; y: number }) => {
    if (!docRef.current) { say("Open or create a canvas first."); return; }
    // Guard the same invariant the backend enforces: no workspace, no import.
    if (!workspace) { say("Still starting up — try that again in a moment."); return; }
    const rect = areaRef.current!.getBoundingClientRect();
    const cam = docRef.current.camera;
    const cx = at ? at.x : (rect.width / 2 - cam.x) / cam.zoom;
    const cy = at ? at.y : (rect.height / 2 - cam.y) / cam.zoom;

    const newItems: Item[] = [];
    let offset = 0;
    let skipped = 0;
    for (const src of files) {
      const kind = mediaKind(src);
      if (!kind) { skipped++; continue; }
      const dest = await storage.importMediaHashed(workspace, src);
      const name = src.split("/").pop() || "file";
      const { w, h } = defaultSize(kind);
      newItems.push({
        id: uid(), type: "media", kind, src: dest, name,
        x: cx - w / 2 + offset, y: cy - h / 2 + offset, w, h,
        ...(kind === "pdf" ? { page: 1 } : {}),
      } as MediaItem);
      offset += 28;
    }
    if (newItems.length) {
      setDoc({ ...docRef.current, items: [...docRef.current.items, ...newItems] });
      say(`Added ${newItems.length} file${newItems.length === 1 ? "" : "s"}${skipped ? ` · skipped ${skipped} unsupported` : ""}`);
    } else if (skipped) {
      say(`${skipped} file${skipped === 1 ? "" : "s"} not supported yet`);
    }
  }, [setDoc, workspace, say]);

  async function importMedia() {
    const files = await pickMediaFiles();
    if (files.length) await addFiles(files);
  }

  // Drop files straight onto the canvas, landing where the cursor released.
  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const rect = areaRef.current?.getBoundingClientRect();
        const cam = docRef.current?.camera;
        let at: { x: number; y: number } | undefined;
        if (rect && cam) {
          const { x, y } = event.payload.position;
          at = { x: (x - rect.left - cam.x) / cam.zoom, y: (y - rect.top - cam.y) / cam.zoom };
        }
        addFiles(event.payload.paths, at);
      })
      .then((f) => { un = f; })
      .catch(() => {/* not fatal — the import button still works */});
    return () => un?.();
  }, [addFiles]);

  // --- viewer / panel ----------------------------------------------------
  const viewerItem = useMemo(
    () => (doc?.items.find((i) => i.id === viewerItemId && i.type === "media") as MediaItem | undefined),
    [doc, viewerItemId],
  );

  const openViewer = useCallback((itemId: string, annotationId: string | null = null) => {
    setViewerItemId(itemId);
    setFocusId(annotationId);
  }, []);

  /** Clicking a note in the board panel jumps to exactly where it lives. */
  const openAnnotation = useCallback((a: Annotation) => {
    const target = doc?.items.find((i) => i.id === a.anchor.itemId);
    if (target && target.type === "media") { openViewer(target.id, a.id); return; }
    // A board-level note: select it and centre the camera on it instead.
    setSelectedIds(new Set([a.anchor.itemId]));
    if (a.anchor.worldX !== undefined && docRef.current && areaRef.current) {
      const r = areaRef.current.getBoundingClientRect();
      const z = docRef.current.camera.zoom;
      setDoc({ ...docRef.current, camera: { zoom: z, x: r.width / 2 - a.anchor.worldX * z, y: r.height / 2 - (a.anchor.worldY ?? 0) * z } }, false);
    }
  }, [doc, openViewer, setDoc]);

  /**
   * Put an excerpt on the canvas next to the file it came from, keeping the
   * anchor so the card can take you back to that exact page or moment.
   */
  const addExcerpt = useCallback((e: {
    anchor: Annotation["anchor"];
    text: string;
    image?: string;
    sourceName: string;
  }) => {
    const d = docRef.current;
    if (!d) return;
    const src = d.items.find((i) => i.id === e.anchor.itemId);
    const w = 300;
    const h = e.image ? 250 : 170;
    // Place it clear of the source card, and clear of anything already there.
    const x = src && "x" in src ? src.x + (src as MediaItem).w + 48 : 0;
    let y = src && "y" in src ? src.y : 0;
    while (d.items.some((i) => "x" in i && Math.abs(i.x - x) < 24 && Math.abs(i.y - y) < 24)) {
      y += 32;
    }

    const excerpt: ExcerptItem = {
      id: uid(), type: "excerpt", x, y, w, h,
      text: e.text, image: e.image, color: me.color,
      source: e.anchor, sourceName: e.sourceName, createdAt: Date.now(),
    };
    setDoc({ ...d, items: [...d.items, excerpt] });
    setViewerItemId(null);
    setFocusId(null);
    setSelectedIds(new Set([excerpt.id]));
    say(`Added to canvas — click ↩ ${e.sourceName} to jump back`);
  }, [setDoc, me.color, say]);

  /** Follow an excerpt's backlink to the exact place it was taken from. */
  const openExcerptSource = useCallback((ex: ExcerptItem) => {
    const src = docRef.current?.items.find((i) => i.id === ex.source.itemId);
    if (!src || src.type !== "media") {
      say(`“${ex.sourceName}” is no longer on this board.`);
      return;
    }
    setViewerItemId(src.id);
    setFocusId(null);
    // The viewer reads page/time off the anchor when it opens.
    setPendingSourceAnchor(ex.source);
  }, [say]);

  /** The comment tool: click anywhere on the canvas to leave a note there. */
  /**
   * A note dropped on the board. No dialog: the canvas puts an empty bubble
   * where you clicked and you type into the bubble itself. A modal asking
   * "what's here?" makes you describe a place you are already pointing at,
   * in a box that covers it.
   */
  const addBoardComment = useCallback((world: { x: number; y: number }, text: string) => {
    setTool("select");
    if (!text.trim()) return;
    addAnnotation(newAnnotation(me, {
      itemId: "board", x: 0, y: 0, w: 0, h: 0, worldX: world.x, worldY: world.y,
    }, text.trim()));
  }, [addAnnotation, me]);

  /** Editing a bubble in place, rather than in the side panel. */
  const editBoardComment = useCallback((a: Annotation, text: string) => {
    if (!text.trim()) { deleteAnnotation(a); return; }
    updateAnnotation({ ...a, text: text.trim() });
  }, [deleteAnnotation, updateAnnotation]);

  async function renameMe() {
    const name = await askText("Your name", {
      message: "This is the label on your notes — it is what collaborators see. Stored only on this machine.",
      value: me.name,
    });
    if (!name) return;
    const next = { ...me, name };
    setMe(next);
    saveIdentity(next);
  }

  // --- export ------------------------------------------------------------
  const labelFor = useCallback((a: Annotation) => {
    const item = doc?.items.find((i) => i.id === a.anchor.itemId);
    const name = item && item.type === "media" ? item.name : "Canvas";
    const bits = [name];
    if (a.anchor.page !== undefined) bits.push(`page ${a.anchor.page}`);
    if (a.anchor.time !== undefined) bits.push(fmtTime(a.anchor.time));
    return bits.join(" · ");
  }, [doc]);

  /**
   * Write the notes on a PDF into a copy of that PDF, as real annotations.
   * Unlike every other export this one leaves the app behind entirely: the
   * result opens in Preview or Acrobat with the highlights and comments
   * already there.
   */
  async function saveAnnotatedPdf(item: MediaItem) {
    setBusy("Writing annotations into the PDF…");
    try {
      const { buildAnnotatedPdf } = await import("./annotatedPdf");
      const notes = annotations.filter((a) => a.anchor.itemId === item.id);
      const bytes = await buildAnnotatedPdf(item, notes);
      const base = item.name.replace(/\.pdf$/i, "");
      const path = await saveBytesAs(`${base} — annotated.pdf`, bytes, "pdf");
      say(path ? `Saved ${path.split("/").pop()}` : "Export cancelled");
    } catch (e) {
      say(`Could not write the PDF: ${e}`);
    } finally {
      setBusy(null);
    }
  }

  /** Every board in this folder (and below) as one document. */
  async function exportWorkspace() {
    setBusy("Collecting boards…");
    try {
      const boards: { path: string; name: string; folder: string }[] = [];
      const walk = async (dir: string, label: string, depth: number) => {
        // A guard rather than a limit anyone will hit: a workspace nested this
        // deep is a symlink loop, not a filing system.
        if (depth > 8) return;
        for (const e of await storage.listDir(dir)) {
          if (e.is_dir) await walk(e.path, label ? `${label} / ${e.name}` : e.name, depth + 1);
          else if (e.name.endsWith(".canvas")) {
            boards.push({ path: e.path, name: e.name.replace(/\.canvas$/, ""), folder: label });
          }
        }
      };
      await walk(currentDir, currentDir === workspace ? "" : currentDir.split("/").pop() ?? "", 0);

      if (!boards.length) { say("No boards in this folder to export."); return; }

      const { exportWorkspacePdf } = await import("./exportPdf");
      const bytes = await exportWorkspacePdf(
        currentDir.split("/").pop() || "Workspace",
        boards,
        { includeBoard: true, includeEvidence: false, includeIndex: true, onProgress: setBusy },
      );
      const path = await saveBytesAs(`${currentDir.split("/").pop() || "Workspace"}.pdf`, bytes, "pdf");
      say(path ? `Exported ${boards.length} boards to ${path.split("/").pop()}` : "Export cancelled");
    } catch (e) {
      say(`Export failed: ${e}`);
    } finally {
      setBusy(null);
    }
  }

  async function exportNotes(format: "md" | "json" | "csv" | "pdf") {
    if (!doc) return;

    if (format === "pdf") {
      // The heavy one: rasterises the board and every annotated frame.
      setBusy("Preparing export…");
      try {
        // Loaded on demand: jsPDF and the renderer are only needed when someone
        // actually exports, and they are a third of the bundle.
        const { exportBoardPdf } = await import("./exportPdf");
        const bytes = await exportBoardPdf(doc, annotations, {
          includeBoard: true,
          includeEvidence: true,
          includeIndex: true,
          onProgress: setBusy,
        });
        const path = await saveBytesAs(`${doc.name}.pdf`, bytes, "pdf");
        say(path ? `Exported ${path.split("/").pop()}` : "Export cancelled");
      } catch (e) {
        say(`Export failed: ${e}`);
      } finally {
        setBusy(null);
      }
      return;
    }

    let body: string;
    if (format === "md") {
      body = toMarkdown(doc.name, annotations, labelFor);
    } else if (format === "json") {
      body = JSON.stringify({ board: doc.name, exported: new Date().toISOString(), annotations }, null, 2);
    } else {
      const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
      body = ["file,page,timecode,author,resolved,note"]
        .concat(annotations.map((a) => [
          esc(labelFor(a).split(" · ")[0]),
          a.anchor.page ?? "",
          a.anchor.time !== undefined ? fmtTime(a.anchor.time) : "",
          esc(a.author),
          a.resolved ? "yes" : "no",
          esc(a.text),
        ].join(",")))
        .join("\n");
    }
    const path = await saveTextAs(`${doc.name}-notes.${format}`, body, format);
    if (path) say(`Exported to ${path.split("/").pop()}`);
  }

  // --- keyboard shortcuts -----------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // One source of truth, so a shortcut cannot fire into an open editor
      // just because focus failed to land where it was sent.
      const typing = !shortcutsAllowed(e);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setLibraryOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (pathRef.current && docRef.current) storage.writeText(pathRef.current, JSON.stringify(docRef.current, null, 2));
        return;
      }
      // The viewer and the library own the keyboard while they are open.
      if (libraryOpen && e.key === "Escape" && docRef.current) { setLibraryOpen(false); return; }
      if (viewerItemId || libraryOpen || typing || e.metaKey || e.ctrlKey) return;
      if (e.key === "?") { setShowShortcuts((v) => !v); return; }
      const map: Record<string, Tool> = {
        v: "select", h: "hand", p: "pen", r: "rect", o: "ellipse",
        a: "arrow", t: "text", n: "note", c: "comment",
      };
      const t = map[e.key.toLowerCase()];
      if (t) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, viewerItemId, libraryOpen]);

  const countsByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of annotations) {
      if (a.resolved) continue;
      m.set(a.anchor.itemId, (m.get(a.anchor.itemId) ?? 0) + 1);
    }
    return m;
  }, [annotations]);

  function zoomFit() {
    if (!doc || !areaRef.current) return;
    const rect = areaRef.current.getBoundingClientRect();
    if (!doc.items.length) { setDoc({ ...doc, camera: { x: 0, y: 0, zoom: 1 } }, false); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of doc.items) {
      const b = it.type === "stroke"
        ? strokeBox(it.points)
        : it.type === "text"
          ? { x: it.x, y: it.y, w: it.w, h: 60 }
          : { x: it.x, y: it.y, w: (it as any).w, h: (it as any).h };
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = 80;
    const zoom = Math.min(8, Math.max(0.05, Math.min((rect.width - pad) / (maxX - minX || 1), (rect.height - pad) / (maxY - minY || 1))));
    const x = rect.width / 2 - ((minX + maxX) / 2) * zoom;
    const y = rect.height / 2 - ((minY + maxY) / 2) * zoom;
    setDoc({ ...doc, camera: { x, y, zoom } }, false);
  }

  // No board open means there is nothing to show but the library.
  const showLibrary = libraryOpen || !doc;

  return (
    <div className="app">
      {/* Two places, not one place with a panel in it.
          The library is where you choose what to work on; the board is where
          you work. A permanent sidebar listing folders while you are drawing
          costs 250px of canvas to answer a question you are not asking, and it
          is why opening a board could not put a tab bar anywhere. Figma and
          FigJam split these for the same reason. */}
      {showLibrary ? (
        <Library
          currentDir={currentDir}
          workspace={workspace}
          entries={entries}
          onOpenCanvas={(p) => { setLibraryOpen(false); openCanvas(p); }}
          onEnterFolder={setCurrentDir}
          onNewCanvas={newCanvas}
          onNewFolder={newFolder}
          onDelete={deleteEntry}
          onExportWorkspace={exportWorkspace}
          onChooseWorkspace={chooseWorkspace}
          onRevealInFinder={() => revealItemInDir(currentDir).catch(() => {})}
          me={me}
          onRenameMe={renameMe}
          theme={theme}
          onSetTheme={setThemeState}
          canClose={!!doc}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}

      <div className="main" hidden={showLibrary}>
        {doc && (
          <Toolbar
            tool={tool} setTool={setTool}
            color={color} setColor={chooseColor}
            size={size} setSize={chooseSize}
            fill={fill} setFill={chooseFill}
            fontSize={fontSize} setFontSize={chooseFontSize}
            selectionCount={selectedIds.size}
            onAlign={doAlign} onDistribute={doDistribute} onSnapToGrid={doSnapToGrid}
            onToggleTextStyle={toggleTextStyle}
            hasSelection={selectedIds.size > 0}
            onImportMedia={importMedia}
            onUndo={undo} onRedo={redo}
            canUndo={hist.u > 0} canRedo={hist.r > 0}
            onZoomFit={zoomFit}
            locked={locked} onToggleLock={() => setLocked((v) => !v)}
            onShowShortcuts={() => setShowShortcuts(true)}
            notesOpen={panelOpen}
            noteCount={annotations.filter((a) => !a.resolved).length}
            onToggleNotes={() => setPanelOpen((v) => !v)}
          />
        )}

        {doc && (
          <header className="board-bar">
            <button className="board-back" onClick={() => setLibraryOpen(true)} title="All boards (⌘⇧O)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
              <span>Boards</span>
            </button>
            <span className="board-name">{doc.name}</span>
          </header>
        )}

        <div className="canvas-area" ref={areaRef}>
          {doc ? (
            <>
              <Canvas
                doc={doc} setDoc={setDoc} pushHistory={pushHistory} dark={dark} locked={locked}
                tool={tool} setTool={setTool}
                color={color} size={size} fill={fill} fontSize={fontSize}
                selectedIds={selectedIds} setSelectedIds={setSelectedIds}
                annotationCounts={countsByItem}
                boardNotes={annotations.filter((a) => a.anchor.itemId === "board" && !a.resolved)}
                onOpenMedia={openViewer}
                onOpenExcerptSource={openExcerptSource}
                onPasteFiles={addPastedFiles}
                onBoardComment={addBoardComment}
                onEditBoardComment={editBoardComment}
                onOpenAnnotation={openAnnotation}
              />
              <div className="statusbar">
                <span>{doc.name}</span>
                <span>{Math.round(doc.camera.zoom * 100)}%</span>
              </div>
            </>
          ) : (
            <div className="welcome">
              <h1>Research Canvas</h1>
              <p>
                An infinite canvas for research. Drop in images, video, audio, PDFs
                or documents, then pin a note to the exact frame, page or region
                you mean.
              </p>
              <div className="welcome-actions">
                <button className="cta" onClick={newCanvas}>+ New canvas</button>
                <button className="ghost-btn" onClick={() => setLibraryOpen(true)}>Browse boards</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {doc && panelOpen && (
        <CommentsPanel
          doc={doc}
          annotations={annotations}
          me={me}
          onOpen={openAnnotation}
          onUpdate={updateAnnotation}
          onDelete={deleteAnnotation}
          onExport={exportNotes}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {viewerItem && (
        <MediaViewer
          item={viewerItem}
          annotations={annotations.filter((a) => a.anchor.itemId === viewerItem.id)}
          me={me}
          focusId={focusId}
          openAt={pendingSourceAnchor}
          onClose={() => { setViewerItemId(null); setFocusId(null); setPendingSourceAnchor(null); }}
          onAdd={addAnnotation}
          onUpdate={updateAnnotation}
          onDelete={deleteAnnotation}
          onExtract={addExcerpt}
          onSaveAnnotatedPdf={() => saveAnnotatedPdf(viewerItem)}
        />
      )}

      {busy && (
        <div className="busy-overlay">
          <div className="busy-card">
            <div className="busy-spinner" />
            <div>{busy}</div>
            <small>Rendering every frame at full quality — this can take a moment.</small>
          </div>
        </div>
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      <DialogHost />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function strokeBox(points: number[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
