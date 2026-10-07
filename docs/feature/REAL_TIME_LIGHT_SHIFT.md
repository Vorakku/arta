# Feature — real-time light shift (Cambodia time)

The gallery's daylight follows the current time in Cambodia. Mornings are cool and bright, afternoons warm and full, and at night the skylight goes dark so the picture lights carry the room. The light changes gradually over the day. It never switches in a single step.

## Goals

- Lighting depends on **Cambodia time (ICT, UTC+7)**, whatever the visitor's own time zone.
- There are three named looks (**morning**, **afternoon**, **night**) plus a golden-hour transition between afternoon and night. The light blends continuously between them.
- **Afternoon is the current look, exactly.** At 13:00–16:30 the room must match today's room, so existing screenshots and the visual direction in [ISSUES.md](../ISSUES.md) stay valid.
- Every work stays readable at all hours. At night the room becomes moodier, not unusable.

## Non-goals

- No new lights, meshes, textures or post-processing passes.
- No astronomical sun calculation. Phnom Penh's sunrise (~05:40–06:15) and sunset (~17:45–18:20) shift by only about 35 minutes over the year, so fixed keyframes are enough.
- No change to the HTML UI (intro overlay, panel, index). The UI keeps its paper palette at all hours.
- No clock or time-of-day label in the HUD. That can be a separate feature later.

## Performance rules (from the completed performance work)

These rules exist because of [PERFORMANCE_DIAGNOSIS.md](../PERFORMANCE_DIAGNOSIS.md) and [CODEX_PERFORMANCE_TASK.md](../CODEX_PERFORMANCE_TASK.md). Do not undo that work.

- **Uniform-only changes.** Change only light `color`/`intensity`, `HemisphereLight` colors/intensity, material `emissive`/`emissiveIntensity`/`envMapIntensity`, and `renderer.toneMappingExposure`. Never add or remove lights, never toggle `light.visible`, and never change anything that alters a shader define. Any of those recompiles every program and causes a hitch.
- **No PMREM regeneration.** The environment map stays as it is. Dim reflections by scaling each material's `envMapIntensity` instead (see Implementation).
- `renderer.info.programs.length` must be the same at 07:00, 14:00, 18:00 and 22:00.
- Keep the 13 spotlights, the shadow update cadence, adaptive resolution and the paused/index render suspension unchanged.

## Time source

```ts
// Cambodia has no daylight saving: ICT is always UTC+7.
const cambodiaMinutes = (ms = Date.now()) =>
  (((ms / 60000 + 7 * 60) % 1440) + 1440) % 1440;
```

This uses the device clock converted to UTC+7. Do not use `Intl` time-zone parsing, which is slower and unnecessary without DST. A wrong device clock gives the wrong light; that is acceptable.

**Debug override** (URL query, read once at startup):

- `?time=HH:MM`: start the clock at that Cambodia time.
- `?speed=N`: run the clock N× faster from the start time (e.g. `?time=04:30&speed=600` plays the whole day in about 2.4 minutes).

Without either parameter, the clock is real Cambodia time. Ignore invalid values.

## Keyframes

The day is a loop of anchor points (Cambodia time). Between two anchors, interpolate linearly with smoothstep easing on the blend factor. Interpolate colors with `THREE.Color.lerpColors` in the working (linear) color space.

| Anchor | Period label | Look |
|---|---|---|
| 00:00 | night | Night |
| 05:00 | night | Night (pre-dawn hold) |
| 06:30 | morning | Morning |
| 11:00 | morning | Morning → afternoon blend starts |
| 13:00 | afternoon | Afternoon = **current look** |
| 16:30 | afternoon | Afternoon |
| 17:45 | afternoon | Golden hour |
| 19:00 | night | Night |
| 24:00 | night | Wraps to 00:00 |

Period labels by Cambodia time: **morning** 05:00–11:59, **afternoon** 12:00–17:59, **night** 18:00–04:59. Expose the label (e.g. as `lighting.period`) for tests; the UI does not show it.

### Parameter table

Treat these values as starting points and tune them by eye against screenshots. **Afternoon must stay exactly at the current values.**

