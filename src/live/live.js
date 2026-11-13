// Training Card, live classes. Talks to the database only through the checked tc_* functions.
const { SUPABASE_URL, SUPABASE_KEY } = window.TC;

/* ---------------- Shared bits ---------------- */
const GROUPS = [
  { id: "nursing",   name: "Nursing",       icon: "heart" },
  { id: "medical",   name: "Medical",       icon: "steth" },
  { id: "midwifery", name: "Midwifery",     icon: "baby" },
  { id: "admin",     name: "Admin",         icon: "clip" },
  { id: "pharmacy",  name: "Pharmacy",      icon: "pill" },
  { id: "allied",    name: "Allied Health", icon: "hand" },
];
const MODE_LABEL = { instructor: "Instructor led", proficiency: "Proficiency", always: "" };
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>';
const TICK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const BACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const BLOOD_BAG = { src: "data:image/png;base64,__BLOODBAG_PNG__", number: "A530-024-0384" };

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const groupOf = (id) => GROUPS.find((g) => g.id === id) || GROUPS[0];
const view = $("#view");
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : "");

const store = {
  get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
  set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch {} },
};
// One PC can run several trainee screens (e.g. a dual-screen PC). Each window opened with
// ?seat=N (the Live launchers do this) is its own trainee with its own login.
const SEAT = (() => {
  const n = parseInt(new URLSearchParams(location.search).get("seat") || "", 10);
  return n >= 1 && n <= 9 ? n : 0;
})();
function deviceId() {
  const key = SEAT ? `tc-device-seat${SEAT}` : "tc-device";
  let d = store.get(key);
  if (!d) { d = crypto.randomUUID(); store.set(key, d); }
  return d;
}
const seatLabel = SEAT ? `Screen ${SEAT}` : "";
const staff = {
  get token() { return store.get("tc-staff", sessionStorage); },
  get role() { return store.get("tc-role", sessionStorage); },
  set(token, role) { store.set("tc-staff", token, sessionStorage); store.set("tc-role", role, sessionStorage); },
  clear() { this.set(null, null); },
};

/* ---------------- API ---------------- */
class NetError extends Error {}
async function api(fn, args) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch {
    throw new NetError("Can’t reach the Training Card service. Check the network, or use the offline Training Card.");
  }
  if (!r.ok) throw new NetError("The Training Card service had a problem. Try again in a moment.");
  return r.json();
}
// Staff calls: a signed-out answer sends the person back to sign in.
async function staffApi(fn, args) {
  const res = await api(fn, { p_token: staff.token, ...args });
  if (!res.ok && res.error === "signed_out") {
    staff.clear();
    go(location.hash.startsWith("#/admin") ? "#/admin" : "#/instructor");
    showToast("Signed out. Please sign in again.");
    throw new NetError("signed out");
  }
  return res;
}

/* ---------------- Live updates ---------------- */
let rt = null, chan = null, chanTopic = "", pollTimer = null;
function listen(channelId, onChange, pollMs) {
  const topic = "tc-" + channelId;
  stopListening();
  try {
    rt = rt || new window.TC.RealtimeClient(SUPABASE_URL.replace(/^http/, "ws") + "/realtime/v1", { params: { apikey: SUPABASE_KEY } });
    rt.connect();
    chan = rt.channel(topic);
    chan.on("broadcast", { event: "stage" }, () => onChange("stage"));
    chan.on("broadcast", { event: "roster" }, () => onChange("roster"));
    chan.subscribe();
    chanTopic = topic;
  } catch {}
  // Safety net: if the live connection drops, still catch up.
  pollTimer = setInterval(() => { if (!document.hidden) onChange("poll"); }, pollMs);
}
function stopListening() {
  clearInterval(pollTimer);
  if (chan && rt) { try { rt.removeChannel(chan); } catch {} }
  chan = null; chanTopic = "";
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && current.refresh) current.refresh(); });

/* ---------------- Routing ----------------
   #/                  join a class (trainee)
   #/card              the trainee's live card
   #/instructor        sign in, then live classes and start a class
   #/instructor/start  start a class
   #/class/<id>        a class console
   #/admin             data and passwords */
const current = { refresh: null };
function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }

function setChrome({ complete = false, signout = false } = {}) {
  $("#complete-open").hidden = !complete;
  $("#signout").hidden = !signout;
  $("#nav-note").hidden = complete || signout;
}

