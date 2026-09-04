import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import Sidebar from "./Sidebar";
import MediaViewer from "./MediaViewer";
import CommentsPanel from "./CommentsPanel";
import {
  storage, pickFolder, pickMediaFiles, mediaKind, defaultSize,
  saveTextAs, saveBytesAs, pickNewCanvasPath, type DirEntry,
} from "./storage";
import { getTheme, applyTheme, type Theme } from "./theme";
import { DialogHost, askText, askConfirm, showAlert } from "./dialogs";
import Library, { invalidateThumb } from "./Library";
import {
  getIdentity, saveIdentity, loadAnnotations, appendAnnotation,
  annotationsMtime, newAnnotation, toMarkdown, type Identity,
} from "./annotations";
import { checkForUpdatesOnLaunch } from "./updater";
import type { Annotation, CanvasDoc, Item, MediaItem, Tool } from "./types";
import { emptyDoc, fmtTime, uid } from "./types";
import "./App.css";

/** How often to re-read the comment files, to pick up a collaborator's sync. */
const SYNC_POLL_MS = 2500;

export default function App() {
  const [workspace, setWorkspace] = useState<string>("");
  const [currentDir, setCurrentDir] = useState<string>("");
  const [entries, setEntries] = useState<DirEntry[]>([]);

  const [doc, setDocState] = useState<CanvasDoc | null>(null);
  const [canvasPath, setCanvasPath] = useState<string | null>(null);
  const docRef = useRef<CanvasDoc | null>(null);
  docRef.current = doc;
  const pathRef = useRef<string | null>(null);
  pathRef.current = canvasPath;

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#111827");
  const [size, setSize] = useState(3);
  const [fill, setFill] = useState("none");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // --- annotation layer --------------------------------------------------
  const [me, setMe] = useState<Identity>(() => getIdentity());
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  // The library is the landing view: on launch you see your boards, not a blank canvas.
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [viewerItemId, setViewerItemId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
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
  useEffect(() => { applyTheme(theme); }, [theme]);

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
  const setDoc = useCallback((next: CanvasDoc, history = true) => {
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

  // --- file / folder ops -------------------------------------------------
  const openCanvas = useCallback(async (path: string) => {
    const text = await storage.readText(path);
    try {
      const d = JSON.parse(text) as CanvasDoc;
      past.current = []; future.current = []; setHist({ u: 0, r: 0 });
      setSelectedId(null);
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
    setSelectedId(null);
    setLibraryOpen(false);
  }

  async function newFolder() {
    const name = await askText("New folder", {
      message: `Created inside ${currentDir.split("/").pop()}.`,
      value: "New Folder",
      okLabel: "Create",
    });
    if (!name) return;
    await storage.makeDir(`${currentDir}/${name.replace(/[\/\\:]/g, "-")}`);
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
  const addFiles = useCallback(async (files: string[], at?: { x: number; y: number }) => {
    if (!docRef.current) { say("Open or create a canvas first."); return; }
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
    setSelectedId(a.anchor.itemId);
    if (a.anchor.worldX !== undefined && docRef.current && areaRef.current) {
      const r = areaRef.current.getBoundingClientRect();
      const z = docRef.current.camera.zoom;
      setDoc({ ...docRef.current, camera: { zoom: z, x: r.width / 2 - a.anchor.worldX * z, y: r.height / 2 - (a.anchor.worldY ?? 0) * z } }, false);
    }
  }, [doc, openViewer, setDoc]);

  /** The comment tool: click anywhere on the canvas to leave a note there. */
  const addBoardComment = useCallback(async (world: { x: number; y: number }) => {
    const text = await askText("Note on this spot", { placeholder: "What's here?", okLabel: "Add note" });
    setTool("select");
    if (!text) return;
    addAnnotation(newAnnotation(me, {
      itemId: "board", x: 0, y: 0, w: 0, h: 0, worldX: world.x, worldY: world.y,
    }, text));
  }, [addAnnotation, me]);

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
      const typing = (e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT";
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

  return (
    <div className="app">
      <Sidebar
        workspace={workspace}
        currentDir={currentDir}
        entries={entries}
        currentCanvasPath={canvasPath}
        onEnterFolder={setCurrentDir}
        onUp={() => setCurrentDir(currentDir.split("/").slice(0, -1).join("/") || "/")}
        onOpenCanvas={openCanvas}
        onNewCanvas={newCanvas}
        onNewFolder={newFolder}
        onChooseWorkspace={chooseWorkspace}
        onDelete={deleteEntry}
        onRevealInFinder={() => revealItemInDir(currentDir).catch(() => {})}
        libraryOpen={libraryOpen}
        onToggleLibrary={() => setLibraryOpen((v) => !v)}
        me={me}
        onRenameMe={renameMe}
        theme={theme}
        onSetTheme={setThemeState}
      />

      <div className="main">
        {doc && (
          <Toolbar
            tool={tool} setTool={setTool}
            color={color} setColor={setColor}
            size={size} setSize={setSize}
            fill={fill} setFill={setFill}
            onImportMedia={importMedia}
            onUndo={undo} onRedo={redo}
            canUndo={hist.u > 0} canRedo={hist.r > 0}
            onZoomFit={zoomFit}
            notesOpen={panelOpen}
            noteCount={annotations.filter((a) => !a.resolved).length}
            onToggleNotes={() => setPanelOpen((v) => !v)}
          />
        )}
        <div className="canvas-area" ref={areaRef}>
          {libraryOpen && (
            <Library
              currentDir={currentDir}
              workspace={workspace}
              entries={entries}
              onOpenCanvas={openCanvas}
              onEnterFolder={setCurrentDir}
              onNewCanvas={newCanvas}
              onDelete={deleteEntry}
              onClose={() => setLibraryOpen(false)}
            />
          )}
          {doc ? (
            <>
              <Canvas
                doc={doc} setDoc={setDoc}
                tool={tool} setTool={setTool}
                color={color} size={size} fill={fill}
                selectedId={selectedId} setSelectedId={setSelectedId}
                annotationCounts={countsByItem}
                boardNotes={annotations.filter((a) => a.anchor.itemId === "board" && !a.resolved)}
                onOpenMedia={openViewer}
                onBoardComment={addBoardComment}
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
          onClose={() => { setViewerItemId(null); setFocusId(null); }}
          onAdd={addAnnotation}
          onUpdate={updateAnnotation}
          onDelete={deleteAnnotation}
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
