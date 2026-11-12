// Training Card app. Runs from a local file in Edge; no network needed.
// Must stay the LAST script on the page: it snapshots the untouched page so the
// admin screen can save a copy of this file with new data inside.
const PRISTINE = "<!doctype html>\n" + document.documentElement.outerHTML;
const ORIGINAL = JSON.parse(document.getElementById("tc-data").textContent);

const GROUPS = [
  { id: "nursing",   name: "Nursing",       icon: "heart" },
  { id: "medical",   name: "Medical",       icon: "steth" },
  { id: "midwifery", name: "Midwifery",     icon: "baby" },
  { id: "admin",     name: "Admin",         icon: "clip" },
  { id: "pharmacy",  name: "Pharmacy",      icon: "pill" },
  { id: "allied",    name: "Allied Health", icon: "hand" },
];

const ICONS = {
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M7.5 11.5h2.5l1.2-2 1.8 4 1.2-2h2.3"/>',
  steth: '<path d="M6 3v5a4 4 0 0 0 8 0V3"/><path d="M10 12v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
  baby:  '<circle cx="12" cy="7.5" r="3.5"/><path d="M5.5 21c0-4 2.9-7 6.5-7s6.5 3 6.5 7"/><path d="M10.5 7.5h.01M13.5 7.5h.01"/>',
  clip:  '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  pill:  '<rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="m10 9 4.2 6"/>',
  hand:  '<circle cx="12" cy="4.5" r="2"/><path d="M5 8.5h14M12 8.5V14m0 0-3.5 7M12 14l3.5 7"/>',
};
const icon = (name, sw = 1.7) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>';
const TICK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const OK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/></svg>';
const BAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const same = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
const groupOf = (id) => GROUPS.find((g) => g.id === id) || GROUPS[0];
const byLogin = (a, b) => a.login.localeCompare(b.login, undefined, { numeric: true }) || a.facility.localeCompare(b.facility);

/* ---------------- Data ---------------- */
let DATA, COURSES, courseById, INDEX;
const RUNTIME_KEYS = new Set(["has", "hbHas", "facilities", "sorted"]);

function setData(d) {
  DATA = d;
  COURSES = d.courses.filter((c) => c.show !== false && c.logins.length);
  courseById = Object.fromEntries(COURSES.map((c) => [c.id, c]));
  INDEX = new Map();
  for (const c of COURSES) {
    const has = (f) => c.logins.some((l) => l.patients.some((p) => p[f]));
    c.has = { ward: has("ward"), dob: has("dob"), mrn: has("mrn"), ioms: has("ioms") };
    c.hbHas = {};
    for (const l of c.logins) if (l.hbcis) for (const [k, v] of Object.entries(l.hbcis)) if (v) c.hbHas[k] = true;
    c.facilities = [...new Set(c.logins.map((l) => l.facility).filter(Boolean))].sort();
    c.sorted = [...c.logins].sort(byLogin);
    for (const l of c.sorted) {
      const add = (id, via) => {
        const k = id.toUpperCase();
        if (!INDEX.has(k)) INDEX.set(k, []);
        INDEX.get(k).push({ c, l, via });
      };
      add(l.login, "");
      if (l.second && l.second.login) add(l.second.login, l.second.label || "Second login");
    }
  }
  $("#data-stamp").textContent = d.updated ? "Data updated " + d.updated : "";
}

/* ---------------- Routing ----------------
   #/                           home
   #/g/<profession>             courses for a profession
   #/c/<course>                 logins for a course
   #/c/<course>/<login>[/<fac>] the card
   #/admin                      update data (hidden) */
const state = { facility: "", tab: 0 };

