// What the bundler may read when it builds a video. The scenes are written by an agent, and kit.mjs can run
// outside the agent's sandbox (Chrome can't start inside it), so an import must never pull a file from
// elsewhere on the computer into the bundle (where a still or an error message would show it).
//
// guardWebpack(roots) gives a webpackOverride for @remotion/bundler's bundle(): every module must resolve
// inside one of `roots` (the video folder and the kit's packages), and webpack's "load a whole folder" forms
// (require.context, import.meta.webpackContext, require(someVariable)) are switched off.
// Paid renders are unchanged: their scenes only import from the video folder and its packages.
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The video folder (`root`), its packages and the kit's own packages, as real paths. */
export const allowedRoots = (root) => {
  const kitModules = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules");
  const out = new Set();
  for (const p of [root, path.join(root, "node_modules"), kitModules]) {
    try {
      out.add(realpathSync(p));
    } catch {
      // not there (a folder without its own packages): nothing to allow
    }
  }
  return [...out];
};

export const guardWebpack = (roots) => {
  // enhanced-resolve needs a path to pass every restriction, so the roots go in one pattern
  const inside = new RegExp(`^(?:${roots.map((r) => escape(r.replace(/[\\/]+$/, ""))).join("|")})(?:[\\\\/]|$)`);
  return (config) => ({
    ...config,
    resolve: { ...config.resolve, restrictions: [...(config.resolve?.restrictions ?? []), inside] },
    module: {
      ...config.module,
      parser: {
        ...config.module?.parser,
        javascript: {
          ...config.module?.parser?.javascript,
          requireContext: false,
          importMetaContext: false,
          // require(x) / import(x) with a computed x would bundle a whole folder: refuse it
          exprContextRegExp: /$^/,
          unknownContextRegExp: /$^/,
          wrappedContextRegExp: /$^/,
        },
      },
    },
  });
};
