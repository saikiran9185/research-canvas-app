// The data model for a Research Canvas board.
//
// A board is TWO things on disk, deliberately kept apart:
//
//   MyBoard.canvas              the drawing — shapes, media, camera (this file)
//   .MyBoard.canvas.comments/   the annotations — one append-only file per author
//
// Splitting them is what lets several people work on the same board out of a
// synced folder without a server and without merge conflicts. See annotations.ts.

export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "note"
  | "comment";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Base {
  id: string;
  /**
   * Items sharing a group id move, scale and delete as one. Optional, so every
   * board written before grouping existed still loads unchanged.
   */
  groupId?: string;
  /**
   * A locked item is visible but inert: it cannot be selected, dragged,
   * resized or deleted by pointer. What it is for is the reference material
   * you want to draw ON TOP of — place a screenshot, lock it, and every stroke
   * after that lands on the board instead of grabbing the screenshot.
   */
  locked?: boolean;
  /**
   * Stacking order, as a fractional index: a string that sorts
   * lexicographically, and between any two of which another can always be
   * generated. Optional so older boards still load — they are assigned indices
   * from their array order on open. See order.ts for why this is not just the
   * array position.
   */
  index?: string;
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
  /** Stroke colour. */
  color: string;
  /** Stroke width; 0 draws no outline. */
  size: number;
  /** Fill colour, or "none" / undefined for an outline-only shape. */
  fill?: string;
}

export interface TextItem extends Base {
  type: "text";
  /** Weight and slant, stored as flags rather than a font string so the board
   *  stays legible when it is opened somewhere that font is not installed. */
  bold?: boolean;
  italic?: boolean;
  x: number;
  y: number;
  w: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface Anchor {
  /** The media item, or "board" for a free-floating comment on the canvas. */
  itemId: string;
  /** Rectangle on the media, 0..1. A point is just a zero-size rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Seconds into a video or audio file. */
  time?: number;
  /** 1-based PDF page. */
  page?: number;
  /** World coordinates, for comments dropped straight onto the canvas. */
  worldX?: number;
  worldY?: number;
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

/**
 * A piece pulled out of a source and placed on the canvas, keeping a live link
 * back to where it came from. This is what stops the canvas becoming a pile of
 * screenshots: the excerpt is not a copy, it is a *view* of a place in a file,
 * and clicking it takes you back to that page or that moment.
 */
export interface ExcerptItem extends Base {
  type: "excerpt";
  x: number;
  y: number;
  w: number;
  h: number;
  /** The words, or a caption when the excerpt is visual. */
  text: string;
  /** Optional still of the region, as a data URL. */
  image?: string;
  color: string;
  /** Where it came from. `itemId` is the media item on this board. */
  source: Anchor;
  /** The source file's name, kept so the card still reads if the item is gone. */
  sourceName: string;
  createdAt: number;
}

/** Everything Research Canvas can put on the board. */
export type MediaKind = "image" | "video" | "audio" | "pdf" | "doc" | "model";

export interface MediaItem extends Base {
  type: "media";
  kind: MediaKind;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // absolute path on disk
  name: string;
  page?: number;      // pdf: which page this card shows
  pageCount?: number; // pdf: filled in once rendered
}

/**
 * A link pasted onto the board.
 *
 * Research arrives as links at least as often as it arrives as files, and a
 * URL dropped in as plain text is unreadable and unclickable. This keeps the
 * address, a short readable label, and whether it points at something that
 * plays rather than something that reads.
 */
export interface LinkItem extends Base {
  type: "link";
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  label: string;
  /** Only affects how the card is labelled; nothing is embedded. */
  media: "page" | "video";
}

export type Item = StrokeItem | ShapeItem | TextItem | NoteItem | MediaItem | ExcerptItem | LinkItem;

export interface CanvasDoc {
  version: 1;
  name: string;
  camera: Camera;
  items: Item[];
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/**
 * Where an annotation is pinned. Coordinates are NORMALISED (0..1) against the
 * media's own frame, never against the canvas — so a comment stays on the same
 * spot in the video no matter how the card is resized or where it is moved.
 */
/**
 * One comment. Appended as a single JSON line to the author's own file.
 * Editing or deleting appends a NEW line with the same id and a later
 * `updatedAt` — last line wins. Nobody ever rewrites anyone else's file.
 */
export interface Annotation {
  id: string;
  authorId: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  text: string;
  color: string;
  anchor: Anchor;
  /** Freehand scribble over the frame, normalised 0..1, flat [x,y,x,y,...]. */
  scribbles?: { points: number[]; color: string; size: number }[];
  /**
   * The words the note is about, when they could be captured — a real text
   * selection in a PDF or document. Lets a note be searched and quoted by its
   * source text rather than only by what the reader typed about it.
   */
  quote?: string;
  resolved?: boolean;
  deleted?: boolean;
  /** Set on a reply to thread it under another comment. */
  replyTo?: string;
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

/** mm:ss(.t) for a timecode, the way a video note should read. */
export function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}
