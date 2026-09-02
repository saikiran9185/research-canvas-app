import { useCallback, useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import Sidebar from "./Sidebar";
import { storage, pickFolder, pickMediaFiles, mediaKind, type DirEntry } from "./storage";
import { checkForUpdatesOnLaunch } from "./updater";
import type { CanvasDoc, Item, Tool } from "./types";
import { emptyDoc, uid } from "./types";
import "./App.css";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const [hist, setHist] = useState({ u: 0, r: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);

  // --- boot: default workspace ------------------------------------------
  useEffect(() => {
    (async () => {
      const ws = await storage.defaultWorkspace();
      setWorkspace(ws);
      setCurrentDir(ws);
    })();
    checkForUpdatesOnLaunch();
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

  // --- file / folder ops -------------------------------------------------
  async function openCanvas(path: string) {
    const text = await storage.readText(path);
    try {
      const d = JSON.parse(text) as CanvasDoc;
      past.current = []; future.current = []; setHist({ u: 0, r: 0 });
      setSelectedId(null);
      setCanvasPath(path);
      setDocState(d);
    } catch {
      alert("Could not open canvas (invalid file).");
    }
  }

  async function newCanvas() {
    const name = window.prompt("Name your canvas:", "Untitled");
    if (!name) return;
    const clean = name.replace(/[\/\\:]/g, "-");
    const path = `${currentDir}/${clean}.canvas`;
    if (await storage.pathExists(path)) { alert("A canvas with that name already exists."); return; }
    const d = emptyDoc(clean);
    await storage.writeText(path, JSON.stringify(d, null, 2));
    await refresh(currentDir);
    past.current = []; future.current = []; setHist({ u: 0, r: 0 });
    setCanvasPath(path);
    setDocState(d);
    setSelectedId(null);
  }

  async function newFolder() {
    const name = window.prompt("Folder name:", "New Folder");
    if (!name) return;
    await storage.makeDir(`${currentDir}/${name.replace(/[\/\\:]/g, "-")}`);
    await refresh(currentDir);
  }

  async function deleteEntry(e: DirEntry) {
    if (!window.confirm(`Delete "${e.name}"? This cannot be undone.`)) return;
    await storage.deletePath(e.path);
    if (e.path === canvasPath) { setCanvasPath(null); setDocState(null); }
    await refresh(currentDir);
  }

  async function chooseWorkspace() {
    const dir = await pickFolder();
    if (!dir) return;
    setWorkspace(dir);
    setCurrentDir(dir);
    setCanvasPath(null);
    setDocState(null);
  }

  // --- media import ------------------------------------------------------
  async function importMedia() {
    if (!doc) { alert("Open or create a canvas first."); return; }
    const files = await pickMediaFiles();
    if (!files.length) return;
    const rect = areaRef.current!.getBoundingClientRect();
    const cam = docRef.current!.camera;
    const cx = (rect.width / 2 - cam.x) / cam.zoom;
    const cy = (rect.height / 2 - cam.y) / cam.zoom;
    const newItems: Item[] = [];
    let offset = 0;
    for (const src of files) {
      const kind = mediaKind(src);
      if (!kind) continue;
      const dest = await storage.importMedia(workspace, src);
      const name = src.split("/").pop() || "file";
      const w = kind === "audio" ? 320 : kind === "video" ? 480 : 320;
      const h = kind === "audio" ? 92 : kind === "video" ? 280 : 240;
      newItems.push({ id: uid(), type: "media", kind, src: dest, name, x: cx - w / 2 + offset, y: cy - h / 2 + offset, w, h });
      offset += 28;
    }
    if (newItems.length) setDoc({ ...docRef.current!, items: [...docRef.current!.items, ...newItems] });
  }

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

  // --- keyboard shortcuts -----------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (pathRef.current && docRef.current) storage.writeText(pathRef.current, JSON.stringify(docRef.current, null, 2));
        return;
      }
      if (typing || e.metaKey || e.ctrlKey) return;
      const map: Record<string, Tool> = { v: "select", h: "hand", p: "pen", r: "rect", o: "ellipse", a: "arrow", t: "text", n: "note" };
      const t = map[e.key.toLowerCase()];
      if (t) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

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
      />

      <div className="main">
        {doc && (
          <Toolbar
            tool={tool} setTool={setTool}
            color={color} setColor={setColor}
            size={size} setSize={setSize}
            onImportMedia={importMedia}
            onUndo={undo} onRedo={redo}
            canUndo={hist.u > 0} canRedo={hist.r > 0}
            onZoomFit={zoomFit}
          />
        )}
        <div className="canvas-area" ref={areaRef}>
          {doc ? (
            <>
              <Canvas doc={doc} setDoc={setDoc} tool={tool} setTool={setTool} color={color} size={size} selectedId={selectedId} setSelectedId={setSelectedId} />
              <div className="statusbar">
                <span>{doc.name}</span>
                <span>{Math.round(doc.camera.zoom * 100)}%</span>
              </div>
            </>
          ) : (
            <div className="welcome">
              <h1>Research Canvas</h1>
              <p>An infinite canvas for your research. Pick a canvas from the left, or create one.</p>
              <button className="cta" onClick={newCanvas}>+ New canvas</button>
            </div>
          )}
        </div>
      </div>
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
