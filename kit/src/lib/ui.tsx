// Shared visual parts: gradient text, labels, cards, avatars, icon tiles, waveform, cursor, typed text,
// and the product-tour callout (Tour). Colours come from video.json brand.
import React from "react";
import { brand } from "./spec";
import { createAvatar } from "@dicebear/core";
import { notionists } from "@dicebear/collection";
import type { LucideIcon } from "lucide-react";


export const GRAD = `linear-gradient(135deg, ${brand.accent}, ${brand.accent2})`;

/** Indigo→purple gradient text, as on the site's hero. */
export const Grad: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ backgroundImage: GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", ...style }}>{children}</span>
);

export const Mono: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ fontFamily: brand.mono, fontWeight: 500, ...style }}>{children}</span>
);

/** Uppercase mono eyebrow. */
export const Label: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({ children, color = brand.muted, style }) => (
  <div style={{ fontFamily: brand.mono, fontSize: 20, fontWeight: 500, letterSpacing: 2, textTransform: "uppercase", color, ...style }}>{children}</div>
);

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: brand.surface, borderRadius: 24, border: `1.5px solid ${brand.line}`,
    boxShadow: "0 1px 2px rgba(17,24,39,0.04), 0 30px 70px -30px rgba(17,24,39,0.22)", ...style }}>{children}</div>
);

export const Avatar: React.FC<{ name: string; size?: number; color?: string }> = ({ name, size = 52, color = brand.accent }) => (
  <div style={{ width: size, height: size, borderRadius: size / 2, background: color, color: "#fff", flexShrink: 0, display: "flex",
    alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700 }}>{name[0]}</div>
);

export const Pill: React.FC<{ children: React.ReactNode; ok?: boolean; style?: React.CSSProperties }> = ({ children, ok, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 22, fontWeight: 700, borderRadius: 999, padding: "8px 16px",
    color: ok ? brand.passDark : brand.danger, background: ok ? "#CCFBF1" : brand.dangerTint, whiteSpace: "nowrap", ...style }}>{children}</span>
);

export const Wave: React.FC<{ frame: number; width: number; height: number; color: string; bars?: number; amp?: number }> = ({ frame, width, height, color, bars = 40, amp = 1 }) => (
  <svg width={width} height={height}>
    {Array.from({ length: bars }, (_, i) => {
      const n = 0.5 + 0.28 * Math.sin(i * 0.9 + frame * 0.23) + 0.17 * Math.sin(i * 2.3 - frame * 0.37) + 0.05 * Math.sin(i * 5.1 + frame * 0.5);
      const h = Math.max(3, height * Math.sin((Math.PI * (i + 0.5)) / bars) * n * amp);
      const g = width / bars;
      return <rect key={i} x={i * g + g * 0.2} y={(height - h) / 2} width={g * 0.6} height={h} rx={g * 0.3} fill={color} />;
    })}
  </svg>
);

export const Cursor: React.FC<{ x: number; y: number; scale?: number; light?: boolean }> = ({ x, y, scale = 1, light }) => (
  <svg width="44" height="44" viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y, transform: `scale(${scale})`, transformOrigin: "0 0", filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.25))" }}>
    <path d="M3 2l7.5 19 2.6-8.1L21 10.2z" fill={light ? "#F5F7FA" : "#111827"} stroke={light ? "#0B0F16" : "#fff"} strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

/** Text typed up to `shown` chars; `bad` phrase gets a wipe highlight (0→1) in `hl` color. */
export const TypeLine: React.FC<{ text: string; shown: number; bad?: string; hl?: number; color?: string; tint?: string; caret?: boolean; jitter?: string }> = ({ text, shown, bad, hl = 0, color = brand.danger, tint = brand.dangerTint, caret, jitter }) => {
  const i = bad ? text.indexOf(bad) : -1;
  const vis = text.slice(0, shown);
  if (i < 0 || shown <= i) return <>{vis}{caret && <Caret />}</>;
  const mid = vis.slice(i, i + bad!.length);
  return (
    <>
      {vis.slice(0, i)}
      <span style={{ backgroundImage: `linear-gradient(${tint}, ${tint})`, backgroundRepeat: "no-repeat", backgroundSize: `${hl * 100}% 100%`,
        borderRadius: 6, color: hl > 0.4 ? color : undefined, fontWeight: hl > 0.4 ? 800 : undefined, padding: "0 4px", margin: "0 -4px",
        display: jitter ? "inline-block" : undefined, transform: jitter }}>{mid}</span>
      {vis.slice(i + bad!.length)}
      {caret && <Caret />}
    </>
  );
};
const Caret = () => <span style={{ display: "inline-block", width: 3, height: "1em", background: brand.accent, verticalAlign: "-0.12em", marginLeft: 2 }} />;

