# Pitches — repo map

> **One repo, one website, one `index.html` — but two unrelated things live inside it.**
> This file exists so future-you never has to wonder "which app is this?" again.

| | 🎮 The game | 🧪 The experiment |
| --- | --- | --- |
| **Name** | **Pitches** (NYT-mini-style daily music games) | **Testing Battery** (48-hour visual-deprivation study) |
| **Who it's for** | Friends | Just the study — nobody else sees it |
| **URL** | `https://pitch-trainer-rho.vercel.app` | `https://pitch-trainer-rho.vercel.app/?battery=1` |
| **Data** | Supabase (accounts, leaderboard, comments) | **Local only** — browser IndexedDB + JSON backups to Downloads. Never touches Supabase. |
| **Status** | Active development | **Paused** (not collecting right now) |

They share **only** the shell (`index.html` + the `app.js` tab router). No shared data, no shared logic. The battery is a **hidden tab** — friends on the normal URL never see it.

---

## 🎮 Door 1 — Pitches (the friends game)

Open the normal URL. Three sections on the home screen:

- **Today's picks** (scored, on the leaderboard): Compound Leap, Guess Who, JND
- **Need help focusing?**: Practice (a calm timed routine)
- **Other games** (practice, not scored): Quarter-tones keyboard, On or Between

Google sign-in (or a local guest profile), daily streaks, an activity calendar, a cumulative "Overall" leaderboard + per-game boards with trash-talk comments.

**Key files:** [hub.js](hub.js) (home, profiles, streaks, calendar, board) · [dailygames.js](dailygames.js) (Compound Leap, Guess Who + its hints) · [guesswho-clips.js](guesswho-clips.js) (the daily tune puzzles) · [microtone.js](microtone.js) (Quarter-tones + On or Between) · [social.js](social.js) + [supabase-config.js](supabase-config.js) + [db/](db/) (backend) · `clips/` (Guess Who audio).
See [GAMES.md](GAMES.md) and [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

---

## 🔒 The Lab (hidden dev area — password `temp`)

The home screen has a `🔒 Lucas's Lab` button. Behind the password are the **original ear-training trainers** ([learn.js](learn.js), [practice.js](practice.js), [tune.js](tune.js), [yesno.js](yesno.js), [apgames.js](apgames.js), [stats.js](stats.js)) **and** the Testing Battery. This is the "somewhat discreet location" the battery lives in — plus the deep link below.

---

## 🎯 Daily Calibration (Lucas only — not part of the game)

A private ~6-minute daily AP primer that is also an instrument: every trial is logged on-device, difficulty adapts across days, and randomized contrasts inside each session estimate *how* notes are being named (relative-pitch leak, hidden anchor, timbre lock, register cues…). Friends never see it — **triple-tap the "Pitches" title → `1234`**, or `…/?calibrate=1`. Full protocol, data fields and analysis handoff: **[CALIBRATION.md](CALIBRATION.md)**.

**Key files:** [calibrate.js](calibrate.js) (the routine + "ear model" screen) · [calibrate-data.js](calibrate-data.js) (storage, `analyze()`, adaptive `makePlan()`) · [db/calibration.sql](db/calibration.sql) (optional private cloud backup). Exports go in `calibration-data/` (gitignored).

---

## 🧪 Door 2 — The Testing Battery (the study)

A standardized auditory measurement suite meant to be run many times across a ~48-hour visual-deprivation experiment, then exported. Full operating manual: **[BATTERY.md](BATTERY.md)** — read it before a real run.

**How to open it:**
- Run a session: `https://pitch-trainer-rho.vercel.app/?battery=1`  ← bookmark exactly this
- Results dashboard: `…/?battery=1&admin=1` (don't open mid-experiment)
- Standalone Working Memory re-run: `…/?wm=1`
- From inside the app: Lab (password `temp`) → 🧪 Testing Battery

**⚠️ The one rule that protects the data:** it lives only in the browser, scoped to the exact origin. **Run every session on the same URL, same browser (Chrome), same computer** — always `https://pitch-trainer-rho.vercel.app/?battery=1`. A different Vercel preview URL is a different, empty database. Each session also auto-drops a JSON backup into Downloads; keep them.

**Key files:** [battery.js](battery.js) · [battery-core.js](battery-core.js) · [battery-audio.js](battery-audio.js) · [battery-tasks.js](battery-tasks.js) · [battery-results.js](battery-results.js) · [wmsolo.js](wmsolo.js) (standalone Working Memory).

> Because the game and the battery share one deployment, pushing game changes redeploys the same site. That's safe when the experiment is **paused** (the current state). If a run is ever **active**, freeze game pushes for its duration — the stable `pitch-trainer-rho.vercel.app` alias + IndexedDB survive redeploys, but don't tempt fate mid-study.

---

## Tech & local dev

Vanilla JS, ES modules, **no build step**. Libraries (`tone`, `pitchy`, `@supabase/supabase-js`) load from `esm.sh` at runtime. Deployed on Vercel (auto-deploys from GitHub `main`).

```bash
python3 -m http.server 8000   # then open http://localhost:8000/ in Chrome
```

Needs HTTPS or `localhost` (mic + Web Audio won't work over `file://`). Use **Chrome** — Web MIDI is Chrome-only, and Safari can evict local storage, which matters for the battery.

## Other docs
- [BATTERY.md](BATTERY.md) — the experiment's full operating manual
- [GAMES.md](GAMES.md) — the game's design notes
- [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — backend setup
- [PLAN.md](PLAN.md) — older planning notes
