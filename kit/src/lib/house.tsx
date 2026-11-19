// The house look: clean, light and minimal (from the Cal.com film the client liked). Use it when the site's own
// type or product look can't be read with confidence (capture says "type NOT read", the home page failed, or the
// site shows no product screens). When the site's look is clear, follow the site instead; never force this.
//
// Type: headlines in brand.font (house: Inter Tight 700, tight tracking), product UI in brand.ui (house: Inter),
// labels and code in brand.mono. Product UI: a white window on a soft grey dotted stage, light-grey sidebar,
// near-black primary, three greys for text, green for success.
import React from "react";
import { AbsoluteFill } from "remotion";
import type { LucideIcon } from "lucide-react";
import { brand } from "./spec";

export const H = {
  head: brand.font || "Inter Tight",
  ui: brand.ui || "Inter",
  mono: brand.mono || "JetBrains Mono",
  stage: "#F3F4F6",
  window: "#FFFFFF",
  sidebar: "#F7F8F9",
  subtle: "#F3F4F6",
  active: "#E5E7EB",
  line: "#E5E7EB",
  lineStrong: "#D1D5DB",
  ink: "#242424",
  text: "#242424",
  text2: "#5F6570",
  text3: "#9CA3AF",
  green: "#22C55E",
  greenText: "#15803D",
  greenBg: "#DCFCE7",
};

/** The house type scale at 1920 × 1080 (px, weight, tracking in em). Nothing on screen below 13 px. */
export const TYPE = {
  display: { fontSize: 76, fontWeight: 700, letterSpacing: "-0.034em", lineHeight: 1.05 },
  headline: { fontSize: 58, fontWeight: 700, letterSpacing: "-0.034em", lineHeight: 1.08 },
  stat: { fontSize: 44, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.1 },
  sub: { fontSize: 26, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.35 },
  body: { fontSize: 20, fontWeight: 500, lineHeight: 1.45 },
  pageTitle: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.15 },
  ui: { fontSize: 16, fontWeight: 500, lineHeight: 1.4 },
  uiStrong: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
  uiSmall: { fontSize: 14, fontWeight: 500, lineHeight: 1.4 },
  label: { fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" as const },
} satisfies Record<string, React.CSSProperties>;

export const PASTEL = ["#FDDCA8", "#C7D2FE", "#BBF7D0", "#FBCFE8", "#BAE6FD", "#FDE68A", "#DDD6FE", "#FECACA"];

/** Light stage behind app windows: soft grey with a faint dot grid and a lighter top. */
export const Stage: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <AbsoluteFill style={{ opacity, background: H.stage }}>
    <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(36,36,36,0.07) 1.2px, transparent 1.6px)", backgroundSize: "30px 30px" }} />
    <AbsoluteFill style={{ background: "radial-gradient(55% 45% at 50% 0%, rgba(255,255,255,0.9), transparent 70%)" }} />
  </AbsoluteFill>
);

export const CHROME = 48;
/** Browser window: muted dots, centred URL pill, hairline border, one soft shadow. */
export const Win: React.FC<{ x: number; y: number; w: number; h: number; url: string; children?: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, w, h, url, children, style }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 16, overflow: "hidden", background: H.window, border: `1px solid ${H.line}`,
    boxShadow: "0 1px 2px rgba(17,24,39,0.05), 0 40px 90px -40px rgba(17,24,39,0.28)", fontFamily: H.ui, color: H.text, ...style }}>
    <div style={{ position: "relative", height: CHROME, display: "flex", alignItems: "center", borderBottom: `1px solid ${H.line}`, background: "#FAFAFA" }}>
      <div style={{ position: "absolute", left: 20, display: "flex", gap: 8 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: "#D9DCE1" }} />)}</div>
      <div style={{ margin: "0 auto", height: 30, minWidth: 300, padding: "0 18px", borderRadius: 8, background: H.subtle, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: H.text2 }}>{url}</div>
    </div>
    <div style={{ position: "absolute", left: 0, top: CHROME, width: w, height: h - CHROME }}>{children}</div>
  </div>
);

export const Badge: React.FC<{ children: React.ReactNode; tone?: "neutral" | "green" | "dark"; Icon?: LucideIcon }> = ({ children, tone = "neutral", Icon }) => {
  const [c, bg] = tone === "green" ? [H.greenText, H.greenBg] : tone === "dark" ? ["#fff", H.ink] : [H.text2, H.subtle];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 10px", borderRadius: 7, fontFamily: H.ui, fontSize: 13, fontWeight: 600,
    color: c, background: bg, whiteSpace: "nowrap" }}>{Icon && <Icon size={13} strokeWidth={2.5} />}{children}</span>;
};

export const Btn: React.FC<{ children: React.ReactNode; Icon?: LucideIcon; dark?: boolean; h?: number; style?: React.CSSProperties }> = ({ children, Icon, dark, h = 40, style }) => (
  <div style={{ height: h, padding: "0 16px", borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: H.ui, fontSize: 15, fontWeight: 600,
    whiteSpace: "nowrap", boxSizing: "border-box", background: dark ? H.ink : "#fff", color: dark ? "#fff" : H.text, border: `1px solid ${dark ? H.ink : H.line}`, ...style }}>
    {Icon && <Icon size={16} strokeWidth={2.2} />}{children}
  </div>
);

// sidebar geometry, exported so the camera and cursor can aim at it
export const SIDE_USER = 64, SIDE_ROW = 36, SIDE_GAP = 2;
/** Light-grey sidebar: user on top, icon + label rows, a grey active row, help pinned at the bottom. */
export const Side: React.FC<{ x: number; y: number; w: number; h: number; user: React.ReactNode; nav: [string, LucideIcon][]; active: string; help?: LucideIcon }> = ({ x, y, w, h, user, nav, active, help: Help }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: H.sidebar, borderRight: `1px solid ${H.line}`, boxSizing: "border-box", padding: "0 12px", fontFamily: H.ui }}>
    <div style={{ height: SIDE_USER, display: "flex", alignItems: "center", gap: 10, padding: "0 8px" }}>{user}</div>
    {nav.map(([n, Icon]) => {
      const on = n === active;
      return (
        <div key={n} style={{ height: SIDE_ROW, marginBottom: SIDE_GAP, display: "flex", alignItems: "center", gap: 11, padding: "0 10px", borderRadius: 8, fontSize: 15,
          fontWeight: on ? 600 : 500, color: on ? H.ink : H.text2, background: on ? H.active : "transparent" }}>
          <Icon size={17} strokeWidth={2} color={on ? H.ink : H.text2} />{n}
        </div>
      );
    })}
    {Help && (
      <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, height: SIDE_ROW, display: "flex", alignItems: "center", gap: 11, padding: "0 10px", fontSize: 15, fontWeight: 500, color: H.text2 }}>
        <Help size={17} strokeWidth={2} />Help
      </div>
    )}
  </div>
);

/** Page header inside the app: quiet breadcrumb, then a 32 px title and one line of muted copy. */
export const PageHead: React.FC<{ crumb?: string; title: string; sub?: string; right?: React.ReactNode }> = ({ crumb, title, sub, right }) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, fontFamily: H.ui }}>
    <div>
      {crumb && <div style={{ ...TYPE.uiSmall, color: H.text3, marginBottom: 6 }}>{crumb}</div>}
      <div style={{ ...TYPE.pageTitle, fontFamily: H.head, color: H.ink }}>{title}</div>
      {sub && <div style={{ ...TYPE.ui, color: H.text2, marginTop: 6 }}>{sub}</div>}
    </div>
    {right && <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{right}</div>}
  </div>
);
