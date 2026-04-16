# Powerbatics — project notes

A mobile PWA that makes a paid calisthenics coaching program actually usable on a phone. Replaces the long scroll-everything WordPress/Elementor custom-program page with a clean day → exercise → log flow with timers, history, streaks, and coach-share.

## Problem it solves

Tania pays $7k/yr for a custom program at Pacific Rim Athletics. The program is delivered as one long WordPress page that reloads itself, doesn't remember scroll position, plays video audio that interrupts music/Audible, and has no logging. Result: 4+ months in, she rarely does the exercises. This app gives her a Fitbod/Movement-Athlete-style experience over the same underlying content.

## Current state

- **Deployed** to Netlify (linked to GitHub `tanialynne/powerbatics`, `main` auto-deploys). Live as a PWA; installs to iPhone home screen.
- **Personal use only** right now. Bundled `program.json` is Tania's; default "Program source URL" in Settings is her custom page.
- **No backend storage.** All user data (logs, drafts, settings) is localStorage on-device. Export/Import JSON available for backup.
- **Live refresh works.** Settings → "⟳ Refresh from coach's page" pulls the latest HTML from `custom.pacificrimathletics.com` through a Netlify Function proxy (`/api/coach-page`), re-parses it, and shows a diff (N new / N removed / N videos changed). Allowlist is locked to `custom.pacificrimathletics.com` so the proxy isn't open.

## Intended next step

Share the installed PWA URL with her coach and Coach Lee (the PRA owner) to get their reaction — but only in "view my program" mode. Not yet multi-client. Before adding first-run setup for arbitrary users, confirm there's interest.

## Architecture

Single-page app, single file, no build step.

```
index.html          entry
app.js              views (home, day, exercise, warm-up, summary, settings), routing, logging, timers, install, wake-lock, SW glue
parser.mjs          shared Elementor-HTML → program JSON parser (same code runs in Node CLI and in the browser refresh path)
parse.mjs           CLI: generatedHTML.html → program.json (legacy path, kept for convenience)
styles.css
manifest.webmanifest
sw.js               service worker: offline shell, silent auto-update, /api/* always network
icon-180/192/512.png
netlify/functions/coach-page.mjs     CORS proxy for live refresh
netlify.toml
program.json        bundled fallback program (Tania's). Overridden by pb.program.v1 in localStorage once refresh is used.
generatedHTML.html  raw source for the CLI parse step; not loaded by the app
```

### Data model (localStorage keys, all prefixed `pb.`)

- `pb.logs.v1` — `{ [dayslug::exslug]: [{ date, sets: [{reps}], rpe?, warmup? }] }`
- `pb.draft.v1.<key>` — in-progress sets, saved on every input
- `pb.settings.v1` — `{ coachPhone, defaultRestSec, restEnabled }`
- `pb.program.v1` — refreshed program, takes precedence over bundled JSON
- `pb.programUrl.v1` — coach's custom-program URL
- `pb.lastRefresh.v1` — ISO timestamp of last successful refresh
- `pb.installHintDismissed`

## Features built

### Logging
- Set logger; single value column that's context-aware (**Reps** or **Seconds** for hold exercises — weight column intentionally removed since it's calisthenics)
- "Last time" pre-fill — opens an exercise with your most recent session's numbers
- Re-enter an exercise already done today → loads today's sets with ✓, Save **updates** (doesn't duplicate)
- Rest timer — auto-starts on set ✓; ±15s, Skip, vibrate + beep
- Hold timer — auto-parsed from goals ("2 minute hold" etc.); "Pause & log" captures the held time as a completed set; hitting zero auto-logs full goal; rest timer fires either way
- RPE 1–5 per entry
- Per-exercise History panel (last 10 sessions, formats holds as mm:ss)

### Warm-up (special)
- Simpler view: video + "Mark done" button only. No sets, no RPE, no timers.
- Tagged `warmup: true` in logs; excluded from streak and calendar
- No "View summary" after warm-up day

### Video
- Vimeo iframe, muted by default (music/Audible keeps playing; tap speaker icon in player to unmute)
- Big ⛶ fullscreen button — opens a CSS overlay that fills the viewport (100dvh), with ✕ close button. Works identically on iPhone/iPad/Android/desktop without iOS iframe-fullscreen quirks.
- "↑ Video" floating pill appears when the video scrolls off-screen (IntersectionObserver, no thrash)

