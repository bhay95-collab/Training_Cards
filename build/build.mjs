// Builds dist/TrainingCard.html: one self-contained file.
// Reads the Excel template, checks it with the same rules as the admin screen,
// then inlines data, libraries (barcodes, Excel reader/writer), font and images.
// Usage: node build/build.mjs [data/Training-Card-Data.xlsx]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as esbuild from "esbuild";
import { readXlsx } from "../src/lib/xlsx.mjs";
import { fromWorkbook } from "../src/lib/template.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...a) => path.join(root, ...a);
const src = process.argv[2] || p("data", "Training-Card-Data.xlsx");

const xbuf = await readFile(src);
const { data, issues, stats } = fromWorkbook(await readXlsx(xbuf));
for (const i of issues) console.log(`${i.level.toUpperCase().padEnd(7)} ${i.where}: ${i.message}`);
if (!data) { console.error("Build stopped: fix the errors above."); process.exit(1); }
const d = new Date();
data.updated = `${d.getDate()} ${d.toLocaleString("en-AU", { month: "short" })} ${d.getFullYear()}`;
console.log(`Data OK: ${stats.courses} courses shown (${stats.hidden} hidden), ${stats.logins} logins, ${stats.patients} patients`);

const bundle = await esbuild.build({
  entryPoints: [p("src", "lib", "browser.mjs")], bundle: true, minify: true,
  format: "iife", write: false, logLevel: "warning", target: "es2020",
});
const lib = bundle.outputFiles[0].text;

const b64 = async (f) => (await readFile(f)).toString("base64");
const font = await b64(p("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"));
const blood = await b64(p("assets", "blood-bag.png"));

let html = await readFile(p("src", "index.html"), "utf8");
const app = await readFile(p("src", "app.js"), "utf8");
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const noClose = (js) => js.replace(/<\/script/gi, "<\\/script");
// Order matters: code first, then assets, data last.
const swaps = {
  "/*__LIB__*/": noClose(lib),
  "/*__APP__*/": noClose(app),
  "__INTER_WOFF2__": font,
  "__BLOODBAG_PNG__": blood,
  "__DATA_JSON__": json,
};
for (const [marker, value] of Object.entries(swaps)) {
  if (html.split(marker).length !== 2) throw new Error(`Marker ${marker} must appear exactly once`);
  html = html.replace(marker, () => value);
}
await mkdir(p("dist"), { recursive: true });
await writeFile(p("dist", "TrainingCard.html"), html);
console.log(`Built dist/TrainingCard.html (${Math.round(html.length / 1024)} KB)`);
