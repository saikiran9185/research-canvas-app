# How collaboration works (and why there is no server)

Research Canvas lets several people annotate the same board without an account,
without a company in the middle, and without anything running in the cloud.
This document explains the mechanism, because it is the part of the design most
worth understanding before changing it.

## The shape on disk

```
My Project/
  Thesis.canvas                     the drawing: shapes, media, camera
  .Thesis.canvas.comments/          the annotations
      a3f9c2e1.jsonl                  ← only Saikiran ever writes this file
      7b10dd54.jsonl                  ← only Nanki ever writes this file
  .assets/
      diagram-4f2a91c0d3e5b718.png    content-addressed media
```

Two rules produce the whole guarantee:

1. **One file per author, and you only ever write your own.**
2. **Files are append-only.** Editing or deleting a note appends a *new* line
   carrying the same `id`.

Because no two people write the same bytes, there is nothing to merge and
nothing to lose. Any sync tool that moves files — Syncthing, git, Dropbox,
rsync, a USB stick — is enough. The app polls the folder and picks up whatever
appears.

## Reading a board

Read every `*.jsonl`, parse each line, and replay:

- group lines by `id`
- keep the one with the newest `updatedAt`
- drop the ones marked `deleted`

That is `mergeAnnotationFiles` in [`src/annotations.ts`](../src/annotations.ts).
It is a pure function of the lines, so it does not care which file they came
from or in what order they arrived — every machine converges on the same
result. Ties on `updatedAt` break on `authorId`, so even a same-millisecond
clash resolves identically everywhere. `test/merge.test.mjs` pins all of this.

A line that is half-written (a sync interrupted mid-file) fails to parse and is
skipped; every other line in the file still loads.

## Identity

Your name and colour live in `localStorage` and are attached to each note as a
label. There is no account, no login, no server, and no way for the app to
identify you to anyone. Change your name any time from the sidebar; past notes
keep the name they were written with.

## Assets

Imported media is copied into `.assets/` under a name derived from a hash of
its content. Import the same file twice — or receive it from a collaborator who
already added it — and it occupies one copy on disk.

## Why this leaves room for a live server

A future sync server does not need to understand annotations at all. Every
change is already a self-contained line, so a relay that forwards lines between
peers and appends them to the right file is enough to add live collaboration.
Nothing in the format has to change, and a board stays fully usable with no
server present.
