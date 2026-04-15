// Single-file PWA. Hash routing: #/ , #/day/<i> , #/day/<i>/ex/<j>
const app = document.getElementById("app");
let program = null;

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (s) => {
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// ---------- storage ----------
const LS_LOGS = "pb.logs.v1";
const LS_DRAFT = "pb.draft.v1";

const loadLogs = () => {
  try { return JSON.parse(localStorage.getItem(LS_LOGS) || "{}"); }
  catch { return {}; }
};
const saveLogs = (l) => localStorage.setItem(LS_LOGS, JSON.stringify(l));

const exKey = (dayName, exName) => `${slug(dayName)}::${slug(exName)}`;

const loadDraft = (key) => {
  try { return JSON.parse(localStorage.getItem(`${LS_DRAFT}.${key}`) || "null"); }
  catch { return null; }
};
const saveDraft = (key, val) =>
  localStorage.setItem(`${LS_DRAFT}.${key}`, JSON.stringify(val));
const clearDraft = (key) => localStorage.removeItem(`${LS_DRAFT}.${key}`);

const lastDoneDate = (key) => {
  const logs = loadLogs()[key];
  if (!logs || !logs.length) return null;
  return logs[logs.length - 1].date;
};
const doneToday = (key) => lastDoneDate(key) === todayStr();

// ---------- routing ----------
const parseHash = () => {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h) return { view: "home" };
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "day" && parts[1] != null) {
    const dayIdx = parseInt(parts[1], 10);
    if (parts[2] === "ex" && parts[3] != null) {
      return { view: "exercise", dayIdx, exIdx: parseInt(parts[3], 10) };
    }
    return { view: "day", dayIdx };
  }
  return { view: "home" };
};
const go = (hash) => { location.hash = hash; };

window.addEventListener("hashchange", render);
window.addEventListener("popstate", render);

// ---------- wake lock (keep screen on during exercise) ----------
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
  if (document.visibilityState === "visible" && parseHash().view === "exercise") {
    acquireWakeLock();
  }
});

// ---------- rendering ----------
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

function render() {
  if (!program) return;
  const route = parseHash();
  app.innerHTML = "";
  if (route.view === "exercise") acquireWakeLock();
  else releaseWakeLock();
  if (route.view === "home") return renderHome();
  if (route.view === "day") return renderDay(route.dayIdx);
  if (route.view === "exercise") return renderExercise(route.dayIdx, route.exIdx);
}

// ---------- install hint for iOS Safari ----------
function maybeShowInstallHint(container) {
  const dismissed = localStorage.getItem("pb.installHintDismissed") === "1";
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (dismissed || isStandalone || !isIOS) return;
  const banner = el(`
    <div class="tip" style="border-left:3px solid var(--accent);">
      <strong style="color:var(--text)">Install this on your Home Screen</strong><br/>
      Tap the <strong>Share</strong> button in Safari (square with ↑), then
      <strong>Add to Home Screen</strong>. The app then opens full-screen and
      won't forget where you were.
      <div style="margin-top:8px"><button class="btn ghost" style="height:36px">Got it</button></div>
    </div>
  `);
  banner.querySelector("button").addEventListener("click", () => {
    localStorage.setItem("pb.installHintDismissed", "1");
    banner.remove();
  });
  container.prepend(banner);
}

function renderHome() {
  const wrap = el(`<div></div>`);
  wrap.appendChild(
    el(`
      <div class="topbar">
        <div class="title-stack">
          <h1>${escapeHtml(program.title || "Powerbatics")}</h1>
          <div class="sub">Pick a day</div>
        </div>
      </div>
    `),
  );

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
          <div>
            <div class="name">${escapeHtml(day.name)}</div>
            <div class="meta">${escapeHtml(meta)}</div>
          </div>
          <span class="chev">›</span>
        </div>
      </button>
    `);
    card.addEventListener("click", () => go(`#/day/${i}`));
    list.appendChild(card);
  });
  wrap.appendChild(list);

  if (program.intro) {
    wrap.appendChild(
      el(`<div class="tip" style="margin-top:18px">${escapeHtml(program.intro)}</div>`),
    );
  }

  maybeShowInstallHint(wrap);
  app.appendChild(wrap);
}

function renderDay(dayIdx) {
  const day = program.days[dayIdx];
  if (!day) return go("#/");
  const wrap = el(`<div></div>`);
  const top = el(`
    <div class="topbar">
      <button class="back" aria-label="Back">‹</button>
      <div class="title-stack">
        <h1>${escapeHtml(day.name)}</h1>
        <div class="sub">${day.exercises.length} exercises</div>
      </div>
    </div>
  `);
  top.querySelector(".back").addEventListener("click", () => go("#/"));
  wrap.appendChild(top);

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
  app.appendChild(wrap);
}

