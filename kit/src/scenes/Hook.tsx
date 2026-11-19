import React from "react";
import { AbsoluteFill, interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneShell } from "../lib/SceneShell";
import { ease, enter, shake } from "../lib/motion";
import { brand } from "../lib/spec";
import { Card, IconTile, Label, Mono, Persona, Pill, TypeLine, Wave } from "../lib/ui";
import { Blur, Tilt3D } from "../lib/fx";
import { Bot, Mail, MessageSquare, PhoneCall, TriangleAlert } from "lucide-react";
import { PILE, PileSlot, ProblemCard } from "../lib/pile";

// TEMPLATE · the hook: one real moment where the product's absence hurts (a call, a chat, an email).
// The card tilts in (3D); the customer's line 8; the reply 34, typed from 40 at 1.3 chars/f; the bad phrase
// goes red 92–104 and vibrates; flag 100; the card eases down while the headline lands at HEAD; caption 150.
// MORPH: the headline whips up with motion blur while the card shrinks, tilts and turns into problem card 0
// of ProblemStack, landing exactly in its pile slot (`first` must equal ProblemStack's problems[0]).
export const T = { caller: 8, agent: 34, type: 40, cps: 1.3, hl: 92, flag: 100, head: 108, caption: 150, morph: [180, 208] as const };
const DUR = 210, CARD_W = 1100, CARD_H = 431, DROP_Y = 190, DROP_S = 0.9;
// target: first problem card in the next scene (screen px, unrotated), from PILE + REST[0]
const R1 = { cx: PILE.left + PILE.scale * (-10 - 260 + 260), cy: PILE.top + PILE.scale * (0 - 60 + 52.5), w: 520 * PILE.scale, h: 105 * PILE.scale };

type Props = { kind?: "call" | "chat" | "email"; header: string; caller: [string, string]; agent: string; bad: string; flag: string; pre: string; em: string; caption: string; first: [string, string, string] };
const KIND = { call: PhoneCall, chat: MessageSquare, email: Mail };

