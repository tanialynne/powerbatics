// Powerbatics PWA — single-file app.
// Routes: #/, #/day/<i>, #/day/<i>/ex/<j>, #/day/<i>/summary, #/settings

import { parseProgramHtml } from "./parser.mjs";

const app = document.getElementById("app");
let program = null;

const DEFAULT_PROGRAM_URL =
  "https://custom.pacificrimathletics.com/tania-griffith-new-custom-program-2/";

// ---------- small utils ----------
const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const iso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayStr = () => iso(new Date());
const fmtDate = (s) =>
  new Date(s + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const fmtClock = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Parse "2 minute hold", "90 second hold", "30 sec hold", "hold for 2 min" → seconds
function parseHoldSeconds(goal) {
  if (!goal) return null;
  const g = goal.toLowerCase();
  let m;
  if ((m = g.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\s*hold/))) {
    return Math.round(parseFloat(m[1]) * 60);
  }
  if ((m = g.match(/(\d+)\s*(?:seconds?|secs?)\s*hold/))) {
    return parseInt(m[1], 10);
  }
  if ((m = g.match(/hold\s*(?:for)?\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|seconds?|secs?)/))) {
    const v = parseFloat(m[1]);
    return /min/.test(m[2]) ? Math.round(v * 60) : Math.round(v);
  }
  return null;
}

// ---------- storage ----------
const LS_LOGS = "pb.logs.v1";
const LS_DRAFT = "pb.draft.v1";
const LS_SETTINGS = "pb.settings.v1";
const LS_PROGRAM = "pb.program.v1";
const LS_PROGRAM_URL = "pb.programUrl.v1";
const LS_LAST_REFRESH = "pb.lastRefresh.v1";
const LS_WORKOUT = "pb.workout.v1";

const loadLogs = () => {
  try { return JSON.parse(localStorage.getItem(LS_LOGS) || "{}"); }
  catch { return {}; }
};
const saveLogs = (l) => localStorage.setItem(LS_LOGS, JSON.stringify(l));

const exKey = (dayName, exName) => `${slug(dayName)}::${slug(exName)}`;

const loadDraft = (k) => {
  try { return JSON.parse(localStorage.getItem(`${LS_DRAFT}.${k}`) || "null"); }
  catch { return null; }
};
const saveDraft = (k, v) =>
  localStorage.setItem(`${LS_DRAFT}.${k}`, JSON.stringify(v));
const clearDraft = (k) => localStorage.removeItem(`${LS_DRAFT}.${k}`);

const defaultSettings = { coachPhone: "", defaultRestSec: 90, restEnabled: true, weeklyGoal: 3 };
const loadSettings = () => {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}") };
  } catch { return { ...defaultSettings }; }
};
const saveSettings = (s) => localStorage.setItem(LS_SETTINGS, JSON.stringify(s));

const getLastLog = (key) => {
  const arr = loadLogs()[key];
  return arr && arr.length ? arr[arr.length - 1] : null;
};
const lastDoneDate = (key) => getLastLog(key)?.date || null;
const doneToday = (key) => lastDoneDate(key) === todayStr();

// Dates with real training logs (warm-ups don't count toward streak/calendar).
function getLoggedDates() {
  const s = new Set();
  const logs = loadLogs();
  for (const k of Object.keys(logs)) for (const e of logs[k]) {
    if (!e.warmup) s.add(e.date);
  }
  return s;
}

const isWarmUpDay = (day) => /warm\s*up/i.test(day?.name || "");
const isHoldExercise = (ex) => parseHoldSeconds(ex?.goal) != null;

// Display a set value — for holds, seconds display as mm:ss when numeric.
function formatSetValue(set, isHold) {
  const v = set?.reps ?? "";
  if (!v && v !== 0) return "—";
  if (isHold) {
    const n = parseFloat(String(v));
    if (!isNaN(n) && !/:/.test(String(v))) return fmtClock(n);
    return String(v);
  }
  return String(v);
}

// ---------- weekly streak ----------
// Week = Monday-Sunday (local). A "successful" week = training days >= goal.
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, …
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function weekKey(date) { return iso(mondayOf(date)); }

function countsByWeek() {
  const m = new Map();
  for (const d of getLoggedDates()) {
    const k = weekKey(new Date(d + "T00:00:00"));
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function currentWeekCount() {
  return countsByWeek().get(weekKey(new Date())) || 0;
}
function weeklyStreak(goal) {
  if (!goal || goal < 1) return 0;
  const by = countsByWeek();
  let d = mondayOf(new Date());
  // If this week hasn't hit goal yet, start counting from last week.
  if ((by.get(iso(d)) || 0) < goal) d.setDate(d.getDate() - 7);
  let n = 0;
  while ((by.get(iso(d)) || 0) >= goal) {
    n++;
    d.setDate(d.getDate() - 7);
  }
  return n;
}

// ---------- workout timer ----------
// Keyed by date::dayIdx, so each training day has its own timer that resets
// at midnight. State: { accumMs, runningSince } — elapsed = accumMs + (running ? now - runningSince : 0).
const workoutKey = (dayIdx, date = todayStr()) => `${date}::${dayIdx}`;
function loadWorkoutState(dayIdx, date) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_WORKOUT) || "{}");
    return all[workoutKey(dayIdx, date)] || null;
  } catch { return null; }
}
function saveWorkoutState(dayIdx, state, date) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_WORKOUT) || "{}");
    if (state) all[workoutKey(dayIdx, date)] = state;
    else delete all[workoutKey(dayIdx, date)];
    localStorage.setItem(LS_WORKOUT, JSON.stringify(all));
  } catch {}
}
function workoutElapsedMs(state) {
  if (!state) return 0;
  return state.accumMs + (state.runningSince ? Date.now() - state.runningSince : 0);
}
function startWorkout(dayIdx) {
  const cur = loadWorkoutState(dayIdx);
  if (cur?.runningSince) return cur;
  const next = { accumMs: cur?.accumMs || 0, runningSince: Date.now() };
  saveWorkoutState(dayIdx, next);
  return next;
}
function pauseWorkout(dayIdx) {
  const cur = loadWorkoutState(dayIdx);
  if (!cur?.runningSince) return cur;
  const next = { accumMs: workoutElapsedMs(cur), runningSince: null };
  saveWorkoutState(dayIdx, next);
  return next;
}
function stopWorkout(dayIdx, date) {
  const cur = loadWorkoutState(dayIdx, date);
  if (!cur) return 0;
  const final = cur.runningSince
    ? workoutElapsedMs(cur)
    : cur.accumMs;
  saveWorkoutState(dayIdx, { accumMs: final, runningSince: null }, date);
  return final;
}
function formatDurationMs(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// PR detection: is current reps higher than every prior session's best-reps-in-a-set?
function priorBestReps(key) {
  const arr = loadLogs()[key] || [];
  let best = 0;
  for (const e of arr.slice(0, -1)) {
    for (const s of e.sets) {
      const r = parseFloat(s.reps);
      if (!isNaN(r) && r > best) best = r;
    }
  }
  return best;
}

// ---------- routing ----------
const parseHash = () => {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h) return { view: "home" };
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "settings") return { view: "settings" };
  if (parts[0] === "past") return { view: "past" };
  if (parts[0] === "day" && parts[1] != null) {
    const dayIdx = parseInt(parts[1], 10);
    if (parts[2] === "ex" && parts[3] != null)
      return { view: "exercise", dayIdx, exIdx: parseInt(parts[3], 10) };
    if (parts[2] === "summary") return { view: "summary", dayIdx, date: parts[3] || null };
    return { view: "day", dayIdx };
  }
  return { view: "home" };
};
const go = (hash) => { location.hash = hash; };
window.addEventListener("hashchange", render);
window.addEventListener("popstate", render);

