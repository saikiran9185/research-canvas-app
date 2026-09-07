# Why Research Canvas does not build on tldraw, Excalidraw or BlockSuite

**Status:** decided, September 2026

This is the first question anyone asks, and it deserves a real answer rather
than a shrug. Mature infinite-canvas projects exist. We evaluated them
seriously, and chose not to build on any of them.

## The constraint that decided it

Research Canvas is meant to end up owned by the people who use it — AGPL-3.0,
DCO rather than a CLA, and a path to a foundation. That only works if the
project is free of ties to any single company's licence, roadmap or identity.
"Research Canvas is built on top of X" is not a description we can accept for
something we intend to hand over.

That constraint, on its own, would have been enough. The technical facts
happen to point the same way.

## What we looked at

### tldraw — ruled out on licensing

Excellent SDK, 50k stars, and not open source. The licence is source-available:
a key is required in production, the hobby tier keeps a "made with tldraw"
watermark, and — decisively — every downstream user needs their own licence.
A community-owned AGPL project cannot pass that obligation on to the people it
is meant to belong to.

### Excalidraw — MIT, and a wall we would hit immediately

131k stars, MIT, actively maintained, and it solves nearly every canvas problem
we have had to solve by hand. But it has no extension system for element types.
Adding one custom element type meant modifying 14 files, most of them just to
satisfy scattered type definitions, and a maintainer's own assessment is that
fixing this "would need a huge refactor, so it won't be done anytime soon".

Media cards, excerpt cards with backlinks to their source, and annotation
badges are *all* custom element types. They are not decoration; they are the
product. We would be forking on day one and, in the words of the same
discussion, merging future updates would become "a nightmare".

There is also a confirmed upstream limitation that nothing can be drawn in
front of an embedded video or PDF, regardless of z-order — which is precisely
the thing a research canvas needs to do.

### BlockSuite — the best architectural fit, at the wrong price

AFFiNE's engine, MPL-2.0, and genuinely the right shape: custom blocks and
inline embeds are first-class, which is exactly "arbitrary media on an edgeless
canvas". Its canvas renderer is better than ours.

But it is built on Yjs, and our data model is not. A board here is a plain
`.canvas` JSON file in a real folder, and its comments are append-only files,
one per author, that merge without a server. That design is why two people can
work on the same board out of a synced folder with no backend at all — and it
is the one thing neither Miro nor AFFiNE offers. Adopting BlockSuite means
giving it up.

## What we do take

Independence is not a reason to reinvent solved problems.

We use **single-purpose libraries** — the kind that take an input and return an
output and know nothing about this application. `perfect-freehand` (MIT) turns
input points into the outline of a tapering nib, which is what makes a pen
stroke look like ink rather than cable. Nobody describes an application as
"built on top of perfect-freehand", and that is the test.

Where a specific algorithm has already been solved well in MIT-licensed code,
we may adapt it with attribution and its copyright notice retained. Borrowing a
solution is not the same as inheriting an identity.

## The real cost, and how we pay it

Owning the canvas means owning its bugs, and that is a genuine expense. The
mitigation is not a framework — it is tests.

`src/geometry.ts` and `src/interaction.ts` hold the maths and the decisions
with no React and no DOM in them, and every case in `test/` is a bug that
actually shipped: the pen that could be set to invisible, the style controls
that only configured the next item, text that could not be typed into because
a captured pointer ate the click, undo that undid nothing after a move, a
toolbar that got lost off-screen. Those cannot come back silently.

That is the trade. We keep the thing that makes this project worth existing,
and we pay for it with a test suite rather than with a dependency.
