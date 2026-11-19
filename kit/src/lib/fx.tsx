// Cinematic motion helpers (generic): motion blur from velocity, 3D tilt-in, glow, mesh backdrop with
// grain, circle wipe, follow-camera keyframes, and a homography to place UI onto a photo's screen.
import React from "react";
import { AbsoluteFill } from "remotion";
import { ease } from "./motion";

/** Directional motion blur. Pass the element's velocity in px/frame; blur scales with speed. */
export const Blur: React.FC<{ id: string; vx?: number; vy?: number; k?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ id, vx = 0, vy = 0, k = 0.45, children, style }) => {
  const sx = Math.min(60, Math.abs(vx) * k), sy = Math.min(60, Math.abs(vy) * k);
  const on = sx > 0.3 || sy > 0.3;
  return (
    <div style={{ ...style, filter: on ? `url(#${id})` : undefined }}>
      {on && <svg width="0" height="0" style={{ position: "absolute" }}><filter id={id} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`} /></filter></svg>}
      {children}
    </div>
  );
};

/** 3D entrance: starts tilted back and to the side with depth, settles flat, then floats ±1°. p: 0→1. */
export const Tilt3D: React.FC<{ p: number; frame: number; rx?: number; ry?: number; z?: number; float?: boolean; origin?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ p, frame, rx = 16, ry = -14, z = -260, float = true, origin = "50% 50%", children, style }) => {
  const f = float ? p : 0;
  const frx = (1 - p) * rx + Math.sin(frame / 70) * 0.9 * f, fry = (1 - p) * ry + Math.cos(frame / 85) * 1.1 * f;
  return (
    <div style={{ perspective: 1800, perspectiveOrigin: "50% 40%", ...style }}>
      <div style={{ transformStyle: "preserve-3d", transformOrigin: origin, transform: `translateZ(${(1 - p) * z}px) rotateX(${frx}deg) rotateY(${fry}deg)`, opacity: Math.min(1, p * 2.2) }}>{children}</div>
    </div>
  );
};

/** Soft radial glow that breathes. Put it behind what matters right now. */
export const Glow: React.FC<{ x: number; y: number; r: number; color: string; p?: number; frame: number }> = ({ x, y, r, color, p = 1, frame }) => (
  <div style={{ position: "absolute", left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: "50%", pointerEvents: "none",
    background: `radial-gradient(closest-side, ${color}, transparent)`, opacity: p * (0.75 + 0.25 * Math.sin(frame * 0.12)), transform: `scale(${0.9 + 0.1 * Math.sin(frame * 0.09)})` }} />
);

/** Animated mesh-gradient backdrop with film grain: warmth and texture instead of a flat colour. */
export const Mesh: React.FC<{ frame: number; base: string; blobs: [string, number, number, number][]; grain?: number; style?: React.CSSProperties }> = ({ frame, base, blobs, grain = 0.07, style }) => (
  <AbsoluteFill style={{ background: base, overflow: "hidden", ...style }}>
    {blobs.map(([c, x, y, r], i) => (
      <div key={i} style={{ position: "absolute", left: `${x + Math.sin(frame / (90 + i * 17) + i) * 4}%`, top: `${y + Math.cos(frame / (110 + i * 13) + i) * 4}%`, width: r, height: r,
        transform: "translate(-50%,-50%)", borderRadius: "50%", background: `radial-gradient(closest-side, ${c}, transparent)`, filter: "blur(30px)" }} />
    ))}
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: grain, mixBlendMode: "multiply" }}>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={Math.floor(frame / 2) % 50} /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  </AbsoluteFill>
);

/** Circle wipe revealing `children` from (x, y). p: 0→1. */
export const Wipe: React.FC<{ x: number; y: number; p: number; children: React.ReactNode }> = ({ x, y, p, children }) => (
  <AbsoluteFill style={{ clipPath: `circle(${p * 2300}px at ${x}px ${y}px)` }}>{children}</AbsoluteFill>
);

/** Follow camera from keyframes [frame, focusX, focusY, zoom]; eased between keys. Returns a CSS transform. */
export type CamKey = [number, number, number, number];
export const camAt = (frame: number, keys: CamKey[]) => {
  let v = keys[keys.length - 1].slice(1) as number[];
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, ...a] = keys[i], [f1, ...b] = keys[i + 1];
    if (frame <= f1) { const k = ease(frame, f0, f1, 0, 1); v = a.map((x, j) => x + (b[j] - x) * k); break; }
  }
  const [fx, fy, z] = v;
  return { fx, fy, z, transform: `translate(${960 - fx * z}px, ${540 - fy * z}px) scale(${z})` };
};

/** CSS matrix3d that maps a w × h element (origin 0 0) onto four points [tl, tr, br, bl]. */
export const quadMatrix = (w: number, h: number, q: [number, number][]) => {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [], B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let c = 0; c < 8; c++) { // Gaussian elimination
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
  }
  const [a, b, c, d, e, f, g, hh] = B.map((x, i) => x / A[i][i]);
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
};
