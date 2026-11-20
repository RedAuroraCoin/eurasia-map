# Stage 2 — report

Single-player game: 3D map, claiming, coins, daily income, 30-day buildings, day/night, terrain
relief, animated sea, versioned local saving, panel.

## What exists

| File | Responsibility |
|---|---|
| `render/grid.ts` | cell ↔ world, elevation → height, camera fit distance. Pure. |
| `render/palette.ts` | sky / sun / ambient by time of day, night factor. Pure. |
| `render/geometry.ts` | terrain slabs, buildings, pop animation, sea-depth texture. Pure. |
| `render/water-shaders.ts` | the two GLSL sources, kept separate so they can be parsed in a test. |
| `render/scene3d.ts` | three.js assembly: instanced terrain, instanced buildings, shader sea, sun + shadows, window glow, orbit controls, picking. |
| `render/flat2d.ts` | the no-WebGL view (and the low tier) with the same colours and the same `View` interface. |
| `render/view.ts` | WebGL probe → 3D or 2D. |
| `state/save.ts` | per-map-size saves, version envelope, structural validation, migration chain. |
| `state/settings.ts` | settings with per-field validation and fallbacks. |
| `ui/app.ts` | the whole interface: stats, progress bar, panel, dialog. |
| `ui/dom.ts` | element helper and an accessible segmented control. |
| `main.ts` | wiring: engine ↔ view ↔ storage ↔ input ↔ clock. |

Behaviour as specified: claim 5 / refund 5 / start 10; 1 coin per claimed cell per UTC day, paid on
return and every 60 s; buildings grow over 30 days on an ease-out curve with ±14 % per-cell height
variation and a 450 ms pop on claim; auto / day / night lighting from the local clock; relief
on/off; hurricanes toggle (stored, does nothing until Stage 3); time speed 1× / 60× / 600×; demo
city at one day per second with no coins and no saving; reset behind a confirmation dialog; progress
saved per map size, so trying the 800 map does not destroy the 300 map.

## Verified — commands actually run

```
npm run typecheck      tsc on shared + client + server — clean
npm run lint           39 files, import boundaries ok, prettier clean
npm test               12 files, 120 tests passed
npm run build          vite 8.3.7 — 692 kB (182 kB gzip), 3.6 MB source map
npm run check          all of the above, in order
```

Test breakdown: 10 grid, 8 palette, 12 geometry, 5 shader parsing, 11 save, 8 settings, 7 DOM
(boot, claim on Enter, refund, click on land, sea rejection, persistence across a reload, size
switch, theme, demo mode), plus the 59 rule and map tests from Stage 1.

What those tests actually pin down:

- every cell round-trips through world → cell → world;
- the highest cell of the map is still Tibet;
- a claimed cell is tinted and keeps its height;
- a building is taller on day 29 than on day 10 and stops at day 30;
- a save whose `claimed` count disagrees with its cells is rejected as corrupt;
- a save from a newer version is refused, not silently dropped;
- one corrupt settings field costs one setting, not the panel;
- the water shaders parse as GLSL, declare matching varyings, and use only uniforms the scene sets;
- clicking a land cell in the real DOM claims it and spends 5 coins; the sea is refused with a
  message; the claim survives a simulated reload.

## Fixes after the first look (2026-11-11)

Reported: "heights are visible only in a narrow range, and the slightest zoom turns the map white".

**The white map was a colour-space bug, and my first two guesses were wrong.** `landColor` returns
0..255 because it also feeds CSS; `THREE.Color.setRGB` expects 0..1 and **clamps**, so every channel
became 1 and every land cell rendered solid white — at every zoom level. The console line the user
sent (`PCFSoftShadowMap has been removed`) was unrelated.

- **Fixed:** a `unitColor()` helper is now the only way a ramp colour reaches three, the type is
  named `Rgb255` so the two spaces cannot be confused, and the owner tint was moved into the same
  0..255 space (it had been mixing 0.93 with 255). A test asserts no terrain colour is white after
  conversion.
- **Settings key bumped** (`eurasia.settings.v2`): a stored `relief: false` from the previous look
  would have kept the map flat and made the new scale look broken.
- **Also fixed, and real though not the reported symptom:** the slabs were 0.985 cells wide, leaving
  a seam that would show the water plane at close range; the water under land was marked "shore" and
  painted foam through that seam; a close low camera could cut into a mountain and fill the screen
  with sky. Those fixes stand.
- **Heights.** `elevationToHeight` used `(e/5200)^0.78 × 1.1`, which put 95 % of Eurasia inside
  0.15–0.35 units — the board read as a plain. Now `(e/5200)^0.62 × 2.3`, and the colour ramp was
  re-spaced over 0–2 400 m instead of 0–5 200 m.
