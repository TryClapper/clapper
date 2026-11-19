#!/usr/bin/env node
// Finds words shown on screen that are typed into scene code instead of video.json. The app's edit section only
// shows video.json (each scene's props and `shared`), so text typed into a .tsx file can't be changed there.
//
//   node scripts/text-check.mjs            lines "file:line  "text"" for this folder's video
//   import { hardCodedText } from "./text-check.mjs"
//
// Looked at: the scene files video.json uses, and the video's own files in src/lib (not the kit's stock ones).
// Counted as on-screen text: JSX text ("Card declined"), a string written straight into JSX or into a component's
// prop (title="Pay now"), a string split into words for a headline ("Your customer wanted to pay.".split(" ")),
// and a constant or data table of words that JSX shows ({LINK}, {ROWS.map(...)}). Not counted: styles, colours,
// sizes, icon names, file paths, ids.
import { parse } from "@babel/parser";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const STOCK_LIB = new Set(["SceneShell", "charts", "exit", "fonts", "fonts.gen", "fx", "handoff", "house", "motion", "pile", "product", "spec", "ui"]);
const SKIP_ATTR = new Set(["style", "className", "key", "id", "src", "href", "fill", "stroke", "d", "viewBox", "points", "transform",
  "icon", "kind", "tone", "variant", "color", "colour", "bg", "font", "fontFamily", "align", "dir", "type", "role", "as", "ref", "xmlns"]);
const SKIP_KEYS = new Set([...SKIP_ATTR, "background", "border", "boxShadow", "fontWeight", "letterSpacing", "lineHeight", "width", "height",
  "padding", "margin", "display", "position", "justifyContent", "alignItems", "gap", "opacity", "radius", "borderRadius", "filter",
  "transformOrigin", "textAlign", "overflow", "fontSize", "accent", "ink", "line", "mono", "ui", "sans", "serif", "file", "image", "img",
  "avatar", "logo", "seed", "easing"]);

