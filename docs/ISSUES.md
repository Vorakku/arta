# The White Room — known issues

Review of the React port (`src/`). `portfolio.html` is the original reference and must stay untouched.
Issues are ordered by priority. Line numbers are approximate as of 2026-10-07.

All nine issues are fixed. Acceptance checks, screenshot pairs and measurements are recorded in [verification/REPORT.md](../verification/REPORT.md).

The visual direction (paper/ink/rust palette, Fraunces + Space Grotesk, the focus camera choreography) is good and is **not** in scope for change. Keep the look; fix the problems below.

---

## P1 — Portfolio fundamentals

### 1. No way to see the work without walking the room

**Fixed** — The semantic PROJECTS index is present from first paint and opens the existing panel with keyboard navigation.

**Where:** `src/App.tsx` (`Intro`), `src/gallery/createGallery.ts`
**Problem:** Every project is behind WASD, mouse-look, a centre reticle and a 3.5 m reach rule. Someone reviewing a portfolio gets about 20 seconds; right now they see zero projects in that time. Screen-reader users have no access at all: the projects exist only on a canvas.
**Fix:**
- Render a plain-HTML project index (title, year, tag, short description, link) from `PROJECTS`. It must be in the DOM from first paint and must not depend on WebGL.
- Add a secondary action on the intro overlay, e.g. "View the index", next to "Enter the gallery".
- From the index, choosing a project opens the existing project panel for that work (prev/next still work). If the 3D room is ready, it's fine to fly the camera to that work. If the room isn't ready, the panel alone is enough.
- Keyboard-navigable, with semantic list markup.

**Done when:** a visitor can reach every project's title, description and URL with no mouse movement and no WebGL.

### 2. A failed load leaves a dead page

**Fixed** — WebGL errors automatically reveal the complete index with calm copy and no dead entry button.

**Where:** `src/App.tsx` (the `try/catch` around `createGallery`, and the `#enter` button)
**Problem:** If WebGL is unavailable, `createGallery` throws. The button then reads "THE ROOM FAILED TO LOAD — CHECK CONSOLE" and is enabled, but clicking it does nothing (`controller.current` is null). The visitor sees no projects, and the copy tells a visitor to open the dev console.
**Fix:** on error, replace the dead button with visitor-facing copy (e.g. "This browser can't show the 3D room, so here's the index") and show the index from issue 1. Never show "check console" to visitors; keep `console.error` for developers.

**Done when:** with WebGL forced off (e.g. Chrome `--disable-gpu --disable-software-rasterizer`, or by stubbing `getContext` to return null), the page shows the index and every project is reachable.

### 3. Projects can't show real images; placeholder art changes on every load

**Fixed** — Optional image sources cover-fit the existing frames, fall back on load failure, and seeded placeholders survive reloads unchanged.

**Where:** `src/gallery/projects.ts` (`Project` type), `src/gallery/createGallery.ts` (`makeArtCanvas` ~L498–506, thumbnail creation), `src/App.tsx` (`#pCap`)
**Problem:**
- `Project` has no image field, so nobody can hang a screenshot of their real work. For a portfolio, the image is the point.
- The seed at ~L506 adds `Math.random() * 1e9`, so every painting changes on each reload.
- The panel caption always says "generative placeholder".

**Fix:**
- Add an optional `image?: string` (URL or imported asset) to `Project`. When it's present, use the image as the artwork texture, cover-fitted inside the existing mat/frame logic, and use it as the panel thumbnail. When it's absent, fall back to the generator.
- Load images through `THREE.TextureLoader` or by drawing into the existing canvas. If an image fails to load, fall back to the generator rather than leaving a blank frame.
- Make the generator seed deterministic: drop the `Math.random()` term.
- Panel caption: only append "generative placeholder" when no image is set.
- Update `README.md` and the intro footer copy to mention the image field.

**Done when:** setting `image` on one project shows that image on the wall and in the panel, two reloads produce identical placeholder art, and a broken image URL falls back cleanly.

---

## P2 — Interaction and copy

### 4. The controls are explained about eight times, and the copy reads like dev notes

**Fixed** — The lede is brief; duplicate notes, footer, toasts, placard instructions and wall controls are removed.

**Where:** `src/App.tsx` (`.lede`, `.note`, `.foot`, `#hint`), `createGallery.ts` (`startPlay` toast ~L1601, `hintEdgeOnce` toast, placard text ~L573, vinyl wall text)
**Problem:**
- The same controls are explained in the intro lede, the controls row, the note, the footer, the start toast, the edge toast, the corner hint, every placard and the wall vinyl.
- The lede describes the camera mechanics ("the camera steps back and draws up alongside it, the work takes the left of the frame…").
- The note and the start toast ("Nothing automatic… nothing held, nothing automatic") read like replies to a bug report.

**Fix:**
- Lede: one or two sentences about the *work*, not the camera.
- Keep the controls row as the single source of control instructions.
- Delete `.note` and the start toast.
- Footer: a short, developer-facing hint at most. Better: move it to the README and remove it from the UI.
- Placard: drop "STEP CLOSER AND CLICK TO VIEW", or make it device-aware (see issue 9).
- Corner hint: include WASD, or reduce it to "Esc — pause".

**Done when:** each instruction appears once in the UI and no copy describes implementation.

### 5. Mouse-look doesn't use Pointer Lock, so the cursor hits the screen edge

**Fixed** — Pointer Lock enables continuous turning, unlock pauses, panel return offers a gesture to resume, and rejected/unsupported requests use delta input.