### Home / motivation
- 14-day calendar strip with worked-out days highlighted
- 🔥 N-day streak counter in header

### End-of-day summary
- Auto-routes when all training exercises for a day are marked done today
- Hero card with streak + counts, per-exercise recap
- **Send to coach on WhatsApp** button — prefilled plaintext summary
- Copy summary fallback

### Coach collab
- Per-exercise "📹 Send form check to coach" WhatsApp deep link
- Settings → coach's WhatsApp number (used by all `wa.me/<number>?text=…` links)

### Program refresh (live from WP)
- Netlify Function proxy at `/api/coach-page?url=…`, hostname-allowlisted
- "⟳ Refresh from coach's page" in Settings re-fetches + re-parses + writes to localStorage
- Diff summary after refresh
- Refuses to overwrite if parser returns zero exercises (safety net)
- Logs are unaffected by refresh (streak is safe)

### Install / update
- One-tap Install button (Android/Chromium native prompt; iOS Safari modal with steps)
- Silent auto-update: service worker polls on visibility change; "tap to update" pill shows for new versions
- App shell works offline after first load (navigation, logging, timers). Videos need network — Vimeo iframes stream on demand and can't be pre-cached from the browser.
- Screen Wake Lock during exercise and summary views
- Apple Touch Icon and maskable icons

### Data portability
- Export logs (JSON) / Import in Settings
- Clear all data (two-step confirm)

## Future features (roadmap, rough priority)

### Near-term (single-user polish)
- **Undo snackbar** on Save/Mark-done so accidental taps are trivially reversible.
- **Notes per set / per exercise / per day** (freeform), included in coach export.
- **Skip with reason** (injury, equipment) as distinct from "not done yet".
- **Benchmarks** — track named PRs like "Horse stance 2-min hold" as a progress bar across sessions.
- **Per-exercise "record form check" reminder** — a tiny toggle that flags "record a video today" and shows the WhatsApp send button prominently when done.
- **Coach export = rich text / PDF**, not just a WhatsApp string.

### Product / multi-client
- **First-run setup screen**: if no URL saved and no program refreshed, block the app with "Paste your coach's custom program URL" before anything else. *Needed before sharing with any other PRA client.* ~15 min to build.
- **Unbundle `program.json` and `generatedHTML.html`** from the repo so the codebase becomes generically shareable and Tania's program data leaves git.
- **Expand proxy allowlist** if other studios come on board (currently only `custom.pacificrimathletics.com`).
- **Simple analytics** (self-hosted, privacy-respecting) to see which exercises get skipped, where parser breaks.

### Parser robustness
- Handle **unilateral / per-side / per-direction** exercises (e.g. "10s × 4 reps each direction"). Decision today: do NOT split the UI — let the value field accept free-form text like "10 L, 10 R". Revisit only if PRA's template introduces explicit L/R markup.
- **Non-hold holds** — a goal like "hold at tension" with no duration; currently not recognized. Low priority.

### If the owner wants it for all PRA students (the big lift, ~2–3 weeks)
- **WordPress plugin** that publishes each client's custom program as JSON at a predictable URL. ~100 lines of PHP, keeps owner's existing Elementor authoring workflow intact.
- **Auth** (magic-link email via Supabase/Clerk) so each app knows whose program to pull.
- **Cloud sync** for logs (Supabase Postgres) so logs survive device loss and can be shared with the coach.
- **Coach dashboard** — read-only view of each client's weekly logs + RPE trends. This is the real value prop that justifies the existing $7k coaching.
- **Push notifications for coach messages / weekly reminders** (Web Push on Android; iOS needs installed PWA).

### Known limits / caveats
- localStorage only → no iPhone ↔ iPad sync, no coach visibility. Export JSON is the escape hatch.
- iOS may evict PWA localStorage after ~7 weeks of non-use. Export occasionally.
- Vimeo videos require network; fullscreen overlay works offline but video won't play.
- Parser keys off Pacific Rim's Elementor template — a theme change could break it; `refreshFromCoachPage` refuses to overwrite on zero-exercise parses.
- No login. The "refresh" mechanism works because the coach's URLs are public; that's Pacific Rim–specific.

## Versioning / SW cache

Bump `CACHE` in `sw.js` on every meaningful change (currently `pb-v11`). The client polls for updates on visibilitychange and surfaces a "tap to update" pill when a new SW is installed.
