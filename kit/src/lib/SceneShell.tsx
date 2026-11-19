// Every scene sits in a SceneShell: shared background, one camera container
// with a constant micro-push, and an exit over the last EXIT frames. Each scene
// owns its own entrance and exit, so scenes render independently and the
// shared background means hand-offs never flash black.
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { brand } from "./spec";
import { EXIT, exit } from "./motion";
import "./fonts";

export const SceneShell: React.FC<{
  children: React.ReactNode;
  push?: [number, number]; // camera scale from → to over the scene
  noExit?: boolean; // last scene holds to the end
}> = ({ children, push = [1, 1.03], noExit }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;
  const cam = push[0] + (push[1] - push[0]) * (t * t * (3 - 2 * t));
  const out = noExit ? 0 : exit(frame, durationInFrames - EXIT);
  return (
    <AbsoluteFill style={{ background: brand.bg, fontFamily: brand.font, color: brand.fg }}>
      <AbsoluteFill
        style={{
          transform: `scale(${cam * (1 - 0.04 * out)})`,
          opacity: 1 - out,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
