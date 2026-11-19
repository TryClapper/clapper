import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ArrowDown, CircleX, Sparkle, Stamp } from "lucide-react";
import { SceneShell } from "../lib/SceneShell";
import { ease, enter, shake } from "../lib/motion";
import { brand } from "../lib/spec";
import { Blur } from "../lib/fx";
import { ExitToProduct, LightStage, Punch } from "../lib/exit";
import { QUESTION, QuestionCard, THOUGHTS, TH_EDGES, TH_H, ThoughtCard, bend, cubicD, thC, thW } from "../lib/thoughts";

// Claude.ai opening · "a tangle of thoughts".
// A hard question types itself. Everything you'd have to weigh hangs around it, wired together in a mess.
// WHY it's hard: a quick answer slides in — "10 tips for expanding to Europe" — confident and generic. It reaches for
// your thoughts and misses each one (it never asked about your runway, never saw the pilot churn, assumed a big team).
// WHAT it leads to: a decision made on a good-enough answer, and what that costs. Punch, then the shared exit.
export const T = { q: [8, 52] as const, nodes: 62, edges: 86, ans: 214, tips: 236, miss: [338, 368, 398], decide: [446, 506, 566], punch: 646, exit: 770 };
const ANS = { x: 1380, y: 210, w: 470 };
const MISS: [number, string][] = [[0, "never asked"], [2, "never saw it"], [1, "assumed a big team"]];