async function route() {
  stopListening();
  current.refresh = null;
  view.onclick = null;
  closeOverlay();
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  try {
    if (parts[0] === "card") return await showCard();
    if (parts[0] === "instructor") return parts[1] === "start" ? await showStart() : await showDashboard();
    if (parts[0] === "class" && parts[1]) return await showClass(parts[1]);
    if (parts[0] === "admin") return await showAdmin();
    return await showHome();
  } catch (err) {
    if (err instanceof NetError && err.message === "signed out") return;
    view.innerHTML = `<section class="panel" style="margin:48px 0"><h2>Something went wrong</h2><p>${esc(err.message)}</p>
      <div class="form-actions"><button class="btn primary" type="button" onclick="location.reload()">Try again</button></div></section>`;
  }
}
window.addEventListener("hashchange", route);
$("#home").addEventListener("click", () => go(!staff.token ? "#/" : staff.role === "admin" ? "#/admin" : "#/instructor"));
$("#signout").addEventListener("click", async () => {
  try { await api("tc_staff_logout", { p_token: staff.token }); } catch {}
  staff.clear();
  go("#/");
});

/* ---------------- Home: join a class ---------------- */
async function showHome() {
  setChrome();
  // A PC that already has a place goes straight back to its card.
  const res = await api("tc_card", { p_device: deviceId() }).catch(() => null);
  if (res && res.ok) return go("#/card");
  view.innerHTML = `
    <section class="hero">
      <h1>Training Card</h1>
      <div class="hero-side">
        <p class="big">Join your class.<br>Get your login.</p>
        <p class="small">Your instructor shows a class code at the front of the room.${seatLabel ? ` This is ${esc(seatLabel.toLowerCase())} on this PC.` : ""}</p>
      </div>
    </section>
    <section class="join">
      <h2>Enter your class code</h2>
      <p>Six letters and numbers, shown on your instructor’s screen.</p>
      <form id="join-form" autocomplete="off">
        <input class="code-input" id="code" name="code" maxlength="8" inputmode="text" autocapitalize="characters"
               spellcheck="false" placeholder="e.g. 4K7M2Q" aria-label="Class code" required>
        <button class="btn primary" type="submit">Join class</button>
      </form>
      <p class="form-error" id="join-error" role="alert"></p>
    </section>
    <div class="staff-links">
      <button class="text-btn" type="button" data-go="#/instructor">Instructor sign in</button>
    </div>`;
  const code = $("#code");
  code.focus();
  $("#join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("#join-form button");
    btn.disabled = true;
    try {
      const r = await api("tc_join", { p_code: code.value, p_device: deviceId() });
      if (!r.ok) { $("#join-error").textContent = r.error; code.select(); return; }
      go("#/card");
    } catch (err) {
      $("#join-error").textContent = err.message;
    } finally { btn.disabled = false; }
  });
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });

/* ---------------- Card pieces (same design as the offline card) ---------------- */
function copyBtn(label, value) {
  return `<button class="copy" type="button" data-copy="${esc(value)}" aria-label="Copy ${esc(label)}" data-label="Copy ${esc(label)}">${COPY_ICON}</button>`;
}
function row(label, value, opts = {}) {
  const v = value ? `<span class="v ${opts.num ? "num" : ""}">${esc(value)}</span>` : '<span class="v muted">—</span>';
  return `<div class="row"><span class="k">${esc(label)}</span>${v}${value && opts.copy !== false ? copyBtn(label, value) : ""}</div>`;
}
function cred(label, value) {
  return `<div class="cred"><div><span class="k">${esc(label)}</span><span class="v num">${esc(value || "—")}</span></div>${value ? copyBtn(label, value) : ""}</div>`;
}
function aztecSVG(text) { try { return window.TC.makeAztec(text); } catch { return ""; } }

function patientCard(card, p, i, has) {
  const code = card.course.barcode && p.fin ? "AC" + p.fin : "";
  const svg = code ? aztecSVG(code) : "";
  const fullName = [p.last, p.first].filter(Boolean).join(", ");
  const badge = MODE_LABEL[p.mode] || "";
  const rows = [
    has.mrn ? row("MRN", p.mrn, { num: true }) : "",
    has.ioms ? row("IOMS", p.ioms, { num: true }) : "",
    has.dob ? row("DOB", p.dob, { copy: false }) : "",
    has.ward ? row("Ward", p.ward) : "",
  ].join("");
  return `
  <article class="patient" style="animation-delay:${40 + i * 60}ms">
    <div class="p-head">
      <div>
        <div class="p-tag">${badge ? `<span class="role">${esc(badge)}</span>` : ""}<span class="p-num">${esc(p.role || `Patient ${i + 1}`)}</span></div>
        <div class="nm-label">Surname</div>
        <div class="name"><span>${esc(p.last || "—")}</span>${p.last ? copyBtn("surname", p.last) : ""}</div>
        ${p.first ? `<div class="nm-label">First name</div><div class="first"><span>${esc(p.first)}</span>${copyBtn("first name", p.first)}</div>` : ""}
      </div>
      ${svg ? `<button class="barcode" type="button" data-code="${esc(code)}" data-who="${esc(fullName)}" title="Click to enlarge" aria-label="Enlarge ID band barcode for ${esc(fullName)}">${svg}<span class="cap num">${esc(code)}</span></button>` : ""}
    </div>
    ${rows ? `<div class="details">${rows}</div>` : ""}
  </article>`;
}

