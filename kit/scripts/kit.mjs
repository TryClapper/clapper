#!/usr/bin/env node
// launch-kit CLI. All output is short on purpose: every line printed here is
// read by Claude, so no progress bars, no render logs.
//
//   node scripts/kit.mjs status                 scene table: frames, start, status, cache, VO budget, DEAD AIR, LAYOUT, HARD-CODED TEXT
//   node scripts/kit.mjs still s02 90 [s03 0]   small JPEG stills (40% scale) → out/stills/
//   node scripts/kit.mjs scene s02 [s03]        render scenes if changed, then report empty-frame runs
//   node scripts/kit.mjs seams                  (also BARE STAGE: nothing on screen 10 frames either side of a cut)
//   node scripts/kit.mjs seams                  compare the last frame of each scene with the first of the next
//   node scripts/kit.mjs build                  render changed scenes, stitch, mux audio, verify
//
// Env: REMOTION_BROWSER (path to Chrome if the download is blocked), SCALE (still scale, default 0.4), CONCURRENCY, PRESET (x264, default veryfast; use slow for delivery)
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { hardCodedText, report as textReport } from "./text-check.mjs";
import { allowedRoots, guardWebpack } from "./bundle-guard.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");
const SCENES_DIR = path.join(OUT, "scenes");
const spec = JSON.parse(readFileSync("video.json", "utf8"));
// video.json is written by the agent and this script may run outside its sandbox: scene ids and component names
// become file paths and ffmpeg concat entries, so only plain names and whole frame counts get through.
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
if (!Array.isArray(spec.scenes) || !spec.scenes.length) { console.error("error: video.json has no scenes"); process.exit(1); }
for (const s of spec.scenes) {
  if (!NAME.test(String(s.id)) || !NAME.test(String(s.component)) || !Number.isInteger(s.frames) || s.frames <= 0) {
    console.error(`error: scene ${JSON.stringify(s.id)}: id and component must be letters, digits, - or _ (≤ 40), frames a positive whole number`);
    process.exit(1);
  }
}
const { fps } = spec.meta;
if (!Number.isInteger(fps) || fps <= 0 || fps > 120) { console.error("error: meta.fps must be a whole number 1-120"); process.exit(1); }
const total = spec.scenes.reduce((n, s) => n + s.frames, 0);
const [cmd = "status", ...args] = process.argv.slice(2);
const browserExecutable = process.env.REMOTION_BROWSER || null; // set if Chrome download is blocked
const concurrency = Number(process.env.CONCURRENCY) || Math.max(1, cpus().length);

// ---------- cache ----------
const readAll = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? readAll(path.join(dir, e.name)) : [readFileSync(path.join(dir, e.name))]
  );
const libHash = createHash("sha256");
for (const b of readAll("src/lib")) libHash.update(b);
const LIB = libHash.digest("hex");

const sceneHash = (s) => {
  const h = createHash("sha256");
  const file = `src/scenes/${s.component}.tsx`;
  h.update(JSON.stringify({ s: { ...s, status: undefined, vo: undefined }, brand: spec.brand, meta: spec.meta, shared: spec.shared }));
  h.update(LIB);
  if (existsSync(file)) h.update(readFileSync(file));
  return h.digest("hex").slice(0, 12);
};
const cached = (s) => path.join(SCENES_DIR, `${s.id}.${sceneHash(s)}.mp4`);
const isCached = (s) => existsSync(cached(s));

// ---------- helpers ----------
const find = (id) => {
  const s = spec.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`no scene "${id}" in video.json (have: ${spec.scenes.map((x) => x.id).join(", ")})`);
  return s;
};
let serveUrl;
// the scenes may import only from this folder and the packages (bundle-guard.mjs)
const getBundle = async () => (serveUrl ??= await bundle({
  entryPoint: path.join(ROOT, "src/index.ts"), onProgress: () => {}, webpackOverride: guardWebpack(allowedRoots(ROOT)),
}));
// Each bundle is a ~75 MB copy of the project in the temp folder: remove it when the command ends, or a day of renders fills the disk.
process.on("exit", () => { if (serveUrl && !/^https?:/.test(serveUrl)) rmSync(serveUrl, { recursive: true, force: true }); });
const comp = async (id) => selectComposition({ serveUrl: await getBundle(), id, logLevel: "error", browserExecutable });

