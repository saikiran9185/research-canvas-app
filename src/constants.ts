// The tuned numbers of the canvas, in one place, each with its reason.
//
// These are the values that decide whether the board feels solid or twitchy:
// how far a pointer may travel before a click becomes a drag, how strong a
// magnet should be, how far out it is still useful to zoom. Scattered through
// the components they drifted — the maximum zoom was 4 in one file and 8 in
// another, and the minimum item size was 20 in one function and 40 in the next.
//
// Interaction conventions and tuned values are facts, not authorship: what
// counts as a comfortable grab target or a readable grid is measurable, and
// mature tools converge on similar answers because the hand and the eye are
// the same everywhere. We reference those findings and write our own values.
// No code is taken from any of them.

// ---- pointer ------------------------------------------------------------

/**
 * How far the pointer may travel before a press becomes a drag, in screen px.
 *
 * Too small and a shaky click nudges whatever it landed on; too large and
 * dragging feels like it starts late. Established tools sit between 4 and 10 —
 * the higher end suits a mouse, the lower end a stylus, where the hand is
 * already steadier and the lag is more noticeable. We were at 3, which let a
 * trackpad tap displace an item by a pixel or two.
 */
export const DRAG_SLOP_PX = 4;

/**
 * How close two presses must be to count as a double-click, in ms.
 *
 * macOS defaults to 500ms and lets it be raised for accessibility. We were at
 * 450, which quietly failed anyone slower than the platform default — they got
 * two single clicks and no editor. Match the platform rather than guess.
 */
export const DOUBLE_CLICK_MS = 500;

/**
 * Half-width of a resize handle's grab area, in screen px.
 *
 * Deliberately larger than the handle we draw (HANDLE_DRAW_PX): a target you
 * can only hit dead-centre reads as unresponsive. 11 gives a 22px square,
 * comfortably above the ~20px a mouse can hit without aiming.
 */
export const HANDLE_GRAB_PX = 11;

/** The visible handle. Smaller than its grab area, on purpose. */
export const HANDLE_DRAW_PX = 10;

/**
 * How near a thin thing — a stroke, an arrow — counts as hit, in screen px.
 *
 * A one-pixel line is impossible to click at a pixel of tolerance, and every
 * canvas tool adds a fat invisible band over the visible one.
 */
export const HIT_SLOP_PX = 8;

/** A blur this soon after an editor opened is the opening click, not the
 *  person leaving. See the pointer-capture note in interaction.ts. */
export const EDITOR_SETTLE_MS = 250;

// ---- snapping -----------------------------------------------------------

/**
 * How close an edge or centre must come before it snaps, in screen px.
 *
 * Measured on screen, not in world units, so the magnet feels identical at
 * every zoom. Below ~4 it rarely catches; above ~10 it fights you when you
 * deliberately want something slightly off-line.
 */
export const SNAP_PX = 6;

// ---- geometry -----------------------------------------------------------

/**
 * The smallest an item may be squashed to, in world units.
 *
 * One number, applied everywhere. It used to be 20 in the resize path and 40
 * in the fit path, so a text box resized through one route could reach a size
 * the other route refused.
 */
export const MIN_ITEM_SIZE = 20;

/** Text reflows rather than stretching, so it has its own floor: narrower than
 *  this and a line holds barely a word. */
export const MIN_TEXT_WIDTH = 40;

// ---- camera -------------------------------------------------------------

/**
 * Zoom range.
 *
 * The floor is a hard stop; the *useful* floor is computed per board from its
 * content (see minUsefulZoom) so the work can never shrink to an unfindable
 * speck. The ceiling is what you need to place a mark precisely on a PDF or a
 * video frame — the reference point here is that mature canvases allow far
 * more than feels necessary, because precision work needs it and nobody is
 * harmed by a limit they never reach.
 */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

/**
 * How far out of the fitting zoom you may pull back before it stops.
 *
 * 0.5 means "twice as far away as it takes to see everything" — enough for
 * context, not enough to lose the board.
 */
export const ZOOM_OUT_HEADROOM = 0.5;

/** Breathing room left around the content by zoom-to-fit, in screen px. */
export const FIT_PADDING_PX = 80;

/** Trackpad and wheel zoom sensitivity. Larger is faster. */
export const ZOOM_WHEEL_SENSITIVITY = 0.01;

// ---- grid ---------------------------------------------------------------

/**
 * The dot grid's base spacing in world units, and the on-screen band it is
 * kept inside.
 *
 * A fixed world spacing is unreadable at both ends: our 24px grid became a
 * 5px mush at 20% zoom and a vast empty field at 800%. The spacing therefore
 * steps by decades — 1, 2, 5, 10, 20, 50 … — so the dots on screen always land
 * inside a comfortable band, the same way a map's scale bar jumps rather than
 * sliding. 20 world units for the minor grid with a heavier line every 5 is
 * the convention these tools settle on.
 */
export const GRID_BASE = 20;
export const GRID_MAJOR_EVERY = 5;
export const GRID_MIN_SCREEN_PX = 14;
export const GRID_MAX_SCREEN_PX = 80;

// ---- ink ----------------------------------------------------------------

/**
 * Nib behaviour for perfect-freehand. Named NIB, not INK: `INK` in theme.ts
 * already means the default ink COLOURS, and two things called ink in one
 * file is how a rename becomes a bug.
 *
 * `thinning` is how much speed narrows the line, `streamline` how much the
 * input is smoothed toward the cursor. High streamline feels laggy; none feels
 * jittery on a trackpad.
 */
export const NIB = {
  thinning: 0.55,
  smoothing: 0.55,
  streamline: 0.4,
} as const;

/** Widths offered by the toolbar, in world units. None of them is zero: a
 *  zero-width pen is not a thin line, it is an invisible one. */
export const NIB_SIZES = [1, 2, 4, 8, 16] as const;
