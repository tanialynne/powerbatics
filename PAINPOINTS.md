# Why I built this — pain points with the current custom-program page

I've been paying for a custom coaching program for 4+ months and rarely actually do the exercises as listed — not because I don't want to, but because the delivery format makes it hard. Here's everything that went wrong every time I tried to use it.

## Structure & navigation
- **One endless page for the entire week.** I have to scroll past every day to find today's workout. No "today's workout" view.
- **No sense of progress inside a day** — I can't track anything and I like to click that I finished something. 
- **Losing my place is automatic** — come back later, you're back at the top.

## Reliability
- **The page reloads itself** mid-workout and I lose my spot.
- **Videos intermittently fail to load** Only fix is refresh, which makes it worse.
- **Screen goes to sleep** between sets, and when it wakes up, the whole page often has to reload or moved back up to the top. 
- **No persistence** — every visit is a cold start. The page doesn't remember what day I did last, which exercise I was on, nothing.

## Audio / multitasking
- **Video audio auto-plays** and interrupts my music, podcast, or Audible the second a video starts — even though the videos have no voiceover or instruction that requires audio.
- **No way to mute globally.** I have to manually mute each video every time.

## Video UX
- **Fullscreen button is tiny** — hard to hit on a phone mid-movement, and iOS's fullscreen gesture is unreliable through an iframe.

## "It's not actually an app"
- **Can't install to my home screen.** I have to keep a Safari tab open or re-navigate to a bookmark.
- **Tab can't be backgrounded** for long without the page forgetting everything.
- **Doens't work offline** or on weak Wi-Fi.
- **No notifications** of any kind.

## Training features that simply aren't there
(And that Fitbod / Movement Athlete / every half-decent gym app has.)

- **No way to log a set.** Not reps, not weight, not hold time, nothing.
- **No history.** I can't see what I did last time for any given exercise.
- **No progression tracking.** Goal is "horse stance 2-minute hold" — how close am I? Nobody knows. Not even my coach.
- **No rest timer.** I either guess or open a separate stopwatch app.
- **No hold timer** for exercises that are literally timed holds.
- **No "last time" reference** at the point of doing the exercise — so I can't know whether I'm beating or matching my previous session.
- **No RPE / "how did it feel"** capture, even though that's the single most useful signal a coach can get.
- **No streak, no calendar, no momentum.** The absence of these is why I stopped showing up.

## Coach collaboration
- **No feedback loop.** My coach has no way to see what I actually did this week.
- **Sending a form-check video** means opening WhatsApp separately, typing the exercise name from memory, then attaching the video. Friction I won't do when I'm mid-workout.
- **When the coach updates my program**, I have no indication of what changed — I'd have to compare page-to-page by hand.

## Discovery / change management
- **No versioning.** Program updates just silently replace the old content.
- **No "what's new this week"** summary.
- **No backup.** If the page moves or the link rots, my program is gone.

---

## What the app fixes

- Day-by-day, exercise-by-exercise flow. Today's workout is one tap from the home screen.
- Installs as a real app icon. The app shell works offline — navigation, logging, timers, history — though video playback still needs a connection (Vimeo streams on demand).
- Videos muted by default — my music keeps playing.
- Big one-tap fullscreen that works the same on iPhone, iPad, Android.
- Sets logger (reps or seconds for holds), rest timer, hold timer, RPE, per-exercise history, streaks, and a 14-day calendar strip.
- Coach-share in one tap: a formatted WhatsApp summary of the day, or a form-check link prefilled with the exercise name — no typing.
- **Refresh button** pulls the latest program directly from the coach's WordPress page. Shows me what changed (N new, N removed, N videos updated). No one has to move to a new tool.
- Logs stay on my device by default, so nothing changes for the coach — but if there's interest, coach-visible logs and a weekly dashboard are a small next step.
