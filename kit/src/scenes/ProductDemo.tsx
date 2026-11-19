import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  Bell, Bot, ChartColumn, CircleCheck, CircleX, Folder, Layers, LayoutDashboard, ListChecks, MessagesSquare, Play, Radio, Rocket, Search, Settings, Share2, Sparkles, Users, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SceneShell } from "../lib/SceneShell";
import { arc, count, ease, enter, pressFx, shake } from "../lib/motion";
import { Cursor, GRAD, Persona, Tour } from "../lib/ui";
import { Badge, Btn, CTRL, Crumbs, D, Panel, Pressable, S, Sidebar, Tabs, TitleBar, Verdict, navCenterY } from "../lib/product";
import { LineChart } from "../lib/charts";
import { Blur, Glow, Wipe } from "../lib/fx";
import { BrandMark, Build3D, CtaBackdrop, DarkStage, LEAD, MARK, SIDEBAR_LOGO } from "../lib/handoff";

// TEMPLATE: a product demo built from the kit. Copy it, rename it, and change props + timings for a new
// product. It shows every pattern: full screen → zoom; curved cursor → real press; button state
// (Running… → Completed); a live list; score rows that fill then stamp a verdict; a tour callout; a nav
// click that swaps the page; stats that count; a line chart that jumps. Every frame constant is here.
// Connected cuts: for the first LEAD frames the window builds in 3D around the brand mark handed over by
// ProblemStack (all timings below are after LEAD); new pages whip in with motion blur; a glow sits behind
// what failed; the scene ends with a circle wipe from the chart's last point into the CTA's backdrop.
export const T = { press: 60, done: 170, nav: 278, swap: 282, chart: 296 };
const END_WIPE = [LEAD + 462, LEAD + 480] as const; // raw frames (scene length = LEAD + 480)
export const ITEM_RUN = (i: number) => 64 + i * 8, ITEM_DONE = (i: number) => 100 + i * 10, ROW = (i: number) => 100 + i * 12;

// layout — equal margin, one grid
const M = 88, AX = M, AY = M, AW = 1920 - 2 * M, AH = 1080 - 2 * M, CH = 52, TOP = AY + CH, SB = 248;
const MAINX = AX + SB, PX = MAINX + 40, PW = AW - SB - 80, PR = PX + PW;
const PY = TOP + 32, HDR = 66, TY = PY + HDR + 24, CY = TY + CTRL + 20, CB = AY + AH - 28;
const LIST_W = 440, ROWS_X = PX + LIST_W + S.lg, ROWS_W = PR - ROWS_X, ROW_Y = (i: number) => CY + 52 + 28 + i * 84;
const CHART_W = PW - 540;
const PASTEL = ["#FDDCA8", "#C7D2FE", "#BBF7D0", "#FBCFE8", "#BAE6FD", "#FDE68A", "#DDD6FE", "#FECACA"];

const ICON: Record<string, LucideIcon> = { layout: LayoutDashboard, folder: Folder, play: Play, chart: ChartColumn, users: Users, settings: Settings, bell: Bell,
  search: Search, list: ListChecks, rocket: Rocket, sparkles: Sparkles, bot: Bot, radio: Radio, layers: Layers, message: MessagesSquare };

// camera keyframes [frame, focusX, focusY, zoom]; zoom frames cut just below the title bar
const frameAt = (z: number): [number, number, number] => [MAINX + 960 / z, TOP + 8 + 540 / z, z];
const F: [number, number, number] = [960, 540, 1], Cz = frameAt(1.28), Ce = frameAt(1.24);
const KEYS: [number, [number, number, number]][] = [[0, F], [76, F], [102, Cz], [230, Cz], [252, F], [300, F], [324, Ce], [480, Ce]];
const cam = (f: number) => {
  for (let i = 0; i < KEYS.length - 1; i++) { const [f0, a] = KEYS[i], [f1, b] = KEYS[i + 1]; if (f <= f1) { const k = ease(f, f0, f1, 0, 1); return a.map((v, j) => v + (b[j] - v) * k); } }
  return KEYS[KEYS.length - 1][1];
};

