# Feature — windows and a small outside world

The room is a sealed box, and it feels claustrophobic. This feature opens it to a painted Cambodian countryside of rice paddies and sugar palms under a live sky. The sky follows the existing Cambodia-time lighting ([REAL_TIME_LIGHT_SHIFT.md](REAL_TIME_LIGHT_SHIFT.md), implemented in `src/gallery/timeOfDay.ts`).

## Decisions

| Option | What it is | Status |
|---|---|---|
| **A. Real skylight** | The ceiling light strip becomes clear glazing with live sky above it. | **Build now** |
| **B. Clerestory windows** | High windows on both long walls, above the art. | **Build now** |
| **C. Paddy bay** | A floor-to-ceiling glass bay at eye level, opening onto the paddies. | Later; design notes below |
| D. Entrance windows | Windows on either side of the title text. | Not planned |

Outside is **rice-paddy countryside**: flat paddies, earth dikes, rows of sugar palms (*Borassus*), and a soft tree line on the horizon. It is not a city or a real landmark.

## Sightlines: what A + B can actually show

The clerestory windows sit above eye level (1.68 m), so every view through them points **upward**: sky, plus anything tall enough to rise into that sightline. From the room, a window at 3.5 m on a wall 4.5–8.5 m away gives a sightline that climbs about 0.2–0.4 m per metre outside. At 25–55 m out, only objects taller than about 7–23 m appear.

- **Visible in A + B:** sky, clouds, sun/moon, stars, and the **crowns of sugar palms** (15–25 m tall) planted 25–55 m out.
- **Not visible in A + B:** the paddies, dikes, water and anything near the ground.

Build only what A + B can show: sky dome and palms. **Do not build the paddy ground yet.** It arrives with C, which is the first opening low enough to see it. Keep the outside scene in its own module so C can add to it.

## Visual direction

- **Painted, not photographic.** Flat, soft color bands, like the existing `genHorizon` artwork generator. Use muted tones that sit with the paper/ink/rust palette. Avoid saturated "screensaver blue" skies.
- Palms are dark silhouettes with gentle atmospheric fade: the farther the palm, the closer its color is to the horizon.
- The windows are a backdrop, not a feature. The art stays the brightest, most detailed thing in the room.
- **Interior lighting values do not change** because of the windows. The room still lights the art exactly as `timeOfDay.ts` says. Retune only if a window makes the room look wrong.

## Room orientation and sun model

The room's long axis is north–south. The featured-work wall (−z) faces **north**, the +x long wall faces **east**, and the −x wall faces **west**.

Add to `timeOfDay.ts` (pure, unit-testable):

- `sunDirection(minutes, target: Vector3)`: rises due east (+x) at 06:00, peaks at ~78° elevation tilted ~12° toward south (+z) at 12:00, and sets due west at 18:00. Below the horizon outside that window.
- `moonDirection(minutes, target)`: the same arc shifted, rising ~18:30 and setting ~05:30, with a fixed phase (no lunar calendar).

Sunrise/sunset times stay fixed all year, matching the existing keyframes.

## A. Real skylight

Today the skylight is an emissive plane, `sky` (`PlaneGeometry(2.38, 18.6)` at `ROOM.h − 0.06`), under a solid ceiling, framed by boxes at x = ±1.22 and z = ±9.4.

- Cut a **2.38 × 18.6 m opening** in the ceiling: rebuild the ceiling as a `ShapeGeometry` with one hole, and keep its UVs normalized to 0..1 over the full ceiling rectangle.
- Add a **light well**: four inner faces about 0.5 m deep above the opening (y 4.4 → 4.9), in the ceiling material, merged into one mesh.
- Add **glazing bars** across the opening every ~1.2 m, plus one central bar along it. Use thin dark-metal bars matching the track material, merged into one mesh.
- **Remove the emissive `sky` plane.** The sky dome (below) shows through instead.
- The `skyColor` / `skyIntensity` lighting parameters lose their only consumer. Remove them from `LOOKS` and the apply code, or reuse them as the dome tint. Do not leave dead parameters.

## B. Clerestory windows