const CSS = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|(linear|radial|conic)-gradient|url\(|cubic-bezier|var\(|calc\(|translate|scale|rotate|matrix)/i;
const UNIT = /\d(px|%|deg|em|rem|ms|s|fr|vh|vw)\b/;
const FONT_STACK = /(sans-serif|serif|monospace|system-ui)/;
const TOKEN = /^[a-z][a-z0-9_-]{0,24}$/; // icon keys, ids, enum values: not words people read
const FILE = /^[\w\-/.]+\.(png|jpe?g|svg|webp|gif|mp3|wav|mp4|json|tsx?|css)$/i;

/** Is this string something a viewer reads (not a style, colour, size, token or path)? */
export const isWords = (raw) => {
  const s = String(raw).trim();
  if (!s || !/[A-Za-z0-9]/.test(s)) return false;
  if (CSS.test(s) || FONT_STACK.test(s) || FILE.test(s) || TOKEN.test(s)) return false;
  if (UNIT.test(s) && !/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(s.replace(UNIT, ""))) return false;
  if (/^[\d\s.,:\-+/*()]+$/.test(s) && !/\d{2,}/.test(s)) return false; // "0 0", "1 / 2"
  return true;
};

const parseFile = (file) => {
  try {
    return parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: true });
  } catch {
    return null;
  }
};

const walk = (node, visit, parent = null, key = null) => {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments" || k === "extra") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) walk(c, visit, node, k);
    else if (v && typeof v.type === "string") walk(v, visit, node, k);
  }
};

const strValue = (n) => {
  if (!n) return null;
  if (n.type === "StringLiteral") return n.value;
  if (n.type === "TemplateLiteral" && n.expressions.length === 0) return n.quasis.map((q) => q.value.cooked).join("");
  return null;
};

/** Every readable string inside a constant's value (a string, or arrays/objects of them), skipping style-like keys. */
const wordsIn = (n, out) => {
  const v = strValue(n);
  if (v !== null) {
    if (isWords(v)) out.push({ line: n.loc.start.line, text: v });
    return;
  }
  if (!n) return;
  if (n.type === "ArrayExpression") for (const e of n.elements) wordsIn(e, out);
  else if (n.type === "ObjectExpression")
    for (const p of n.properties) {
      if (p.type !== "ObjectProperty") continue;
      const k = p.key.type === "Identifier" ? p.key.name : strValue(p.key);
      if (k && SKIP_KEYS.has(k)) continue;
      wordsIn(p.value, out);
    }
  else if (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression") wordsIn(n.expression, out);
};

/** Constants (any scope) whose value holds readable words, by name. */
const constants = (ast) => {
  const out = new Map();
  walk(ast, (n) => {
    if (n.type !== "VariableDeclarator" || n.id.type !== "Identifier" || !n.init) return;
    const found = [];
    wordsIn(n.init, found);
    if (found.length) out.set(n.id.name, found);
  });
  return out;
};

/** Names used inside JSX expressions (`{LINK}`, `{ROWS.map(...)}`, `url={URL_CO}`), and inside a component's props. */
const shownNames = (ast) => {
  const names = new Set();
  walk(ast, (n) => {
    if (n.type !== "JSXExpressionContainer") return;
    walk(n.expression, (m, p, k) => {
      if (m.type !== "Identifier") return;
      if (p && p.type === "MemberExpression" && k === "property" && !p.computed) return;
      if (p && p.type === "ObjectProperty" && k === "key") return;
      names.add(m.name);
    });
  });
  return names;
};

/** Text typed straight into JSX in one file: JSX text, string children, readable prop values, "…".split(). */
const inlineText = (ast) => {
  const out = [];
  walk(ast, (n, parent, key) => {
    if (n.type === "JSXText") {
      const t = n.value.replace(/\s+/g, " ").trim();
      if (t && /[A-Za-z0-9]/.test(t)) out.push({ line: n.loc.start.line, text: t });
      return;
    }
    const v = strValue(n);
    if (v === null) return;
    if (parent?.type === "JSXExpressionContainer" && isWords(v)) {
      out.push({ line: n.loc.start.line, text: v });
      return;
    }
    if (parent?.type === "JSXAttribute" && key === "value") {
      const name = parent.name?.name;
      const svg = /^(stroke|fill|stop|clip|mask|marker|gradient|pattern|preserve|text[A-Z]|font[A-Z]|[xyr]\d?$|c[xy]$|offset|opacity|points|width|height)/;
      if (typeof name === "string" && !SKIP_ATTR.has(name) && !svg.test(name) && !/^[\d.\s-]+$/.test(v) && isWords(v)) out.push({ line: n.loc.start.line, text: v });
      return;
    }
    if (parent?.type === "MemberExpression" && key === "object" && parent.property?.name === "split" && isWords(v))
      out.push({ line: n.loc.start.line, text: v });
  });
  return out;
};

/** Hard-coded on-screen text in the video in `root` that uses `components` (scene component names). */
export const hardCodedText = (root, components) => {
  const rel = (f) => path.relative(root, f);
  const found = [];
  const seen = new Set();
  const add = (file, hits) => {
    for (const h of hits) {
      const k = `${file}:${h.line}:${h.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      found.push({ file: rel(file), line: h.line, text: h.text });
    }
  };
  const libDir = path.join(root, "src", "lib");
  const libConsts = new Map(); // exported-or-not words constants in the video's own lib files
  if (existsSync(libDir))
    for (const f of readdirSync(libDir)) {
      const base = f.replace(/\.(tsx?|mjs)$/, "");
      if (!/\.tsx?$/.test(f) || STOCK_LIB.has(base)) continue;
      const file = path.join(libDir, f);
      const ast = parseFile(file);
      if (!ast) continue;
      add(file, inlineText(ast));
      const shown = shownNames(ast);
      for (const [name, hits] of constants(ast)) {
        libConsts.set(name, { file, hits });
        if (shown.has(name)) add(file, hits);
      }
    }
  for (const comp of new Set(components)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(comp)) continue;
    const file = path.join(root, "src", "scenes", `${comp}.tsx`);
    const ast = existsSync(file) ? parseFile(file) : null;
    if (!ast) continue;
    add(file, inlineText(ast));
    const shown = shownNames(ast);
    const own = constants(ast);
    for (const [name, hits] of own) if (shown.has(name)) add(file, hits);
    for (const name of shown) if (!own.has(name) && libConsts.has(name)) add(libConsts.get(name).file, libConsts.get(name).hits);
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
};

/** The lines `kit status` and `kit build` print: at most `per` per file, then a count. */
export const report = (found, per = 12) => {
  const lines = [];
  const byFile = new Map();
  for (const f of found) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  for (const [file, hits] of byFile) {
    for (const h of hits.slice(0, per)) lines.push(`HARD-CODED TEXT ${file}:${h.line} ${JSON.stringify(h.text.slice(0, 80))}`);
    if (hits.length > per) lines.push(`HARD-CODED TEXT ${file}: and ${hits.length - per} more`);
  }
  if (lines.length)
    lines.push("HARD-CODED TEXT: move every word shown on screen into the scene's props (or `shared`) in video.json and read it from props; the edit section only shows video.json");
  return lines;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const spec = JSON.parse(readFileSync(path.join(root, "video.json"), "utf8"));
  const comps = (spec.scenes ?? []).map((s) => String(s.component));
  for (const ln of report(hardCodedText(root, comps))) console.log(ln);
}
