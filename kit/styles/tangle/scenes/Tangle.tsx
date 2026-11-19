import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BrainCircuit, MicOff, PhoneOff, ShieldAlert, Timer, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SceneShell } from "../lib/SceneShell";
import { ease, enter, shake } from "../lib/motion";
import { brand } from "../lib/spec";
import { Persona, Wave } from "../lib/ui";
import { ExitToProduct, LightStage, Punch } from "../lib/exit";
import { CURSOR_COLORS, CursorTag, EDGES, NODES, NodeCard, ROLES, center, cubicAt, cubicD, rnd, tangledPath } from "../lib/tangle";

// Variant A · "the tangle".
// WHY it's hard: every part of a voice agent wired together in a mess; a crowd of people clicking around it by hand.
// WHAT it leads to (told inside the tangle, no pile): the crowd freezes and fades — nobody caught it. The view pulls
// back and the customer appears on the right, on a call. Each failure starts in the part where it happens (that part
// turns red and names it), then runs as a red pulse along a wire straight into the customer, landing on its word in
// the VO; the customer jolts and the consequence + its cost stacks up under them. Punch line, then the shared exit.
export const T = { title: 14, nodes: 20, edges: 34, crowd: 40, stat: 196, back: 228, cust: 252, land: [414, 492, 555, 576, 594], punch: 640, exit: 770 };
const SRC = [3, 1, 6, 7, 4]; // refund policy → hallucination, speech-to-text → dead air, transfer → dropped call, TTS → latency, CRM → PII
const ICON: LucideIcon[] = [BrainCircuit, MicOff, PhoneOff, Timer, ShieldAlert];
const N = 26;
const VIEW = { s: 0.74, x: 20, y: 170 }; // where the tangle sits once the customer comes in
const CUST = { x: 1470, y: 210, w: 410 };
const HIT = { x: CUST.x, y: CUST.y + 66 };