- **Three windows per long wall**, centred on the gaps between works at **z = −5.5, 0, +5.5**. Bright glass must never sit directly above a painting, where it would make the painting read darker.
- Each window: **2.6 m wide × 0.8 m tall, sill at 3.15 m, head at 3.95 m.** The tallest work's top edge is at ~2.6 m and the ceiling at 4.4 m, so the window keeps clear margins on both sides. The picture-light beams start at x = ±3.15, 4.3 m and aim downward at the walls, so the windows do not cross them.
- Rebuild the two long walls as `ShapeGeometry` with three holes each. **Normalize UVs to 0..1 over the full 24 × 4.4 m wall** so the plaster texture maps exactly as it does today. Short walls are unchanged.
- **Reveals**: jambs, sill and head extending 0.25 m **outward** (outside the room) in the wall material, merged per wall. They give the opening depth and do not affect collision.
- **Mullions**: two vertical bars per window, in the same material as the skylight bars, merged per wall.
- **No glass pane by default.** An open hole with mullions already reads as a window. If it looks unglazed, add a single very faint `MeshBasicMaterial` plane (`transparent`, opacity ≤ 0.06, `depthWrite: false`). Never use `MeshPhysicalMaterial` transmission.

## The outside world (`src/gallery/outside.ts`)

One module builds and updates everything outside the room and exposes `update(lighting, minutes, elapsed)`.

### Sky dome

- One `SphereGeometry` (`BackSide`) with a `ShaderMaterial`. **Radius 65**, centred on the room. The camera's `far` is 80 and the camera can stand up to ~13 m from the room centre, so 65 + 13 stays inside it. Keep `far` unchanged.
- The colour comes from the **view direction**, so the sky reads as infinitely far away:
  - Vertical gradient from horizon to zenith colour, plus a slight warm haze band near the horizon.
  - Sun disc with a soft glow (`dot(dir, sunDir)`), fading out below the horizon.
  - Moon disc at night.
  - **Clouds**: sparse, soft, 2-octave value noise on a flat cloud layer (project `dir.xz / dir.y`), drifting slowly with time. Cloud colour follows the lighting.
  - **Stars**: hashed points on a direction grid, faded in by `starOpacity`.
- Include `#include <tonemapping_fragment>` and `#include <colorspace_fragment>` so the dome matches the renderer's tone mapping and exposure.
- **`renderOrder` must place the dome after the room's opaque meshes**, and the dome must be depth-tested. Three.js sorts opaque objects front to back by object centre, and the dome's centre is near the camera, so without this the dome would be shaded across the whole screen before the walls cover it. The aim is to shade dome pixels only where a window or the skylight shows them.

### Sugar palms

- A sugar-palm silhouette (tall thin trunk, round fan-leaf crown) drawn once on a canvas as an alpha texture, using the same canvas approach as the artwork generators.
- **One `InstancedMesh` of crossed quads** (two planes at 90°) for all palms: ~24–40 instances in loose rows and clusters on the east and west sides, 25–55 m from the room centre (inside the dome and the camera far plane), 15–25 m tall, with seeded random scale and rotation. One draw call. No per-frame CPU work.
- Unlit material with `alphaTest` (no transparency sorting). Tint comes from a `palmColor` uniform blended toward the horizon colour by distance (atmospheric fade).
- **Wind sway**: a small vertex offset that grows with height (`sin(time + instancePhase)`). Off under reduced motion.
- Place palms so that some crowns are visible from typical standing points through each clerestory window. Check this with screenshots, not by assumption.

### Not now

Paddy ground plane, water, dikes, egrets: these arrive with C.

## Lighting integration

Extend `LOOKS` in `timeOfDay.ts` with the outside parameters. Interpolate them through the same keyframes and smoothstep as everything else. Starting values (tune them by eye; keep them muted):

| Parameter | Morning | Afternoon | Golden | Night |
|---|---|---|---|---|
| `skyZenith` | `#9fb4c8` | `#8aa2b8` | `#8c8aa6` | `#0d1220` |
| `skyHorizon` | `#efe6d3` | `#e9e6dc` | `#e9b07a` | `#222b3d` |
| `sunColor` | `#fff1d6` | `#fffaf0` | `#ffb766` | `#cfd8ea` (moon) |
| `cloudColor` | `#f6f3ec` | `#fbfaf6` | `#f2c49c` | `#1d2433` |
| `cloudCover` | 0.35 | 0.3 | 0.4 | 0.25 |
| `starOpacity` | 0 | 0 | 0 | 1 |
| `palmColor` | `#5b6253` | `#4f584a` | `#3a302a` | `#0c0f14` |