function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
const cardHash = (c, l) => `#/c/${c.id}/${encodeURIComponent(l.login)}` +
  (l.facility && c.logins.filter((x) => same(x.login, l.login)).length > 1 ? "/" + encodeURIComponent(l.facility) : "");

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  closeOverlay();
  if (parts[0] === "admin") return showAdmin();
  if (parts[0] === "c" && courseById[parts[1]]) {
    const c = courseById[parts[1]];
    if (parts[2]) {
      const l = c.logins.find((x) => same(x.login, parts[2]) && (!parts[3] || same(x.facility, parts[3])));
      if (l) return showCard(c, l);
    }
    return showBrowse(c.group, c);
  }
  if (parts[0] === "g" && GROUPS.some((g) => g.id === parts[1])) return showBrowse(parts[1], null);
  showBrowse(null, null);
}

function showView(id) {
  for (const v of ["browse", "card", "admin"]) $("#" + v).hidden = v !== id;
  $("#nav-note").hidden = id === "card";
  $("#complete-open").hidden = id !== "card";
}

/* ---------------- Browse ---------------- */
let lastScrollTarget = null;

function showBrowse(groupId, course) {
  showView("browse");
  renderProfessions(groupId);

  const cs = $("#course-section");
  cs.hidden = !groupId;
  if (groupId) {
    $("#course-title").innerHTML = `${esc(groupOf(groupId).name)} courses. <span>Pick the one you're in today.</span>`;
    renderCourses(groupId, course);
  }

  const ls = $("#login-section");
  ls.hidden = !course;
  if (course) {
    if (state.courseId !== course.id) { state.facility = ""; state.courseId = course.id; }
    renderLogins(course);
  }

  const target = course ? ls : groupId ? cs : null;
  const key = course ? "c:" + course.id : groupId ? "g:" + groupId : "home";
  if (target && lastScrollTarget !== key) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  if (!target && lastScrollTarget && lastScrollTarget !== "home") window.scrollTo({ top: 0 });
  lastScrollTarget = key;
}

function renderProfessions(active) {
  const live = GROUPS.filter((g) => COURSES.some((c) => c.group === g.id));
  $("#professions").innerHTML = live.map((g) => `
    <button class="prof" type="button" data-group="${g.id}" aria-pressed="${g.id === active}">
      <span class="icon">${icon(g.icon)}</span>
      <span class="label">${esc(g.name)}</span>
    </button>`).join("");
}

function renderCourses(groupId, active) {
  const g = groupOf(groupId);
  $("#courses").innerHTML = COURSES.filter((c) => c.group === groupId).map((c, i) => {
    const bits = [`${c.logins.length} login${c.logins.length === 1 ? "" : "s"}`];
    if (c.facilities.length > 1) bits.push(`${c.facilities.length} facilities`);
    if (c.logins.some((l) => l.hbcis && l.patients.length)) bits.push("ieMR + HBCIS");
    else if (c.logins.some((l) => l.hbcis)) bits.push("HBCIS");
    if (c.barcode) bits.push("ID band barcodes");
    return `
    <button class="course" type="button" data-group="${c.group}" data-course="${c.id}"
            aria-pressed="${!!active && active.id === c.id}" style="animation-delay:${i * 40}ms">
      <span class="eyebrow">${esc(g.name)}</span>
      <span class="title">${esc(c.name)}</span>
      <span class="meta">${esc(bits.join(" · "))}</span>
      <span class="cta">Choose login ›</span>
      <span class="art">${icon(g.icon, 1.2)}</span>
    </button>`;
  }).join("");
}

function renderLogins(c) {
  const chips = $("#chips");
  chips.hidden = c.facilities.length < 2;
  chips.innerHTML = c.facilities.length < 2 ? "" : ["", ...c.facilities].map((f) =>
    `<button class="chip" type="button" data-facility="${esc(f)}" aria-pressed="${state.facility === f}">${f ? esc(f) : "All"}</button>`).join("");
  const showFac = c.facilities.length > 1 && !state.facility;
  $("#logins").innerHTML = c.sorted.filter((l) => !state.facility || l.facility === state.facility).map((l, i) => `
    <button class="login-tile num" type="button" data-href="${esc(cardHash(c, l))}" style="animation-delay:${Math.min(i, 30) * 12}ms">
      <span class="l">${esc(l.login)}</span>
      ${showFac ? `<span class="f">${esc(l.facility)}</span>` : ""}
    </button>`).join("");
}

