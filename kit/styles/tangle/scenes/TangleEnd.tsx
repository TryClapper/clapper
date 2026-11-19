import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { CircleCheck, Zap } from "lucide-react";
import { SceneShell } from "../lib/SceneShell";
import { ease, enter } from "../lib/motion";
import { brand } from "../lib/spec";
import { Glow } from "../lib/fx";
import { CtaBackdrop, BrandMark } from "../lib/handoff";
import { EDGES, NODES, NODE_W, NODE_H, NodeCard, center, cubicAt, cubicD, tangledPath } from "../lib/tangle";

// Callback for the Tangle opening (between App and Cta). Opens on the CTA backdrop App's wipe revealed.
// The same nine parts come back in the same tangle; the product drops into the middle; the parts glide into a ring
// around it, the tangled wires dissolve and clean spokes draw from the product to each part; a green pulse runs
// down every spoke and each part is marked tested. Title answers the opening ("…takes one platform."), the chip
// answers "26 people · 140 test calls a week". Everything folds back into the middle and leaves the bare
// backdrop for Cta's first frame.
export const T = { nodes: 0, hub: 36, title: 30, ring: [62, 140] as const, spokes: [96, 146] as const, pulse: 150, chip: 132, out: [292, 322] as const };
const HUB = { cx: 960, cy: 572, w: 330, h: 96 };
const RING = (i: number) => { const a = -Math.PI / 2 + (i / NODES.length) * Math.PI * 2 + 0.17; return { x: HUB.cx + Math.cos(a) * 650, y: HUB.cy + Math.sin(a) * 330 }; };

export const TangleEnd: React.FC<{ title: [string, string]; chip: string }> = ({ title, chip }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ring = ease(f, T.ring[0], T.ring[1], 0, 1), spokes = ease(f, T.spokes[0], T.spokes[1], 0, 1);
  const out = ease(f, T.out[0], T.out[1], 0, 1), gone = out > 0.999;
  const pos = (i: number) => { const a = center(i), b = RING(i); return { x: a.x + (b.x - a.x) * ring, y: a.y + (b.y - a.y) * ring }; };
  const fold = (p: { x: number; y: number }) => ({ x: p.x + (HUB.cx - p.x) * out * out, y: p.y + (HUB.cy - p.y) * out * out });
  const hub = enter(f, fps, T.hub);
  if (gone) return <SceneShell push={[1, 1]} noExit><CtaBackdrop /></SceneShell>;

  return (
    <SceneShell push={[1, 1]} noExit>
      <CtaBackdrop />
      <div style={{ position: "absolute", inset: 0, opacity: 1 - out }}>
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
          {/* the old tangle, dissolving */}
          {EDGES.map(([a, b, s], i) => <path key={i} d={cubicD(tangledPath(fold(pos(a)), fold(pos(b)), s * (1 - ring)))} fill="none" stroke="#9AA0AC" strokeWidth={1.8} opacity={0.7 * ease(f, 0, 14, 0, 1) * (1 - ease(f, T.ring[0], T.ring[0] + 50, 0, 1))} />)}
          {/* clean spokes from the product */}
          {NODES.map((_, i) => {
            const A = fold({ x: HUB.cx, y: HUB.cy }), B = fold(pos(i)), P = [A, { x: A.x + (B.x - A.x) * 0.33, y: A.y + (B.y - A.y) * 0.33 }, { x: A.x + (B.x - A.x) * 0.66, y: A.y + (B.y - A.y) * 0.66 }, B];
            const p = ease(f, T.pulse + i * 6, T.pulse + i * 6 + 22, 0, 1), head = cubicAt(P, p);
            return (
              <g key={i}>
                <path d={cubicD(P)} fill="none" stroke={p >= 1 ? brand.pass : "#B9BFCB"} strokeWidth={2.4} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - spokes} />
                {p > 0 && p < 1 && <><circle cx={head.x} cy={head.y} r={16} fill="rgba(20,184,166,0.2)" /><circle cx={head.x} cy={head.y} r={7} fill={brand.pass} /></>}
              </g>
            );
          })}
        </svg>
        {NODES.map((_, i) => {
          const p = fold(pos(i)), q = enter(f, fps, T.nodes + i * 2), ok = ease(f, T.pulse + i * 6 + 20, T.pulse + i * 6 + 30, 0, 1);
          return (
            <NodeCard key={i} i={i} x={p.x - NODE_W / 2} y={p.y - NODE_H / 2} opacity={Math.min(1, q * 1.6)} scale={(0.85 + 0.15 * q) * (1 - 0.6 * out)} ok={ok}
              badge={ok > 0 ? <span style={{ marginLeft: "auto", display: "inline-flex", opacity: ok, transform: `scale(${0.5 + 0.5 * ok})` }}><CircleCheck size={22} color={brand.pass} /></span> : undefined} />
          );
        })}
        {/* the product in the middle */}
        <Glow x={HUB.cx} y={HUB.cy} r={300} color={`${brand.accent}33`} frame={f} p={hub} />
        {f >= T.hub && (
          <div style={{ position: "absolute", left: HUB.cx - HUB.w / 2, top: HUB.cy - HUB.h / 2, width: HUB.w, height: HUB.h, borderRadius: 24, background: brand.fg, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 18, fontFamily: brand.font, fontSize: 38, fontWeight: 800, letterSpacing: -1,
            boxShadow: `0 30px 70px -30px ${brand.accent}AA`, opacity: Math.min(1, hub * 1.5), transform: `translateY(${(1 - hub) * -60}px) scale(${0.8 + 0.2 * hub})` }}>
            <BrandMark size={44} color="#fff" />Acme
          </div>
        )}
        {/* the answers to the opening's title and chip */}
        <div style={{ position: "absolute", left: 110, top: 70, fontFamily: brand.font, fontSize: 64, fontWeight: 800, letterSpacing: -2.2, lineHeight: 1.08, color: brand.fg }}>
          {title.map((line, li) => {
            const q = enter(f, fps, T.title + li * 26);
            return <div key={li} style={{ opacity: f < T.title + li * 26 ? 0 : Math.min(1, q * 1.5), transform: `translateY(${(1 - q) * 30}px)` }}>
              {li ? <span style={{ background: `linear-gradient(90deg, ${brand.accent}, ${brand.accent2})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{line}</span> : line}</div>;
          })}
        </div>
        {f >= T.chip && (
          <div style={{ position: "absolute", right: 110, top: 90, display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 999, padding: "12px 22px",
            boxShadow: "0 14px 30px -18px rgba(17,24,39,0.35)", fontFamily: brand.font, fontSize: 24, fontWeight: 700, color: brand.fg, transform: `scale(${0.8 + 0.2 * enter(f, fps, T.chip)})`, opacity: enter(f, fps, T.chip) }}>
            <Zap size={22} color={brand.pass} />{chip}
          </div>
        )}
      </div>
    </SceneShell>
  );
};
