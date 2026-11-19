// The "tangle of thoughts" world, shared by the opening (ThinkTangle) and its callback (ThinkEnd) so both draw the
// same thoughts. A hard question sits on top; the things you have to weigh hang around it, wired together in a mess.
import React from "react";
import { Building2, Clock3, Euro, Flag, Presentation, Scale, TrendingDown, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { brand } from "./spec";

export const QUESTION = "Should we expand to Europe now, or wait?";
export const Q = { cx: 760, y: 92, w: 1000, h: 96 };
export const THOUGHTS: [string, LucideIcon, number, number][] = [
  ["Runway: 14 months", Wallet, 150, 300], ["Team of 4", Users, 600, 262], ["UK pilot: 31% churn", TrendingDown, 870, 340],
  ["Competitor launched in May", Flag, 230, 520], ["VAT + GDPR", Scale, 760, 480], ["Price in euros?", Euro, 1010, 590],
  ["Board wants growth", Presentation, 140, 760], ["Hire in Berlin?", Building2, 610, 720], ["Support across time zones", Clock3, 860, 860],
];
export const TH_H = 60;
export const thW = (i: number) => 92 + THOUGHTS[i][0].length * 11.6;
export const thC = (i: number) => ({ x: THOUGHTS[i][2] + thW(i) / 2, y: THOUGHTS[i][3] + TH_H / 2 });
export const TH_EDGES: [number, number, number][] = [
  [0, 2, 220], [0, 5, -260], [1, 3, 240], [1, 7, -200], [2, 6, 300], [3, 5, -240], [4, 0, 260], [4, 8, -220],
  [5, 1, 260], [6, 4, -200], [7, 2, 240], [8, 3, -260], [2, 4, 180], [6, 8, 220], [3, 7, -180],
];
export const rnd = (i: number) => { const s = Math.sin(i * 91.7 + 13.1) * 43758.5453; return s - Math.floor(s); };

/** A tangled cubic from A to B; `s` bends it sideways. */
export const bend = (A: { x: number; y: number }, B: { x: number; y: number }, s: number) => {
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  return [A, { x: A.x + dx * 0.15 + nx * s, y: A.y + dy * 0.15 + ny * s }, { x: B.x - dx * 0.2 - nx * s * 0.8, y: B.y - dy * 0.2 - ny * s * 0.8 }, B];
};
export const cubicD = (p: { x: number; y: number }[]) => `M${p[0].x} ${p[0].y} C${p[1].x} ${p[1].y}, ${p[2].x} ${p[2].y}, ${p[3].x} ${p[3].y}`;
export const cubicAt = (p: { x: number; y: number }[], t: number) => {
  const u = 1 - t;
  return { x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x, y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y };
};

/** One thought. `bad` rings it red (the quick answer ignored it), `ok` rings it green (thought through), `out` greys it (ruled out). */
export const ThoughtCard: React.FC<{ i: number; x: number; y: number; opacity?: number; scale?: number; bad?: number; ok?: number; out?: number; badge?: React.ReactNode }> = ({ i, x, y, opacity = 1, scale = 1, bad = 0, ok = 0, out = 0, badge }) => {
  const [text, Icon] = THOUGHTS[i];
  const ring = bad > 0 ? `0 0 0 ${2 * bad}px rgba(220,38,38,${0.6 * bad})` : ok > 0 ? `0 0 0 ${2 * ok}px rgba(63,143,107,${0.6 * ok})` : "0 0 0 0 transparent";
  return (
    <div style={{ position: "absolute", left: x, top: y, height: TH_H, borderRadius: 16, whiteSpace: "nowrap", background: "#fff", display: "flex", alignItems: "center", gap: 12, padding: "0 18px 0 12px",
      boxShadow: `${ring}, 0 1px 2px rgba(31,30,29,0.06), 0 14px 30px -18px rgba(31,30,29,0.35)`, fontFamily: brand.font, fontSize: 21, fontWeight: 600, color: brand.fg,
      opacity: opacity * (1 - 0.55 * out), transform: `scale(${scale})`, transformOrigin: "left center" }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, background: brand.tint, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={19} color={brand.muted} strokeWidth={2.2} /></span>
      <span style={{ textDecoration: out > 0.5 ? "line-through" : undefined }}>{text}</span>
      {badge}
    </div>
  );
};

/** The question everything hangs off. */
export const QuestionCard: React.FC<{ shown: number; caret?: boolean; frame: number; opacity?: number; children?: React.ReactNode }> = ({ shown, caret, frame, opacity = 1, children }) => (
  <div style={{ position: "absolute", left: Q.cx - Q.w / 2, top: Q.y, width: Q.w, opacity, fontFamily: brand.font, color: brand.fg }}>
    <div style={{ height: Q.h, borderRadius: 22, background: "#fff", boxShadow: "0 24px 50px -26px rgba(31,30,29,0.45), 0 0 0 1px rgba(31,30,29,0.05)", display: "flex", alignItems: "center", gap: 18, padding: "0 30px" }}>
      <span style={{ fontFamily: brand.mono, fontSize: 15, fontWeight: 700, color: brand.accent, letterSpacing: 1 }}>THE QUESTION</span>
      <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>{QUESTION.slice(0, shown)}{caret && <span style={{ color: brand.accent, opacity: Math.floor(frame / 15) % 2 ? 0 : 1 }}>▍</span>}</span>
    </div>
    {children}
  </div>
);