// ---- Illustration, icons, annotation ----

const AV: Record<string, string> = {};
/** Illustrated persona avatar (DiceBear "notionists", CC0), deterministic per name. */
export const Persona: React.FC<{ name: string; size?: number; bg?: string; style?: React.CSSProperties }> = ({ name, size = 64, bg = "#EEF2FF", style }) => {
  AV[name] ??= createAvatar(notionists, { seed: name, backgroundColor: ["transparent"] }).toDataUri();
  return <div style={{ width: size, height: size, borderRadius: size / 2, background: bg, overflow: "hidden", flexShrink: 0, ...style }}>
    <img src={AV[name]} width={size} height={size} style={{ display: "block" }} />
  </div>;
};

/** Rounded tinted tile holding a Lucide icon. */
export const IconTile: React.FC<{ Icon: LucideIcon; color: string; size?: number; tint?: string; style?: React.CSSProperties }> = ({ Icon, color, size = 56, tint, style }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.28, background: tint ?? `${color}1A`, color, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", ...style }}>
    <Icon size={size * 0.5} strokeWidth={2.2} />
  </div>
);

type Rect = { x: number; y: number; w: number; h: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Orthogonal connector from the target to the card: straight when they line up, otherwise one
 *  clean elbow (out, across, in). Returns SVG path, its length, and the two end points. */
const elbow = (r: Rect, c: Rect) => {
  const horiz = c.x >= r.x + r.w || c.x + c.w <= r.x; // card beside the target → leave from a side
  if (horiz) {
    const right = c.x >= r.x + r.w;
    const y1 = clamp(c.y + c.h / 2, r.y + 16, r.y + r.h - 16), y2 = clamp(y1, c.y + 24, c.y + c.h - 24);
    const x1 = right ? r.x + r.w + 10 : r.x - 10, x2 = right ? c.x : c.x + c.w, mx = (x1 + x2) / 2;
    const d = y1 === y2 ? `M${x1} ${y1} H${x2}` : `M${x1} ${y1} H${mx} V${y2} H${x2}`;
    return { d, len: Math.abs(x2 - x1) + Math.abs(y2 - y1), a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
  }
  const below = c.y >= r.y + r.h;
  const x1 = clamp(c.x + c.w / 2, r.x + 16, r.x + r.w - 16), x2 = clamp(x1, c.x + 24, c.x + c.w - 24);
  const y1 = below ? r.y + r.h + 10 : r.y - 10, y2 = below ? c.y : c.y + c.h, my = (y1 + y2) / 2;
  const d = x1 === x2 ? `M${x1} ${y1} V${y2}` : `M${x1} ${y1} V${my} H${x2} V${y2}`;
  return { d, len: Math.abs(x2 - x1) + Math.abs(y2 - y1), a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
};

/** Product-tour callout: spotlight ring on `rect` (rest dimmed), numbered marker, straight/elbow
 *  connector, and a designed card (gradient border, gradient icon tile, "STEP n · EYEBROW", title,
 *  one line, optional status chips). Place `card` in free or dimmed space, never on the target. */
export const Tour: React.FC<{ rect: Rect; card: Rect; p: number; n: number; eyebrow: string; title: string; body: string; Icon?: LucideIcon; chips?: [string, "pass" | "fail" | "warn" | "accent"][]; dim?: boolean; dimColor?: string }> = ({ rect, card, p, n, eyebrow, title, body, Icon, chips, dim = true, dimColor = "rgba(15,23,42,0.4)" }) => {
  if (p <= 0) return null;
  const { d, len, a, b } = elbow(rect, card);
  const draw = clamp((p - 0.2) / 0.45, 0, 1), cp = clamp((p - 0.5) / 0.5, 0, 1);
  const TONE = { pass: [brand.passDark, "#CCFBF1"], fail: [brand.danger, brand.dangerTint], warn: ["#B45309", "#FEF3C7"], accent: [brand.accent, "#EEF2FF"] };
  return (
    <>
      <div style={{ position: "absolute", left: rect.x - 10, top: rect.y - 10, width: rect.w + 20, height: rect.h + 20, borderRadius: 20, pointerEvents: "none",
        boxShadow: `0 0 0 3px ${brand.accent}, 0 0 0 ${3 + 7 * p}px ${brand.accent}26${dim ? `, 0 0 0 4000px ${dimColor.replace(/[\d.]+\)$/, (a) => `${parseFloat(a) * Math.min(1, p * 1.5)})`)}` : ""}`,
        opacity: Math.min(1, p * 2), transform: `scale(${1.03 - 0.03 * Math.min(1, p * 2)})` }} />
      <div style={{ position: "absolute", left: rect.x - 28, top: rect.y - 28, width: 40, height: 40, borderRadius: 20, background: GRAD, color: "#fff", fontSize: 20, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px -4px rgba(99,102,241,0.6)", border: "3px solid #fff", transform: `scale(${Math.min(1, p * 2.2)})` }}>{n}</div>
      <svg width="1920" height="1080" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
        <path d={d} fill="none" stroke="#fff" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" opacity={0.9} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />
        <path d={d} fill="none" stroke={brand.accent} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />
        {draw > 0 && <circle cx={a.x} cy={a.y} r="7" fill={brand.accent} stroke="#fff" strokeWidth="3" />}
        {draw >= 1 && <circle cx={b.x} cy={b.y} r="7" fill={brand.accent} stroke="#fff" strokeWidth="3" />}
      </svg>
      <div style={{ position: "absolute", left: card.x, top: card.y, width: card.w, boxSizing: "border-box", borderRadius: 20, padding: 2, background: GRAD,
        boxShadow: "0 30px 70px -24px rgba(79,70,229,0.55), 0 10px 24px -12px rgba(15,23,42,0.35)", opacity: cp, transform: `translateY(${(1 - cp) * 16}px) scale(${0.97 + 0.03 * cp})` }}>
        <div style={{ position: "relative", overflow: "hidden", background: "#fff", borderRadius: 18, padding: "20px 22px" }}>
          <div style={{ position: "absolute", right: -60, top: -60, width: 180, height: 180, borderRadius: 90, background: "radial-gradient(closest-side, rgba(168,85,247,0.16), transparent)" }} />
          <div style={{ position: "relative", display: "flex", gap: 14, alignItems: "center" }}>
            {Icon && <span style={{ width: 46, height: 46, borderRadius: 13, background: GRAD, color: "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 18px -8px rgba(99,102,241,0.8)" }}><Icon size={24} strokeWidth={2.3} /></span>}
            <div>
              <div style={{ fontFamily: brand.mono, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", color: brand.accent, fontWeight: 500 }}>Step {n} · {eyebrow}</div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.4, color: brand.fg, marginTop: 2 }}>{title}</div>
            </div>
          </div>
          <div style={{ position: "relative", fontSize: 18, lineHeight: 1.5, color: "#4B5563", marginTop: 12 }}>{body}</div>
          {chips && <div style={{ position: "relative", display: "flex", gap: 8, marginTop: 14 }}>{chips.map(([t, tone]) => (
            <span key={t} style={{ height: 30, padding: "0 12px", borderRadius: 999, display: "inline-flex", alignItems: "center", fontSize: 15, fontWeight: 700, color: TONE[tone][0], background: TONE[tone][1] }}>{t}</span>
          ))}</div>}
        </div>
      </div>
    </>
  );
};