// ---------- wake lock ----------
let wakeLock = null;
async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch {}
}
async function releaseWakeLock() {
  try { if (wakeLock) await wakeLock.release(); } catch {}
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  const v = parseHash().view;
  if (document.visibilityState === "visible" && (v === "exercise" || v === "summary")) {
    acquireWakeLock();
  }
});

// ---------- install ("Download") ----------
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (program) render();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (program) render();
});
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function showIOSInstallSheet() {
  const sheet = el(`
    <div class="sheet-backdrop">
      <div class="sheet">
        <h3 style="margin-bottom:12px">Install Powerbatics</h3>
        <ol style="margin:0 0 16px 18px;padding:0;line-height:1.6">
          <li>Tap the <strong>Share</strong> button at the bottom of Safari.</li>
          <li>Scroll and pick <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. Open Powerbatics from your home screen.</li>
        </ol>
        <p class="muted" style="font-size:13px;margin-bottom:14px">
          Only Safari can install apps on iPhone/iPad — not Chrome or other browsers.
        </p>
        <button class="btn primary" style="width:100%">Got it</button>
      </div>
    </div>
  `);
  sheet.querySelector("button").addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}
function buildInstallButton() {
  if (isStandalone()) return null;
  const btn = el(`<button class="install-btn" aria-label="Install app">⤓ Install</button>`);
  btn.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch {}
      deferredInstallPrompt = null;
      render();
      return;
    }
    showIOSInstallSheet();
  });
  return btn;
}

// ---------- program refresh (pull from coach's WP page via proxy) ----------
const loadStoredProgram = () => {
  try { return JSON.parse(localStorage.getItem(LS_PROGRAM) || "null"); }
  catch { return null; }
};
const getProgramUrl = () =>
  localStorage.getItem(LS_PROGRAM_URL) || DEFAULT_PROGRAM_URL;

function diffPrograms(a, b) {
  const keysOf = (p) => {
    const s = new Set();
    for (const d of p?.days || []) for (const e of d.exercises) s.add(`${d.name}::${e.name}`);
    return s;
  };
  const aK = keysOf(a);
  const bK = keysOf(b);
  const added = [...bK].filter((k) => !aK.has(k));
  const removed = [...aK].filter((k) => !bK.has(k));
  // Compare video IDs for same key
  const videoChanged = [];
  const mapOf = (p) => {
    const m = new Map();
    for (const d of p?.days || []) for (const e of d.exercises) m.set(`${d.name}::${e.name}`, e.videoId);
    return m;
  };
  const aV = mapOf(a);
  const bV = mapOf(b);
  for (const [k, v] of bV) if (aV.has(k) && aV.get(k) !== v) videoChanged.push(k);
  return { added, removed, videoChanged };
}

async function refreshFromCoachPage() {
  const url = getProgramUrl();
  const proxy = `/api/coach-page?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxy, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Proxy returned ${res.status} ${res.statusText}${body ? " — " + body.slice(0, 120) : ""}`);
  }
  const html = await res.text();
  const next = parseProgramHtml(html);
  const exerciseCount = next.days.reduce((n, d) => n + d.exercises.length, 0);
  if (!next.days.length || exerciseCount === 0) {
    throw new Error("Parser returned no exercises — page structure may have changed.");
  }
  const changes = diffPrograms(program, next);
  localStorage.setItem(LS_PROGRAM, JSON.stringify(next));
  localStorage.setItem(LS_LAST_REFRESH, new Date().toISOString());
  program = next;
  return { changes, exerciseCount };
}

// ---------- WhatsApp helpers ----------
function whatsappHref(text) {
  const { coachPhone } = loadSettings();
  const phone = (coachPhone || "").replace(/[^0-9]/g, "");
  const base = phone ? `https://wa.me/${phone}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(text)}`;
}

// ---------- render entrypoint ----------
function render() {
  if (!program) return;
  const route = parseHash();
  app.innerHTML = "";
  if (route.view === "exercise" || route.view === "summary") acquireWakeLock();
  else releaseWakeLock();
  if (route.view === "home") return renderHome();
  if (route.view === "settings") return renderSettings();
  if (route.view === "past") return renderPast();
  if (route.view === "day") return renderDay(route.dayIdx);
  if (route.view === "exercise") return renderExercise(route.dayIdx, route.exIdx);
  if (route.view === "summary") return renderSummary(route.dayIdx, route.date);
}