**Where:** `createGallery.ts` mouse input (~L1396–1460: `SENS`, `lastM`, `hintEdgeOnce`, `mousemove`/`mouseout`/`blur` handlers), `startPlay`, `pauseGame`
**Problem:** Turning is computed from `clientX` deltas of a hidden cursor. When the cursor reaches the screen edge, turning stops, and a toast explains the workaround. Pointer Lock is the browser feature built for exactly this.
**Fix:**
- In `startPlay` (desktop only), call `canvas.requestPointerLock()`. Read `e.movementX` / `e.movementY` while `document.pointerLockElement === canvas`.
- On `pointerlockchange` to unlocked while playing, call `pauseGame()`. The browser already releases the lock on Esc, so this replaces the manual Esc→pause path for desktop.
- Delete `lastM`, `hintEdgeOnce`, the edge toast and the `mouseout`/`blur` bookkeeping that only existed for the edge workaround.
- Clicks while locked: use the centre reticle as now.
- Entering focus mode must exit pointer lock (`document.exitPointerLock()`) so the cursor can use the panel. Returning to the room re-requests it. The request must come from a user gesture, so either request it on the click that closes the panel or show "click to resume".
- If `requestPointerLock` is rejected or unsupported, fall back to the current delta method rather than breaking.
- Keep Q/E turning.

**Done when:** you can turn 360° continuously with the mouse, Esc pauses, the panel is usable with the cursor, and no edge toast exists.

### 6. Bug: Enter in focus mode opens the project URL on top of the focused control's own action

**Fixed** — The global Enter shortcut is removed; panel controls use one native action each.

**Where:** `createGallery.ts` keydown handler (~L1357–1362)
**Problem:** in focus mode, Enter always calls `window.open(url)`. The browser's native Enter behaviour on the focused element still runs as well:
- Focus on **VISIT PROJECT** + Enter → two tabs open.
- Focus on **PREV/NEXT** + Enter → the URL opens *and* the panel steps.
- Focus on **close (×)** + Enter → the URL opens *and* the panel closes.

**Fix:** only treat Enter as "visit" when the event target is not an interactive element (`e.target` is not inside `#panel` and is not a button or link). Simplest is to remove the global Enter shortcut, because the VISIT link is already keyboard-reachable.

**Done when:** Enter on each panel control does exactly one thing.

### 7. Eleven shadow-casting spotlights: heavy on laptops and integrated GPUs

**Fixed** — Only the sculpture spotlight casts shadows; Intel UHD 770 measured about 16.67 ms/frame at 1440×900 versus 16.68 ms before.

**Where:** `createGallery.ts` `pictureSpot` (~L681–700), plus every call site (8 side works, 2 featured, 1 sculpture)
**Problem:** each `castShadow` spotlight re-renders the scene into its shadow map every frame, so that's 11 extra passes per frame. Nearly everything in the scene is static.
**Fix (pick the smallest that holds 60 fps):**
- Only the sculpture spot casts shadows. Picture spots get `castShadow = false`; frames sit flush, so their shadows barely read.
- Or set `renderer.shadowMap.autoUpdate = false` and `needsUpdate = true` after build, and also while a frame is lifting (`a.lift` changing) or the sculpture is rotating.

Also consider capping `setPixelRatio` lower on high-DPR laptops if frame time is still high.

**Done when:** the room holds ~60 fps on an integrated GPU at 1440×900 with no visible change in look from normal viewing distance. Measure before and after with the Performance panel or `renderer.info`.

---

## P3 — Accessibility

### 8. Accessibility basics

**Fixed** — Zoom is enabled; the named modal manages/traps/restores focus, text is selectable, and reduced motion removes drift, bob and sculpture movement.

**Where:** `index.html`, `src/App.tsx`, `src/styles.css`, `createGallery.ts`
- **Zoom blocked:** `maximum-scale=1, user-scalable=no` in the viewport meta. Remove both. If pinch-zoom fights the touch controls, `touch-action: none` is already on the canvas, which is enough.
- **Caption announcements:** `aria-live="polite"` on `#caption` makes screen readers announce something every time you aim at a work. Remove it.
- **Panel semantics:** `#panel` has `aria-live="polite"` on the whole aside, which announces the entire panel on every change. Make it `role="dialog"` with `aria-modal="true"` and `aria-labelledby="pTitle"`. On open, move focus to the close button or the title. On close, return focus to whatever triggered it (the canvas, or an index item from issue 1). Trap Tab inside while it's open.
- **No text selection:** `user-select: none` on `html, body` (styles.css ~L20) blocks copying a project URL or description. Keep it on the canvas and HUD; set `user-select: text` on `#panel` and on the index.
- **Reduced motion:** nothing honours `prefers-reduced-motion`. When it's set:
  - Head bob = 0.
  - The intro uses a static camera instead of the drifting `cinematic()` pan.
  - The focus dolly and return become short crossfades or near-instant cuts.
  - The sculpture stays still.
  - The CSS transitions on the panel and toast become fades only.

**Done when:** pinch-zoom works, the panel is announced once as a dialog with focus managed, the URL/description can be copied, and reduced-motion mode has no camera drift or bob.

---

## P4 — Minor

### 9. Small fixes

**Fixed** — Focus targets update on viewport/panel resize without accumulating dolly distance; click-only placard copy and ineffective fog are removed.

- **Resize or rotate during focus doesn't re-frame.** The `resize` handler (~L1754) only updates aspect and size. If `state === "focus"`, recompute `focusTargets(focus.rec)` and snap `focus.to` to the new pose. This matters on phone rotation and when the bottom sheet height changes.
- **Placards say "click" on touch devices.** Make the placard texture text device-aware ("tap" on `isTouch`), or remove the line per issue 4.
- **Corner hint omits WASD.** Covered by issue 4.
- **Fog is a no-op.** `new THREE.Fog(0xf2efe8, 24, 60)` starts at the room's full length. Either delete it or bring it in (e.g. 14–40) if a subtle depth falloff is wanted.
