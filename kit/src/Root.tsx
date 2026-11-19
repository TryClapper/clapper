// One <Composition> per scene (id = scene id) so any scene can be previewed
// and rendered on its own, plus "Full" which stitches them in order.
import React from "react";
import { Composition, Series } from "remotion";
import { registry } from "./scenes";
import { spec, total } from "./lib/spec";

const { fps, width, height } = spec.meta;

const Full: React.FC = () => (
  <Series>
    {spec.scenes.map((s) => {
      const C = registry[s.component];
      return (
        <Series.Sequence key={s.id} durationInFrames={s.frames} name={`${s.id} ${s.name}`}>
          <C {...s.props} />
        </Series.Sequence>
      );
    })}
  </Series>
);

export const Root: React.FC = () => (
  <>
    <Composition id="Full" component={Full} durationInFrames={total} fps={fps} width={width} height={height} />
    {spec.scenes.map((s) => (
      <Composition
        key={s.id}
        id={s.id}
        component={registry[s.component]}
        defaultProps={s.props}
        durationInFrames={s.frames}
        fps={fps}
        width={width}
        height={height}
      />
    ))}
  </>
);
