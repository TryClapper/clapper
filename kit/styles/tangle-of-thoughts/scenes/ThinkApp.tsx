import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  ArrowUp, Brain, CircleCheck, FileSpreadsheet, FileText, FolderOpen, Globe, MessageSquare, Mic, Plus, Presentation, Shapes, StickyNote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SceneShell } from "../lib/SceneShell";
import { Blur, Glow, Tilt3D, Wipe } from "../lib/fx";
import { BrandMark, CtaBackdrop, DarkStage, LEAD, MARK, SIDEBAR_LOGO } from "../lib/handoff";
import { arc, ease, enter, pressFx } from "../lib/motion";
import { Cursor, Persona } from "../lib/ui";
import { Spinner } from "../lib/product";
import { brand } from "../lib/spec";

// Claude.ai product scene · Claude as a thinking partner, on the question from the opening.
// Bring your context (a Project with the pilot data, deck, interviews) → ask → Claude asks one question back before
// answering → its thinking is visible while it reads your files and the web → it pushes back on your plan → it builds
// a decision model you can test (drag churn down, the recommendation flips). Ends with a circle wipe from the
// recommendation into the CTA backdrop. Captions on the stage carry the story (no voiceover in this cut).
const C = { win: "#FAF9F5", side: "#F2F0E9", line: "#E6E3DA", text: "#1F1E1D", text2: "#6F6B63", text3: "#9A958B", accent: "#D97757", tint: "#EFEDE5", user: "#ECE9E0", green: "#3F8F6B", amber: "#B7791F" };
const WIN = { x: 110, y: 150, w: 1700, h: 860 }, TB = 44, SB = 270;
const COL = { x: 420, w: 600 };
const COMP = { x: COL.x, y: 852, w: COL.w, h: 136 }; // two lines of text + a 12 px gap + the toolbar
const PANEL = { x: 1060, y: 214, w: 730, h: 776 };
const GAP = 28; // one vertical rhythm between messages
const H = { bubble: 2 * 29 + 26, ask: 2 * 30.5, chips: 42, bubble2: 29 + 24, think: 24 + 4 * 34 + 26, reply: 2 * 30.5, card: 64 };
const Y = (() => {
  const bubble = 226, ask = bubble + H.bubble + GAP, chips = ask + H.ask + 16, bubble2 = chips + H.chips + GAP, think = bubble2 + H.bubble2 + GAP, reply = think + H.think + 22, card = reply + H.reply + 20;
  return { bubble, ask, chips, bubble2, think, reply, card };
})();
const TRACK = { x: PANEL.x + 36, w: 658, y: PANEL.y + 234 };
export const B = { type: 64, cps: 1.6, send: 120, bubble: 126, ask: 150, chips: 198, pick: 236, bubble2: 242, scroll: [254, 284] as const, scrollBy: -220,
  think: 262, lines: [274, 306, 338, 370], thought: 420, reply: 470, card: 540, swapOut: [572, 592] as const, swapIn: [588, 620] as const, grab: 698, drag: [700, 752] as const };
const END_WIPE = [LEAD + 862, LEAD + 880] as const;
const PROMPT = "Should we expand to Europe now, or wait? It's all in the project.";
const ASK = "Before I dig in: is year one about revenue, or about learning which market works?";
const THINK: [LucideIcon, string][] = [[FileSpreadsheet, "Pilot churn spikes in month 2: onboarding, not demand."], [Presentation, "14 months of runway covers one new market, not two."],
  [StickyNote, "Interviews: French buyers expect local support."], [Globe, "Searched the web · 6 sources on EU launch costs"]];
const REPLY_A = "I'd ", REPLY_B = "push back", REPLY_C = " on France first. Your UK pilot says fix onboarding before you add a second market.";
const FILES: [LucideIcon, string, string][] = [[FileSpreadsheet, "UK pilot results.xlsx", "1,240 accounts · 6 months"], [Presentation, "Board deck · Q3.pdf", "18 pages"], [StickyNote, "Customer interviews.docx", "12 calls"], [FileText, "Pricing notes.md", "EUR / GBP options"]];
const CAPS: [number, string][] = [[-18, "Bring your context."], [132, "It asks before it answers."], [262, "You can see how it thinks."], [466, "It pushes back."], [604, "And builds something you can test."], [772, "Think it through, together."]];

