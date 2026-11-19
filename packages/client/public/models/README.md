# Custom building models

The game ships with two procedural castles, one per side. Drop a GLB in this folder and
it replaces them. No rebuild step, no config, no code change: export, copy, refresh.

| File           | Replaces                            |
| -------------- | ----------------------------------- |
| `castle-a.glb` | the amber side (side A)             |
| `castle-b.glb` | the blue side (side B)              |
| `castle.glb`   | both, unless a per-side file exists |

To see both sides on one map before multiplayer exists, set **Settings → Sides → Two**
(or open the game with `?castles=both`). It alternates the owner of the claimed cells —
a display switch that changes nothing in the engine, the wallet or the save.

If the file is missing, unreadable or not a GLB, the procedural castle stays and the
console says why. A bad export cannot break the game.

## Export from Blender

1. Model the building with its base on the ground plane (bottom at Z = 0, or Y = 0 —
   the loader moves it there anyway, but it is easier to judge while modelling).
2. Export with `File → Export → glTF 2.0`; choose the **glTF Binary (.glb)** format, turn on
   +Y Up, and leave Apply Modifiers on.
3. Copy the result here as `castle-a.glb` / `castle-b.glb` (or `castle.glb` for both)
   and reload the page.

Scale does not matter — the model is fitted into the unit box automatically. Rotation
does: the loader does not guess which way is "front", so the side you want facing the
camera should face −Z (towards the viewer at the default camera angle).

## The contract

- **One file, ≤ 3 000 triangles.** It is instanced up to 800 times; 3 000 is already
  2.4 million triangles on the 800-cell map.
- **Flat colours, not textures.** Each mesh's base material colour becomes a vertex
  colour. Textures are dropped, so a UV-mapped stone wall will come out as one flat
  colour — paint with separate materials or with vertex colours instead.
- **No animations, no skinning.** The building's only motion is the growth scale.
- **Proportions.** Height and footprint are fitted independently: the model ends up 1
  unit tall and 1 unit across, and the game places it 0.66 cells wide and up to 1.3 units
  tall. That slot is roughly 2 : 1, so a model authored near 2 : 1 (height : width) keeps
  its proportions; anything flatter gets stretched taller to fill the cell, and anything
  much thinner is widened. Filling the cell matters more than exact proportions — a
  faithful 4 : 1 tower reads as a needle next to everything else.
- **Y-up, metres or centimetres — either is fine.** Only relative size matters.

## What ships today

`castle-b.glb` — side B, 1 545 triangles, dark stone with purple vertex colours. It is
loaded like any other model here: delete it and side B falls back to the procedural
bastion. Check any replacement before committing it:

    node tools/inspect-glb.mjs packages/client/public/models/castle-b.glb --ascii

That prints triangles, materials, the final in-game size and a crude silhouette, which
is the only look you get on a machine without a browser.

## Attribution

If you use a model you did not make, its licence is your responsibility: record the
author, the licence and a link here, and keep the file's original name in the commit
message. The terrain data in this project is Natural Earth (public domain) and ETOPO
2022 (NOAA, public domain) — models are the one asset class where that does not help
you.
