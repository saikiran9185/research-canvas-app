# Third-party code

Research Canvas is AGPL-3.0-or-later. This file records every piece of
outside code it carries, so that anyone auditing the project — a contributor,
a packager, or a future foundation — can see where each part came from without
having to reconstruct it from git history.

The rule we apply: a dependency must be **single-purpose**. It takes an input,
returns an output, and knows nothing about this application. We do not build
on frameworks that would make Research Canvas a derivative of someone else's
product. The reasoning is in
[docs/decisions/0001](docs/decisions/0001-why-we-do-not-build-on-an-existing-canvas.md).

## Bundled at runtime

### perfect-freehand 1.2.3 — MIT

Turns input points into the outline of a tapering nib, which is what makes a
pen stroke read as ink rather than as a constant-width cable. Used in
`src/Canvas.tsx`.

> Copyright (c) 2021 Stephen Ruiz Ltd
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### fractional-indexing 4.0.0 — CC0-1.0 (public domain)

Generates the short sortable strings that carry stacking order, so that two
people reordering the same board converge instead of overwriting each other.
Used in `src/order.ts`. CC0 reserves no rights and requires no attribution;
it is recorded here for completeness rather than obligation.

The algorithm is David Greenspan's, published at
<https://observablehq.com/@dgreensp/implementing-fractional-indexing>.

The React, Vite, TypeScript and Tauri toolchains are ordinary declared
dependencies under their own permissive licences; see `package.json` and
`src-tauri/Cargo.toml`.

## What we studied but did not copy

Interaction conventions and tuned constants — how far a pointer may travel
before a click becomes a drag, how strong a snap should feel, what zoom range
is useful — are **facts and ideas, not expression**, and carry no copyright.
We measured what mature canvas tools converge on and chose our own values in
`src/constants.ts`, with the reasoning written down beside each one.

No code was copied from Excalidraw, tldraw, BlockSuite, Konva or Fabric.js.
Where a published algorithm is adapted from MIT-licensed source, it will be
recorded in this file with its copyright notice, as perfect-freehand is above.
