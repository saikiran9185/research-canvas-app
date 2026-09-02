# Roadmap

Research Canvas wants to be an infinite canvas where artists from different fields
gather any media, annotate it exactly where it matters, and think together. Here's
where we are and where we're headed. **Help on any of this is welcome** — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## ✅ Phase 1 — the canvas (done / stabilising)

- Infinite pan/zoom canvas, custom engine (no third-party canvas SDK)
- Tools: select, pan, pen, rectangle, ellipse, arrow, text, sticky notes
- Media import (image / video / audio) with inline preview
- Move / resize, undo / redo, zoom-to-fit
- Folders on disk; boards are `.canvas` files; auto-save
- Native desktop app (Tauri) with self-update

## ✅ Phase 2 — the annotation layer (the signature feature)

Notes that stick to a *place* or *moment* in the media. Pick the **Annotate**
tool (`C`), then drag over an image or video, or pin the moment you're hearing
on an audio clip:

- Highlight a region of an **image** → attach a note
- Pin a comment to a **video frame / timecode** (frame pins appear as playback
  reaches their moment; every note stays reachable on the timecode strip)
- Pin a note to an **audio timestamp**
- A side panel listing all annotations on a board, grouped by media —
  click one to fly the canvas to it and seek there

Regions are stored relative to the media, so a highlight keeps hugging the same
part of the picture when the item is resized. Still to do here: the same
region-note flow for **PDFs**, once PDF support lands in Phase 3.

## 🔭 Phase 3 — organise & expand

- Tags, search across boards, grouping
- **PDF** support (and region notes on PDF pages), **3D model** preview, web-link cards
- Better import (drag-and-drop onto the canvas)

## 🌐 Phase 4 — collaboration (Figma-style)

- Others open a board and view/comment
- Real-time multi-user editing with cursors
- Sharing a board by link

## 💡 Always welcome

- Toolbar and interaction design (the "feel" is wide open)
- Accessibility, performance, tests
- Packaging for Windows and Linux

Have an idea that isn't here? Open a [Discussion](../../discussions).
