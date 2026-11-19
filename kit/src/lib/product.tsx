// Product UI kit (generic) — dark, Linear-grade. One token set (D), Inter, 8-pt spacing, one control height,
// quiet 1 px borders, depth from layered surfaces rather than shadows. Nothing overlaps; rows share a centre line.
import React from "react";
import type { LucideIcon } from "lucide-react";
import { pressFx } from "./motion";

export const D = {
  font: "Inter",
  mono: "JetBrains Mono",
  stage: "#090C12",        // canvas behind the window
  window: "#0E121A",       // app window / main area
  sidebar: "#0B0F16",
  panel: "#121722",        // cards
  raised: "#171D2A",       // inputs, inner blocks
  hover: "rgba(255,255,255,0.05)",
  line: "rgba(255,255,255,0.07)",
  lineStrong: "rgba(255,255,255,0.12)",
  text: "#E7EAF0",
  text2: "#9BA3B4",
  text3: "#646C7D",
  accent: "#8B93FF",       // indigo, for running/selection
  accentBg: "rgba(139,147,255,0.12)",
  green: "#4ADE80",
  greenText: "#86EFAC",
  greenBg: "rgba(74,222,128,0.10)",
  greenLine: "rgba(74,222,128,0.35)",
  red: "#F87171",
  redText: "#FCA5A5",
  redBg: "rgba(248,113,113,0.10)",
  redLine: "rgba(248,113,113,0.38)",
  amber: "#FBBF24",
  amberText: "#FCD34D",
  amberBg: "rgba(251,191,36,0.12)",
};
export const S = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32 };
export const CTRL = 40;
export const R = 10;

type Tone = "neutral" | "accent" | "pass" | "fail" | "warn";
const TONES: Record<Tone, [string, string, string]> = {
  neutral: [D.text2, "rgba(255,255,255,0.06)", D.line],
  accent: [D.accent, D.accentBg, "rgba(139,147,255,0.3)"],
  pass: [D.greenText, D.greenBg, D.greenLine],
  fail: [D.redText, D.redBg, D.redLine],
  warn: [D.amberText, D.amberBg, "rgba(251,191,36,0.35)"],
};

export const Btn: React.FC<{ children: React.ReactNode; Icon?: LucideIcon; kind?: "primary" | "secondary" | "running" | "success"; spin?: number; style?: React.CSSProperties }> = ({ children, Icon, kind = "secondary", spin, style }) => {
  const k = {
    primary: { background: "#EEF0F5", color: "#0B0F16", border: "1px solid #EEF0F5" },
    secondary: { background: "rgba(255,255,255,0.03)", color: D.text, border: `1px solid ${D.lineStrong}` },
    running: { background: D.greenBg, color: D.greenText, border: `1.5px solid ${D.greenLine}` },
    success: { background: D.greenBg, color: D.greenText, border: `1.5px solid ${D.greenLine}` },
  }[kind];
  return (
    <div style={{ height: CTRL, padding: `0 ${S.md}px`, borderRadius: R, display: "inline-flex", alignItems: "center", gap: S.xs, fontFamily: D.font, fontSize: 15, fontWeight: 600,
      letterSpacing: -0.1, whiteSpace: "nowrap", boxSizing: "border-box", ...k, ...style }}>
      {spin !== undefined ? <Spinner frame={spin} color={k.color} /> : Icon && <Icon size={16} strokeWidth={2.2} />}{children}
    </div>
  );
};

export const Spinner: React.FC<{ frame: number; color: string; size?: number }> = ({ frame, color, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ transform: `rotate(${frame * 12}deg)` }}>
    <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="2" />
    <path d="M8 2 a6 6 0 0 1 6 6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** "Section / Page" breadcrumb, quiet, like the reference. */
export const Crumbs: React.FC<{ items: string[] }> = ({ items }) => (
  <div style={{ fontFamily: D.font, fontSize: 15, color: D.text3, letterSpacing: -0.1, display: "flex", gap: 6 }}>
    {items.map((c, i) => (
      <React.Fragment key={c}>{i > 0 && <span>/</span>}<span style={{ color: i === items.length - 1 ? D.text2 : D.text3 }}>{c}</span></React.Fragment>
    ))}
  </div>
);

