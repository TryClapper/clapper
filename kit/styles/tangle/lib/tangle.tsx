// The tangle world (shared by the Tangle opening and its TangleEnd callback, so both draw the same parts).
import React from "react";
import { AudioLines, BookOpen, Database, FileText, Phone, PhoneForwarded, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { brand } from "./spec";

export const NODES: [string, LucideIcon, number, number][] = [
  ["Phone line", Phone, 250, 330], ["Speech-to-text", AudioLines, 600, 470], ["LLM prompt", Sparkles, 1010, 300], ["Refund policy", FileText, 1440, 190],
  ["CRM lookup", Database, 330, 650], ["Knowledge base", BookOpen, 1150, 690], ["Call transfer", PhoneForwarded, 1560, 500], ["Text-to-speech", Volume2, 800, 790], ["Guardrails", ShieldCheck, 1620, 790],
];
export const NODE_W = 270, NODE_H = 64;
export const EDGES: [number, number, number, boolean][] = [ // from, to, loop strength, dashed
  [0, 2, 260, false], [0, 5, -320, false], [1, 6, 300, true], [2, 4, -280, false], [3, 7, 340, false], [4, 8, -260, true], [5, 0, 380, false], [6, 1, -300, false],
  [7, 3, 300, false], [8, 2, -340, false], [1, 3, 240, true], [4, 6, 300, false], [2, 7, -220, false], [5, 3, 260, false], [0, 8, -300, true], [6, 7, 280, false],
];
export const CURSOR_COLORS = ["#E8833A", "#7C5CE6", "#D9475A", "#2F8F5B", "#3F7BE0", "#C45AD1", "#1F2433", "#E06A8C", "#4A9BD6", "#8A63D2"];
export const ROLES = ["QA tester", "Engineer", "PM", "Support lead", "QA tester", "Engineer", "Founder", "QA tester"];
export const rnd = (i: number) => { const s = Math.sin(i * 91.7 + 13.1) * 43758.5453; return s - Math.floor(s); };
export const center = (i: number) => ({ x: NODES[i][2] + NODE_W / 2, y: NODES[i][3] + NODE_H / 2 });

/** A tangled cubic from A to B; `s` bends it sideways. */
export const tangledPath = (A: { x: number; y: number }, B: { x: number; y: number }, s: number) => {
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  return [A, { x: A.x + dx * 0.15 + nx * s, y: A.y + dy * 0.15 + ny * s }, { x: B.x - dx * 0.2 - nx * s * 0.8, y: B.y - dy * 0.2 - ny * s * 0.8 }, B];
};
export const cubicD = (p: { x: number; y: number }[]) => `M${p[0].x} ${p[0].y} C${p[1].x} ${p[1].y}, ${p[2].x} ${p[2].y}, ${p[3].x} ${p[3].y}`;
export const cubicAt = (p: { x: number; y: number }[], t: number) => {
  const u = 1 - t;
  return { x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x, y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y };
};

/** One part of the agent. `tone` tints it: red when it fails, green when it's covered. */
export const NodeCard: React.FC<{ i: number; x: number; y: number; opacity?: number; scale?: number; tone?: number; ok?: number; badge?: React.ReactNode }> = ({ i, x, y, opacity = 1, scale = 1, tone = 0, ok = 0, badge }) => {
  const [name, Icon] = NODES[i];
  const ring = tone > 0 ? `0 0 0 ${2 * tone}px rgba(220,38,38,${0.55 * tone})` : ok > 0 ? `0 0 0 ${2 * ok}px rgba(20,184,166,${0.55 * ok})` : "0 0 0 0 transparent";
  return (
    <div style={{ position: "absolute", left: x, top: y, width: NODE_W, height: NODE_H, borderRadius: 14, whiteSpace: "nowrap", background: "#fff",
      boxShadow: `${ring}, 0 1px 2px rgba(17,24,39,0.06), 0 14px 30px -18px rgba(17,24,39,0.35)`, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", boxSizing: "border-box",
      fontFamily: brand.font, fontSize: 22, fontWeight: 600, color: brand.fg, opacity, transform: `scale(${scale})` }}>
      <span style={{ width: 36, height: 36, borderRadius: 9, background: i % 3 === 0 ? "#111827" : "#EEF0F6", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={19} color={i % 3 === 0 ? "#fff" : "#5B6170"} strokeWidth={2.2} /></span>
      {name}
      {badge}
    </div>
  );
};

export const CursorTag: React.FC<{ x: number; y: number; color: string; label: string; opacity?: number; scale?: number }> = ({ x, y, color, label, opacity = 1, scale = 1 }) => (
  <div style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
    <svg width={22} height={24} viewBox="0 0 22 24"><path d="M2 2 L2 19 L7 14.5 L10.5 22 L13.5 20.6 L10 13.2 L17 13.2 Z" fill={color} stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" /></svg>
    <div style={{ position: "absolute", left: 14, top: 22, whiteSpace: "nowrap", background: color, color: "#fff", borderRadius: 7, padding: "3px 9px", fontFamily: brand.font, fontSize: 14, fontWeight: 600 }}>{label}</div>
  </div>
);
