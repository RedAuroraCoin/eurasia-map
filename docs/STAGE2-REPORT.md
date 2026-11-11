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

- **Heights.** `elevationToHeight` used `(e/5200)^0.78 × 1.1`, which put 95 % of Eurasia inside
  0.15–0.35 units — the board read as a plain. Now `(e/5200)^0.62 × 2.3`, and the colour ramp was
  re-spaced over 0–2 400 m instead of 0–5 200 m, so a 400 m plain, a 1 200 m hill and a 3 000 m
  plateau are three different things.
- **White on zoom.** Two causes, both real. The terrain slabs were scaled to 0.985 cells, leaving a
  0.015-unit seam between neighbours — sub-pixel at default distance, a bright lattice once a cell
  is 40 px wide — and the sea plane *underneath* the land was told "depth 0 = shore", which the
  shader paints as white foam. Fixed by using the full cell and marking land as deep in the depth
  texture. Also added: a guard that keeps the camera above the terrain (the orbit target sits on
  the ground, so a close low camera could cut into a mountain and show sky), a sea plane 3.5× the
  board that fades into the fog instead of ending in a hard edge, and framing solved by projecting
  the board's eight corners rather than a tangent estimate.
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

## Next: Stage 3 — hurricanes

Spawn schedule (first ~6 s, then 35–75 s apart, at most two), a winding path, damage to cells inside
45 % of the vortex radius once the funnel is fully visible, the layered cloud dome with a spiral and
an eye, debris, and a message with the number of destroyed cells. The schedule becomes a
deterministic plan — the same object the two-player server will later issue — so Stage 3 pays for
Stage 4.