// ---------- HOME ----------
function renderHome() {
  const wrap = el(`<div></div>`);
  const settings = loadSettings();
  const goal = settings.weeklyGoal || 3;
  const wkCount = currentWeekCount();
  const wkStreak = weeklyStreak(goal);
  const subParts = [];
  if (wkStreak > 0) subParts.push(`🔥 ${wkStreak}-week streak`);
  subParts.push(`${wkCount}/${goal} this week`);
  const top = el(`
    <div class="topbar">
      <div class="title-stack">
        <h1>${escapeHtml(program.title || "Powerbatics")}</h1>
        <div class="sub">${subParts.join(" · ")}</div>
      </div>
    </div>
  `);
  // Right-side buttons
  const installBtn = buildInstallButton();
  if (installBtn) top.appendChild(installBtn);
  const gear = el(`<button class="gear-btn" aria-label="Settings">⚙︎</button>`);
  gear.addEventListener("click", () => go("#/settings"));
  top.appendChild(gear);
  wrap.appendChild(top);

  wrap.appendChild(renderCalendarStrip());

  const list = el(`<div class="list"></div>`);
  program.days.forEach((day, i) => {
    const total = day.exercises.length;
    const doneCount = day.exercises.filter((e) =>
      doneToday(exKey(day.name, e.name)),
    ).length;
    const meta =
      doneCount === total && total > 0
        ? "All done today ✓"
        : `${total} exercise${total === 1 ? "" : "s"}${doneCount ? ` · ${doneCount} done today` : ""}`;
    const card = el(`
      <button class="card ${doneCount === total && total > 0 ? "done" : ""}">
        <div class="row">
          <div><div class="name">${escapeHtml(day.name)}</div>
            <div class="meta">${escapeHtml(meta)}</div></div>
          <span class="chev">›</span>
        </div>
      </button>
    `);
    card.addEventListener("click", () => go(`#/day/${i}`));
    list.appendChild(card);
  });
  wrap.appendChild(list);

  const pastBtn = el(
    `<button class="card" style="margin-top:14px"><div class="row"><div><div class="name">Past workouts</div><div class="meta">History of completed days</div></div><span class="chev">›</span></div></button>`,
  );
  pastBtn.addEventListener("click", () => go("#/past"));
  wrap.appendChild(pastBtn);

  if (program.intro) {
    wrap.appendChild(
      el(`<div class="tip" style="margin-top:18px">${escapeHtml(program.intro)}</div>`),
    );
  }
  app.appendChild(wrap);
}

// ---------- PAST WORKOUTS ----------
function getCompletedWorkouts() {
  const logs = loadLogs();
  // { "date::dayIdx": count }
  const byDayDate = new Map();
  program.days.forEach((day, dayIdx) => {
    if (isWarmUpDay(day)) return;
    for (const ex of day.exercises) {
      const key = exKey(day.name, ex.name);
      for (const entry of logs[key] || []) {
        if (entry.warmup) continue;
        const k = `${entry.date}::${dayIdx}`;
        byDayDate.set(k, (byDayDate.get(k) || 0) + 1);
      }
    }
  });
  const out = [];
  for (const [k, count] of byDayDate) {
    const [date, dayIdxStr] = k.split("::");
    const dayIdx = parseInt(dayIdxStr, 10);
    const day = program.days[dayIdx];
    if (!day || count < day.exercises.length) continue;
    const state = loadWorkoutState(dayIdx, date);
    out.push({ date, dayIdx, dayName: day.name, durationMs: state ? state.accumMs : 0 });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

function renderPast() {
  const wrap = el(`<div></div>`);
  const top = el(`
    <div class="topbar">
      <button class="back" aria-label="Back">‹</button>
      <div class="title-stack"><h1>Past workouts</h1></div>
    </div>
  `);
  top.querySelector(".back").addEventListener("click", () => go("#/"));
  wrap.appendChild(top);

  const completed = getCompletedWorkouts();
  if (!completed.length) {
    wrap.appendChild(el(`<div class="tip">No completed workouts yet. Finish a day's exercises and it'll show up here.</div>`));
  } else {
    const list = el(`<div class="list"></div>`);
    for (const w of completed) {
      const dur = w.durationMs ? ` · ${formatDurationMs(w.durationMs)}` : "";
      const card = el(`
        <button class="card">
          <div class="row">
            <div><div class="name">${escapeHtml(w.dayName)}</div>
              <div class="meta">${fmtDate(w.date)}${dur}</div></div>
            <span class="chev">›</span>
          </div>
        </button>
      `);
      card.addEventListener("click", () => go(`#/day/${w.dayIdx}/summary/${w.date}`));
      list.appendChild(card);
    }
    wrap.appendChild(list);
  }
  app.appendChild(wrap);
}

function renderCalendarStrip(weeks = 4) {
  const dates = getLoggedDates();
  const wrap = el(`<div class="cal-wrap"></div>`);
  // DOW header (Mon-Sun)
  const dowNames = ["M", "T", "W", "T", "F", "S", "S"];
  const header = el(`<div class="cal-dow"></div>`);
  for (const n of dowNames) header.appendChild(el(`<div>${n}</div>`));
  wrap.appendChild(header);

  const grid = el(`<div class="cal-grid"></div>`);
  const today = new Date(); today.setHours(0,0,0,0);
  const thisMon = mondayOf(today);
  // Render `weeks` rows ending with current week at the bottom.
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = new Date(thisMon);
    weekStart.setDate(thisMon.getDate() - w * 7);
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const inFuture = d > today;
      const did = dates.has(iso(d));
      const isToday = iso(d) === iso(today);
      grid.appendChild(
        el(`
          <div class="cal-day ${did ? "done" : ""} ${isToday ? "today" : ""} ${inFuture ? "future" : ""}">
            <div class="num">${d.getDate()}</div>
          </div>
        `),
      );
    }
  }
  wrap.appendChild(grid);

  // Toggle between 4 weeks and 12 weeks
  const toggle = el(
    `<button class="cal-more">${weeks <= 4 ? "See more ↓" : "Show less ↑"}</button>`,
  );
  toggle.addEventListener("click", () => {
    const next = weeks <= 4 ? 12 : 4;
    const newStrip = renderCalendarStrip(next);
    wrap.replaceWith(newStrip);
  });
  wrap.appendChild(toggle);
  return wrap;
}

