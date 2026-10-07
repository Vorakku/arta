# Codex task — performance fixes

Fix the rendering cost and the input/interaction lag recorded in [PERFORMANCE_DIAGNOSIS.md](PERFORMANCE_DIAGNOSIS.md). Every claim in that file was checked against the source on 2026-10-07 and is accurate. This file states what to change, in what order, and how to show that it worked.

## Constraints

- `portfolio.html` is the original reference. Do not modify it.
- No new runtime dependencies. `three/addons/*` (e.g. `BufferGeometryUtils`) is already installed and may be used.
- Keep the visual direction from [ISSUES.md](ISSUES.md): palette, fonts, the pools of light on each work, the sculpture, and the focus choreography *sequence* (dolly → hold → panel out → return). Timings may get shorter (Phase 2); the sequence and easing stay.
- Keep the reduced-motion behaviour, keyboard/focus behaviour, the WebGL-off fallback and the index unchanged.
- Line numbers below refer to the current `src/gallery/createGallery.ts` and `src/styles.css`. Find the code, not the line, if they drift.
- Do one phase at a time. Measure after each phase and record the numbers before starting the next.

## Phase 0 — Measure first

`verification/probe.mjs` averages 100 frames at DPR 1 in a single pose, so it cannot detect stutter. Extend it (or add `verification/perf.mjs` alongside it using the existing Playwright setup) to record, against a **production build** (`npm run build && npm run preview`):

- Frame interval p50 / p95 / p99 / max and the count of frames over 16.7 ms and 33.4 ms, across ≥ 300 frames.
- Five states: intro, walking (hold W for 2 s while turning), focus hold, paused, index open.
- DPR 1 and DPR 2 (Playwright `deviceScaleFactor`), 1440×900.
- `renderer.info.render.calls` and `.triangles` per state.
- Click → `#panel.on` latency, and close click → the frame where `state` returns to `"playing"`.

Save the results as `verification/perf-before.json`. Every later phase writes `verification/perf-after-phaseN.json` with the same shape.

## Phase 1 — Stop wasted frames (biggest, safest win)

1. **Do not render behind the index.** Add a `suspend(hidden: boolean)` method to `GalleryController` (`src/gallery/types.ts`) and call it from `App.tsx` whenever `indexOpen` changes. While suspended, `animate()` keeps its RAF loop but skips the update and `renderer.render`. On resume, reset `previousTime` so the first `dt` is not one huge step.
2. **Do not render while paused.** Once the pause overlay is fully shown, render one frame and then stop until the state changes. Intro stays animated, because the slow cinematic drift behind the overlay is part of the design.
3. **Remove invisible hit planes from the render.** Set `hit.visible = false` on the transparent `opacity: 0` hit meshes (~line 867). `Raycaster` does not check `visible` (verified in `node_modules/three/src/core/Raycaster.js:244`), so hovering and clicking still work. This removes 9 draw calls.

Done when: the paused and index states show ~0 GPU frame work in the trace, hover/click still open every work, and all existing verification suites pass.

## Phase 2 — Make interactions feel immediate

Current timings (ms) and targets:

| Moment | Now | Target | Where |
|---|---|---|---|
| Click → panel starts moving | 357–567 | ≤ 120 | Panel trigger at `pr >= 0.42` (~line 1796) → show at `pr >= 0.1` or immediately |
| Panel opacity delay | 100 | 0 | `#panel.on` transition, `styles.css` ~line 231 |
| Panel slide | 650 | ~450 | `#panel` / `#panel.on` transform duration |
| Dolly | 850–1350 | ~600–950 | `dur` in `enterFocus` (~line 1328) |
| Close → camera starts returning | 240 | ~120 | `focus.wait` in `exitFocus` (~line 1344) |
| Return move | 720–1170 | ~500–800 | `dur` in `startReturn` (~line 1358) |
| Next/prev move | 700–1150 | ~500–800 | `dur` in `stepFocus` (~line 1380) |
| Walk to 90% speed | ~209 | ~130 | `exp(-11 * dt)` → `exp(-18 * dt)` (~line 1725) |
| Stop after key release | same smoothing | faster | Use a stronger coefficient (~25) when the target velocity is zero |
| Zoom to 90% | ~256 | ~165 | `exp(-9 * dt)` → `exp(-14 * dt)` (~line 1759) |

Keep `easeIO` and the reduced-motion `0.01` durations. Head bob stays.

