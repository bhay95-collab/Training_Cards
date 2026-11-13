// Libraries for the live site, bundled into one inline script.
import { azteccode, drawingSVG } from "bwip-js/browser";
import { RealtimeClient } from "@supabase/realtime-js";
import { readXlsx, writeXlsx } from "../lib/xlsx.mjs";
import { fromWorkbook, toWorkbook, DEFAULT_ACCESS_URL, PROFESSIONS } from "../lib/template.mjs";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.mjs";

window.TC = {
  makeAztec: (text) => azteccode({ text, scale: 4, paddingwidth: 0 }, drawingSVG()),
  RealtimeClient, readXlsx, writeXlsx, fromWorkbook, toWorkbook, DEFAULT_ACCESS_URL, PROFESSIONS,
  SUPABASE_URL, SUPABASE_KEY,
};