function hbcisPanel(hb, solo) {
  const r = (k, label, opts) => (hb[k] ? row(label, hb[k], opts) : "");
  return `<div class="hbcis ${solo ? "solo" : ""}">
    ${hb.login ? `<div class="group-title">Login</div>${row("Login", hb.login, { num: true })}${row("Password", hb.password)}` : ""}
    <div class="group-title">Patient</div>
    ${r("urn", "URN", { num: true })}${r("last", "Surname")}${r("first", "First name")}${r("alias", "Alias")}
    ${r("dob", "DOB", { copy: false })}${r("doctor", "Doctor")}${r("unit", "Unit")}${r("ward", "Ward")}${r("transfer", "Transfer to")}
  </div>`;
}

function patientsBlock(card) {
  const pts = card.patients;
  const has = { mrn: pts.some((p) => p.mrn), ioms: pts.some((p) => p.ioms), dob: pts.some((p) => p.dob), ward: pts.some((p) => p.ward) };
  const cls = pts.length >= 3 ? "compact three" : card.hbcis ? "compact" : "";
  const grid = pts.length
    ? `<div class="patients ${cls}">${pts.map((p, i) => patientCard(card, p, i, has)).join("")}</div>`
    : `<div class="empty-state">No patients for this part of the class. Your instructor will switch over when it’s time.</div>`;
  const second = card.second ? `<div class="mini-creds"><div class="mini-cred"><span class="k">${esc(card.second.label || "Second login")}</span><span class="v num">${esc(card.second.login)}</span>${copyBtn("second login", card.second.login)}</div>${card.second.password ? `<div class="mini-cred"><span class="k">Password</span><span class="v">${esc(card.second.password)}</span>${copyBtn("password", card.second.password)}</div>` : ""}</div>` : "";
  if (card.hbcis && pts.length) {
    return `<div class="systems"><div><div class="head-row"><h3 class="system-label">ieMR <i>Patients</i></h3></div>${second}${grid}</div>
      <div><h3 class="system-label">HBCIS <i>Second system</i></h3>${hbcisPanel(card.hbcis)}</div></div>`;
  }
  if (card.hbcis) return `<div class="head-row"><h2 class="h3">Your HBCIS patient. <span>Use this in HBCIS today.</span></h2></div>${hbcisPanel(card.hbcis, true)}`;
  return `<div class="head-row"><h2 class="h3">Your patients. <span>Use these in ieMR today.</span></h2></div>${second}${grid}`;
}

function othersBlock(card) {
  const cards = [];
  if (card.doctor) cards.push(`<div class="other"><h3>Doctor</h3><p>Doctor login</p>${row("Username", card.doctor.username)}${row("Password", card.doctor.password)}</div>`);
  if (card.witness) cards.push(`<div class="other"><h3>Witness</h3><p>Second nurse check</p>${row("Username", card.witness.username)}${row("Password", card.witness.password)}</div>`);
  if (card.course.bloodBag) cards.push(`<div class="other"><h3>Blood bag</h3><p>Scan for blood product checks</p><button class="bloodbag" type="button" data-bloodbag title="Click to enlarge" aria-label="Enlarge blood bag barcode"><img src="${BLOOD_BAG.src}" alt="Blood bag barcode ${BLOOD_BAG.number}"></button></div>`);
  return cards.length ? `<section class="sub"><h2 class="h3">Other logins. <span>For checks and orders.</span></h2><div class="others">${cards.join("")}</div></section>` : "";
}

function stageText(cls) {
  return `${cls.part ? `<span class="part-name">${esc(cls.part)}</span>` : ""}<span class="mode-pill">${esc(MODE_LABEL[cls.mode])}</span>`;
}

