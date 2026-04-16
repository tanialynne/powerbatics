// Generates ~2 months of realistic fake logs + workout durations, based on
// the current program.json. Output: fake-data.json, importable via
// Settings → Import.
//
// Run: node scripts/gen-fake-data.mjs

import { readFileSync, writeFileSync } from "node:fs";

const program = JSON.parse(readFileSync("program.json", "utf8"));

const TODAY = new Date("2026-04-16T00:00:00");
const DAYS_BACK = 60;

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const exKey = (dayName, exName) => `${slug(dayName)}::${slug(exName)}`;
const iso = (d) => d.toISOString().slice(0, 10);

// Deterministic-ish randomness so regenerations don't churn too much.
let seed = 42;
const rand = () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};
const rng = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function parseHoldSeconds(goal) {
  if (!goal) return null;
  const g = goal.toLowerCase();
  let m;
  if ((m = g.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\s*hold/)))
    return Math.round(parseFloat(m[1]) * 60);
  if ((m = g.match(/(\d+)\s*(?:seconds?|secs?)\s*hold/)))
    return parseInt(m[1], 10);
  if ((m = g.match(/hold\s*(?:for)?\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|seconds?|secs?)/))) {
    const v = parseFloat(m[1]);
    return /min/.test(m[2]) ? Math.round(v * 60) : Math.round(v);
  }
  return null;
}
function parseRepGoal(goal) {
  if (!goal) return null;
  const m = goal.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Progression factor: 0.0 at oldest, 1.0 at most recent. Used to trend
// hold times up and RPE down over the 2 months.
const prog = (daysAgo) => 1 - daysAgo / DAYS_BACK;

const WARMUP_DAY = program.days.find((d) => /warm\s*up/i.test(d.name));
const TRAINING_DAYS = program.days.filter((d) => !/warm\s*up/i.test(d.name));

// Training schedule: Mon(1), Wed(3), Fri(5), Sat(6). Occasional miss.
const SCHEDULE = new Set([1, 3, 5, 6]);
// Skip a random ~10% of scheduled days to make it realistic.
const SKIP_RATE = 0.1;

const logs = {};
const workout = {};

const pushLog = (key, entry) => {
  if (!logs[key]) logs[key] = [];
  logs[key].push(entry);
};

for (let back = DAYS_BACK; back >= 1; back--) {
  const date = new Date(TODAY);
  date.setDate(TODAY.getDate() - back);
  const dow = date.getDay();
  const dateStr = iso(date);

  if (!SCHEDULE.has(dow)) continue;
  if (rand() < SKIP_RATE) continue;

  // Rotate training days over the weeks so it's not always the same one.
  // Pick Day (1..5) based on day-of-year so it cycles.
  const dayIdxInProgram = program.days.indexOf(
    TRAINING_DAYS[(Math.floor((DAYS_BACK - back) / 2) + dow) % TRAINING_DAYS.length],
  );
  const day = program.days[dayIdxInProgram];
  if (!day) continue;

  const factor = prog(back);

  // Warm up: done most days before training (80%).
  if (WARMUP_DAY && rand() < 0.8) {
    for (const ex of WARMUP_DAY.exercises) {
      pushLog(exKey(WARMUP_DAY.name, ex.name), { date: dateStr, warmup: true });
    }
  }

  // Training: log every exercise with 3 sets.
  let workoutSeconds = 0;
  for (const ex of day.exercises) {
    const holdGoal = parseHoldSeconds(ex.goal);
    const repGoal = parseRepGoal(ex.goal);
    const setCount = pick([2, 3, 3, 3, 4]);
    const sets = [];
    if (holdGoal) {
      // Progress from ~40% to ~95% of goal over 60 days, with small variance.
      const target = holdGoal * (0.4 + factor * 0.55);
      for (let i = 0; i < setCount; i++) {
        const v = Math.max(5, Math.round(target + rng(-8, 6)));
        sets.push({ reps: fmtClock(v) });
        workoutSeconds += v + 30; // set + rest
      }
    } else if (repGoal) {
      const target = repGoal * (0.6 + factor * 0.45);
      for (let i = 0; i < setCount; i++) {
        const v = Math.max(1, Math.round(target + rng(-2, 2)));
        sets.push({ reps: String(v) });
        workoutSeconds += v * 2 + 45; // rough per-set time + rest
      }
    } else {
      // Unknown goal shape: log as 3 generic reps of 10.
      for (let i = 0; i < setCount; i++) {
        sets.push({ reps: String(rng(8, 12)) });
        workoutSeconds += 60;
      }
    }

    // RPE: trends from 5 toward 3 as you get stronger. Small randomness.
    let rpe = Math.round(5 - factor * 2 + rng(-1, 1));
    rpe = Math.max(1, Math.min(5, rpe));

    pushLog(exKey(day.name, ex.name), { date: dateStr, sets, rpe });
  }

  // Workout duration: roughly summed seconds + warmup overhead, clamped.
  const totalMs = Math.min(3600 * 1000, Math.max(900 * 1000, workoutSeconds * 1000));
  workout[`${dateStr}::${dayIdxInProgram}`] = {
    accumMs: totalMs,
    runningSince: null,
  };
}

// No `settings` on purpose — importing fake data shouldn't clobber real
// user prefs like the coach's WhatsApp number.
const out = { logs, workout };

writeFileSync("fake-data.json", JSON.stringify(out, null, 2));

const totalEntries = Object.values(logs).reduce((n, a) => n + a.length, 0);
const trainingDates = new Set();
for (const arr of Object.values(logs)) for (const e of arr) if (!e.warmup) trainingDates.add(e.date);
console.log(
  `Wrote fake-data.json — ${totalEntries} log entries across ${trainingDates.size} training days.`,
);
console.log("Import via Settings → Import.");