// ---------- SETTINGS ----------
function renderSettings() {
  const s = loadSettings();
  const wrap = el(`<div></div>`);
  const top = el(`
    <div class="topbar">
      <button class="back" aria-label="Back">‹</button>
      <div class="title-stack"><h1>Settings</h1></div>
    </div>
  `);
  top.querySelector(".back").addEventListener("click", () => go("#/"));
  wrap.appendChild(top);

  const lastRefresh = localStorage.getItem(LS_LAST_REFRESH);
  const form = el(`
    <div class="list">
      <div class="settings-row">
        <label>Program source URL</label>
        <input type="url" inputmode="url" placeholder="https://custom.pacificrimathletics.com/..."
               value="${escapeHtml(getProgramUrl())}" id="program-url" />
        <div class="hint">Your coach's public custom-program page. Tap Refresh below to pull the latest exercises &amp; videos.</div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn primary" id="refresh-program" style="flex:1">⟳ Refresh from coach's page</button>
        </div>
        <div class="hint" id="refresh-status">
          ${lastRefresh ? `Last refreshed ${fmtDate(lastRefresh.slice(0, 10))}` : "Never refreshed — using bundled program."}
        </div>
      </div>

      <div class="settings-row">
        <label>Coach's WhatsApp number</label>
        <input type="tel" inputmode="tel" placeholder="+1 778 555 0100"
               value="${escapeHtml(s.coachPhone)}" id="coach-phone" />
        <div class="hint">Used by "Send to coach" buttons. Include country code. Leave blank to pick contact each time.</div>
      </div>
      <div class="settings-row">
        <label>Default rest timer (seconds)</label>
        <input type="number" inputmode="numeric" min="0" max="600" value="${s.defaultRestSec}" id="rest-sec" />
      </div>
      <div class="settings-row">
        <label>Weekly training days goal</label>
        <input type="number" inputmode="numeric" min="1" max="7" value="${s.weeklyGoal}" id="weekly-goal" />
        <div class="hint">Streak counts weeks where you hit this many training days (warm-up doesn't count).</div>
      </div>
      <div class="settings-row">
        <label class="switch">
          <input type="checkbox" id="rest-on" ${s.restEnabled ? "checked" : ""} />
          <span>Auto-start rest timer after each set</span>
        </label>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="save-settings">Save</button>
      </div>

      <div class="settings-row" style="margin-top:20px">
        <label>Data</label>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn" id="export-logs">Export logs (JSON)</button>
          <button class="btn" id="import-logs">Import</button>
        </div>
        <div class="hint">Back up or move your history between devices.</div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn danger" id="clear-data" style="flex:1">Clear all data</button>
        </div>
        <div class="hint">Wipes logs, drafts, and settings from this device. Export first if you want a backup.</div>
      </div>
    </div>
  `);

  form.querySelector("#save-settings").addEventListener("click", () => {
    const next = {
      coachPhone: form.querySelector("#coach-phone").value.trim(),
      defaultRestSec: Math.max(0, parseInt(form.querySelector("#rest-sec").value, 10) || 0),
      restEnabled: form.querySelector("#rest-on").checked,
      weeklyGoal: Math.max(1, Math.min(7, parseInt(form.querySelector("#weekly-goal").value, 10) || 3)),
    };
    saveSettings(next);
    const urlField = form.querySelector("#program-url").value.trim();
    if (urlField) localStorage.setItem(LS_PROGRAM_URL, urlField);
    go("#/");
  });

  const refreshBtn = form.querySelector("#refresh-program");
  const refreshStatus = form.querySelector("#refresh-status");
  refreshBtn.addEventListener("click", async () => {
    // Save URL field first so refresh uses what's in the input
    const urlField = form.querySelector("#program-url").value.trim();
    if (urlField) localStorage.setItem(LS_PROGRAM_URL, urlField);

    refreshBtn.disabled = true;
    refreshBtn.textContent = "⟳ Checking…";
    refreshStatus.textContent = "Fetching your coach's page…";
    try {
      const { changes, exerciseCount } = await refreshFromCoachPage();
      const parts = [];
      if (changes.added.length) parts.push(`${changes.added.length} new`);
      if (changes.removed.length) parts.push(`${changes.removed.length} removed`);
      if (changes.videoChanged.length) parts.push(`${changes.videoChanged.length} video${changes.videoChanged.length > 1 ? "s" : ""} changed`);
      const summary =
        parts.length === 0
          ? `Up to date. ${exerciseCount} exercises.`
          : `Updated: ${parts.join(", ")}. ${exerciseCount} exercises total.`;
      refreshStatus.textContent = summary;
      refreshBtn.textContent = "⟳ Refresh from coach's page";
    } catch (e) {
      refreshStatus.textContent = `Couldn't refresh: ${e.message}`;
      refreshBtn.textContent = "⟳ Try again";
    } finally {
      refreshBtn.disabled = false;
    }
  });

  form.querySelector("#export-logs").addEventListener("click", () => {
    const data = JSON.stringify({ logs: loadLogs(), settings: loadSettings() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `powerbatics-backup-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  form.querySelector("#clear-data").addEventListener("click", () => {
    if (!confirm("Delete all logs, drafts, and settings on this device? This cannot be undone.")) return;
    if (!confirm("Really clear everything?")) return;
    // Remove every key we own — leave unrelated keys alone in case this app
    // ever shares storage with something else on the same origin.
    const prefixes = [LS_LOGS, LS_DRAFT, LS_SETTINGS, LS_WORKOUT, LS_PROGRAM, LS_PROGRAM_URL, LS_LAST_REFRESH, "pb.installHintDismissed"];
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (prefixes.some((p) => k === p || k.startsWith(p + "."))) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
    alert("Cleared.");
    go("#/");
  });

  form.querySelector("#import-logs").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "application/json";
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const obj = JSON.parse(await file.text());
        if (obj.logs) saveLogs(obj.logs);
        if (obj.settings) saveSettings(obj.settings);
        alert("Import complete.");
        render();
      } catch (e) {
        alert("Couldn't read that file: " + e.message);
      }
    });
    inp.click();
  });

  wrap.appendChild(form);
  app.appendChild(wrap);
}

// ---------- DAY ----------
function renderDay(dayIdx) {
  const day = program.days[dayIdx];
  if (!day) return go("#/");
  const wrap = el(`<div></div>`);
  const doneCount = day.exercises.filter((e) => doneToday(exKey(day.name, e.name))).length;
  const top = el(`
    <div class="topbar">
      <button class="back" aria-label="Back">‹</button>
      <div class="title-stack">
        <h1>${escapeHtml(day.name)}</h1>
        <div class="sub">${doneCount} / ${day.exercises.length} done today</div>
      </div>
    </div>
  `);
  top.querySelector(".back").addEventListener("click", () => go("#/"));
  wrap.appendChild(top);

  if (!isWarmUpDay(day)) wrap.appendChild(buildWorkoutTimer(dayIdx));

  const list = el(`<div class="list"></div>`);
  day.exercises.forEach((ex, i) => {
    const k = exKey(day.name, ex.name);
    const done = doneToday(k);
    const last = lastDoneDate(k);
    const meta = ex.goal
      ? `Goal: ${ex.goal}`
      : last
      ? `Last done ${fmtDate(last)}`
      : "Tap to start";
    const card = el(`
      <button class="card ${done ? "done" : ""}">
        <div class="row">
          <div style="flex:1;min-width:0">
            <div class="name">${escapeHtml(ex.name)}</div>
            <div class="meta">${escapeHtml(meta)}</div>
          </div>
          <span class="chev">›</span>
        </div>
      </button>
    `);
    card.addEventListener("click", () => go(`#/day/${dayIdx}/ex/${i}`));
    list.appendChild(card);
  });
  wrap.appendChild(list);

  if (
    !isWarmUpDay(day) &&
    doneCount === day.exercises.length &&
    day.exercises.length > 0
  ) {
    const sumBtn = el(
      `<button class="btn primary" style="margin-top:14px;height:52px">View today's summary →</button>`,
    );
    sumBtn.addEventListener("click", () => go(`#/day/${dayIdx}/summary`));
    wrap.appendChild(sumBtn);
  }
  app.appendChild(wrap);
}

// ---------- video helper ----------
// Fullscreen = CSS overlay that fills the viewport. Reliable on iOS Safari
// (where iframe Fullscreen API doesn't work) and everywhere else. Also
// tries the browser's real Fullscreen API opportunistically to hide chrome
// on Android/desktop, but the overlay alone is the source of truth.
function buildVideoEl(videoId) {
  const v = el(`
    <div class="video-wrap" id="video-wrap">
      <iframe
        src="https://player.vimeo.com/video/${videoId}?title=0&byline=0&portrait=0&playsinline=1&muted=1"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
      ></iframe>
      <button class="video-fs" aria-label="Fullscreen">⛶</button>
      <button class="video-fs-close" aria-label="Exit fullscreen">✕</button>
    </div>
  `);
  const fsBtn = v.querySelector(".video-fs");
  const closeBtn = v.querySelector(".video-fs-close");

  const enter = () => {
    v.classList.add("fs-mode");
    document.body.classList.add("fs-lock");
    try {
      if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
      else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
    } catch {}
  };
  const exit = () => {
    v.classList.remove("fs-mode");
    document.body.classList.remove("fs-lock");
    try {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch {}
  };
  fsBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enter(); });
  closeBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); exit(); });

  // Listen for native fullscreen exit (user hit ESC or swiped down) to sync UI
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && v.classList.contains("fs-mode")) exit();
  });
  return v;
}