/* ---------------- Trainee card ---------------- */
let accessUrl = "";
async function showCard() {
  setChrome({ complete: true });
  let lastStage = "";
  const render = async (why) => {
    let card;
    try { card = await api("tc_card", { p_device: deviceId() }); }
    catch (err) { if (why !== "first") return; throw err; }
    if (!card.ok) {
      stopListening();
      setChrome();
      view.innerHTML = `<section class="panel" style="margin:48px 0;max-width:640px">
        <h2>Your class has finished</h2>
        <p>Your instructor has ended this class, so your training login has been handed back.</p>
        <div class="form-actions"><button class="btn primary" type="button" data-go="#/">Join another class</button></div></section>`;
      return;
    }
    accessUrl = card.course.accessUrl || window.TC.DEFAULT_ACCESS_URL;
    const stage = card.class.part + "|" + card.class.mode;
    const changed = lastStage && stage !== lastStage;
    if (!changed && why !== "first" && why !== "stage") {
      // Nothing moved; don't redraw (keeps copy ticks and scroll still).
      if (stage === lastStage) return;
    }
    lastStage = stage;
    $("main").dataset.group = card.course.profession;
    view.innerHTML = `
      <section class="card-head">
        <div>
          <div class="course-name">${esc(card.course.name)}${card.login.facility ? ", " + esc(card.login.facility) : ""}</div>
          <h1 class="num">${esc(card.login.login)}</h1>
        </div>
        <div class="creds">${cred("Login", card.login.login)}${cred("Password", card.login.password)}</div>
      </section>
      <div class="stage ${changed ? "changed" : ""}" role="status" aria-live="polite">
        <span class="stage-label">Now showing</span>${stageText(card.class)}
        <span class="live-state">${seatLabel ? `<b>${esc(seatLabel)}</b>. ` : ""}Class ${esc(card.class.code)}${card.class.site ? ", " + esc(card.class.site) : ""}</span>
      </div>
      ${patientsBlock(card)}
      ${othersBlock(card)}
      <section class="complete">
        <div><h3>Finished your training?</h3><p>Once your trainer signs you off, request your access here.</p></div>
        <button class="btn light" type="button" data-complete>Course complete</button>
      </section>
      <div class="leave"><button class="text-btn" type="button" id="leave">Not your class? Leave and enter a different code</button></div>
      <div style="height:40px"></div>`;
    $("#leave").addEventListener("click", async () => {
      if (!(await confirmBox("Leave this class?", "Your place stays free so you can join again with the same code.", "Leave class"))) return;
      await api("tc_leave", { p_device: deviceId() }).catch(() => {});
      go("#/");
    });
    if (why === "first") listen(card.class.channel, (w) => render(w), 15000);
  };
  current.refresh = () => render("poll");
  await render("first");
}

/* ---------------- Instructor: sign in and live classes ---------------- */
function signinForm(role) {
  const label = role === "admin" ? "Admin" : "Instructor";
  view.innerHTML = `
    <div class="card-top"><button class="back" type="button" data-go="#/">${BACK_ICON}Back to joining a class</button></div>
    <header class="dash-head"><div><h1>${label} sign in</h1><p>${role === "admin" ? "Update course data and passwords." : "Start a class, hand out logins and switch patients."}</p></div></header>
    <section class="panel signin">
      <form id="signin-form">
        <div class="field">
          <label for="pw">${label} password</label>
          <input class="input" id="pw" type="password" autocomplete="current-password" required>
        </div>
        <p class="form-error" id="signin-error" role="alert"></p>
        <div class="form-actions"><button class="btn primary" type="submit">Sign in</button></div>
      </form>
    </section>
    <div style="height:64px"></div>`;
  $("#pw").focus();
  return new Promise((resolve) => {
    $("#signin-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#signin-form button"); btn.disabled = true;
      try {
        const r = await api("tc_staff_login", { p_role: role, p_password: $("#pw").value });
        if (!r.ok) { $("#signin-error").textContent = r.error; return; }
        staff.set(r.token, r.role);
        resolve();
      } catch (err) { $("#signin-error").textContent = err.message; }
      finally { btn.disabled = false; }
    });
  });
}

let overviewCache = null;
async function showDashboard() {
  setChrome({ signout: !!staff.token });
  if (!staff.token || !["instructor", "admin"].includes(staff.role)) { setChrome(); await signinForm("instructor"); setChrome({ signout: true }); }
  const ov = await staffApi("tc_overview", {});
  overviewCache = ov;
  const rows = ov.classes.map((c) => `
    <tr>
      <td><b>${esc(c.course)}</b>${c.facility ? `<br><span class="status waiting">${esc(c.facility)}</span>` : ""}</td>
      <td>${esc(c.site || "—")}</td>
      <td class="code-cell">${esc(c.code)}</td>
      <td class="n">${c.joined} of ${c.places}</td>
      <td>${time(c.createdAt)}</td>
      <td class="n"><button class="btn secondary nav-btn" type="button" data-go="#/class/${c.id}">Open</button></td>
    </tr>`).join("");
  view.innerHTML = `
    <header class="dash-head">
      <div><h1>Classes</h1><p>Every live class, at every site.</p></div>
      <button class="btn primary" type="button" data-go="#/instructor/start">Start a class</button>
    </header>
    <section class="panel">
      <h2>Live now</h2>
      <p>Logins in these classes are taken. Open a class to run it or add a walk-in.</p>
      ${ov.classes.length ? `<table class="live-table">
        <thead><tr><th>Course</th><th>Site</th><th>Code</th><th class="n">Joined</th><th>Started</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>` : `<p class="empty-line">No classes are running. Start one to get a class code.</p>`}
    </section>
    <div style="height:64px"></div>`;
  current.refresh = () => showDashboard();
}

