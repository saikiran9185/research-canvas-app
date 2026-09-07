// Z-order that survives two people editing the same board.
//
// Until now the stacking order WAS the array order in the .canvas file. That
// works alone and cannot work together: array order is a position in a list,
// and two people who both reorder produce two lists with no way to reconcile
// them. Whoever saved last wins, silently — a real hole in the one thing this
// app does that Miro and AFFiNE do not, since boards here are files in a
// synced folder with no server to arbitrate.
//
// The fix is to give every item a fractional index: a short string that sorts
// lexicographically, and between any two of which another can always be
// generated. Reordering then becomes a change to one item's own field rather
// than a mutation of a shared list, so two edits merge the way two annotations
// already do.
//
// The arrangement — array as a cache of the order, indices as the durable
// truth, kept in sync — is the one mature canvas tools converge on, for the
// good reason that re-sorting on every render is wasteful when the array is
// already in the right order 99% of the time.

import { generateNKeysBetween } from "fractional-indexing";
import type { CanvasDoc, Item } from "./types";

/** Items are compared by index, and by id when indices tie, so that two
 *  machines that generated the same index still agree on the result. */
export function compareItems(a: Item, b: Item): number {
  const ai = a.index ?? "";
  const bi = b.index ?? "";
  if (ai !== bi) return ai < bi ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Every item carries an index. Says nothing about the array's order. */
export function indicesAreComplete(items: readonly Item[]): boolean {
  return items.every((i) => typeof i.index === "string" && i.index !== "");
}

/** Complete AND already in stacking order — the normal case, and the one that
 *  must cost nothing on every frame of a drag. */
export function indicesAreValid(items: readonly Item[]): boolean {
  if (!indicesAreComplete(items)) return false;
  for (let i = 1; i < items.length; i++) {
    if (compareItems(items[i - 1], items[i]) >= 0) return false;
  }
  return true;
}

/**
 * Give an index to any item that lacks one, placing it where it already sits
 * in the array.
 *
 * Deliberately only fills gaps. An item that already holds an index keeps it,
 * even when the array happens to be in a different order — because in that
 * case the INDEX is the truth and the array is the stale cache, and rewriting
 * indices to match a stale array is how a reorder gets silently undone. That
 * is a bug this function had, and `ordered` below is where it showed up.
 *
 * Used on load (older boards have no indices at all) and whenever an item is
 * appended — something added at the end sorts after everything, i.e. on top.
 */
export function syncIndices(items: readonly Item[]): Item[] {
  if (indicesAreComplete(items)) return items as Item[];

  const out = items.slice();
  let i = 0;
  while (i < out.length) {
    if (typeof out[i].index === "string" && out[i].index !== "") { i++; continue; }

    // The run of index-less items, and the anchors on either side of it.
    let j = i;
    while (j < out.length && !(typeof out[j].index === "string" && out[j].index !== "")) j++;
    const before = i > 0 ? out[i - 1].index ?? null : null;
    let after = j < out.length ? out[j].index ?? null : null;
    // An anchor that does not sort after `before` cannot bound the run.
    if (before !== null && after !== null && after <= before) after = null;

    const keys = generateNKeysBetween(before, after, j - i);
    for (let k = 0; k < keys.length; k++) out[i + k] = { ...out[i + k], index: keys[k] };
    i = j;
  }
  return out;
}

/**
 * The board's items in stacking order.
 *
 * The index decides the order; the array is only a cache of it. Returns the
 * same array untouched when that cache is already correct, which it is except
 * immediately after a reorder or a load.
 */
export function ordered(items: readonly Item[]): Item[] {
  if (indicesAreValid(items)) return items as Item[];
  return syncIndices(items).slice().sort(compareItems);
}

/**
 * Bring items to the front or send them to the back, preserving their relative
 * order within the moved set.
 *
 * Only the moved items get new indices — everything else keeps the index it
 * had, so a reorder is a small edit rather than a rewrite of the whole board.
 */
export function reorder(items: readonly Item[], moving: Set<string>, to: "front" | "back"): Item[] {
  if (!moving.size) return items as Item[];
  const base = ordered(items);
  const stay = base.filter((i) => !moving.has(i.id));
  const move = base.filter((i) => moving.has(i.id));
  if (!move.length || !stay.length) return base;

  const [before, after] = to === "front"
    ? [stay[stay.length - 1].index ?? null, null]
    : [null, stay[0].index ?? null];

  const keys = generateNKeysBetween(before, after, move.length);
  const moved = move.map((it, n) => ({ ...it, index: keys[n] }));
  return to === "front" ? [...stay, ...moved] : [...moved, ...stay];
}

/** An index that puts a newly created item on top of everything. */
export function indexOnTop(items: readonly Item[]): string {
  const base = ordered(items);
  const last = base.length ? base[base.length - 1].index ?? null : null;
  return generateNKeysBetween(last, null, 1)[0];
}

/**
 * Bring a loaded board up to date.
 *
 * Older .canvas files have no indices; they are assigned from the array order
 * they were saved in, so nothing moves visually and nothing is lost. Returns
 * the same object when there was nothing to do, so opening a current board
 * does not mark it dirty.
 */
export function migrateDoc(doc: CanvasDoc): CanvasDoc {
  if (indicesAreValid(doc.items)) return doc;
  return { ...doc, items: syncIndices(doc.items) };
}
