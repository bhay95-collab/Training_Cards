import { colName } from "./xlsx.mjs";
// The Training Card Excel template: column names, reading it into site data
// (with plain-English checks), and writing site data back out as a template.

export const PROFESSIONS = [
  ["nursing", "Nursing"], ["medical", "Medical"], ["midwifery", "Midwifery"],
  ["admin", "Admin"], ["pharmacy", "Pharmacy"], ["allied", "Allied Health"],
];
// What the instructor toggles: every patient belongs to a mode, and optionally a part (e.g. Pharmacy Part A).
export const MODES = [["instructor", "Instructor led"], ["proficiency", "Proficiency"], ["always", "Always"]];
export const MAX_PATIENTS = 6;
const YES_NO = ["Yes", "No"];

const COURSE_COLS = {
  tab: "Tab name", name: "Course name", group: "Profession", show: "Show on site",
  barcode: "Patient barcodes", bloodBag: "Blood bag barcode",
  doctorUser: "Doctor username", doctorPass: "Doctor password",
  witnessUser: "Witness username", witnessPass: "Witness password",
  accessUrl: "Access request link", notes: "Notes",
};
const LOGIN_COLS = {
  login: "Login", password: "Password", facility: "Facility", doctor: "Doctor username (only if different)",
  secondLabel: "Second login label", second: "Second login", secondPass: "Second login password",
  secondPart: "Second login part",
};
const PT_FIELDS = {
  part: "Part", mode: "Mode", role: "Label", last: "Last name", first: "First name", dob: "DOB",
  mrn: "MRN", fin: "FIN", ward: "Ward", ioms: "IOMS",
};
const HBCIS_COLS = {
  login: "HBCIS login", password: "HBCIS password", urn: "HBCIS URN", last: "HBCIS last name",
  first: "HBCIS first name", alias: "HBCIS alias", dob: "HBCIS DOB", doctor: "HBCIS doctor",
  unit: "HBCIS unit", ward: "HBCIS admit ward", transfer: "HBCIS transfer ward",
};
const ptCol = (n, f) => `Pt${n} ${PT_FIELDS[f]}`;

export const COURSE_HEADERS = Object.values(COURSE_COLS);
export const LOGIN_HEADERS = [
  ...Object.values(LOGIN_COLS),
  ...Array.from({ length: MAX_PATIENTS }, (_, i) => Object.keys(PT_FIELDS).map((f) => ptCol(i + 1, f))).flat(),
  ...Object.values(HBCIS_COLS),
];

export const DEFAULT_ACCESS_URL =
  "https://qldhealth.service-now.com/ssp?id=sc_cat_item&sys_id=d1a06d86db4c0c10ac208a264a9619d6";

