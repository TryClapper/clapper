// Shared exit for every problem-scene variant: the whole scene implodes into the product's mark, then a dark
// circle wipe opens the product stage. Its last frame equals App's first frame (mark centred on DarkStage).
// Scene length must be `at + 40`.
import React from "react";
import { interpolateColors } from "remotion";
import { ease } from "./motion";
import { brand } from "./spec";
import { D } from "./product";
import { Blur, Glow, Wipe } from "./fx";
import { DarkStage, MARK, BrandMark } from "./handoff";

const SCATTER = [{ x: -180, y: -140, r: -50 }, { x: 200, y: -170, r: 60 }, { x: -220, y: 170, r: 40 }, { x: 190, y: 200, r: -70 }];

export const ExitToProduct: React.FC<{ frame: number; at: number; children: React.ReactNode; origin?: [number, number] }> = ({ frame, at, children, origin = [960, 540] }) => {
  const imp = (f: number) => ease(f, at, at + 20, 0, 1) ** 2;
  const k = imp(frame), kv = (imp(frame) - imp(frame - 1)) * 900;
  const part = (i: number) => { const q = ease(frame, at + 6 + i * 3, at + 22 + i * 3, 0, 1); return { x: SCATTER[i].x * (1 - q), y: SCATTER[i].y * (1 - q), r: SCATTER[i].r * (1 - q), o: Math.min(1, q * 2) }; };
  const wipe = ease(frame, at + 20, at + 40, 0, 1);
  const markColor = interpolateColors(ease(frame, at + 20, at + 26, 0, 1), [0, 1], [brand.fg, D.text]);
  const [ox, oy] = origin;
  return (
    <>
      <Blur id="exitImplode" vx={kv * 0.5} vy={kv * 0.3} style={{ position: "absolute", inset: 0, opacity: 1 - ease(frame, at + 14, at + 20, 0, 1),
        transform: `translate(${(MARK.cx - ox) * k}px, ${(MARK.cy - oy) * k}px) scale(${1 - 0.92 * k}) rotate(${-36 * k}deg)`, transformOrigin: `${ox}px ${oy}px` }}>
        {children}
      </Blur>
      {frame >= at + 20 && <Wipe x={MARK.cx} y={MARK.cy} p={wipe}><DarkStage frame={0} /></Wipe>}
      {frame >= at + 2 && <Glow x={MARK.cx} y={MARK.cy} r={260} color="rgba(139,147,255,0.30)" frame={frame} p={ease(frame, at + 6, at + 22, 0, 1) * (1 - wipe)} />}
      {frame >= at + 6 && (
        <div style={{ position: "absolute", left: MARK.cx - MARK.size / 2, top: MARK.cy - MARK.size / 2 }}>
          <BrandMark size={MARK.size} color={markColor} parts={[0, 1, 2, 3].map(part)} />
        </div>
      )}
    </>
  );
};