$("#professions").addEventListener("click", (e) => { const b = e.target.closest(".prof"); if (b) go("#/g/" + b.dataset.group); });
$("#courses").addEventListener("click", (e) => { const b = e.target.closest(".course"); if (b) go("#/c/" + b.dataset.course); });
$("#chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  state.facility = b.dataset.facility;
  renderLogins(courseById[state.courseId]);
});
$("#logins").addEventListener("click", (e) => { const b = e.target.closest(".login-tile"); if (b) go(b.dataset.href); });
$("#home").addEventListener("click", () => go("#/"));

/* ---------------- Card ---------------- */
const DASH = '<span class="v muted">—</span>';
const BLOOD_BAG = { src: "data:image/png;base64,__BLOODBAG_PNG__", number: "A530-024-0384" };

function copyBtn(label, value) {
  return `<button class="copy" type="button" data-copy="${esc(value)}" aria-label="Copy ${esc(label)}">${COPY_ICON}</button>`;
}
function row(label, value, opts = {}) {
  const v = value ? `<span class="v ${opts.num ? "num" : ""}">${esc(value)}</span>` : DASH;
  return `<div class="row"><span class="k">${esc(label)}</span>${v}${value && opts.copy !== false ? copyBtn(label, value) : ""}</div>`;
}
function cred(label, value) {
  return `<div class="cred"><div><span class="k">${esc(label)}</span><span class="v num">${esc(value || "—")}</span></div>${value ? copyBtn(label, value) : ""}</div>`;
}
function miniCreds(s) {
  return `<div class="mini-creds">
    <div class="mini-cred"><span class="k">${esc(s.label || "Login")}</span><span class="v num">${esc(s.login)}</span>${copyBtn(s.label || "login", s.login)}</div>
    ${s.password ? `<div class="mini-cred"><span class="k">Password</span><span class="v">${esc(s.password)}</span>${copyBtn("password", s.password)}</div>` : ""}
  </div>`;
}
function aztecSVG(text) { try { return window.TC.makeAztec(text); } catch (err) { return ""; } }

function patientCard(c, p, i) {
  const code = c.barcode && p.fin ? "AC" + p.fin : "";
  const svg = code ? aztecSVG(code) : "";
  const fullName = [p.last, p.first].filter(Boolean).join(", ");
  const rows = [
    c.has.mrn ? row("MRN", p.mrn, { num: true }) : "",
    c.has.ioms ? row("IOMS", p.ioms, { num: true }) : "",
    c.has.dob ? row("DOB", p.dob, { copy: false }) : "",
    c.has.ward ? row("Ward", p.ward) : "",
  ].join("");
  return `
  <article class="patient" style="animation-delay:${60 + i * 60}ms">
    <div class="p-head">
      <div>
        <div class="eyebrow">Patient ${i + 1}${p.role ? " · " + esc(p.role) : ""}</div>
        <div class="name"><span>${esc(p.last || "—")}</span>${p.last ? copyBtn("last name", p.last) : ""}</div>
        ${p.first ? `<div class="first"><span>${esc(p.first)}</span>${copyBtn("first name", p.first)}</div>` : ""}
      </div>
      ${svg ? `
      <button class="barcode" type="button" data-code="${esc(code)}" data-who="${esc(fullName)}" title="Click to enlarge" aria-label="Enlarge ID band barcode for ${esc(fullName)}">
        ${svg}<span class="cap num">${esc(code)}</span>
      </button>` : ""}
    </div>
    ${rows ? `<div class="details">${rows}</div>` : ""}
  </article>`;
}

function groupsOf(c, l) {
  if (c.layout === "all") return [{ name: "", patients: l.patients }];
  const order = [];
  const map = new Map();
  for (const p of l.patients) {
    const g = p.group || "";
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g).push(p);
  }
  return order.map((g) => ({ name: g, patients: map.get(g) }));
}

function grid(c, l, list) {
  const cls = list.length >= 3 ? "compact three" : l.hbcis ? "compact" : "";
  return `<div class="patients ${cls}">${list.map((p, i) => patientCard(c, p, i)).join("")}</div>`;
}