type Hit = [string, string, string]; // failure, what the customer got, what it costs
export const Tangle: React.FC<{ title: [string, string]; stat: string; customer: string; hits: Hit[]; total: string; punchPre: string; punchEm: string }> = ({ title, stat, customer, hits, total, punchPre, punchEm }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const push = 1 + 0.03 * Math.min(1, f / T.back) ** 1.5;
  const k = ease(f, T.back, T.back + 40, 0, 1);
  const S = push + (VIEW.s - push) * k, X = 960 * (1 - push) + (VIEW.x - 960 * (1 - push)) * k, Y = 540 * (1 - push) + (VIEW.y - 540 * (1 - push)) * k;
  const toScreen = (p: { x: number; y: number }) => ({ x: X + p.x * S, y: Y + p.y * S });
  const crowdOut = ease(f, T.back, T.back + 26, 0, 1);
  const start = (i: number) => T.land[i] - (i < 3 ? 50 : 26);

  const tangle = (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${X}px, ${Y}px) scale(${S})` }}>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {EDGES.map(([a, b, s, dashed], i) => {
          const d = cubicD(tangledPath(center(a), center(b), s)), p = ease(f, T.edges + i * 7, T.edges + i * 7 + 40, 0, 1), dim = 1 - 0.45 * k;
          return dashed
            ? <path key={i} d={d} fill="none" stroke="#E8A06A" strokeWidth={2} strokeDasharray="7 8" opacity={p * 0.9 * dim} />
            : <path key={i} d={d} fill="none" stroke="#9AA0AC" strokeWidth={1.8} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} opacity={0.8 * dim} />;
        })}
      </svg>
      {NODES.map(([, , x, y], i) => {
        const q = enter(f, fps, T.nodes + i * 6), fi = SRC.indexOf(i), red = fi >= 0 ? ease(f, start(fi) - 12, start(fi) - 2, 0, 1) : 0;
        return (
          <div key={i} style={{ transform: fi >= 0 && f >= start(fi) - 12 ? shake(f, start(fi) - 12, 5, 0.25) : undefined }}>
            <NodeCard i={i} x={x} y={y} opacity={f < T.nodes + i * 6 ? 0 : Math.min(1, q * 1.5)} scale={0.85 + 0.15 * q} tone={red} />
            {red > 0 && (
              <div style={{ position: "absolute", left: x + 135, top: y - 46, transform: `translateX(-50%) scale(${0.6 + 0.4 * red})`, opacity: red, whiteSpace: "nowrap", background: brand.danger, color: "#fff",
                borderRadius: 999, padding: "6px 14px", fontFamily: brand.font, fontSize: 20, fontWeight: 700 }}>{hits[fi][0]}</div>
            )}
          </div>
        );
      })}
      {Array.from({ length: N }, (_, i) => {
        const at = T.crowd + i * 5.5;
        if (f < at || crowdOut >= 1) return null;
        const q = enter(f, fps, at), fr = Math.min(f, T.back); // the crowd freezes when it all goes wrong
        const bx = 180 + rnd(i) * 1560, by = 250 + rnd(i + 50) * 700, w1 = 0.011 + rnd(i + 9) * 0.012, w2 = 0.017 + rnd(i + 19) * 0.014;
        const x = bx + Math.sin(fr * w1 + i) * 110 + Math.sin(fr * w2 + i * 2.3) * 60, y = by + Math.cos(fr * w1 * 0.9 + i * 1.7) * 70 + Math.sin(fr * w2 * 1.1 + i) * 40;
        return <CursorTag key={i} x={x} y={y} color={CURSOR_COLORS[i % CURSOR_COLORS.length]} label={`${ROLES[i % ROLES.length]} ${i + 1}`} opacity={Math.min(1, q * 1.6) * (1 - crowdOut)} scale={0.6 + 0.4 * q} />;
      })}
    </div>
  );

  const cq = enter(f, fps, T.cust);
  const hitShake = T.land.reduce((a, L) => (f >= L && f < L + 20 ? L : a), -1);
  return (
    <SceneShell push={[1, 1]} noExit>
      <LightStage frame={f} />
      <ExitToProduct frame={f} at={T.exit}>
        {tangle}
        {/* title + stat (top), until the consequences take over */}
        <div style={{ position: "absolute", left: 110, top: 70, opacity: 1 - ease(f, T.back, T.back + 14, 0, 1), fontFamily: brand.font, fontSize: 64, fontWeight: 800, letterSpacing: -2.2, lineHeight: 1.08, color: brand.fg }}>
          {title.map((line, li) => { const q = enter(f, fps, T.title + li * 26); return <div key={li} style={{ opacity: f < T.title + li * 26 ? 0 : Math.min(1, q * 1.5), transform: `translateY(${(1 - q) * 30}px)`, color: li ? brand.danger : brand.fg }}>{line}</div>; })}
        </div>
        {f >= T.stat && f < T.back + 16 && (
          <div style={{ position: "absolute", right: 110, top: 90, opacity: 1 - ease(f, T.back, T.back + 14, 0, 1), display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 999, padding: "12px 22px",
            boxShadow: "0 14px 30px -18px rgba(17,24,39,0.35)", fontFamily: brand.font, fontSize: 24, fontWeight: 700, color: brand.fg, transform: `scale(${0.8 + 0.2 * enter(f, fps, T.stat)})` }}>
            <Users size={22} color={brand.accent} />{stat}
          </div>
        )}
        {/* the pulses: from the part that failed, along a wire, into the customer */}
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
          {SRC.map((n, i) => {
            if (f < start(i)) return null;
            const A = toScreen(center(n)), B = HIT, P = [A, { x: A.x + 260, y: A.y - 120 }, { x: B.x - 240, y: B.y + 60 }, B];
            const p = ease(f, start(i), T.land[i], 0, 1) ** 1.6, head = cubicAt(P, p);
            return (
              <g key={i}>
                <path d={cubicD(P)} fill="none" stroke={brand.danger} strokeWidth={3} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} opacity={0.75} strokeLinecap="round" />
                {p < 1 && <><circle cx={head.x} cy={head.y} r={18} fill="rgba(220,38,38,0.18)" /><circle cx={head.x} cy={head.y} r={8} fill={brand.danger} /></>}
              </g>
            );
          })}
        </svg>
        {/* the customer, on a call */}
        {f >= T.cust && (
          <div style={{ position: "absolute", left: CUST.x, top: CUST.y, width: CUST.w, opacity: Math.min(1, cq * 1.5), transform: `translateX(${(1 - cq) * 60}px) ${hitShake >= 0 ? shake(f, hitShake, 8, 0) : ""}` }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "16px 20px", boxShadow: `0 0 0 ${hitShake >= 0 ? 3 : 0}px #FCA5A5, 0 24px 50px -22px rgba(17,24,39,0.4)`, fontFamily: brand.font, color: brand.fg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Persona name={customer} size={58} bg="#FDE68A" />
                <div><div style={{ fontFamily: brand.mono, fontSize: 15, color: brand.muted }}>YOUR CUSTOMER</div><div style={{ fontSize: 26, fontWeight: 800 }}>{customer} · on a call</div></div>
              </div>
              <div style={{ marginTop: 10 }}><Wave frame={f} width={370} height={30} color={f >= T.land[0] ? brand.danger : brand.accent} bars={30} /></div>
            </div>
            {/* what reached them, and what it cost */}
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {hits.map(([name, got, cost], i) => {
                if (f < T.land[i]) return null;
                const q = enter(f, fps, T.land[i]), Icon = ICON[i];
                return (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1.5px solid #FCA5A5", borderRadius: 14, padding: "10px 14px", fontFamily: brand.font,
                    opacity: Math.min(1, q * 1.6), transform: `translateX(${(1 - q) * -40}px) scale(${0.9 + 0.1 * q})`, boxShadow: "0 12px 26px -18px rgba(220,38,38,0.5)" }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: brand.dangerTint, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={18} color={brand.danger} /></span>
                    <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 18, fontWeight: 800, color: brand.fg }}>{name}</div><div style={{ fontSize: 15, color: brand.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{got}</div></div>
                    <span style={{ flexShrink: 0, fontSize: 16, fontWeight: 800, color: brand.danger }}>{cost}</span>
                  </div>
                );
              })}
              {f >= T.land[4] + 12 && (
                <div style={{ marginTop: 4, textAlign: "right", fontFamily: brand.font, fontSize: 19, fontWeight: 800, color: brand.danger, opacity: enter(f, fps, T.land[4] + 12) }}>{total}</div>
              )}
            </div>
          </div>
        )}
        <Punch frame={f} fps={fps} at={T.punch} pre={punchPre} em={punchEm} y={44} />
      </ExitToProduct>
    </SceneShell>
  );
};
