# Pitch Trainer

## What the app does

Pitch Trainer is a mobile-friendly web app for ear training. Open it in your browser, tap **Start**, and grant microphone access. As you sing or hum, the app detects the pitch class you're producing and immediately plays back a short audio cue associated with that note — typically a memorable phrase from a familiar song that starts on that pitch. The goal is ambient, low-friction training that links your vocal pitch to a strong associative cue, helping musicians with partial absolute pitch sharpen their pitch-class recognition throughout the day.

## File structure

```
pitch-trainer/
  index.html
  app.js
  samples/
    c.wav    cs.wav   d.wav    ds.wav
    e.wav    f.wav    fs.wav   g.wav
    gs.wav   a.wav    as.wav   b.wav
  README.md
  PLAN.md
  .gitignore
```

The app is three files plus a `samples/` folder. No build step, no `node_modules`, no framework. Libraries (`pitchy`, `tone`) load from `esm.sh` at runtime via ES module imports.

## Sample preparation

Sample quality is the single biggest determinant of how good the app *feels*. Spend time on these:

- **Trim tightly at the start.** Remove any leading silence. Even 50 ms of silence before the first audible moment will make that note feel "late" relative to others. Zoom in and cut to the zero-crossing immediately before the first transient.
- **Volume-match all 12.** Normalize to the same peak or perceived loudness; -16 LUFS RMS is a reasonable target. Without this, some notes will be startlingly loud and others too quiet, which disrupts the training loop.
- **Same format and sample rate.** All WAV, all 44.1 kHz, all the same bit depth (16-bit is fine). Mixed formats work but introduce subtle loading and playback bugs.
- **Reasonable length.** 1.5 – 3 seconds is the sweet spot. Longer samples overlap if the user changes notes quickly; shorter samples don't give the associative cue time to register.
- **No fade-out needed.** Tone.js handles the release envelope.

File naming uses lowercase letters with `s` for sharps (since `#` is awkward in URLs):
`c.wav, cs.wav, d.wav, ds.wav, e.wav, f.wav, fs.wav, g.wav, gs.wav, a.wav, as.wav, b.wav`.

## Deployment to GitHub Pages

The app needs HTTPS for microphone access on mobile, and GitHub Pages provides that for free.

1. Create a new GitHub repository (public, e.g. `pitch-trainer`).
2. Put all project files in the repo root — **not** inside a subfolder.
3. Commit and push to the `main` branch.
4. Go to **Settings → Pages**. Under **Source**, choose **Deploy from a branch**. Set **Branch** to `main` and folder to `/ (root)`. Click **Save**.
5. Wait about a minute, then visit `https://YOURUSERNAME.github.io/pitch-trainer/`.
6. On iPhone, open the URL in Safari, tap **Start**, and grant microphone permission when prompted.
7. To update the app: commit and push. Pages redeploys automatically in around 30 seconds.

## Tuning CONFIG

`CONFIG` lives at the top of `app.js`. Adjust these to your voice and environment:

| Key | Default | What it does | Symptom if too low | Symptom if too high |
| --- | --- | --- | --- | --- |
| `minFreq` | 35 | Lowest detected frequency accepted (Hz, ~D1) | Bass rumble triggers junk notes | Low-male singing ignored |
| `maxFreq` | 2400 | Highest detected frequency accepted (Hz, ~D7) | Whistles / squeaks trigger junk notes | High soprano ignored |
| `minClarity` | 0.85 | Minimum pitchy clarity score (0..1) | Noise and unvoiced sounds trigger | Even clear humming gets rejected |
| `minAmplitude` | 0.01 | RMS gate — quietest accepted level | Background sound triggers | You have to belt to register |
| `stabilityMs` | 40 | How long a candidate must persist before firing | Display flickers between adjacent classes; rapid retriggers | Feels sluggish and unresponsive |
| `retriggerCooldownMs` | 0 | Hard cooldown after each trigger | (off by default) | Can't quickly retrigger the same or different notes |
| `sameNoteRetriggerMs` | 2000 | Hold the same pitch this long since last trigger → re-arm and refire | Same note refires while you're still on the original hum | Have to go silent or change notes to retrigger; feels stuck |
| `silenceRetriggerMs` | 50 | Silence longer than this clears the latch so the same note refires when you come back in | Mid-hum dropouts cause unwanted retriggers | Brief stop-and-restart on the same note doesn't refire |
| `fftSize` | 2048 | Analyser FFT size (samples) | Frequency resolution too coarse | Latency and CPU rise |
| `sampleOctave` | 4 | Octave used for sample playback (e.g. C4) | — | — |
| `releaseDuration` | "2n" | Tone.js note length for `triggerAttackRelease` | Sample cuts off too soon | Samples overlap when notes change quickly |