// The patient area. Returns { tabs, body } so tab buttons can sit in the heading row.
function patientArea(c, l) {
  const groups = groupsOf(c, l);
  const sec = l.second;
  const secFor = (g) => (sec && sec.group && same(sec.group, g) ? miniCreds(sec) : "");
  if (groups.length < 2) return { tabs: "", body: secFor(groups[0]?.name) + grid(c, l, l.patients) };
  if (c.layout === "tabs") {
    const active = Math.min(state.tab, groups.length - 1);
    const tabs = `<div class="seg" role="tablist" aria-label="Patient sets">${groups.map((g, i) =>
      `<button type="button" role="tab" data-tab="${i}" aria-selected="${i === active}">${esc(g.name || "Other")}</button>`).join("")}</div>`;
    return { tabs, body: secFor(groups[active].name) + grid(c, l, groups[active].patients) };
  }
  return {
    tabs: "",
    body: groups.map((g) => `
      <div class="psection">
        <div class="psection-head"><h3>${esc(g.name || "Other patients")}</h3>${secFor(g.name)}</div>
        ${grid(c, l, g.patients)}
      </div>`).join(""),
  };
}

function hbcisPanel(c, hb, solo) {
  const show = (k) => hb[k] || c.hbHas[k];
  const r = (k, label, opts) => (show(k) ? row(label, hb[k], opts) : "");
  const login = hb.login ? `<div class="group-title">Login</div>${row("Login", hb.login, { num: true })}${row("Password", hb.password)}` : "";
  return `<div class="hbcis ${solo ? "solo" : ""}">
    ${login}
    <div class="group-title">Patient</div>
    ${r("urn", "URN", { num: true })}
    ${r("last", "Last name")}${r("first", "First name")}${r("alias", "Alias")}
    ${r("dob", "DOB", { copy: false })}
    ${r("doctor", "Doctor")}${r("unit", "Unit")}${r("ward", "Ward")}${r("transfer", "Transfer to")}
  </div>`;
}

let current = null;

