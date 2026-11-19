import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { CircleCheck, Clock3 } from "lucide-react";
import { SceneShell } from "../lib/SceneShell";
import { ease, enter } from "../lib/motion";
import { brand } from "../lib/spec";
import { Glow } from "../lib/fx";
import { BrandMark, CtaBackdrop } from "../lib/handoff";
import { QUESTION, QuestionCard, THOUGHTS, TH_EDGES, TH_H, ThoughtCard, bend, cubicAt, cubicD, thC } from "../lib/thoughts";

// Callback for the ThinkTangle opening (between the product scene and the CTA). Opens on the CTA backdrop.
// The same question and the same tangled thoughts come back. This time they get thought through: the tangle lets go,
// the thoughts line up in a column, the two that don't matter yet are ruled out ("later"), and green lines run from
// every thought that counts into one decision. Then everything fades to the bare backdrop for the CTA's first frame.
export const T = { in: 0, sort: [44, 110] as const, out1: 104, lines: [118, 168] as const, decision: 150, check: (k: number) => 126 + k * 6, title: 168, out: [292, 322] as const };
const ORDER = [2, 0, 1, 3, 4, 8, 6, 5, 7]; // column order: what matters most first
const LATER = new Set([5, 7]);
const COL = (i: number) => ({ x: 170, y: 262 + ORDER.indexOf(i) * 78 });
const DEC = { x: 1180, y: 430, w: 600, h: 250 };

export const ThinkEnd: React.FC<{ decision: string; why: string; meta: string }> = ({ decision, why, meta }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = ease(f, T.out[0], T.out[1], 0, 1);
  if (out > 0.999) return <SceneShell push={[1, 1]} noExit><CtaBackdrop /></SceneShell>;
  const s = ease(f, T.sort[0], T.sort[1], 0, 1);
  const pos = (i: number) => { const [, , x, y] = THOUGHTS[i], c = COL(i); return { x: x + (c.x - x) * s, y: y + (c.y - y) * s }; };
  const center = (i: number) => { const p = pos(i); return { x: p.x + (thC(i).x - THOUGHTS[i][2]), y: p.y + TH_H / 2 }; };
  const dq = enter(f, fps, T.decision);
  const target = { x: DEC.x, y: DEC.y + DEC.h / 2 };

  return (
    <SceneShell push={[1, 1]} noExit>
      <CtaBackdrop />
      <div style={{ position: "absolute", inset: 0, opacity: 1 - out }}>
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
          {/* the old tangle lets go */}
          {TH_EDGES.map(([a, b, sb], i) => <path key={i} d={cubicD(bend(center(a), center(b), sb * (1 - s)))} fill="none" stroke="#ABA69B" strokeWidth={1.8} opacity={0.8 * ease(f, 0, 14, 0, 1) * (1 - ease(f, T.sort[0], T.sort[0] + 40, 0, 1))} />)}
          {/* every thought that counts runs into the decision */}
          {ORDER.filter((i) => !LATER.has(i)).map((i, k) => {
            const A = { x: COL(i).x + (thC(i).x - THOUGHTS[i][2]) * 2 - 4, y: COL(i).y + TH_H / 2 }, B = target;
            const P = [A, { x: A.x + 260, y: A.y }, { x: B.x - 260, y: B.y }, B];
            const p = ease(f, T.lines[0] + k * 4, T.lines[1] + k * 4, 0, 1), head = cubicAt(P, p);
            return (
              <g key={i}>
                <path d={cubicD(P)} fill="none" stroke={brand.pass} strokeWidth={2.4} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} opacity={0.8} />
                {p > 0 && p < 1 && <circle cx={head.x} cy={head.y} r={6} fill={brand.pass} />}
              </g>
            );
          })}
        </svg>
        {THOUGHTS.map((_, i) => {
          const p = pos(i), q = enter(f, fps, T.in + i * 2), k = ORDER.filter((n) => !LATER.has(n)).indexOf(i);
          const ok = k >= 0 ? ease(f, T.check(k), T.check(k) + 8, 0, 1) : 0, later = LATER.has(i) ? ease(f, T.out1, T.out1 + 12, 0, 1) : 0;
          return (
            <ThoughtCard key={i} i={i} x={p.x} y={p.y} opacity={Math.min(1, q * 1.6)} scale={0.85 + 0.15 * q} ok={ok} out={later}
              badge={ok > 0 ? <span style={{ display: "inline-flex", opacity: ok, transform: `scale(${0.5 + 0.5 * ok})` }}><CircleCheck size={20} color={brand.pass} /></span>
                : later > 0 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4, background: brand.tint, color: brand.muted, borderRadius: 999, padding: "3px 10px", fontSize: 15, fontWeight: 700, opacity: later }}><Clock3 size={14} />later</span> : undefined} />
          );
        })}
        <QuestionCard shown={QUESTION.length} frame={f} opacity={Math.min(1, enter(f, fps, 0) * 1.6)} />
        {/* the decision */}
        <Glow x={DEC.x + DEC.w / 2} y={DEC.y + DEC.h / 2} r={380} color={`${brand.pass}26`} frame={f} p={dq} />
        {f >= T.decision && (
          <div style={{ position: "absolute", left: DEC.x, top: DEC.y, width: DEC.w, height: DEC.h, borderRadius: 26, background: "#fff", boxShadow: `0 0 0 2px ${brand.pass}, 0 40px 80px -36px rgba(31,30,29,0.5)`,
            fontFamily: brand.font, color: brand.fg, padding: "28px 34px", boxSizing: "border-box", opacity: Math.min(1, dq * 1.5), transform: `scale(${0.85 + 0.15 * dq})`, transformOrigin: "left center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: brand.mono, fontSize: 15, fontWeight: 700, color: brand.passDark, letterSpacing: 1 }}><BrandMark size={22} color={brand.fg} />DECISION · THOUGHT THROUGH WITH CLAUDE</div>
            <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2.2, marginTop: 14 }}>{decision}</div>
            <div style={{ fontSize: 21, color: brand.muted, marginTop: 8, lineHeight: 1.4 }}>{why}</div>
          </div>
        )}
        {f >= T.title && (
          <div style={{ position: "absolute", left: DEC.x, top: DEC.y + DEC.h + 26, fontFamily: brand.font, fontSize: 19, fontWeight: 600, color: brand.muted, opacity: ease(f, T.title, T.title + 12, 0, 1) }}>{meta}</div>
        )}
      </div>
    </SceneShell>
  );
};