- **Relief, third pass.** The numbers were fine (0.08–2.33 units) but the *screen* relief was not:
  a 2.3-unit Tibet on a 36-deep board is 5 % of the frame, and the camera fit was raising all four
  board corners to the tallest peak, which pushed the camera back and cancelled the exaggeration.
  Now `MAX_VISUAL_HEIGHT = 7` with a `^0.45` curve (a 400 m plain is 2.2 units, Tibet 7), the fit
  uses the waterline plus the single highest cell, and a test measures the relief **in pixels**:
  median land shows > 12 px of step and the peak > 70 px on a 900 px viewport.
- **Framing.** The old estimate framed on the diagonal with a 1.25 margin, putting the camera ~40 %
  further out than needed. `fitDistance` now bisects for the exact distance at every aspect ratio;
  a test projects the land corners with three's own matrices and asserts they stay on screen.

## Not verified — and why

- **The 3D scene has never been rendered.** This machine has no Chromium (13 shared libraries
  missing, no `sudo`, and the apt mirror is unreachable), so there is no screenshot and no shader
  compilation. Everything above is arithmetic and DOM; the pixels are untested. Specifically
  unverified: the look of the sea and foam, the sun/shadow setup, the camera's feel, the night
  window glow, that the water triangles do not tear at the shoreline, and the frame rate on a phone.
- **Touch gestures were not exercised.** OrbitControls handles them, but pinch-zoom and two-finger
  pan have not been tried on a device.
- **The 2D fallback is the only path the DOM test covers**, because that is the path a browser
  without WebGL takes. It is honest about what it can see.

## Risks

1. **Visual risk concentrated in one file.** `scene3d.ts` is ~600 lines of three.js with no test
   that can see a pixel. If it looks wrong, the fault is almost certainly there and the fix is
   local.
2. **Bundle size.** 182 kB gzip, of which three.js is ~160 kB. Acceptable for a 3D game; it would
   matter only on a very slow connection.
3. **Growth versus income clocks.** The speed multiplier accelerates the world clock (buildings,
   sun) but not the money clock (UTC days). That is deliberate — otherwise 600× would print coins —
   and it means a player who runs at 600× sees buildings grow faster than their income suggests.
4. **Per-size saves.** Three saves coexist; the panel has no "which map has progress" indicator yet.

## Buildings: castles, not boxes, one per side

Two sides get two different castles, because at twenty pixels the outline is what tells
them apart — a shared shape with a different tint would not survive the zoom-out.

- **Side A — keep.** Wide crenellated keep, four round corner towers with conical roofs,
  eight merlons, a gate. Warm stone, terracotta roofs.
- **Side B — bastion.** One tapering round tower with a slate spire above four low square
  bastions and a curtain wall. Cooler stone, blue-grey roofs.
- Each is one merged geometry (~216 and ~174 triangles) in its own `InstancedMesh`, so the
  whole map costs **two draw calls**, not one per building. The material is shared.
- Owner colours are amber and blue, mixed 60 % into the building: the stone renders as
  rgb(188,125,78) on side A and rgb(93,110,144) on side B, which is a difference you can
  see without reading anything. A 40 % mix was invisible at play zoom.
- **Settings → Sides → Two** alternates owners so both designs can be seen before
  two-player mode exists (`?castles=both` does the same for a link). A display switch in
  the renderer, not a rule in the engine — and it is in the panel, because a hidden URL
  parameter is not a feature: the first version shipped one and the second castle was
  never seen.
- Per-side custom models: `models/castle-a.glb` and `models/castle-b.glb`, with
  `models/castle.glb` as the shared fallback. Both sides ship one: side A is a 1 545
  triangle dark-stone tower with purple vertex colours, side B a 1 464 triangle golden
  sandstone tower with dark green roofs.
- Side B's model is **generated** by `tools/make-castle-b.mjs` — deterministic, so the
  asset can be rebuilt after a tweak instead of being an opaque blob. The script asserts
  its own triangle budget and fails the build if it drifts.
- Models are tinted 25 % towards the owner colour instead of 60 %: a golden castle turned
  60 % blue is a blue castle, and the two models already differ by design.
- **The fit changed for it.** Fitting a model by its longest dimension made a 2 : 1 tower
  0.31 cells wide — a needle next to a 0.66-wide castle. Height and footprint are now
  fitted independently, so every building fills the same cell and an authored 2 : 1 shape
  lands at 1.97 : 1 in game, a 7 % change rather than a factor of two.
