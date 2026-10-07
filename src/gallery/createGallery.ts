import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PROJECTS } from "./projects";
import { createOutside } from "./outside";
import {
  panelWithOpenings,
  addOpeningDetails,
  CLERESTORY_Z,
  SKYLIGHT,
} from "./openings";
import { createLightingClock, lightingAt, sameLighting } from "./timeOfDay";
import type { Project } from "./projects";
import type {
  Artwork,
  FocusMove,
  GalleryController,
  GalleryElements,
  GalleryMode,
  GalleryUI,
  Pose,
} from "./types";

type Random = () => number;

// The original scene and camera choreography, isolated to a mount/unmount lifecycle.
export function createGallery(
  elements: GalleryElements,
  onChange: (patch: Partial<GalleryUI>) => void,
): GalleryController {
  let disposed = false;
  let animationFrame = 0;
  const removeListeners: (() => void)[] = [];
  function listen<K extends keyof (WindowEventMap & DocumentEventMap)>(
    target: Window | Document,
    type: K,
    listener: (event: (WindowEventMap & DocumentEventMap)[K]) => void,
    options?: AddEventListenerOptions,
  ) {
    const handler = listener as EventListener;
    target.addEventListener(type, handler, options);
    removeListeners.push(() =>
      target.removeEventListener(type, handler, options),
    );
  }
  const ROOM = { w: 9, d: 24, h: 4.4 };
  const ART_Y = 1.62;
  const EYE = 1.68;
  const REACH = 3.5; // how close you must stand to open a work (metres)
  const FOCUS_FOV = 54; // lens used while a project page is open
  const DOLLY_BACK = 0.55; // min extra distance the camera puts between you and the work (m)
  const TURN_SPEED = 2.0; // rad/s while Q/E or ←/→ held (keyboard turning)
  const MOBILE_BP = 760; // below this width the panel becomes a bottom sheet

  const { canvas, panel: panelEl, stick, stickNub } = elements;
  const isTouch = matchMedia("(pointer:coarse)").matches;
  onChange({
    isTouch,
    mode: "intro",
    ready: false,
    error: false,
    focused: false,
    panelOpen: false,
    selected: null,
    hover: null,
    toast: "",
    needsResume: false,
  });

  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  const motionChanged = () => {
    reducedMotion = motionQuery.matches;
    renderer.shadowMap.needsUpdate = true;
  };

  /* ── renderer / scene / camera ──────────────────────────────────── */
  const resolutionCap = Math.min(devicePixelRatio, 1.5);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: devicePixelRatio < 2,
  });
  motionQuery.addEventListener("change", motionChanged);
  removeListeners.push(() =>
    motionQuery.removeEventListener("change", motionChanged),
  );
  renderer.setPixelRatio(resolutionCap);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !isTouch;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2efe8);

  const camera = new THREE.PerspectiveCamera(
    62,
    innerWidth / innerHeight,
    0.1,
    80,
  );
  camera.rotation.order = "YXZ";

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentRoom = new RoomEnvironment();
  // Match the original r160 environment: it was unshifted and used a 5-cd point light.
  // Current RoomEnvironment defaults would substantially brighten this gallery.
  environmentRoom.position.y = 0;
  environmentRoom.traverse((object) => {
    if (object instanceof THREE.PointLight) object.intensity = 5;
  });
  const environmentTarget = pmrem.fromScene(environmentRoom, 0.04);
  scene.environment = environmentTarget.texture;
  environmentRoom.dispose();
  pmrem.dispose();
  const hemisphere = new THREE.HemisphereLight(0xfff6e6, 0xd9d4cb, 1.1);
  scene.add(hemisphere);

  const lightingClock = createLightingClock(location.search, Date.now());
  let lighting = lightingAt(840);
  let nextLighting = lightingAt(840);
  let lightingApplied = false;
  let lastLightingUpdate = -Infinity;
  let spotScale = 1;
  let outside: ReturnType<typeof createOutside> | undefined;
  let lightingMinutes = 840;
  let outsideElapsed = 0;
  const ceilingSpots: THREE.SpotLight[] = [];
  const pictureSpots: { light: THREE.SpotLight; base: number }[] = [];
  const baseEnvironment = new Map<THREE.MeshStandardMaterial, number>();

  function updateLighting(now: number) {
    if (now - lastLightingUpdate < 1000) return;
    lastLightingUpdate = now;
    lightingMinutes = lightingClock(Date.now());
    lightingAt(lightingMinutes, nextLighting);
    if (lightingApplied && sameLighting(lighting, nextLighting)) {
      lighting.period = nextLighting.period;
      return;
    }
    const previous = lighting;
    lighting = nextLighting;
    nextLighting = previous;
    lightingApplied = true;
    hemisphere.color.copy(lighting.hemisphereSky);
    hemisphere.groundColor.copy(lighting.hemisphereGround);
    hemisphere.intensity = lighting.hemisphereIntensity;
    for (const light of ceilingSpots) {
      light.color.copy(lighting.ceilingColor);
      light.intensity = 26 * lighting.ceilingScale;
    }
    spotScale = lighting.spotScale;
    for (const { light, base } of pictureSpots) {
      light.color.copy(lighting.spotColor);
      light.intensity = base * spotScale;
    }
    for (const [material, base] of baseEnvironment)
      material.envMapIntensity = base * lighting.envScale;
    renderer.toneMappingExposure = lighting.exposure;
  }

  /* ── tiny seeded RNG + canvas helpers ───────────────────────────── */
  function mulberry(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = <T>(R: Random, a: readonly T[]) => a[(R() * a.length) | 0];
  const range = (R: Random, a: number, b: number) => a + R() * (b - a);
  const INK = "#191712";
  const ACCENTS = ["#b23a19", "#c8451f", "#1f4d5c", "#31546a", "#a07c2f"];

  const grain = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const g = c.getContext("2d")!;
    const noise = mulberry(0xdecaf);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(20,16,8,${noise() * 0.05})`;
      g.fillRect(noise() * 160, noise() * 160, 1, 1);
    }
    return c;
  })();

  function paper(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    tone = "#f6f2e8",
  ) {
    ctx.fillStyle = tone;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ctx.createPattern(grain, "repeat")!;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function softRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    blur: number,
  ) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    const off = w + h;
    ctx.shadowOffsetX = off;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 0.62;
    for (let i = 0; i < 3; i++) ctx.fillRect(x - off, y, w, h);
    ctx.restore();
  }
  function spaced(
    ctx: CanvasRenderingContext2D,
    txt: string,
    x: number,
    y: number,
    ls: number,
  ) {
    const chars = [...txt],
      ws = chars.map((ch) => ctx.measureText(ch).width);
    const total = ws.reduce((a, b) => a + b, 0) + ls * (chars.length - 1);
    let cx = x - total / 2;
    const prev = ctx.textAlign;
    ctx.textAlign = "left";
    chars.forEach((ch, i) => {
      ctx.fillText(ch, cx, y);
      cx += ws[i] + ls;
    });
    ctx.textAlign = prev;
  }

  /* ── generative placeholder works ───────────────────────────────── */
  function genRothko(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#efe9db");
    const pal = [
      pick(R, ["#7d2d1c", "#9c3b1e", "#5b2a1c"]),
      pick(R, ["#c8a24a", "#b98c3a", "#cbb98a", "#8f6a2c"]),
      pick(R, ["#23324e", "#3d4a5c", "#2e3b33", "#4a3a2e"]),
    ];
    const m = w * 0.11,
      iw = w - 2 * m,
      gap = h * 0.035;
    const fr = [range(R, 0.16, 0.24), range(R, 0.34, 0.46), range(R, 0.2, 0.3)];
    const scale = (h - 2 * m - 2 * gap) / fr.reduce((a, b) => a + b, 0);
    let y = m;
    fr.forEach((f, i) => {
      const bh = f * scale;
      softRect(ctx, m, y, iw, bh, pal[i], w * 0.045);
      y += bh + gap;
    });
  }
  function genFeature(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#ece5d6");
    softRect(ctx, w * 0.13, h * 0.1, w * 0.74, h * 0.24, "#221f1a", w * 0.03);
    softRect(ctx, w * 0.1, h * 0.4, w * 0.8, h * 0.3, "#8e2c18", w * 0.028);
    softRect(ctx, w * 0.13, h * 0.74, w * 0.74, h * 0.16, "#d9c9a4", w * 0.03);
    ctx.fillStyle = "#efe7d3";
    ctx.fillRect(w * 0.13, h * 0.715, w * 0.74, Math.max(2, h * 0.004));
  }
  function genFlow(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#f4f0e5");
    const s1 = R() * 10,
      s2 = R() * 10,
      s3 = R() * 10,
      acc = pick(R, ACCENTS);
    ctx.lineCap = "round";
    for (let i = 0; i < 150; i++) {
      let x = range(R, 0, w),
        y = range(R, 0, h);
      ctx.strokeStyle = R() < 0.08 ? acc : INK;
      ctx.globalAlpha = range(R, 0.35, 0.85);
      ctx.lineWidth = range(R, 0.8, 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 90; s++) {
        const a =
          Math.sin(x * 0.004 + s1) +
          Math.cos(y * 0.004 + s2) +
          Math.sin((x + y) * 0.0022 + s3);
        const ang = a * 1.9;
        x += Math.cos(ang) * 3.2;
        y += Math.sin(ang) * 3.2;
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) break;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function genBauhaus(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#f2eee2");
    const cols = 2 + ((R() * 3) | 0),
      rows = cols + 1 + ((R() * 2) | 0);
    const m = w * 0.07,
      cw = (w - 2 * m) / cols,
      ch = (h - 2 * m) / rows;
    const pal = ["#1c1a16", "#b23a19", "#1f4d5c", "#c8952f"];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = m + c * cw,
          y = m + r * ch,
          s = Math.min(cw, ch) * 0.86;
        const roll = R();
        const col =
          R() < 0.55
            ? pal[0]
            : R() < 0.5
              ? pal[1]
              : R() < 0.5
                ? pal[2]
                : pal[3];
        ctx.save();
        ctx.translate(x + cw / 2, y + ch / 2);
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        if (roll < 0.18) {
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.42, 0, 7);
          ctx.fill();
        } else if (roll < 0.36) {
          ctx.rotate(R() * Math.PI * 2);
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.44, 0, Math.PI);
          ctx.closePath();
          ctx.fill();
        } else if (roll < 0.52) {
          ctx.rotate(R() * Math.PI * 2);
          ctx.lineWidth = s * 0.09;
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.36, 0, Math.PI / 2);
          ctx.stroke();
        } else if (roll < 0.68) {
          ctx.rotate(R() * Math.PI * 2);
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.42);
          ctx.lineTo(s * 0.4, s * 0.3);
          ctx.lineTo(-s * 0.4, s * 0.3);
          ctx.closePath();
          ctx.fill();
        } else if (roll < 0.82) {
          ctx.rotate(R() < 0.5 ? 0 : Math.PI / 2);
          ctx.fillRect(-s * 0.44, -s * 0.09, s * 0.88, s * 0.18);
        } else {
          ctx.rotate(R() < 0.5 ? 0 : Math.PI / 2);
          ctx.lineWidth = s * 0.045;
          for (let k = -2; k <= 2; k++) {
            ctx.beginPath();
            ctx.moveTo(-s * 0.42, k * s * 0.16);
            ctx.lineTo(s * 0.42, k * s * 0.16);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
  }
  function genHalftone(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#f3efe4");
    const n = Math.max(22, (Math.sqrt(w * h) / 16) | 0),
      step = w / n;
    const ph = R() * Math.PI * 2,
      ph2 = R() * Math.PI * 2;
    ctx.fillStyle = INK;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < Math.ceil(h / step); j++) {
        const f = 0.5 + 0.5 * Math.sin(i * 0.5 + ph) * Math.cos(j * 0.42 + ph2);
        const r = step * 0.46 * Math.pow(f, 1.25);
        if (r > 0.4) {
          ctx.beginPath();
          ctx.arc((i + 0.5) * step, (j + 0.5) * step, r, 0, 7);
          ctx.fill();
        }
      }
  }
  function genMondrian(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    ctx.fillStyle = "#f4f1e6";
    ctx.fillRect(0, 0, w, h);
    const m = w * 0.06,
      lw = Math.max(4, w * 0.018),
      cols = ["#cd3a1c", "#27519c", "#e8bd2e"],
      rects: [number, number, number, number][] = [];
    (function split(
      x: number,
      y: number,
      ww: number,
      hh: number,
      depth: number,
    ) {
      const tooSmall = ww < w * 0.14 && hh < h * 0.14;
      if (depth <= 0 || tooSmall || (depth < 3 && R() < 0.22)) {
        rects.push([x, y, ww, hh]);
        return;
      }
      const vertical = ww > hh ? R() < 0.75 : R() < 0.25,
        t = range(R, 0.32, 0.68);
      if (vertical) {
        split(x, y, ww * t, hh, depth - 1);
        split(x + ww * t, y, ww * (1 - t), hh, depth - 1);
      } else {
        split(x, y, ww, hh * t, depth - 1);
        split(x, y + hh * t, ww, hh * (1 - t), depth - 1);
      }
    })(m, m, w - 2 * m, h - 2 * m, 5);
    rects.forEach((r) => {
      if (R() < 0.28) {
        ctx.fillStyle = pick(R, cols);
        ctx.fillRect(...r);
      }
    });
    ctx.strokeStyle = "#14120e";
    ctx.lineWidth = lw;
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    rects.forEach((r) => ctx.strokeRect(...r));
  }
  function genHorizon(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#efece1");
    const pal = [
      "#a9ab99",
      "#8a9099",
      "#d6c9ac",
      "#b3856a",
      "#5f6659",
      "#c2b7a2",
      "#33404a",
    ];
    const n = 3 + ((R() * 3) | 0),
      fr = [];
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const v = range(R, 0.5, 2);
      fr.push(v);
      tot += v;
    }
    const cols = [...pal].sort(() => R() - 0.5);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const bh = (fr[i] / tot) * h;
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(0, y, w, bh + 1);
      y += bh;
    }
    const sy = range(R, h * 0.2, h * 0.55),
      sx = range(R, w * 0.25, w * 0.75),
      r = range(R, h * 0.08, h * 0.16);
    ctx.fillStyle = R() < 0.5 ? "#e8ddc4" : "#c8451f";
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 7);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillRect(0, sy + r * 1.3, w, Math.max(1.5, h * 0.004));
  }
  function genType(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#f5f1e6");
    const word = pick(R, ["Aa", "&", "N°", "fi", "Q", "§"]);
    const size = h * 0.52;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (R() < 0.25) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `300 ${size}px Fraunces, serif`;
    ctx.fillText(word, 0, size * 0.06);
    ctx.restore();
    ctx.fillStyle = pick(R, ACCENTS);
    ctx.fillRect(w * 0.5 - 26, h * 0.82, 52, 6);
    ctx.fillStyle = "#403c33";
    ctx.textAlign = "center";
    ctx.font = `500 ${Math.max(13, w * 0.028)}px "Space Grotesk", sans-serif`;
    spaced(
      ctx,
      "SPECIMEN — PLATE " + String(1 + ((R() * 9) | 0)).padStart(2, "0"),
      w / 2,
      h * 0.9,
      4,
    );
  }
  function genArcs(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    R: Random,
  ) {
    paper(ctx, w, h, "#f2eee1");
    const cx = R() < 0.5 ? w * range(R, 0.1, 0.28) : w * range(R, 0.72, 0.9);
    const cy = R() < 0.5 ? h * range(R, 0.1, 0.3) : h * range(R, 0.7, 0.9);
    const acc = pick(R, ACCENTS),
      step = Math.min(w, h) * 0.052;
    const n = ((Math.max(w, h) / step) | 0) + 3;
    for (let i = 1; i < n; i++) {
      ctx.lineWidth = R() < 0.3 ? step * 0.34 : step * 0.12;
      ctx.strokeStyle = i % 5 === 0 ? acc : INK;
      ctx.globalAlpha = range(R, 0.75, 1);
      const a0 = R() * Math.PI * 2,
        span = range(R, Math.PI * 0.6, Math.PI * 1.6);
      ctx.beginPath();
      ctx.arc(cx, cy, i * step, a0, a0 + span);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const GENERATORS = {
    rothko: genRothko,
    flow: genFlow,
    bauhaus: genBauhaus,
    halftone: genHalftone,
    mondrian: genMondrian,
    horizon: genHorizon,
    type: genType,
    arcs: genArcs,
    feature: genFeature,
  };
  const MATLESS = new Set(["bauhaus", "mondrian", "halftone", "feature"]);

  function makeArtCanvas(p: Project, idx: number, Wm: number, Hm: number) {
    const PPM = 520,
      cw = Math.round(Wm * PPM),
      ch = Math.round(Hm * PPM);
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const R = mulberry(0xc0ffee + idx * 7919);
    const image = artImages.get(idx);
    const paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      if (!image) {
        GENERATORS[p.gen](ctx, w, h, R);
        return;
      }
      const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
      const sw = w / scale,
        sh = h / scale;
      ctx.drawImage(
        image,
        (image.naturalWidth - sw) / 2,
        (image.naturalHeight - sh) / 2,
        sw,
        sh,
        0,
        0,
        w,
        h,
      );
    };
    if (MATLESS.has(p.gen)) {
      paint(g, cw, ch);
      g.strokeStyle = "rgba(0,0,0,.15)";
      g.lineWidth = 2;
      g.strokeRect(1, 1, cw - 2, ch - 2);
    } else {
      g.fillStyle = "#faf8f2";
      g.fillRect(0, 0, cw, ch);
      const pad = Math.round(Math.min(cw, ch) * 0.11);
      g.save();
      g.translate(pad, pad);
      g.beginPath();
      g.rect(0, 0, cw - 2 * pad, ch - 2 * pad);
      g.clip();
      paint(g, cw - 2 * pad, ch - 2 * pad);
      g.strokeStyle = "rgba(0,0,0,.3)";
      g.lineWidth = 4;
      g.strokeRect(2, 2, cw - 2 * pad - 4, ch - 2 * pad - 4);
      g.restore();
      g.strokeStyle = "rgba(0,0,0,.1)";
      g.lineWidth = 2;
      g.strokeRect(pad + 0.5, pad + 0.5, cw - 2 * pad - 1, ch - 2 * pad - 1);
    }
    return c;
  }
  function thumbURL(c: HTMLCanvasElement) {
    const s = Math.min(1, 640 / Math.max(c.width, c.height));
    const t = document.createElement("canvas");
    t.width = Math.max(1, Math.round(c.width * s));
    t.height = Math.max(1, Math.round(c.height * s));
    t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL("image/jpeg", 0.9);
  }
  function thumbnail(index: number) {
    const rec = arts[index];
    if (!rec) return undefined;
    if (!rec.thumb && rec.canvas) rec.thumb = thumbURL(rec.canvas);
    return rec.thumb || undefined;
  }
  function placardTexture(p: Project, idx: number) {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 420;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fdfcf9";
    g.fillRect(0, 0, 640, 420);
    g.strokeStyle = "rgba(0,0,0,.09)";
    g.lineWidth = 2;
    g.strokeRect(1, 1, 638, 418);
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillStyle = "#8a857a";
    g.font = '500 22px "Space Grotesk", sans-serif';
    spaced(g, "NO. " + String(idx + 1).padStart(2, "0"), 46, 80, 7);
    g.fillStyle = "#17150f";
    g.font = "600 56px Fraunces, serif";
    g.fillText(p.title, 44, 158, 548);
    g.fillStyle = "#57534a";
    g.font = '400 26px "Space Grotesk", sans-serif';
    g.fillText(p.year + " · " + p.tag, 46, 212);
    g.fillStyle = "rgba(0,0,0,.14)";
    g.fillRect(46, 250, 200, 2);
    g.fillStyle = "#b23a19";
    g.font = '500 25px "Space Grotesk", sans-serif';
    g.fillText(
      p.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      46,
      302,
      548,
    );
    g.fillStyle = "#8a857a";
    g.font = '500 21px "Space Grotesk", sans-serif';

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }
  function vinylTexture(maxAniso: number) {
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = 1120;
    const g = c.getContext("2d")!;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#b23a19";
    g.fillRect(1024 - 13, 84, 26, 26);
    g.fillStyle = "rgba(26,22,17,.55)";
    g.font = '500 30px "Space Grotesk", sans-serif';
    spaced(g, "A COLLECTION — NINE WORKS", 1024, 170, 10);
    g.fillStyle = "rgba(26,22,17,.92)";
    g.font = "300 176px Fraunces, serif";
    spaced(g, "THE WHITE ROOM", 1024, 412, 14);
    g.fillRect(1024 - 140, 470, 280, 3);
    g.font = "italic 300 62px Fraunces, serif";
    g.fillText("Every work is a door.", 1024, 600);
    g.fillStyle = "rgba(26,22,17,.6)";
    g.font = '500 30px "Space Grotesk", sans-serif';
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  }
  function plasterTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f3efe8";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 7000; i++) {
      g.fillStyle =
        Math.random() < 0.5 ? "rgba(80,70,55,.022)" : "rgba(255,255,255,.03)";
      g.fillRect((Math.random() * 256) | 0, (Math.random() * 256) | 0, 1, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 1.4);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function floorTextures(maxAniso: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e6e3dc";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle =
        Math.random() < 0.5 ? "rgba(0,0,0,.028)" : "rgba(255,255,255,.05)";
      g.fillRect(Math.random() * 512, Math.random() * 512, 1.4, 1.4);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,115,105,${Math.random() * 0.03})`;
      g.beginPath();
      g.arc(
        Math.random() * 512,
        Math.random() * 512,
        20 + Math.random() * 70,
        0,
        7,
      );
      g.fill();
    }
    g.strokeStyle = "rgba(60,55,48,.3)";
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 509, 509);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(ROOM.w / 2.2, ROOM.d / 2.2);
    map.anisotropy = maxAniso;

    const r = document.createElement("canvas");
    r.width = r.height = 256;
    const rg = r.getContext("2d")!;
    const img = rg.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 150 + ((Math.random() * 70) | 0);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    rg.putImageData(img, 0, 0);
    const rough = new THREE.CanvasTexture(r);
    rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
    rough.repeat.copy(map.repeat);
    return { map, rough };
  }

  /* ── lighting hardware ─────────────────────────────────────────── */
  function pictureSpot(
    from: THREE.Vector3,
    to: THREE.Vector3,
    intensity: number,
    shadowSize: number,
    angle: number,
    castsShadow = false,
  ) {
    const s = new THREE.SpotLight(0xfff0da, intensity, 11, angle, 0.62, 1.7);
    s.position.copy(from);
    s.target.position.copy(to);
    if (!isTouch && castsShadow) {
      s.castShadow = true;
      s.shadow.mapSize.set(shadowSize, shadowSize);
      s.shadow.bias = -0.0006;
      s.shadow.normalBias = 0.02;
      s.shadow.camera.near = 0.4;
      s.shadow.camera.far = 9;
    }
    scene.add(s, s.target);
    pictureSpots.push({ light: s, base: intensity });
    return s;
  }
  function fixture(from: THREE.Vector3, to: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.04, 0.17, 16),
      new THREE.MeshStandardMaterial({
        color: 0x232019,
        roughness: 0.5,
        metalness: 0.4,
      }),
    );
    m.position.copy(from).addScaledVector(dir, 0.085);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(m);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffedcf, toneMapped: false }),
    );
    bulb.position.copy(from).addScaledVector(dir, 0.175);
    scene.add(bulb);
  }

  /* ── scene state ────────────────────────────────────────────────── */
  const arts: Artwork[] = [],
    hitMeshes: THREE.Mesh[] = [];
  const obstacles: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }[] = [];
  let sculpt: THREE.Mesh | null = null,
    ready = false;
  let state: GalleryMode = "intro";
  let suspended = false;
  let pausedUntil = 0;
  let pausedFrameRendered = false;
  const pos = new THREE.Vector3(0, 0, 10.2),
    vel = new THREE.Vector3();
  let yaw = 0,
    pitch = -0.02,
    targetFov = 62,
    bobT = 0;
  let hovered: Artwork | null = null;
  let aimed: Artwork | null = null;
  const keys: Record<string, boolean> = {},
    touchMove = { f: 0, s: 0 };
  const raycaster = new THREE.Raycaster();
  const centerNDC = new THREE.Vector2(0, 0); // the fixed reticle — THE aim point

  /* live camera view — kept in sync every frame so every focus tween
   can start from exactly where the camera is right now             */
  let viewYaw = 0,
    viewPitch = 0,
    viewFov = 62;
  const viewPos = new THREE.Vector3(0, EYE, 10.2);

  function addObstacle(cx: number, cz: number, hx: number, hz: number) {
    const p = 0.55;
    obstacles.push({
      minX: cx - hx - p,
      maxX: cx + hx + p,
      minZ: cz - hz - p,
      maxZ: cz + hz + p,
    });
  }

  function place(
    p: Project,
    idx: number,
    wallPoint: THREE.Vector3,
    rotY: number,
    trackX: number | null,
  ) {
    const featured = !!p.featured;
    const normal = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
    const basePos = wallPoint.clone().addScaledVector(normal, 0.004);
    const group = new THREE.Group();
    group.position.copy(basePos);
    group.rotation.y = rotY;
    scene.add(group);
    const rec: Artwork = {
      p,
      idx,
      group,
      normal,
      basePos,
      lift: 0,
      liftTarget: 0,
      lights: [],
      thumb: "",
      canvas: null,
      texture: null,
    };

    const W = p.w,
      H = p.h,
      t = featured ? 0.062 : 0.046,
      d = 0.056;
    const frameMat = new THREE.MeshStandardMaterial({
      color: idx % 3 === 1 ? 0x262320 : 0xa8895f,
      roughness: 0.55,
      envMapIntensity: 0.4,
    });
    const bars: THREE.BufferGeometry[] = [];
    const bar = (bw: number, bh: number, x: number, y: number) => {
      const geometry = new THREE.BoxGeometry(bw, bh, d);
      geometry.translate(x, y, d / 2);
      bars.push(geometry);
    };
    bar(W, t, 0, (H - t) / 2);
    bar(W, t, 0, -(H - t) / 2);
    bar(t, H - 2 * t, -(W - t) / 2, 0);
    bar(t, H - 2 * t, (W - t) / 2, 0);
    const frameGeometry = mergeGeometries(bars);
    for (const geometry of bars) geometry.dispose();
    if (!frameGeometry) throw new Error("Frame geometry could not be merged");
    const frame = new THREE.Mesh(frameGeometry, frameMat);
    frame.castShadow = true;
    group.add(frame);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 2 * t + 0.04, H - 2 * t + 0.04),
      new THREE.MeshStandardMaterial({ color: 0x2c2823, roughness: 0.9 }),
    );
    back.position.z = 0.014;
    group.add(back);

    const artCanvas = makeArtCanvas(p, idx, W - 2 * t, H - 2 * t);
    rec.canvas = artCanvas;
    rec.thumb = artImages.has(idx) ? p.image! : "";
    const artTex = new THREE.CanvasTexture(artCanvas);
    rec.texture = artTex;
    artTex.colorSpace = THREE.SRGBColorSpace;
    artTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 2 * t, H - 2 * t),
      new THREE.MeshStandardMaterial({
        map: artTex,
        roughness: 0.93,
        envMapIntensity: 0.14,
      }),
    );
    art.position.z = 0.046;
    group.add(art);
    const pl = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.197),
      new THREE.MeshStandardMaterial({
        map: placardTexture(p, idx),
        roughness: 0.85,
        envMapIntensity: 0.1,
      }),
    );
    pl.position.set(W / 2 + 0.27, -0.3, 0.03);
    group.add(pl);

    const hit = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.85, H + 0.5),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hit.visible = false; // Raycaster still intersects hidden hit targets.
    hit.position.set(0.18, 0, 0.12);
    hit.userData.rec = rec;
    group.add(hit);
    hitMeshes.push(hit);
    arts.push(rec);

    if (trackX !== null) {
      const from = new THREE.Vector3(trackX, 4.3, wallPoint.z);
      const to = new THREE.Vector3(wallPoint.x, wallPoint.y, wallPoint.z);
      rec.lights.push({
        s: pictureSpot(
          from,
          to,
          85,
          featured ? 1024 : 512,
          featured ? 0.6 : 0.48,
        ),
        base: 85,
      });
      fixture(from, to);
    } else {
      for (const sx of [-2.6, 2.6]) {
        const from = new THREE.Vector3(sx, 4.3, -10.35);
        const to = new THREE.Vector3(0, wallPoint.y, wallPoint.z);
        rec.lights.push({ s: pictureSpot(from, to, 95, 1024, 0.6), base: 95 });
        fixture(from, to);
      }
    }
  }
  function bench(z: number) {
    const wood = new THREE.MeshStandardMaterial({
      color: 0x4b3a2b,
      roughness: 0.5,
      envMapIntensity: 0.5,
    });
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 2.1), wood);
    top.position.y = 0.45;
    top.castShadow = true;
    g.add(top);
    [-0.9, 0.9].forEach((zz) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.07), wood);
      leg.position.set(0, 0.21, zz);
      leg.castShadow = true;
      g.add(leg);
    });
    g.position.set(0, 0, z);
    scene.add(g);
    addObstacle(0, z, 0.3, 1.1);
  }

  /* ── build the room ─────────────────────────────────────────────── */
  const artImages = new Map<number, HTMLImageElement>();
  const pendingImages = new Set<() => void>();
  function loadImage(url: string, index: number): Promise<void> {
    return new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      const finish = (loaded: boolean) => {
        clearTimeout(timeout);
        pendingImages.delete(cancel);
        image.onload = image.onerror = null;
        if (loaded && !disposed) artImages.set(index, image);
        if (!loaded) image.src = "";
        resolve();
      };
      const cancel = () => finish(false);
      const timeout = setTimeout(cancel, 5000);
      pendingImages.add(cancel);
      image.onload = () => finish(true);
      image.onerror = cancel;
      image.src = url;
    });
  }
  let buildYieldTimer: ReturnType<typeof setTimeout> | undefined;
  let finishBuildYield: (() => void) | undefined;
  function yieldBuild() {
    return new Promise<void>((resolve) => {
      finishBuildYield = () => {
        clearTimeout(buildYieldTimer);
        buildYieldTimer = undefined;
        finishBuildYield = undefined;
        resolve();
      };
      buildYieldTimer = setTimeout(finishBuildYield, 0);
    });
  }
  let built = false;
  async function build() {
    if (disposed) return;
    if (built) return;
    built = true;
    try {
      await Promise.all(
        PROJECTS.map((p, index) =>
          p.image ? loadImage(p.image, index) : Promise.resolve(),
        ),
      );
      if (disposed) return;
      const maxAniso = renderer.capabilities.getMaxAnisotropy();

      const wallMat = new THREE.MeshStandardMaterial({
        color: 0xf3efe8,
        roughness: 0.95,
        envMapIntensity: 0.22,
        map: plasterTexture(),
      });
      const wall = (
        w: number,
        h: number,
        x: number,
        y: number,
        z: number,
        ry: number,
      ) => {
        const geometry =
          w === ROOM.d
            ? panelWithOpenings(
                w,
                h,
                CLERESTORY_Z.map((z) => ({
                  x: z,
                  y: 3.55 - h / 2,
                  width: 2.6,
                  height: 0.8,
                })),
              )
            : new THREE.PlaneGeometry(w, h);
        const m = new THREE.Mesh(geometry, wallMat);
        if (w === ROOM.d)
          m.name = x > 0 ? "East clerestory wall" : "West clerestory wall";
        m.position.set(x, y, z);
        m.rotation.y = ry;
        m.receiveShadow = true;
        scene.add(m);
      };
      wall(ROOM.d, ROOM.h, -ROOM.w / 2, ROOM.h / 2, 0, Math.PI / 2);
      wall(ROOM.d, ROOM.h, ROOM.w / 2, ROOM.h / 2, 0, -Math.PI / 2);
      wall(ROOM.w, ROOM.h, 0, ROOM.h / 2, -ROOM.d / 2, 0);
      wall(ROOM.w, ROOM.h, 0, ROOM.h / 2, ROOM.d / 2, Math.PI);

      const ceil = new THREE.Mesh(
        panelWithOpenings(ROOM.w, ROOM.d, [
          { x: 0, y: 0, width: SKYLIGHT.width, height: SKYLIGHT.length },
        ]),
        new THREE.MeshStandardMaterial({
          color: 0xf4f1ea,
          roughness: 0.96,
          envMapIntensity: 0.15,
        }),
      );
      ceil.name = "Ceiling with skylight opening";
      ceil.rotation.x = Math.PI / 2;
      ceil.position.y = ROOM.h;
      scene.add(ceil);

      const { map: fMap, rough: fRough } = floorTextures(maxAniso);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM.w, ROOM.d),
        new THREE.MeshStandardMaterial({
          map: fMap,
          roughnessMap: fRough,
          roughness: 0.62,
          metalness: 0.04,
          envMapIntensity: 0.6,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const gapMat = new THREE.MeshStandardMaterial({
        color: 0x161310,
        roughness: 0.85,
      });
      const gap = (w: number, d: number, x: number, z: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), gapMat);
        m.position.set(x, 0.035, z);
        scene.add(m);
      };
      gap(0.02, ROOM.d, -ROOM.w / 2 + 0.01, 0);
      gap(0.02, ROOM.d, ROOM.w / 2 - 0.01, 0);
      gap(ROOM.w, 0.02, 0, -ROOM.d / 2 + 0.01);
      gap(ROOM.w, 0.02, 0, ROOM.d / 2 - 0.01);

      const trackMat = new THREE.MeshStandardMaterial({
        color: 0x1f1c17,
        roughness: 0.5,
        metalness: 0.35,
      });
      [-3.15, 3.15].forEach((x) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.05, 21),
          trackMat,
        );
        m.position.set(x, ROOM.h - 0.03, -0.5);
        scene.add(m);
      });
      const cross = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 0.05, 0.07),
        trackMat,
      );
      cross.position.set(1.45, ROOM.h - 0.03, 2.4);
      scene.add(cross);

      const frameMat = new THREE.MeshStandardMaterial({
        color: 0xefece4,
        roughness: 0.9,
      });
      [-1.22, 1.22].forEach((x) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.14, 18.8),
          frameMat,
        );
        m.position.set(x, ROOM.h - 0.03, 0);
        scene.add(m);
      });
      [-9.4, 9.4].forEach((z) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 0.14, 0.06),
          frameMat,
        );
        m.position.set(0, ROOM.h - 0.03, z);
        scene.add(m);
      });
      addOpeningDetails(scene, wallMat, ceil.material, trackMat, ROOM.h);

      [
        [0, -5.5],
        [0, 5.5],
      ].forEach(([x, z]) => {
        const from = new THREE.Vector3(x, ROOM.h - 0.06, z);
        const s = new THREE.SpotLight(0xfff6e8, 26, 13, 1.05, 1, 1.3);
        ceilingSpots.push(s);
        s.position.copy(from);
        s.target.position.set(x, 0, z);
        scene.add(s, s.target);
        fixture(from, new THREE.Vector3(x, 0, z));
      });

      const zs = [-8.25, -2.75, 2.75, 8.25];
      for (const [i, p] of PROJECTS.entries()) {
        if (i < 4)
          place(
            p,
            i,
            new THREE.Vector3(-ROOM.w / 2, ART_Y, zs[i]),
            Math.PI / 2,
            -3.15,
          );
        else if (i < 8)
          place(
            p,
            i,
            new THREE.Vector3(ROOM.w / 2, ART_Y, zs[i - 4]),
            -Math.PI / 2,
            3.15,
          );
        else place(p, i, new THREE.Vector3(0, 1.86, -ROOM.d / 2), 0, null);
        await yieldBuild();
        if (disposed) return;
      }

      bench(4.8);
      bench(-4.8);

      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 1.05, 0.6),
        new THREE.MeshStandardMaterial({ color: 0xefeee8, roughness: 0.9 }),
      );
      plinth.position.set(0, 0.525, 0);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      scene.add(plinth);
      addObstacle(0, 0, 0.34, 0.34);
      sculpt = new THREE.Mesh(
        new THREE.TorusKnotGeometry(0.3, 0.1, 260, 36),
        new THREE.MeshStandardMaterial({
          color: 0x554232,
          metalness: 0.92,
          roughness: 0.3,
          envMapIntensity: 1.15,
        }),
      );
      sculpt.position.set(0, 1.52, 0);
      sculpt.castShadow = true;
      scene.add(sculpt);
      const sFrom = new THREE.Vector3(1.8, ROOM.h - 0.08, 2.4);
      pictureSpot(sFrom, new THREE.Vector3(0, 1.3, 0), 90, 1024, 0.5, true);
      fixture(sFrom, new THREE.Vector3(0, 1.3, 0));

      const vinyl = new THREE.Mesh(
        new THREE.PlaneGeometry(4.9, 2.68),
        new THREE.MeshBasicMaterial({
          map: vinylTexture(maxAniso),
          transparent: true,
        }),
      );
      vinyl.rotation.y = Math.PI;
      vinyl.position.set(0, 2.35, ROOM.d / 2 - 0.015);
      scene.add(vinyl);

      // Since r163, per-material envMapIntensity applies only to explicit envMap.
      // Bind it here to preserve the original wall, frame, and artwork brightness.
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.envMap = environmentTarget.texture;
            baseEnvironment.set(material, material.envMapIntensity);
          }
        }
      });
      outside = createOutside(scene);
      updateLighting(performance.now());
      outside.update(lighting, lightingMinutes, outsideElapsed);
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      renderer.shadowMap.needsUpdate = true;
      ready = true;
      onChange({ ready: true });
    } catch (err) {
      if (disposed) return;
      console.error("The gallery failed to build:", err);
      onChange({ error: true });
    }
  }

  /* ── interaction ────────────────────────────────────────────────── */

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toastMsg(text: string) {
    onChange({ toast: text });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => onChange({ toast: "" }), 4200);
  }

  let lastAimRec: Artwork | null = null;
  let lastAimCta = "";
  function setHover(rec: Artwork | null, far: boolean, dist: number) {
    aimed = rec;
    hovered = rec && !far ? rec : null;
    const cta = rec
      ? far
        ? "WALK CLOSER · " + dist.toFixed(1) + " M"
        : "VIEW WORK →"
      : "";
    if (rec === lastAimRec && cta === lastAimCta) return;
    lastAimRec = rec;
    lastAimCta = cta;
    onChange({
      hover: rec ? { project: rec.p, index: rec.idx, far, cta } : null,
    });
  }
  function updateHover() {
    let rec: Artwork | null = null,
      far = false,
      dist = 0;
    if (state === "playing" && !isTouch) {
      raycaster.setFromCamera(centerNDC, camera);
      const hit = raycaster.intersectObjects(hitMeshes, false)[0];
      if (hit) {
        rec = hit.object.userData.rec as Artwork;
        dist = hit.distance;
        far = dist > REACH;
      }
    }
    setHover(rec, far, dist);
  }

  /* ── focus mode — a staged camera move ──────────────────────────────
   Click → 'dolly'   : camera travels to a pose squarely in front of
                       the work but shifted RIGHT of its axis (parallel
                       to the wall), so the work sits left-of-centre in
                       the band of screen the sidebar leaves free. The
                       camera still faces square to the wall, so the
                       work keeps its true rectangle — no keystone.
                       On the first dolly frame the sidebar begins to slide in.
          'hold'     : locked view, rock steady — nothing drifts.
   Close → 'panelOut': sidebar slides away first, camera holds.
          'return'   : the move reverses — the camera glides from the
                       focus pose back to the exact POV (position, angle,
                       zoom) captured at click time, then hands control
                       back to the player.                            */
  let focus: FocusMove | null = null;
  let savedView: Omit<Pose, "pos"> = { yaw: 0, pitch: 0, fov: 62 }; // the POV at the moment of the click
  const _v = new THREE.Vector3();
  const easeIO = (x: number) =>
    x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  function shortestYaw(to: number, from: number) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  const isMobileView = () => innerWidth <= MOBILE_BP;
  const livePose = () => ({
    yaw: viewYaw,
    pitch: viewPitch,
    fov: viewFov,
    pos: viewPos.clone(),
  });

  function focusTargets(rec: Artwork, reframing = false) {
    const P = rec.basePos.clone().addScaledVector(rec.normal, 0.1);
    const mobile = isMobileView();
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOCUS_FOV / 2));
    const tanH = tanV * camera.aspect;
    let fw = 0,
      fh = 0;
    if (mobile)
      fh = THREE.MathUtils.clamp(
        panelEl.offsetHeight / innerHeight,
        0.38,
        0.55,
      );
    else
      fw = THREE.MathUtils.clamp(panelEl.offsetWidth / innerWidth, 0.12, 0.42);
    const availW = (mobile ? 0.94 : 1 - fw - 0.06) * 2 * tanH;
    const availH = (mobile ? fh - 0.06 : 0.82) * 2 * tanV;
    const fit = Math.max(rec.p.w / availW, rec.p.h / availH, 1.35) + 0.12;
    const cur = P.distanceTo(viewPos);
    const dist = THREE.MathUtils.clamp(
      Math.max(
        fit,
        reframing && focus
          ? focus.to.pos.clone().sub(P).dot(rec.normal)
          : cur + DOLLY_BACK,
      ),
      1.2,
      mobile ? 7.5 : 6.0,
    );
    const ndcX = mobile ? 0 : -fw;
    const ndcY = mobile ? 1 - fh : 0;
    const shiftX = -ndcX * dist * tanH;
    const needY = ndcY * dist * tanV;
    const dropY = Math.min(needY, Math.max(0, EYE - 1.02));
    const right = new THREE.Vector3(rec.normal.z, 0, -rec.normal.x);
    const toPos = P.clone()
      .addScaledVector(rec.normal, dist)
      .addScaledVector(right, shiftX);
    toPos.y = EYE - dropY;
    toPos.x = THREE.MathUtils.clamp(
      toPos.x,
      -ROOM.w / 2 + 0.45,
      ROOM.w / 2 - 0.45,
    );
    toPos.z = THREE.MathUtils.clamp(
      toPos.z,
      -ROOM.d / 2 + 0.45,
      ROOM.d / 2 - 0.45,
    );
    const toYaw = Math.atan2(rec.normal.x, rec.normal.z); // square to the wall
    const toPitch =
      Math.atan2(P.y - (EYE - dropY), dist) - Math.atan2(needY, dist);
    return { toYaw, toPitch, toPos };
  }
  function fillPanel(rec: Artwork) {
    onChange({
      selected: {
        project: rec.p,
        index: rec.idx,
        thumbnail: thumbnail(rec.idx) ?? "",
      },
    });
  }
  function enterFocus(rec: Artwork) {
    if (state !== "playing") return;
    viewYaw = yaw;
    viewPitch = pitch;
    viewFov = camera.fov;
    viewPos.copy(camera.position);
    savedView = { yaw: yaw, pitch: pitch, fov: targetFov }; // POV to return to on close
    fillPanel(rec);
    setHover(null, false, 0);
    const tg = focusTargets(rec);
    const to = {
      yaw: tg.toYaw,
      pitch: tg.toPitch,
      fov: FOCUS_FOV,
      pos: tg.toPos,
    };
    const move = viewPos.distanceTo(to.pos);
    focus = {
      rec,
      phase: "dolly",
      t: 0,
      dur: reducedMotion ? 0.01 : 0.6 + Math.min(0.35, move * 0.13),
      panelShown: false,
      from: livePose(),
      to,
      dYaw: shortestYaw(to.yaw, viewYaw),
    };
    state = "focus";
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    onChange({ mode: "focus", focused: true });
    // The panel starts on the next dolly frame, after the first camera update.
  }
  function exitFocus() {
    if (!focus || focus.phase === "panelOut" || focus.phase === "return")
      return;
    focus.phase = "panelOut";
    focus.t = 0;
    focus.wait = reducedMotion ? 0 : focus.panelShown ? 0.12 : 0.08; // panel leads the way out, camera follows
    onChange({ panelOpen: false, focused: false });
  }
  function startReturn() {
    const to = {
      yaw: savedView.yaw,
      pitch: savedView.pitch,
      fov: savedView.fov,
      pos: new THREE.Vector3(pos.x, EYE, pos.z),
    }; // matches what walking will produce
    const move = viewPos.distanceTo(to.pos);
    if (!focus) return;
    focus.phase = "return";
    focus.t = 0;
    focus.dur = reducedMotion ? 0.01 : 0.5 + Math.min(0.3, move * 0.12);
    focus.from = livePose();
    focus.to = to;
    focus.dYaw = shortestYaw(to.yaw, viewYaw);
  }
  function stepFocus(dir: number) {
    if (!focus || focus.phase === "panelOut" || focus.phase === "return")
      return;
    const next = arts[(focus.rec.idx + dir + arts.length) % arts.length];
    focus.rec = next;
    fillPanel(next);
    const tg = focusTargets(next);
    const to = {
      yaw: tg.toYaw,
      pitch: tg.toPitch,
      fov: FOCUS_FOV,
      pos: tg.toPos,
    };
    const move = viewPos.distanceTo(to.pos);
    Object.assign(focus, {
      phase: "dolly",
      t: 0,
      dur: reducedMotion ? 0.01 : 0.5 + Math.min(0.3, move * 0.12),
      from: livePose(),
      to,
      dYaw: shortestYaw(to.yaw, viewYaw),
    });
    // panelShown carries over — the page is open, only the camera moves
  }

  /* the locked "hold" view — deliberately rock steady, nothing drifts */
  function holdView(f: FocusMove) {
    camera.position.copy(f.to.pos);
    camera.rotation.set(f.to.pitch, f.to.yaw, 0);
    camera.fov = f.to.fov;
    camera.updateProjectionMatrix();
    viewYaw = f.to.yaw;
    viewPitch = f.to.pitch;
    viewFov = f.to.fov;
    viewPos.copy(camera.position);
  }
  function applyTween(f: FocusMove, e: number) {
    const y = f.from.yaw + f.dYaw * e;
    const p = f.from.pitch + (f.to.pitch - f.from.pitch) * e;
    const fo = f.from.fov + (f.to.fov - f.from.fov) * e;
    const P = _v.lerpVectors(f.from.pos, f.to.pos, e);
    camera.position.copy(P);
    camera.rotation.set(p, y, 0);
    camera.fov = fo;
    camera.updateProjectionMatrix();
    viewYaw = y;
    viewPitch = p;
    viewFov = fo;
    viewPos.copy(P);
  }

  /* ── input: keyboard ────────────────────────────────────────────── */
  listen(window, "keydown", (e) => {
    if (e.target instanceof Node && panelEl.contains(e.target)) return;
    if (e.code === "Escape" && state === "playing") {
      // Let the unlock event own pausing, including browser-driven Esc release.
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      else pauseGame();
      return;
    }
    if (
      e.target instanceof Element &&
      e.target.closest(
        "button, a, input, textarea, select, [contenteditable='true']",
      )
    )
      return;
    if (state === "focus") {
      if (e.code === "Escape") exitFocus();
      else if (e.code === "ArrowLeft") stepFocus(-1);
      else if (e.code === "ArrowRight") stepFocus(1);
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(
          e.code,
        )
      )
        e.preventDefault();
      return;
    }
    if (
      state === "playing" &&
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
        e.code,
      )
    )
      e.preventDefault();
    if (state !== "playing" || needsResume) return;
    keys[e.code] = true;
  });
  listen(window, "keyup", (e) => {
    keys[e.code] = false;
  });

  /* ── input: mouse ──────────────────────────────────────────────── */
  const SENS = 0.0032;
  let pressPos: { x: number; y: number } | null = null;
  let pressTravel = 0;
  let pointerLockFallback = !canvas.requestPointerLock;
  let fallbackPointer: { x: number; y: number } | null = null;
  let needsResume = false;

  function resumeLook() {
    if (isTouch || state !== "playing") return;
    needsResume = false;
    canvas.focus({ preventScroll: true });
    fallbackPointer = null;
    onChange({ needsResume: false });
    if (pointerLockFallback) return;
    const fallback = () => {
      if (disposed) return;
      pointerLockFallback = true;
      needsResume = false;
      onChange({ needsResume: false });
    };
    try {
      canvas.requestPointerLock()?.catch(fallback);
    } catch {
      fallback();
    }
  }
  listen(document, "pointerlockchange", () => {
    if (
      document.pointerLockElement !== canvas &&
      state === "playing" &&
      !needsResume
    )
      pauseGame();
  });
  listen(document, "pointerlockerror", () => {
    pointerLockFallback = true;
    needsResume = false;
    onChange({ needsResume: false });
  });
  listen(document, "mousemove", (e) => {
    if (state !== "playing" || isTouch || needsResume) return;
    const locked = document.pointerLockElement === canvas;
    if (!locked && !pointerLockFallback) return;
    const dx = locked
      ? e.movementX
      : fallbackPointer
        ? THREE.MathUtils.clamp(e.clientX - fallbackPointer.x, -160, 160)
        : 0;
    const dy = locked
      ? e.movementY
      : fallbackPointer
        ? THREE.MathUtils.clamp(e.clientY - fallbackPointer.y, -160, 160)
        : 0;
    if (!locked) fallbackPointer = { x: e.clientX, y: e.clientY };
    if (pressPos) pressTravel += Math.hypot(dx, dy);
    yaw -= dx * SENS;
    pitch = THREE.MathUtils.clamp(pitch - dy * SENS, -1.45, 1.45);
  });
  listen(document, "mousedown", (e) => {
    if (isTouch || e.button !== 0) return;
    if (state === "focus") {
      if (e.target === canvas) pressPos = { x: e.clientX, y: e.clientY };
      return;
    }
    if (state !== "playing") return;
    if (needsResume) {
      resumeLook();
      return;
    }
    pressTravel = 0;
    pressPos = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  });
  listen(document, "mouseup", (e) => {
    if (e.button !== 0 || !pressPos) return;
    const moved = Math.hypot(e.clientX - pressPos.x, e.clientY - pressPos.y);
    pressPos = null;
    if (Math.max(moved, pressTravel) >= 8) return;
    if (state === "focus") {
      exitFocus();
      return;
    }
    if (state === "playing" && !isTouch) {
      if (hovered)
        enterFocus(hovered); // work under the centre reticle
      else if (aimed)
        toastMsg(
          "A little too far — walk up to “" +
            aimed.p.title +
            "” and click to view it.",
        );
    }
  });
  listen(document, "contextmenu", (e) => {
    if (state === "playing" || state === "focus") e.preventDefault();
  });

  listen(
    window,
    "wheel",
    (e) => {
      if (state !== "playing") return;
      targetFov = THREE.MathUtils.clamp(targetFov + e.deltaY * 0.03, 36, 70);
    },
    { passive: true },
  );

  /* ── input: touch ───────────────────────────────────────────────── */
  let stickId = -1,
    lookId = -1,
    stickOrigin = { x: 0, y: 0 },
    lookLast = { x: 0, y: 0 };
  const touchInfo: Record<
    number,
    {
      x: number;
      y: number;
      t: number;
      moved: number;
      target: EventTarget | null;
    }
  > = {};
  function onTouchStart(e: TouchEvent) {
    if (state !== "playing" && state !== "focus") return;
    for (const t of e.changedTouches) {
      if (state === "playing" && t.clientX < innerWidth * 0.45 && stickId < 0) {
        stickId = t.identifier;
        stickOrigin = { x: t.clientX, y: t.clientY };
        stick.style.display = "block";
        stick.style.left = t.clientX + "px";
        stick.style.top = t.clientY + "px";
        touchInfo[t.identifier] = {
          x: t.clientX,
          y: t.clientY,
          t: performance.now(),
          moved: 0,
          target: e.target,
        };
      } else if (lookId < 0) {
        lookId = t.identifier;
        lookLast = { x: t.clientX, y: t.clientY };
        touchInfo[t.identifier] = {
          x: t.clientX,
          y: t.clientY,
          t: performance.now(),
          moved: 0,
          target: e.target,
        };
      }
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (state !== "playing") return;
    for (const t of e.changedTouches) {
      const info = touchInfo[t.identifier];
      if (!info) continue;
      if (t.identifier === stickId) {
        let dx = t.clientX - stickOrigin.x,
          dy = t.clientY - stickOrigin.y;
        const d = Math.hypot(dx, dy),
          max = 52;
        if (d > max) {
          dx *= max / d;
          dy *= max / d;
        }
        stickNub.style.transform = `translate(${dx}px,${dy}px)`;
        touchMove.s = dx / max;
        touchMove.f = -dy / max;
        info.moved += Math.abs(dx) + Math.abs(dy);
      } else if (t.identifier === lookId) {
        const dx = t.clientX - lookLast.x,
          dy = t.clientY - lookLast.y;
        lookLast = { x: t.clientX, y: t.clientY };
        yaw -= dx * 0.0044;
        pitch = THREE.MathUtils.clamp(pitch - dy * 0.0044, -1.45, 1.45);
        info.moved += Math.abs(dx) + Math.abs(dy);
      }
    }
  }
  function onTouchEnd(e: TouchEvent) {
    for (const t of e.changedTouches) {
      const info = touchInfo[t.identifier];
      if (t.identifier === stickId) {
        stickId = -1;
        touchMove.s = touchMove.f = 0;
        stick.style.display = "none";
        stickNub.style.transform = "translate(0,0)";
      }
      if (t.identifier === lookId) lookId = -1;
      if (
        info &&
        info.target === canvas &&
        info.moved < 12 &&
        performance.now() - info.t < 350
      )
        tapOpen(t.clientX, t.clientY);
      delete touchInfo[t.identifier];
    }
  }
  function tapOpen(cx: number, cy: number) {
    if (state === "focus") {
      exitFocus();
      return;
    }
    if (state !== "playing") return;
    const ndc = new THREE.Vector2(
      (cx / innerWidth) * 2 - 1,
      -(cy / innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(hitMeshes, false)[0];
    if (!hit) return;
    const rec = hit.object.userData.rec;
    if (hit.distance <= REACH) enterFocus(rec);
    else
      toastMsg(
        "A little too far — walk up to “" +
          rec.p.title +
          "” and tap to view it.",
      );
  }
  listen(document, "touchstart", onTouchStart, { passive: true });
  listen(document, "touchmove", onTouchMove, { passive: true });
  listen(document, "touchend", onTouchEnd, { passive: true });
  listen(document, "touchcancel", onTouchEnd, { passive: true });

  /* ── overlay / entry ────────────────────────────────────────────── */
  function startPlay() {
    previousTime = performance.now();
    resetResolutionWindow();
    pausedFrameRendered = false;
    state = "playing";
    pressPos = null;
    onChange({ mode: "playing", needsResume: false });
    resumeLook();
  }
  function pauseGame() {
    if (state !== "playing") return;
    state = "paused";
    // The overlay fades for 550 ms; allow its React commit, then one final frame.
    pausedUntil = performance.now() + 600;
    pausedFrameRendered = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    vel.set(0, 0, 0);
    pressPos = null;
    Object.keys(keys).forEach((k) => (keys[k] = false));
    touchMove.f = touchMove.s = 0;
    onChange({ mode: "paused" });
    setHover(null, false, 0);
  }

  /* ── movement + frame loop ─────────────────────────────────────── */
  function updatePlayer(dt: number) {
    /* keyboard turning — Q/E and ←/→ (arrows no longer strafe) */
    const turn =
      (keys.KeyE || keys.ArrowRight ? 1 : 0) -
      (keys.KeyQ || keys.ArrowLeft ? 1 : 0);
    if (turn) yaw -= turn * TURN_SPEED * dt;
    const f =
      (keys.KeyW || keys.ArrowUp ? 1 : 0) -
      (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    let mx = s + touchMove.s,
      mz = f + touchMove.f;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = keys.ShiftLeft || keys.ShiftRight ? 4.3 : 2.3;
    const sy = Math.sin(yaw),
      cy = Math.cos(yaw);
    const tx = (-sy * mz + cy * mx) * speed,
      tz = (-cy * mz - sy * mx) * speed;
    const response = tx === 0 && tz === 0 ? 25 : 18;
    const k = 1 - Math.exp(-response * dt);
    vel.x += (tx - vel.x) * k;
    vel.z += (tz - vel.z) * k;
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    const r = 0.42;
    pos.x = THREE.MathUtils.clamp(pos.x, -ROOM.w / 2 + r, ROOM.w / 2 - r);
    pos.z = THREE.MathUtils.clamp(pos.z, -ROOM.d / 2 + r, ROOM.d / 2 - r);
    for (const o of obstacles) {
      if (
        pos.x > o.minX &&
        pos.x < o.maxX &&
        pos.z > o.minZ &&
        pos.z < o.maxZ
      ) {
        const dl = pos.x - o.minX,
          dr = o.maxX - pos.x,
          db = pos.z - o.minZ,
          df = o.maxZ - pos.z;
        const m = Math.min(dl, dr, db, df);
        if (m === dl) pos.x = o.minX;
        else if (m === dr) pos.x = o.maxX;
        else if (m === db) pos.z = o.minZ;
        else pos.z = o.maxZ;
      }
    }
    const sp = Math.hypot(vel.x, vel.z);
    bobT += dt * (3 + sp * 2.6);
    const bob = reducedMotion
      ? 0
      : Math.sin(bobT * 2) * 0.013 * Math.min(1, sp / 2.3);
    camera.position.set(pos.x, EYE + bob, pos.z);
    camera.rotation.set(pitch, yaw, 0);
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-14 * dt));
    camera.updateProjectionMatrix();
  }
  function cinematic(t: number) {
    camera.position.set(2.9, 1.9, 7.6);
    camera.lookAt(
      Math.sin(t * 0.1) * 3.2,
      1.55 + Math.sin(t * 0.07) * 0.3,
      -7 + Math.cos(t * 0.08) * 2,
    );
  }

  // ponytail: p90 resolution hysteresis uses RAF intervals, not GPU timers. The
  // display budget is the fast-end (p10) startup interval snapped to a standard
  // refresh rate, so a GPU-saturated startup cannot inflate it past 60 Hz. Vsync
  // hides spare GPU capacity, so the conservative upscale may never fire.
  // Suspended/hidden time is excluded; this heuristic cannot promise a frame rate.
  const REFRESH_INTERVALS = [240, 165, 144, 120, 90, 75, 60].map(
    (hz) => 1000 / hz,
  );
  const resolutionFloor = Math.min(isTouch ? 0.75 : 1, resolutionCap);
  const calibrationIntervals: number[] = [];
  const resolutionIntervals: number[] = [];
  let calibrationStart = performance.now();
  let displayBudget = 0;
  let resolutionSamples = 0;
  let slowSince = 0;
  let fastSince = 0;
  let lastResolutionChange = -Infinity;
  let renderedFrame = 0;

  function resetResolutionWindow() {
    resolutionIntervals.length = 0;
    slowSince = fastSince = 0;
    resolutionSamples = 0;
    if (!displayBudget) {
      calibrationIntervals.length = 0;
      calibrationStart = performance.now();
    }
  }
  function adaptResolution(interval: number, now: number) {
    if (document.hidden || interval <= 0) return;
    if (!displayBudget) {
      calibrationIntervals.push(interval);
      if (now - calibrationStart < 1000 || calibrationIntervals.length < 20)
        return;
      calibrationIntervals.sort((a, b) => a - b);
      const fast =
        calibrationIntervals[Math.floor(calibrationIntervals.length * 0.1)];
      displayBudget = REFRESH_INTERVALS.reduce((best, ms) =>
        Math.abs(ms - fast) < Math.abs(best - fast) ? ms : best,
      );
      calibrationIntervals.length = 0;
      return;
    }
    resolutionIntervals.push(interval);
    if (resolutionIntervals.length > 60) resolutionIntervals.shift();
    // Evaluate four times per 60 samples, rather than sorting on every frame.
    if (resolutionIntervals.length < 60 || ++resolutionSamples % 15 !== 0)
      return;
    const sorted = [...resolutionIntervals].sort((a, b) => a - b);
    const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1];
    let direction = 0;
    if (p90 > displayBudget * 1.25) {
      if (!slowSince) slowSince = now;
      fastSince = 0;
      if (now - slowSince >= 2000) direction = -1;
    } else if (p90 < displayBudget * 0.8) {
      if (!fastSince) fastSince = now;
      slowSince = 0;
      if (now - fastSince >= 5000) direction = 1;
    } else {
      slowSince = fastSince = 0;
    }
    if (!direction || now - lastResolutionChange < 2000) return;
    const next = THREE.MathUtils.clamp(
      renderer.getPixelRatio() + direction * 0.25,
      resolutionFloor,
      resolutionCap,
    );
    if (next === renderer.getPixelRatio()) return;
    renderer.setPixelRatio(next);
    lastResolutionChange = now;
    resetResolutionWindow();
  }
  listen(document, "visibilitychange", () => {
    previousTime = performance.now();
    resetResolutionWindow();
  });

  let previousTime = performance.now();
  let elapsedTime = 0;
  function animate() {
    animationFrame = requestAnimationFrame(animate);
    if (disposed) return;
    if (suspended || (state === "paused" && pausedFrameRendered)) return;
    const now = performance.now();
    if (ready) updateLighting(now);
    const delta = (now - previousTime) / 1000;
    previousTime = now;
    adaptResolution(delta * 1000, now);
    elapsedTime += delta;
    const dt = Math.min(delta, 0.05);
    const t = elapsedTime;

    if (state === "playing" && !needsResume) {
      updatePlayer(dt);
      viewYaw = yaw;
      viewPitch = pitch;
      viewFov = camera.fov;
      viewPos.copy(camera.position);
    } else if (state === "focus" && focus) {
      const f = focus;
      if (f.phase === "dolly") {
        f.t += delta;
        const pr = Math.min(f.t / f.dur, 1);
        applyTween(f, easeIO(pr));
        // Start the panel on the first dolly frame, after applying the camera move.
        if (!f.panelShown) {
          f.panelShown = true;
          onChange({ panelOpen: true });
        }
        if (pr >= 1) f.phase = "hold";
      } else if (f.phase === "hold" || f.phase === "panelOut") {
        holdView(f); // locked on the work, dead steady
        if (f.phase === "panelOut") {
          f.t += delta;
          if (f.t >= (f.wait ?? 0)) startReturn(); // panel leads, camera follows it out
        }
      } else if (f.phase === "return") {
        f.t += delta;
        const pr = Math.min(f.t / f.dur, 1);
        applyTween(f, easeIO(pr)); // reverse glide to the click POV
        if (pr >= 1) {
          state = "playing";
          needsResume =
            !isTouch &&
            !pointerLockFallback &&
            document.pointerLockElement !== canvas;
          onChange({ mode: "playing", needsResume });
          yaw = savedView.yaw;
          pitch = savedView.pitch;
          targetFov = savedView.fov;
          focus = null;
        }
      }
    } else if (state === "intro") {
      cinematic(reducedMotion ? 0 : t);
    }

    updateHover();
    for (const a of arts) {
      const active =
        hovered === a || (focus && focus.rec === a && focus.phase !== "return");
      a.liftTarget = active ? 1 : 0;
      a.lift += (a.liftTarget - a.lift) * (1 - Math.exp(-9 * dt));
      a.group.position.copy(a.basePos).addScaledVector(a.normal, a.lift * 0.07);
      for (const L of a.lights)
        L.s.intensity = L.base * spotScale * (1 + a.lift * 0.55);
    }
    if (sculpt && !reducedMotion) {
      sculpt.rotation.y += dt * 0.18;
      sculpt.rotation.x = Math.sin(t * 0.1) * 0.12;
      sculpt.position.y = 1.52 + Math.sin(t * 0.7) * 0.01;
    }
    if (ready) {
      if (!reducedMotion) outsideElapsed += delta;
      outside?.update(lighting, lightingMinutes, outsideElapsed);
    }
    // Keep the background clear while fonts load; do not draw partly built
    // materials before shader warmup completes. RAF/UI updates keep running.
    if (ready || !built) {
      if (sculpt && !reducedMotion && renderedFrame % 2 === 0)
        renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      renderedFrame++;
      if (state === "paused" && now >= pausedUntil) pausedFrameRendered = true;
    }
  }
  animate();

  function reframeFocus() {
    if (!focus || focus.phase === "return" || focus.phase === "panelOut")
      return;
    const targets = focusTargets(focus.rec, true);
    focus.to = {
      yaw: targets.toYaw,
      pitch: targets.toPitch,
      fov: FOCUS_FOV,
      pos: targets.toPos,
    };
    if (focus.phase === "hold") holdView(focus);
    else {
      focus.dur = Math.max(0.01, focus.dur - focus.t);
      focus.t = 0;
      focus.from = livePose();
      focus.dYaw = shortestYaw(focus.to.yaw, viewYaw);
    }
  }
  const panelObserver = new ResizeObserver(reframeFocus);
  panelObserver.observe(panelEl);
  removeListeners.push(() => panelObserver.disconnect());

  listen(window, "resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    pausedFrameRendered = false; // setSize clears the canvas; redraw once if paused
    reframeFocus();
  });

  /* wait for the display fonts — but never let a hanging request keep
   the door locked                                            */
  let fontsReady: Promise<unknown> = Promise.resolve();
  try {
    const jobs = [
      "300 120px Fraunces",
      "italic 300 120px Fraunces",
      "400 120px Fraunces",
      "600 120px Fraunces",
      '400 40px "Space Grotesk"',
      '500 40px "Space Grotesk"',
    ].map((f) =>
      document.fonts.load(f, "THE WHITE ROOM Aa & N° fi Q §").catch(() => {}),
    );
    fontsReady = Promise.all(jobs)
      .then(() => document.fonts.ready)
      .catch(() => {});
  } catch (e) {}
  const fontTimeout = setTimeout(build, 3000);
  fontsReady.then(() => {
    clearTimeout(fontTimeout);
    if (disposed) return;
    if (!built) {
      void build();
      return;
    }
    // Fonts may arrive after the bounded first build. Repaint the font specimen
    // so a cold-cache visit and subsequent reloads produce identical artwork.
    for (const rec of arts) {
      if (rec.p.gen !== "type" || artImages.has(rec.idx) || !rec.texture)
        continue;
      const border = rec.p.featured ? 0.062 : 0.046;
      const artCanvas = makeArtCanvas(
        rec.p,
        rec.idx,
        rec.p.w - 2 * border,
        rec.p.h - 2 * border,
      );
      rec.texture.image = artCanvas;
      rec.texture.needsUpdate = true;
      rec.canvas = artCanvas;
      rec.thumb = "";
      if (focus?.rec === rec) fillPanel(rec);
    }
    onChange({ ready });
  });

  return {
    suspend: (hidden) => {
      suspended = hidden;
      if (!hidden) {
        previousTime = performance.now();
        resetResolutionWindow();
        pausedFrameRendered = false;
      }
    },
    start: () => {
      if (ready && state !== "playing") startPlay();
    },
    menu: () => {
      if (state === "focus") exitFocus();
      else pauseGame();
    },
    thumbnail,
    resume: resumeLook,
    close: exitFocus,
    step: stepFocus,
    dispose: () => {
      disposed = true;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      cancelAnimationFrame(animationFrame);
      finishBuildYield?.();
      clearTimeout(toastTimer);
      clearTimeout(fontTimeout);
      for (const cancel of pendingImages) cancel();
      artImages.clear();
      outside?.dispose();
      for (const remove of removeListeners) remove();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            materials.add(material);
            for (const value of Object.values(material)) {
              if (value instanceof THREE.Texture) textures.add(value);
            }
          }
        }
        if (object instanceof THREE.Light && "shadow" in object) {
          (object.shadow as THREE.LightShadow).dispose();
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      textures.delete(environmentTarget.texture);
      for (const texture of textures) texture.dispose();
      environmentTarget.dispose();
      renderer.dispose();
      scene.clear();
    },
  };
}