export const ThinkTangle: React.FC<{ tips: string[]; chain: [string, string][]; punchPre: string; punchEm: string }> = ({ tips, chain, punchPre, punchEm }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = Math.round(ease(f, T.q[0], T.q[1], 0, QUESTION.length));
  const back = ease(f, T.punch - 8, T.punch + 10, 0, 1); // everything steps back for the punch line
  const aq = enter(f, fps, T.ans), aqV = f >= T.ans ? (1 - enter(f, fps, T.ans)) * 600 - (1 - enter(f - 1, fps, T.ans)) * 600 : 0;

  const tangle = (
    <>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {TH_EDGES.map(([a, b, s], i) => {
          const p = ease(f, T.edges + i * 6, T.edges + i * 6 + 40, 0, 1), wob = Math.sin(f * 0.03 + i) * 18;
          return <path key={i} d={cubicD(bend(thC(a), thC(b), s + wob))} fill="none" stroke={i % 4 === 1 ? "#E9A07A" : "#ABA69B"} strokeWidth={1.8} pathLength={1} strokeDasharray={i % 4 === 1 ? "0.012 0.012" : "1 1"} strokeDashoffset={1 - p} opacity={0.85} />;
        })}
        {/* the quick answer reaching for your thoughts and missing */}
        {MISS.map(([n], k) => {
          const at = T.miss[k] - 22; if (f < at) return null;
          const A = { x: ANS.x, y: ANS.y + 120 + k * 40 }, B = thC(n), P = [A, { x: A.x - 200, y: A.y - 60 }, { x: B.x + 200, y: B.y - 80 }, B];
          const p = ease(f, at, T.miss[k], 0, 1);
          return <path key={k} d={cubicD(P)} fill="none" stroke={brand.danger} strokeWidth={2.4} strokeDasharray="8 8" pathLength={undefined} opacity={0.7 * Math.min(1, p * 3)}
            style={{ strokeDashoffset: -f * 0.8 }} clipPath={undefined} strokeLinecap="round" />;
        })}
      </svg>
      {THOUGHTS.map(([, , x, y], i) => {
        const at = T.nodes + i * 9, q = enter(f, fps, at), k = MISS.findIndex(([n]) => n === i), bad = k >= 0 ? ease(f, T.miss[k], T.miss[k] + 8, 0, 1) : 0;
        const dx = Math.sin(f * 0.02 + i * 1.7) * 6, dy = Math.cos(f * 0.024 + i) * 5;
        return (
          <div key={i} style={{ transform: bad > 0 ? shake(f, T.miss[k], 5, 0.15) : undefined }}>
            <ThoughtCard i={i} x={x + dx} y={y + dy} opacity={f < at ? 0 : Math.min(1, q * 1.5)} scale={0.85 + 0.15 * q} bad={bad}
              badge={bad > 0 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4, background: brand.danger, color: "#fff", borderRadius: 999, padding: "3px 10px", fontSize: 15, fontWeight: 700, transform: `scale(${0.6 + 0.4 * bad})` }}><CircleX size={15} />{MISS[k][1]}</span> : undefined} />
          </div>
        );
      })}
      <QuestionCard shown={shown} caret={f < T.q[1] + 30} frame={f} />
    </>
  );

  // the quick answer: confident, generic, instant
  const answer = f >= T.ans && (
    <Blur id="ans" vx={aqV} k={0.3} style={{ position: "absolute", left: ANS.x + (1 - aq) * 600, top: ANS.y, width: ANS.w }}>
      <div style={{ background: "#fff", borderRadius: 20, boxShadow: "0 30px 60px -30px rgba(31,30,29,0.5), 0 0 0 1px rgba(31,30,29,0.06)", padding: "18px 22px", fontFamily: brand.font, color: brand.fg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, color: brand.muted, fontWeight: 600 }}><Sparkle size={18} color="#8C8C8C" />Quick answer · 2 sec
          <span style={{ marginLeft: "auto", background: brand.tint, borderRadius: 999, padding: "3px 10px", fontSize: 14 }}>Sounds right</span></div>
        <div style={{ fontSize: 23, fontWeight: 800, marginTop: 10, letterSpacing: -0.5 }}>10 tips for expanding to Europe</div>
        {tips.map((t, i) => {
          const at = T.tips + i * 7; if (f < at) return null;
          return <div key={t} style={{ fontSize: 18, color: brand.muted, marginTop: 7, opacity: ease(f, at, at + 6, 0, 1) }}>{i + 1}. {t}</div>;
        })}
      </div>
    </Blur>
  );

  // what a good-enough answer leads to
  const consequence = (
    <div style={{ position: "absolute", left: ANS.x, top: 610, width: ANS.w, display: "flex", flexDirection: "column", alignItems: "stretch", fontFamily: brand.font }}>
      {chain.map(([title, sub], i) => {
        const at = T.decide[i]; if (f < at) return null;
        const q = enter(f, fps, at), last = i === chain.length - 1;
        return (
          <div key={title} style={{ opacity: Math.min(1, q * 1.5) }}>
            {i > 0 && <div style={{ display: "flex", justifyContent: "center", height: 30, alignItems: "center" }}><ArrowDown size={22} color={brand.danger} /></div>}
            <div style={{ display: "flex", alignItems: "center", gap: 14, borderRadius: 16, padding: "14px 18px", transform: `translateY(${(1 - q) * 24}px) ${last ? shake(f, at, 7, 0.2) : ""}`,
              background: last ? brand.danger : "#fff", color: last ? "#fff" : brand.fg, border: last ? "none" : "1.5px solid #FCA5A5", boxShadow: "0 16px 30px -20px rgba(220,38,38,0.6)" }}>
              {i === 0 && <Stamp size={22} color={brand.danger} />}
              <div><div style={{ fontSize: 21, fontWeight: 800 }}>{title}</div><div style={{ fontSize: 16, opacity: 0.8 }}>{sub}</div></div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <SceneShell push={[1, 1]} noExit>
      <LightStage frame={f} />
      <ExitToProduct frame={f} at={T.exit}>
        <div style={{ position: "absolute", inset: 0, opacity: 1 - 0.82 * back, filter: back > 0.01 ? `blur(${back * 3}px)` : undefined }}>
          {tangle}
          {answer}
          {consequence}
        </div>
        <Punch frame={f} fps={fps} at={T.punch} pre={punchPre} em={punchEm} y={470} />
      </ExitToProduct>
    </SceneShell>
  );
};
