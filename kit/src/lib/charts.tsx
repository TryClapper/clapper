// Charts that show change moving. Dark-UI defaults; pass colours to restyle.
import React from "react";
import { ease } from "./motion";
import { D } from "./product";

/** Line chart that draws itself point by point, then the last point jumps to its final value with a
 *  glow and a value tag. Use for "went up / went down" stories (pass rate by version, cost per month…). */
export const LineChart: React.FC<{
  frame: number; start: number; w: number; h: number; points: [string, number][];
  lo: number; hi: number; grid?: number[]; fmt?: (v: number) => string; color?: string; prevColor?: string;
}> = ({ frame, start, w, h, points, lo, hi, grid = [], fmt = (v) => `${v}`, color = D.green, prevColor = D.amberText }) => {
  const pad = { l: 64, r: 44, t: 30, b: 44 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const X = (i: number) => pad.l + (iw * i) / (points.length - 1), Y = (v: number) => pad.t + ih * (1 - (v - lo) / (hi - lo));
  const n = points.length - 1, draw = ease(frame, start, start + 34, 0, n - 1), jump = ease(frame, start + 36, start + 56, 0, 1);
  const pts = points.map(([, v], i) => ({ x: X(i), y: Y(i < n ? v : points[n - 1][1] + (v - points[n - 1][1]) * jump) }));
  const k = Math.floor(draw), f = draw - k;
  const shown = [...pts.slice(0, k + 1), ...(k < n - 1 ? [{ x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f }] : [])];
  const line = shown.map((q, i) => `${i ? "L" : "M"}${q.x} ${q.y}`).join(" ") + (jump > 0 ? ` L${pts[n].x} ${pts[n].y}` : "");
  const area = `${line} L${jump > 0 ? pts[n].x : shown[shown.length - 1].x} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
  const id = `lc${Math.round(w)}${Math.round(h)}`;
  return (
    <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {grid.map((g) => (
        <g key={g}><line x1={pad.l} x2={pad.l + iw} y1={Y(g)} y2={Y(g)} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 6" />
          <text x={pad.l - 14} y={Y(g) + 5} textAnchor="end" fontSize="13" fill={D.text3} fontFamily={D.mono}>{fmt(g)}</text></g>
      ))}
      {points.map(([lbl], i) => <text key={lbl} x={X(i)} y={h - 14} textAnchor="middle" fontSize="13" fill={D.text3} fontFamily={D.mono}>{lbl}</text>)}
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
      {shown.slice(0, k + 1).map((q, i) => <circle key={i} cx={q.x} cy={q.y} r="5" fill={D.window} stroke={color} strokeWidth="2.5" />)}
      {jump > 0 && (
        <g>
          <circle cx={pts[n].x} cy={pts[n].y} r={10 + 12 * Math.abs(Math.sin(frame * 0.12))} fill={color} opacity={0.15} />
          <circle cx={pts[n].x} cy={pts[n].y} r="7" fill={color} stroke={D.window} strokeWidth="3" />
          <g transform={`translate(${pts[n].x - 70}, ${pts[n].y - 50})`} opacity={jump}>
            <rect width="78" height="30" rx="8" fill={color} /><text x="39" y="20" textAnchor="middle" fontSize="15" fontWeight="700" fill="#06120B" fontFamily={D.font}>{fmt(points[n][1])}</text>
          </g>
          <text x={pts[n - 1].x} y={pts[n - 1].y + 30} textAnchor="middle" fontSize="13" fontWeight="600" fill={prevColor} fontFamily={D.font}>{fmt(points[n - 1][1])}</text>
        </g>
      )}
    </svg>
  );
};

/** Before/after bars: "before" grey, "after" grows in colour. */
export const BarCompare: React.FC<{ frame: number; start: number; w: number; rows: [string, number, string][]; max: number; colors?: [string, string] }> = ({ frame, start, w, rows, max, colors = ["#3A4150", D.green] }) => (
  <div style={{ width: w, display: "flex", flexDirection: "column", gap: 18, fontFamily: D.font }}>
    {rows.map(([label, v, txt], i) => {
      const p = ease(frame, start + i * 10, start + i * 10 + 40, 0, v / max);
      return (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: i ? D.text : D.text2, marginBottom: 8 }}><span>{label}</span><span style={{ fontWeight: 600 }}>{txt}</span></div>
          <div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,0.06)" }}><div style={{ width: `${p * 100}%`, height: "100%", borderRadius: 5, background: colors[Math.min(i, 1)] }} /></div>
        </div>
      );
    })}
  </div>
);