/* ---------------- Instructor: start a class ---------------- */
async function showStart() {
  if (!staff.token) return go("#/instructor");
  setChrome({ signout: true });
  const ov = await staffApi("tc_overview", {});
  const pick = { course: null, facility: "", trainees: 6, site: store.get("tc-site") || "" };
  const draw = (focus) => {
    const groups = GROUPS.map((g) => {
      const cs = ov.courses.filter((c) => c.profession === g.id);
      if (!cs.length) return "";
      return `<div class="pick-group"><h3>${esc(g.name)}</h3><div class="course-pick">${cs.map((c) => `
        <button type="button" data-group="${g.id}" data-course="${esc(c.id)}" aria-pressed="${pick.course?.id === c.id}" ${c.free < 2 ? "disabled" : ""}>
          <b>${esc(c.name)}</b><span>${c.free} of ${c.logins} logins free</span>
        </button>`).join("")}</div></div>`;
    }).join("");
    const c = pick.course;
    const maxT = c ? Math.max(1, Math.min(40, c.free - 1)) : 40;
    pick.trainees = Math.min(pick.trainees, maxT);
    view.innerHTML = `
      <div class="card-top"><button class="back" type="button" data-go="#/instructor">${BACK_ICON}Back to classes</button></div>
      <header class="dash-head"><div><h1>Start a class</h1><p>You take the first free login. Trainees get the next ones.</p></div></header>
      ${c ? `
      <section class="panel picked" data-group="${esc(c.profession)}">
        <div><span class="k">1. Course</span><b>${esc(c.name)}</b><span class="free">${c.free} of ${c.logins} logins free</span></div>
        <button class="btn secondary nav-btn" type="button" data-change>Change course</button>
      </section>` : `
      <section class="panel">
        <h2>1. Course</h2>
        <p>Pick the course you’re running today.</p>
        ${groups}
      </section>`}
      <section class="panel" id="details" ${c ? "" : 'style="opacity:.5"'}>
        <h2>2. Class details</h2>
        <p>${c ? "Check these, then start the class." : "Pick a course first."}</p>
        ${c && c.facilities.length > 1 ? `<div class="field"><label>Facility</label><div class="chips">${c.facilities.map((f) => `<button class="chip" type="button" data-facility="${esc(f)}" aria-pressed="${pick.facility === f}">${esc(f)}</button>`).join("")}</div></div>` : ""}
        <div class="field">
          <label for="site">Site or room</label>
          <input class="input" id="site" maxlength="60" value="${esc(pick.site)}" placeholder="e.g. RBWH Training Room 3" ${c ? "" : "disabled"}>
          <span class="hint">Shown to other instructors so classes at different sites are easy to tell apart.</span>
        </div>
        <div class="field">
          <label id="t-label">Trainees booked in</label>
          <div class="stepper" role="group" aria-labelledby="t-label">
            <button type="button" data-step="-1" aria-label="One fewer" ${!c || pick.trainees <= 1 ? "disabled" : ""}>−</button>
            <output id="t-count" aria-live="polite">${pick.trainees}</output>
            <button type="button" data-step="1" aria-label="One more" ${!c || pick.trainees >= maxT ? "disabled" : ""}>+</button>
          </div>
          <span class="hint">Plus you, so ${pick.trainees + 1} logins. You can add walk-ins later.</span>
        </div>
        <p class="form-error" id="start-error" role="alert"></p>
        <div class="form-actions"><button class="btn primary" type="button" id="start" ${c && (c.facilities.length < 2 || pick.facility) ? "" : "disabled"}>Start class</button></div>
      </section>
      <div style="height:64px"></div>`;
    if (focus === "details") requestAnimationFrame(() => {
      $("#details").scrollIntoView({ block: "start" });
      ($("[data-facility]") || $("#site")).focus({ preventScroll: true });
    });
    if (focus === "top") window.scrollTo({ top: 0 });
  };
  draw();
  view.onclick = async (e) => {
    const cb = e.target.closest("[data-course]");
    if (cb) { pick.course = ov.courses.find((c) => c.id === cb.dataset.course); pick.facility = ""; draw("details"); return; }
    if (e.target.closest("[data-change]")) { pick.site = $("#site").value; pick.course = null; draw("top"); return; }
    const fb = e.target.closest("[data-facility]");
    if (fb) { pick.facility = fb.dataset.facility; pick.site = $("#site").value; draw(); return; }
    const sb = e.target.closest("[data-step]");
    if (sb) { pick.site = $("#site").value; pick.trainees = Math.max(1, pick.trainees + +sb.dataset.step); draw(); return; }
    if (e.target.closest("#start")) {
      const btn = $("#start"); btn.disabled = true;
      pick.site = $("#site").value.trim();
      store.set("tc-site", pick.site || null);
      const r = await staffApi("tc_start_class", { p_course: pick.course.id, p_facility: pick.facility, p_site: pick.site, p_trainees: pick.trainees });
      if (!r.ok) { $("#start-error").textContent = r.error; btn.disabled = false; return; }
      view.onclick = null;
      if (r.short > 0) showToast(`Only ${pick.trainees - r.short} logins were free. Add places later if more free up.`);
      go(`#/class/${r.id}`);
    }
  };
}