const renderScene = async (s) => {
  if (isCached(s)) return console.log(`${s.id} cached`);
  const t = Date.now();
  mkdirSync(SCENES_DIR, { recursive: true });
  for (const f of readdirSync(SCENES_DIR)) if (f.startsWith(`${s.id}.`)) rmSync(path.join(SCENES_DIR, f)); // drop stale versions
  await renderMedia({
    composition: await comp(s.id), serveUrl: await getBundle(), codec: "h264", crf: 16,
    pixelFormat: "yuv420p", muted: true, concurrency, logLevel: "error", outputLocation: cached(s), browserExecutable,
  });
  console.log(`${s.id} rendered ${s.frames}f in ${((Date.now() - t) / 1000).toFixed(1)}s`);
};

// Runs of frames that are just background (luma range < 8) longer than `min` frames.
const emptyRuns = (file, min = 20) => {
  const csv = execFileSync("ffprobe", ["-v", "error", "-f", "lavfi", "-i", `movie=${file},signalstats`,
    "-show_entries", "frame_tags=lavfi.signalstats.YMIN,lavfi.signalstats.YMAX", "-of", "csv=p=0"], { maxBuffer: 1 << 26 }).toString();
  const empty = csv.trim().split("\n").map((l) => { const [a, b] = l.split(",").map(Number); return Math.abs(b - a) < 8; });
  const runs = [];
  for (let i = 0, st = -1; i <= empty.length; i++) {
    if (empty[i] && st < 0) st = i;
    if (!empty[i] && st >= 0) { if (i - st > min) runs.push(`${st}-${i - 1}`); st = -1; }
  }
  return runs;
};

const probe = (file) =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=nb_read_frames,r_frame_rate,pix_fmt,color_range:format=duration", "-of", "json", file]).toString());

// Where each voice line ends inside its scene (frames), from public/audio/vo/timing.json and the clips.
const voEnds = () => {
  const t = "public/audio/vo/timing.json";
  if (!existsSync(t)) return {};
  const ends = {};
  for (const ln of JSON.parse(readFileSync(t, "utf8"))) {
    // written by the agent: only its own clips, never a path elsewhere
    if (!/^public\/audio\/vo\/[A-Za-z0-9_-]{1,40}\.mp3$/.test(String(ln.file))) continue;
    const st = lstatSync(ln.file, { throwIfNoEntry: false });
    if (!st?.isFile() || st.nlink !== 1 || lstatSync("public/audio/vo").isSymbolicLink() || lstatSync("public/audio").isSymbolicLink() || lstatSync("public").isSymbolicLink()) continue;
    let secs;
    try { secs = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ln.file], { timeout: 15000 }).toString()); } catch { continue; }
    if (!Number.isFinite(secs)) continue;
    ends[ln.scene] = Math.max(ends[ln.scene] ?? 0, Number(ln.frame) + Math.round(secs * fps));
  }
  return ends;
};

// Layout problems the style's code can't fix by itself (each printed as LAYOUT; fix them before the build).
const layoutProblems = () => {
  const out = [];
  return out;
};

// ---------- commands ----------
const status = () => (spec.meta.voice === false ? readStatus() : voiceStatus());

const voiceStatus = () => {
  let start = 0;
  const ends = voEnds();
  const quiet = [];
  console.log("id   start  frames  status    cache  VO(words/budget)  name");
  for (const s of spec.scenes) {
    const words = s.vo ? s.vo.trim().split(/\s+/).length : 0;
    const budget = Math.floor(((s.frames / fps) - 0.3) * 2.3);
    const vo = `${words}/${budget}${words > budget ? " OVER" : ""}`;
    console.log(`${s.id.padEnd(4)} ${String(start).padStart(5)}  ${String(s.frames).padStart(6)}  ${s.status.padEnd(8)}  ${isCached(s) ? "yes" : "no "}    ${vo.padEnd(16)}  ${s.name}`);
    const last = s === spec.scenes[spec.scenes.length - 1];
    if (!last && ends[s.id] !== undefined && s.frames - ends[s.id] > 0.5 * fps)
      quiet.push(`${s.id}: ${((s.frames - ends[s.id]) / fps).toFixed(1)} s with no voice after its line; trim the scene to end about 0.3 s after the line (${ends[s.id] + Math.round(0.3 * fps)} frames)`);
    start += s.frames;
  }
  console.log(`total ${total}f = ${(total / fps).toFixed(3)}s`);
  for (const q of quiet) console.log(`DEAD AIR ${q}`);
  for (const l of layoutProblems()) console.log(`LAYOUT ${l}`);
  printHardCoded();
};

