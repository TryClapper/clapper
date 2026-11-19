"""Generic soundtrack builder: music bed + sound effects + voiceover, mastered to -14 LUFS.

Reads video.json (scene order/lengths) and audio.json:
  {
    "bpm": 120,
    "tension": ["s01"],        # scenes under a low pulse + drone (the problem)
    "riser_into": "s02",       # riser that lands on this scene's first frame (the turn)
    "groove": ["s02"],         # kick, hats, arp (the solution)
    "resolve": "s03",          # impact + held chord, fade to the end (logo / CTA)
    "dip": ["s05", "s06"],     # optional: a quieter stretch while a problem builds mid-video (pads down, no hats/arp, low pulse)
    "lift": "s07",             # optional: where the solution starts. Riser into it, impact, then a bigger groove
                               #   (brighter progression, bass, clap on 2 and 4, open hats, two-octave arp) until "resolve"
    "events": [ {"scene": "s01", "frame": 18, "sound": "thud", "gain": 0.7, "pan": -0.3}, ... ]
  }
Sounds: pop, tick, whoosh, buzz, chime, click (two-part mouse click), thud, blip, typing (needs "chars", "cps").
Voiceover: public/audio/vo/timing.json  [{"scene","frame","file","text"}]  — each clip normalised to -16 LUFS,
music ducked under it. Missing clips are skipped. Writes public/audio/mix.wav (kit.mjs build muxes it in).
"""
import json, os, subprocess, wave
import numpy as np

SR, FPS = 48000, 60
spec = json.load(open("video.json"))
cfg = json.load(open("audio.json")) if os.path.exists("audio.json") else {}
starts, t0 = {}, 0
for s in spec["scenes"]:
    starts[s["id"]] = t0; t0 += s["frames"]
DUR = t0 / FPS; N = int(DUR * SR); t = np.arange(N) / SR
rng = np.random.default_rng(7)
BEAT = 60 / cfg.get("bpm", 120)
mus, sfx = np.zeros((N, 2)), np.zeros((N, 2))
note = lambda m: 440 * 2 ** ((m - 69) / 12)
F = lambda sid, f: (starts[sid] + f) / FPS
sec = lambda sid: (starts[sid] / FPS, (starts[sid] + next(s["frames"] for s in spec["scenes"] if s["id"] == sid)) / FPS)

def add(buf, start, sig, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N or i + len(sig) <= 0: return
    if i < 0: sig, i = sig[-i:], 0
    sig = sig[: N - i] * gain
    buf[i:i + len(sig), 0] += sig * (1 - pan) ** 0.5; buf[i:i + len(sig), 1] += sig * (1 + pan) ** 0.5

def env(n, a, r):
    e = np.ones(n); a, r = max(1, min(n // 2, int(a * SR))), max(1, min(n // 2, int(r * SR))); e[:a] = np.linspace(0, 1, a); e[-r:] *= np.linspace(1, 0, r); return e

# ---- sounds ----
def kick():
    n = int(0.35 * SR); tt = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(50 + 90 * np.exp(-tt * 30)) / SR) * np.exp(-tt * 9)
def hat():
    n = int(0.05 * SR); return np.diff(np.r_[0, rng.standard_normal(n)]) * np.exp(-np.arange(n) / SR * 90) * 0.4
def whoosh(ln=0.35):
    n = int(ln * SR); tt = np.arange(n) / SR
    return np.convolve(rng.standard_normal(n), np.ones(24) / 24, "same") * np.sin(np.pi * tt / ln) ** 2 * 1.6
def tick(f=2400):
    n = int(0.04 * SR); tt = np.arange(n) / SR; return np.sin(2 * np.pi * f * tt) * np.exp(-tt * 120)
def pop(f=700):
    n = int(0.09 * SR); tt = np.arange(n) / SR; return np.sin(2 * np.pi * np.cumsum(f + 600 * np.exp(-tt * 40)) / SR) * np.exp(-tt * 40)
def blip(f=660):
    n = int(0.18 * SR); tt = np.arange(n) / SR; return np.sign(np.sin(2 * np.pi * f * tt)) * np.exp(-tt * 14) * 0.4
def chime(base=76):
    n = int(1.6 * SR); tt = np.arange(n) / SR
    return sum(np.sin(2 * np.pi * note(base + d) * tt) * np.exp(-tt * (3 + i)) for i, d in enumerate([0, 7, 12])) / 3
def buzz(ln=0.4):
    n = int(ln * SR); tt = np.arange(n) / SR
    return (2 * ((tt * 98) % 1) - 1) * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * tt)) * np.exp(-tt * 5) * 0.35
def click():
    n = int(0.14 * SR); out = np.zeros(n)
    for st, f, g in ((0.0, 2200, 1.0), (0.085, 3000, 0.6)):
        i = int(st * SR); m = int(0.025 * SR); u = np.arange(m) / SR
        out[i:i + m] += (np.sin(2 * np.pi * f * u) * 0.6 + rng.standard_normal(m) * 0.4) * np.exp(-u * 260) * g
    m = int(0.03 * SR); u = np.arange(m) / SR; out[:m] += np.sin(2 * np.pi * 140 * u) * np.exp(-u * 120) * 0.5
    return out