/* ---------------- Instructor: class console ---------------- */
async function showClass(id) {
  if (!staff.token) return go("#/instructor");
  setChrome({ signout: true });
  view.onclick = null;
  let data = null;
  const draw = () => {
    const c = data.class;
    const joined = data.roster.filter((r) => r.kind === "trainee" && r.joined).length;
    const places = data.roster.filter((r) => r.kind === "trainee").length;
    $("main").dataset.group = data.course.profession;
    const partSeg = c.parts.length ? `<h3>Part</h3><div class="big-seg" role="group" aria-label="Part">${c.parts.map((p) =>
      `<button type="button" data-part="${esc(p)}" aria-pressed="${p === c.part}">${esc(p)}</button>`).join("")}</div>` : "";
    view.innerHTML = `
      <div class="card-top"><button class="back" type="button" data-go="#/instructor">${BACK_ICON}All classes</button></div>
      <header class="dash-head">
        <div><h1>${esc(data.course.name)}</h1><p>${esc([c.site, c.facility].filter(Boolean).join(", ") || "No site given")}. Started ${time(c.createdAt)}. Ends by itself at midnight.</p></div>
        <button class="btn danger-btn" type="button" id="end">End class</button>
      </header>
      <div class="console">
        <div>
          <section class="panel code-panel">
            <h2>Class code</h2>
            <div class="big-code" aria-label="Class code ${esc(c.code.split("").join(" "))}">${esc(c.code)}</div>
            <p>Trainees open the Training Card, enter this code, and get their login. ${joined} of ${places} PCs have joined.</p>
          </section>
          <section class="panel">
            <div class="roster-head"><h2>Logins</h2><button class="btn secondary nav-btn" type="button" id="add">Add a place</button></div>
            <table class="live-table">
              <thead><tr><th>Login</th><th>Who</th><th></th></tr></thead>
              <tbody>${data.roster.map((r) => `
                <tr>
                  <td class="num"><b>${esc(r.login)}</b></td>
                  <td>${r.kind === "instructor" ? '<span class="status">You (instructor)</span>'
                    : r.joined ? `<span class="status joined">PC joined ${time(r.joinedAt)}</span>` : '<span class="status waiting">Waiting for a PC</span>'}</td>
                  <td class="n">${r.kind === "trainee" ? `<div class="row-actions">
                    ${r.joined ? `<button class="text-btn" type="button" data-reset="${r.id}">Free this PC</button>` : ""}
                    <button class="text-btn" type="button" data-remove="${r.id}" data-login="${esc(r.login)}">Remove</button></div>` : ""}</td>
                </tr>`).join("")}</tbody>
            </table>
            <p class="note" style="font-size:13px;color:var(--text-2);margin:12px 0 0">${data.free} more ${data.free === 1 ? "login is" : "logins are"} free for this course across all sites.</p>
          </section>
        </div>
        <section class="panel controls">
          ${partSeg}
          <h3>Trainees see</h3>
          <div class="big-seg" role="group" aria-label="Patients">
            <button type="button" data-mode="instructor" aria-pressed="${c.mode === "instructor"}">Instructor led</button>
            <button type="button" data-mode="proficiency" aria-pressed="${c.mode === "proficiency"}">Proficiency</button>
          </div>
          <p class="note">Every trainee screen switches within a few seconds.${c.hasProficiency ? "" : " This part has no proficiency patients."}</p>
        </section>
      </div>
      ${data.card && data.card.ok ? `<section class="instructor-card"><h2>Your login and patients</h2>
        <section class="card-head"><div><h1 class="num">${esc(data.card.login.login)}</h1></div>
        <div class="creds">${cred("Login", data.card.login.login)}${cred("Password", data.card.login.password)}</div></section>
        ${patientsBlock(data.card)}${othersBlock(data.card)}</section>` : ""}
      <div style="height:64px"></div>`;
  };
  const load = async () => {
    const r = await staffApi("tc_class", { p_class: id });
    if (!r.ok) {
      stopListening();
      view.innerHTML = `<section class="panel" style="margin:48px 0;max-width:640px"><h2>This class has ended</h2><p>Its logins are free again.</p>
        <div class="form-actions"><button class="btn primary" type="button" data-go="#/instructor">Back to classes</button></div></section>`;
      return null;
    }
    data = r; draw(); return r;
  };
  const r = await load();
  if (!r) return;
  listen(r.class.channel, () => load(), 10000);
  current.refresh = load;

  view.onclick = async (e) => {
    const act = async (fn, args) => {
      const res = await staffApi(fn, { p_class: id, ...args });
      if (!res.ok) { showToast(res.error); return; }
      if (res.class) { data = res; draw(); }
    };
    const mb = e.target.closest("[data-mode]");
    if (mb && mb.getAttribute("aria-pressed") !== "true") return act("tc_set_stage", { p_part: data.class.part, p_mode: mb.dataset.mode });
    const pb = e.target.closest("[data-part]");
    if (pb && pb.getAttribute("aria-pressed") !== "true") return act("tc_set_stage", { p_part: pb.dataset.part, p_mode: "instructor" });
    if (e.target.closest("#add")) return act("tc_add_places", { p_n: 1 });
    const rb = e.target.closest("[data-reset]");
    if (rb) {
      if (!(await confirmBox("Free this PC?", "The login stays in your class. The next PC to enter the code takes it.", "Free PC"))) return;
      const res = await staffApi("tc_reset_place", { p_alloc: +rb.dataset.reset });
      if (res.ok) { data = res; draw(); } else showToast(res.error);
      return;
    }
    const xb = e.target.closest("[data-remove]");
    if (xb) {
      if (!(await confirmBox(`Remove ${xb.dataset.login}?`, "The login goes back to the pool for other classes. A PC using it loses its card.", "Remove"))) return;
      const res = await staffApi("tc_remove_place", { p_alloc: +xb.dataset.remove });
      if (res.ok) { data = res; draw(); } else showToast(res.error);
      return;
    }
    if (e.target.closest("#end")) {
      if (!(await confirmBox("End this class?", "Every trainee card closes and all logins go back to the pool.", "End class"))) return;
      await staffApi("tc_end_class", { p_class: id });
      stopListening();
      view.onclick = null;
      go("#/instructor");
    }
  };
}

