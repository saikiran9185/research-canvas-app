# Contributing to Research Canvas

Thank you for wanting to help build this! Research Canvas is an infinite canvas
that makes cross-disciplinary research easier. It is **free for everyone,
forever** — no subscription, no paid tier — and it is built by volunteers.
Every hand and mind is welcome, whether you write code, design, test, translate,
or just share ideas.

Before your first PR, two short pages worth reading:
[GOVERNANCE.md](GOVERNANCE.md) (who decides what) and [FUNDING.md](FUNDING.md)
(where money comes from, and the promise that users never pay).

## Ways to contribute

- **Ideas & discussion** — open a [Discussion](../../discussions) or an issue
- **Design** — the canvas, the toolbar, the whole feel is wide open; mockups very welcome
- **Code** — pick up an issue labelled [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- **Testing & bug reports** — tell us what broke and how to reproduce it

## Getting set up

You need [Node](https://nodejs.org) and [Rust](https://rustup.rs) (`brew install rust` on macOS).

```bash
git clone https://github.com/saikiran9185/research-canvas-app
cd research-canvas-app
npm install
npm run tauri dev     # launches the app with hot reload
```

Frontend lives in `src/` (React + TypeScript). The desktop shell and file-system
commands live in `src-tauri/` (Rust). See the `README.md` for the layout.

## Submitting changes

1. Fork the repo and create a branch: `git checkout -b my-change`
2. Make your change; keep it focused. Then run the checks:

   ```bash
   npm run build                    # type-check + bundle
   npm test                         # annotation merge / convergence tests
   cd src-tauri && cargo test       # storage-layer tests
   ```
3. **Sign off your commits** (see below).
4. Open a Pull Request describing *what* and *why*.

A maintainer will review. Be kind and patient — this is a volunteer project.

## Developer Certificate of Origin (DCO)

We use the **DCO instead of a CLA**. This is deliberate and it is a promise to
you: **you keep the copyright to your own work.** No person and no company —
including the founder — owns the codebase or can relicense it. That is precisely
why Research Canvas cannot be taken private or put behind a paywall later.

The project name is held separately from the code; see
[TRADEMARK.md](TRADEMARK.md) for what that does and does not mean (short version:
fork freely, just give your fork its own name).

To sign off, just add `-s` to your commits:

```bash
git commit -s -m "Add audio waveform preview"
```

This appends a line like `Signed-off-by: Your Name <you@example.com>`, certifying
you wrote the change (or have the right to submit it) under the project's license.
That's all — no paperwork.

## License

By contributing, you agree your work is licensed under the project's
[AGPL-3.0-or-later](LICENSE) license.