// With no voice (meta.voice false) the on-screen words carry the story: each scene must hold long enough to
// read them, about 3 words a second plus a second to take it in.
const READ_WPS = 3;
const wordsIn = (v) =>
  typeof v === "string" ? v.trim().split(/\s+/).filter(Boolean).length
  : Array.isArray(v) ? v.reduce((n, x) => n + wordsIn(x), 0)
  : v && typeof v === "object" ? Object.values(v).reduce((n, x) => n + wordsIn(x), 0)
  : 0;
const readStatus = () => {
  let start = 0;
  const long = [];
  console.log("id   start  frames  status    cache  READ TIME(words/fits)  name");
  for (const s of spec.scenes) {
    const words = wordsIn(s.props);
    const fits = Math.max(1, Math.floor((s.frames / fps - 1) * READ_WPS));
    const read = `${words}/${fits}${words > fits ? " OVER" : ""}`;
    console.log(`${s.id.padEnd(4)} ${String(start).padStart(5)}  ${String(s.frames).padStart(6)}  ${s.status.padEnd(8)}  ${isCached(s) ? "yes" : "no "}    ${read.padEnd(21)}  ${s.name}`);
    if (words > fits) long.push(`${s.id}: ${words} words on screen in ${(s.frames / fps).toFixed(1)} s (fits ${fits}); cut words or lengthen the scene to ${Math.ceil((words / READ_WPS + 1) * fps)} frames`);
    start += s.frames;
  }
  console.log(`total ${total}f = ${(total / fps).toFixed(3)}s`);
  for (const l of long) console.log(`TOO MUCH TO READ ${l}`);
  printHardCoded();
};

// Words typed into scene code instead of video.json can't be changed in the app's edit section (it only shows
// video.json). Never fatal: a warning to fix before the build.
const printHardCoded = () => {
  try {
    for (const ln of textReport(hardCodedText(ROOT, spec.scenes.map((s) => String(s.component))))) console.log(ln);
  } catch (e) {
    console.log(`text check skipped: ${String(e.message).split("\n")[0]}`);
  }
};

const still = async () => {
  if (args.length < 2 || args.length % 2) throw new Error("usage: still <sceneId> <frame> [<sceneId> <frame> ...]");
  const scale = Number(process.env.SCALE) || 0.4;
  mkdirSync(path.join(OUT, "stills"), { recursive: true });
  for (let i = 0; i < args.length; i += 2) {
    const s = find(args[i]), frame = Math.min(Number(args[i + 1]), s.frames - 1);
    const output = path.join(OUT, "stills", `${s.id}-${frame}.jpg`);
    await renderStill({ composition: await comp(s.id), serveUrl: await getBundle(), frame, scale, imageFormat: "jpeg", jpegQuality: 70, output, logLevel: "error", browserExecutable });
    console.log(output);
  }
};

const scene = async () => {
  if (!args.length) throw new Error("usage: scene <sceneId> [...]");
  for (const id of args) {
    const s = find(id);
    await renderScene(s);
    const runs = emptyRuns(cached(s));
    console.log(`${s.id} check: ${runs.length ? `empty frames ${runs.join(", ")}` : "ok"}`);
  }
};

const build = async () => {
  for (const s of spec.scenes) await renderScene(s); // anything Lambda didn't do
  const list = path.join(OUT, "concat.txt");
  writeFileSync(list, spec.scenes.map((s) => `file '${cached(s)}'`).join("\n"));
  const p = probe(cached(spec.scenes[0])).streams[0];
  const fullRange = p.pix_fmt === "yuvj420p" || p.color_range === "pc";
  const vf = (fullRange ? "scale=in_range=full:out_range=limited," : "") + "format=yuv420p";
  const mix = ["public/audio/mix.wav", "public/audio/mix.mp3"].find(existsSync);
  const final = path.join(OUT, "final.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, ...(mix ? ["-i", mix] : []),
    "-vf", vf, "-c:v", "libx264", "-crf", "16", "-preset", process.env.PRESET || "veryfast",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    ...(mix ? ["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-t", String(total / fps)] : ["-an"]),
    "-movflags", "+faststart", final]);
  const f = probe(final);
  const v = f.streams[0];
  // a blank stretch in the stitched film is a hand-off with nothing on screen: never OK
  const blank = emptyRuns(final, 3).map((r) => r.split("-").map((n) => (Number(n) / fps).toFixed(2) + "s").join("-"));
  const ok = Number(v.nb_read_frames) === total && v.pix_fmt === "yuv420p" && !blank.length;
  printHardCoded();
  console.log(`final ${final}: ${v.nb_read_frames}/${total}f ${v.r_frame_rate} ${v.pix_fmt} ${Number(f.format.duration).toFixed(3)}s audio:${mix ? "yes" : "none"} ${ok ? "OK" : "MISMATCH"}`);
  if (blank.length) console.log(`blank frames (nothing on screen) at ${blank.join(", ")}: overlap the outgoing and incoming scene so something is always visible, then build again`);
};