// ---------- EXERCISE ----------
function renderExercise(dayIdx, exIdx) {
  const day = program.days[dayIdx];
  if (!day) return go("#/");
  const ex = day.exercises[exIdx];
  if (!ex) return go(`#/day/${dayIdx}`);

  if (isWarmUpDay(day)) return renderWarmUpExercise(dayIdx, exIdx, day, ex);

  const key = exKey(day.name, ex.name);
  const settings = loadSettings();
  const last = getLastLog(key);
  const todayEntry = last && last.date === todayStr() ? last : null;

  // Pre-fill draft:
  //  - If you already logged this exercise today, load today's sets so you
  //    can see/edit them. Save will replace today's entry (not duplicate).
  //  - Otherwise, use last session's values as a ready-to-go starting point.
  const holdSec = parseHoldSeconds(ex.goal);
  const isHoldEx = holdSec != null;

  let draft = loadDraft(key);
  if (!draft) {
    if (todayEntry) {
      draft = {
        sets: todayEntry.sets.map((s) => ({ reps: s.reps || "", done: true })),
        rpe: todayEntry.rpe || null,
        editingToday: true,
      };
    } else if (last) {
      draft = {
        sets: last.sets.map((s) => ({ reps: s.reps || "", done: false })),
      };
    } else {
      draft = { sets: [{ reps: "", done: false }] };
    }
    if (!draft.sets.length) draft.sets = [{ reps: "", done: false }];
    saveDraft(key, draft);
  }

  const wrap = el(`<div class="ex-view"></div>`);
  const top = el(`
    <div class="topbar">
      <button class="back" aria-label="Back">‹</button>
      <div class="title-stack">
        <h1>${escapeHtml(ex.name)}</h1>
        <div class="sub">${escapeHtml(day.name)} · ${exIdx + 1} of ${day.exercises.length}</div>
      </div>
    </div>
  `);
  top.querySelector(".back").addEventListener("click", () => go(`#/day/${dayIdx}`));
  wrap.appendChild(top);

  if (ex.videoId) wrap.appendChild(buildVideoEl(ex.videoId));

  if (ex.goal) wrap.appendChild(el(`<div class="goal">🎯 ${escapeHtml(ex.goal)}</div>`));

  // Hold timer wires into the sets logger — log-on-pause and auto-log-on-zero
  // so you don't have to type the duration in.
  let logHeldSet = null;
  if (isHoldEx) {
    wrap.appendChild(
      buildHoldTimer(holdSec, (elapsedSec) => logHeldSet && logHeldSet(elapsedSec)),
    );
  }

  if (ex.description) {
    wrap.appendChild(
      el(`<div class="section"><h3>How to</h3><p class="desc">${escapeHtml(ex.description)}</p></div>`),
    );
  }

  // Last-time hint: show the most recent PRIOR session (skip today's entry
  // if this is a re-entry — otherwise it would just echo back your own sets).
  const priorEntry = (() => {
    const arr = loadLogs()[key] || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].date !== todayStr()) return arr[i];
    }
    return null;
  })();
  if (todayEntry) {
    wrap.appendChild(
      el(`
        <div class="last-hint" style="border-color:var(--good)">
          <span class="muted">✓ Already logged today — edits will update today's entry.</span>
        </div>
      `),
    );
  } else if (priorEntry) {
    const pretty = priorEntry.sets
      .map((s) => formatSetValue(s, isHoldEx))
      .join(", ");
    wrap.appendChild(
      el(`
        <div class="last-hint">
          <span class="muted">Last time (${fmtDate(priorEntry.date)}):</span>
          <strong>${escapeHtml(pretty)}</strong>
          ${priorEntry.rpe ? `<span class="muted"> · RPE ${priorEntry.rpe}</span>` : ""}
        </div>
      `),
    );
  }

  // Sets logger — single value column (Reps for rep-based, Seconds for holds)
  const valueLabel = isHoldEx ? "Seconds" : "Reps";
  const valueInputMode = isHoldEx ? "text" : "decimal";
  const valuePlaceholder = isHoldEx ? "1:30" : "—";

  const setsSection = el(`
    <div class="section">
      <h3>Sets</h3>
      <div class="set-headers set-headers-2">
        <div>#</div><div>${valueLabel}</div><div>✓</div>
      </div>
      <div class="sets"></div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ghost add-set">+ Add set</button>
      </div>

      <div class="rpe-block">
        <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">RPE — how hard?</div>
        <div class="rpe-row" role="radiogroup"></div>
      </div>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary save">${todayEntry ? "Update today's entry" : "Save workout"}</button>
      </div>
    </div>
  `);
  const setsBox = setsSection.querySelector(".sets");
  const renderSets = () => {
    setsBox.innerHTML = "";
    draft.sets.forEach((s, i) => {
      const row = el(`
        <div class="set-row set-row-2 ${s.done ? "done" : ""}">
          <div class="idx-col">
            <span class="idx">${i + 1}</span>
            <button class="del-set" aria-label="Delete set">×</button>
          </div>
          <input inputmode="${valueInputMode}" placeholder="${valuePlaceholder}" value="${escapeHtml(s.reps)}" />
          <button class="check" aria-label="Mark set done">${s.done ? "✓" : "○"}</button>
        </div>
      `);
      const inp = row.querySelector("input");
      inp.addEventListener("input", () => { s.reps = inp.value; saveDraft(key, draft); });
      row.querySelector(".check").addEventListener("click", () => {
        const wasDone = s.done;
        s.done = !s.done;
        saveDraft(key, draft);
        renderSets();
        if (!wasDone && s.done) {
          // Auto-start workout timer on first completed set of the day.
          if (!loadWorkoutState(dayIdx)) startWorkout(dayIdx);
          if (settings.restEnabled && settings.defaultRestSec > 0) {
            startRestTimer(settings.defaultRestSec);
          }
        }
      });
      row.querySelector(".del-set").addEventListener("click", () => {
        if (draft.sets.length === 1) {
          // Keep at least one empty row; clear it instead of removing.
          draft.sets[0] = { reps: "", done: false };
        } else {
          draft.sets.splice(i, 1);
        }
        saveDraft(key, draft);
        renderSets();
      });
      setsBox.appendChild(row);
    });
  };
  renderSets();

  // Called by the hold timer when user pauses or time hits zero.
  logHeldSet = (elapsedSec) => {
    if (elapsedSec <= 0) return;
    const pretty = fmtClock(elapsedSec); // "1:30"
    // If the most recent set is empty, fill it; else append.
    const lastIdx = draft.sets.length - 1;
    if (lastIdx >= 0 && !draft.sets[lastIdx].reps && !draft.sets[lastIdx].done) {
      draft.sets[lastIdx] = { reps: pretty, done: true };
    } else {
      draft.sets.push({ reps: pretty, done: true });
    }
    saveDraft(key, draft);
    renderSets();
    if (!loadWorkoutState(dayIdx)) startWorkout(dayIdx);
    if (settings.restEnabled && settings.defaultRestSec > 0) {
      startRestTimer(settings.defaultRestSec);
    }
  };

  setsSection.querySelector(".add-set").addEventListener("click", () => {
    const lastSet = draft.sets[draft.sets.length - 1] || {};
    draft.sets.push({ reps: lastSet.reps || "", done: false });
    saveDraft(key, draft);
    renderSets();
  });

  // RPE picker
  const rpeRow = setsSection.querySelector(".rpe-row");
  for (let r = 1; r <= 5; r++) {
    const b = el(`<button class="rpe-btn ${draft.rpe === r ? "sel" : ""}">${r}</button>`);
    b.addEventListener("click", () => {
      draft.rpe = draft.rpe === r ? null : r;
      saveDraft(key, draft);
      rpeRow.querySelectorAll(".rpe-btn").forEach((n, idx) => {
        n.classList.toggle("sel", idx + 1 === draft.rpe);
      });
    });
    rpeRow.appendChild(b);
  }

  setsSection.querySelector(".save").addEventListener("click", () => {
    const sets = draft.sets
      .filter((s) => s.reps !== "" || s.done)
      .map((s) => ({ reps: s.reps }));
    if (sets.length === 0) return alert("Add at least one set first.");

    const logs = loadLogs();
    if (!logs[key]) logs[key] = [];
    const entry = { date: todayStr(), sets };
    if (draft.rpe) entry.rpe = draft.rpe;

    // If the last entry for this exercise is already today, replace it
    // (editing today's workout, not duplicating).
    const arr = logs[key];
    if (arr.length && arr[arr.length - 1].date === todayStr()) {
      arr[arr.length - 1] = entry;
    } else {
      arr.push(entry);
    }
    saveLogs(logs);
    clearDraft(key);

    // All done today? → summary
    const allDone = day.exercises.every((e) => doneToday(exKey(day.name, e.name)));
    if (allDone) return go(`#/day/${dayIdx}/summary`);
    if (exIdx + 1 < day.exercises.length) return go(`#/day/${dayIdx}/ex/${exIdx + 1}`);
    return go(`#/day/${dayIdx}`);
  });

  wrap.appendChild(setsSection);

  // Send form check to coach
  const coachBtn = el(`<a class="btn coach" href="${whatsappHref(`Form check — ${ex.name} (${day.name})`)}" target="_blank" rel="noopener">📹 Send form check to coach</a>`);
  wrap.appendChild(coachBtn);

  // History
  const logs = loadLogs()[key] || [];
  if (logs.length) {
    const rpeVals = logs.map((e) => e.rpe).filter((r) => typeof r === "number");
    const recentRpe = rpeVals.slice(-4);
    const rpeAvg = recentRpe.length ? (recentRpe.reduce((a, b) => a + b, 0) / recentRpe.length).toFixed(1) : null;
    const rpeNote = rpeAvg ? ` · Avg RPE last ${recentRpe.length}: ${rpeAvg}` : "";
    const hist = el(`<div class="history"><h4>History${rpeNote}</h4><div class="entries"></div></div>`);
    const entries = hist.querySelector(".entries");
    [...logs].reverse().slice(0, 10).forEach((entry) => {
      const summary = entry.sets
        .map((s) => formatSetValue(s, isHoldEx))
        .join(", ");
      entries.appendChild(
        el(`
          <div class="history-entry">
            <span>${escapeHtml(summary)}${entry.rpe ? ` <span class="muted">· RPE ${entry.rpe}</span>` : ""}</span>
            <span class="date">${fmtDate(entry.date)}</span>
          </div>
        `),
      );
    });
    wrap.appendChild(hist);
  }

  app.appendChild(wrap);
  setupVideoJump();
}

