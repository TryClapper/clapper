import raw from "../../video.json";

export type SceneSpec = {
  id: string;
  name: string;
  beat: "hook" | "problem" | "fix" | "payoff" | "logo";
  component: string;
  frames: number;
  status: "draft" | "review" | "approved";
  vo: string;
  props: Record<string, unknown>;
};

export type Tool = { name: string; glyph: string; color: string; job: string };

export const spec = raw as unknown as {
  meta: { title: string; fps: number; width: number; height: number };
  brand: Record<string, string> & { bg: string; fg: string; font: string };
  shared?: Record<string, unknown>;
  scenes: SceneSpec[];
};

export const brand = spec.brand;
export const total = spec.scenes.reduce((n, s) => n + s.frames, 0);
