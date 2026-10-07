export type ArtworkStyle =
  | "rothko"
  | "flow"
  | "bauhaus"
  | "halftone"
  | "mondrian"
  | "horizon"
  | "type"
  | "arcs"
  | "feature";

export interface Project {
  title: string;
  year: number;
  tag: string;
  url: string;
  desc: string;
  gen: ArtworkStyle;
  w: number;
  h: number;
  featured?: boolean;
  image?: string;
}

// Edit these nine entries to hang your own projects in the original room layout.
export const PROJECTS: readonly Project[] = [
  {
    title: "Meridian",
    year: 2024,
    tag: "Interactive essay",
    url: "https://example.com/projects/meridian",
    desc: "An interactive essay that follows a single line of longitude from the Arctic ice to the equatorial doldrums. Sections drift between satellite imagery, journal fragments and a soundtrack that slows as the latitude does.",
    gen: "rothko",
    w: 1.55,
    h: 1.95,
  },
  {
    title: "Field Notes",
    year: 2023,
    tag: "Data visualisation",
    url: "https://example.com/projects/field-notes",
    desc: "A visualisation of three years of observational data — weather, birdsong, tide — collected from one monitoring station. Every mark on the canvas is a real reading; the pattern is the place.",
    gen: "flow",
    w: 1.45,
    h: 1.1,
  },
  {
    title: "Kiosk",
    year: 2024,
    tag: "Web experiment",
    url: "https://example.com/projects/kiosk",
    desc: "A self-contained experiment about waiting in line. Visitors join a queue that only exists in the browser and are served one page at a time, in order, until their number is called.",
    gen: "bauhaus",
    w: 1.25,
    h: 1.25,
  },
  {
    title: "Slow Signal",
    year: 2022,
    tag: "Generative audio",
    url: "https://example.com/projects/slow-signal",
    desc: "Generative audio broadcast at a fixed tempo of forty beats per minute. Each visitor hears a different rendering of the same seed, so no two listens — and no two recordings — are ever alike.",
    gen: "halftone",
    w: 1.3,
    h: 1.3,
  },
  {
    title: "Archive 09",
    year: 2023,
    tag: "Digital collection",
    url: "https://example.com/projects/archive-09",
    desc: "The ninth release of an ongoing digital collection: 2,400 scanned documents, cross-linked by hand and published as a browsable archive with a full-text search index.",
    gen: "mondrian",
    w: 1.1,
    h: 1.45,
  },
  {
    title: "Nocturne",
    year: 2024,
    tag: "WebGL short film",
    url: "https://example.com/projects/nocturne",
    desc: "A short film rendered in real time in WebGL. Nothing is pre-recorded — every frame is computed on your machine, so the version you watch belongs to your hardware and the hour you watched it.",
    gen: "horizon",
    w: 1.85,
    h: 1.15,
  },
  {
    title: "Typecast",
    year: 2023,
    tag: "Variable font study",
    url: "https://example.com/projects/typecast",
    desc: "A study of one variable typeface pushed to its extremes. The specimen responds to cursor velocity — letter-spacing and weight breathe between 200 and 900 as you move.",
    gen: "type",
    w: 1.05,
    h: 1.4,
  },
  {
    title: "Umbra",
    year: 2022,
    tag: "Installation view",
    url: "https://example.com/projects/umbra",
    desc: "Documentation of a physical installation: two projectors, a rotating scrim and a room that never gets fully dark. This is the interactive reconstruction of the piece.",
    gen: "arcs",
    w: 1.5,
    h: 1.5,
  },
  {
    title: "The Door in the Wall",
    year: 2025,
    tag: "Featured project",
    url: "https://example.com/projects/door",
    desc: "Featured project, 2025. A wandering narrative told across forty linked pages. Doors open where you least expect them — the way out is also the way further in.",
    gen: "feature",
    w: 3.3,
    h: 2.05,
    featured: true,
  },
];