// Connected cuts: the last frame of scene N and the first frame of scene N+1 should be identical.
// Renders both as PNG, diffs them with ffmpeg and prints one line per cut; on a jump it writes
// out/stills/seam-<a>-<b>.png (last | first | difference) to look at.
const seams = async () => {
  const scale = Number(process.env.SCALE) || 0.4;
  const dir = path.join(OUT, "stills"); mkdirSync(dir, { recursive: true });
  for (let i = 0; i < spec.scenes.length - 1; i++) {
    const a = spec.scenes[i], b = spec.scenes[i + 1];
    const fa = path.join(dir, `seam-${a.id}-last.png`), fb = path.join(dir, `seam-${b.id}-first.png`);
    await renderStill({ composition: await comp(a.id), serveUrl: await getBundle(), frame: a.frames - 1, scale, imageFormat: "png", output: fa, logLevel: "error", browserExecutable });
    await renderStill({ composition: await comp(b.id), serveUrl: await getBundle(), frame: 0, scale, imageFormat: "png", output: fb, logLevel: "error", browserExecutable });
    const out = execFileSync("ffmpeg", ["-v", "error", "-i", fa, "-i", fb, "-filter_complex",
      "[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=difference,format=gray,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8" });
    const avg = Number((out.match(/YAVG=([\d.]+)/) || [])[1] || 0), max = Number((out.match(/YMAX=(\d+)/) || [])[1] || 0);
    const ok = avg < 0.15; // a few anti-aliased pixels may differ; a real jump moves the average
    if (!ok) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", fa, "-i", fb, "-filter_complex",
      "[0:v]split[a][x];[1:v]split[b][y];[a]format=gbrp[a2];[b]format=gbrp[b2];[a2][b2]blend=all_mode=difference,eq=contrast=6,format=rgb24[d];[x]format=rgb24[x2];[y]format=rgb24[y2];[x2][y2][d]hstack=inputs=3", path.join(dir, `seam-${a.id}-${b.id}.png`)]);
    console.log(`${a.id}→${b.id} ${ok ? "seamless" : "JUMP"} (diff avg ${avg.toFixed(2)}, max ${max})${ok ? "" : `  see out/stills/seam-${a.id}-${b.id}.png`}`);
    // never a bare stage across the cut: 10 frames before it or 10 after, something must be on screen (text, UI)
    const ba = path.join(dir, `bare-${a.id}-end.png`), bb = path.join(dir, `bare-${b.id}-start.png`);
    await renderStill({ composition: await comp(a.id), serveUrl: await getBundle(), frame: Math.max(0, a.frames - 10), scale, imageFormat: "png", output: ba, logLevel: "error", browserExecutable });
    await renderStill({ composition: await comp(b.id), serveUrl: await getBundle(), frame: Math.min(10, b.frames - 1), scale, imageFormat: "png", output: bb, logLevel: "error", browserExecutable });
    const ea = edges(ba), eb = edges(bb);
    if (ea < BARE && eb < BARE) console.log(`${a.id}→${b.id} BARE STAGE (nothing on screen 10 frames either side of the cut: edges ${ea.toFixed(2)} / ${eb.toFixed(2)}); start the next scene's first element at once or hold the last one longer  see out/stills/bare-${a.id}-end.png`);
  }
};

// How much drawn detail a still has (mean of an edge map): a background, glow or gradient alone is near 0; any text or
// UI raises it. Under BARE the frame shows nothing.
const BARE = 0.15; // calibrated 2026-11-19: small or dark-stage type reads at 0.19+, an empty stage or a heavy blur at < 0.02
const edges = (file) => {
  const out = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "format=gray,edgedetect=low=0.08:high=0.2,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8" });
  return Number((out.match(/YAVG=([\d.]+)/) || [])[1] || 0);
};

const cmds = { status, still, scene, seams, build };
if (!cmds[cmd]) { console.error(`unknown command "${cmd}" (status | still | scene | seams | build)`); process.exit(1); }
try { await cmds[cmd](); } catch (e) { console.error(`error: ${e.message.split("\n")[0]}`); process.exit(1); }
