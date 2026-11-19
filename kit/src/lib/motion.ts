// Shared motion vocabulary. Scenes call these instead of hand-rolling easing,
// so the house style lives in one place and fixes are one-liners.
import { Easing, interpolate, spring } from "remotion";

export const ENTER = 30; // ~0.5 s at 60 fps
export const EXIT = 18; // ~60% of entrance
export const STAGGER = 3; // frames between grouped elements

/** 0 → 1 with a slight overshoot (spring, damping ~14). */
export const enter = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120, mass: 1 } });

/** 0 → 1 ease-in, for exits (faster than entrances). */
export const exit = (frame: number, start: number, dur = EXIT) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** Easy-ease for camera moves. */
export const ease = (frame: number, from: number, to: number, a: number, b: number) =>
  interpolate(frame, [from, to], [a, b], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** Nothing ever fully stops: slow scale drift around 1. */
export const drift = (frame: number, amount = 0.02, period = 240) =>
  1 + amount * 0.5 * (1 - Math.cos((2 * Math.PI * frame) / period));

/** Count-up/down over ~1 s, ease-out, never jumps. */
export const count = (frame: number, start: number, from: number, to: number, dur = 60) =>
  Math.round(
    interpolate(frame, [start, start + dur], [from, to], {
      easing: Easing.out(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

/** Point on a quadratic-bezier arc (control offset ~15% of the distance) — cursor paths. */
export const arc = (
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  t: number
) => {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const c = { x: (p0.x + p1.x) / 2 - (dy / len) * len * 0.15, y: (p0.y + p1.y) / 2 + (dx / len) * len * 0.15 };
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
};

/** Click press: scale 1 → 0.96 → 1 over ~8 frames. */
export const press = (frame: number, at: number) =>
  interpolate(frame, [at, at + 4, at + 8], [1, 0.96, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** Problem emphasis: a hard jolt on impact (first 14 frames), then `sustain` of it keeps vibrating. Use `sustain`
 *  0 for things that pile up (each settles still before the next lands); keep a sustain for one lone item. */
export const shake = (frame: number, start: number, amp = 6, sustain = 0.35) => {
  if (frame < start) return "none";
  const t = frame - start;
  const k = t < 14 ? 1 - (t / 14) * (1 - sustain) : sustain;
  const x = (Math.sin(frame * 2.9) * 0.7 + Math.sin(frame * 5.3) * 0.3) * amp * k;
  const y = Math.sin(frame * 3.7) * amp * 0.4 * k;
  const r = Math.sin(frame * 4.1) * amp * 0.25 * k;
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(2)}deg)`;
};

/** A click that feels physical: press down (scale 0.93, +2px, darker), hold, spring back past 1, settle.
 *  `dark` drives the pressed shade/inner shadow; `ripple` (0→1, or -1 when idle) drives the ripple. */
export const pressFx = (frame: number, at: number) => {
  const t = frame - at;
  if (t < -3 || t > 24) return { scale: 1, y: 0, dark: 0, ripple: -1, squish: 1 };
  const c = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
  return {
    scale: interpolate(t, [-3, 2, 6, 13, 20], [1, 0.93, 0.93, 1.03, 1], c),
    y: interpolate(t, [-3, 2, 6, 12], [0, 2, 2, 0], c),
    dark: interpolate(t, [-3, 2, 8, 14], [0, 1, 1, 0], c),
    ripple: t >= 1 && t <= 22 ? (t - 1) / 21 : -1,
    squish: interpolate(t, [-3, 1, 7], [1, 0.84, 1], c),
  };
};