The outside updates on the same schedule as the room (at most once per second, plus `elapsed` for cloud drift and sway every rendered frame as a uniform). It reuses `Color` / `Vector3` instances. Paused and index states skip rendering as they do now.

## Optional: sun patches

Ship this only if A + B look right without it, and only if it reads well:

- Soft, additive, unlit quads where sunlight through each clerestory window lands. Project the four window corners along `sunDirection` onto the floor (or the far wall's upper band). Update positions in place at the lighting tick.
- Opacity follows sun elevation and `cloudCover`; zero at night.
- **A patch must never fall on an artwork or placard rectangle.** Clip it or fade it out.
- No new lights. `depthWrite: false`, `polygonOffset` to avoid z-fighting.

## Performance rules (unchanged from the performance work)

- **No new lights**, no `light.visible` toggles, no shader-define changes at runtime. The new programs (dome, palms, any glass) compile once during `build()`, and the existing `compileAsync` must cover them. `renderer.info.programs.length` must be equal at 07:00, 14:00, 18:00 and 22:00.
- New draw calls ≤ ~10 in total: dome 1, palms 1, skylight well/bars ≤ 2, wall reveals/mullions ≤ 4, optional glass ≤ 2, optional sun patches ≤ 1. Nothing new casts a shadow.
- Merge static geometry the same way the frame bars were merged.
- Frame-time p95/p99 per state at DPR 1 and 2 must stay within run-to-run noise of `verification/perf-after.json`.

## Verification

Add `verification/windows.mjs` (existing Playwright setup; pin time with `?time=HH:MM&speed=0`):

- **Screenshots** at 07:00, 14:00, 18:00 and 22:00 from three fixed poses: room overview, looking up at the skylight, and facing one east clerestory window from mid-room. Save under `verification/windows/`.
- **Palms visible**: at 14:00, at least one palm crown is visible through each east and west window from the mid-room pose. Check pixel darkness inside the window rectangle against the sky colour.
- **Sky ordering**: at 22:00 the window/skylight pixels are darker than the room's walls; at 14:00 they are brighter.
- **Stars** appear only at night, and the **sun** appears through the east windows in the morning and the west windows in the afternoon (test with an upward-looking pose).
- **Art unchanged**: mean luminance of each artwork's screen rectangle at 14:00 stays within ±3% of the pre-feature value. Light-shift's "afternoon identity" check now applies to the artwork rectangles only, because the room now has windows.
- **No full-screen dome shading**: dome `renderOrder` exceeds every room mesh, and a capture with the dome material replaced by solid red shows red only in openings.
- **No recompiles**, the **draw-call budget** and **perf within noise**, as above.
- **Unit check** in `verification/time-of-day-check.mjs`: `sunDirection` points east at 06:00, is highest near 12:00 and points west at 18:00. The sun is below the horizon at 22:00. The moon is above the horizon at 00:00.
- **Regression**: `npm run build`, `npm run format:check`, all 7 suites in `issues-checks.mjs`, `resize-paused-check.mjs` and the light-shift checks pass. Reduced motion freezes clouds and sway but still follows the clock.

Add a "Windows and outside world" section to `verification/REPORT.md` with the screenshot grid (time × pose), draw calls before/after, program count, perf comparison and any tuned values.

---

## Later: C. Paddy bay

The first opening low enough to see the ground. Design notes only, not part of the A + B work:

- At **z = 0** on the east wall (beside the sculpture, the widest free stretch), a floor-to-ceiling glass bay about 3.5 m wide. No artwork moves.
- `outside.ts` gains the **paddy ground**: one large plane with a canvas-painted texture of flooded and green paddy cells, earth dikes and paths, receding to the tree line. Water cells reflect the sky colour (a cheap tint, not real reflections). Add a few egrets as tiny static sprites.
- The ground needs a far-edge treatment (tree-line band and haze) so the 65 m world edge is never visible.
- Collision: add a wall obstacle so visitors stop at the glass.
- The glass is visible at eye level, so it needs a faint pane and reflections may matter. Decide then.

## Not planned: D. Entrance windows

The windows would be behind the visitor most of the time. They would also compete with the title text and would show ground-level views that need C's paddy ground anyway. Revisit only after C.