export const Hook: React.FC<Props> = ({ kind = "call", header, caller, agent, bad, flag, pre, em, caption, first }) => {
  const KindIcon = KIND[kind];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = enter(frame, fps, 0);
  const c = enter(frame, fps, T.caller), a = enter(frame, fps, T.agent), f = enter(frame, fps, T.flag);
  const shown = Math.max(0, Math.floor((frame - T.type) * T.cps));
  const hl = ease(frame, T.hl, T.hl + 12, 0, 1);
  const drop = ease(frame, T.head - 6, T.head + 24, 0, 1);
  const waveColor = interpolateColors(hl, [0, 1], [brand.accent, brand.danger]);
  const words = pre.split(" ");
  const cap = enter(frame, fps, T.caption);
  // camera push (same curve SceneShell used), applied here so the morph can work in screen px
  const camAt = (fr: number) => { const t = Math.min(1, fr / DUR); return 1 + 0.06 * t * t * (3 - 2 * t); };
  const cam = camAt(frame);
  const m = (fr: number) => ease(fr, T.morph[0], T.morph[1], 0, 1);
  const e = m(frame);
  const whip = (fr: number) => m(fr) ** 2 * -620;
  const morphing = frame >= T.morph[0];

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <KindIcon size={26} color={waveColor} style={{ opacity: 0.7 + 0.3 * Math.sin(frame * 0.25) }} />
          <Label color={brand.fg}>{header}</Label>
        </div>
        {kind === "call" && <Wave frame={frame} width={300} height={44} color={waveColor} bars={30} />}
      </div>
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", opacity: Math.min(1, c * 1.5), transform: `translateY(${(1 - c) * 30}px)` }}>
        <Persona name={caller[0]} size={60} bg="#FEF3C7" />
        <div style={{ background: brand.tint, borderRadius: "6px 22px 22px 22px", padding: "18px 26px", fontSize: 34, fontWeight: 500 }}>{caller[1]}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 22, opacity: Math.min(1, a * 1.5), transform: `translateY(${(1 - a) * 30}px)` }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          <div style={{ background: "#EEF2FF", borderRadius: "22px 6px 22px 22px", padding: "18px 26px", fontSize: 34, fontWeight: 500, maxWidth: 820, minHeight: 50 }}>
            <span><TypeLine text={agent} shown={shown} bad={bad} hl={hl} caret={shown < agent.length} jitter={shake(frame, T.hl + 6, 5)} /></span>
          </div>
          <IconTile Icon={Bot} color="#fff" tint={brand.accent} size={60} />
        </div>
        <div style={{ marginTop: 16, marginRight: 70, opacity: frame < T.flag ? 0 : Math.min(1, f * 1.5), transform: `scale(${0.6 + 0.4 * f})`, transformOrigin: "right center" }}>
          <div style={{ transform: shake(frame, T.flag + 4, 8, 0.4) }}><Pill style={{ fontSize: 26, padding: "10px 20px" }}><TriangleAlert size={24} /> {flag}</Pill></div>
        </div>
      </div>
    </>
  );

  // morph box: from the call card's screen rect to the problem card's
  const r0 = { cx: 960, cy: 540 + DROP_Y * cam, w: CARD_W * DROP_S * cam, h: CARD_H * DROP_S * cam };
  const lerp = (x: number, y: number) => x + (y - x) * e;
  const box = { cx: lerp(r0.cx, R1.cx), cy: lerp(r0.cy, R1.cy), w: lerp(r0.w, R1.w), h: lerp(r0.h, R1.h) };
  const prev = m(frame - 1), vx = (R1.cx - r0.cx) * (e - prev), vy = (R1.cy - r0.cy) * (e - prev);
  const rot = -3 * e + Math.sin(e * Math.PI) * -9; // tilts through the move, settles at the slot's -3°

  return (
    <AbsoluteFill>
      <SceneShell push={[1, 1]} noExit>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${cam})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Blur id="headWhip" vy={whip(frame) - whip(frame - 1)} k={0.5} style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", fontSize: 78, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.12,
            transform: `translateY(${whip(frame)}px)`, opacity: 1 - ease(frame, T.morph[0] + 6, T.morph[0] + 18, 0, 1) }}>
            <div>
              {words.map((w, i) => {
                const p = enter(frame, fps, T.head + i * 4);
                return <span key={i} style={{ display: "inline-block", marginRight: 20, opacity: frame < T.head + i * 4 ? 0 : Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 40}px)` }}>{w}</span>;
              })}
            </div>
            <div style={{ color: brand.danger, opacity: enter(frame, fps, T.head + 26), transform: `translateY(${(1 - enter(frame, fps, T.head + 26)) * 40}px)` }}>
              <span style={{ display: "inline-block", transform: shake(frame, T.head + 32, 7) }}>{em}</span>
            </div>
            <div style={{ marginTop: 18, opacity: cap, transform: `translateY(${(1 - cap) * 20}px)` }}><Mono style={{ fontSize: 30, color: brand.muted }}>{caption}</Mono></div>
          </Blur>
          {/* the call card enters with a 3D tilt, then goes flat (sharp) */}
          {(() => {
            const el = <Card style={{ width: CARD_W, padding: "34px 44px", boxSizing: "border-box", opacity: morphing ? 0 : Math.min(1, card * 1.4), transform: `translateY(${drop * DROP_Y}px) scale(${1 - drop * (1 - DROP_S)})` }}>{body}</Card>;
            return card < 0.999 ? <Tilt3D p={Math.min(1, card)} frame={frame} rx={22} ry={-18} z={-300} float={false}>{el}</Tilt3D> : el;
          })()}
        </div>
      </SceneShell>

      {morphing && (
        <Blur id="cardMorph" vx={vx} vy={vy} k={0.4} style={{ position: "absolute", inset: 0 }}>
          {/* box */}
          <div style={{ position: "absolute", left: box.cx - box.w / 2, top: box.cy - box.h / 2, width: box.w, height: box.h, transform: `rotate(${rot}deg)`, borderRadius: lerp(24 * DROP_S * cam, 22 * PILE.scale),
            background: brand.surface, border: `${lerp(1.5, 2.4)}px solid ${interpolateColors(e, [0, 1], [brand.line, "#FCA5A5"])}`, boxSizing: "border-box", overflow: "hidden",
            boxShadow: "0 1px 2px rgba(17,24,39,0.04), 0 30px 70px -30px rgba(17,24,39,0.22)", opacity: 1 - ease(e, 0.85, 1, 0, 1) }}>
            {/* the call, shrinking with the box, fades first */}
            <div style={{ position: "absolute", left: "50%", top: "50%", width: CARD_W, height: CARD_H, padding: "34px 44px", boxSizing: "border-box",
              transform: `translate(-50%, -50%) scale(${box.w / CARD_W})`, opacity: 1 - ease(e, 0.05, 0.45, 0, 1) }}>{body}</div>
          </div>
          {/* the problem card, in its exact final slot, carried along with the box */}
          <div style={{ position: "absolute", inset: 0, transform: `translate(${box.cx - R1.cx}px, ${box.cy - R1.cy}px)`, opacity: ease(e, 0.4, 0.8, 0, 1) }}>
            <div style={{ position: "absolute", left: PILE.left, top: PILE.top, transform: `scale(${PILE.scale})`, transformOrigin: "0 0" }}>
              <PileSlot i={0} rot={rot + 3}><ProblemCard name={first[0]} icon={first[1]} sample={first[2]} /></PileSlot>
            </div>
          </div>
        </Blur>
      )}
    </AbsoluteFill>
  );
};