type Row = [string, string, number, "pass" | "fail" | "warn"];
type Props = {
  app: { brand: string; user: string; org: string };
  nav: [string, [string, string][]][];
  list: { url: string; crumbs: string[]; title: string; tabs: string[]; nav: string; action: string; listTitle: string; items: [string, string][]; rowsTitle: string; rows: Row[] };
  report: { url: string; crumbs: string[]; title: string; tabs: string[]; nav: string; stats: [string, number, number, string, string][]; chartTitle: string; points: [string, number][]; lo: number; hi: number; grid: number[]; unit: string };
  tours: { eyebrow: string; title: string; body: string; chips?: [string, "pass" | "fail" | "warn" | "accent"][] }[];
};

export const ProductDemo: React.FC<Props> = (p) => {
  const raw = useCurrentFrame();
  const frame = Math.max(0, raw - LEAD);
  const { fps } = useVideoConfig();
  const nav = p.nav.map(([s, items]) => [s, items.map(([n, ic]) => [n, ICON[ic] ?? Folder])] as [string, [string, LucideIcon][]]);
  const [fx, fy, z] = cam(frame);
  const report = frame >= T.swap, pg = report ? p.report : p.list, pin = report ? ease(frame, T.swap, T.swap + 8, 0, 1) : 1;
  const state = frame < T.press + 8 ? "idle" : frame < T.done ? "running" : "done";

  // cursor: rest → primary action → rest → sidebar item (tip offset ≈ 5, 4)
  const REST = { x: 1868, y: 1046 }, ACT = { x: PR - 80 - 5, y: PY + HDR / 2 - 4 }, NAVP = { x: AX + 100 - 5, y: navCenterY(nav, TOP, p.report.nav) - 4 };
  const MOVES: [number, number, { x: number; y: number }, { x: number; y: number }][] = [[36, 58, REST, ACT], [70, 86, ACT, REST], [254, 276, REST, NAVP]];
  let cur = REST;
  for (const [f0, f1, a, b] of MOVES) { if (frame >= f1) cur = b; else if (frame >= f0) { cur = arc(a, b, ease(frame, f0, f1, 0, 1)); break; } }
  const presses = [T.press, T.nav];
  const tourOff = (a: number, b: number) => enter(frame, fps, a) * (1 - ease(frame, b - 8, b, 0, 1));
  const bgIn = 1; // the dark stage is already open: ProblemStack's wipe revealed it
  const build = ease(raw, 2, LEAD, 0, 1);
  const swapX = (f: number) => (report ? (1 - ease(f, T.swap, T.swap + 16, 0, 1)) * 180 : 0), swapV = swapX(frame) - swapX(frame - 1);
  // closing wipe: from the chart's last point (screen px) into the CTA's backdrop
  const r = p.report, Y2c = CY + 132 + 20, ch = CB - Y2c - 52, last = r.points[r.points.length - 1][1];
  const endPt = { x: PX + CHART_W - 44, y: Y2c + 52 + 30 + (ch - 74) * (1 - (last - r.lo) / (r.hi - r.lo)) };
  const toCta = ease(raw, END_WIPE[0], END_WIPE[1], 0, 1);
  const failRow = p.list.rows.findIndex((row) => row[3] === "fail");

  return (
    <SceneShell push={[1, 1]} noExit>
      <DarkStage frame={frame} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${960 - fx * z}px, ${540 - fy * z}px) scale(${z})`, opacity: bgIn, fontFamily: D.font, color: D.text }}>
        <Build3D p={build} frame={raw} origin={`${SIDEBAR_LOGO.x}px ${SIDEBAR_LOGO.y}px`}>
        <div style={{ position: "absolute", left: AX, top: AY, width: AW, height: AH, borderRadius: 16, overflow: "hidden", background: D.window, border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 60px 140px -40px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.05)" }}>
          <TitleBar w={AW} h={CH} url={pg.url} />
        </div>
        <Sidebar x={AX} y={TOP} w={SB} h={AH - CH} brand={p.app.brand} mark={<BrandMark size={SIDEBAR_LOGO.size} />} nav={nav} active={pg.nav} pressed={[p.report.nav, pressFx(frame, T.nav).dark]}
          user={<><Persona name={p.app.user} size={30} bg="#C7D2FE" /><div><div style={{ fontSize: 14, fontWeight: 600 }}>{p.app.user}</div><div style={{ fontSize: 12, color: D.text3 }}>{p.app.org}</div></div></>} />

        <Blur id="pageSwap" vx={swapV} k={0.5} style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transform: `translateX(${swapX(frame)}px)` }}>
        <div style={{ position: "absolute", left: PX, top: PY, width: PW, height: HDR, display: "flex", alignItems: "center", opacity: pin }}>
          <div><Crumbs items={pg.crumbs} /><div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.9, lineHeight: "40px", marginTop: 6 }}>{pg.title}</div></div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: S.sm }}>
            <Btn Icon={Share2}>Share</Btn>
            {!report && <Pressable frame={frame} at={T.press}>{state === "idle" ? <Btn kind="primary" Icon={Play}>{p.list.action}</Btn> : state === "running" ? <Btn kind="running" spin={frame}>Running…</Btn> : <Btn kind="success" Icon={CircleCheck}>Completed</Btn>}</Pressable>}
          </div>
        </div>
        <div style={{ position: "absolute", left: PX, top: TY, opacity: pin }}><Tabs items={pg.tabs} active={0} /></div>

        {!report && (
          <>
            <Panel x={PX} y={CY} w={LIST_W} h={CB - CY} title={p.list.listTitle} right={<Badge>{p.list.items.length} items</Badge>}>
              <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                {p.list.items.map(([name, meta], i) => {
                  const st = frame < ITEM_RUN(i) ? "Queued" : frame < ITEM_DONE(i) ? "Running" : "Done";
                  return (
                    <div key={name} style={{ height: 56, display: "flex", alignItems: "center", gap: 12, padding: "0 12px", borderRadius: 10, background: st === "Running" ? "rgba(139,147,255,0.07)" : "transparent" }}>
                      <Persona name={name} size={32} bg={PASTEL[i % PASTEL.length]} />
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div><div style={{ fontSize: 13, color: D.text3 }}>{meta}</div></div>
                      <Badge tone={st === "Done" ? "pass" : st === "Running" ? "accent" : "neutral"}>{st}</Badge>
                    </div>
                  );
                })}
              </div>
            </Panel>
            <Panel x={ROWS_X} y={CY} w={ROWS_W} h={CB - CY} title={p.list.rowsTitle} right={<Badge tone="accent" Icon={Zap}>Live</Badge>}>
              {p.list.rows.map(([name, val, score, v], i) => {
                const r0 = ROW(i), q = enter(frame, fps, r0 - 8), done = frame >= r0 + 22, vv = enter(frame, fps, r0 + 22), fill = ease(frame, r0, r0 + 20, 0, score);
                const c = v === "pass" ? D.green : v === "fail" ? D.red : D.amber;
                return (
                  <div key={name} style={{ position: "absolute", left: 24, right: 24, top: ROW_Y(i) - CY - 52, height: 56, opacity: frame < r0 - 8 ? 0 : Math.min(1, q * 1.5),
                    transform: `${v === "fail" ? shake(frame, r0 + 22, 5, 0.3) : ""} translateX(${(1 - q) * -20}px)` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: S.sm, height: 30 }}>
                      <span style={{ fontSize: 19, fontWeight: 500 }}>{name}</span>
                      {!done && frame >= r0 && <span style={{ fontFamily: D.mono, fontSize: 13, color: D.text3 }}>evaluating…</span>}
                      <span style={{ marginLeft: "auto", fontSize: 17, color: D.text2, opacity: done ? 1 : 0 }}>{val}</span>
                      {done ? <Verdict v={v} p={vv} /> : <span style={{ width: 66 }} />}
                    </div>
                    <div style={{ marginTop: 14, height: 7, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{ width: `${fill * 100}%`, height: "100%", borderRadius: 4, background: done ? c : GRAD, boxShadow: done ? `0 0 12px ${c}66` : "none" }} />
                    </div>
                  </div>
                );
              })}
            </Panel>
          </>
        )}

        {report && (() => {
          const w = (PW - 40) / 3, Y2 = CY + 132 + 20, k = ease(frame, T.swap + 4, T.swap + 54, 0, 1);
          return (
            <div style={{ opacity: pin }}>
              {p.report.stats.map(([label, from, to, suffix, delta], i) => (
                <Panel key={label} x={PX + i * (w + 20)} y={CY} w={w} h={132}>
                  <div style={{ padding: "0 22px", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: D.text3, letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</div>
                    <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -1, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{(from + (to - from) * k).toFixed(Number.isInteger(to) && Number.isInteger(from) ? 0 : 1)}{suffix}</div>
                    <div style={{ fontSize: 13, color: D.greenText, fontWeight: 600, marginTop: 2 }}>{delta}</div>
                  </div>
                </Panel>
              ))}
              <Panel x={PX} y={Y2} w={CHART_W} h={CB - Y2} title={p.report.chartTitle} right={<Badge tone="pass" Icon={CircleCheck}>Improved</Badge>}>
                <LineChart frame={frame} start={T.chart} w={CHART_W} h={CB - Y2 - 52} points={p.report.points} lo={p.report.lo} hi={p.report.hi} grid={p.report.grid} fmt={(v) => `${v}${p.report.unit}`} />
              </Panel>
              <Panel x={PX + CHART_W + 20} y={Y2} w={PW - CHART_W - 20} h={CB - Y2} title="Highlights">
                <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {p.report.stats.map(([label, , , , delta], i) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, height: 48, padding: "0 14px", borderRadius: 10, background: D.raised, boxShadow: `inset 0 0 0 1px ${D.line}`, opacity: enter(frame, fps, T.chart + 20 + i * 8) }}>
                      <CircleCheck size={18} color={D.green} /><span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{label}</span><span style={{ fontSize: 14, color: D.greenText, fontWeight: 600 }}>{delta}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          );
        })()}

        </Blur>
        {/* glow behind what failed */}
        {!report && failRow >= 0 && frame >= ROW(failRow) + 22 && <Glow x={ROWS_X + ROWS_W * 0.72} y={ROW_Y(failRow) + 28} r={280} color="rgba(248,113,113,0.16)" frame={frame} p={ease(frame, ROW(failRow) + 22, ROW(failRow) + 40, 0, 1)} />}
        {p.tours[0] && <Tour n={1} p={tourOff(172, 226)} rect={{ x: ROWS_X + 12, y: ROW_Y(1) - 14, w: ROWS_W - 24, h: 84 }} card={{ x: PX + 24, y: CY + 300, w: LIST_W - 48 + 40, h: 170 }}
          Icon={Sparkles} eyebrow={p.tours[0].eyebrow} title={p.tours[0].title} body={p.tours[0].body} chips={p.tours[0].chips} dimColor="rgba(2,4,8,0.62)" />}
        {p.tours[1] && <Tour n={2} p={tourOff(400, 462)} rect={{ x: PX, y: CY + 152, w: CHART_W, h: CB - CY - 152 }} card={{ x: PX + CHART_W + 40, y: CY + 260, w: 480, h: 170 }}
          Icon={ChartColumn} eyebrow={p.tours[1].eyebrow} title={p.tours[1].title} body={p.tours[1].body} chips={p.tours[1].chips} dimColor="rgba(2,4,8,0.62)" />}

        </Build3D>
        {raw >= LEAD && <Cursor x={cur.x} y={cur.y} light scale={(1 / Math.max(1, z * 0.85)) * Math.min(...presses.map((f) => pressFx(frame, f).squish))} />}
        {presses.map((f) => frame >= f && frame < f + 14 && (
          <div key={f} style={{ position: "absolute", left: cur.x + 5 - 22, top: cur.y + 4 - 22, width: 44, height: 44, borderRadius: 22, border: `2px solid ${D.green}`, opacity: 1 - (frame - f) / 14, transform: `scale(${0.4 + (frame - f) / 14})` }} />
        ))}
      </div>
      {/* hand-off in: the mark from ProblemStack lands on the sidebar logo while the window builds */}
      {raw < LEAD && (() => {
        const k = ease(raw, 0, LEAD - 4, 0, 1), size = MARK.size + (SIDEBAR_LOGO.size - MARK.size) * k;
        const x0 = MARK.cx - MARK.size / 2, y0 = MARK.cy - MARK.size / 2;
        return <div style={{ position: "absolute", left: x0 + (SIDEBAR_LOGO.x - x0) * k, top: y0 + (SIDEBAR_LOGO.y - y0) * k, opacity: 1 - ease(raw, LEAD - 6, LEAD, 0, 1) }}><BrandMark size={size} /></div>;
      })()}
      {/* hand-off out: the result point opens into the CTA */}
      {toCta > 0 && <Wipe x={(endPt.x - fx) * z + 960} y={(endPt.y - fy) * z + 540} p={toCta}><CtaBackdrop /></Wipe>}
    </SceneShell>
  );
};
