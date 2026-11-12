// Writes site data (JSON from convert_v2.py) out as the Excel template.
// Usage: node build/make-template.mjs data/converted.json data/Training-Card-Data.xlsx
import { readFile, writeFile } from "node:fs/promises";
import { writeXlsx } from "../src/lib/xlsx.mjs";
import { toWorkbook } from "../src/lib/template.mjs";

const [src, out] = process.argv.slice(2);
const data = JSON.parse(await readFile(src, "utf8"));
const blob = await writeXlsx(toWorkbook(data));
await writeFile(out, Buffer.from(await blob.arrayBuffer()));
console.log(`Wrote ${out} (${data.courses.length} courses)`);
