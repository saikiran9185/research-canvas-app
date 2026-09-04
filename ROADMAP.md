# Roadmap

Research Canvas wants to be an infinite canvas where artists from different fields
gather any media, annotate it exactly where it matters, and think together. Here's
where we are and where we're headed. **Help on any of this is welcome** — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## ✅ Phase 1 — the canvas

- Infinite pan/zoom canvas, custom engine (no third-party canvas SDK)
- Tools: select, pan, pen, rectangle, ellipse, arrow, text, sticky notes, comment
- Media import with inline preview — image, video, audio, **PDF**, 3D file cards
- Drag files straight onto the canvas
- Move / resize, undo / redo, zoom-to-fit
- Folders on disk; boards are `.canvas` files; auto-save
- Light / dark / follow-the-system appearance
- Native desktop app (Tauri) with self-update

## ✅ Phase 2 — the annotation layer

Notes that stick to a *place* or *moment* in the media:

- Highlight a region of an **image or PDF** → attach a note
- Pin a comment to a **video frame / timecode**, with a timeline of every note
- Scribble directly on a frame
- Pin a note to an **audio timestamp**
- A panel listing every annotation on the board, searchable and filterable
- Export notes as Markdown / CSV / JSON, or the **whole board as a PDF** with
  every annotated frame rendered in — so someone without the app, and without
  an internet connection, can still see what was said about what

## ✅ Phase 3a — collaboration without a server

- Comments live outside the board file, one append-only `.jsonl` per author
- Two people can share a board folder (Syncthing, git, Dropbox, a USB stick),
  both write, and nothing ever conflicts — see [docs/collaboration.md](docs/collaboration.md)
- Notes a collaborator syncs in appear within a couple of seconds
- Assets are content-addressed, so the same file shared twice is stored once

## 🔜 Phase 3b — next up

- 3D model preview (`.glb` / `.gltf` / `.obj`) with comments pinned in 3D space
- Audio waveform instead of a bare timeline
- Text-layer selection in PDFs (select words, not just a region)
- Tags, search across boards, grouping
- Web-link cards

## 🌐 Phase 4 — optional live sync

The file format is already append-only lines, so a sync server only has to
relay them. Nothing here changes the data model, and the app keeps working
with no server at all.

- A small self-hostable relay (run it on a laptop, a Pi, or a cheap VPS)
- Live cursors and instant sync
- Sharing a board by link

## 💡 Always welcome

- Toolbar and interaction design (the "feel" is wide open)
- Accessibility, performance, tests
- Packaging for Windows and Linux

Have an idea that isn't here? Open a [Discussion](../../discussions).
