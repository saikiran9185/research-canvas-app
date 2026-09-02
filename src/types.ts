// The data model for a Research Canvas board (.canvas file = one CanvasDoc as JSON).

export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "note";

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

export interface CanvasDoc {
  version: 1;
  name: string;
  camera: Camera;
  items: Item[];
}

export function emptyDoc(name: string): CanvasDoc {
  return {
    version: 1,
    name,
    camera: { x: 0, y: 0, zoom: 1 },
    items: [],
  };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
