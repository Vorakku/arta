# The White Room

The original walkable portfolio, converted to React and TypeScript with Vite. The palette, typography, nine projects, room geometry, panel layout, normal focus dolly and return move are retained.

## Run locally

Use Node.js 24 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Dependencies are already installed in this workspace. For a reproducible install from the lockfile, use `npm ci`.

## Commands

- `npm run dev` — local development with hot reload.
- `npm run build` — strict TypeScript checks and production output in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run typecheck` — check application and build configuration types.
- `npm run format` / `npm run format:check` — format or verify source formatting.

## Edit your projects

Update `src/gallery/projects.ts`. Each entry provides the title, year, category, URL, description, optional `image`, placeholder generator, and frame dimensions in metres. The original layout has four works on each side wall and one featured work on the back wall, so keep the nine entries to preserve that arrangement. Project URLs still point to the original example.com placeholders.

### Project images

Set `image?: string` to an image URL. For a local file such as `public/works/meridian.jpg`, use `image: "/works/meridian.jpg"`. You can also import an asset from `src/assets/` and assign its imported URL to `image`.

The room crops the image to cover the artwork area inside the existing mat and frame; the project panel uses the source image. Keep `gen` set: it supplies the fallback if the image cannot load. Remote image servers must allow cross-origin image access. Image loading waits up to five seconds before using the fallback. Without `image`, the seeded generator produces the same artwork on every reload and the panel identifies it as a generative placeholder.

### The index

Choose **View the index** on the intro or pause screen to browse all nine titles, years, categories, descriptions and URLs without walking. Titles open the same project panel, with PREV/NEXT navigation. The semantic list renders directly from `PROJECTS` and remains available if WebGL fails; room initialization is not required to browse the collection.

The panel is a named modal dialog: focus enters it, Tab stays inside, and closing returns focus to the initiating index title or canvas. URLs and descriptions can be selected and copied. Desktop entry uses Pointer Lock; Esc pauses, opening a work releases the mouse, and **Click to resume** restores mouse-look after the return move. Browsers that reject Pointer Lock use mouse deltas instead. Reduced-motion preferences disable head bob, intro drift and sculpture movement, and shorten camera transitions.

## Source and verification

- `src/App.tsx` contains the React intro, HTML index, captions, project panel, and controls.
- `src/styles.css` contains the original styles and local index/accessibility additions.
- `src/gallery/createGallery.ts` contains the typed Three.js scene, art generation, movement, and camera choreography. Its cleanup removes event listeners, animation frames, timers, observers, image jobs, and GPU resources on unmount.
- `src/gallery/types.ts` defines the scene and UI types.
- `portfolio.html` is the untouched original reference; the React entry point is `index.html`.

Google Fonts still loads Fraunces and Space Grotesk, as in the original. Placeholder art is deterministic for each project slot. Current Three.js uses different environment and shadow defaults; compatibility settings preserve the original environment position, point-light intensity, and per-material environment strengths. Minor renderer-level shading differences may remain between versions.

Browser acceptance checks and before/after screenshots are in [verification/REPORT.md](verification/REPORT.md). No runtime dependencies were added for these fixes.

Dependencies were checked against the npm registry's latest stable releases on October 7, 2026. The lockfile records the installed versions. To check for future updates, run `npm outdated`; run `npm audit` for dependency security checks.
