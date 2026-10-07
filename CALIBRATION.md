# Daily Calibration — protocol & data reference

Private to Lucas. Not part of the friends' game: nothing here touches scores, leaderboards, streaks or the social tables.

## Getting in

| Where | How |
| --- | --- |
| Home screen (any device) | **Triple-tap the "Pitches" title** → password `1234` |
| After unlocking once | a `🎯 Calibrate` link appears under the home cards — **on that device only** |
| Bookmark | `https://pitch-trainer-rho.vercel.app/?calibrate=1` |

On iPhone, the home-screen app and the browser keep **separate storage**. Pick one and stick to it, or turn on the cloud backup so exports merge both.

## The session (~6 min, 8 stations)

0. **Check-in**: energy, music heard today, headphones vs speaker.
1. **Attune**: soak the home note (C).
2. **Imagine it**: hear a named note internally, then (optionally) **sing it into the mic** → signed cents error vs the target.
3. **Anchor lock**: "is this C?" after a palette cleanser, so you're comparing to *long-term* C rather than the echo of the last one.
4. **Hold it**: keep a pitch alive through an escalating noise bed, then same/different.
5. **Blindfold naming**: the diagnostic core (see below).
6. **Octave twins**: three notes in three octaves; which name is the odd one out (chroma vs height).
7. **Find the note**: "there's an E♭ in this chord — bottom, middle or top?"
8. **Lock it in**: your weakest notes + their song cue.

### The palette cleanser
A quiet scatter of random atonal notes before each absolute trial. Intervening *tones* (not noise) disrupt pitch working memory (Deutsch), so it wipes the last note you were told the name of, and you can't count from it.

### Embedded experiments (why the data can reveal mechanism)
Inside every session, Blindfold naming randomizes conditions **within subject, stratified**:

| Manipulation | Share | Isolates |
| --- | --- | --- |
| Cleanser **skipped** | ~30% | relative-pitch leak (do you compute from the last labeled note?) |
| **Sine** tone instead of piano | ~20% of cleansed trials | timbre-bound vs general memory |
| Octave drawn from a level-dependent set | all | register/height cues |

These proportions stay **fixed across levels**, so the indices remain comparable over weeks.

## The living part (adaptation)
`makePlan()` in [calibrate-data.js](calibrate-data.js) builds each session from your whole history:

- **Per-station level 1–5**, a staircase across days: a session at ≥80% raises it, ≤50% lowers it. This is recomputed from history every time, so there's no separate state to drift. Levels change hold length (2→18 s), anchor lure distance (big jumps → semitone neighbors), naming octave spread (1 → 5 octaves), twins offsets (5ths → semitones), and triads (root position → inversions → dim/aug → spread voicings).
- **Weak notes oversampled**: per-note error rate (Beta-smoothed, last 150 naming trials) weights which notes you get in Imagine / Naming / Lock-in.
- **Trial budget**: your weakest station over the last 3 sessions gets +2 trials and the strongest gets −1.

## Data

Everything is written the instant a trial completes, to IndexedDB `pitches-calibration` (with a localStorage fallback). Each session's plan, check-in, environment and summary are saved alongside its trials. Partial sessions are kept.

**Export:** Calibrate → 📊 Your ear model → **Export JSON** (full bundle + analysis) or **CSV** (one row per trial, nested fields flattened to `stim_*` / `sing_*`). On iPhone it opens the share sheet → AirDrop to the Mac.

**Optional cloud backup:** sign in, then run [db/calibration.sql](db/calibration.sql) once in Supabase. It's a private `cal_rows` table where row-level security means only your login can read or write your rows. Tap ☁️ Back up, or it syncs automatically after each session. Exports merge cloud + device.

### Trial fields
Common: `id, sessionId, station, ti (trial # in station), gi (# in session), t (epoch ms), hour, dow, level, correct (true/false/null), rt (ms from choices shown → tap), schema`.

| station | `stim` | other |
| --- | --- | --- |
| attune | `pc, reps` | `durMs, skipped` |
| imagine | `pc, secs` | `resp` (`sung`/`nailed`/`off`), `sing {ok, hz, midi, cents, oct, frames \| reason}` |
| anchor | `pc, isAnchor, offset, oct` | `resp` yes/no |
| hold | `pc, dur, same, probeOffset` | `resp` same/diff |
| name | `pc, oct, midi, wash, timbre, prevMidi, prevPc, prevInt` | `resp` (pc), `errSemis` |
| twins | `a, b, offset, octs, oddSlot, notes` | `resp, replays` |
| triad | `rootPc, quality, inversion, spread, chord, targetPc, posIdx` | `resp, replays` |
| lockin | `pc, weight` | — |

## What `analyze()` estimates
Validated against simulated listeners in `tools/test-cal-analysis.mjs`. It recovers a relative-pitch cheater, a hidden "count from E" anchor, timbre-locking, and gives true AP a clean bill.

| Index | Method | Reads as |
| --- | --- | --- |
| Relative-pitch leak | acc(no cleanser) − acc(cleanser), 95% CI; plus perseveration (wrong answer = previous note) | >0 → computing from the last note |
| Hidden anchor | RT ~ circular distance from each of 12 candidates; best fit + permutation p | positive slope at note X → counting from X; flat → direct recognition |
| Gut vs compute | median RT correct vs wrong; % fast (<1.5 s) correct | fast + right = categorical |
| Timbre lock | piano − sine accuracy | >0 → piano-bound memory |
| Register cues | accuracy spread across octaves | large → using height, not chroma |
| Chroma | octave-twins accuracy by offset | — |
| Pitch memory | hold accuracy vs seconds | decay rate |
| Inner pitch | sung signed cents bias / abs error | template sharp/flat drift |
| Anchor precision | hit rate; false alarms by distance from C | how sharp the anchor is |
| Confusions | top true→answered pairs, by kind; mean signed error | semitone neighbors vs tonal (4th/5th) confusions |
| Context | time of day, energy, music today, warm-up (1st vs 2nd half) | when your AP is best |

## Analysis handoff (for Claude, when asked)
1. Export JSON from the device you use (or from the Mac browser if cloud backup is on). Drop it into `calibration-data/` in this repo, which is gitignored and never committed.
2. Ask Claude to "analyze my calibration data." The plan is:
   - check data quality: sessions completed, trials per condition, RT outliers;
   - re-fit the indices with proper models (mixed-effects logistic on correctness with cleanser × timbre × octave, random intercept per session; RT models on correct trials);
   - look for structure the on-device indices can't see: confusion asymmetries, per-note drift over weeks, interaction of cleanser with distance-from-anchor, learning curves per station, time-of-day × energy;
   - write down the **current best model of how Lucas is producing pitch names** (e.g. "anchors on E, computes up to a 4th, guesses beyond; timbre-general; register-dependent above C5");
   - design **new stations** that either *force* a different mechanism (e.g. shorter response deadlines to starve computation, cleanser + random register to kill height cues) or *diagnose* an open question. Add them with their own randomized contrasts so the next export can test whether they worked.
