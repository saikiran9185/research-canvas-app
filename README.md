# Research Canvas

A native **infinite canvas for research** — drop in any medium, then pin a note to
the exact frame, page or region you mean. Built as a **Tauri** desktop app
(Rust + React) with a fully custom canvas engine.

> Free, open source, and offline. No account, no server, no company in the
> middle. Your boards are plain files in a folder you choose.

## Features

### The canvas
- **Infinite canvas** — pan (scroll), zoom (⌘/pinch), dotted grid
- **Tools** — select, pan, freehand pen, rectangle, ellipse, arrow, text, sticky notes, comment
- **Any medium** — images (incl. avif/heic/tiff), video, audio, **PDF**, and 3D file cards
- **Drag files straight onto the canvas**, or import from the toolbar
- **Move & resize**, undo/redo (⌘Z / ⌘⇧Z), zoom-to-fit
- **Light / dark / follow-the-system** appearance

### Annotation — the point of the whole thing
Open any file on the board (double-click, or *Annotate*) to get a focus view:

- **Video** — play, pause, step a frame at a time, and pin a comment to a
  timecode. Every note shows as a tick on the timeline; click it to jump there.
- **PDF** — page through the document and drag a box over a paragraph to
  highlight it and attach a note. Pages carrying notes are marked in the pager.
- **Images** — highlight a region, drop a pin, or scribble on it freehand.
- **Audio** — pin a comment to a moment.
- **All in one place** — a board-wide notes panel, searchable, filterable by
  author, and grouped by the file each note belongs to.

### Sharing
- **Export the whole board as a PDF** — the canvas, then a page per annotated
  moment with the highlight drawn onto the frame, then an index of every note.
  Someone with no app and no internet can still see exactly what was said about
  what.
- **Export notes** as Markdown, CSV or JSON.

### Collaboration without a server
Comments live outside the board file: one **append-only `.jsonl` per author**.
Share the folder however you like — Syncthing, git, Dropbox, a USB stick — and
several people can annotate the same board with **nothing to merge and nothing
to lose**. Notes a collaborator syncs in appear within a couple of seconds.

See **[docs/collaboration.md](docs/collaboration.md)** for how and why.

- **Auto-save** as you work
- **Self-updating** — installed apps check GitHub Releases and update themselves

## Develop

```bash
npm install
npm run tauri dev      # launches the app with hot reload
```

Requires Node and Rust (`brew install rust`).

## Build a local app

```bash
npm run tauri build
```

Produces `Research Canvas.app` and a `.dmg` in
`src-tauri/target/release/bundle/`.

## Releasing (auto-update)

Updates are automated with GitHub Actions (`.github/workflows/release.yml`) +
`tauri-action`, signed with the updater key.

```bash
# 1. bump the version in src-tauri/tauri.conf.json (e.g. 0.1.0 -> 0.2.0)
# 2. tag and push
git tag v0.2.0
git push origin v0.2.0
```

CI then builds a universal macOS app, signs it, and publishes a GitHub Release
including `latest.json`. Every installed app reads that manifest on launch and
updates itself — verifying the signature against the public key baked into
`tauri.conf.json`.

### Signing keys

- **Public key** — in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
- **Private key** — kept out of the repo (`~/.tauri/research-canvas-app.key`) and
  stored as GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. If lost, updates can no longer be signed.

> For distribution without a Gatekeeper warning, add an Apple Developer ID and
> notarization (separate from the updater signature). Not required for updates to work.

## Keyboard

| | |
|---|---|
| `V` `H` `P` `R` `O` `A` `T` `N` `C` | select · pan · pen · rect · ellipse · arrow · text · note · comment |
| `Space` (hold) | pan from any tool |
| `⌘Z` / `⌘⇧Z` | undo / redo |
| **In the focus view** | |
| `Space` | play / pause |
| `←` `→` | step one frame (or turn the PDF page) |
| `⇧←` `⇧→` | step one second |
| `C` | comment at this moment |
| `⌘↵` | post the comment |
| `Esc` | close |

## Project layout

- `src/`
  - `Canvas.tsx` — the canvas engine; `Toolbar.tsx`, `Sidebar.tsx`, `App.tsx`
  - `types.ts` — the board and annotation data model
  - `annotations.ts` — the annotation store and the conflict-free merge
  - `MediaViewer.tsx` — the focus view (video timeline, PDF pages, highlights)
  - `CommentsPanel.tsx` — every note on the board, in one list
  - `pdf.ts` — pdf.js wrapper; `render.ts` — rasterising the board
  - `exportPdf.ts` — the shareable PDF; `theme.ts` — light/dark
- `src-tauri/src/lib.rs` — Rust file-system + annotation-storage commands
- `src-tauri/src/tests.rs` — storage tests (`cargo test`)
- `test/merge.test.mjs` — merge/convergence tests (`npm test`)
- `docs/collaboration.md` — how multi-user works without a server

## Tests

```bash
npm test                       # annotation merge + convergence
cd src-tauri && cargo test     # storage layer
```

## Contributing & community

This is a community project and we'd love your help — code, design, testing, or ideas.

- Read **[CONTRIBUTING.md](CONTRIBUTING.md)** to get set up (we use a simple DCO sign-off, no CLA)
- See the **[ROADMAP.md](ROADMAP.md)** for what's being built next
- How the project is run and stays community-owned: **[GOVERNANCE.md](GOVERNANCE.md)**
- Be kind: **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**
- New here? Look for issues labelled **`good first issue`**, or open a **Discussion**.

## License

**[AGPL-3.0-or-later](LICENSE).** You're free to use, study, change, and share it —
and any version you distribute or host must stay open source too. This keeps Research
Canvas free for the community, forever.