def marker(ln=0.48):
    """a marker-pen swipe: band-passed felt noise dragging over paper, a soft landing thump"""
    n = int(ln * SR); tt = np.arange(n) / SR
    x = np.fft.rfft(rng.standard_normal(n)); f = np.fft.rfftfreq(n, 1 / SR)
    x[(f < 900) | (f > 4200)] *= 0.08
    body = np.fft.irfft(x, n)
    k = 18; grain = np.interp(np.linspace(0, k, n), np.arange(k + 1), rng.uniform(0.55, 1.0, k + 1))
    e = np.minimum(1, tt / 0.02) * np.minimum(1, np.maximum(0, (ln - tt) / 0.09))
    out = body * e * grain * (0.75 + 0.25 * np.sin(np.pi * tt / ln)) + np.sin(2 * np.pi * 90 * tt) * np.exp(-tt * 40) * 0.3
    return out / (np.max(np.abs(out)) or 1) * 0.6
SOUNDS = {"marker": marker, "pop": pop, "tick": tick, "whoosh": whoosh, "buzz": buzz, "chime": chime, "click": click, "thud": kick, "blip": blip}

# ---- music ----
tension = [sec(s) for s in cfg.get("tension", [])]
for a, b in tension:  # low pulse + drone
    for k in range(int((b - a) / (BEAT / 2))):
        n = int(0.2 * SR); tt = np.arange(n) / SR; add(mus, a + k * BEAT / 2, np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 14), gain=0.5)
    n = int((b - a) * SR); tt = np.arange(n) / SR
    add(mus, a, (np.sin(2 * np.pi * 110 * tt) + 0.6 * np.sin(2 * np.pi * 116.5 * tt)) * env(n, 0.6, 0.3) * 0.06)
if cfg.get("riser_into"):
    land = sec(cfg["riser_into"])[0]; n = int(1.0 * SR); tt = np.arange(n) / SR
    add(mus, land - 1.0, (rng.standard_normal(n) * 0.22 + np.sin(2 * np.pi * np.cumsum(250 + 1300 * tt ** 2) / SR) * 0.15) * tt ** 2.2)
    add(mus, land, kick(), gain=1.2)
chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]]
dip = [sec(x) for x in cfg.get("dip", [])]
in_dip = lambda x: any(a <= x < b for a, b in dip)
LIFT = sec(cfg["lift"])[0] if cfg.get("lift") else DUR
RESOLVE = sec(cfg["resolve"])[0] if cfg.get("resolve") else DUR
pad_from = min([sec(s)[0] for s in cfg.get("groove", [])] + ([sec(cfg["resolve"])[0]] if cfg.get("resolve") else []) + [LIFT] or [DUR])
seg = 2 * BEAT * 2
k = 0; st = pad_from
while st < LIFT:
    ch = chords[k % 4]; n = int(min(seg + 0.1, DUR - st) * SR); tt = np.arange(n) / SR
    add(mus, st, sum(np.sin(2 * np.pi * note(m) * tt) + 0.25 * np.sin(2 * np.pi * note(m) * 2.004 * tt) for m in ch) * env(n, 0.2, 0.3) / 4, gain=0.12 if in_dip(st) else 0.24)
    st += seg; k += 1