// ---------- WARM-UP EXERCISE (simplified: watch + mark done) ----------
function renderWarmUpExercise(dayIdx, exIdx, day, ex) {
  const key = exKey(day.name, ex.name);
  const logsForKey = loadLogs()[key] || [];
  const done = logsForKey.some((e) => e.date === todayStr());

  const wrap = el(`<div class="ex-view"></div>`);
  const top = el(`
    <div class="topbar">
      <button class="back" aria-label="Back">‹</button>
      <div class="title-stack">
        <h1>${escapeHtml(ex.name)}</h1>
        <div class="sub">${escapeHtml(day.name)} · ${exIdx + 1} of ${day.exercises.length}</div>
      </div>
    </div>
  `);
  top.querySelector(".back").addEventListener("click", () => go(`#/day/${dayIdx}`));
  wrap.appendChild(top);

  if (ex.videoId) wrap.appendChild(buildVideoEl(ex.videoId));

  if (ex.goal) wrap.appendChild(el(`<div class="goal">🎯 ${escapeHtml(ex.goal)}</div>`));
  if (ex.description) {
    wrap.appendChild(
      el(`<div class="section"><h3>How to</h3><p class="desc">${escapeHtml(ex.description)}</p></div>`),
    );
  }

  const btn = el(
    `<button class="btn primary" style="height:56px;font-size:17px;margin-top:18px;width:100%">${done ? "Done today ✓ — tap to undo" : "Mark done"}</button>`,
  );
  btn.addEventListener("click", () => {
    const logs = loadLogs();
    if (!logs[key]) logs[key] = [];
    const idx = logs[key].findIndex((e) => e.date === todayStr());
    const wasUndone = idx >= 0;
    if (wasUndone) logs[key].splice(idx, 1);
    else logs[key].push({ date: todayStr(), warmup: true });
    saveLogs(logs);
    // On mark-done: advance to next warm-up item if any; else back to day.
    if (!wasUndone && exIdx + 1 < day.exercises.length) go(`#/day/${dayIdx}/ex/${exIdx + 1}`);
    else go(`#/day/${dayIdx}`);
  });
  wrap.appendChild(btn);

  if (logsForKey.length) {
    const recent = logsForKey.slice(-7).reverse().map((e) => fmtDate(e.date)).join(" · ");
    wrap.appendChild(
      el(`<div class="tip" style="margin-top:18px">Recent: ${escapeHtml(recent)}</div>`),
    );
  }

  app.appendChild(wrap);
  setupVideoJump();
}