function showCard(c, l) {
  if (!current || current.l !== l) state.tab = 0;
  current = { c, l };
  state.courseId = c.id;
  showView("card");
  const card = $("#card");
  card.dataset.group = c.group;
  const g = groupOf(c.group);

  // A second login with no matching tab/section goes up in the header.
  const groupNames = groupsOf(c, l).map((x) => x.name);
  const secInHeader = l.second && !(l.second.group && groupNames.some((n) => same(n, l.second.group)) && groupNames.length > 1);

  const area = patientArea(c, l);
  let main = "";
  if (l.patients.length && l.hbcis) {
    main = `
    <div class="systems">
      <div>
        <div class="head-row"><h3 class="system-label">ieMR <i>Patients</i></h3>${area.tabs}</div>
        <div id="pt-area">${area.body}</div>
      </div>
      <div>
        <h3 class="system-label">HBCIS <i>Second system</i></h3>
        ${hbcisPanel(c, l.hbcis)}
      </div>
    </div>`;
  } else if (l.patients.length) {
    main = `
    <section>
      <div class="head-row"><h2 class="h3">Your patients. <span>Use these in ieMR today.</span></h2>${area.tabs}</div>
      <div id="pt-area">${area.body}</div>
    </section>`;
  } else if (l.hbcis) {
    main = `
    <section>
      <div class="head-row"><h2 class="h3">Your HBCIS patient. <span>Use this in HBCIS today.</span></h2></div>
      ${hbcisPanel(c, l.hbcis, true)}
    </section>`;
  } else {
    main = `<div class="empty-state">No patients are set up for this login yet. Please ask your trainer.</div>`;
  }

  const others = [];
  const doctorUser = l.doctor || c.doctor?.username;
  if (doctorUser) others.push({ label: "Doctor", note: "Doctor login", username: doctorUser, password: c.doctor?.password || "" });
  if (c.witness?.username) others.push({ label: "Witness", note: "Second nurse check", ...c.witness });
  const otherCards = others.map((o, i) => `
    <div class="other" style="animation-delay:${180 + i * 50}ms">
      <h3>${esc(o.label)}</h3><p>${esc(o.note)}</p>
      ${row("Username", o.username)}
      ${row("Password", o.password)}
    </div>`);
  if (c.bloodBag) otherCards.push(`
    <div class="other" style="animation-delay:${180 + otherCards.length * 50}ms">
      <h3>Blood bag</h3><p>Scan for blood product checks</p>
      <button class="bloodbag" type="button" data-bloodbag title="Click to enlarge" aria-label="Enlarge blood bag barcode">
        <img src="${BLOOD_BAG.src}" alt="Blood bag barcode ${BLOOD_BAG.number}">
      </button>
    </div>`);

  $("#card-body").innerHTML = `
    <div class="card-top"><button class="back" type="button" id="back">‹ ${esc(c.name)} logins</button></div>
    <section class="card-head">
      <div>
        <div class="eyebrow">${same(g.name, c.name) ? "" : esc(g.name) + " · "}${esc(c.name)}${l.facility && c.facilities.length > 1 ? " · " + esc(l.facility) : ""}</div>
        <h1 class="num">${esc(l.login)}</h1>
      </div>
      <div class="creds">
        ${cred("Login", l.login)}${cred("Password", l.password)}
        ${secInHeader ? cred(l.second.label || "Second login", l.second.login) : ""}
      </div>
    </section>
    ${main}
    ${otherCards.length ? `
    <section class="sub">
      <h2 class="h3">Other logins. <span>For checks and orders.</span></h2>
      <div class="others">${otherCards.join("")}</div>
    </section>` : ""}
    <section class="complete">
      <div>
        <h3>Finished your training?</h3>
        <p>Once your trainer signs you off, request your access here.</p>
      </div>
      <button class="btn light" type="button" data-complete>Course complete</button>
    </section>
    <div style="height:40px"></div>`;

  $("#back").addEventListener("click", () => go("#/c/" + c.id));
  lastScrollTarget = "card";
  window.scrollTo({ top: 0 });
}

$("#card-body").addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]");
  if (!t || !current) return;
  state.tab = +t.dataset.tab;
  const area = patientArea(current.c, current.l);
  t.parentElement.outerHTML = area.tabs;
  $("#pt-area").innerHTML = area.body;
  $(`#card-body [data-tab="${state.tab}"]`)?.focus();
});

/* ---------------- Course complete ---------------- */
const dlg = $("#complete");
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-complete], #complete-open")) return;
  dlg.querySelectorAll("[data-step]").forEach((s) => (s.hidden = s.dataset.step !== "ask"));
  dlg.showModal();
});
dlg.addEventListener("click", (e) => {
  if (e.target === dlg) return dlg.close();
  const a = e.target.closest("[data-answer]");
  if (a) {
    if (a.dataset.answer === "yes") {
      const url = (current && current.c.accessUrl) || window.TC.DEFAULT_ACCESS_URL;
      $("#access-link").href = url;
      window.open(url, "_blank", "noopener");
    }
    dlg.querySelectorAll("[data-step]").forEach((s) => (s.hidden = s.dataset.step !== a.dataset.answer));
  }
  if (e.target.closest("[data-close]")) dlg.close();
});

/* ---------------- Copy ---------------- */
const toast = $("#toast");
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest(".copy"); if (!b) return;
  if (await copyText(b.dataset.copy)) {
    b.classList.add("done"); b.innerHTML = TICK_ICON;
    showToast(`Copied ${b.dataset.copy}`);
    setTimeout(() => { b.classList.remove("done"); b.innerHTML = COPY_ICON; }, 1400);
  }
});

