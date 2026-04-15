# Powerbatics — your custom program, on your phone

A tiny offline-first PWA that turns the messy custom workout page into a per-day, per-exercise app with set logging.

## Try it on your iPhone right now (LAN, no deploy)

The local server is already running. Make sure your phone is on the same Wi-Fi as this Mac, then:

1. On your iPhone, open **Safari** and go to: **http://10.0.0.95:8765**
   (If that IP changes — e.g. you switch networks — re-run `ipconfig getifaddr en0` to get the current one.)
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open the new **Powerbatics** icon. Now it runs full-screen like an app.

> Note: iOS limits service-worker offline caching to the first time you visit on the LAN. Once installed, the program JSON and assets stay cached. Logs save to your phone's local storage.

## Restart the local server later

```sh
cd ~/Localhost/powerbatics
python3 -m http.server 8765
```

## Want it to "just work" anywhere (not only at home)?

Easiest free path — drag this folder onto **https://app.netlify.com/drop**. You get a public HTTPS URL like `tania-powerbatics.netlify.app`. Add THAT to your home screen instead, and the app works from anywhere with no Mac needed. (Same for Vercel, Cloudflare Pages.)

## When your coach updates the program

1. Re-save the page source as `generatedHTML.html` in this folder.
2. Run `node parse.mjs` — that regenerates `program.json`.
3. Refresh the app on your phone.

## What's where

- `index.html`, `app.js`, `styles.css` — the app
- `program.json` — your parsed program (44 exercises, 5 days + warm-up)
- `parse.mjs` — turns `generatedHTML.html` → `program.json`
- `sw.js`, `manifest.webmanifest` — PWA glue (offline + home-screen install)

## Data model

Workout logs are stored under `localStorage["pb.logs.v1"]` as:

```json
{ "day-1::horse-stance-squat": [{ "date": "2026-04-15", "sets": [{"reps":"60", "weight":""}] }] }
```

In-progress sets persist as drafts under `pb.draft.<key>` so you don't lose anything if Safari reloads.