// When the video scrolls off-screen, show a floating "↑ Video" pill so you
// can pop back up. Uses IntersectionObserver — no layout thrash.
function setupVideoJump() {
  const v = document.getElementById("video-wrap");
  if (!v) return;
  const pill = el(`<button class="video-jump" aria-label="Scroll to video">↑ Video</button>`);
  document.body.appendChild(pill);
  pill.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) pill.classList.toggle("visible", !e.isIntersecting);
    },
    { rootMargin: "-40px 0px 0px 0px" },
  );
  obs.observe(v);
  // Clean up on route change
  const cleanup = () => {
    obs.disconnect();
    pill.remove();
    window.removeEventListener("hashchange", cleanup);
  };
  window.addEventListener("hashchange", cleanup, { once: true });
}

// ---------- hold timer ----------
function buildHoldTimer(totalSec, onLog) {
  const box = el(`
    <div class="timer-card hold">
      <div class="timer-label">Hold timer — logs when you pause or hit the goal</div>
      <div class="timer-display">${fmtClock(totalSec)}</div>
      <div class="btn-row">
        <button class="btn primary" data-act="start">Start</button>
        <button class="btn ghost" data-act="reset">Reset</button>
      </div>
    </div>
  `);
  const disp = box.querySelector(".timer-display");
  const startBtn = box.querySelector('[data-act="start"]');
  const resetBtn = box.querySelector('[data-act="reset"]');

  let remaining = totalSec;
  let endAt = null;
  let tickId = null;

  const stop = () => { if (tickId) { clearInterval(tickId); tickId = null; } };
  const updateUI = () => {
    disp.textContent = fmtClock(remaining);
    startBtn.textContent = tickId ? "Pause & log" : remaining === totalSec ? "Start" : "Resume";
    box.classList.toggle("running", !!tickId);
    box.classList.toggle("done", remaining <= 0);
  };
  const elapsed = () => totalSec - remaining;
  const tick = () => {
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    updateUI();
    if (remaining <= 0) {
      stop();
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
      beep();
      // Auto-log a successful hold at full target.
      if (typeof onLog === "function") onLog(totalSec);
    }
  };
  startBtn.addEventListener("click", () => {
    if (tickId) {
      // Pause → log whatever was held.
      const held = elapsed();
      stop();
      updateUI();
      if (held > 0 && typeof onLog === "function") onLog(held);
      return;
    }
    if (remaining <= 0) remaining = totalSec;
    endAt = Date.now() + remaining * 1000;
    tick();
    tickId = setInterval(tick, 250);
  });
  resetBtn.addEventListener("click", () => {
    stop(); remaining = totalSec; updateUI();
  });
  updateUI();
  return box;
}

// ---------- workout timer widget (day view) ----------
function buildWorkoutTimer(dayIdx) {
  const box = el(`
    <div class="timer-card workout">
      <div class="timer-label">Workout timer</div>
      <div class="timer-display">0:00</div>
      <div class="btn-row">
        <button class="btn primary" data-act="toggle">Start</button>
        <button class="btn ghost" data-act="reset">Reset</button>
      </div>
    </div>
  `);
  const disp = box.querySelector(".timer-display");
  const toggleBtn = box.querySelector('[data-act="toggle"]');
  const resetBtn = box.querySelector('[data-act="reset"]');

  let tickId = null;
  const refresh = () => {
    const state = loadWorkoutState(dayIdx);
    disp.textContent = formatDurationMs(workoutElapsedMs(state));
    const running = !!state?.runningSince;
    toggleBtn.textContent = running ? "Pause" : state?.accumMs ? "Resume" : "Start";
    box.classList.toggle("running", running);
  };

  const start = () => {
    if (tickId) return;
    tickId = setInterval(refresh, 1000);
  };
  const stopTick = () => {
    if (tickId) { clearInterval(tickId); tickId = null; }
  };

  toggleBtn.addEventListener("click", () => {
    const state = loadWorkoutState(dayIdx);
    if (state?.runningSince) {
      pauseWorkout(dayIdx);
      stopTick();
    } else {
      startWorkout(dayIdx);
      start();
    }
    refresh();
  });
  resetBtn.addEventListener("click", () => {
    if (!confirm("Reset workout timer?")) return;
    saveWorkoutState(dayIdx, null);
    stopTick();
    refresh();
  });

  // If we arrived and a timer was already running (returning to the view),
  // kick off the tick loop so the display animates.
  refresh();
  if (loadWorkoutState(dayIdx)?.runningSince) start();

  // Clean up on navigation
  window.addEventListener("hashchange", stopTick, { once: true });
  return box;
}