for a, b in [sec(s) for s in cfg.get("groove", [])]:
    b = min(b, LIFT); x = a
    while x < b:
        add(mus, x, kick(), gain=0.45 if in_dip(x) else 0.65)
        if not in_dip(x): add(mus, x + BEAT / 2, hat(), pan=0.3, gain=0.4)
        x += BEAT
    for j in range(int(max(0, b - a) / (BEAT / 4))):
        if in_dip(a + j * BEAT / 4): continue
        n = int(0.14 * SR); tt = np.arange(n) / SR
        add(mus, a + j * BEAT / 4, np.sin(2 * np.pi * note(chords[int(j // 16) % 4][j % 4] + 12) * tt) * np.exp(-tt * 22), pan=0.4 * np.sin(j * 0.7), gain=0.07)
for a, b in dip:  # a low, patient pulse under the mid-video problem
    for j in range(int((b - a) / BEAT)):
        n = int(0.25 * SR); tt = np.arange(n) / SR; add(mus, a + j * BEAT, np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 10), gain=0.35)
if LIFT < DUR:  # the solution: riser, impact, bigger groove until the resolve
    n = int(2.0 * SR); tt = np.arange(n) / SR
    add(mus, LIFT - 2.0, (rng.standard_normal(n) * 0.18 + np.sin(2 * np.pi * np.cumsum(220 + 1500 * (tt / 2) ** 2) / SR) * 0.14) * (tt / 2) ** 2.4)
    n = int(1.4 * SR); tt = np.arange(n) / SR
    add(mus, LIFT, np.convolve(rng.standard_normal(n), np.ones(6) / 6, "same") * np.exp(-tt * 3.2) * 0.22); add(mus, LIFT, kick(), gain=1.4)
    prog, roots = [[53, 57, 60, 65, 69], [48, 55, 60, 64, 67], [55, 59, 62, 67, 71], [57, 60, 64, 69, 72]], [41, 36, 43, 45]  # F C G Am
    k, st = 0, LIFT
    while st < DUR:
        ch = prog[k % 4]; n = int(min(seg + 0.15, DUR - st) * SR); tt = np.arange(n) / SR
        add(mus, st, sum(np.sin(2 * np.pi * note(m) * tt) + 0.3 * np.sin(2 * np.pi * note(m) * 2.003 * tt) + 0.1 * np.sin(2 * np.pi * note(m) * 3.01 * tt) for m in ch) * env(n, 0.05, 0.25) / len(ch), gain=0.56)
        if st < RESOLVE:
            for j in range(8):
                n2 = int(0.22 * SR); t2 = np.arange(n2) / SR
                add(mus, st + j * BEAT / 2, (np.sin(2 * np.pi * note(roots[k % 4]) * t2) + 0.3 * np.sin(2 * np.pi * note(roots[k % 4]) * 2 * t2)) * np.exp(-t2 * 9), gain=0.52)
        st += seg; k += 1
    def clap():
        n = int(0.18 * SR); tt = np.arange(n) / SR; x = np.convolve(rng.standard_normal(n), [1, -1], "same")
        return x * (np.exp(-tt * 28) + 0.6 * np.exp(-np.abs(tt - 0.012) * 300) + 0.5 * np.exp(-np.abs(tt - 0.024) * 300)) * 0.35
    def ohat():
        n = int(0.16 * SR); tt = np.arange(n) / SR; return np.diff(np.r_[0, rng.standard_normal(n)]) * np.exp(-tt * 22) * 0.3
    x, i = LIFT, 0
    while x < RESOLVE:
        add(mus, x, kick(), gain=1.15)
        if i % 2: add(mus, x, clap(), gain=1.05)
        add(mus, x + BEAT / 2, ohat(), pan=-0.25, gain=0.7)
        for q in (0.25, 0.75): add(mus, x + BEAT * q, hat(), pan=0.35, gain=0.22)
        x += BEAT; i += 1
    for j in range(int(max(0, RESOLVE - LIFT) / (BEAT / 4))):
        st = LIFT + j * BEAT / 4; ch = prog[int((st - LIFT) // seg) % 4]; n = int(0.16 * SR); tt = np.arange(n) / SR; m = ch[[0, 2, 4, 3, 1, 3, 4, 2][j % 8]] + 12
        add(mus, st, (np.sin(2 * np.pi * note(m) * tt) + 0.4 * np.sin(2 * np.pi * note(m + 12) * tt)) * np.exp(-tt * 18), pan=0.45 * np.sin(j * 0.9), gain=0.15)
if cfg.get("resolve"): add(mus, sec(cfg["resolve"])[0], kick(), gain=1.1)
mus *= np.clip((DUR - t) / 1.5, 0, 1)[:, None]

# ---- sound effects ----
for e in cfg.get("events", []):
    at = F(e["scene"], e["frame"])
    if e["sound"] == "typing":
        for j in range(e["chars"]): add(sfx, at + j / (e.get("cps", 1.8) * FPS), tick(rng.uniform(3000, 4200)), pan=e.get("pan", 0), gain=e.get("gain", 0.1))
    else:
        add(sfx, at, SOUNDS[e["sound"]](), pan=e.get("pan", 0), gain=e.get("gain", 0.5))

# ---- voiceover + ducking ----
vo = np.zeros(N); act = np.zeros(N)
vt = "public/audio/vo/timing.json"
for ln in (json.load(open(vt)) if os.path.exists(vt) else []):
    if not os.path.exists(ln["file"]): continue
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", ln["file"], "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SR), "-ac", "1", "-f", "s16le", "-"], capture_output=True, check=True).stdout
    clip = np.frombuffer(raw, dtype="<i2").astype(float) / 32768
    i = int(F(ln["scene"], ln["frame"]) * SR); clip = clip[: max(0, N - i)]
    vo[i:i + len(clip)] += clip; act[i:i + len(clip)] = 1
duck_env = np.convolve(act, np.ones(int(0.25 * SR)) / int(0.25 * SR), "same")
mix = mus * 0.7 * (1 - 0.7 * duck_env)[:, None] + sfx * (1 - 0.3 * duck_env)[:, None] + np.repeat(vo[:, None], 2, axis=1) * 1.25
mix /= max(1e-9, np.abs(mix).max() * 1.05)

os.makedirs("public/audio", exist_ok=True)
with wave.open("public/audio/raw.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype("<i2").tobytes())
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "public/audio/raw.wav", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "public/audio/mix.wav"], check=True)
print(f"mix.wav {DUR:.3f}s · {len(cfg.get('events', []))} sfx events")