function renderExercise(dayIdx, exIdx) {
  const day = program.days[dayIdx];
  if (!day) return go("#/");
  const ex = day.exercises[exIdx];
  if (!ex) return go(`#/day/${dayIdx}`);

  const key = exKey(day.name, ex.name);
  const draft = loadDraft(key) || { sets: [{ reps: "", weight: "", done: false }] };

  const wrap = el(`<div></div>`);
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

  if (ex.videoId) {
    // muted=1 keeps your music/audible playing. Tap the player's speaker icon to unmute.
    const v = el(`
      <div class="video-wrap">
        <iframe
          src="https://player.vimeo.com/video/${ex.videoId}?title=0&byline=0&portrait=0&playsinline=1&muted=1"
          allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
    `);
    wrap.appendChild(v);
  }

  if (ex.goal) {
    wrap.appendChild(el(`<div class="goal">🎯 ${escapeHtml(ex.goal)}</div>`));
  }
  if (ex.description) {
    wrap.appendChild(
      el(`
        <div class="section">
          <h3>How to</h3>
          <p class="desc">${escapeHtml(ex.description)}</p>
        </div>
      `),
    );
  }

  // Sets logger
  const setsSection = el(`
    <div class="section">
      <h3>Sets</h3>
      <div class="set-headers">
        <div>#</div><div>Reps</div><div>Weight</div><div>✓</div>
      </div>
      <div class="sets"></div>
      <div class="btn-row">
        <button class="btn ghost add-set">+ Add set</button>
        <button class="btn primary save">Save workout</button>
      </div>
    </div>
  `);
  const setsBox = setsSection.querySelector(".sets");

  const renderSets = () => {
    setsBox.innerHTML = "";
    draft.sets.forEach((s, i) => {
      const row = el(`
        <div class="set-row ${s.done ? "done" : ""}">
          <div class="idx">${i + 1}</div>
          <input inputmode="decimal" placeholder="—" value="${escapeHtml(s.reps)}" />
          <input inputmode="decimal" placeholder="—" value="${escapeHtml(s.weight)}" />
          <button class="check" aria-label="Mark set done">${s.done ? "✓" : "○"}</button>
        </div>
      `);
      const [repsInp, wtInp] = row.querySelectorAll("input");
      repsInp.addEventListener("input", () => {
        s.reps = repsInp.value;
        saveDraft(key, draft);
      });
      wtInp.addEventListener("input", () => {
        s.weight = wtInp.value;
        saveDraft(key, draft);
      });
      row.querySelector(".check").addEventListener("click", () => {
        s.done = !s.done;
        saveDraft(key, draft);
        renderSets();
      });
      setsBox.appendChild(row);
    });
  };
  renderSets();

  setsSection.querySelector(".add-set").addEventListener("click", () => {
    const last = draft.sets[draft.sets.length - 1] || {};
    draft.sets.push({ reps: last.reps || "", weight: last.weight || "", done: false });
    saveDraft(key, draft);
    renderSets();
  });

  setsSection.querySelector(".save").addEventListener("click", () => {
    const sets = draft.sets
      .filter((s) => s.reps !== "" || s.weight !== "" || s.done)
      .map((s) => ({ reps: s.reps, weight: s.weight }));
    if (sets.length === 0) {
      alert("Add at least one set first.");
      return;
    }
    const logs = loadLogs();
    if (!logs[key]) logs[key] = [];
    logs[key].push({ date: todayStr(), sets });
    saveLogs(logs);
    clearDraft(key);
    // Move to next exercise if any, else back to day
    if (exIdx + 1 < day.exercises.length) go(`#/day/${dayIdx}/ex/${exIdx + 1}`);
    else go(`#/day/${dayIdx}`);
  });

  wrap.appendChild(setsSection);

  // History
  const logs = loadLogs()[key] || [];
  if (logs.length) {
    const hist = el(`
      <div class="history">
        <h4>History</h4>
        <div class="entries"></div>
      </div>
    `);
    const entries = hist.querySelector(".entries");
    [...logs].reverse().slice(0, 10).forEach((entry) => {
      const summary = entry.sets
        .map((s) => `${s.reps || "—"}${s.weight ? `×${s.weight}` : ""}`)
        .join(", ");
      entries.appendChild(
        el(`
          <div class="history-entry">
            <span>${escapeHtml(summary)}</span>
            <span class="date">${fmtDate(entry.date)}</span>
          </div>
        `),
      );
    });
    wrap.appendChild(hist);
  }

  app.appendChild(wrap);
}

// ---------- bootstrap ----------
fetch("program.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then((p) => {
    program = p;
    if (!location.hash) location.hash = "#/";
    render();
  })
  .catch((e) => {
    app.innerHTML = `<p style="padding:20px;color:#f88">Failed to load program.json: ${escapeHtml(
      e.message,
    )}</p>`;
  });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
