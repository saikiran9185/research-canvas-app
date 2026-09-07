# What the canvas still needs

Written after reading Excalidraw's source (MIT) end to end — not to copy it,
but to see which problems a mature canvas has already had to solve, and which
of those we actually have. The distinction matters: their `element` package is
34,298 lines with 110,159 lines of tests behind it. Ours is 6,825 lines in
total. Parity is not the goal and would be the wrong goal; knowing which gaps
bite is.

Ordered by what actually costs you something today, not by what a feature
table would list first.

## 1. Correctness — things that are wrong, not missing

**Stacking order.** *Done.* Order was array position, which cannot merge; it is
now a fractional index per item, so two people reordering the same board
converge. See `src/order.ts`.

**Item locking.** *Done.* ⌘L locks a selection, ⌘⇧L unlocks the whole board —
which has to work on the board rather than on a selection, since a locked item
cannot be selected and locking would otherwise be a one-way door.

**Real text measurement.** *Done.* Text is measured from what the font engine
rendered, via a ResizeObserver, and geometry takes those heights. The old
estimate divided the box width by `fontSize * 0.55` — the average advance of
Latin lowercase — so it ran short for Telugu, Devanagari and CJK alike. The
fallback for text not yet on screen no longer pretends to know a ratio that
works for every script: it assumes a wide glyph and generous line spacing,
because a box slightly too large is cosmetic while a box too small makes text
unselectable at its edges.

Measurements are kept in memory, not written to the board — a measurement is a
fact about this machine's fonts, not about the document, and saving it would
dirty a board simply by opening it.

## 2. Layout — daily work a research board needs

**Align and distribute.** Snapping helps while you drag; it cannot line up six
cards you already placed. Align left/centre/right/top/middle/bottom, and
distribute evenly, are the commands that turn a pile into a layout.

**Crop.** You drop a screenshot to keep one region of it. Today you keep the
whole thing and resize it small. Cropping on the canvas is the difference
between a board of evidence and a board of screenshots.

**Flip, and rotation.** We have neither. Rotation especially: every resize
handle we draw already implies it, and its absence is noticeable.

**Grid snapping.** We snap to other items but not to the grid, so the grid is
decoration rather than a tool.

## 3. Structure — what will hurt at scale, not yet

**A scene, rather than an array.** Every hit test, every reorder and every
selection walks `doc.items` linearly, on every frame. At a few hundred items
that is free; at a few thousand it will not be. The shape of the answer is an
object that owns the items and keeps a Map from id alongside the ordered array,
so lookups stop being scans.

**Split `Canvas.tsx`.** It is ~730 lines carrying pointer input, keyboard
handling, the SVG layer and the DOM overlay. The equivalent in a mature canvas
is dozens of focused modules. The pieces that want extracting first are
selection, dragging, resizing and item rendering — the same split we already
made for `geometry.ts` and `interaction.ts`, and for the same reason: things
with no React in them can be tested.

**Incremental change records.** Annotations already sync as append-only
per-author files. The board itself still saves whole. Now that order is
mergeable, per-item change records are the natural next step and the thing that
would make real collaboration work without a server.

## 4. The part nobody else has

Everything above is table stakes that other canvases already have. This is the
part that is ours, and it is why the project exists:

- a note pinned to a video timecode (issue #4)
- a note pinned to a region of a PDF page
- excerpts that keep a live backlink to where they came from — *built*

Frames — named regions that hold a cluster of material — belong here too. On a
research board, "these fourteen things are my typography references" is a real
unit of thought, not a visual grouping.

## What NOT to build

Perspective grids, brush packs, object libraries, flowchart autolayout, elbow
arrow routing, laser pointers. They are excellent features of drawing tools.
This is not a drawing tool.