- `tools/inspect-glb.mjs` reports triangles, materials, final in-game size and an ASCII
  silhouette for any GLB, which is how a model gets checked without a browser.

### The first castle

A box reads as a placeholder; a castle reads as a building. `render/castle.ts` assembles one from
primitives — a keep, four corner towers with conical roofs, eight merlons, a gate — merged into a
single geometry of **216 triangles**, so eight hundred of them are still one instanced draw call.

- Part colours (stone, shaded stone, terracotta roof, dark gate) are baked as **vertex colours**, so
  three materials' worth of detail costs zero extra draw calls. The per-instance colour leans 40 %
  towards the owner tint instead of replacing it, so castles stay stone-coloured and still show who
  owns them.
- Everything is built inside a unit box (footprint 1×1, base at y = 0, top at y = 1) because the
  scene scales it per instance. A test asserts that contract, plus vertex colours in range and
  normals present.
- The silhouette was checked without a GPU by rasterising the indexed triangles in XY and printing
  them: two roofed towers, merlons between them, a solid keep. That is the only "look" verification
  this machine can do.
- `BUILDING_MAX` 1.6 → 1.3 and footprint 0.5 → 0.66: a castle is wider than a tower, and at 1.6 it
  would have read as a spire.

## The king builds

Claiming is no longer free-form: a side has one king, and only the king builds.

- **First claim founds the capital** anywhere on land and places the king there.
- **Every later claim must be one king move away** — the eight neighbours of a chess king,
  clipped to the grid. The king moves onto the cell it builds, so expansion is a walk.
- **Stepping onto your own land is free** and builds nothing: that is how the king gets
  back to a branch it left. A plain click on your own cell next to the king steps; a click
  further away demolishes; Shift+click always demolishes.
- **The king's own square cannot be demolished** — move it first.
- The king is a 168-triangle chess piece in the side's colour, standing on top of whatever
  was built on its square, so it rises with the tower as it grows.

Engine-side this is one new field (`kings: [number, number]`, -1 until placed), one new
command (`move`), three new error codes and `kingMoves()`. The row-wrap trap is covered by
a test: cells 9 and 10 are neighbours in the array and on opposite edges of the map.

**Save format v1 → v2.** Old saves have no king; the migration derives it from the oldest
owned cell per slot, which is deterministic and keeps an existing city playable instead of
discarding it.

## Hurricanes: partial damage, deterministic plans

A hurricane is a **plan**, not a simulation. The server (or the single-player clock) picks a
seed and emits a complete object: seed, side, start time, a winding path through control
points, a vortex radius, and the moment the funnel is fully formed. That object never
changes, so the two-player room will send the exact same object to both clients and they
will animate it in perfect lockstep — no tick loop, no state drift.

- **Partial damage, not destruction.** Every tower has 100 HP. A hurricane does 35 damage
  to every cell inside ~45 % of its vortex radius. One hit cracks a tower (it shrinks and
  darkens), two hits weaken it further, the third levels it. The king steps off a ruined
  square automatically; if it has no owned neighbour the capital disappears.
- **The funnel sits on the terrain.** The view samples the ground height under the
  storm's centre each frame, so the funnel touches mountains and plains alike.
- **Schedule.** First ~6 s, then 35–75 s between spawns, max 2 at once, lifetime 28–42 s.
  Damage lands at 30 % of the storm's life. While players are away the schedule is
  paused; on return the first storm waits the normal gap.
- **Deterministic.** The path is a Catmull-Rom spline through 5 control points; the same
  seed always yields the same path, the same damage cells, the same timing. A test
  asserts that `planStorm(42) === planStorm(42)` and that damage cells are a subset of
  land.
- **Single-player UI.** Settings → Hurricanes toggles the whole system. When a storm
  hits, the message line reports: "Hurricane: 3 towers damaged, 1 destroyed" or just
  damaged.
- **Visuals.** Three draw calls per storm: a squashed dome, a tapering funnel with
  three spinning rings, a point-cloud debris ring. Two storms max = six draw calls.
  The funnel leans and spins; the cloud dome sways. Colours shift with day/night.
- **No tick loop.** The damage is resolved once, at the plan's `damageAt` moment, by
  calling `reduce(state, { k: 'damage', cells: stormCells(plan, map) })`. The client
  just animates the plan against the clock.

## Next: Stage 4 — two-player room

Spawn schedule (first ~6 s, then 35–75 s apart, at most two), a winding path, damage to cells inside
45 % of the vortex radius once the funnel is fully visible, the layered cloud dome with a spiral and
an eye, debris, and a message with the number of destroyed cells. The schedule becomes a
deterministic plan — the same object the two-player server will later issue — so Stage 3 pays for
Stage 4.
