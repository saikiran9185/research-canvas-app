// Side panel listing every annotation on the board, grouped by the media it
// belongs to. Clicking a row flies the canvas to it (and seeks, for time notes).
import type { Annotation, Item, MediaItem } from "./types";
import { fmtTime } from "./types";

interface Props {
  annotations: Annotation[];
  items: Item[];
  selectedId: string | null;
  onFocus: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function AnnotationPanel(p: Props) {
  const media = new Map<string, MediaItem>();
  for (const it of p.items) if (it.type === "media") media.set(it.id, it);

  // Group in board order, keeping each target's notes together.
  const groups: { target?: MediaItem; list: Annotation[] }[] = [];
  const byTarget = new Map<string, Annotation[]>();
  for (const a of p.annotations) {
    if (!byTarget.has(a.targetId)) {
      byTarget.set(a.targetId, []);
      groups.push({ target: media.get(a.targetId), list: byTarget.get(a.targetId)! });
    }
    byTarget.get(a.targetId)!.push(a);
  }

  const number = new Map(p.annotations.map((a, i) => [a.id, i + 1]));

  return (
    <div className="anno-panel">
      <div className="anno-panel-head">
        <strong>Annotations</strong>
        <span className="anno-count">{p.annotations.length}</span>
        <button className="ghost-btn" title="Hide panel" onClick={p.onClose}>✕</button>
      </div>

      {!p.annotations.length ? (
        <div className="empty-hint">
          No annotations yet.<br />
          Pick the <b>Annotate</b> tool (C), then drag over an image or video —
          or click an audio clip to pin the moment you're hearing.
        </div>
      ) : (
        <div className="anno-list">
          {groups.map((g, gi) => (
            <div key={gi} className="anno-group">
              <div className="anno-group-head">
                {g.target ? `${icon(g.target.kind)} ${g.target.name}` : "(deleted media)"}
              </div>
              {g.list.map((a) => (
                <div
                  key={a.id}
                  className={"anno-row" + (a.id === p.selectedId ? " selected" : "")}
                  onClick={() => p.onFocus(a.id)}
                >
                  <span className="anno-badge" style={{ background: a.color }}>{number.get(a.id)}</span>
                  <div className="anno-row-body">
                    {a.time !== undefined && <span className="anno-time">{fmtTime(a.time)}</span>}
                    {a.id === p.selectedId ? (
                      <textarea
                        className="anno-row-edit"
                        autoFocus
                        placeholder="What do you notice here?"
                        value={a.text}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => p.onChangeText(a.id, e.target.value)}
                      />
                    ) : (
                      <span className="anno-row-text">{a.text || <i>empty note</i>}</span>
                    )}
                  </div>
                  <button
                    className="file-del"
                    title="Delete note"
                    onClick={(e) => { e.stopPropagation(); p.onDelete(a.id); }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function icon(kind: MediaItem["kind"]): string {
  return kind === "image" ? "🖼" : kind === "video" ? "🎬" : "♪";
}
