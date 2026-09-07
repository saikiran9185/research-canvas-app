# UI audit

Measured from `src/App.css` (939 lines), not eyeballed. The pattern throughout
is the same: values were chosen one at a time, at the moment each component was
written, and never reconciled. Nothing here is broken — it is all *nearly*
consistent, which is worse, because near-misses read as sloppiness while
outright difference reads as intent.

A canvas app has a particular obligation here. Its chrome sits around the
user's own work all day; if the chrome is visibly imprecise, it undermines
confidence in everything shown on it.

## What was measured

### Type: 17 distinct sizes

    12px ×17   12.5px ×14   11px ×14   13px ×8   11.5px ×6
    15px ×5    10px ×4      13.5px ×3  8px ×2    16px ×2
    14px ×2    9px ×1       34, 27, 21, 19, 17px ×1 each

Half-pixel steps — 11/11.5, 12/12.5, 13/13.5 — are invisible individually and
incoherent collectively. Six sizes can carry this entire interface.

### Radius: 12 distinct values

    2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 20px

Nothing distinguishes a 9px corner from a 10px one except which day it was
written. Four steps is plenty.

### Spacing: 14 distinct paddings

    1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 20, 26px

There is no rhythm. A 4px scale (4, 8, 12, 16, 20, 24) covers every case here.

### Colour: 43 hardcoded values outside the token system

`#fff` appears 20 times, `#ef4444` 7 times, plus eight different `rgba()`
literals for shadows and scrims — `rgba(0,0,0,.4)`, `rgba(0,0,0,.3)`,
`rgba(0, 0, 0, 0.55)`, `rgba(0, 0, 0, 0.45)` — four near-identical blacks that
should be one token. Thirteen tokens exist and are good; they are simply
bypassed.

### Depth: 9 unnamed z-index values

    1, 3, 5, 10, 20, 50, 80, 90, 100

Nobody can tell from a number whether a new panel should be 60 or 85. Named
layers are self-documenting.

## Accessibility

**One focus rule in the entire stylesheet**, across roughly thirty buttons.
Keyboard users cannot see where they are. This is the most serious finding
here and the cheapest to fix.

**No `prefers-reduced-motion` block.** Three transitions exist; a user who has
asked the system for less motion still gets them.

**Targets below a comfortable size.** Swatches are 20px, the toolbar grip 14px
wide. Roughly 24px is the floor for a pointer, and these are controls people
use constantly while drawing.

**Three notations for one duration** — `120ms`, `.12s`, `.12s`. Same value,
written three ways, which is how a fourth value gets introduced by accident.

## The proposed scales

Type, in six steps, each with a job:

    --text-xs   11px   metadata, timecodes, counts
    --text-sm   12px   labels, secondary UI
    --text-md   13px   body of panels
    --text-lg   15px   panel titles
    --text-xl   19px   board title, empty-state body
    --text-2xl  27px   welcome heading

Radius, in four:

    --r-sm  4px    swatches, chips, small controls
    --r-md  8px    buttons, cards, inputs
    --r-lg  12px   panels, popovers
    --r-xl  16px   the toolbar rail, modal sheets

Space, on a 4px rhythm:

    --s-1  4px   --s-2  8px   --s-3 12px
    --s-4 16px   --s-5 20px   --s-6 24px

Depth, named rather than numbered:

    --z-canvas-ui   10   selection chrome, guides
    --z-rail        20   the tool rail
    --z-panel       30   side panels
    --z-popover     40   style panel, menus
    --z-modal       50   dialogs, the shortcuts sheet
    --z-toast       60   transient messages

Motion, one duration and one curve, plus a reduced-motion escape:

    --motion-fast  120ms
    --ease         cubic-bezier(0.2, 0, 0, 1)

## Order of work

1. **Focus rings and reduced motion.** Accessibility, and an hour's work.
2. **Tokens for colour, depth and motion.** Mechanical, no visual change.
3. **Type and radius onto the scales.** Small visual change — half-steps snap
   to whole ones — and the point at which the interface starts looking
   deliberate.
4. **Spacing onto the 4px rhythm.** The largest visual change; worth doing
   last, when the rest is stable enough to judge it against.
