import { Color, Vector3 } from "three";

const DAY = 1440;
const wrap = (minutes: number) => ((minutes % DAY) + DAY) % DAY;

// Cambodia has no daylight saving; conversion never uses the host time zone.
export const cambodiaMinutes = (ms = Date.now()) => wrap(ms / 60000 + 420);

export function parseClockOverrides(search: string) {
  const query = new URLSearchParams(search);
  const time = query.get("time") ?? "";
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const minutes =
    match && Number(match[1]) < 24 && Number(match[2]) < 60
      ? Number(match[1]) * 60 + Number(match[2])
      : undefined;
  const rawSpeed = query.get("speed");
  const speed =
    rawSpeed !== null &&
    rawSpeed.trim() !== "" &&
    Number.isFinite(Number(rawSpeed)) &&
    Number(rawSpeed) >= 0
      ? Number(rawSpeed)
      : undefined;
  return { minutes, speed };
}

// Inputs are explicit so overrides, elapsed time and wrapping are unit-testable.
// speed=0 pins screenshots; time without speed advances at the normal rate.
export function createLightingClock(search: string, startMs: number) {
  const { minutes, speed } = parseClockOverrides(search);
  const startMinutes = minutes ?? cambodiaMinutes(startMs);
  if (minutes === undefined && speed === undefined) return cambodiaMinutes;
  return (ms: number) =>
    wrap(startMinutes + ((ms - startMs) / 60000) * (speed ?? 1));
}

export const COLOR_PARAMETERS = [
  "hemisphereSky",
  "hemisphereGround",
  "ceilingColor",
  "spotColor",
  "skyZenith",
  "skyHorizon",
  "sunColor",
  "cloudColor",
  "palmColor",
] as const;
export const NUMBER_PARAMETERS = [
  "hemisphereIntensity",
  "ceilingScale",
  "spotScale",
  "envScale",
  "exposure",
  "cloudCover",
  "starOpacity",
] as const;
export type LightingPeriod = "morning" | "afternoon" | "night";
type Colors = (typeof COLOR_PARAMETERS)[number];
type Numbers = (typeof NUMBER_PARAMETERS)[number];
export type Lighting = Record<Colors, Color> &
  Record<Numbers, number> & { period: LightingPeriod };

export const LOOKS = {
  morning: {
    skyZenith: 0x9fb4c8,
    skyHorizon: 0xefe6d3,
    sunColor: 0xfff1d6,
    cloudColor: 0xf6f3ec,
    cloudCover: 0.35,
    starOpacity: 0,
    palmColor: 0x5b6253,
    hemisphereSky: 0xf1f4fc,
    hemisphereGround: 0xd6d3cc,
    hemisphereIntensity: 1,
    ceilingColor: 0xf5f7ff,
    ceilingScale: 0.9,
    spotColor: 0xfff4e6,
    spotScale: 1,
    envScale: 0.95,
    exposure: 1.12,
  },
  afternoon: {
    skyZenith: 0x8aa2b8,
    skyHorizon: 0xe9e6dc,
    sunColor: 0xfffaf0,
    cloudColor: 0xfbfaf6,
    cloudCover: 0.3,
    starOpacity: 0,
    palmColor: 0x4f584a,
    hemisphereSky: 0xfff6e6,
    hemisphereGround: 0xd9d4cb,
    hemisphereIntensity: 1.1,
    ceilingColor: 0xfff6e8,
    ceilingScale: 1,
    spotColor: 0xfff0da,
    spotScale: 1,
    envScale: 1,
    exposure: 1.16,
  },
  golden: {
    skyZenith: 0x8c8aa6,
    skyHorizon: 0xe9b07a,
    sunColor: 0xffb766,
    cloudColor: 0xf2c49c,
    cloudCover: 0.4,
    starOpacity: 0,
    palmColor: 0x3a302a,
    hemisphereSky: 0xffe3c2,
    hemisphereGround: 0xd8cbb9,
    hemisphereIntensity: 0.9,
    ceilingColor: 0xffe2c0,
    ceilingScale: 0.8,
    spotColor: 0xffe8cc,
    spotScale: 1.05,
    envScale: 0.85,
    exposure: 1.1,
  },
  night: {
    skyZenith: 0x0d1220,
    skyHorizon: 0x222b3d,
    sunColor: 0xcfd8ea,
    cloudColor: 0x1d2433,
    cloudCover: 0.25,
    starOpacity: 1,
    palmColor: 0x0c0f14,
    hemisphereSky: 0x5f6a86,
    hemisphereGround: 0x2a2621,
    hemisphereIntensity: 0.28,
    ceilingColor: 0xffd6a0,
    ceilingScale: 0.35,
    spotColor: 0xffe6c4,
    spotScale: 1.25,
    envScale: 0.35,
    exposure: 1,
  },
} as const;

