import type { DirEntry } from "./storage";
import type { Identity } from "./annotations";
import type { Theme } from "./theme";

interface Props {
  workspace: string;
  currentDir: string;
  entries: DirEntry[];
  currentCanvasPath: string | null;
  onEnterFolder: (path: string) => void;
  onUp: () => void;
  onOpenCanvas: (path: string) => void;
  onNewCanvas: () => void;
  onNewFolder: () => void;
  onChooseWorkspace: () => void;
  onDelete: (entry: DirEntry) => void;
  onRevealInFinder: () => void;
  me: Identity;
  onRenameMe: () => void;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
}

export default function Sidebar(p: Props) {
  const rel = p.currentDir === p.workspace ? "" : p.currentDir.slice(p.workspace.length + 1);
  const atRoot = p.currentDir === p.workspace;

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-dot" /> Research Canvas
        </div>
        <button className="ghost-btn" title="Change workspace folder" onClick={p.onChooseWorkspace}>⤓</button>
      </div>

      <div className="workspace-path" title={p.currentDir}>
        <button className="crumb" onClick={() => p.onEnterFolder(p.workspace)}>Home</button>
        {rel && rel.split("/").map((seg, i) => (
          <span key={i}>
            <span className="crumb-sep">/</span>
            <span className="crumb current">{seg}</span>
          </span>
        ))}
      </div>

      <div className="sidebar-actions">
        <button
          className={"action" + (p.libraryOpen ? " on" : "")}
          onClick={p.onToggleLibrary}
          title="All boards as a grid (⌘⇧O)"
        >▦ Library</button>
        <button className="action" onClick={p.onNewCanvas}>+ Canvas</button>
        <button className="action" onClick={p.onNewFolder}>+ Folder</button>
        {!atRoot && <button className="action subtle" onClick={p.onUp}>↑ Up</button>}
      </div>

      <div className="file-list">
        {p.entries.length === 0 && <div className="empty-hint">Empty folder.<br />Create a canvas to begin.</div>}
        {p.entries.map((e) => (
          <div
            key={e.path}
            className={"file-row" + (e.path === p.currentCanvasPath ? " open" : "")}
            onClick={() => (e.is_dir ? p.onEnterFolder(e.path) : p.onOpenCanvas(e.path))}
          >
            <span className="file-icon">{e.is_dir ? "📁" : "▧"}</span>
            <span className="file-name">{e.is_dir ? e.name : e.name.replace(/\.canvas$/, "")}</span>
            <button
              className="file-del"
              title="Delete"
              onClick={(ev) => { ev.stopPropagation(); p.onDelete(e); }}
            >×</button>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="theme-switch" role="group" aria-label="Appearance">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button
              key={t}
              className={p.theme === t ? "active" : ""}
              onClick={() => p.onSetTheme(t)}
              title={t === "system" ? "Follow the system appearance" : `Always ${t}`}
            >{t === "system" ? "Auto" : t === "light" ? "Light" : "Dark"}</button>
          ))}
        </div>
        {/* Identity is local and self-declared — it is only a label on your
            notes so collaborators know who wrote what. No account anywhere. */}
        <button className="whoami" onClick={p.onRenameMe} title="Change the name shown on your notes">
          <span className="dot" style={{ background: p.me.color }} />
          <span className="whoami-name">{p.me.name}</span>
          <span className="whoami-edit">edit</span>
        </button>
        <button className="ghost-btn wide" onClick={p.onRevealInFinder}>Reveal folder in Finder</button>
      </div>
    </aside>
  );
}
