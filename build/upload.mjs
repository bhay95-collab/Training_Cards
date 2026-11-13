// Loads data/Training-Card-Data.xlsx into the live database through the admin API
// (the same checked path the admin screen uses). Needs the admin password:
//   TC_ADMIN_PASSWORD=... node build/upload.mjs
import { readFile } from "node:fs/promises";
import { readXlsx } from "../src/lib/xlsx.mjs";
import { fromWorkbook } from "../src/lib/template.mjs";
import { SUPABASE_URL, SUPABASE_KEY } from "../src/live/config.mjs";

const rpc = async (fn, args) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
};

const { data, issues } = fromWorkbook(await readXlsx(await readFile(process.argv[2] || "data/Training-Card-Data.xlsx")));
for (const i of issues.filter((x) => x.level === "error")) console.log("ERROR", i.where, i.message);
if (!data) process.exit(1);
const login = await rpc("tc_staff_login", { p_role: "admin", p_password: process.env.TC_ADMIN_PASSWORD });
if (!login.ok) throw new Error(login.error);
const res = await rpc("tc_admin_import", { p_token: login.token, p_data: data });
console.log(res);
await rpc("tc_staff_logout", { p_token: login.token });
