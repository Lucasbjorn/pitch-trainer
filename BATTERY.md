# Testing Battery

A standardized auditory measurement suite, built to be repeated many times across a ~48-hour visual-deprivation experiment and then exported for analysis.

It lives as a tab inside the existing Pitch Trainer app and reuses its module/tab architecture, but it does **not** use Tone.js for stimuli — see [Audio](#audio) for why.

---

## Opening it

| What | Where |
| --- | --- |
| The battery | `?battery=1` — bookmark this |
| Results dashboard | `?battery=1&admin=1`, or type `admin` on the battery home screen |
| From inside the app | Lab → 🧪 Testing Battery |

The deep link skips the home hub and the Lab password. Use it. At 4am on day two, nobody should be clicking through three screens to get to the right place.

The results dashboard is deliberately hard to reach by accident. **Do not open it during the experiment.**

---

## Running a session

1. **Audio setup** — reference tone, left/right channel check, and the rig fields (device, headphones, volume). Takes 30 seconds and gets stored with the session.
2. **Session details** — label (`Baseline`, `Hour 12`, `Post Vision`, …), hours since blindfold, sleep, caffeine, and 1–10 ratings for fatigue, focus, stress.
3. **Five modules**, fixed order, with a break between each.
4. **"Session complete. Data saved."** — and a JSON backup file drops into Downloads automatically.

No scores, no accuracy, no feedback of any kind until the experiment is over.

**Total: about 26 minutes**, 274 trials.

### Keys

| Key | Does |
| --- | --- |
| `F` / `J` | The two answers in any two-choice test (also `←` / `→` or `↑` / `↓`) |
| `Space` | "I know it" in note naming · "match" in n-back · continue everywhere else |
| `R` | Replay, where a module allows it |
| `P` | Pause (takes effect at the next safe point) |
| MIDI keyboard | Enter pitch classes directly |

Everything is also clickable, so a friend can drive it. Reaction time is only ever taken from your own keypress, never from a friend's click — so `input_method` is logged per trial and RT stays clean regardless of who is operating the machine.

---

## The five modules

Chosen for evidence at this timescale and for producing continuous, well-powered measures. Two more (pitch memory, chord segregation) ship but are **off by default** — see [Optional modules](#optional-modules).

### 1. Note Naming — 48 trials

Single isolated notes; you name the pitch class. Not an absolute-pitch test — the question is whether tagging gets easier or faster.

- 12 pitch classes × 4 repetitions. Register and timbre assigned by orthogonal modular rules, so each appears exactly 16 times and **every pitch class is heard in every register and every timbre**.
- A burst of random microtonal tones runs before every trial. Without it, trial N+1 gets answered by comparing against trial N, and the whole thing becomes a relative-pitch test.
- Two-stage response: `Space` the instant you know (this is what gets timed), then say the note and your friend enters it. Decision time is measured without any motor-search or friend-reaction contamination.
- A "how did you know?" probe fires on a third of trials — song reference / it just felt like that note / guessed / other.

**Measures:** accuracy vs. 8.3% chance, median decision RT, signed and absolute semitone error, per-pitch-class accuracy, confusion matrix, strategy-vs-accuracy breakdown.

> Raw accuracy here is the weakest-powered number in the battery — at ~20% correct, 48 trials still leaves a standard error near 5.8%. Decision RT and semitone error are continuous and far more sensitive. Read those first.

### 2. Fine Pitch Discrimination — 42 trials

Two tones; is the second higher or lower? Adaptive.

- Base frequency roves every trial (300–700 Hz) so no long-term reference can build up. Level roves ±2 dB so loudness can't stand in for pitch.
- 34 adaptive trials (ZEST) + 8 fixed-difficulty anchor trials at 25/12/6/3 cents.

**Measures:** threshold in cents with a 68% credible interval, plus model-free accuracy at each anchor level.

### 3. Harmonicity — 44 trials

Two complex tones at the same pitch; one has its partials mistuned. Which one?

This is the headline measure. Landry, Shiller & Champoux (2013) found harmonicity discrimination improved after only **90 minutes** of visual deprivation — the strongest short-duration auditory result in the literature.

- Standard jitter method: partial *n* moves to (n + jᵢ)·F0 with jᵢ ~ U(−J, +J). F0 itself never moves, so pitch is not the cue.
- Both intervals are RMS-identical to within 3×10⁻¹¹, so loudness is not the cue.
- Partials are held ≥30 Hz apart so the manipulation can't collapse into an obvious beating cue.
- Two-interval forced choice, not "harmonic or not" — a one-interval version measures response criterion as much as sensitivity, and criterion is exactly what drifts over 48 sleepless hours.

**Measures:** threshold as % mistuning of F0, credible interval, anchor accuracy.

### 4. Auditory Working Memory — 88 tones

2-back and 3-back on microtonal tones. Press `Space` on a match.

- Tones sit on a **137-cent grid** with a randomly roved base, so they have no note names to rehearse verbally. This was the specific failure mode to avoid for a trained musician.
- Controlled lures (matches at n−1 and n+1 back) prevent answering on bare familiarity.
- The whole 44-tone stream is scheduled in one go, so inter-onset intervals are sample-accurate rather than at the mercy of `setTimeout`.

**Measures:** d′ and criterion c at each load, hit rate, false-alarm rate, lure false-alarm rate, hit RT, load cost.

> d′ rather than a span score: span is an integer that bounces around too much to read a trend from five sessions. d′ is continuous and separates sensitivity from response bias, so a session where you simply pressed more often doesn't masquerade as improvement.

### 5. Cocktail Party — 52 trials

A target melody rises or falls inside a cloud of competing tones. Adaptive on target-to-masker ratio.

- Tonal informational masking, not speech: browser TTS varies by OS and can't be routed through Web Audio at a controlled SNR, so a speech version wouldn't be comparable between sessions or machines.
- Maskers are redrawn every burst from 250–4500 Hz, excluding a protected band around the target.
- Two conditions, 24 adaptive trials each:
  - **co-located** — target and masker both diotic, fused at the centre
  - **separated** — masker given a 700 µs ITD (34 whole samples at 48 kHz) plus an 8 dB ILD, so it lateralises right while the target stays centred

**Measures:** TMR threshold in dB per condition, and **spatial release from masking** = the difference.

> ⚠️ Spatial release is the least precise number in the battery: ~4.4–5.0 dB of measurement noise against a typical effect of 5–10 dB. Treat a single-session value with suspicion; the two individual thresholds (~3.2 dB noise each) are more trustworthy. Requires headphones.

---

## What change is actually detectable

Measured by simulation, not guessed. These are the smallest **session-to-session** changes that clear measurement noise:

| Measure | Noise (CV) | Detectable change |
| --- | --- | --- |
| Pitch discrimination threshold | 0.26–0.28 | ~36–38% |
| Harmonicity threshold | 0.28–0.30 | ~38–42% |
| Spatial release from masking | ±4.4–5.0 dB | large effects only |

Anything smaller than that in a single pair of sessions is noise. The way around it is the **trend across all five sessions**, not any one comparison — which is why the dashboard plots time courses with error bars rather than showing you pairwise deltas.

The adaptive estimator was tuned for this specifically: assumed slope β=1.0 with a wide prior (SD 1.2 log units). Sharper settings give a slightly tighter estimate but introduce *level-dependent* shrinkage, which would distort the shape of the change over time. Measured bias flatness across the operating range is 1.077 — essentially a constant offset, which cancels when comparing sessions.

---

## Data

Everything is written to IndexedDB the moment each trial completes. A refresh, a crash or a closed lid costs one trial, never a session. Incomplete sessions offer to resume, and resume regenerates identical stimuli because every module's RNG stream is reseeded per trial from `${sessionSeed}:${moduleId}:t${trialIndex}`.

**Backups:** a JSON file downloads automatically at the end of every real session. IndexedDB can be evicted by the browser and this experiment cannot be re-run — keep those files.

### Export

From the results dashboard:

- **Export CSV** → `battery-trials-*.csv` (one row per trial) and `battery-sessions-*.csv` (one row per session)
- **Export JSON** → everything, nested

Each trial row carries: unique ID, session ID and label, module, trial and global index, timestamps, per-trial random seed, every stimulus parameter (flattened into `stim_*` columns *and* preserved whole in `stim_json`), correct answer, response, correctness, RT, difficulty, adaptive state before and after, input method, and practice flag.

Session rows carry the metadata, the calibration (sample rate, base and output latency), the browser environment, and every module summary flattened into `sum_*` columns.

### Analysis notes

Because `difficulty` and `correct` are logged for **every** trial, you are not locked into the adaptive procedure's assumptions. If the real psychometric slope turns out to be different from the assumed β=1.0, refit offline:

```r
# per session, per module — Weibull with guess rate 0.5
glm(correct ~ log10(difficulty), family = binomial(link = "logit"),
    data = subset(trials, module == "harmonicity" & !is_practice))
```

The **anchor trials** (`block == "anchor"`) are the model-free check. They never feed the adaptive posterior, so raw accuracy at a fixed difficulty stays completely independent of the fitting model. **If the adaptive threshold and the anchor accuracy ever disagree about which direction things moved, believe the anchors.**

---

## Practice

Each module has a short practice version **with** feedback that never touches the dataset. There's also an all-modules dry run.

Do this until every task is boring, **before** baseline. Every bit of "learning the interface" you do in practice is improvement you will not later mistake for an effect of the blindfold. Two or three full practice runs is not excessive.

---

## Audio

Stimuli are synthesized directly into `Float32Array` buffers and played through `AudioBufferSourceNode`, bypassing Tone.js entirely. Psychophysics needs three things a synth graph can't guarantee:

1. **Exact RMS** — so loudness never becomes an accidental cue. Verified: the two harmonicity intervals match to 3×10⁻¹¹.
2. **Exact envelopes** — raised-cosine ramps written into the sample data. Every stimulus starts and ends at exactly 0.0, so there is no oscillator-start click and no attack transient.
3. **Exact onset time** — `start(t)` is sample-accurate, and `getOutputTimestamp()` maps it onto the `performance.now()` clock, so reaction times are measured from real acoustic onset rather than from the JS call. Base and output latency are logged per session.

One `AudioContext` for the whole battery, forced to 48 kHz where the device allows. Master gain is set once and never touched. All tones keep >6 dB of peak headroom (max observed peak 0.279); a 5-note chord peaks at 0.42.

---

## Things that will quietly ruin the data

- **Changing the volume mid-experiment.** Set it at baseline and never touch it. The rig fields exist so you can catch this afterwards.
- **Different headphones or a different machine.** The cocktail-party module depends on channel behaviour; the rest depend on level.
- **Looking at results between sessions.** Knowing you improved 18% at hour 12 changes how you attack hour 24. This is why the dashboard is hidden.
- **Skipping practice before baseline.** Practice effects at the start of a repeated-measures design look exactly like a real effect.
- **Changing the module set between sessions.** Decide once, before baseline, and leave it.
- **A MIDI keyboard with local sound on.** If you use MIDI for note entry, turn its own sound off or use a controller — hearing your own answer would contaminate the trials that follow.

---

## Optional modules

Off by default; enable on the session details screen. If you enable them, enable them **for every session including baseline**.

- **Pitch Memory Retention** (24 trials) — same/different pitch after 1.5 s, 5 s, and 5 s + interference. Cut from the core because it's largely redundant with the n-back, which measures the same storage with much better power. Its one distinct contribution is separating decay from interference resistance.
- **Chord Segregation** (12 trials) — name every pitch class in a simultaneous chord, sizes 2–5. Fun and musician-specific, but no supporting literature at this timescale and the slowest module per trial. Difficulty is stratified: exactly one chord of each size × voicing-type combination per session, transposed randomly, so no session can draw an easier hand.

---

## Tests

`tools/` is gitignored, so these live on the local machine only — they are not in the repo.

```bash
python3 -m http.server 8777          # from the repo root

node tools/verify-battery.mjs http://localhost:8777/     # 23 checks: estimator, audio levels, design balance
node tools/test-battery-all.mjs http://localhost:8777/   # every module end to end, persistence, resume
node tools/test-battery-dash.mjs http://localhost:8777/  # scoring + dashboard against a seeded dataset
```

`verify-battery` is the one to re-run after touching anything scientific. It asserts estimator bias flatness, that harmonic and inharmonic tokens are RMS-identical, that no stimulus clips, that every stimulus starts and ends at silence, that the note-naming design is balanced 16/16/16 across registers and timbres, that no chord template contains a duplicated pitch class, and that n-back targets and lures are constructed correctly.