/* ---------------- Admin ---------------- */
async function showAdmin() {
  view.onclick = null;
  if (!staff.token || staff.role !== "admin") {
    setChrome();
    staff.clear();
    await signinForm("admin");
  }
  setChrome({ signout: true });
  let pending = null;
  view.innerHTML = `
    <header class="dash-head"><div><h1>Update data</h1><p>For training coordinators. Changes apply to every site.</p></div></header>
    <section class="step"><div class="n">1</div><div>
      <h2>Download the spreadsheet</h2>
      <p>Everything in the database as an Excel file. Always start from this file so nothing gets lost.</p>
      <div class="actions"><button class="btn primary" type="button" id="export">Download current data</button></div>
    </div></section>
    <section class="step"><div class="n">2</div><div>
      <h2>Make your changes in Excel</h2>
      <ul>
        <li>Each course has its own tab. <b>One row = one login.</b></li>
        <li>Each patient has a <b>Mode</b> (Instructor led, Proficiency or Always) and an optional <b>Part</b> (e.g. Part A).</li>
        <li>The <b>Read me</b> tab explains every column. Don’t rename the headings in row 1.</li>
      </ul>
    </div></section>
    <section class="step"><div class="n">3</div><div>
      <h2>Load and check it</h2>
      <p>Nothing changes until you upload in step 4.</p>
      <label class="drop" id="drop"><input type="file" id="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><b>Choose your spreadsheet</b><span>or drag it here</span></label>
      <div id="report"></div>
    </div></section>
    <section class="step locked" id="step4"><div class="n">4</div><div>
      <h2>Upload to the database</h2>
      <p>Every live class must be ended first, so no trainee loses their login mid-class.</p>
      <div class="actions"><button class="btn primary" type="button" id="upload" disabled>Upload</button></div>
      <p class="form-error" id="upload-msg" role="status"></p>
    </div></section>
    <section class="panel" style="margin-top:16px">
      <h2>Passwords</h2>
      <p>At least 10 characters. Changing a password signs everyone using it out.</p>
      <form id="pw-form" class="form-actions" style="margin-top:0">
        <select class="input" id="pw-role" aria-label="Which password"><option value="instructor">Instructor password</option><option value="admin">Admin password</option></select>
        <input class="input" id="pw-new" type="password" autocomplete="new-password" placeholder="New password" aria-label="New password" minlength="10" required>
        <button class="btn secondary" type="submit">Change password</button>
      </form>
      <p class="form-error" id="pw-msg" role="status"></p>
    </section>
    <div style="height:64px"></div>`;

  $("#export").addEventListener("click", async () => {
    const r = await staffApi("tc_admin_export", {});
    if (!r.ok) return showToast(r.error);
    download(await window.TC.writeXlsx(window.TC.toWorkbook(r.data)), "Training-Card-Data.xlsx");
  });
  const load = async (file) => {
    pending = null;
    $("#step4").classList.add("locked"); $("#upload").disabled = true;
    if (!file) return;
    const report = $("#report");
    try {
      const res = window.TC.fromWorkbook(await window.TC.readXlsx(await file.arrayBuffer()));
      const errors = res.issues.filter((i) => i.level === "error");
      const list = (xs) => `<div class="issues">${xs.slice(0, 60).map((i) => `<div class="issue ${i.level}"><span class="lvl">${i.level === "error" ? "Problem" : i.level === "warning" ? "Check" : "Note"}</span><span class="where">${esc(i.where)}</span><span class="msg">${esc(i.message)}</span></div>`).join("")}</div>`;
      if (errors.length) {
        report.innerHTML = `<div class="verdict bad"><div><b>${errors.length} problem${errors.length > 1 ? "s" : ""} to fix first</b><span>Fix ${errors.length > 1 ? "these" : "this"} in Excel, save, then load the file again.</span></div></div>${list(errors)}`;
        return;
      }
      pending = res.data;
      const s = res.stats;
      const checks = res.issues.filter((i) => i.level === "warning");
      report.innerHTML = `<div class="verdict ok"><div><b>Ready to upload</b><span>${s.courses} courses, ${s.logins.toLocaleString("en-AU")} logins and ${s.patients.toLocaleString("en-AU")} patients.</span></div></div>${checks.length ? `<div class="sub-h">Worth checking</div>${list(checks)}` : ""}`;
      $("#step4").classList.remove("locked"); $("#upload").disabled = false;
    } catch (err) {
      report.innerHTML = `<div class="verdict bad"><div><b>Couldn’t read this file</b><span>${esc(err.message)}</span></div></div>`;
    }
  };
  $("#file").addEventListener("change", (e) => load(e.target.files[0]));
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); load(e.dataTransfer.files[0]); });
  $("#upload").addEventListener("click", async () => {
    if (!pending) return;
    if (!(await confirmBox("Upload to the database?", "This replaces every course, login and patient for all sites.", "Upload"))) return;
    $("#upload").disabled = true;
    const r = await staffApi("tc_admin_import", { p_data: pending });
    $("#upload-msg").textContent = r.ok ? `Uploaded ${r.courses} courses, ${r.logins} logins and ${r.patients} patients.` : r.error;
    $("#upload-msg").style.color = r.ok ? "var(--success-ink)" : "";
    $("#upload").disabled = !!r.ok;
  });
  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await staffApi("tc_set_password", { p_role: $("#pw-role").value, p_new: $("#pw-new").value });
    $("#pw-msg").textContent = r.ok ? "Password changed." : r.error;
    $("#pw-msg").style.color = r.ok ? "var(--success-ink)" : "";
    if (r.ok) $("#pw-new").value = "";
  });
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- Dialogs, copy, barcodes ---------------- */
const confirmDlg = $("#confirm");
function confirmBox(title, text, yes) {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-yes").textContent = yes;
  confirmDlg.showModal();
  return new Promise((resolve) => {
    const done = (v) => { confirmDlg.close(); confirmDlg.removeEventListener("click", onClick); resolve(v); };
    const onClick = (e) => {
      if (e.target === confirmDlg) return done(false);
      const b = e.target.closest("[data-confirm]"); if (b) done(b.dataset.confirm === "yes");
    };
    confirmDlg.addEventListener("click", onClick);
    confirmDlg.addEventListener("cancel", () => resolve(false), { once: true });
  });
}

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
      const url = accessUrl || window.TC.DEFAULT_ACCESS_URL;
      $("#access-link").href = url;
      window.open(url, "_blank", "noopener");
    }
    dlg.querySelectorAll("[data-step]").forEach((s) => (s.hidden = s.dataset.step !== a.dataset.answer));
  }
  if (e.target.closest("[data-close]")) dlg.close();
});

const toast = $("#toast");
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
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
    b.classList.add("done"); b.innerHTML = TICK_ICON; b.setAttribute("aria-label", "Copied");
    setTimeout(() => { b.classList.remove("done"); b.innerHTML = COPY_ICON; b.setAttribute("aria-label", b.dataset.label); }, 1400);
  }
});

let overlay = null;
function openOverlay(code, who, art) {
  closeOverlay();
  overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Barcode");
  overlay.innerHTML = `<div class="big">${art || aztecSVG(code)}</div><div class="code num">${esc(code)}</div><div class="who">${esc(who)}</div><div class="close-hint">Click anywhere or press Esc to close</div>`;
  overlay.addEventListener("click", closeOverlay);
  document.body.appendChild(overlay);
}
function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
document.addEventListener("click", (e) => {
  const b = e.target.closest(".barcode"); if (b) openOverlay(b.dataset.code, b.dataset.who);
  if (e.target.closest("[data-bloodbag]")) openOverlay(BLOOD_BAG.number, "Blood bag", `<img src="${BLOOD_BAG.src}" alt="">`);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay) closeOverlay(); });

route();
