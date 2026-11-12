// Everything the page needs from libraries, bundled into one inline script.
import { azteccode, drawingSVG } from "bwip-js/browser";
import { readXlsx, writeXlsx } from "./xlsx.mjs";
import { fromWorkbook, toWorkbook, DEFAULT_ACCESS_URL, PROFESSIONS } from "./template.mjs";

window.TC = {
  makeAztec: (text) => azteccode({ text, scale: 4, paddingwidth: 0 }, drawingSVG()),
  readXlsx, writeXlsx, fromWorkbook, toWorkbook, DEFAULT_ACCESS_URL, PROFESSIONS,
};
