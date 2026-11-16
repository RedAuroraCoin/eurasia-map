# Custom building models

Drop a file called `castle.glb` in this folder and the game uses it instead of the
procedural castle. No rebuild step, no config, no code change: export, copy, refresh.

If the file is missing, unreadable or not a GLB, the procedural castle stays and the
console says why. A bad export cannot break the game.

## Export from Blender

1. Model the building with its base on the ground plane (bottom at Z = 0, or Y = 0 —
   the loader moves it there anyway, but it is easier to judge while modelling).
2. `File → Export → glTF 2.0 (.glb/.gltf)`, format \*\*glTF Binary (.glb)`,
`+Y Up`on,`Apply Modifiers` on.
3. Copy the result here as `castle.glb` and reload the page.

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
- **Proportions.** The model is fitted so the tallest dimension is 1 unit and the
  footprint is at most 1 × 1. The game then places it 0.66 cells wide and up to 1.3
  units tall, so a model authored roughly 2 : 1 (height : width) appears undistorted.
- **Y-up, metres or centimetres — either is fine.** Only relative size matters.

## Attribution

If you use a model you did not make, its licence is your responsibility: record the
author, the licence and a link here, and keep the file's original name in the commit
message. The terrain data in this project is Natural Earth (public domain) and ETOPO
2022 (NOAA, public domain) — models are the one asset class where that does not help
you.