Done when: measured click → panel ≤ 150 ms, close → walking ≤ 950 ms, and the focus pose still frames the work beside the panel on desktop, on mobile and after a resize.

## Phase 3 — Cap GPU cost per frame

1. **Resolution.** Change the cap from `Math.min(devicePixelRatio, 2)` (~line 73) to `1.5`. Create the renderer with `antialias: devicePixelRatio < 2`. At DPR ≥ 2, MSAA costs the most and helps the least. `antialias` is fixed when the context is created, so decide it once.
2. **Adaptive resolution.** Track a rolling window of frame intervals (about 60 frames). If p90 stays above 1.25 × the display's frame budget for 2 s, lower the pixel ratio by 0.25 (floor 1.0; floor 0.75 when `isTouch`). If p90 stays below 0.8 × the budget for 5 s, raise it by 0.25 up to the cap. Allow at most one change every 2 s. Estimate the budget from the median interval over the first second rather than assuming 60 Hz. Add a `ponytail:` comment that names the heuristic and its limits.
3. **Backdrop blur.** Remove `backdrop-filter` from `#panel` (`styles.css` ~line 211; its background is already 97% opaque, so the blur is invisible) and from `#caption` (~line 138; raise its background alpha to ~0.97). Keep the `#overlay` blur. Once Phase 1 has stopped rendering behind the paused overlay, the blur only costs anything during intro.
4. **Shadow map.** Set `renderer.shadowMap.autoUpdate = false`. Set `renderer.shadowMap.needsUpdate = true` on every second rendered frame while the sculpture animates, and once after build when reduced motion is on. The sculpture turns 0.18 rad/s, so a 30 Hz shadow is not visible.

Done when: the DPR 2 walking p95 is within the frame budget on the test machine, or clearly better than `perf-before.json` with the reason recorded, and screenshots match the current `after-room.png` / `after-focus.png` apart from blur-edge differences.

## Phase 4 — Lighting and geometry (measure, then decide)

These items change how the scene is built. Measure each one on its own and keep only what shows a measurable gain without a visible change.

1. **Lights (13 spotlights).** Try these variants at a fixed DPR and pose: (A) as now; (B) replace the featured work's two spotlights (~line 896) with one wider spotlight; (C) remove the two ceiling downlights (~line 1082) and add their contribution to the `HemisphereLight` / skylight emissive. Keep a variant only if before/after screenshots look the same at a normal viewing size. Never toggle lights at runtime: changing the light count recompiles every shader and causes a hitch.
2. **Frame bars.** Merge each artwork's four `BoxGeometry` bars (~lines 823–832) into one mesh with `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`. This cuts 27 draw calls. Keep the materials and positions the same.
3. **Sculpture.** Reduce `TorusKnotGeometry(0.3, 0.1, 260, 36)` (~line 1128) to about `(…, 160, 24)` (7,680 triangles, from 18,720). Check its silhouette in a close-up screenshot.
4. **Projection matrix.** Call `camera.updateProjectionMatrix()` only when the FOV has actually changed (`holdView` ~line 1393, `updatePlayer` ~line 1760).

## Phase 5 — Startup hitches

1. After `build()` finishes adding objects and before `ready = true`, `await renderer.compileAsync(scene, camera)`. This compiles the shaders before the first visible frame.
2. Build thumbnails only when they are needed. `place()` currently calls `thumbURL(artCanvas)` (a synchronous JPEG encode) for every work during build (~line 841). Store the canvas instead, encode it the first time `controller.thumbnail(index)` or `fillPanel` asks for it, and cache the result. The thumbnails must stay deterministic: the image suite compares SHA-256 hashes across reloads.
3. Between artworks in `build()`, yield to the main thread (`await new Promise(r => setTimeout(r))`) so the intro overlay keeps animating while the room is generated.

## Final acceptance

- `npm run build` and `npm run format:check` pass.
- All existing suites in `verification/` (desktop, index, WebGL-off, Pointer Lock fallback, mobile, reduced motion, images) still pass.
- `verification/perf-after.json` compared with `perf-before.json`: p95/p99/max per state at DPR 1 and 2, draw calls, triangles, interaction latencies.
- Add a "Performance" section to `verification/REPORT.md` with that table, the Phase 4 variants you kept or rejected and why, and before/after screenshots of the room and focus views.
- Add a `**Status:**` line under each numbered issue in `PERFORMANCE_DIAGNOSIS.md`: Fixed, Partially fixed (state what remains), or Not changed (state why).
