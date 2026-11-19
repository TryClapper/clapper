// Fonts load before frame 0 via a module-level delayRender. Files are embedded
// as base64 (scripts/embed-fonts.mjs → fonts.gen.ts) so long renders never
// stall on a network fetch. A fallback font is a bug.
import { continueRender, delayRender } from "remotion";
import { FONTS } from "./fonts.gen";

const handle = delayRender("Loading fonts");
const toBuf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

Promise.all(
  FONTS.map(async (f) => {
    const face = new FontFace(f.family, toBuf(f.data), { weight: String(f.weight), style: f.style });
    await face.load();
    document.fonts.add(face);
  })
)
  .then(() => continueRender(handle))
  .catch((e) => {
    console.error(e);
    continueRender(handle);
  });
