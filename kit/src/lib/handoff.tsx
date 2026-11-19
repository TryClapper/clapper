// Connected cuts. Anything that is on screen on BOTH sides of a cut is drawn by the same component, at the
// same screen position, so the last frame of one scene and the first frame of the next are pixel-identical
// (check with `node scripts/kit.mjs seams`). The default chain in the kit:
//   Hook  ──morph──▶  ProblemStack  ──implode → mark → dark wipe──▶  ProductDemo  ──circle wipe──▶  Cta
//   (call card shrinks      (pile + copy pulled into the       (mark lands on the sidebar logo   (the result point
//    into problem card 0)    brand mark; dark stage opens)       while the window builds in 3D)    opens the CTA)
import React from "react";
import { AbsoluteFill } from "remotion";
import { D, NAV_LOGO } from "./product";
import { brand } from "./spec";
import { Tilt3D } from "./fx";

/** The brand mark, built from separate pieces so it can assemble (`parts`: one offset per piece).
 *  Replace the three bars with the client's own logo shapes (keep 3–4 pieces). Used for the hand-off
 *  and as the sidebar logo, so both are the same drawing. */
export const BrandMark: React.FC<{ size: number; color?: string; parts?: { x: number; y: number; r: number; o: number }[] }> = ({ size, color = D.text, parts }) => {
  const u = size / 24;
  const bars = [[3, 4, 18], [3, 10.5, 13], [3, 17, 8]] as const; // x, y, width (in a 24-unit box), bar height 3.5
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible", display: "block" }}>
      {bars.map(([x, y, w], i) => {
        const pt = parts?.[i] ?? { x: 0, y: 0, r: 0, o: 1 };
        return <rect key={i} x={x * u} y={y * u} width={w * u} height={3.5 * u} rx={1.75 * u} fill={color} opacity={pt.o}
          transform={`translate(${pt.x} ${pt.y}) rotate(${pt.r} ${(x + w / 2) * u} ${(y + 1.75) * u})`} />;
      })}
    </svg>
  );
};

/** Product stage (dark canvas, dot grid, two glows). ProductDemo's background and the ProblemStack wipe both use it. */
export const DarkStage: React.FC<{ frame: number }> = ({ frame }) => (
  <AbsoluteFill style={{ background: D.stage }}>
    <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1.2px, transparent 1.6px)", backgroundSize: "30px 30px", backgroundPosition: `${-frame * 0.15}px 0` }} />
    <AbsoluteFill style={{ background: "radial-gradient(60% 50% at 22% -8%, rgba(74,222,128,0.16), transparent 70%), radial-gradient(50% 45% at 92% 110%, rgba(139,147,255,0.12), transparent 70%)" }} />
  </AbsoluteFill>
);

/** CTA backdrop (light brand background + two glows). Cta draws it, and ProductDemo's closing wipe reveals it. */
export const CtaBackdrop: React.FC = () => (
  <AbsoluteFill style={{ background: brand.bg, overflow: "hidden" }}>
    <div style={{ position: "absolute", width: 900, height: 900, left: 200, top: -200, borderRadius: "50%", background: `radial-gradient(closest-side, ${brand.accent}30, transparent)`, filter: "blur(40px)" }} />
    <div style={{ position: "absolute", width: 900, height: 900, right: 150, bottom: -300, borderRadius: "50%", background: `radial-gradient(closest-side, ${brand.accent2}26, transparent)`, filter: "blur(40px)" }} />
  </AbsoluteFill>
);

/** 3D only while something builds in; flat afterwards, so text stays razor sharp under camera zooms. */
export const Build3D: React.FC<{ p: number; frame: number; origin: string; rx?: number; ry?: number; z?: number; children: React.ReactNode }> = ({ p, frame, origin, rx = 12, ry = -8, z = -220, children }) =>
  p < 1 ? <Tilt3D p={p} frame={frame} rx={rx} ry={ry} z={z} float={false} origin={origin} style={{ position: "absolute", inset: 0 }}>{children}</Tilt3D> : <>{children}</>;

/** Rect interpolation for morphs (a card becoming another card, a tile becoming a page). */
export type Rect = { x: number; y: number; w: number; h: number };
export const lerpRect = (a: Rect, b: Rect, e: number): Rect => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, w: a.w + (b.w - a.w) * e, h: a.h + (b.h - a.h) * e });

// Hand-off geometry (screen px). The sidebar logo spot comes from the product layout constants.
const M = 88, CH = 52, LOGO = 26;
export const MARK = { cx: 960, cy: 540, size: 150 };                                   // the mark between ProblemStack and ProductDemo
export const SIDEBAR_LOGO = { x: M + 14 + 8, y: M + CH + (NAV_LOGO - LOGO) / 2, size: LOGO }; // where Sidebar draws its logo
export const LEAD = 30;                                                                // frames ProductDemo spends building the window around the mark