Start with the defaults. The most common tweaks:

- **Display flickers between two adjacent classes (e.g. B ↔ C) on a held note** → raise `stabilityMs` to 150 – 200.
- **Same note fires twice in rapid succession** → set `retriggerCooldownMs` to 80 – 120 as a safety valve. If this fully fixes it the underlying state-machine timing was just borderline; if it doesn't, file a bug.
- **Quiet humming doesn't register** → lower `minAmplitude` to 0.005, or `minClarity` to 0.8.

## Browser support

**Tested-good:**

- Safari on iPhone (iOS 16+)
- Chrome on desktop (macOS / Windows)

**Should work but untested:**

- Chrome on Android

**Known to be flaky — do not optimize for these:**

- Firefox mobile
- Samsung Internet
- In-app browsers (Instagram, Twitter, etc.)

If you hit issues in a flaky browser, the first thing to try is opening the URL directly in Safari or Chrome rather than via an in-app webview. Microphone and audio-context permissions behave inconsistently inside webviews.

The app requires a **secure context** (HTTPS or `localhost`). `getUserMedia` will reject on plain `http://` URLs.

## Troubleshooting

### "Microphone access denied" — but I want to grant it
You previously denied permission. In Safari (iOS): Settings → Safari → Microphone → set the site to Ask or Allow. In Chrome (desktop): click the site-info icon next to the URL → Microphone → Allow, then reload.

### Tap Start, nothing happens
Open the page in a real browser tab (not an in-app webview from Instagram, Slack, etc.). Webviews often silently block microphone access. If you're already in Safari/Chrome, watch the Status line — any error during init will show there.

### Samples don't play
- Verify the `samples/` folder exists at the same level as `index.html` and contains all 12 WAV files with the exact lowercase names listed above.
- The Status line will say which file failed to load if any are missing or named wrong.
- On iOS, audio is locked until you tap Start. Auto-loading on page open will not work — tap the button.

### Pitch detection is jumpy or wrong
- Make sure no other app is using the mic (some browsers will share the mic but apply processing).
- The app explicitly disables echo cancellation, noise suppression, and AGC — those defaults wreck pitch detection. If you've forked the code, do not re-enable them.
- Watch the debug readout. Humming A4 should show ~440 Hz. If it shows half or double that, you're picking up a sub-octave or an overtone — try humming louder or with more vowel ("ahh") instead of a closed hum.

### Display flickers between two adjacent notes (B↔C, E↔F) on a steady pitch
The stability gate isn't catching the rounding jitter at the semitone boundary. Raise `CONFIG.stabilityMs` to 150 – 200. If it still flickers, check that the state-machine variables (`candidatePitchClass`, `candidateSince`, `latchedPitchClass`, `armed`) are at module scope — not being recreated each frame.

### Same note retriggers rapidly while I hold it
The state machine should latch after the first trigger and not refire until the pitch changes or you go silent. If this is happening, `latchedPitchClass` isn't being preserved across frames — same root cause as above. As a temporary safety valve, set `retriggerCooldownMs` to 80 – 120.

### After an error, the mic indicator stays on / restart stacks audio graphs
Cleanup didn't run. Reload the page to forcibly tear everything down. If it's reproducible, it's a bug in the cleanup function — every error path through `init()` should call `cleanup()` before re-showing the Start button.

### Different sample rates on different devices
The app passes the live `audioCtx.sampleRate` to pitchy on every call, so this is handled automatically. If you've forked and hardcoded a sample rate, frequencies will be wrong on devices that use a different rate.

## Local development

You need an HTTPS or localhost server — `getUserMedia` won't work over `file://`.

```bash
# Python 3
python3 -m http.server 8000

# or Node, no install required
npx http-server -p 8000
```

Then open `http://localhost:8000/` in Chrome.