export const KEYFRAMES = [
  { minutes: 0, look: "night" },
  { minutes: 300, look: "night" },
  { minutes: 390, look: "morning" },
  { minutes: 660, look: "morning" },
  { minutes: 780, look: "afternoon" },
  { minutes: 990, look: "afternoon" },
  { minutes: 1065, look: "golden" },
  { minutes: 1140, look: "night" },
  { minutes: 1440, look: "night" },
] as const;

// Convert sRGB anchors once. Color.lerpColors then blends in linear working space.
const anchors = KEYFRAMES.map(({ minutes, look }) => {
  const values = LOOKS[look];
  return {
    minutes,
    values,
    colors: Object.fromEntries(
      COLOR_PARAMETERS.map((key) => [key, new Color(values[key])]),
    ) as Record<Colors, Color>,
  };
});

// Supplying a target reuses its Colors and parameter object, including on holds.
export function lightingAt(minutes: number, target?: Lighting): Lighting {
  const m = wrap(minutes);
  const out = target ?? {
    hemisphereSky: new Color(),
    hemisphereGround: new Color(),
    ceilingColor: new Color(),
    spotColor: new Color(),
    skyZenith: new Color(),
    skyHorizon: new Color(),
    sunColor: new Color(),
    cloudColor: new Color(),
    palmColor: new Color(),
    cloudCover: 0,
    starOpacity: 0,
    hemisphereIntensity: 0,
    ceilingScale: 0,
    spotScale: 0,
    envScale: 0,
    exposure: 0,
    period: "night",
  };
  let index = 0;
  while (index < anchors.length - 2 && m >= anchors[index + 1].minutes) index++;
  const from = anchors[index],
    to = anchors[index + 1];
  const fraction = (m - from.minutes) / (to.minutes - from.minutes);
  const blend = fraction * fraction * (3 - 2 * fraction);
  for (const key of NUMBER_PARAMETERS)
    out[key] = from.values[key] + (to.values[key] - from.values[key]) * blend;
  for (const key of COLOR_PARAMETERS)
    out[key].lerpColors(from.colors[key], to.colors[key], blend);
  out.period =
    m >= 300 && m < 720
      ? "morning"
      : m >= 720 && m < 1080
        ? "afternoon"
        : "night";
  return out;
}

export function sameLighting(a: Lighting, b: Lighting) {
  return (
    NUMBER_PARAMETERS.every((key) => a[key] === b[key]) &&
    COLOR_PARAMETERS.every((key) => a[key].equals(b[key]))
  );
}

// Both arcs are continuous across their horizons and midnight. +x is east,
// +z is south; the noon elevation is 78 degrees (12 degrees south of zenith).
const SOUTH_TILT = Math.PI / 15;
export function sunDirection(minutes: number, target: Vector3) {
  const arc = ((wrap(minutes) - 360) / 720) * Math.PI;
  return target.set(
    Math.cos(arc),
    Math.sin(arc) * Math.cos(SOUTH_TILT),
    Math.sin(arc) * Math.sin(SOUTH_TILT),
  );
}
export function moonDirection(minutes: number, target: Vector3) {
  const phase = wrap(minutes - 1110);
  // Eleven hours above the horizon, thirteen below; the endpoints stay continuous.
  const arc =
    phase <= 660
      ? (phase / 660) * Math.PI
      : Math.PI + ((phase - 660) / 780) * Math.PI;
  return target.set(
    Math.cos(arc),
    Math.sin(arc) * Math.cos(SOUTH_TILT),
    Math.sin(arc) * Math.sin(SOUTH_TILT),
  );
}