/* ---------------- Barcode overlay ---------------- */
let overlay = null;
function openOverlay(code, who, art) {
  closeOverlay();
  overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Barcode");
  overlay.innerHTML = `<div class="big">${art || aztecSVG(code)}</div>
    <div class="code num">${esc(code)}</div><div class="who">${esc(who)}</div>
    <div class="close-hint">Click anywhere or press Esc to close</div>`;
  overlay.addEventListener("click", closeOverlay);
  document.body.appendChild(overlay);
}
function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
document.addEventListener("click", (e) => {
  const b = e.target.closest(".barcode"); if (b) openOverlay(b.dataset.code, b.dataset.who);
  if (e.target.closest("[data-bloodbag]")) openOverlay(BLOOD_BAG.number, "Blood bag", `<img src="${BLOOD_BAG.src}" alt="">`);
});

/* ---------------- Search ---------------- */
const q = $("#q"), results = $("#results");
let hits = [], sel = 0;

function search(term) {
  const t = term.toUpperCase().replace(/\s+/g, "");
  if (!t) return [];
  if (INDEX.has(t)) return INDEX.get(t);
  const out = [];
  for (const [k, arr] of INDEX) if (k.startsWith(t)) out.push(...arr);
  if (out.length < 8) for (const [k, arr] of INDEX) if (!k.startsWith(t) && k.includes(t)) out.push(...arr);
  return out.slice(0, 8);
}

function renderResults() {
  const term = q.value.trim();
  if (!term) { results.hidden = true; return; }
  hits = search(term);
  sel = 0;
  const exact = term.toUpperCase().replace(/\s+/g, "");
  const exactMulti = hits.length > 1 && INDEX.get(exact) === hits;
  results.hidden = false;
  results.innerHTML = hits.length
    ? (exactMulti ? `<div class="hint">${esc(exact)} is used in more than one place. Pick yours:</div>` : "") +
      hits.map((h, i) => {
        const shown = h.via ? h.l.second.login : h.l.login;
        const where = [h.c.name, h.l.facility && h.c.facilities.length > 1 ? h.l.facility : "", h.via ? `${h.via} for ${h.l.login}` : ""].filter(Boolean).join(" · ");
        return `
      <button class="result" type="button" role="option" data-i="${i}" data-group="${h.c.group}" aria-selected="${i === sel}">
        <span class="dot"></span>
        <span class="login num">${esc(shown)}</span>
        <span class="r-course">${esc(where)}</span>
        <span class="go">›</span>
      </button>`;
      }).join("")
    : `<div class="empty">No login matches “${esc(term)}”. Check with your trainer.</div>`;
}

function pick(i) {
  const h = hits[i]; if (!h) return;
  results.hidden = true; q.value = ""; q.blur();
  go(cardHash(h.c, h.l));
}

q.addEventListener("input", renderResults);
q.addEventListener("focus", renderResults);
q.addEventListener("keydown", (e) => {
  if (results.hidden) return;
  const opts = results.querySelectorAll(".result");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!opts.length) return;
    sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute("aria-selected", i === sel));
    opts[sel].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
  else if (e.key === "Escape") results.hidden = true;
});
results.addEventListener("click", (e) => { const b = e.target.closest(".result"); if (b) pick(+b.dataset.i); });
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) results.hidden = true; });

/* ---------------- Admin: update data ---------------- */
let pending = null;   // { data, stats } from a checked spreadsheet
let previewing = false;

function statsOf(d) {
  const live = d.courses.filter((c) => c.show !== false && c.logins.length);
  return {
    courses: live.length,
    logins: live.reduce((s, c) => s + c.logins.length, 0),
    patients: live.reduce((s, c) => s + c.logins.reduce((t, l) => t + l.patients.length + (l.hbcis ? 1 : 0), 0), 0),
  };
}

