# Research Canvas

A native **infinite canvas for research** — draw, drop any media, take notes, and
organize your thinking across folders of boards. Built as a **Tauri** desktop app
(Rust + React) with a fully custom canvas engine.

> Personal-first: your boards live as plain `.canvas` files on disk. Real-time
> collaboration is a planned later phase.

## Features

- **Infinite canvas** — pan (scroll), zoom (⌘/pinch), dotted grid
- **Custom tools** — select, pan, freehand pen, rectangle, ellipse, arrow, text, sticky notes
- **Media** — import images, video, and audio; previewed/played inline
- **Annotations** — notes that stick to a *place* or *moment*: drag a region on an
  image or video frame, or pin an audio/video timestamp, with a side panel listing
  every note on the board (Annotate tool, `C`)
- **Move & resize**, undo/redo (⌘Z / ⌘⇧Z), zoom-to-fit
- **Folders on disk** — boards are `.canvas` files under `~/Documents/Research Canvas/`,
  browsable both in the app sidebar and in Finder
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

## Project layout

- `src/` — React frontend: `Canvas.tsx` (engine), `Annotations.tsx` (pins/highlights
  drawn on media), `AnnotationPanel.tsx`, `Toolbar.tsx`, `Sidebar.tsx`, `App.tsx`, `updater.ts`
- `src-tauri/src/lib.rs` — Rust file-system commands + plugin setup
- `src-tauri/tauri.conf.json` — app config, asset protocol, updater endpoint

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
