// Drawing one vector item: the ink of a pen stroke, and the geometry of a
// shape or an arrow.
//
// Pure rendering. Handed an item, a colour resolver and a hit-band width, it
// returns SVG. It knows nothing about selection, the camera or the document —
// which is what lets the stroke maths be read on its own rather than in the
// middle of a thousand lines of pointer handling.

import type React from "react";
import { getStroke } from "perfect-freehand";
import type { ShapeItem } from "../types";
import { NIB } from "../constants";

/** The bare polyline: the hit area, and the fallback for a lone dot. */
export function polylinePath(points: number[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    // A single tap is a dot. It used to be discarded entirely.
    const [x, y] = points;
    return `M ${x} ${y} L ${x + 0.01} ${y}`;
  }
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`;
  return d;
}

/**
 * The visible stroke: an outline, not a line.
 *
 * A constant-width stroked path reads as a cable rather than as a drawn mark.
 * perfect-freehand (MIT, by the author of tldraw) turns the input points into
 * the *outline* of a nib that tapers at the ends and thins as the hand moves
 * faster — which is what makes ink look like ink. We fill that outline.
 *
 * It is a single-purpose utility, not a framework: it takes points and returns
 * a polygon, and knows nothing about this app.
 */
export function inkOutline(points: number[], size: number): string {
  if (points.length < 4) return "";
  const pts: number[][] = [];
  for (let i = 0; i < points.length; i += 2) pts.push([points[i], points[i + 1]]);
  const outline = getStroke(pts, {
    size,
    ...NIB,
    simulatePressure: true,
    last: true,
  });
  if (!outline.length) return "";
  let d = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)}`;
  for (let i = 1; i < outline.length; i++) d += ` L ${outline[i][0].toFixed(2)} ${outline[i][1].toFixed(2)}`;
  return d + " Z";
}

export function normRect(s: ShapeItem): ShapeItem {
  const x = s.w < 0 ? s.x + s.w : s.x;
  const y = s.h < 0 ? s.y + s.h : s.y;
  return { ...s, x, y, w: Math.abs(s.w), h: Math.abs(s.h) };
}

export function ShapeView({ item, ink, hitBand, selectable, onDown }: { item: ShapeItem; ink: (c: string) => string; hitBand: number; selectable: boolean; onDown: (e: React.PointerEvent) => void }) {
  const s = normRect(item);
  const painted = ink(item.color);
  const filled = !!s.fill && s.fill !== "none";
  const common = {
    stroke: s.size > 0 ? painted : "none",
    strokeWidth: s.size,
    // An unfilled shape still needs a transparent fill so it stays clickable
    // across its whole body rather than only on the one-pixel outline.
    fill: filled ? s.fill : "transparent",
    style: { pointerEvents: (selectable ? "visible" : "none") as any, cursor: "move" },
    onPointerDown: onDown,
  };
  if (s.shape === "rect") return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={4} {...common} />;
  if (s.shape === "ellipse") return <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} {...common} />;
  // Arrow. Stored raw rather than normalised, so the direction it was drawn in
  // survives a resize.
  //
  // The width is clamped to a visible one. "No outline" is a real choice for a
  // rectangle — it leaves a filled shape — but an arrow with no line is not an
  // arrow, and the old code drew the line at width 0 while still filling the
  // arrowhead, so choosing it left a field of floating triangles with nothing
  // attached to them.
  const width = Math.max(1, item.size);
  const x1 = item.x, y1 = item.y, x2 = item.x + item.w, y2 = item.y + item.h;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  // The head grows with the stroke and with the arrow's own length, so a short
  // arrow is not all head and a long one is not tipped with a speck.
  const length = Math.hypot(x2 - x1, y2 - y1);
  const head = Math.min(length * 0.4, 5 + width * 3);
  const spread = Math.PI / 7;
  const a1x = x2 - head * Math.cos(ang - spread), a1y = y2 - head * Math.sin(ang - spread);
  const a2x = x2 - head * Math.cos(ang + spread), a2y = y2 - head * Math.sin(ang + spread);
  // Stop the line just short of the tip: a round cap poking through the head
  // is the difference between a drawn arrow and two shapes that overlap.
  const inset = head * 0.55;
  const lx2 = x2 - inset * Math.cos(ang), ly2 = y2 - inset * Math.sin(ang);
  return (
    <g style={{ pointerEvents: selectable ? "visible" : "none", cursor: "move" }} onPointerDown={onDown}>
      <line x1={x1} y1={y1} x2={lx2} y2={ly2} stroke={painted} strokeWidth={width} strokeLinecap="round" />
      <polygon
        points={`${x2},${y2} ${a1x},${a1y} ${a2x},${a2y}`}
        fill={painted}
        stroke={painted}
        strokeWidth={width * 0.6}
        strokeLinejoin="round"
      />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={hitBand} />
    </g>
  );
}
