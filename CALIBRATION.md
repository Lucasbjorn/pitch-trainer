# AP Training Hub — protocol & data reference

Private to Lucas. Not part of the friends' game: nothing here touches scores, leaderboards, streaks or the social tables.

## Getting in

| Where | How |
| --- | --- |
| Home screen (any device) | **Triple-tap the "Pitches" title** → password `1234` |
| After unlocking once | a `🎯 Calibrate` link appears under the home cards — **on that device only** |
| Bookmark | `https://pitch-trainer-rho.vercel.app/?calibrate=1` |

You land on the **Training Hub**, which has three parts:
- **Daily Calibration** card: the clean daily reading.
- **Coach** card: the suggested next drill and why.
- **8 drills.**

**Account sync:** sign in with Google once on each device (from the hub's ☁️ card). After that, the phone, the laptop and the iPhone home-screen app all share one dataset (see *Account sync* below).

## Daily Calibration — protocol v3 (~7 min, 8 stations + ⚓ pop-ups)

0. **Check-in**: energy, music heard today, headphones vs speaker.
1. **Attune**: today's note → its PP-MIDI song tag → note, three times.

**Today's note (daily anchor).** The anchor rotates: each day it's your weakest note that hasn't been the anchor in the last 11 days, so all 12 get a turn every 12 days, weakest first. "Weakest" is computed only from trials before today, so it can't drift mid-day. Once a calibration records it, it sticks for that day. A hub toggle switches back to "always C." Attune and Anchor lock use it, and sessions/trials record `anchorPc`.
2. **Song anchors**: learn your 2 weakest notes (note · tag · note), then recall trials:
   - **tag → note**: hear the PP-MIDI cue, name the note;
   - from L2, also **bare note → tag**: hear the plain piano note, recall its tag, name it. This is the bridge to real AP.
3. **Imagine it**: hear a named note internally; optionally sing it (mic → signed cents).
4. **Blindfold naming**: the diagnostic core (below).
5. **Hold it**: keep a pitch alive for 3–16 s, then same/different by **60¢ → 12¢**. Half the holds play **stray notes** in the gap, half play noise.
6. **Octave twins**: three notes in three octaves; which one has a different note name?
7. **Find the note**: "there's an E♭ in this chord — bottom, middle or top?" Higher levels add inversions, then dim/aug, then spread voicings.
8. **Lock it in**: your weakest notes, note · tag · note.

**Every answer, in every station, ends with note · song tag · note.** The tags are 0.74 s, so this costs little time. Ending on the labeled note keeps the "last heard note" clean for the relative-pitch test.

**⚓ Anchor pop-ups (v3).** "Is this exactly today's note?" is no longer a block. Back to back, the answer was easy: you could still hear the anchor from the previous question. Instead it pops up at random:
- **In the calibration:** 5 checks (7 when anchor is the focus) at random points between other stations' questions, never back to back, and not in the first two questions.
- **In every drill:** after at least 3 questions, a 22% chance per question.
- **Scoring:** a pop-up keeps the host drill's header, hides ⏫/⏬, and doesn't count toward the drill's stats.
- **Logged:** each pop-up records `popup, host` (what it interrupted), `sinceAnchorMs` (time since you last *heard* the anchor), and `trialsSinceAnchor`. Together these measure **how long today's note survives in memory**.
- Lures are in cents and tighten with level (±300¢ … ±30¢). There is no standalone Anchor lock drill anymore.

**Pacing and responses (v3).** Lucas's notes: a game replayed the just-answered note straight into the next question (a forced relative-pitch shortcut), some games had no replay, and you couldn't answer the moment you knew. Now:
- **Breather:** 0.7 s of silence before each question's first sound.
- **Song anchors** use the cleanser at every level. That station was the culprit: at L1–2 the next tag followed the last note directly.
- **Blindfold naming**'s deliberate no-cleanser trials (the relative-pitch test) get a **1.8 s** gap, logged as `preGapMs`.
- **▶ replay (1×)** in Blindfold naming, Neighbors, In tune?, anchor pop-ups and Song anchors. It's logged as `replays`. Hold it gets none, since a replay would defeat the memory test.
- **Answer the instant you know:** buttons are armed at **note onset**, and RT is measured from onset (`rtFrom: "onset"`). Before v3 the buttons were visible but dead until a fixed delay passed, a CSS bug where `display` overrode `[hidden]`; that's now fixed.
- ✕ / ⇄ unwind immediately even mid-feedback, with no stray notes.

**Version history:**
- **v1** (first week): no Song anchors station, tags only at the end, hold = ±1 semitone through noise, anchor lures in whole semitones, always C.
- **v2:** Song anchors, cents-level hold/anchor, rotating daily anchor, tuning-cue fixes.
- **v3:** pop-ups, pacing, replay, RT from onset.

Every record carries its `protocol`. Compare like with like.

### The palette cleanser
A quiet scatter of random atonal notes before each absolute trial. Intervening *tones* (not noise) disrupt pitch working memory (Deutsch), so it wipes the last labeled note and you can't count from it.

**Tuning-critical trials have no hidden cues** (protocol v2.1: In tune?, Hold it, and Anchor lock at cent-level lures). Lucas spotted that off notes were easy. There were two leaks:
1. The cleanser played *in-tune* notes, giving a tuning grid to judge the next note against.
2. Detuned piano samples sound subtly "processed."

The fixes:
- These trials use a **detuned cleanser** (each scatter note randomly ±50¢), so no grid is left behind.
- In-tune and off notes are played by the **same synth voice**: a random pick of triangle / sine / fmsine / amtriangle, at ±2 dB. No sample repitching, so pitch is the only difference.
- `stim.voice` is logged on every one of these trials.

### Embedded experiments (why the data can reveal mechanism)
Conditions are **stratified-randomized within each block**, in calibration and drills alike:

| Station | Manipulation | Share | Isolates |
| --- | --- | --- | --- |
| Naming | cleanser **skipped** | ~30% | relative-pitch leak |
| Naming | **sine** instead of piano | ~20% of cleansed | timbre-bound vs general memory |
| Naming | octave from a level-dependent set | all | register / height cues |
| Hold it | **stray notes** vs noise in the gap | 50/50 | holding the *sound* (echoic) vs the *name* (labeled) |
| Anchor / In tune | target vs lure | 50/50 | template precision |

These proportions don't change with level, so the indices stay comparable over weeks.

## Drills
Each skill also runs as an **endless adaptive drill**, launched from the hub, the coach, or "Keep training" after a calibration.
- **In-drill staircase:** 3 right in a row → level up; 2 of the last 3 wrong → level down.
- **😴 too easy / 😵 too hard:** move one level immediately. Logged as events — this is data too.
- **✕** ends the drill (shows a summary plus the coach's next pick); **⇄** switches drills mid-trial.
- Drill levels are stored per skill (`pt.cal.drillLv`) and start from the calibration level. Drills **never** change calibration levels.
- **In tune?** is drill-only: is this note exactly on a pitch, or ±50¢ → ±10¢ off?
- **Triangulate 🧭** (drill-only): hear a mystery note, then **imagine an assigned anchor** and find the note from it.
  - Anchors are stratified so each of the 12 comes up once per 12 trials, which shows which mental anchors work best for you.
  - Levels widen the anchor→target distance (±2 → ±6 semitones) and the octave spread, and shorten imagery time.
  - Feedback plays the real anchor → target, then the tag.
- **Neighbors 👯** (drill-only): "Is this E♭ or D?" Next-door chroma with no reference.
  - Levels go whole step → semitone → more octaves → random synth timbres → 0.5 s notes.

## The coach (`suggestDrills` in [calibrate-data.js](calibrate-data.js))
Rule-based, from your data:
- No calibration today → **calibrate first.**
- Otherwise each skill is scored:
  - base score: 1 − accuracy over the last 3 days;
  - **+** if it hasn't been drilled in 2 days;
  - **−** if you drilled it in the last 20 minutes, or flagged it "too easy" today.
- Mechanism flags raise a skill and become its stated reason:
  - relative-pitch leak → Blindfold naming;
  - hidden anchor → naming;
  - timbre lock → naming;
  - stray notes wreck your holds → Hold it;
  - weak notes → Song anchors.

## Doing it several times a day
Every run is stamped with `localDate` and `sessionOfDay` (1, 2, 3…).
- **Daily progress uses the first completed calibration of each day** (the cold, unpracticed reading). Later runs are practice and show up separately ("run of the day" in context).
- **Calibration levels move at most one step per day:** that day's runs are pooled, then ≥80% → up, ≤50% → down.
- Mechanism indices use all trials. The contrasts are randomized within trial, so more trials = more power, not bias.

## The adaptive program (`makePlan`)
- **Per-station level 1–5** from the per-day staircase above. One table (`paramsFor`) drives calibration and drills:
  - hold cents and length;
  - anchor lures;
  - naming octave spread;
  - twins offsets;
  - triad inversions;
  - song-anchor choices (4 → 6 → 12, then bare-note recall, then cleanser);
  - imagery prep time;
  - in-tune cents.
- **Weak notes oversampled:** Beta-smoothed error over the last 200 naming + song-anchor trials.
- **Budget:** the weakest station over the last 3 calibrations gets +2 trials, the strongest −1.

## Data
Everything is written the instant a trial completes, to IndexedDB `pitches-calibration` (with a localStorage fallback). Partial calibrations and every drill are kept. Old v1 records are read as-is (no migration needed).

**Export:** Hub → 📊 Your ear model & data → **Export JSON** (full bundle + analysis) or **CSV** (one row per trial; nested fields flattened to `stim_*` / `sing_*`). On iPhone it opens the share sheet → AirDrop to the Mac.

## Account sync (phone ↔ laptop)
**Setup:** none beyond signing in. On each device, open the hub → ☁️ **Sign in with Google**. You'll come straight back to the hub. Your Pitches profile (name + photo) must exist, which it already does if you've used the main app.

**Where the data lives:** no extra table and no SQL. Sync rows are packed (40 per record) into **private self-addressed records** in the app's existing `messages` table, with sender = recipient = you. That table's row-level security only lets a row's sender or recipient read it, so only your login can see them. They're tagged `CALSYNC1` and filtered out of every DM view. The server sets `created_at`, which makes incremental pulls reliable.

How it works:
- **Local first.** Everything is written to the device's IndexedDB instantly, so training works with no signal and syncs when you're back online.
- **When it syncs:** opening the hub pulls then pushes; every finished calibration or drill syncs again; during a run, trials trickle up every ~45 s.
- **Push:** this device's own records, changed since its last push. The store is append-only, so an updated session is simply re-sent and the newest version wins.
- **Pull:** every record the server stored since this device's last pull.
- **No sync loops.** Pulled records carry an internal `_pulled` flag and are never pushed back. A device never overwrites its *own* sessions with cloud copies.
- **Follows you across devices:** drill levels (from the latest drill session of each skill, on any device), the streak (calibration days from any device), the coach and the ear model.
- **Device tags.** Every session carries `device {id, kind: phone|desktop}`, so the analysis can compare phone vs laptop.
- **Tested:**
  - `tools/test-cal-dmstore.mjs`: the adapter against a mock Supabase that enforces the real RLS. Checks chunking, incremental and paged pulls, that DMs and other users' rows never leak in, and that the DM views stay clean.
  - `tools/shot-sync.mjs`: two simulated devices sharing a fake server. Each device's runs appear on the other, levels follow, idle re-syncs upload nothing, and pulled rows are never re-uploaded.
- Export pulls first, so it includes every device.
- **Tested** with two simulated devices sharing a fake server (`tools/shot-sync.mjs`):
  - each device's runs appear on the other, and levels follow;
  - idle re-syncs upload nothing;
  - pulled rows are never re-uploaded.

### Sessions
- Calibration: `kind: "calibration", protocol, localDate, sessionOfDay, dayIndex, checkin, plan, summary {skill:{n,k}}, completed, durSec, env, device {id, kind}`
- Drill: `kind: "drill", skill, startLevel, endLevel, events [{t, type: tooEasy|tooHard|autoUp|autoDown, from, to, atTrial}], n, graded, k, bestStreak, endReason (end|switch|exit), durSec`
- v1 sessions have no `kind` and count as calibrations.

### Trials
Common fields: `id, sessionId, mode (calibration|drill), protocol, station, gi, ti, t, hour, dow, level, correct (true/false/null), rt (ms from choices shown → tap)`.

| station | `stim` | other |
| --- | --- | --- |
| attune / lockin | `pc` | — |
| cue | `pc, kind (learn / cue2note / note2cue), choices, cleansed` | `resp` |
| imagine | `pc, secs` | `resp` (sung / nailed / off), `sing {ok, hz, midi, cents, oct}` |
| anchor | `pc, anchorPc, isAnchor, offsetCents, oct, voice` (v1: `offset` semitones, anchor always C) | `resp` yes/no |
| name | `pc, oct, midi, wash, timbre, prevMidi, prevPc, prevInt` | `resp, errSemis` |
| hold | `pc, dur, same, probeCents, interference (noise/tones), distractors, voice` (v1: `probeOffset`) | `resp` |
| twins | `a, b, offset, octs, oddSlot, notes` | `resp, replays` |
| triad | `rootPc, quality, inversion, spread, chord, targetPc, posIdx` | `resp, replays` |
| tune | `pc, oct, inTune, cents, voice` | `resp` in/off |
| tri | `anchor, target, dist, oct, midi` | `resp, replays, errSemis` |
| pair | `pc, pair [lo, hi], step, oct, timbre, dur` | `resp` |

## What `analyze()` estimates
Validated against simulated listeners in `tools/test-cal-analysis.mjs`, which has 23 checks.

| Index | Method | Reads as |
| --- | --- | --- |
| Daily reading | first completed calibration per day; slope per day | real progress, not same-day practice |
| Relative-pitch leak | acc(no cleanser) − acc(cleanser), 95% CI; perseveration | >0 → computing from the last note |
| Hidden anchor | RT ~ distance from each of 12 notes; permutation p | slope at X → counting from X; flat → direct recognition |
| Gut vs compute | median RT correct vs wrong; % fast-correct | fast + right = categorical |
| Song anchors | tag→note vs bare-note→tag accuracy, per note | association strength; the bare direction is the AP bridge |
| Hold it | noise − stray-notes accuracy (tone-interference cost); accuracy by cents | big cost → holding the sound, not the name |
| In tune? | accuracy by cents off | tuning-template resolution |
| Mental anchors | Triangulate accuracy + RT per imagined anchor; by distance | which internal reference notes you can actually use |
| Neighbors | accuracy per next-door pair; semitone vs whole step | which chroma boundaries are muddy |
| Timbre lock | piano − sine | >0 → piano-bound |
| Register cues | accuracy spread across octaves | height vs chroma |
| Chroma | octave twins by offset | — |
| Inner pitch | sung signed cents bias / abs error | template drift |
| Anchor precision | hit rate (per anchor note); **by time since last heard** (<1 min / 1–5 min / >5 min); pop-up vs old block; false alarms by lure cents | how sharp each daily anchor is, and how long it lasts |
| Confusions | top true→answered pairs; mean signed error | semitone vs tonal confusions |
| Context | time of day, energy, music today, run of the day, mode, device (phone vs laptop), warm-up | when your AP is best |

## Analysis handoff (for Claude, when asked)
**Standing brief from Lucas:** after about a week of data, don't wait to be told what's too easy. Find stations or levels at ceiling (or flagged 😴 too easy), **diagnose why**, and design a creative fix.

The usual cause is a cue leak that lets a non-AP strategy pass. Examples so far:
- the anchor echo in a back-to-back block;
- an in-tune cleanser that left a tuning grid;
- detuned piano samples that sound "processed";
- the last note replayed straight into the next question.

Check ceiling accuracy, RT distributions, replay use and "too easy" events by station × level × protocol.

1. Export JSON (from the device you use, or the Mac browser if the cloud backup is on). Drop it into `calibration-data/` in this repo; that folder is gitignored and never committed.
2. Ask Claude to "analyze my calibration data." The plan:
   - check data quality per protocol version: sessions, trials per condition, RT outliers, v1/v2 split;
   - fit mixed-effects models (correctness ~ cleanser × timbre × octave, plus hold interference × cents; random intercept per session and per day) and RT models on correct trials;
   - use the cold-reading series for learning curves, and the drill logs for within-day practice effects and what "too easy" really meant;
   - write down the **current best model of how Lucas produces pitch names** (e.g. "anchors on E, computes up to a 4th, tag recall strong for C/E/G but weak for sharps, holds the name not the sound");
   - design **new stations/drills** that force a different mechanism or test an open question, each with its own randomized contrast, so the next export shows whether it worked.
