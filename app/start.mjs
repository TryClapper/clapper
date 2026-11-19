#!/usr/bin/env node
// Clapper Open Source: start the local page.
//   node app/start.mjs
// Checks the tools a video needs (Node 20+, ffmpeg, Python 3.13+), says exactly what's missing and how to
// install it, then sets up the server's Python environment (once), installs the video kit's packages (once),
// starts the server on 127.0.0.1 and opens the page in the browser.
//
// Each launch makes a random pass (CLAPPER_TOKEN, or one you set): the browser is opened with it in the link
// once and keeps it as a cookie, and the server answers nothing without it, so no other program on this
// computer can drive the server and spend your key. The pass is never printed.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "server");
const port = Number(process.env.CLAPPER_PORT || 4317);
const url = `http://127.0.0.1:${port}/`;
const mac = process.platform === "darwin";

/** The repo: the public one has kit/ at its top, the private one video/kit/. */
const findRoot = () => {
  for (let d = here; d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, "kit", "package.json")) || existsSync(join(d, "video", "kit", "package.json"))) return d;
  }
  return null;
};

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const version = (cmd, args) => {
  const r = run(cmd, args);
  if (r.error || r.status !== 0) return null;
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(`${r.stdout} ${r.stderr}`);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};
const atLeast = (v, [major, minor]) => v !== null && (v[0] > major || (v[0] === major && v[1] >= minor));

// ---------------------------------------------------------------- the tools

const missing = [];
const nodeV = process.versions.node.split(".").map(Number);
if (!atLeast(nodeV, [20, 0])) {
  missing.push({ what: `Node 20 or newer (you have ${process.versions.node})`, mac: "brew install node", linux: "sudo apt install nodejs npm (or use nvm for a newer one)" });
}
if (version("ffmpeg", ["-version"]) === null) {
  missing.push({ what: "ffmpeg", mac: "brew install ffmpeg", linux: "sudo apt install ffmpeg" });
}
// Python 3.13+: Homebrew's python@3.13 installs as python3.13 (python3 stays the older one) and uv keeps its
// Pythons off the PATH, so look for those too before saying anything is missing.
const pickPython = () => {
  if (process.env.CLAPPER_PYTHON) return process.env.CLAPPER_PYTHON;
  const names = ["python3", "python3.14", "python3.13"];
  for (const name of names) if (atLeast(version(name, ["--version"]), [3, 13])) return name;
  const uv = run("uv", ["python", "find", ">=3.13"]);
  const found = uv.status === 0 ? uv.stdout.trim() : "";
  if (found && atLeast(version(found, ["--version"]), [3, 13])) return found;
  return "python3";
};
// With uv, the Python on the PATH doesn't matter: uv brings its own 3.13 (and some installed Pythons are
// broken: Homebrew's 3.13 on macOS 26 can't read the macOS version, so pip and uv both refuse it).
const hasUv = run("uv", ["--version"]).status === 0;
const python = pickPython();
const pyV = hasUv ? [3, 13] : version(python, ["--version"]);
if (process.env.CLAPPER_WHICH_PYTHON === "1" && atLeast(pyV, [3, 13])) {
  console.log(python); // for the tests: which Python the start command would use
  process.exit(0);
}
if (!atLeast(pyV, [3, 13])) {
  const have = pyV ? ` (you have ${pyV.join(".")})` : "";
  missing.push({ what: `Python 3.13 or newer${have}`, mac: "brew install python@3.13", linux: "install uv (https://docs.astral.sh/uv/), then: uv python install 3.13" });
}
if (missing.length) {
  console.error("Clapper needs a few things before it can make videos:\n");
  for (const m of missing) console.error(`  - ${m.what}: ${mac ? m.mac : m.linux}`);
  if (!atLeast(pyV, [3, 13])) {
    console.error("\nOr, if you have uv: uv python install 3.13 (this command finds it by itself).");
    console.error("A Python somewhere else? Run: CLAPPER_PYTHON=/path/to/python3.13 node app/start.mjs");
  }
  console.error("\nInstall them, then run this again.");
  process.exit(1);
}

const root = findRoot();
if (root === null) {
  console.error("Can't find the video kit next to the app. Run this from inside the Clapper folder you cloned.");
  process.exit(1);
}

// ---------------------------------------------------------------- the server's Python environment (once)

