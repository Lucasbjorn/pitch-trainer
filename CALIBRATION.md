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

## Daily Calibration — protocol v5 (~9 min, 10 stations + ⚓ pop-ups)

0. **Check-in**: energy, music heard today, headphones vs speaker.
1. **Attune**: today's note → its PP-MIDI song tag → note, three times.

**Today's note (daily anchor).** The anchor rotates: each day it's your weakest note that hasn't been the anchor in the last 11 days, so all 12 get a turn every 12 days, weakest first. "Weakest" is computed only from trials before today, so it can't drift mid-day. Once a calibration records it, it sticks for that day. A hub toggle switches back to "always C." Attune and Anchor lock use it, and sessions/trials record `anchorPc`.
2. **Song anchors**: learn your 2 weakest notes (note · tag · note), then 3 recall trials, all **bare note → tag** since v5: hear the plain piano note, recall its tag, name it. (Tag → note was 95% in 1.7 s: recognizing the *song* gives the name whatever its pitch. It stays in the drill at L1 for learning the tags.)
3. **Tag at home?** (v5): 4 tags, half shifted — is it at its real pitch? (see *Drills*)
4. **Inner tuner** (v5): 4 imagine-then-judge questions (see *Drills*). Replaces *Imagine it*, which is now drill-only; the tuner measures the same internal template without a mic.
5. **Blindfold naming**: the diagnostic core (below). **10 questions since v5** (was 6–8): 6 **core** (middle octave, piano, cleanser, cold note — exactly the "same test every day" condition, logged `core: true`) + 4 from the usual randomized mix (no-cleanser, pure tone, octave spread).
6. **Neighbors** (v4): 4 next-door questions (see *Drills*). It joined the calibration because it measures chroma with no reference in any octave and timbre, which you can't fake with your vocal range. Its calibration level starts one step below where the Neighbors drill had got to, not at L1.
7. **Hold it**: keep a pitch alive for 3–16 s, then same/different by **60¢ → 12¢**. Half the holds play **stray notes** in the gap, half play noise.
8. **Octave twins** (3 since v5): three notes in three octaves; which one has a different note name?
9. **Find the note** (3 since v5): "there's an E♭ in this chord — bottom, middle or top?" Higher levels add inversions, then dim/aug, then spread voicings.
10. **Lock it in**: your weakest notes, note · tag · note.

**Every answer, in every station, ends with note · song tag · note.** The tags are 0.74 s, so this costs little time. Ending on the labeled note keeps the "last heard note" clean for the relative-pitch test.

**⚓ Anchor pop-ups (v3).** "Is this exactly today's note?" is no longer a block. Back to back, the answer was easy: you could still hear the anchor from the previous question. Instead it pops up at random:
- **In the calibration:** 5 checks (7 when anchor is the focus) at random points between other stations' questions, never back to back, and not in the first two questions.
- **In every drill:** after at least 3 questions, a 22% chance per question.
- **Scoring:** a pop-up keeps the host drill's header, hides ⏫/⏬, and doesn't count toward the drill's stats.
- **Logged:** each pop-up records `popup, host` (what it interrupted), `sinceAnchorMs` (time since you last *heard* the anchor), and `trialsSinceAnchor`. Together these measure **how long today's note survives in memory**.
- ≤v4: lures were in cents and tightened with level (±300¢ … ±30¢). There is no standalone Anchor lock drill anymore.
- **v5 (Lucas: "too focused on being out of tune"):** 50/50 **today's note or a different note**, played on piano, no cents. Lures are ≥3 semitones away at L1, ≥2 at L2–3, and from L3 a share are semitone neighbors (25% → 50%); octaves spread with level. **Say "no" and you name the note** (12 keys) or tap **🤷 not sure**. Logged: `lureKind: "note"`, `lureSemis`, `offsetCents` (= semitones × 100, so old cent-based summaries still read), `guess` (pc or "idk"), `guessCorrect`, `rtGuess`. Analysis keeps versions apart: `anchorLock.current` (note lures, + guesses and false alarms by semitone distance) vs `anchorLock.cents` (≤v4); the scorecard has a row for each.

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
- **v4:** Neighbors station in the calibration; Neighbors trios (three next-door notes, names shown only once the note sounds); coach weights Neighbors up.
- **v5:** cold draws; naming core (10 naming per calibration); Song anchors bare-only in the calibration; new games Gut & check, Inner tuner, Tag at home?, Name or hold?; anchor pop-ups use whole-note lures + "which note?"; Imagine → drills; Triangulate retired.