/** Light backdrop for the problem scenes: brand off-white, faint dot grid, two soft brand glows. */
export const LightStage: React.FC<{ frame: number; dots?: boolean }> = ({ frame, dots = true }) => (
  <div style={{ position: "absolute", inset: 0, background: brand.bg, overflow: "hidden" }}>
    {dots && <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(17,24,39,0.10) 1.2px, transparent 1.6px)", backgroundSize: "28px 28px" }} />}
    <div style={{ position: "absolute", width: 1100, height: 1100, right: -260 + Math.sin(frame * 0.004) * 40, top: -520, borderRadius: "50%", background: `radial-gradient(closest-side, ${brand.accent}22, transparent)`, filter: "blur(40px)" }} />
    <div style={{ position: "absolute", width: 1000, height: 1000, left: -300, bottom: -560 + Math.cos(frame * 0.004) * 40, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(251,146,60,0.16), transparent)", filter: "blur(40px)" }} />
  </div>
);

// ---------- consequences: the failures fall out of the mess and pile up, each with what it costs ----------
import { BrainCircuit, MicOff, PhoneOff, ShieldAlert, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { enter, shake } from "./motion";
import { IconTile } from "./ui";

export const FAIL_ICONS: Record<string, LucideIcon> = { brain: BrainCircuit, mic: MicOff, phone: PhoneOff, timer: Timer, shield: ShieldAlert };
export type Failure = [string, string, string, string]; // name, icon key, sample, what it costs
const SLOT: [number, number, number][] = [[-24, 0, -3], [40, -114, 3], [-40, -226, -4], [28, -340, 3], [-16, -452, -3]]; // uneven, each name still readable
const PILE_X = 960, PILE_Y = 930, CARD_W = 700, CARD_H = 104;
const slotCenter = (i: number) => ({ x: PILE_X + SLOT[i][0], y: PILE_Y + SLOT[i][1] });

/** Each card pops out of `from[i]` (where that failure happens in the scene), falls with motion blur into the
 *  pile and lands at `land[i]` with a jolt, then settles still; cards below get a small bump. Space the
 *  `land` frames ≥ 26 apart so each card settles before the next one falls. */
export const FailurePile: React.FC<{ frame: number; fps: number; items: Failure[]; land: number[]; from?: [number, number][] }> = ({ frame, fps, items, land, from }) => (
  <>
    {items.map(([name, icon, sample, cost], i) => {
      const L = land[i], start = L - 18;
      if (frame < start) return null;
      const o = from?.[i] ?? [slotCenter(i).x + (i % 2 ? 160 : -160), -160];
      const t = (fr: number) => ease(fr, start, L, 0, 1);
      const k = t(frame), g = k * k; // gravity: accelerate into the pile
      const s = slotCenter(i);
      const x = o[0] + (s.x - o[0]) * k, y = o[1] + (s.y - o[1]) * g - Math.sin(k * Math.PI) * 120;
      const px = o[0] + (s.x - o[0]) * t(frame - 1), py = o[1] + (s.y - o[1]) * t(frame - 1) ** 2 - Math.sin(t(frame - 1) * Math.PI) * 120;
      const bump = land.slice(i + 1).reduce((a, Lj) => { const d = frame - Lj; return a + (d > 0 && d < 10 ? Math.sin((d / 10) * Math.PI) * 3 : 0); }, 0);
      const pop = enter(frame, fps, start);
      return (
        <Blur key={name} id={`fall${i}`} vx={x - px} vy={y - py} k={0.3} style={{ position: "absolute", left: x - CARD_W / 2, top: y - CARD_H / 2 + bump, width: CARD_W, zIndex: 10 + i,
          transform: `rotate(${SLOT[i][2] * k + (1 - k) * (i % 2 ? 14 : -14)}deg) scale(${0.45 + 0.55 * Math.min(1, pop)})` }}>
          <div style={{ transform: shake(frame, L, 7, 0), height: CARD_H, boxSizing: "border-box", background: "#fff", borderRadius: 22, border: "2px solid #FCA5A5",
            boxShadow: "0 24px 50px -20px rgba(220,38,38,0.38), 0 2px 0 rgba(17,24,39,0.04)", padding: "0 22px", display: "flex", gap: 18, alignItems: "center", fontFamily: brand.font, color: brand.fg }}>
            <IconTile Icon={FAIL_ICONS[icon]} color={brand.danger} tint={brand.dangerTint} size={60} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8, whiteSpace: "nowrap" }}>{name}</div>
              <div style={{ fontFamily: brand.mono, fontSize: 18, color: brand.danger, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sample}</div>
            </div>
            <div style={{ flexShrink: 0, background: brand.dangerTint, color: brand.danger, borderRadius: 999, padding: "8px 16px", fontSize: 19, fontWeight: 700, whiteSpace: "nowrap" }}>{cost}</div>
          </div>
        </Blur>
      );
    })}
  </>
);

/** The bill, counting up as failures land: "This week · 63 bad calls · $18,400 refunded · 2 compliance incidents". */
export const CostTicker: React.FC<{ frame: number; fps: number; land: number[]; calls: number; refunds: number; incidents: number; label?: string }> = ({ frame, fps, land, calls, refunds, incidents, label = "This week" }) => {
  if (frame < land[0] - 14) return null;
  const q = enter(frame, fps, land[0] - 14);
  const nCalls = frame < land[0] ? 0 : Math.round(12 + (calls - 12) * ease(frame, land[0], land[land.length - 1], 0, 1));
  const nRef = Math.round(refunds * ease(frame, land[0], land[0] + 30, 0, 1));
  const nInc = frame >= land[land.length - 1] ? incidents : 0;
  const seg = (v: string, txt: string, at: number) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, transform: shake(frame, at, 4, 0) }}><b style={{ color: brand.danger, fontVariantNumeric: "tabular-nums" }}>{v}</b><span style={{ color: brand.muted, fontWeight: 600 }}>{txt}</span></span>
  );
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 96, display: "flex", justifyContent: "center", opacity: Math.min(1, q * 1.4), transform: `translateY(${(1 - q) * -24}px)`, zIndex: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 26, background: "#fff", borderRadius: 999, padding: "16px 30px", boxShadow: "0 18px 40px -20px rgba(17,24,39,0.35), 0 0 0 1px rgba(17,24,39,0.05)",
        fontFamily: brand.font, fontSize: 26, fontWeight: 800, color: brand.fg }}>
        <span style={{ fontFamily: brand.mono, fontSize: 18, fontWeight: 500, color: brand.muted, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
        {seg(String(nCalls), "bad calls", land[land.length - 1])}
        <span style={{ width: 1, height: 26, background: brand.line }} />
        {seg(`$${nRef.toLocaleString("en-US")}`, "refunded", land[0])}
        <span style={{ width: 1, height: 26, background: brand.line }} />
        {seg(String(nInc), "compliance incidents", land[land.length - 1])}
      </div>
    </div>
  );
};

/** Punch line over the pile. */
export const Punch: React.FC<{ frame: number; fps: number; at: number; out?: number; pre: string; em: string; y?: number }> = ({ frame, fps, at, out = 1e9, pre, em, y = 300 }) => {
  if (frame < at) return null;
  const q = enter(frame, fps, at), o = ease(frame, out, out + 10, 0, 1);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, textAlign: "center", fontFamily: brand.font, fontSize: 66, fontWeight: 800, letterSpacing: -2.4, color: brand.fg, zIndex: 31,
      opacity: Math.min(1, q * 1.5) * (1 - o), transform: `translateY(${(1 - q) * 30 - o * 20}px)` }}>
      {pre} <span style={{ display: "inline-block", color: brand.danger, transform: shake(frame, at + 10, 6) }}>{em}</span>
    </div>
  );
};

/** Wrap the setup so it steps back (dims, blurs) when the consequences take over. */
export const StepBack: React.FC<{ frame: number; at: number; children: React.ReactNode }> = ({ frame, at, children }) => {
  const d = ease(frame, at, at + 22, 0, 1);
  return <div style={{ position: "absolute", inset: 0, opacity: 1 - 0.62 * d, filter: d > 0.01 ? `blur(${d * 4}px)` : undefined, transform: `scale(${1 - 0.03 * d})` }}>{children}</div>;
};