function showAdmin() {
  showView("admin");
  const s = statsOf(ORIGINAL);
  $("#admin-now").innerHTML = `
    <div><b>${s.courses.toLocaleString("en-AU")}</b><span>courses shown</span></div>
    <div><b>${s.logins.toLocaleString("en-AU")}</b><span>logins</span></div>
    <div><b>${s.patients.toLocaleString("en-AU")}</b><span>patients</span></div>
    <div><b>${esc(ORIGINAL.updated || "—")}</b><span>this file last updated</span></div>`;
  lastScrollTarget = "admin";
  window.scrollTo({ top: 0 });
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const cleanJSON = (d) => JSON.stringify(d, (k, v) => (RUNTIME_KEYS.has(k) ? undefined : v));

$("#export").addEventListener("click", async () => {
  try {
    const plain = JSON.parse(cleanJSON(ORIGINAL));
    download(await window.TC.writeXlsx(window.TC.toWorkbook(plain)), "Training-Card-Data.xlsx");
    showToast("Downloaded Training-Card-Data.xlsx");
  } catch (err) {
    showToast("Sorry, that didn't work: " + err.message);
  }
});

function changesTable(oldD, newD) {
  const key = (l) => `${l.login}|${l.facility}`.toUpperCase();
  const oldBy = Object.fromEntries(oldD.courses.map((c) => [c.id, c]));
  const newIds = new Set(newD.courses.map((c) => c.id));
  const rows = [];
  for (const c of newD.courses) {
    const o = oldBy[c.id];
    const before = new Set((o ? o.logins : []).map(key));
    const after = new Set(c.logins.map(key));
    const added = [...after].filter((k) => !before.has(k)).length;
    const removed = [...before].filter((k) => !after.has(k)).length;
    const changed = o ? c.logins.filter((l) => {
      const ol = o.logins.find((x) => key(x) === key(l));
      return ol && cleanJSON(ol) !== cleanJSON(l);
    }).length : 0;
    const hidden = c.show === false || !c.logins.length;
    if (!o || added || removed || changed || cleanJSON({ ...o, logins: 0 }) !== cleanJSON({ ...c, logins: 0 }))
      rows.push(`<tr><td>${esc(c.name)}${!o ? ' <span class="plus">new</span>' : ""}${hidden ? ' <span class="muted">(hidden)</span>' : ""}</td>
        <td class="n">${c.logins.length}</td><td class="n plus">${added ? "+" + added : ""}</td>
        <td class="n minus">${removed ? "−" + removed : ""}</td><td class="n">${changed || ""}</td></tr>`);
  }
  for (const o of oldD.courses) if (!newIds.has(o.id))
    rows.push(`<tr><td>${esc(o.name)} <span class="minus">removed</span></td><td class="n">0</td><td></td><td class="n minus">−${o.logins.length}</td><td></td></tr>`);
  if (!rows.length) return `<p>No changes compared with the current Training Card.</p>`;
  return `<table class="changes"><thead><tr><th>Course</th><th class="n">Logins</th><th class="n">Added</th><th class="n">Removed</th><th class="n">Edited</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function issueList(list) {
  return `<div class="issues">${list.map((i) => `
    <div class="issue ${i.level}">
      <span class="lvl">${i.level === "error" ? "Problem" : i.level === "warning" ? "Check" : "Note"}</span>
      <span class="where">${esc(i.where)}</span>
      <span class="msg">${esc(i.message)}</span>
    </div>`).join("")}</div>`;
}

function setStep4(enabled) {
  $("#step4").classList.toggle("locked", !enabled);
  $("#try").disabled = $("#save").disabled = !enabled;
  $("#saved").hidden = true;
}

async function loadFile(file) {
  const report = $("#report");
  pending = null;
  setStep4(false);
  if (!file) return;
  report.innerHTML = `<div class="verdict busy"><div><b>Checking ${esc(file.name)}…</b></div></div>`;
  let res;
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error("This needs to be an Excel .xlsx file. In Excel, use File › Save As › Excel Workbook (.xlsx).");
    res = window.TC.fromWorkbook(await window.TC.readXlsx(await file.arrayBuffer()));
  } catch (err) {
    report.innerHTML = `<div class="verdict bad">${BAD_ICON}<div><b>Couldn't read this file</b><span>${esc(err.message)}</span></div></div>`;
    return;
  }
  const errors = res.issues.filter((i) => i.level === "error");
  const checks = res.issues.filter((i) => i.level === "warning");
  const notes = res.issues.filter((i) => i.level === "info");
  if (errors.length) {
    report.innerHTML = `
      <div class="verdict bad">${BAD_ICON}<div><b>${errors.length} problem${errors.length > 1 ? "s" : ""} to fix first</b>
        <span>Fix ${errors.length > 1 ? "these" : "this"} in Excel, save, then load the file again. Nothing has been changed.</span></div></div>
      <div class="sub-h">Problems</div>${issueList(errors.slice(0, 60))}
      ${errors.length > 60 ? `<p>…and ${errors.length - 60} more.</p>` : ""}
      ${checks.length ? `<details class="more"><summary>Also ${checks.length} thing${checks.length > 1 ? "s" : ""} to check</summary>${issueList(checks)}</details>` : ""}`;
    return;
  }
  pending = res;
  const s = res.stats;
  report.innerHTML = `
    <div class="verdict ok">${OK_ICON}<div><b>Ready to use</b>
      <span>${s.courses} courses, ${s.logins.toLocaleString("en-AU")} logins and ${s.patients.toLocaleString("en-AU")} patients will show.${s.hidden ? ` ${s.hidden} course${s.hidden > 1 ? "s are" : " is"} hidden.` : ""}</span></div></div>
    ${checks.length ? `<div class="sub-h">Worth checking (won't stop you saving)</div>${issueList(checks.slice(0, 40))}${checks.length > 40 ? `<p>…and ${checks.length - 40} more.</p>` : ""}` : ""}
    <div class="sub-h">Changes</div>${changesTable(ORIGINAL, res.data)}
    ${notes.length ? `<details class="more"><summary>${notes.length} note${notes.length > 1 ? "s" : ""}</summary>${issueList(notes)}</details>` : ""}`;
  setStep4(true);
}

$("#file").addEventListener("change", (e) => loadFile(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

function stamped(d) {
  const now = new Date();
  return { ...JSON.parse(cleanJSON(d)), updated: `${now.getDate()} ${now.toLocaleString("en-AU", { month: "short" })} ${now.getFullYear()}` };
}

function saveNew() {
  if (!pending) return;
  const json = cleanJSON(stamped(pending.data)).replace(/</g, "\\u003c");
  const re = /(<script id="tc-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!re.test(PRISTINE)) return showToast("Sorry, the page couldn't copy itself.");
  const html = PRISTINE.replace(re, (m, a, b) => a + json + b);
  download(new Blob([html], { type: "text/html" }), "TrainingCard.html");
  $("#saved").hidden = false;
  showToast("Saved TrainingCard.html to Downloads");
}

function tryIt() {
  if (!pending) return;
  setData(stamped(pending.data));
  $("#data-stamp").textContent = "Trying new data";
  previewing = true;
  $("#preview-bar").hidden = false;
  lastScrollTarget = null;
  go("#/");
}
function endPreview() {
  setData(ORIGINAL);
  previewing = false;
  $("#preview-bar").hidden = true;
  go("#/admin");
}

$("#save").addEventListener("click", saveNew);
$("#try").addEventListener("click", tryIt);
$("#pv-save").addEventListener("click", saveNew);
$("#pv-discard").addEventListener("click", endPreview);
$("#admin-close").addEventListener("click", () => (previewing ? endPreview() : go("#/")));

// Hidden ways in: Ctrl + Alt + U, or click "Data updated" in the footer 5 times quickly.
let taps = [];
$("#data-stamp").addEventListener("click", () => {
  const now = Date.now();
  taps = [...taps.filter((t) => now - t < 2500), now];
  if (taps.length >= 5) { taps = []; go("#/admin"); }
});

/* ---------------- Keyboard ---------------- */
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "u") { e.preventDefault(); return go("#/admin"); }
  if (e.key === "Escape") {
    if (dlg.open) return;
    if (overlay) return closeOverlay();
    if (!$("#card").hidden) return go("#/c/" + state.courseId);
  }
  if (e.key === "/" && document.activeElement !== q && !$("#browse").hidden) { e.preventDefault(); q.focus(); }
});

setData(ORIGINAL);
window.addEventListener("hashchange", route);
route();