// ---------- rest timer (bottom sheet) ----------
let restSheetEl = null;
let restInterval = null;
function startRestTimer(totalSec) {
  if (restSheetEl) restSheetEl.remove();
  restSheetEl = el(`
    <div class="rest-sheet">
      <div class="rest-title">Rest</div>
      <div class="rest-display">${fmtClock(totalSec)}</div>
      <div class="rest-row">
        <button class="btn ghost" data-act="minus">−15s</button>
        <button class="btn ghost" data-act="plus">+15s</button>
        <button class="btn primary" data-act="done">Skip</button>
      </div>
    </div>
  `);
  document.body.appendChild(restSheetEl);
  let endAt = Date.now() + totalSec * 1000;
  const disp = restSheetEl.querySelector(".rest-display");
  const adj = (delta) => {
    endAt += delta * 1000;
    tick();
  };
  const stop = () => {
    clearInterval(restInterval);
    restInterval = null;
    if (restSheetEl) { restSheetEl.remove(); restSheetEl = null; }
  };
  const tick = () => {
    const rem = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    disp.textContent = fmtClock(rem);
    if (rem <= 0) {
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
      beep();
      stop();
    }
  };
  restSheetEl.querySelector('[data-act="minus"]').addEventListener("click", () => adj(-15));
  restSheetEl.querySelector('[data-act="plus"]').addEventListener("click", () => adj(15));
  restSheetEl.querySelector('[data-act="done"]').addEventListener("click", stop);
  restInterval = setInterval(tick, 250);
  tick();
}

// Tiny beep (WebAudio, no asset)
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
    o.start();
    o.stop(audioCtx.currentTime + 0.42);
  } catch {}
}

// ---------- SUMMARY ----------
function renderSummary(dayIdx, date) {
  const day = program.days[dayIdx];
  if (!day) return go("#/");
  const forDate = date || todayStr();
  const logs = loadLogs();

  let totalSets = 0;
  const completedExercises = [];
  for (const ex of day.exercises) {
    const key = exKey(day.name, ex.name);
    const entry = (logs[key] || []).find((e) => e.date === forDate);
    if (entry) {
      totalSets += entry.sets.length;
      completedExercises.push({ ex, entry });
    }
  }

  // Stop the workout timer on the first time we hit summary for today.
  const isToday = forDate === todayStr();
  let durationMs = 0;
  if (isToday) {
    durationMs = stopWorkout(dayIdx, forDate);
  } else {
    const state = loadWorkoutState(dayIdx, forDate);
    if (state) durationMs = state.accumMs;
  }

  const settings = loadSettings();
  const wkStreak = weeklyStreak(settings.weeklyGoal || 3);

  const wrap = el(`<div></div>`);
  const top = el(`
    <div class="topbar">
      <button class="back" aria-label="Back">‹</button>
      <div class="title-stack"><h1>${escapeHtml(day.name)} done ✓</h1>
        <div class="sub">${fmtDate(forDate)} · ${completedExercises.length} exercises · ${totalSets} sets</div>
      </div>
    </div>
  `);
  top.querySelector(".back").addEventListener("click", () => {
    go(date ? "#/past" : `#/day/${dayIdx}`);
  });
  wrap.appendChild(top);

  wrap.appendChild(
    el(`
      <div class="hero-card">
        <div class="hero-big">${wkStreak > 0 ? `🔥 ${wkStreak}-week streak` : "Nice work!"}</div>
        <div class="hero-sub">
          ${completedExercises.length} exercises · ${totalSets} sets${durationMs ? ` · ${formatDurationMs(durationMs)}` : ""}
        </div>
      </div>
    `),
  );

  const detailList = el(`<div class="list" style="margin-top:14px"></div>`);
  for (const { ex, entry } of completedExercises) {
    const setsStr = entry.sets
      .map((s) => formatSetValue(s, isHoldExercise(ex)))
      .join(", ");
    detailList.appendChild(
      el(`
        <div class="card">
          <div class="name">${escapeHtml(ex.name)}</div>
          <div class="meta">${escapeHtml(setsStr)}${entry.rpe ? ` · RPE ${entry.rpe}` : ""}</div>
        </div>
      `),
    );
  }
  wrap.appendChild(detailList);

  // Coach share
  const text = buildCoachText(day, completedExercises, forDate, durationMs);
  const shareRow = el(`
    <div class="btn-row" style="margin-top:18px">
      <a class="btn coach" style="flex:1" href="${whatsappHref(text)}" target="_blank" rel="noopener">
        💬 Send to coach on WhatsApp
      </a>
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn ghost" style="flex:1" id="copy-text">Copy summary</button>
    </div>
  `);
  wrap.appendChild(shareRow);
  const copyBtn = wrap.querySelector("#copy-text");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => (copyBtn.textContent = "Copy summary"), 1400);
      } catch {
        alert(text);
      }
    });
  }

  app.appendChild(wrap);
}

function buildCoachText(day, completed, forDate, durationMs) {
  const lines = [`📅 ${day.name} — ${forDate || todayStr()}`];
  if (durationMs) lines.push(`⏱ ${formatDurationMs(durationMs)}`);
  for (const { ex, entry } of completed) {
    const setsStr = entry.sets
      .map((s) => formatSetValue(s, isHoldExercise(ex)))
      .join(", ");
    lines.push(`• ${ex.name}: ${setsStr}${entry.rpe ? ` (RPE ${entry.rpe})` : ""}`);
  }
  const settings = loadSettings();
  const ws = weeklyStreak(settings.weeklyGoal || 3);
  if (ws > 0) lines.push(``, `🔥 ${ws}-week streak · ${currentWeekCount()}/${settings.weeklyGoal || 3} this week`);
  return lines.join("\n");
}

// ---------- bootstrap ----------
// Prefer the refreshed-from-coach program if we have one; otherwise fall
// back to the bundled program.json that shipped with the app.
const stored = loadStoredProgram();
if (stored) {
  program = stored;
  if (!location.hash) location.hash = "#/";
  render();
} else {
  fetch("program.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((p) => {
      program = p;
      if (!location.hash) location.hash = "#/";
      render();
    })
    .catch((e) => {
      app.innerHTML = `<p style="padding:20px;color:#f88">Failed to load program: ${escapeHtml(e.message)}</p>`;
    });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(nw);
          }
        });
      });
    })
    .catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdateBanner(worker) {
  if (document.querySelector(".update-banner")) return;
  const b = el(`<div class="update-banner">New version ready · <strong>tap to update</strong></div>`);
  b.addEventListener("click", () => worker.postMessage({ type: "SKIP_WAITING" }));
  document.body.appendChild(b);
}
