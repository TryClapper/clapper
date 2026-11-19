import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SceneShell } from "../lib/SceneShell";
import { arc, ease, enter, pressFx } from "../lib/motion";
import { Pressable } from "../lib/product";
import { brand } from "../lib/spec";
import { Cursor, GRAD, Grad, Mono } from "../lib/ui";
import { CtaBackdrop } from "../lib/handoff";

// Wordmark 0, line 14 / 24, button 32, pill 44; cursor arcs 64–94, presses at PRESS.
export const PRESS = 96;

export const Cta: React.FC<{ word1: string; word2: string; pre: string; em: string; button: string; sub: string; command: string }> = ({ word1, word2, pre, em, button, sub, command }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const w = enter(frame, fps, 0), l1 = enter(frame, fps, 14), l2 = enter(frame, fps, 24), b = enter(frame, fps, 32), pl = enter(frame, fps, 44);
  const cur = arc({ x: 1150, y: 1060 }, { x: 760, y: 668 }, ease(frame, 64, PRESS - 2, 0, 1));
  const done = frame >= PRESS + 4;
  return (
    <SceneShell push={[1, 1.05]} noExit>
      <CtaBackdrop /> {/* same component ProductDemo's closing wipe reveals */}
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 26, opacity: Math.min(1, w * 1.4), transform: `scale(${0.8 + 0.2 * w})` }}>
          <div style={{ width: 104, height: 104, borderRadius: 26, background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", transform: `rotate(${(1 - w) * -60}deg)` }}>
            <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="24" strokeDashoffset={24 * (1 - Math.min(1, w))} />
            </svg>
          </div>
          <div style={{ fontSize: 130, letterSpacing: -5 }}><span style={{ fontWeight: 500 }}>{word1}</span><span style={{ fontWeight: 800 }}>{word2}</span></div>
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -2.5, marginTop: 30 }}>
          <span style={{ display: "inline-block", opacity: l1, transform: `translateY(${(1 - l1) * 30}px)` }}>{pre}</span>{" "}
          <span style={{ display: "inline-block", opacity: l2, transform: `translateY(${(1 - l2) * 30}px)` }}><Grad>{em}</Grad></span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 30, marginTop: 52, opacity: b, transform: `translateY(${(1 - b) * 30}px)` }}>
          <Pressable frame={frame} at={PRESS} radius={14}>
            <div style={{ background: brand.fg, color: "#fff", borderRadius: 14, padding: "24px 44px", fontSize: 36, fontWeight: 700,
              boxShadow: done ? `0 0 0 ${ease(frame, PRESS, PRESS + 24, 0, 16)}px rgba(99,102,241,${ease(frame, PRESS, PRESS + 24, 0.35, 0)})` : "0 20px 40px -20px rgba(17,24,39,0.5)" }}>
              {button} →
            </div>
          </Pressable>
          <div style={{ fontSize: 30, color: brand.muted, fontWeight: 500 }}>{sub}</div>
        </div>
        <div style={{ display: "inline-flex", marginTop: 40, background: brand.surface, border: `1.5px solid ${brand.line}`, borderRadius: 12, padding: "12px 22px", opacity: pl }}>
          <Mono style={{ fontSize: 26, color: brand.fg }}>{command} <span style={{ color: brand.pass }}>✓ 1-click</span></Mono>
        </div>
      </div>
      {frame >= 64 && <Cursor x={cur.x} y={cur.y} scale={pressFx(frame, PRESS).squish} />}
    </SceneShell>
  );
};