const RESERVED = ["read me", "courses"];
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
export const slug = (s) => norm(s).replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function serialToDate(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
const ERROR_CELL = /^#(VALUE!|N\/A|REF!|NAME\?|DIV\/0!|NUM!|NULL!)$/i;
const BLANKS = new Set(["n/a", "na", "-", "—"]);

/* ------------------------------------------------------------------ read */

/**
 * sheets: output of readXlsx. Returns { data, issues, stats }.
 * issues: [{ level: "error" | "warning" | "info", where, message }]
 * Any "error" means the file must not be used.
 */
export function fromWorkbook(sheets) {
  const issues = [];
  const add = (level, where, message) => issues.push({ level, where, message });
  const byName = new Map(sheets.map((s) => [norm(s.name), s]));

  const coursesSheet = byName.get("courses");
  if (!coursesSheet) {
    add("error", "Whole file", 'There is no tab called "Courses". Make sure you loaded the Training Card spreadsheet (download it from this screen first).');
    return { data: null, issues, stats: null };
  }

  const header = (sheet, cols, required, where) => {
    const h = (sheet.rows[0] || []).map(norm);
    const idx = {};
    for (const [key, label] of Object.entries(cols)) {
      const i = h.indexOf(norm(label));
      if (i >= 0) idx[key] = i;
      else if (required.includes(key)) add("error", where, `The column "${label}" is missing. Put the heading back in row 1 exactly as it was.`);
    }
    return idx;
  };

  const ci = header(coursesSheet, COURSE_COLS, ["tab", "name", "group"], 'Tab "Courses"');
  if (issues.some((i) => i.level === "error")) return { data: null, issues, stats: null };

  const cell = (row, i, where, label) => {
    if (i === undefined) return "";
    let v = row[i];
    if (v === undefined || v === null) return "";
    if (typeof v === "boolean") v = v ? "Yes" : "No";
    v = String(v).replace(/ /g, " ").trim();
    if (ERROR_CELL.test(v)) {
      add("warning", where, `"${label}" shows an Excel error (${v}). It has been left blank.`);
      return "";
    }
    return BLANKS.has(v.toLowerCase()) ? "" : v;
  };
  const yesNo = (v, where, label, dflt) => {
    const s = norm(v);
    if (!s) return dflt;
    if (["yes", "y", "true", "1"].includes(s)) return true;
    if (["no", "n", "false", "0"].includes(s)) return false;
    add("warning", where, `"${label}" should be Yes or No, but it says "${v}". Treated as ${dflt ? "Yes" : "No"}.`);
    return dflt;
  };
  const dateCell = (row, i, where, label) => {
    if (i === undefined) return "";
    const v = row[i];
    if (typeof v === "number") return v > 1 && v < 80000 ? serialToDate(v) : String(v);
    return cell(row, i, where, label);
  };

  const courses = [];
  const seenTabs = new Set();
  const seenIds = new Set();
  coursesSheet.rows.slice(1).forEach((row, r) => {
    const where = `Tab "Courses", row ${r + 2}`;
    if (!row.some((v) => v !== undefined && String(v).trim() !== "")) return;
    const tab = cell(row, ci.tab, where, "Tab name");
    const name = cell(row, ci.name, where, "Course name") || tab;
    if (!tab) return add("error", where, "This row has no Tab name. Every course needs the name of the tab that holds its logins.");
    if (seenTabs.has(norm(tab))) return add("error", where, `The tab "${tab}" is listed twice. Each course needs its own tab.`);
    seenTabs.add(norm(tab));
    const profText = cell(row, ci.group, where, "Profession");
    const prof = PROFESSIONS.find(([id, label]) => norm(label) === norm(profText) || id === norm(profText));
    if (!prof) return add("error", where, `Profession "${profText || "(blank)"}" isn't one of: ${PROFESSIONS.map((p) => p[1]).join(", ")}.`);
    const id = slug(tab);
    if (seenIds.has(id)) return add("error", where, `The tab name "${tab}" is too similar to another course's tab name. Make it more different.`);
    seenIds.add(id);
    const doctorUser = cell(row, ci.doctorUser, where, "Doctor username");
    const witnessUser = cell(row, ci.witnessUser, where, "Witness username");
    courses.push({
      id, tab, name,
      group: prof[0],
      show: yesNo(cell(row, ci.show, where, "Show on site"), where, "Show on site", true),
      barcode: yesNo(cell(row, ci.barcode, where, "Patient barcodes"), where, "Patient barcodes", false),
      bloodBag: yesNo(cell(row, ci.bloodBag, where, "Blood bag barcode"), where, "Blood bag barcode", false),
      doctor: doctorUser ? { username: doctorUser, password: cell(row, ci.doctorPass, where, "Doctor password") } : null,
      witness: witnessUser ? { username: witnessUser, password: cell(row, ci.witnessPass, where, "Witness password") } : null,
      accessUrl: cell(row, ci.accessUrl, where, "Access request link"),
      notes: cell(row, ci.notes, where, "Notes"),
      logins: [],
    });
  });

  for (const s of sheets) {
    const n = norm(s.name);
    if (!RESERVED.includes(n) && !seenTabs.has(n))
      add("warning", `Tab "${s.name}"`, 'This tab isn\'t listed on the "Courses" tab, so it has been ignored.');
  }

  for (const c of courses) {
    const sheet = byName.get(norm(c.tab));
    const whereTab = `Tab "${c.tab}"`;
    if (!sheet) {
      add("error", `Tab "Courses"`, `The course "${c.name}" points to a tab called "${c.tab}", but there is no tab with that name. Check the spelling matches exactly.`);
      continue;
    }
    const ptCols = {};
    for (let n = 1; n <= MAX_PATIENTS; n++) for (const f of Object.keys(PT_FIELDS)) ptCols[`${n}.${f}`] = ptCol(n, f);
    const li = header(sheet, { ...LOGIN_COLS, ...ptCols, ...Object.fromEntries(Object.entries(HBCIS_COLS).map(([k, v]) => ["hb." + k, v])) }, ["login"], whereTab);
    if (li.login === undefined) continue;

    const seen = new Map();
    let noFin = 0, badMrn = 0, badMode = 0;
    sheet.rows.slice(1).forEach((row, r) => {
      const where = `${whereTab}, row ${r + 2}`;
      const login = cell(row, li.login, where, "Login");
      if (!login) {
        if (row.some((v) => v !== undefined && String(v).trim() !== "")) add("warning", where, "This row has details but no Login, so it has been skipped.");
        return;
      }
      const facility = cell(row, li.facility, where, "Facility");
      const key = `${login.toUpperCase()}|${facility.toUpperCase()}`;
      if (seen.has(key)) return add("error", where, `The login ${login}${facility ? ` at ${facility}` : ""} is already used on row ${seen.get(key)} of this tab. Each login can only appear once per course${facility ? " and facility" : ""}.`);
      seen.set(key, r + 2);

      const patients = [];
      for (let n = 1; n <= MAX_PATIENTS; n++) {
        const g = (f) => (f === "dob" ? dateCell : cell)(row, li[`${n}.${f}`], where, ptCol(n, f));
        const p = Object.fromEntries(Object.keys(PT_FIELDS).map((f) => [f, g(f)]));
        if (!(p.last || p.first || p.mrn)) continue;
        const m = MODES.find(([id, label]) => id === norm(p.mode) || norm(label) === norm(p.mode));
        if (p.mode && !m) badMode++;
        p.mode = m ? m[0] : "instructor";
        if (p.mrn && !/^\d+$/.test(p.mrn)) badMrn++;
        if (c.barcode && !p.fin) noFin++;
        patients.push(p);
      }
      const hb = Object.fromEntries(Object.keys(HBCIS_COLS).map((k) =>
        [k, (k === "dob" ? dateCell : cell)(row, li["hb." + k], where, HBCIS_COLS[k])]));
      const hasHb = Object.values(hb).some(Boolean);
      const second = cell(row, li.second, where, "Second login");
      if (!patients.length && !hasHb) add("warning", where, `Login ${login} has no patients, so its card will be empty.`);
      c.logins.push({
        login,
        password: cell(row, li.password, where, "Password"),
        facility,
        doctor: cell(row, li.doctor, where, "Doctor username"),
        second: second ? {
          label: cell(row, li.secondLabel, where, "Second login label") || "Second login",
          login: second,
          password: cell(row, li.secondPass, where, "Second login password"),
          part: cell(row, li.secondPart, where, "Second login part"),
        } : null,
        patients,
        hbcis: hasHb ? hb : null,
      });
    });

    if (noFin) add("warning", whereTab, `${noFin} patient${noFin > 1 ? "s have" : " has"} no FIN, so no ID band barcode will show for ${noFin > 1 ? "them" : "it"}.`);
    if (badMrn) add("warning", whereTab, `${badMrn} MRN${badMrn > 1 ? "s contain" : " contains"} something other than numbers. Check for typos.`);
    if (badMode) add("warning", whereTab, `${badMode} patient${badMode > 1 ? "s have" : " has"} a Mode that isn't ${MODES.map((m) => m[1]).join(", ")}. Treated as Instructor led.`);
    if (c.logins.length && !c.logins.some((l) => l.patients.some((p) => p.mode === "proficiency")) && c.logins.some((l) => l.patients.length))
      add("info", whereTab, `"${c.name}" has no Proficiency patients, so the Proficiency button will show nothing for it.`);
    if (!c.logins.length) add("info", whereTab, `"${c.name}" has no logins yet, so it is hidden from trainees.`);
    else if (!c.show) add("info", whereTab, `"${c.name}" is set to "Show on site: No", so it is hidden from trainees.`);
  }

  const live = courses.filter((c) => c.show && c.logins.length);
  const stats = {
    courses: live.length,
    hidden: courses.length - live.length,
    logins: live.reduce((s, c) => s + c.logins.length, 0),
    patients: live.reduce((s, c) => s + c.logins.reduce((t, l) => t + l.patients.length + (l.hbcis ? 1 : 0), 0), 0),
  };
  const ok = !issues.some((i) => i.level === "error");
  return { data: ok ? { courses } : null, issues, stats };
}

/* ------------------------------------------------------------------ write */

const README = [
  ["Training Card – data spreadsheet"],
  [""],
  ["What this file is"],
  ["This spreadsheet holds every course, login and patient shown on the Training Card. Edit it here, then load it into the Training Card's hidden Update screen to make a new Training Card file."],
  [""],
  ["How to update the Training Card"],
  ["1. Open the Training Card and press Ctrl + Alt + U to open the Update screen (or click the line at the very bottom of the page 5 times quickly)."],
  ["2. Click \"Download current data\" to get this spreadsheet with everything currently on the card."],
  ["3. Make your changes here and save (keep it as .xlsx)."],
  ["4. Back on the Update screen, load this file. Fix anything it lists as a Problem."],
  ["5. Click \"Try it\" to check the cards, then \"Save new Training Card\" and copy the new file onto each training PC desktop, replacing the old one."],
  [""],
  ["The Courses tab"],
  ["One row per course. \"Tab name\" must match the name of the tab holding that course's logins exactly."],
  ["Profession: which tile the course sits under (Nursing, Medical, Midwifery, Admin, Pharmacy, Allied Health)."],
  ["Show on site: No hides the course. Courses with no logins are hidden automatically."],
  ["Patient barcodes: Yes shows an ID band barcode made from \"AC\" + the patient's FIN."],
  ["Blood bag barcode: Yes shows the blood bag barcode on every card in the course."],
  ["Live classes: the instructor picks a Part (when a course has parts) and flips between Instructor led and Proficiency. Trainees only see the patients that match."],
  ["Doctor / Witness: shown under \"Other logins\". Leave the username blank to hide it."],
  ["Access request link: the form opened by \"Course complete\". Leave blank to use the standard ServiceNow form."],
  [""],
  ["Course tabs"],
  ["One row per login. Every course tab has the same columns. Leave columns you don't need empty."],
  ["Login and Password: what the trainee types into ieMR."],
  ["Facility: fill in to show facility buttons (e.g. CAB, TPCH) above the login list."],
  ["Doctor username (only if different): use when one login needs a different doctor to the Courses tab."],
  ["Second login: a second login on the same card (e.g. Pharmacy Part B doctor login). \"Second login part\" says which part it belongs to; it shows when the instructor is on that part."],
  ["Pt1 to Pt6: up to six patients per login. A patient shows if it has a last name, first name or MRN. Mode is Instructor led, Proficiency or Always. Part is optional (e.g. Part A); patients with the same part are shown together. Label is an extra description (e.g. Birth Suite). DOB can be typed as a date."],
  ["IOMS: shown when filled in. HBCIS columns: shown as a separate HBCIS panel when filled in."],
  [""],
  ["Tips"],
  ["Don't rename or move the column headings in row 1. Extra columns you add are ignored."],
  ["To add a new course: add a row on the Courses tab, then add a tab with the same name. Copy row 1 headings from any course tab."],
];

/** data -> sheets for writeXlsx */
export function toWorkbook(data) {
  const yn = (b) => (b ? "Yes" : "No");
  const courseRows = [COURSE_HEADERS, ...data.courses.map((c) => [
    c.tab, c.name, PROFESSIONS.find((p) => p[0] === c.group)?.[1] || "", yn(c.show !== false),
    yn(c.barcode), yn(c.bloodBag),
    c.doctor?.username || "", c.doctor?.password || "", c.witness?.username || "", c.witness?.password || "",
    c.accessUrl || "", c.notes || "",
  ])];
  const colOf = (label) => String.fromCharCode(65 + COURSE_HEADERS.indexOf(label));
  const range = (label) => `${colOf(label)}2:${colOf(label)}500`;

  const courseTabs = data.courses.map((c) => {
    const rows = [LOGIN_HEADERS, ...c.logins.map((l) => {
      const pts = Array.from({ length: MAX_PATIENTS }, (_, i) => {
        const p = l.patients[i] || {};
        return Object.keys(PT_FIELDS).map((f) => (f === "mode" ? (p[f] ? MODES.find((m) => m[0] === p[f])?.[1] || "" : "") : p[f] || ""));
      }).flat();
      const hb = l.hbcis || {};
      return [
        l.login, l.password, l.facility, l.doctor,
        l.second?.label || "", l.second?.login || "", l.second?.password || "", l.second?.part || "",
        ...pts,
        ...Object.keys(HBCIS_COLS).map((k) => hb[k] || ""),
      ];
    })];
    const widths = LOGIN_HEADERS.map((h) => Math.min(28, Math.max(10, h.length + 2)));
    const modeCols = LOGIN_HEADERS.map((h, i) => (h.endsWith(" Mode") ? i : -1)).filter((i) => i >= 0);
    const validations = modeCols.map((i) => ({ sqref: `${colName(i)}2:${colName(i)}500`, list: MODES.map((m) => m[1]) }));
    return { name: c.tab, rows, widths, freeze: true, validations };
  });

  return [
    { name: "Read me", rows: README, widths: [120], wrap: true,
      rowStyles: Object.fromEntries(README.map((r, i) => [i, i === 0 || (README[i - 1]?.[0] === "" && r[0]) ? 3 : 2])) },
    { name: "Courses", rows: courseRows, freeze: true,
      widths: [24, 34, 14, 12, 15, 16, 18, 16, 18, 16, 40, 30],
      validations: [
        { sqref: range("Profession"), list: PROFESSIONS.map((p) => p[1]) },
        { sqref: range("Show on site"), list: YES_NO },
        { sqref: range("Patient barcodes"), list: YES_NO },
        { sqref: range("Blood bag barcode"), list: YES_NO },
      ] },
    ...courseTabs,
  ];
}
