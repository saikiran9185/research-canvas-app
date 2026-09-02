// The data model for a Research Canvas board (.canvas file = one CanvasDoc as JSON).

export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "note"
  | "annotate";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Base {
  id: string;
}

export interface StrokeItem extends Base {
  type: "stroke";
  points: number[]; // flat [x0,y0,x1,y1,...] in world coordinates
  color: string;
  size: number;
}

export interface ShapeItem extends Base {
  type: "shape";
  shape: "rect" | "ellipse" | "arrow" | "line";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  size: number;
}

export interface TextItem extends Base {
  type: "text";
  x: number;
  y: number;
  w: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface NoteItem extends Base {
  type: "note";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string; // sticky background color
}

export interface MediaItem extends Base {
  type: "media";
  kind: "image" | "video" | "audio";
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // absolute path on disk
  name: string;
}

export type Item = StrokeItem | ShapeItem | TextItem | NoteItem | MediaItem;

/**
 * A note that sticks to a *place* or *moment* inside a media item rather than
 * floating loose on the canvas.
 *
 * - `region` is stored normalised (0..1) against the target's box, so the
 *   highlight keeps hugging the same part of the picture when the item is
 *   resized. A region with `w`/`h` of 0 is a point pin.
 * - `time` is seconds into a video or audio clip.
 *
 * Images get a region; audio gets a time; video can carry both (a note on a
 * region of a particular frame).
 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Annotation {
  id: string;
  targetId: string; // the MediaItem this is anchored to
  text: string;
  color: string;
  createdAt: number;
  region?: Region;
  time?: number;
}

export interface CanvasDoc {
  version: 1;
  name: string;
  camera: Camera;
  items: Item[];
  annotations: Annotation[];
}

export function emptyDoc(name: string): CanvasDoc {
  return {
    version: 1,
    name,
    camera: { x: 0, y: 0, zoom: 1 },
    items: [],
    annotations: [],
  };
}

// Boards written before the annotation layer have no `annotations` array.
export function normalizeDoc(d: CanvasDoc): CanvasDoc {
  return { ...d, items: d.items ?? [], annotations: d.annotations ?? [] };
}

// mm:ss for annotation timecodes.
export function fmtTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