| Parameter | Where | Morning | Afternoon (current) | Golden | Night |
|---|---|---|---|---|---|
| Skylight emissive color | `sky` material (~line 1107) | `#eef2fb` | `#fff4e2` | `#ffd8a6` | `#1c2536` |
| Skylight emissiveIntensity | same | 1.8 | 2.0 | 1.4 | 0.35 |
| Hemisphere sky / ground | `HemisphereLight` (~line 111) | `#f1f4fc` / `#d6d3cc` | `#fff6e6` / `#d9d4cb` | `#ffe3c2` / `#d8cbb9` | `#5f6a86` / `#2a2621` |
| Hemisphere intensity | same | 1.0 | 1.1 | 0.9 | 0.28 |
| Ceiling downlights color | 2 ceiling `SpotLight`s (~line 1125) | `#f5f7ff` | `#fff6e8` | `#ffe2c0` | `#ffd6a0` |
| Ceiling downlights intensity × | same, × base 26 | 0.9 | 1.0 | 0.8 | 0.35 |
| Picture/sculpture spots color | `pictureSpot` lights (~line 723) | `#fff4e6` | `#fff0da` | `#ffe8cc` | `#ffe6c4` |
| Picture/sculpture spots intensity × | multiplies `L.base` | 1.0 | 1.0 | 1.05 | 1.25 |
| Environment reflection × | each material's base `envMapIntensity` | 0.95 | 1.0 | 0.85 | 0.35 |
| Tone-mapping exposure | `renderer.toneMappingExposure` | 1.12 | 1.16 | 1.10 | 1.00 |

## Implementation

1. **New pure module `src/gallery/timeOfDay.ts`** with no Three.js scene access:
   - `cambodiaMinutes(ms)` (above), plus parsing for the `?time` / `?speed` overrides.
   - `lightingAt(minutes)` returns the interpolated parameter set and `period`, as plain numbers and hex values or `THREE.Color`s.
   - Keyframes are data (an array of anchors). Do not write per-period `if` chains.
2. **`createGallery.ts` applies the result.**
   - At build time, store each material's original `envMapIntensity` (e.g. in a `Map<Material, number>` or `material.userData.baseEnv`) when the envMap is bound (~line 1194). Store the sky material, the hemisphere light and the ceiling spotlights in variables.
   - Picture-light lift currently does `L.s.intensity = L.base * (1 + a.lift * 0.55)` (~line 1970). Change it to `L.base * spotScale * (1 + a.lift * 0.55)` so time of day and hover lift combine. Apply the same scale to the sculpture spotlight, which is not in `a.lights`.
   - Recompute lighting **at most once per second** inside `animate()` (time moves slowly, so 1 s steps are invisible), and once immediately when the build finishes. Apply it only when the result changed. Do not allocate new objects each frame; reuse `THREE.Color` instances.
   - Paused and index states skip rendering, so the lighting simply catches up on resume. No extra redraw is needed.
3. **Reduced motion.** The light shift is a slow ambient change, not motion, so it stays on. `?speed` still works under reduced motion, because it exists only for testing.
4. **Night readability floor.** At 22:00, every artwork face and placard must stay legible, and the floor and walls must stay distinguishable for navigation. If the starting values fail this, raise the night hemisphere intensity before dimming the picture lights.

## Verification

Add `verification/light-shift.mjs` using the existing Playwright setup. Pin the time with `?time=`.

- **Screenshots** of room and focus views at `?time=07:00`, `14:00`, `18:00` and `22:00` (1440×900, DPR 1). Save them under `verification/light-shift/`.
- **Afternoon identity.** With seeded textures (the Phase 4 method in `verification/perf-variant.mjs`), the `14:00` room must match the current room. The pixel-diff threshold is the same one Phase 4 used.
- **Ordering.** Mean room luminance is ordered night < golden < morning ≤ afternoon (±noise).
- **Readability.** At `22:00`, the mean luminance over each visible artwork's screen rectangle is ≥ 70% of its `14:00` value.
- **No recompiles.** `renderer.info.programs.length` is equal across all four times, and after `?time=04:30&speed=600` has run through a full day.
- **Smoothness.** Sample `lightingAt` every minute for 24 h. No step changes any intensity by more than 2% of its range, including across midnight.
- **Clock.** Unit-check `cambodiaMinutes`: `Date.UTC(2026,0,1,0,0)` gives 420 (07:00), `Date.UTC(2026,0,1,17,0)` gives 0 (00:00), and the result never depends on the machine's time zone.
- **Performance.** Rerun `verification/perf.mjs` at `?time=14:00` and `?time=22:00`. p95/p99 per state must match `perf-after.json` within run-to-run noise.
- **Regression.** `npm run build`, `npm run format:check`, all 7 suites in `verification/issues-checks.mjs` and `verification/resize-paused-check.mjs` pass. If a suite's result depends on lighting, pin it to `?time=14:00` and say so.

Leave one runnable assert-based check for `timeOfDay.ts` (clock conversion, keyframe wrap and smoothness), e.g. `verification/time-of-day-check.mjs`.

## Deliverables

- `src/gallery/timeOfDay.ts` and the apply logic in `createGallery.ts`.
- `verification/light-shift.mjs`, `verification/time-of-day-check.mjs` and screenshots in `verification/light-shift/`.
- A "Real-time light shift" section in `verification/REPORT.md` with the four-time screenshot table, the final tuned parameter table if any values changed from the starting points above, the program-count result and the perf comparison.
   