# launch-motion-kit

Generic, brand-free kit for code-built SaaS launch videos (Remotion). The launch-motion skill starts every
video from this kit and only changes brand, copy, data and scenes.

```
npm install
node scripts/embed-fonts.mjs          # after setting brand.font / ui / mono in video.json (every weight 400–800)
npx remotion studio src/index.ts      # preview any scene
node scripts/kit.mjs status           # scene table, cache, VO word budget
node scripts/kit.mjs scene s02        # render one scene (cached; skipped if unchanged) + empty-frame check
node scripts/kit.mjs still s02 190    # 40% JPEG still (SCALE=1 for a full-res polish check)
node scripts/kit.mjs seams            # every cut: last frame of a scene vs first frame of the next (must be seamless)
python3 scripts/audio.py              # music + sfx (audio.json) → mix.wav
PRESET=slow node scripts/kit.mjs build  # stitch cached scenes, mux audio, verify (yuv420p, frame count)
```
If Chrome can't be downloaded, set `REMOTION_BROWSER=/path/to/chrome-headless-shell`.

- `KIT.md` — every component and helper, with what it's for.
- `DESIGN.md` — the design system: tokens, layout grid, chrome, states, callouts, motion numbers.
- `STORYBOARD.md`, `STATE.md` — templates; fill them per video.
- `video.json` + `audio.json` — an example ("Acme", 19 s: Hook → ProblemStack → ProductDemo → Cta, every cut connected) showing the shape. Replace the content.

## Before you storyboard
1. Pass the product research gate in the launch-motion skill (SKILL.md › section 1): write the product brief (what it is in the company's words, what it is not, its signature features, tone, real numbers) at the top of STORYBOARD.md.
2. Write the story from that brief.
3. Only then pick the problem-scene style that shows that story (STYLES.md). There is no default style.
