// Registry: video.json "component" name → scene component.
// Convention: component X lives in src/scenes/X.tsx (the render cache relies on it).
import React from "react";
import { Hook } from "./Hook";
import { ProblemStack } from "./ProblemStack";
import { ProductDemo } from "./ProductDemo";
import { Cta } from "./Cta";

export const registry: Record<string, React.FC<any>> = { Hook, ProblemStack, ProductDemo, Cta };
