// The problem pile, shared by ProblemStack and Hook (Hook's morph ends exactly on card 0's slot).
// Lives in src/lib so a change here re-renders both scenes (the render cache hashes src/lib).
import React from "react";
import { BrainCircuit, Bug, CircleDollarSign, Clock, FileWarning, Mail, MicOff, PhoneOff, ShieldAlert, Timer, TrendingDown, TriangleAlert, Unplug, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { brand } from "./spec";
import { IconTile } from "./ui";

// icon keys usable from video.json
export const ICONS: Record<string, LucideIcon> = { brain: BrainCircuit, mic: MicOff, timer: Timer, phone: PhoneOff, shield: ShieldAlert, bug: Bug, money: CircleDollarSign,
  clock: Clock, file: FileWarning, mail: Mail, down: TrendingDown, alert: TriangleAlert, unplug: Unplug, user: UserX };
// pile container (screen px) and resting spots: x offset, y (from pile bottom), rotation — uneven, overlapping
export const PILE = { left: 500, top: 850, scale: 1.2 };
export const REST: [number, number, number][] = [[-10, 0, -3], [46, -92, 5], [-38, -178, -7], [30, -262, 4], [-22, -350, -9]];
/** One problem card (inner box). Also drawn by Hook at the end of its morph, so the cut is invisible. */
export const ProblemCard: React.FC<{ name: string; icon: string; sample: string; style?: React.CSSProperties }> = ({ name, icon, sample, style }) => (
  <div style={{ background: brand.surface, borderRadius: 22, border: "2px solid #FCA5A5", boxShadow: "0 24px 50px -20px rgba(220,38,38,0.35), 0 2px 0 rgba(17,24,39,0.04)",
    padding: "18px 22px", display: "flex", gap: 18, alignItems: "center", fontFamily: brand.font, color: brand.fg, ...style }}>
    <IconTile Icon={ICONS[icon]} color={brand.danger} tint={brand.dangerTint} size={64} />
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8 }}>{name}</div>
      <div style={{ fontFamily: brand.mono, fontSize: 19, color: brand.danger, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sample}</div>
    </div>
  </div>
);

/** Card i in its pile slot (positioned inside the PILE container). */
export const PileSlot: React.FC<{ i: number; children: React.ReactNode; dy?: number; rot?: number }> = ({ i, children, dy = 0, rot = 0 }) => {
  const [x, y, r] = REST[i];
  return <div style={{ position: "absolute", left: x - 260, top: y - 60, width: 520, zIndex: i, transform: `translateY(${dy}px) rotate(${r + rot}deg)` }}>{children}</div>;
};

