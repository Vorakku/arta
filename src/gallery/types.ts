import type * as THREE from "three";
import type { Project } from "./projects";

export type GalleryMode = "intro" | "playing" | "paused" | "focus";
export interface Artwork {
  p: Project;
  idx: number;
  group: THREE.Group;
  normal: THREE.Vector3;
  basePos: THREE.Vector3;
  lift: number;
  liftTarget: number;
  lights: { s: THREE.SpotLight; base: number }[];
  thumb: string;
  canvas: HTMLCanvasElement | null;
  texture: THREE.CanvasTexture | null;
}
export interface Pose {
  yaw: number;
  pitch: number;
  fov: number;
  pos: THREE.Vector3;
}
export interface FocusMove {
  rec: Artwork;
  phase: "dolly" | "hold" | "panelOut" | "return";
  t: number;
  dur: number;
  panelShown: boolean;
  from: Pose;
  to: Pose;
  dYaw: number;
  wait?: number;
}
export interface Hover {
  project: Project;
  index: number;
  far: boolean;
  cta: string;
}
export interface SelectedProject {
  project: Project;
  index: number;
  thumbnail: string;
}
export interface GalleryUI {
  mode: GalleryMode;
  isTouch: boolean;
  ready: boolean;
  error: boolean;
  focused: boolean;
  panelOpen: boolean;
  selected: SelectedProject | null;
  hover: Hover | null;
  toast: string;
  needsResume: boolean;
}
export interface GalleryController {
  suspend: (hidden: boolean) => void;
  start: () => void;
  menu: () => void;
  resume: () => void;
  close: () => void;
  step: (direction: number) => void;
  thumbnail: (index: number) => string | undefined;
  dispose: () => void;
}
export interface GalleryElements {
  canvas: HTMLCanvasElement;
  panel: HTMLElement;
  stick: HTMLDivElement;
  stickNub: HTMLDivElement;
}