const F: [number, number, number] = [960, 540, 1], Tz: [number, number, number] = [720, 930, 1.35], Cz: [number, number, number] = [720, 520, 1.3], Az: [number, number, number] = [1425, 530, 1.18];
const KEYS: [number, [number, number, number]][] = [[0, F], [56, F], [74, Tz], [118, Tz], [138, F], [146, F], [168, Cz], [452, Cz], [474, F], [600, F], [626, Az], [860, Az], [880, Az]];
const cam = (f: number) => {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [f0, a] = KEYS[i], [f1, b] = KEYS[i + 1];
    if (f <= f1) { const k = ease(f, f0, f1, 0, 1); return a.map((v, j) => v + (b[j] - v) * k); }
  }
  return KEYS[KEYS.length - 1][1];
};

const churnAt = (f: number) => 31 - 13 * ease(f, B.drag[0], B.drag[1], 0, 1);
const knob = (c: number) => ({ x: TRACK.x + (TRACK.w * (c - 5)) / 40, y: TRACK.y + 4 });
const tip = (x: number, y: number) => ({ x: x - 5, y: y - 4 });
const REST = { x: 1760, y: 1060 };
const SEND = tip(COMP.x + COMP.w - 16 - 19, COMP.y + COMP.h - 12 - 19);
const LEARN = tip(COL.x + 44 + 132 + 65, Y.chips + 21);
const MOVES: [number, number, { x: number; y: number }, { x: number; y: number }][] = [
  [96, 114, REST, SEND], [126, 146, SEND, REST], [214, 232, REST, LEARN], [244, 262, LEARN, REST], [676, 696, REST, tip(knob(31).x, knob(31).y)],
];
const PRESSES = [B.send, B.pick, B.grab];
const cursorAt = (f: number) => {
  if (f >= B.drag[0] && f < 780) { const k = knob(churnAt(f)); return tip(k.x, k.y); }
  if (f >= 780) { const k = knob(18); return arc(tip(k.x, k.y), { x: 1640, y: 980 }, ease(f, 780, 800, 0, 1)); }
  let pos = REST;
  for (const [f0, f1, a, b] of MOVES) { if (f >= f1) pos = b; else if (f >= f0) return arc(a, b, ease(f, f0, f1, 0, 1)); }
  return pos;
};
const typed = (s: string, f: number, at: number, cps: number) => s.slice(0, Math.max(0, Math.min(s.length, Math.round((f - at) * cps))));
const Tile: React.FC<{ Icon: LucideIcon; size?: number; tone?: string; bg?: string }> = ({ Icon, size = 32, tone = C.text2, bg = C.tint }) => (
  <span style={{ width: size, height: size, borderRadius: size * 0.28, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={size * 0.56} color={tone} strokeWidth={2.1} /></span>
);

export const ThinkApp: React.FC<{ user: string; project: string; recents: string[] }> = ({ user, project, recents }) => {
  const raw = useCurrentFrame();
  const f = Math.max(0, raw - LEAD);
  const { fps } = useVideoConfig();
  const [cx, cy, z] = cam(f);
  const build = ease(raw, 2, LEAD, 0, 1);
  const toCta = ease(raw, END_WIPE[0], END_WIPE[1], 0, 1);
  const cur = cursorAt(f);
  const S = (p: { x: number; y: number }) => ({ x: (p.x - cx) * z + 960, y: (p.y - cy) * z + 540 });
  const sent = f >= B.send + 4;
  const scroll = ease(f, B.scroll[0], B.scroll[1], 0, B.scrollBy);
  const churn = churnAt(f);
  const ukMo = Math.round(13 - churn * 0.13), frMo = Math.round(10.5 - churn * 0.14), bothMo = Math.round(7 - churn * 0.13);
  const go = churn < 25;

  const window = (
    <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, borderRadius: 18, overflow: "hidden", background: C.win, fontFamily: brand.font, color: C.text,
      boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 60px 140px -40px rgba(0,0,0,0.85)" }}>
      <div style={{ height: TB, display: "flex", alignItems: "center", gap: 8, padding: "0 18px", background: "#EDEBE3", borderBottom: `1px solid ${C.line}` }}>
        {["#E8705F", "#E9B949", "#71B562"].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
        <span style={{ marginLeft: 560, width: 420, height: 28, borderRadius: 8, background: "#F8F7F2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: C.text2, fontFamily: brand.mono }}>claude.ai/project/europe-expansion</span>
      </div>
      <div style={{ position: "absolute", left: 0, top: TB, width: SB, bottom: 0, background: C.side, borderRight: `1px solid ${C.line}` }}>
        <div style={{ position: "absolute", left: SIDEBAR_LOGO.x - WIN.x, top: SIDEBAR_LOGO.y - WIN.y - TB, display: "flex", alignItems: "center", gap: 12 }}>
          <BrandMark size={SIDEBAR_LOGO.size} color={C.text} /><span style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.8 }}>Claude</span></div>
        <div style={{ position: "absolute", left: 18, right: 18, top: 72, height: 44, display: "flex", alignItems: "center", gap: 12, padding: "0 10px", fontSize: 18, fontWeight: 600 }}>
          <span style={{ width: 28, height: 28, borderRadius: 14, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={18} color="#fff" strokeWidth={2.6} /></span>New chat</div>
        {([[MessageSquare, "Chats"], [FolderOpen, "Projects"], [Shapes, "Artifacts"]] as [LucideIcon, string][]).map(([I, l], i) => (
          <div key={l} style={{ position: "absolute", left: 18, right: 18, top: 128 + i * 42, height: 36, borderRadius: 10, padding: "0 10px", display: "flex", alignItems: "center", gap: 14, fontSize: 18,
            color: i === 1 ? C.text : C.text2, fontWeight: i === 1 ? 700 : 400, background: i === 1 ? "#E6E2D7" : "transparent" }}><I size={20} />{l}</div>
        ))}
        <div style={{ position: "absolute", left: 28, top: 278, fontSize: 14, fontWeight: 700, letterSpacing: 0.8, color: C.text3, textTransform: "uppercase" }}>Recents</div>
        {recents.map((r, i) => (
          <div key={r} style={{ position: "absolute", left: 18, right: 18, top: 306 + i * 40, height: 36, borderRadius: 10, padding: "0 10px", display: "flex", alignItems: "center", fontSize: 17, whiteSpace: "nowrap", overflow: "hidden" }}>{r}</div>
        ))}
        <div style={{ position: "absolute", left: 22, bottom: 22, display: "flex", alignItems: "center", gap: 12 }}>
          <Persona name={user} size={40} bg="#F6D5C7" /><div><div style={{ fontSize: 17, fontWeight: 700 }}>{user}</div><div style={{ fontSize: 14, color: C.text2 }}>Pro plan</div></div></div>
      </div>
      {/* project header over the chat column */}
      <div style={{ position: "absolute", left: SB + 40, top: TB + 18, display: "flex", alignItems: "center", gap: 10, fontSize: 17, color: C.text2 }}><FolderOpen size={18} />{project}</div>
    </div>
  );

  // ---- chat column ----
  const bub = enter(f, fps, B.bubble), bub2 = enter(f, fps, B.bubble2);
  const hero = 1 - ease(f, B.send, B.send + 12, 0, 1);
  const chat = (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, clipPath: `inset(248px 0 ${1080 - COMP.y + 16}px 0)`, fontFamily: brand.font, color: C.text }}>
      {hero > 0 && (
        <div style={{ position: "absolute", left: COL.x, width: COL.w, top: 430, textAlign: "center", opacity: hero }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}><BrandMark size={40} color={C.text} /><span style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1.4 }}>{project}</span></div>
          <div style={{ fontSize: 19, color: C.text2, marginTop: 10 }}>4 files · instructions set</div>
        </div>
      )}
      <div style={{ position: "absolute", left: 0, top: scroll, width: 1920, height: 1080 }}>
        {sent && (
          <div style={{ position: "absolute", left: COL.x + COL.w * 0.16, width: COL.w * 0.84, top: Y.bubble, display: "flex", justifyContent: "flex-end", opacity: Math.min(1, bub * 1.4), transform: `translateY(${(1 - bub) * 30}px)` }}>
            <div style={{ background: C.user, borderRadius: 20, padding: "13px 20px", fontSize: 20, lineHeight: 1.45 }}>{PROMPT}</div>
          </div>
        )}
        {f >= B.ask - 4 && <div style={{ position: "absolute", left: COL.x, top: Y.ask + 4, opacity: ease(f, B.ask - 4, B.ask + 2, 0, 1) }}><BrandMark size={28} color={C.text} /></div>}
        {f >= B.ask && <div style={{ position: "absolute", left: COL.x + 44, width: COL.w - 44, top: Y.ask, fontSize: 21, lineHeight: 1.45 }}>{typed(ASK, f, B.ask, 2)}</div>}
        {f >= B.chips && ["Revenue", "Learning"].map((l, i) => {
          const q = enter(f, fps, B.chips + i * 4), picked = i === 1 && f >= B.pick + 2;
          return (
            <div key={l} style={{ position: "absolute", left: COL.x + 44 + i * 132, top: Y.chips, width: i ? 130 : 120, height: 42, borderRadius: 21, border: `1.5px solid ${picked ? C.accent : C.line}`, background: picked ? "#F8E4DA" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: picked ? C.accent : C.text, opacity: Math.min(1, q * 1.5), transform: `scale(${(0.85 + 0.15 * q) * (i === 1 ? pressFx(f, B.pick).scale : 1)})` }}>{l}</div>
          );
        })}
        {f >= B.bubble2 && (
          <div style={{ position: "absolute", left: COL.x, width: COL.w, top: Y.bubble2, display: "flex", justifyContent: "flex-end", opacity: Math.min(1, bub2 * 1.4), transform: `translateY(${(1 - bub2) * 24}px)` }}>
            <div style={{ background: C.user, borderRadius: 20, padding: "12px 20px", fontSize: 20 }}>Learning, mostly.</div>
          </div>
        )}
        {f >= B.think && (() => {
          const q = enter(f, fps, B.think), done = f >= B.thought;
          return (
            <div style={{ position: "absolute", left: COL.x + 44, width: COL.w - 44, top: Y.think, borderRadius: 16, border: `1px solid ${C.line}`, background: "#F5F3EC", padding: "12px 18px 14px", opacity: Math.min(1, q * 1.5), transform: `translateY(${(1 - q) * 20}px)` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: C.text2 }}>
                {done ? <CircleCheck size={18} color={C.green} /> : <Spinner frame={f} color={C.accent} size={18} />}{done ? "Thought for 14 seconds" : "Thinking…"}<Brain size={16} style={{ marginLeft: "auto" }} color={C.text3} /></div>
              {THINK.map(([I, l], i) => {
                const at = B.lines[i]; if (f < at) return null;
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 17, color: i === 3 ? C.text2 : C.text, opacity: ease(f, at, at + 8, 0, 1) }}>
                  <I size={17} color={i === 3 ? C.accent : C.text3} style={{ flexShrink: 0 }} />{typed(l, f, at, 2.4)}</div>;
              })}
            </div>
          );
        })()}
        {f >= B.reply && (
          <div style={{ position: "absolute", left: COL.x + 44, width: COL.w - 44, top: Y.reply, fontSize: 21, lineHeight: 1.45 }}>
            {(() => { const t = typed(REPLY_A + REPLY_B + REPLY_C, f, B.reply, 2.2), a = REPLY_A.length, b = a + REPLY_B.length;
              return <>{t.slice(0, a)}<span style={{ background: t.length > a ? `rgba(217,119,87,${0.22 * ease(f, B.reply + 10, B.reply + 20, 0, 1)})` : "transparent", color: C.accent, fontWeight: 700, borderRadius: 6, padding: "0 3px" }}>{t.slice(a, b)}</span>{t.slice(b)}</>; })()}
          </div>
        )}
        {f >= B.card && (() => {
          const q = enter(f, fps, B.card), open = f >= B.swapIn[0];
          return (
            <div style={{ position: "absolute", left: COL.x + 44, width: 420, top: Y.card, height: 64, borderRadius: 14, border: `1.5px solid ${open ? C.accent : C.line}`, background: "#fff",
              display: "flex", alignItems: "center", gap: 14, padding: "0 14px", opacity: Math.min(1, q * 1.5), transform: `scale(${0.92 + 0.08 * q})`, transformOrigin: "left center" }}>
              <Tile Icon={Shapes} size={40} tone={C.accent} bg="#F8E4DA" />
              <div><div style={{ fontSize: 18, fontWeight: 800 }}>Decision model</div><div style={{ fontSize: 14, color: C.text2 }}>Interactive · drag to test</div></div>
            </div>
          );
        })()}
      </div>
    </div>
  );

  const promptShown = sent ? "" : typed(PROMPT, f, B.type, B.cps);
  const composer = (
    <div style={{ position: "absolute", left: COMP.x, top: COMP.y, width: COMP.w, height: COMP.h, borderRadius: 22, background: "#fff", border: `1px solid ${C.line}`, boxShadow: "0 12px 34px -18px rgba(60,40,20,0.35)", fontFamily: brand.font }}>
      <div style={{ position: "absolute", left: 22, top: 18, right: 22, fontSize: 20, lineHeight: 1.4, color: promptShown ? C.text : C.text3, height: 56, overflow: "hidden" }}>
        {promptShown || (sent ? "Reply to Claude…" : `Ask about ${project}…`)}
        {!sent && f >= B.type - 6 && promptShown.length < PROMPT.length && <span style={{ color: C.accent, opacity: Math.floor(f / 15) % 2 ? 0 : 1 }}>▍</span>}
      </div>
      <div style={{ position: "absolute", left: 16, right: 16, bottom: 12, height: 38, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={18} color={C.text2} /></span>
        <span style={{ height: 36, borderRadius: 10, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", fontSize: 15, fontWeight: 600, color: C.text2 }}><Brain size={16} />Extended thinking</span>
        <span style={{ marginLeft: "auto", display: "flex" }}><Mic size={18} color={C.text3} /></span>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: C.accent, opacity: promptShown ? 1 : 0.45, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${pressFx(f, B.send).scale})` }}><ArrowUp size={20} color="#fff" strokeWidth={2.6} /></span>
      </div>
    </div>
  );

  // ---- right panel: first the project's knowledge, then the decision model ----
  const reading = (i: number) => (f >= B.lines[i] && f < (B.lines[i + 1] ?? B.thought) ? 1 : 0);
  const outA = ease(f, B.swapOut[0], B.swapOut[1], 0, 1), inB = ease(f, B.swapIn[0], B.swapIn[1], 0, 1);
  const vA = (ease(f, B.swapOut[0], B.swapOut[1], 0, 1) - ease(f - 1, B.swapOut[0], B.swapOut[1], 0, 1)) * 820, vB = (ease(f, B.swapIn[0], B.swapIn[1], 0, 1) - ease(f - 1, B.swapIn[0], B.swapIn[1], 0, 1)) * 820;
  const shell: React.CSSProperties = { position: "absolute", inset: 0, borderRadius: 18, background: "#fff", border: `1px solid ${C.line}`, boxShadow: "0 30px 70px -36px rgba(60,40,20,0.45)", overflow: "hidden", fontFamily: brand.font, color: C.text };
  const panelA = outA < 1 && (
    <Blur id="pa" vx={vA} k={0.25} style={{ position: "absolute", left: PANEL.x + outA * 820, top: PANEL.y, width: PANEL.w, height: PANEL.h }}>
      <div style={shell}>
        <div style={{ height: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 24px", borderBottom: `1px solid ${C.line}` }}><FolderOpen size={20} color={C.accent} /><span style={{ fontSize: 18, fontWeight: 800 }}>{project}</span><span style={{ fontSize: 15, color: C.text3 }}>Project</span></div>
        <div style={{ padding: "24px 32px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.8, color: C.text3, textTransform: "uppercase" }}>Instructions</div>
          <div style={{ marginTop: 10, background: C.tint, borderRadius: 14, padding: "14px 18px", fontSize: 19, lineHeight: 1.45 }}>Be blunt. Challenge my assumptions. We're a team of 4 with 14 months of runway.</div>
          <div style={{ display: "flex", marginTop: 30, fontSize: 14, fontWeight: 700, letterSpacing: 0.8, color: C.text3, textTransform: "uppercase" }}>Knowledge<span style={{ marginLeft: "auto" }}>4 files</span></div>
          {FILES.map(([I, name, meta], i) => {
            const r = i < 3 ? reading(i) : 0;
            return (
              <div key={name} style={{ marginTop: 12, height: 70, borderRadius: 14, border: `1.5px solid ${r ? C.accent : C.line}`, background: r ? "#FBEFE9" : "#fff", display: "flex", alignItems: "center", gap: 14, padding: "0 16px" }}>
                <Tile Icon={I} size={42} tone={C.text} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 19, fontWeight: 700 }}>{name}</div><div style={{ fontSize: 15, color: C.text2 }}>{meta}</div></div>
                {r > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: C.accent }}><Spinner frame={f} color={C.accent} size={16} />Reading</span>}
                {f >= B.thought && i < 3 && <CircleCheck size={20} color={C.green} />}
              </div>
            );
          })}
        </div>
      </div>
    </Blur>
  );
  const kq = (at: number) => ease(f, at, at + 10, 0, 1);
  const bars: [string, number][] = [["UK first", ukMo], ["France first", frMo], ["Both at once", bothMo]];
  const k = knob(churn);
  const panelB = inB > 0 && (
    <Blur id="pb" vx={vB} k={0.25} style={{ position: "absolute", left: PANEL.x + (1 - inB) * 820, top: PANEL.y, width: PANEL.w, height: PANEL.h }}>
      <div style={shell}>
        <div style={{ height: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 24px", borderBottom: `1px solid ${C.line}` }}><Shapes size={20} color={C.accent} /><span style={{ fontSize: 18, fontWeight: 800 }}>Decision model</span><span style={{ fontSize: 15, color: C.text3 }}>Interactive</span>
          <span style={{ marginLeft: "auto", height: 36, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 15, fontWeight: 600, color: C.text2 }}>Publish</span></div>
        <div style={{ position: "absolute", left: 36, right: 36, top: 88, opacity: kq(620) }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.9 }}>Europe: what does each path cost?</div>
          <div style={{ fontSize: 17, color: C.text2, marginTop: 6 }}>From your pilot data · runway today 14 months · team of 4</div>
        </div>
        <div style={{ position: "absolute", left: 36, right: 36, top: 192, display: "flex", fontSize: 18, fontWeight: 700, opacity: kq(630) }}>Month-2 churn<span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: go ? C.green : C.amber }}>{Math.round(churn)}%</span></div>
        <div style={{ position: "absolute", left: 36, width: TRACK.w, top: TRACK.y - PANEL.y, height: 8, borderRadius: 4, background: C.tint, opacity: kq(630) }}>
          <div style={{ width: k.x - TRACK.x, height: 8, borderRadius: 4, background: C.accent }} />
          <div style={{ position: "absolute", left: k.x - TRACK.x - 14, top: -10, width: 28, height: 28, borderRadius: 14, background: "#fff", border: `3px solid ${C.accent}`, boxShadow: "0 4px 10px rgba(0,0,0,0.15)", transform: `scale(${pressFx(f, B.grab).scale * (f >= B.drag[0] && f < B.drag[1] + 4 ? 1.12 : 1)})` }} />
        </div>
        <div style={{ position: "absolute", left: 36, right: 36, top: 290, fontSize: 14, fontWeight: 700, letterSpacing: 0.8, color: C.text3, textTransform: "uppercase", opacity: kq(640) }}>Runway left after launch</div>
        {bars.map(([l, m], i) => {
          const q = ease(f, 646 + i * 8, 666 + i * 8, 0, 1), best = i === 0;
          return (
            <div key={l} style={{ position: "absolute", left: 36, right: 36, top: 324 + i * 62, height: 44, display: "flex", alignItems: "center", gap: 16, opacity: q }}>
              <span style={{ width: 150, fontSize: 18, fontWeight: 700 }}>{l}</span>
              <span style={{ flex: 1, height: 26, borderRadius: 8, background: C.tint, overflow: "hidden" }}><span style={{ display: "block", width: `${(m / 14) * 100 * q}%`, height: "100%", borderRadius: 8, background: best ? (go ? C.green : C.accent) : "#CFC9BC" }} /></span>
              <span style={{ width: 70, textAlign: "right", fontSize: 19, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{m} mo</span>
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 36, right: 36, top: 540, height: 160, borderRadius: 18, padding: "20px 26px", boxSizing: "border-box", opacity: kq(672),
          background: go ? "#E6F2EC" : "#FBF1E1", border: `2px solid ${go ? C.green : "#E9C27F"}`, transform: `scale(${go ? 1 + 0.04 * (1 - ease(f, 728, 744, 0, 1)) : 1})` }}>
          <div style={{ fontFamily: brand.mono, fontSize: 14, fontWeight: 700, letterSpacing: 1, color: go ? C.green : C.amber }}>RECOMMENDATION</div>
          <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1, marginTop: 8 }}>{go ? "UK first, Q2." : "Wait a quarter. Fix onboarding."}</div>
          <div style={{ fontSize: 17, color: C.text2, marginTop: 6 }}>{go ? "France in Q4 if churn stays under 20%." : "A second market doubles the support load at 31% churn."}</div>
        </div>
      </div>
    </Blur>
  );

  // caption over the stage
  let ci = -1; CAPS.forEach(([at], i) => { if (f >= at || (i === 0 && raw >= 12)) ci = i; });
  const capAt = ci >= 0 ? CAPS[ci][0] : 0;
  const capNext = ci >= 0 && ci < CAPS.length - 1 ? CAPS[ci + 1][0] : 856 - LEAD;
  const capIn = ci < 0 ? 0 : ease(raw, capAt + LEAD, capAt + LEAD + 12, 0, 1) * (1 - ease(raw, capNext + LEAD - 10, capNext + LEAD, 0, 1));
  const REC = { x: PANEL.x + PANEL.w / 2, y: PANEL.y + 620 };

  return (
    <SceneShell push={[1, 1]} noExit>
      <DarkStage frame={0} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${960 - cx * z}px, ${540 - cy * z}px) scale(${z})` }}>
        {build < 1 ? <Tilt3D p={build} frame={raw} rx={12} ry={-8} z={-220} float={false} origin={`${SIDEBAR_LOGO.x}px ${SIDEBAR_LOGO.y}px`} style={{ position: "absolute", inset: 0 }}>{window}{panelA}</Tilt3D>
          : <>{window}{panelA}</>}
        {build >= 1 && (
          <>
            {chat}
            {composer}
            {go && <Glow x={REC.x} y={REC.y} r={300} color="rgba(63,143,107,0.18)" frame={f} p={ease(f, 728, 748, 0, 1)} />}
            {panelB}
            {raw >= LEAD && <Cursor x={cur.x} y={cur.y} scale={(1 / Math.max(1, z * 0.85)) * Math.min(...PRESSES.map((p) => pressFx(f, p).squish))} />}
            {PRESSES.map((p) => f >= p && f < p + 14 && (
              <div key={p} style={{ position: "absolute", left: cur.x + 5 - 22, top: cur.y + 4 - 22, width: 44, height: 44, borderRadius: 22, border: `2px solid ${C.accent}`, opacity: 1 - (f - p) / 14, transform: `scale(${0.4 + (f - p) / 14})` }} />
            ))}
          </>
        )}
      </div>
      {ci >= 0 && capIn > 0.01 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 46, display: "flex", justifyContent: "center", opacity: capIn, transform: `translateY(${(1 - capIn) * -14}px)` }}>
          <div style={{ background: "rgba(28,27,24,0.86)", borderRadius: 999, padding: "14px 34px", fontFamily: brand.font, fontSize: 40, fontWeight: 700, letterSpacing: -1, color: "#F4F3EE", boxShadow: "0 20px 40px -20px rgba(0,0,0,0.6)" }}>{CAPS[ci][1]}</div>
        </div>
      )}
      {raw < LEAD && (() => {
        const kk = ease(raw, 0, LEAD - 4, 0, 1), size = MARK.size + (SIDEBAR_LOGO.size - MARK.size) * kk;
        const x = MARK.cx - MARK.size / 2 + (SIDEBAR_LOGO.x - (MARK.cx - MARK.size / 2)) * kk, y = MARK.cy - MARK.size / 2 + (SIDEBAR_LOGO.y - (MARK.cy - MARK.size / 2)) * kk;
        return <div style={{ position: "absolute", left: x, top: y, opacity: 1 - ease(raw, LEAD - 6, LEAD, 0, 1) }}><BrandMark size={size} /></div>;
      })()}
      {toCta > 0 && (() => { const p = S(REC); return <Wipe x={p.x} y={p.y} p={toCta}><CtaBackdrop /></Wipe>; })()}
    </SceneShell>
  );
};