Every record carries its `protocol`. Compare like with like.

**Cold draws (v5) — why and how.** The Oct 13 review found Neighbors was riding on short-term memory: every answer ends with its note named (note · tag · note), and with 12 notes cycling, the next question's answer had often just been heard. Answer heard named in the last minute → 78% (25/32); not → 50% (30/60).
- A question is **warm** if any of its notes (the target; for Neighbors every choice) was heard *with its name showing* in the last 60 s (`WARM_MS`); otherwise **cold**.
- **Cold draw:** naming, Neighbors, Gut & check, Inner tuner and Tag at home pick a cold note when one exists (Neighbors: a cold *target* first, then a position whose other choices are cold too). With no cold option it takes the **stalest**.
- **Policy:** always cold in the calibration; **75% cold / 25% free** in drills, so the warm-vs-cold contrast stays measurable.
- **Logged** on every such question: `stim.draw` (cold | free), `stim.warm`, `stim.warmAgoMs` (ms since the freshest of its notes was heard named; null = not this session), and for Neighbors `stim.targetWarm`.

**Comparing across protocols (how v5 data meshes with older data).**
- Nothing old changes meaning; v5 only adds fields. Every record has `protocol`, and the ear model marks ◆ on the first day of each protocol.
- **Warmth is one definition for all data:** v5 logs it; for v3.5–v4 sessions (which saved a `soundLog`) `warmOf()` rebuilds it from the log with the same 60 s rule; older trials are "unknown" and stay out of cold-only numbers. The Neighbors headline and its scorecard row are cold-only (old rebuilt + new logged, pooled).
- **The progress line is unchanged:** naming in octave 4, piano, cleanser on. v5's core questions meet that definition exactly, so they extend the old line (6 a day instead of ~3). Naming accuracy barely moved with warmth (71% vs 69%), so cold core targets shouldn't create a step; check `fixedNaming.cold` vs `.warm` if one appears.
- **Song anchors are split by direction everywhere** (`kind`: cue2note vs note2cue). The calibration's overall song score drops in v5 because it's now all the hard direction — compare `noteToCue` across protocols, not the station total.
- **Daily cold reading** (overall calibration accuracy) changes composition whenever stations change; read it within a protocol (◆ marks).
- Retired/moved stations keep their old data: Triangulate (drills ≤ v4), Imagine in the calibration (≤ v4).

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
- **Check-in every 12 questions:** a card with this set's accuracy, level and best streak, plus **this drill's score over time** (daily accuracy bars, all runs, today highlighted, and level history). Choices:
  - **Keep going**;
  - **⇄ Next: [coach's pick]**, with the reason, which jumps straight into it;
  - **📊 Full ear model**.

  Each choice is logged as a drill event `{type: "checkpoint", choice: go|next|history, atTrial, accSoFar}`. The drill's `endReason` becomes `next` or `history` when used.
- Drill levels are stored per skill (`pt.cal.drillLv`) and start from the calibration level. Drills **never** change calibration levels.
- **In tune?** is drill-only: is this note exactly on a pitch, or ±50¢ → ±10¢ off?
- **Triangulate 🧭** — **retired in v5.** It asked you to imagine an assigned anchor and find a mystery note from it. Exact accuracy was 31% vs 64% for plain naming (p≈.002) with the same ±1 rate (77% vs 80%) at 9.6 s a question: stepping out from the anchor turned close guesses into off-by-ones. Its data stays in the ear model; Gut & check tests the underlying idea directly.
- **Gut & check ⚡** (v5, drill): name the note on instinct — that **gut** answer is locked in — then check it with your inner MIDI and **keep it or tap a different note**. Logged: `gut, gutCorrect, resp` (final), `correct, changed, rt` (gut, from onset), `rtCheck` (gut tap → final), `errGut, errSemis`. Analysis: gut vs final accuracy, wrong→right vs right→wrong, which way changes go. Motivation: slow naming misses ran sharp (16/20, p≈.01) while fast ones were balanced — this shows whether the deliberate check adds information or costs it.
- **Inner tuner 🎛️** (v5, drill + calibration): cleanser → "imagine E♭" (3 → 2 s) → a synth tone **off true pitch** by ±100/70¢ (L1) … ±25/15¢ (L5), sharp and flat balanced → **higher or lower than what you imagined?** Graded against *true* pitch, so feedback pulls your imagery toward it. Over many questions the 50% point (PSE, fit per note when ≥8) is where your imagined note actually sits — no mic. Logged: `pc, oct, cents, voice, secs`; `resp` up/down.
- **Name or hold? 🏷️** (v5, drill; Lucas's idea): a note plays and you hold it through noise or stray notes (4–7 s at L1 → 12–20 s at L5, more stray notes). **Half the time its name is shown** while it plays; the probe is the same note or a **full semitone** off (so remembering just the name can work). Fully crossed 2×2×2: named/unnamed × noise/stray notes × same/different. After answering, an optional 4-second prompt: did you hold **the sound, the name, or both**? (On unnamed trials "the name" means you named it yourself.) Question: does the name help — and does it help most under stray notes, which wipe a sound memory but not a label? Compare with *Hold it* (unnamed, cents-level probes).
- **Tag at home? 🏠** (v5, drill + calibration): a PP-MIDI tag plays, half the time shifted (±200¢ L1, ±100 L2 … ±50/35¢ L5) — **is it at its real pitch?** Every version, including home, goes through the same granular player (`player: "grain"`) at the same speed, so texture and tempo can't give a shift away. Tests whether the tags carry pitch, not just their tune. Logged: `pc, cents, home, variant, player`.
- **Neighbors 👯** (drill + calibration station since v4): "Is this E♭ or D?" Next-door chroma with no reference.
  - L1 whole-step pair → L2 semitone pair in octaves 3–5 → **L3 trio**: three next-door notes (e.g. D, E♭, E) whose names only appear once the note sounds → L4 trio + octaves 3–5 + random synth timbres → L5 trio + 0.5 s notes in octaves 2–6.
  - Why the reveal: with the names on screen first you can pre-imagine the candidates and just compare. Revealing them at the note forces recognition first, then a short check among three. RT is from onset, as everywhere.

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
  - weak notes → Song anchors;
  - slow naming misses lean sharp (≥70%) → Gut & check; sung template off by ≥15¢ → Inner tuner;
  - ≥40% of naming misses are next-door notes → Neighbors.
- **New games get a nudge** so they collect data: Gut & check +0.2, Inner tuner +0.15, Name or hold +0.15, Tag at home +0.1. **Neighbors and naming are judged on cold questions** once there are ≥6 in the last 3 days.
- **Neighbors is weighted up (+0.35) while you're building.** It's pure chroma recognition with no reference, in any octave and timbre. A specific diagnosis (like a relative-pitch leak) can still outrank it.

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
  - in-tune cents;
  - Neighbors choices (pair → trio), octaves, timbre, note length.
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
- **When it syncs:** opening the hub pulls then pushes; **opening the ear model syncs first (up to 8 s)**, so it never shows one browser's stale slice; every finished calibration or drill syncs again; during a run, trials trickle up every ~45 s.
- **The ear model says what it's showing:** a coverage line with sync status, how many sessions from how many devices/browsers, and the latest run's time. It turns amber when sync was skipped or failed.
- **Push:** this device's own records, changed since its last push. The store is append-only, so an updated session is simply re-sent and the newest version wins.
- **Pull:** every record the server stored since this device's last pull.
- **No sync loops.** Pulled records carry an internal `_pulled` flag and are never pushed back. A device never overwrites its *own* sessions with cloud copies.
- **Follows you across devices:** drill levels (from the latest drill session of each skill, on any device), the streak (calibration days from any device), the coach and the ear model.
- **Device tags.** Every session carries `device {id, kind: phone|desktop}`, so the analysis can compare phone vs laptop.
- **Tested:**
  - `tools/test-cal-dmstore.mjs`: the adapter against a mock Supabase that enforces the real RLS. Checks chunking, incremental and paged pulls, that DMs and other users' rows never leak in, and that the DM views stay clean.
  - `tools/shot-sync.mjs`: two simulated devices sharing a fake server. Each device's runs appear on the other, levels follow, idle re-syncs upload nothing, and pulled rows are never re-uploaded.
- Export pulls first, so it includes every device.

### Sessions
- Calibration: `kind: "calibration", protocol, localDate, sessionOfDay, dayIndex, checkin, plan, summary {skill:{n,k}}, completed, durSec, env, device {id, kind}`
- Both kinds also store the session's full **sound ledger**:
  - `soundCounts {heard[12], labeled[12], bySrc {n, c, t, d}[12]}`: per-note totals;
  - `soundLog`: one row per sound, `[msFromStart, midi, src, labeled 0|1, cents]`.
  - `src` is n = question/feedback note, c = cleanser, t = PP-MIDI tag, d = hold distractor.
  - A sound is `labeled` when its name was on screen: feedback after you answered, Attune / learn / Lock-in, and the Imagine reveal.
- Drill: `kind: "drill", skill, startLevel, endLevel, events [{t, type: tooEasy|tooHard|autoUp|autoDown, from, to, atTrial}], n, graded, k, bestStreak, endReason (end|switch|exit), durSec`
- v1 sessions have no `kind` and count as calibrations.

### Trials
Common fields: `id, sessionId, mode (calibration|drill), protocol, station, gi, ti, t, hour, dow, level, correct (true/false/null), rt (ms from note onset → tap, v3+), rtFrom, replays`.

**`ctx`: what you'd heard before each question.** It's computed from sounds *before* the question started, so the question's own note and feedback don't count.
- **Target and timing:**
  - `targetPc`: the note being asked (target / targetPc / pc, by station);
  - `startAt`, `askAt`: question start, and when the answer buttons were armed (≈ note onset);
  - `gapMs`: from your last answer to this question's start; `onsetGapMs`: from your last answer to this note sounding;
  - `questionNo`: this question's number in the session.
- **Repeats:**
  - `prevTargets` / `prevStations`: the last 3 questions;
  - `sameRun`: how many questions in a row just before this one asked the same note;
  - `askedBefore`: how many times this note was already asked this session.
- **Exposure:**
  - `heardBefore` / `labeledBefore`: times this note had sounded this session, at all and with its name showing;
  - `sinceHeardMs` / `sinceLabeledMs`: time since it last sounded, and since it last sounded labeled;
  - `soundsBefore`: everything heard this session before this question.

These let analysis separate **pitch memory** from **classification**. Example signs of memory: a run of repeats, or the note heard labeled a few seconds earlier. Also look for relative-pitch use from recently heard references and whether cleanser exposure matters. The test `tools/shot-v5.mjs` recomputes every trial's ctx from the session `soundLog` and checks that they match exactly.

| station | `stim` | other |
| --- | --- | --- |
| attune / lockin | `pc` | — |
| cue | `pc, kind (learn / cue2note / note2cue), choices, cleansed` | `resp` |
| imagine | `pc, secs` | `resp` (sung / nailed / off), `sing {ok, hz, midi, cents, oct}` |
| anchor | `pc, anchorPc, isAnchor, offsetCents, oct, voice` (v1: `offset` semitones, anchor always C) · v5: `lureKind, lureSemis` | `resp` yes/no · v5: `guess` (pc / "idk"), `guessCorrect, rtGuess` |
| nhold | `pc, oct, dur, labeled, interference, distractors, same, probeSemis, voice, draw, warm, warmAgoMs` | `resp` same/diff, `strategy` (sound / name / both / null) |
| name | `pc, oct, midi, wash, timbre, prevMidi, prevPc, prevInt` | `resp, errSemis` |
| hold | `pc, dur, same, probeCents, interference (noise/tones), distractors, voice` (v1: `probeOffset`) | `resp` |
| twins | `a, b, offset, octs, oddSlot, notes` | `resp, replays` |
| triad | `rootPc, quality, inversion, spread, chord, targetPc, posIdx` | `resp, replays` |
| tune | `pc, oct, inTune, cents, voice` | `resp` in/off |
| tri | `anchor, target, dist, oct, midi` | `resp, replays, errSemis` |
| pair | `pc, set` (low → high; `pair` is the same list, kept for old readers)`, nChoices (2/3), pos (target's index in set), reveal (names shown only at the note), step, oct, timbre, dur` · v5: `draw, warm, targetWarm, warmAgoMs` | `resp, replays, errSemis` |
| name (v5 adds) | `core, draw, warm, warmAgoMs` | — |
| gut | `pc, oct, midi, timbre, wash, draw, warm, warmAgoMs` | `gut, gutCorrect, resp, changed, rt, rtCheck, errGut, errSemis` |
| tuner | `pc, oct, cents, voice, secs, draw, warm, warmAgoMs` | `resp` up/down |
| taghome | `pc, cents, home, variant, player, draw, warm, warmAgoMs` | `resp` home/shifted, `replays` |

## What `analyze()` estimates
Validated against simulated listeners in `tools/test-cal-analysis.mjs`.

| Index | Method | Reads as |
| --- | --- | --- |
| Scorecard | each station's accuracy, Wilson 95% range, and chance (per-trial: 1/12, 1/choices, 1/3; yes/no tasks: the more common answer's rate). Leaky versions excluded: anchor block (non-pop-up), In tune? without `voice` | what's clearly above guessing |
| Progress (fixed test) | naming in octave 4, piano, cleanser on, per day; slope over days with ≥4 trials | improvement that difficulty changes can't fake |
| Daily reading | first completed calibration per day, at that day's levels; ▲ marks days a level went up | real progress, not same-day practice (read with the ▲s) |
| How you know a note | naming and Neighbors accuracy by answer time (<1.5 / 1.5–3 / 3–6 / >6 s) | fast + right = recognition; slow + right = generate-and-compare |
| Relative-pitch leak | acc(no cleanser) − acc(cleanser), 95% CI; perseveration | >0 → computing from the last note |
| Hidden anchor | RT ~ distance from each of 12 notes; permutation p | slope at X → counting from X; flat → direct recognition |
| Gut vs compute | median RT correct vs wrong; % fast-correct | fast + right = categorical |
| Song anchors | tag→note vs bare-note→tag accuracy, per note | association strength; the bare direction is the AP bridge |
| Hold it | noise − stray-notes accuracy (tone-interference cost); accuracy by cents | big cost → holding the sound, not the name |
| In tune? | accuracy by cents off; fixed version only (`stim.voice`) | tuning-template resolution |
| Mental anchors | Triangulate accuracy + RT per imagined anchor; by distance | which internal reference notes you can actually use |
| Neighbors | **cold vs warm** (any choice; and target-only), 2-choice (semitone vs whole step, per pair) and trio (overall, middle vs edge, per set) | real chroma (cold) vs short-term memory (warm); muddy boundaries |
| Gut & check | gut vs final accuracy; wrong→right, right→wrong; change direction; error direction gut vs final | does the slow check help? |
| Inner tuner | logistic fit of P(higher) vs cents → PSE (overall, per note); accuracy by size | where imagined notes sit, in cents |
| Tag at home? | home called home; shifted caught, by size and direction | do the tags carry pitch? |
| Name or hold? | named vs unnamed accuracy (95% CI), split by noise vs stray notes, by hold length; accuracy by self-reported strategy | is a name a better memory than the sound? |
| Timbre lock | piano − sine | >0 → piano-bound |
| Register cues | accuracy spread across octaves | height vs chroma |
| Chroma | octave twins by offset | — |
| Inner pitch | sung signed cents bias / abs error | template drift |
| Anchor precision | pop-ups only: accuracy, hit rate (per anchor note), **by time since last heard** (<1 min / 1–5 min / >5 min), false alarms by lure cents; the old block is kept apart as `legacy` | how sharp each daily anchor is, and how long it lasts |
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

Using `ctx`:
- **Memory vs classification:** compare accuracy on `sameRun > 0` or short `sinceLabeledMs` trials (memory-assisted) against cold ones (`labeledBefore = 0`).
- **Exposure effects:** check whether `heardBefore` (e.g. from cleansers) helps or hurts.
- **Pacing:** look at how `onsetGapMs` relates to accuracy and RT.

These are *candidate* explanations to test, not conclusions.

1. Export JSON (from the device you use, or the Mac browser if the cloud backup is on). Drop it into `calibration-data/` in this repo; that folder is gitignored and never committed.
2. Ask Claude to "analyze my calibration data." The plan:
   - check data quality per protocol version: sessions, trials per condition, RT outliers, v1/v2 split;
   - fit mixed-effects models (correctness ~ cleanser × timbre × octave, plus hold interference × cents; random intercept per session and per day) and RT models on correct trials;
   - use the cold-reading series for learning curves, and the drill logs for within-day practice effects and what "too easy" really meant;
   - write down the **current best model of how Lucas produces pitch names** (e.g. "anchors on E, computes up to a 4th, tag recall strong for C/E/G but weak for sharps, holds the name not the sound");
   - design **new stations/drills** that force a different mechanism or test an open question, each with its own randomized contrast, so the next export shows whether it worked.
