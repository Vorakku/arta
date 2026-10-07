# Performance diagnosis — 2026-10-07

Scope: the baseline React/Three.js application, inspected before performance work. The findings below describe that baseline. Status lines record the Phase 0–5 outcome; measurements and experiment decisions are in [verification/REPORT.md](../verification/REPORT.md#performance).

**Fix plan:** [CODEX_PERFORMANCE_TASK.md](CODEX_PERFORMANCE_TASK.md) turns these findings into phased, measurable fixes.

## Verification notes (2026-10-07)

Every count, timing and source location below was re-checked against the source and is accurate. Additional details:

- Issue 1: the 4× pixel count applies only on displays with DPR ≥ 2. MSAA adds cost on top of that.
- Issue 3: the panel background is already 97% opaque, so its 14 px blur is effectively invisible.
- Issue 5: the panel's 0.1 s opacity delay means it becomes visible at about 457–667 ms, not 357–567 ms.
- Issue 7: the transparent hit planes are drawn although `opacity: 0`. `Raycaster` ignores `visible`, so `hit.visible = false` is a safe fix.
- Issue 8: shadows are disabled on touch devices (`shadowMap.enabled = !isTouch`), so this cost applies only on desktop.

## Finding

The app draws a real-time 3D room continuously. Its nine-project content count does not describe its graphics workload. The source contains both substantial GPU work and deliberately slow interaction timing. Those are different problems: the latter can feel laggy even with steady frame delivery.

The strongest candidates for actual frame drops are high canvas resolution multiplied by many physically based lights, followed by backdrop blur and dynamic shadows. Their relative cost on the user's device remains unmeasured. The staged camera/panel timing is a confirmed cause of delayed visible response.

## Evidence and limits

- Inspected the current scene, animation loop, controls, React UI, CSS, installed Three.js shader/shadow implementation, and existing verification artifacts.
- Existing verification/after-metrics.json records 1440×900, DPR 1, Intel UHD 770, 116 draw calls/frame, a 16.668 ms mean animation-frame interval, and 0.792 ms CPU time around renderer.render. These are historical measurements, not a fresh profile.
- The previous shadow change reduced shadow-casting lights from eleven to one. The current source confirms that improvement. Eleven shadow passes are no longer the current issue.
- The existing probe averages only 100 retained frames in one pose. It records no p95/p99, worst frame, GPU execution time, interaction trace, or high-DPR / 120 Hz result. The mean cannot establish consistent pacing under movement or panel transitions.
- CPU time around renderer.render measures submission work; GPU execution is asynchronous. It does not establish that the graphics workload finishes in 0.792 ms.
- The live Browser runtime returned no available browser during the initial diagnosis. The subsequent phased performance task used the installed standalone Playwright setup to obtain fresh production measurements; see the linked Performance report.

## Issues, ranked

### 1. Expensive fixed render resolution, with no adaptive quality — high GPU candidate

**Status:** Fixed — Phase 3 caps resolution at 1.5, disables MSAA at DPR 2+, and adds p90 adaptation with documented limits and device floors. The frame budget is the fast-end startup interval snapped to a standard refresh rate, so a GPU-saturated startup cannot inflate it (review fix, 2026-10-07). Resizing while paused now redraws the room once.

src/gallery/createGallery.ts:68–79 uses antialiasing, full viewport size, and Math.min(devicePixelRatio, 2). At 1440×900, DPR 1 draws 1,296,000 pixels; DPR 2 draws 5,184,000 pixels before considering multisampling or additional passes. The existing benchmark tested only DPR 1. There is no quality adjustment when frame times deteriorate. Touch detection changes shadows but does not reduce pixel ratio or light count.

Implication: a high-DPR laptop or phone can have substantially more work than the verified setup despite displaying the same room. Pixel count scales by four; total frame time does not necessarily scale by four.

Validation: compare identical poses and interactions at DPR/render scales 1, 1.5, and 2; inspect GPU timing and frame-time tails.

### 2. Thirteen real-time spotlights over physically based materials — high GPU candidate

**Status:** Not changed — Both static lighting variants were measured and rejected: they changed the light pools/room contrast without a frame-time gain. All 13 original spotlights remain.

src/gallery/createGallery.ts:881–901 adds eight side-art spotlights and two featured-art spotlights. Lines 1082–1091 add two ceiling spotlights; line 1140 adds one sculpture spotlight. Most surfaces use MeshStandardMaterial, environment maps, and textured materials.

The installed Three.js lights_fragment_begin shader loops over NUM_SPOT_LIGHTS (node_modules/three/src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js:119). Removing castShadow from picture lights removed their shadow passes, but retained their direct-light shader work. Distance/cone limits can reduce contribution without removing the configured loop. This is a substantial workload for a mostly static room.

Validation: temporarily compare reduced light counts and simpler materials at fixed resolution. Consider baked lighting for static surfaces after measurement.

### 3. Blurred HTML overlays over a moving WebGL canvas — GPU/compositing candidate

**Status:** Partially fixed — Panel and caption backdrop filters were removed; caption opacity is 0.97. The intro/pause overlay blur remains to preserve the design, and paused rendering stops after the fade.

src/styles.css:138 applies 12 px backdrop blur to the caption; line 211 applies 14 px to the project panel; line 502 applies 18 px blur plus saturation to the full-screen intro/pause overlay. The canvas continues changing beneath these surfaces. The panel also has a broad shadow and slides over the scene.

Implication: the browser has filtering/compositing work in addition to the WebGL render, especially with the large overlay visible. Cost is browser/GPU dependent; it is not proven to be the dominant bottleneck.

Validation: compare the same interaction with backdrop-filter disabled while retaining backgrounds and layout.

### 4. Rendering continues while paused, reading, and behind the opaque index — ongoing load

**Status:** Fixed — The controller suspends updates/rendering behind the index; paused rendering stops after one settled overlay frame. Resuming resets the clock. Final idle samples and trace show zero room render submissions.

src/gallery/createGallery.ts:1773–1844 schedules and renders every animation frame. Sculpture animation continues in paused and focus-hold states. Opening the HTML index pauses controls, but the index has an opaque full-screen background (src/styles.css:614–620) while the underlying scene keeps rendering. Reduced-motion mode stops several animations but still runs the render loop.

Implication: GPU time and power are spent even when the room is hidden or no camera movement is needed. Sustained load may contribute to thermal throttling on some devices. Browsers normally throttle hidden tabs; the confirmed waste here includes visible tabs with the in-page index/pause UI open.

Validation: measure reading/paused/index states separately; compare demand rendering and suspending room rendering while the index covers it.

### 5. Slow staged interactions — confirmed perceived latency

**Status:** Fixed — The panel begins on the first dolly frame with no opacity delay; dolly, panel-out, return, and next/previous timings are shorter. The original sequence/easing and reduced-motion cuts remain. Tween time uses elapsed time so slow frames do not stretch it.

src/gallery/createGallery.ts:1328 sets opening camera motion to 0.85–1.35 seconds. Lines 1795–1798 wait until 42% of that motion before showing the panel: approximately 357–567 ms after the click, rounded to the next animation frame. src/styles.css:227–233 then animates the panel for 650 ms and delays its opacity transition by 100 ms.

Closing waits 240 ms after an already-shown panel closes (createGallery.ts:1344), then runs a 0.72–1.17 second return move (line 1358). Walking control therefore returns after roughly 0.96–1.41 seconds, and desktop may then require Click to resume. Next/previous camera movement lasts 0.7–1.15 seconds (line 1380); panel content has a 500 ms fade (styles.css:247–258).

Implication: smooth frames can still feel unresponsive because visible confirmation and control restoration take a long time. This is intentional choreography, not evidence of dropped frames.

### 6. Movement and zoom smoothing add response lag — confirmed behavior

**Status:** Fixed — Walking uses coefficient 18, stopping uses 25, and zoom uses 14. Head bob and direct mouse-look behavior remain.

src/gallery/createGallery.ts:1725–1727 smooths velocity exponentially with coefficient 11, giving an approximately 91 ms time constant and approximately 209 ms to reach 90% of a new speed. Releasing a key similarly decays speed rather than stopping immediately. Zoom smoothing at line 1759 has an approximately 111 ms time constant and approximately 256 ms to reach 90% of its target. Head bob adds motion during walking.

Mouse yaw/pitch are applied directly at the next player update (lines 1512–1513 and 1758); there is no additional mouse-look interpolation in that path. Do not attribute mouse-look lag to the velocity smoother without a trace.

### 7. Separate meshes and detailed sculpture increase rendering work — secondary candidate

**Status:** Partially fixed — Hidden hit planes no longer render, and each work’s four frame bars are merged with unchanged material/positions. Separate fixtures remain. The lower-detail sculpture was rejected after timing and close-up comparison; the original 18,720-triangle sculpture is retained.

Each artwork includes four separate frame bars, a back plane, an artwork plane, a placard, and a transparent zero-opacity hit plane (createGallery.ts:823–878). Fixtures also use separate meshes. These are not batched or instanced. Hit meshes remain renderable even though they are invisible to the eye. The historical pose measured 116 draw calls including shadow work; that number alone does not prove a bottleneck.

The small sculpture uses TorusKnotGeometry(0.3, 0.1, 260, 36) at line 1128: 18,720 triangles before shadow rendering, with no level of detail. It uses a metallic physically based material and rotates continuously.

Validation: measure draw submission and geometry time; compare merged/instanced static geometry, non-rendered raycast targets, and a lower-detail sculpture.

### 8. One dynamic 1024×1024 shadow map still updates every render — secondary GPU candidate

**Status:** Fixed — Shadow autoUpdate is disabled; the map is requested every second rendered frame while the sculpture animates, and once after build in reduced motion. Preference changes invalidate it once.

createGallery.ts:1140 enables the sculpture light's shadow map. The installed WebGLShadowMap defaults autoUpdate to true (node_modules/three/src/renderers/webgl/WebGLShadowMap.js:86), and the app does not override it. The rotating sculpture makes some updates useful, but the loop also runs when the camera is paused or the index covers the room. Static frames/benches are marked as shadow casters too, subject to shadow-camera culling.

Validation: compare shadows off, a smaller map, and reduced update frequency. Do not describe the app as currently having eleven shadow-casting lights.

### 9. Startup performs synchronous artwork work and has no explicit shader warmup — startup candidate

**Status:** Partially fixed — Shader compilation is awaited before entry; partly built materials do not render. Art generation yields between works; JPEG thumbnails are lazy and cached, including font repaint invalidation. PMREM, individual canvas-generation tasks, first texture uploads, and external font loading remain.

makeArtCanvas uses 520 pixels per metre (createGallery.ts:509 onward). build creates nine artwork canvases/textures, placards, floor/plaster textures, and JPEG data URLs. Drawing and thumbURL's toDataURL encoding run synchronously on the main thread; the build is not split into small tasks. Some art uses repeated blurred canvas drawing. Fonts gate the build, with a three-second timeout (lines 1875–1898). The initial environment map is generated synchronously through PMREM (lines 92–102).

There is no explicit renderer.compile/compileAsync warmup. Shader compilation and texture uploads may add first-render hitches; this remains a candidate, not a measured event. main.tsx also enables React StrictMode, which repeats effect setup/cleanup in development and can amplify initialization cost. That repeat does not apply to a production build.

Implication: these explain loading/first-use delays, rather than ongoing low FPS after the room is warm.

### 10. Smaller main-thread costs and limited measurement — lower priority

**Status:** Partially fixed — Production profiling now covers 360 intervals per state at DPR 1/2, percentiles/max/threshold counts, draw calls, triangles, complete click timing, and idle traces. The projection guard was rejected as below measurement noise; the small raycast, React caption-update, and panel-layout costs remain.

updateHover raycasts against nine targets every playing desktop frame (createGallery.ts:1199–1212). React updates are deduplicated for identical artwork/caption text, but the distance rounded to 0.1 metre changes while walking; each change updates App and its child tree (lines 1184–1197; App.tsx:318 onward). This is intermittent, not an unconditional React rerender every frame.

Player and focus-hold paths update the projection matrix even when FOV is unchanged (createGallery.ts:1393, 1760). Selecting a project uses flushSync, followed by panel size reads; ProjectPanel also reads offsetWidth to restart its fade (App.tsx:82 onward). These are possible interaction-bound layout costs, but no trace establishes them as major causes. The content tree and raycast target count are small; prioritize graphics and timing issues above these.

The previous acceptance criterion only covered a mean near 60 FPS at DPR 1. Future validation needs frame-time percentiles, dropped-frame counts, startup/interaction traces, and the intended device/refresh rate. A 60 FPS frame budget is approximately 16.67 ms; 120 FPS is approximately 8.33 ms, including browser work. requestAnimationFrame normally follows display cadence, so a 60 Hz display does not establish 120 Hz capability.

## Recommended diagnostic order

1. Capture a production-build trace on the affected device while turning, walking, opening a work, and using the index. Record viewport, DPR, display refresh rate, GPU, p95/p99/max intervals, and dropped frames.
2. Compare render resolution, light count, backdrop blur, and shadows one at a time. Keep camera pose and interaction sequence consistent.
3. Measure click-to-feedback and time until walking resumes separately from FPS. Shortening choreography can improve perceived response independently of graphics changes.
4. Then evaluate mesh batching, sculpture detail, startup work, and React/layout costs if traces show meaningful contributions.

## Supporting references

- [Three.js: shadows](https://threejs.org/manual/pages/shadows.html) explains additional rendering for shadow maps.
- [Three.js: optimizing many objects](https://threejs.org/manual/pages/optimize-lots-of-objects.html) explains mesh draw-request and scene-graph costs.
- [MDN: WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) covers back-buffer sizing and GPU-aware optimization.
- [MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) describes display cadence and background-tab behavior.
