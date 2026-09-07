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

## ✅ Phase 3b — source-linked extraction

The interaction that makes this a research tool rather than an annotator: a
piece of a source can be lifted onto the canvas *without becoming a copy of it*.

- Select real text in a PDF — words, not a drag-box — and the note carries the
  quote
- **→ Canvas** on any highlight or note puts an excerpt card on the board,
  cropped image and all
- Every excerpt keeps a **live backlink**: click it and the viewer opens at that
  exact page or timecode
- Quotes flow through the notes panel, the Markdown export and the PDF export

## ✅ Scanned PDFs

Real documents are often pictures of documents. A scan has no text layer, so
there is nothing to select and nothing to quote.

- Local OCR (Tesseract) turns a scanned page into selectable text
- The recognised words become an ordinary text layer, so quoting, anchoring and
  extraction need no special case for scans
- Everything is bundled — no network, no OCR service, no account

## ✅ Taking the work out of the app

Notes are only useful if they can leave.

- **Save annotated PDF** — writes your highlights and comments into a copy of
  the PDF as *real* PDF annotations. It opens in Preview, Acrobat, Zotero or
  anything else with the notes already there; no app required, and colleagues
  can reply to them in their own reader.
- **Export all as PDF** — every board in a folder and below, as one document:
  a title page, contents, then each board with its notes.
- Text is written as UTF-16, so notes in Telugu, Hindi or any other script
  survive the round trip.

## 🔜 Phase 3c — next up

- **PDF depth first** — continuous scroll through pages, a page thumbnail rail,
  and search within a document
- 3D model preview (`.glb` / `.gltf` / `.obj`) with comments pinned in 3D space
- Audio waveform instead of a bare timeline
- Drag a selection out of the viewer onto the canvas, rather than a button
- A formal `Viewer` interface, one module per media type, so a new medium is a
  new implementation instead of a change to the canvas
- A doc editor beside the canvas — structured notes with headings and lists,
  linked to boards
- Tags, search across boards, grouping
- Web-link cards
- An iPad version (Tauri v2 supports iOS; needs a touch and pencil redesign)

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

## Canvas gaps

A prioritised list of what the canvas still needs — written after reading a
mature canvas codebase end to end, and honest about which gaps actually bite
versus which are feature-table filler: [docs/canvas-gaps.md](docs/canvas-gaps.md).
