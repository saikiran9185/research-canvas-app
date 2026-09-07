# What is wrong with the structure

Written after reading AFFiNE's source alongside ours. Not a feature comparison
— a comparison of how the code is *arranged*, which is the thing that decides
how expensive the next change is.

## The one real difference

AFFiNE has **70+ feature modules**. Each is a folder that owns one thing:

    modules/app-sidebar/
      entities/    the state that feature holds
      services/    what it can do
      views/       the React that draws it
      providers/   what it needs from elsewhere, as an interface
      impls/       how that interface is satisfied here

`configureAppSidebarModule()` wires them. The sidebar's state, its persistence
and its rendering live together and nothing else can reach inside.

We have **three files**:

    Canvas.tsx       1,030 lines
    MediaViewer.tsx    934 lines
    App.tsx            843 lines

They hold state, logic and views interleaved. That is the actual problem, and
it explains the shape of this week: every bug took reading a thousand lines to
find, and fixing one thing kept breaking another, because nothing has an edge
that a change can stop at.

**We should not copy their machinery.** A dependency-injection framework is
right for 70 modules and a backend; dropped into 7,000 lines it would be
ceremony. What transfers is the principle — state, logic and view separated,
each feature owning its folder — not the framework.

We already have proof it works here. `geometry.ts` and `interaction.ts` have no
React and no DOM in them, and every bug moved into them has stayed fixed,
because it became testable the moment it had an edge.

## What to do, in order

### 1. Split `Canvas.tsx` — *started*

1,034 lines down to 753, in three extractions:

    canvas/MediaCard.tsx          95   the media cards, pure view
    canvas/items.tsx              88   ink and shape rendering, pure view
    canvas/useCanvasCommands.ts  168   every keyboard command, in one place

Still inside `Canvas.tsx` and worth lifting next:

    the pointer drag state machine   ~200 lines
    the DOM overlay                  ~150 lines

What should remain is a component that composes them.

### 2. Give the sidebar and the library their own state

Both are booleans in `App.tsx` today (`libraryOpen`, `panelOpen`), which is why
neither can remember anything or behave differently per board.

**Auto-hiding sidebar.** Needs its own state — collapsed, pinned, or peeking on
hover — persisted, the way `modules/app-sidebar` holds it. A boolean cannot
express "collapsed but showing because the pointer is at the edge".

**The library as a workbench, not a modal.** AFFiNE's `workbench` module is
their tab system, and it is a module precisely because tabs are state: which
boards are open, which is active, in what order. Today `Library.tsx` is a modal
over the canvas, so opening a board closes the library and there is nowhere for
a tab bar to live. A FigJam-style bar of open boards is not a component to
draw — it is this state to model first.

### 3. Then the rest

Align and distribute, crop, rotation — all of which get easier once there is
somewhere for them to live besides `Canvas.tsx`.

## What NOT to take from AFFiNE

Their DI framework, Yjs, the backend, the plugin system, the AI module, the
electron layer. All correct for what they are building. All wrong for a
7,000-line app whose distinguishing idea is that a board is a plain file in a
folder — an idea their architecture would take away.