/** Segmented tabs: a quiet track with the active tab raised. */
export const Tabs: React.FC<{ items: string[]; active: number }> = ({ items, active }) => (
  <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${D.line}`, height: CTRL, boxSizing: "border-box" }}>
    {items.map((t, i) => (
      <div key={t} style={{ padding: "0 14px", display: "flex", alignItems: "center", borderRadius: 8, fontFamily: D.font, fontSize: 14, fontWeight: 500, letterSpacing: -0.1,
        color: i === active ? D.text : D.text3, background: i === active ? D.raised : "transparent", boxShadow: i === active ? `inset 0 0 0 1px ${D.lineStrong}` : "none" }}>{t}</div>
    ))}
  </div>
);

export const Panel: React.FC<{ x: number; y: number; w: number; h: number; title?: React.ReactNode; right?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, w, h, title, right, footer, children, style }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: D.panel, border: `1px solid ${D.line}`, borderRadius: 14,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 20px 40px -24px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box", fontFamily: D.font, color: D.text, ...style }}>
    {title !== undefined && (
      <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: S.sm, padding: `0 ${S.lg - 4}px`, borderBottom: `1px solid ${D.line}`, fontSize: 15, fontWeight: 600, letterSpacing: -0.1 }}>
        {title}<div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: S.xs }}>{right}</div>
      </div>
    )}
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</div>
    {footer && <div style={{ height: 64, flexShrink: 0, display: "flex", alignItems: "center", gap: S.sm, padding: `0 ${S.lg - 4}px`, borderTop: `1px solid ${D.line}` }}>{footer}</div>}
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; tone?: Tone; Icon?: LucideIcon }> = ({ children, tone = "neutral", Icon }) => {
  const [c, bg, ln] = TONES[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 10px", borderRadius: 7, fontFamily: D.font, fontSize: 13, fontWeight: 600,
    color: c, background: bg, boxShadow: `inset 0 0 0 1px ${ln}`, whiteSpace: "nowrap", boxSizing: "border-box" }}>{Icon && <Icon size={13} strokeWidth={2.5} />}{children}</span>;
};

/** Pass / Fail / Warn pill from the client's real UI. */
export const Verdict: React.FC<{ v: "pass" | "fail" | "warn"; p?: number }> = ({ v, p = 1 }) => {
  const [c, bg] = { pass: [D.green, "rgba(74,222,128,0.12)"], fail: [D.red, "rgba(248,113,113,0.14)"], warn: [D.amber, "rgba(251,191,36,0.14)"] }[v];
  return <span style={{ width: 66, height: 30, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: D.font, fontSize: 14, fontWeight: 600,
    color: c, background: bg, transform: `scale(${1.35 - 0.35 * p})`, opacity: Math.min(1, p * 2) }}>{v[0].toUpperCase() + v.slice(1)}</span>;
};

/** Product mark. Pass the client's own mark as `children` (an SVG); otherwise a gradient tile with the initial. */
export const Logo: React.FC<{ name: string; size?: number; children?: React.ReactNode }> = ({ name, size = 26, children }) =>
  children ? <>{children}</> : (
    <div style={{ width: size, height: size, borderRadius: size * 0.28, background: "linear-gradient(135deg, #8B93FF, #4ADE80)", color: "#0B0F16",
      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: D.font, fontSize: size * 0.55, fontWeight: 700 }}>{name[0]}</div>
  );

/** Window chrome: muted dots, centred URL pill, hairline divider. */
export const TitleBar: React.FC<{ w: number; h: number; url: string }> = ({ w, h, url }) => (
  <div style={{ position: "relative", width: w, height: h, display: "flex", alignItems: "center", borderBottom: `1px solid ${D.line}`, background: "rgba(255,255,255,0.015)" }}>
    <div style={{ position: "absolute", left: 22, display: "flex", gap: 9 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: "#2E3442" }} />)}</div>
    <div style={{ margin: "0 auto", height: 30, minWidth: 300, padding: "0 18px", borderRadius: 8, background: "rgba(255,255,255,0.045)", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: D.font, fontSize: 14, color: D.text2, letterSpacing: -0.1 }}>{url}</div>
  </div>
);

// sidebar geometry — exported so the cursor can aim at nav items
export const NAV_ROW = 38, NAV_GAP = 2, NAV_LOGO = 76, NAV_LABEL = 26, NAV_SECTION_GAP = 18;
export const navCenterY = (nav: [string, [string, LucideIcon][]][], top: number, name: string) => {
  let y = top + NAV_LOGO;
  for (let s = 0; s < nav.length; s++) {
    y += (s ? NAV_SECTION_GAP : 4) + NAV_LABEL;
    for (const [n] of nav[s][1]) { if (n === name) return y + NAV_ROW / 2; y += NAV_ROW + NAV_GAP; }
  }
  return y;
};

export const Sidebar: React.FC<{ x: number; y: number; w: number; h: number; brand: string; mark?: React.ReactNode; nav: [string, [string, LucideIcon][]][]; active: string; pressed?: [string, number]; user: React.ReactNode }> = ({ x, y, w, h, brand, mark, nav, active, pressed, user }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: D.sidebar, borderRight: `1px solid ${D.line}`, boxSizing: "border-box", padding: "0 14px", fontFamily: D.font }}>
    <div style={{ height: NAV_LOGO, display: "flex", alignItems: "center", gap: 12, padding: "0 8px" }}>
      <Logo name={brand} size={26}>{mark}</Logo><span style={{ fontSize: 19, fontWeight: 600, letterSpacing: -0.3, color: D.text }}>{brand}</span>
    </div>
    {nav.map(([section, items], si) => (
      <div key={section} style={{ marginTop: si ? NAV_SECTION_GAP : 4 }}>
        <div style={{ height: NAV_LABEL, display: "flex", alignItems: "center", padding: "0 10px", fontSize: 12, fontWeight: 600, color: D.text3, letterSpacing: 0.6, textTransform: "uppercase" }}>{section}</div>
        {items.map(([n, Icon]) => {
          const on = n === active, pr = pressed && pressed[0] === n ? pressed[1] : 0;
          return (
            <div key={n} style={{ height: NAV_ROW, marginBottom: NAV_GAP, display: "flex", alignItems: "center", gap: 11, padding: "0 10px", borderRadius: 9, fontSize: 15, fontWeight: on ? 600 : 500, letterSpacing: -0.1,
              color: on || pr ? D.text : D.text2, background: pr ? `rgba(74,222,128,${0.10 + 0.12 * pr})` : on ? "rgba(74,222,128,0.10)" : "transparent",
              boxShadow: on || pr ? `inset 0 0 0 1px rgba(74,222,128,${0.18 + 0.2 * pr})` : "none", transform: `scale(${1 - 0.035 * pr})` }}>
              <Icon size={17} strokeWidth={2} color={on || pr ? D.green : D.text3} />{n}
            </div>
          );
        })}
      </div>
    ))}
    <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 10px", borderTop: `1px solid ${D.line}` }}>{user}</div>
  </div>
);

/** A click that reads as a press: sinks, darkens, inner shadow, ripple, springs back. */
export const Pressable: React.FC<{ frame: number; at: number; light?: boolean; radius?: number; children: React.ReactNode }> = ({ frame, at, light, radius = R, children }) => {
  const f = pressFx(frame, at);
  return (
    <div style={{ position: "relative", display: "inline-flex", borderRadius: radius, overflow: "hidden", transform: `translateY(${f.y}px) scale(${f.scale})`, filter: `brightness(${1 - 0.18 * f.dark})` }}>
      {children}
      <div style={{ position: "absolute", inset: 0, borderRadius: radius, pointerEvents: "none", boxShadow: `inset 0 3px 8px rgba(0,0,0,${0.4 * f.dark})` }} />
      {f.ripple >= 0 && <div style={{ position: "absolute", left: "50%", top: "50%", width: 36, height: 36, marginLeft: -18, marginTop: -18, borderRadius: "50%",
        background: light ? "rgba(99,102,241,0.28)" : "rgba(120,130,150,0.45)", transform: `scale(${1 + f.ripple * 10})`, opacity: 1 - f.ripple }} />}
    </div>
  );
};
