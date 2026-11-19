import React from "react";
import { AbsoluteFill, interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneShell } from "../lib/SceneShell";
import { ease, enter, shake } from "../lib/motion";
import { brand } from "../lib/spec";
import { D } from "../lib/product";
import { ICONS, PILE, PileSlot, ProblemCard } from "../lib/pile";
import { Blur, Glow, Wipe } from "../lib/fx";
import { BrandMark, DarkStage, MARK } from "../lib/handoff";

// TEMPLATE. With `landed` (the default when a Hook scene comes first) card 0 is already in its slot: it is the
// Hook's card, morphed. Without it, card 0 drops like the others.
// The others drop one at a time at DROP(i) with motion blur and pile up unevenly: each one lands (+12), jolts and
// settles still before the next one falls (a card never keeps vibrating; only the newest one moves).
// Right half: what each one does to a caller (+12); punch line at PUNCH.
// Exit: the whole pile and the copy implode into the brand mark, then a dark circle wipe opens the app's stage.
export const DROP = (i: number) => 6 + i * 26;
export const PUNCH = 128;
export const IMPLODE = [200, 220] as const, ASSEMBLE = 206, WIPE = [220, 240] as const;

const SCATTER = [{ x: -180, y: -140, r: -50 }, { x: 200, y: -60, r: 60 }, { x: -160, y: 180, r: 40 }, { x: 190, y: 200, r: -70 }];

export const ProblemStack: React.FC<{ head: string; problems: [string, string, string, string][]; punchPre: string; punchEm: string; landed?: boolean }> = ({ head, problems, punchPre, punchEm, landed = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const h = enter(frame, fps, 0), pu = enter(frame, fps, PUNCH);
  // implode: everything is pulled into the centre, spinning, with blur from the pull speed
  const imp = (f: number) => ease(f, IMPLODE[0], IMPLODE[1], 0, 1) ** 2;
  const k = imp(frame), kv = (imp(frame) - imp(frame - 1)) * 900;
  const pullL = { x: (MARK.cx - 500) * k, y: (MARK.cy - 760) * k }, pullR = { x: (MARK.cx - 1410) * k, y: (MARK.cy - 470) * k };
  const part = (i: number) => { const q = ease(frame, ASSEMBLE + i * 3, ASSEMBLE + i * 3 + 16, 0, 1); return { x: SCATTER[i].x * (1 - q), y: SCATTER[i].y * (1 - q), r: SCATTER[i].r * (1 - q), o: Math.min(1, q * 2) }; };
  const wipe = ease(frame, WIPE[0], WIPE[1], 0, 1);
  const markColor = interpolateColors(ease(frame, WIPE[0], WIPE[0] + 6, 0, 1), [0, 1], [brand.fg, D.text]);
  const drift = 1 + 0.05 * Math.min(1, frame / IMPLODE[0]) ** 2; // own camera push (no scale after the implode, so the hand-off lines up)
  return (
    <AbsoluteFill>
      <SceneShell push={[1, 1]} noExit>
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transform: `scale(${drift})` }}>
          {/* left: the pile */}
          <Blur id="pileImplode" vx={kv * 0.5} vy={kv * 0.3} style={{ position: "absolute", inset: 0, opacity: 1 - ease(frame, IMPLODE[1] - 6, IMPLODE[1], 0, 1),
            transform: `translate(${pullL.x}px, ${pullL.y}px) scale(${1 - 0.92 * k}) rotate(${-40 * k}deg)`, transformOrigin: "500px 760px" }}>
            <div style={{ position: "absolute", left: PILE.left, top: PILE.top, transform: `scale(${PILE.scale})`, transformOrigin: "0 0" }}>
              {problems.map(([name, , icon, sample], i) => {
                const first = landed && i === 0;
                const drop = (f: number) => (first ? 1 : enter(f, fps, DROP(i)));
                if (!first && frame < DROP(i)) return null;
                const p = drop(frame), vy = ((1 - p) - (1 - drop(frame - 1))) * -1000;
                const bump = problems.slice(i + 1).reduce((a, _, j) => { const t = frame - DROP(i + 1 + j) - 12; return a + (t > 0 && t < 10 ? Math.sin((t / 10) * Math.PI) * 3 : 0); }, 0);
                return (
                  <PileSlot key={name} i={i} dy={(1 - p) * -1000 + bump} rot={(1 - p) * (i % 2 ? 20 : -20)}>
                    <Blur id={`drop${i}`} vy={vy} k={0.35}>
                      <div style={{ transform: shake(frame, first ? 0 : DROP(i) + 12, 7, 0) }}><ProblemCard name={name} icon={icon} sample={sample} /></div>
                    </Blur>
                  </PileSlot>
                );
              })}
            </div>
          </Blur>
          {/* right: what it does to callers */}
          <Blur id="copyImplode" vx={kv * 0.6} style={{ position: "absolute", inset: 0, opacity: 1 - ease(frame, IMPLODE[0] + 4, IMPLODE[1] - 2, 0, 1),
            transform: `translate(${pullR.x}px, ${pullR.y}px) scale(${1 - 0.9 * k})`, transformOrigin: "1410px 470px" }}>
            <div style={{ position: "absolute", left: 1010, top: 170, width: 800 }}>
              <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.08, opacity: h, transform: `translateY(${(1 - h) * 30}px)` }}>{head}</div>
              <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 16 }}>
                {problems.map(([name, effect, icon], i) => {
                  const q = enter(frame, fps, DROP(i) + 12);
                  const Icon = ICONS[icon];
                  return (
                    <div key={name} style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 32, fontWeight: 600, opacity: frame < DROP(i) + 12 ? 0 : Math.min(1, q * 1.5), transform: `translateX(${(1 - q) * 30}px)` }}>
                      <Icon size={30} color={brand.danger} strokeWidth={2.4} />
                      <span>{effect}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 44, fontSize: 56, fontWeight: 800, letterSpacing: -2, lineHeight: 1.1, opacity: frame < PUNCH ? 0 : Math.min(1, pu * 1.5), transform: `translateY(${(1 - pu) * 30}px)` }}>
                {punchPre} <span style={{ display: "inline-block", color: brand.danger, transform: shake(frame, PUNCH + 10, 6) }}>{punchEm}</span>
              </div>
            </div>
          </Blur>
        </div>
      </SceneShell>
      {/* hand-off: dark stage opens from the centre; the mark sits exactly where the app scene picks it up */}
      {frame >= WIPE[0] && <Wipe x={MARK.cx} y={MARK.cy} p={wipe}><DarkStage frame={0} /></Wipe>}
      {frame >= ASSEMBLE - 4 && <Glow x={MARK.cx} y={MARK.cy} r={260} color="rgba(139,147,255,0.30)" frame={frame} p={ease(frame, ASSEMBLE, ASSEMBLE + 16, 0, 1) * (1 - wipe)} />}
      {frame >= ASSEMBLE && (
        <div style={{ position: "absolute", left: MARK.cx - MARK.size / 2, top: MARK.cy - MARK.size / 2 }}>
          <BrandMark size={MARK.size} color={markColor} parts={[0, 1, 2, 3].map(part)} />
        </div>
      )}
    </AbsoluteFill>
  );
};