const venv = join(server, ".venv");
const py = join(venv, "bin", "python");
const engine = ["launchframe_providers", "launchframe_video"].map((name) =>
  [join(root, "engine", name), join(root, "backend", name)].find((d) => existsSync(join(d, "pyproject.toml"))),
);
if (engine.some((d) => d === undefined)) {
  console.error("Can't find the video engine (engine/launchframe_video). Is the clone complete?");
  process.exit(1);
}
const stamp = join(venv, ".clapper-installed");
const wanted = createHash("sha256")
  .update([server, ...engine].map((d) => readFileSync(join(d, "pyproject.toml"), "utf8")).join("\n"))
  .digest("hex");
if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== wanted) {
  console.log("Setting up the server (once; a minute or two)…");
  // no stamp means the last setup never finished: start again from nothing rather than build on it
  rmSync(venv, { recursive: true, force: true });
  const giveUp = (why) => {
    rmSync(venv, { recursive: true, force: true }); // never leave a half-made environment for the next run
    console.error(why);
    process.exit(1);
  };
  const getUv =
    "Install uv and run this again; it sets everything up with its own Python:\n" +
    (mac ? "  brew install uv\n" : "") +
    "  curl -LsSf https://astral.sh/uv/install.sh | sh";
  if (hasUv) {
    // uv's own Python (downloaded once if needed), never one installed elsewhere that may be broken
    const made = run("uv", ["venv", "-q", "--managed-python", "--python", "3.13", venv], { stdio: "inherit" });
    if (made.status !== 0) giveUp("uv couldn't make a Python environment (see above). Check your connection and try again.");
  } else {
    if (mac && run(python, ["-c", "import platform, sys; sys.exit(0 if platform.mac_ver()[0] else 1)"]).status !== 0) {
      giveUp(`Your ${python} can't read the macOS version, so it can't install packages.\n${getUv}`);
    }
    if (run(python, ["-m", "venv", venv], { stdio: "inherit" }).status !== 0) {
      giveUp(`Couldn't make a Python environment with ${python}.\n${getUv}`);
    }
  }
  const install = (args) =>
    (hasUv
      ? run("uv", ["pip", "install", "-q", "--python", py, ...args], { stdio: "inherit" })
      : run(py, ["-m", "pip", "install", "--disable-pip-version-check", "-q", ...args], { stdio: "inherit" })
    ).status === 0;
  if (!install([...engine]) || !install(["-e", server])) {
    giveUp(
      hasUv
        ? "Installing the server's packages failed (see above). Check your connection and try again."
        : `Installing the server's packages failed (see above).\n${getUv}`,
    );
  }
  writeFileSync(stamp, wanted);
}
// the music and sound effects (the kit's audio.py) run on this environment's numpy: without it a video
// would come out silent, so say so now rather than after a long run
if (run(py, ["-c", "import numpy"]).status !== 0) {
  console.error(`The server's Python environment has no numpy. Remove ${venv} and run this again.`);
  process.exit(1);
}

if (process.env.CLAPPER_STOP_AFTER_SETUP === "1") process.exit(0); // for the tests

// ---------------------------------------------------------------- the video kit's packages (once)

const kit = existsSync(join(root, "kit", "package.json")) ? join(root, "kit") : join(root, "video", "kit");
if (!existsSync(join(kit, "node_modules", "remotion"))) {
  console.log("Installing the video kit's packages (once; a few minutes)…");
  if (run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: kit, stdio: "inherit" }).status !== 0) {
    console.error("Installing the video kit's packages failed (see above). Check your connection and try again.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------- start it and open the page

const token = process.env.CLAPPER_TOKEN || randomBytes(32).toString("base64url");
const env = { ...process.env, CLAPPER_KIT_DIR: kit, CLAPPER_PORT: String(port), CLAPPER_TOKEN: token };
delete env.ANTHROPIC_API_KEY; // the key the page saves (app/.env) is the only one the server uses
const child = spawn(py, ["-m", "clapper_local"], { cwd: server, env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

const byHand = () =>
  console.log(`Open it yourself: start this with CLAPPER_TOKEN=<a secret of yours> and open ${url}?token=<that secret>`);

const open = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${url}api/key`, { headers: { cookie: `clapper_${port}=${token}` } });
      if (r.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  console.log(`\nClapper is running: ${url}\nStop it with Ctrl+C.`);
  if (process.env.CLAPPER_NO_BROWSER) {
    if (!process.env.CLAPPER_TOKEN) byHand();
    return;
  }
  // the link carries the pass once; the page swaps it for a cookie and drops it from the address bar
  spawn(mac ? "open" : "xdg-open", [`${url}?token=${encodeURIComponent(token)}`], { stdio: "ignore", detached: true })
    .on("error", byHand)
    .on("exit", (code) => code && byHand());
};
void open();
