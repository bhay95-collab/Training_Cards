// Builds the live site into docs/ (served by GitHub Pages from this branch).
// The page holds no course data: everything comes from the database at run time.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...a) => path.join(root, ...a);

const offline = await readFile(p("src", "index.html"), "utf8");
const baseCss = offline.slice(offline.indexOf("<style>\n") + 8, offline.indexOf("</style>"));

const lib = (await esbuild.build({
  entryPoints: [p("src", "live", "browser.mjs")], bundle: true, minify: true,
  format: "iife", write: false, logLevel: "warning", target: "es2020",
})).outputFiles[0].text;
const app = await readFile(p("src", "live", "live.js"), "utf8");
const b64 = async (f) => (await readFile(f)).toString("base64");
const noClose = (js) => js.replace(/<\/script/gi, "<\\/script");

let html = await readFile(p("src", "live", "live.html"), "utf8");
const swaps = {
  "/*__BASE_CSS__*/": baseCss,
  "/*__LIB__*/": noClose(lib),
  "/*__APP__*/": noClose(app),
  "__INTER_WOFF2__": await b64(p("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")),
  "__BLOODBAG_PNG__": await b64(p("assets", "blood-bag.png")),
};
for (const [marker, value] of Object.entries(swaps)) {
  if (html.split(marker).length !== 2) throw new Error(`Marker ${marker} must appear exactly once`);
  html = html.replace(marker, () => value);
}
for (const bad of ["MNRN", "MNMO", "Bloggs"]) if (html.includes(bad)) throw new Error(`Live page must not contain data (${bad})`);
await mkdir(p("docs"), { recursive: true });
await writeFile(p("docs", "index.html"), html);
await writeFile(p("docs", ".nojekyll"), "");
console.log(`Built docs/index.html (${Math.round(html.length / 1024)} KB), no course data inside`);
