These are all good catches. Let me fold them into the spec properly so Claude Code gets a single coherent document.
Here's the updated PLAN.md with your additions integrated. I've put your items in the places where they'll actually get read at the right moment — cleanup behavior next to the init flow, state machine names next to the retrigger rules, etc., rather than tacked onto the end where they'd get missed.

Pitch Trainer Web App — Build Spec (v2)
What this is
A mobile web app that listens to the user's voice via microphone, detects the pitch class they're singing/humming, and plays back a corresponding sample from a library of "perfect pitch" audio snippets (short phrases from familiar songs, each one starting on a specific note). The purpose is ear training — immediate auditory feedback linking the user's vocal pitch to a memorable auditory cue for that pitch class.
The user is a musician with partial associative absolute pitch who wants ambient, low-friction pitch-class feedback throughout the day.
Tech stack — use exactly these

Vanilla HTML/CSS/JavaScript, ES modules, no build step
pitchy v4 for pitch detection (McLeod Pitch Method, imported from esm.sh)
tone v14 for sample playback (imported from esm.sh)
Deployed via GitHub Pages (HTTPS required for mic access on mobile)

Do not introduce a bundler, npm install step, React, TypeScript, or any framework. The whole app is three files: index.html, app.js, and a samples/ folder.
Browser support targets

Primary targets: Safari on iPhone (iOS 16+), Chrome on desktop (macOS/Windows)
Secondary: Chrome on Android (should work but untested by user)
Known to be flaky: Firefox mobile, Samsung Internet, in-app browsers (Instagram/Twitter webviews) — mic and audio permissions behave inconsistently. Do not optimize for these. If the user reports issues on these, first response is "open in Safari/Chrome directly."

File structure
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
Sample files will be provided by the user. Assume they exist during development. Handle their absence gracefully (see Error handling below).
Functional requirements
Core loop

User taps Start button (required for iOS audio unlock — do not try to auto-start)
Start button disables immediately on tap to prevent double-tap init races. Re-enables only if init throws, after cleanup completes.
App requests microphone permission
App loads all 12 samples via Tone.Sampler
Once loaded, shows "Listening" status and begins analysis loop
For each analysis frame (~60fps via requestAnimationFrame):

Grab time-domain audio data from analyser
Compute RMS amplitude
Run pitchy to get fundamental frequency + clarity score
If amplitude, clarity, and frequency all pass gates: determine pitch class
Run through the pitch state machine (see below)
If state machine signals a trigger: fire the sample


UI shows current detected pitch class prominently, plus frequency and clarity for debugging

Pitch state machine — use these exact variable names
Implement the retrigger logic as a four-variable state machine with these exact names. Naming the states explicitly prevents the common mistake of conflating "what the user is currently singing" with "what we last triggered":
javascriptlet candidatePitchClass = null;   // the pitch class we're watching for stability
let candidateSince = 0;           // timestamp when candidate was first seen
let latchedPitchClass = null;     // the pitch class currently "held" as triggered
let armed = true;                 // true = ready to fire; false = waiting for change or silence
Frame logic:

If valid pitch detected:

If detected pitch class === candidatePitchClass:

If stable for ≥ CONFIG.stabilityMs AND armed AND detected class !== latchedPitchClass:

Trigger sample, set latchedPitchClass to detected class, set armed = false, record lastTriggerTime




Else (pitch class changed):

Update candidatePitchClass and candidateSince
If detected class !== latchedPitchClass: set armed = true (pitch changed, ready to fire again once stable)




If no valid pitch (silence/noise):

Reset candidatePitchClass = null
Set armed = true (silence re-arms the trigger)
Do NOT immediately clear latchedPitchClass — leave it so brief dropouts don't cause instant retrigger on return



Optional cooldown (implement as config, default 0)
Add retriggerCooldownMs to CONFIG, default 0 (disabled). When non-zero, after a trigger, no new trigger can fire until now - lastTriggerTime >= retriggerCooldownMs, regardless of other state. This is a safety valve for unstable voices — user can raise it to 50-120 if they see double-triggers during testing. Start at 0 so it doesn't mask bugs in the state machine.
Cleanup behavior on error/restart
Any time init fails or the app needs to restart, the following cleanup must happen in order before re-initializing:

Cancel the active requestAnimationFrame (store the handle from requestAnimationFrame return value, pass to cancelAnimationFrame)
Stop all tracks on the MediaStream: stream.getTracks().forEach(t => t.stop())
Disconnect the source node and analyser node
Close the AudioContext (audioCtx.close())
Dispose the Tone.Sampler (sampler.dispose())
Reset all state machine variables to initial values
Re-enable Start button
Clear status and note display

Store the stream, source, analyser, audioCtx, sampler, and rAF handle as module-level variables so cleanup can reach them. Wrap cleanup in its own function called both from the error path and from a hypothetical future "Stop" button.
UI

Big centered pitch class letter (e.g., "F#"), font-size ~10rem, dominates the screen
Smaller frequency + clarity + RMS readout below for debugging (always visible, small gray text)
Start button that disappears after successful init, reappears on error
Status line at the bottom
Dark background (#111), light text
Touch-friendly, no hover states, no small tap targets
viewport-fit=cover and -webkit-tap-highlight-color: transparent

Tunable config
Expose a CONFIG object at the top of app.js so the user can adjust without hunting through the code:
javascriptconst CONFIG = {
  minFreq: 70,
  maxFreq: 1200,
  minClarity: 0.85,
  minAmplitude: 0.01,
  stabilityMs: 100,
  retriggerCooldownMs: 0,
  fftSize: 2048,
  sampleOctave: 4,
  releaseDuration: "2n",
};
Known traps — address each explicitly
1. iOS audio unlock
Web Audio on iOS Safari will not produce sound until Tone.start() has been called inside a user gesture handler. The Start button click handler must await Tone.start() before anything else. Do not call it at module load time.
2. Mic constraints for pitch detection
When calling getUserMedia, explicitly disable the processing browsers apply by default:
javascriptnavigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }
})
These defaults are tuned for voice calls and will wreck pitch detection accuracy. Not optional.
3. AudioContext sample rate
Different devices use different sample rates (44.1kHz, 48kHz, sometimes 16kHz). Always pass audioCtx.sampleRate to detector.findPitch(), never hardcode it.
4. Float32Array allocation
Allocate the analysis buffer once at init, reuse every frame. Do not new Float32Array() per frame — GC will cause stutters.
5. PitchDetector creation
Create the pitchy detector once at init:
javascriptconst detector = PitchDetector.forFloat32Array(analyser.fftSize);
It has internal buffers it reuses. Recreating per frame kills performance.
6. Octave handling and boundary math
Convert frequency to MIDI, modulo 12 for pitch class, play in one fixed octave. This prevents octave flicker at octave boundaries.
Correct pitch class math (handle negatives and rounding):
javascriptconst midi = 12 * Math.log2(freq / 440) + 69;
const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
The double-modulo is intentional — JavaScript's % can return negative values.
Boundary test required before declaring done: Verify correct detection at semitone boundaries where off-by-one rounding bugs surface:

B3 → C4 (MIDI 59 → 60, pitch class 11 → 0)
E4 → F4 (MIDI 64 → 65, pitch class 4 → 5)
B4 → C5 (pitch class 11 → 0 across octave boundary)

Sing slow glissandi across these boundaries during testing and verify the displayed pitch class transitions cleanly without flicker between adjacent classes. If the display flickers B ↔ C while you're holding a stable pitch near the boundary, the stability gate is not catching the rounding jitter — raise stabilityMs or investigate.
7. Tone.Sampler loading is async
Samples load asynchronously. await Tone.loaded() before entering the listening loop. Show "Loading samples…" status. If samples fail to load, show which file failed.
8. Sample map keys must match Tone.js note format
Tone.js expects "C4", "C#4", "F#4". Sharps only, not flats. Build the map explicitly:
javascriptconst sampleMap = {
  "C4":  "samples/c.wav",
  "C#4": "samples/cs.wav",
  "D4":  "samples/d.wav",
  // etc.
};
9. triggerAttackRelease vs triggerAttack
Use triggerAttackRelease(note, duration). triggerAttack alone leaves the sample ringing forever and voices pile up.
10. requestAnimationFrame behavior
rAF stops when tab hidden — this is desired. Store the handle so cleanup can cancel it:
javascriptlet rafHandle = null;
function loop() {
  // ...
  rafHandle = requestAnimationFrame(loop);
}
// cleanup:
if (rafHandle) cancelAnimationFrame(rafHandle);
Do NOT replace rAF with setInterval.
11. HTTPS requirement
getUserMedia requires secure context. Document in README that app must be served from HTTPS or localhost.
12. Error states to handle explicitly

Mic permission denied → "Microphone access denied. Tap Start to retry."
Samples failed to load → show which file failed
No mic available → "No microphone detected"
AudioContext fails to start → show the error
Any of the above → run cleanup, re-enable Start button

Never let these fail silently. User will be debugging on phone with no console access.
13. Start button state

Starts enabled, visible
On tap: immediately disable (prevents double-tap)
On successful init: hide entirely
On any error during init: run cleanup, re-show, re-enable
Never leave in "tapped but nothing happening" limbo

14. Debug overlay
Always visible, small gray text, shows:

Current frequency (Hz, 1 decimal)
Current clarity score (2 decimals)
Current RMS amplitude (3 decimals)

Essential for tuning CONFIG to user's voice and environment.
What NOT to do

No build step, package.json, or node_modules
No TypeScript
No framework (React/Vue/Svelte/Lit)
No service worker or PWA manifest in v1
Do not reimplement pitch detection — use pitchy
No features beyond this spec (no recording, exercises, scoring, history)
No visualizations (waveforms, spectrograms, tuners)
Do not smooth detected frequency with moving average before pitch-class conversion — the stability gate handles jitter at the right level
No analytics
Do not cache samples via service worker in v1

Deliverables
1. index.html
HTML shell with inline CSS per spec.
2. app.js
All logic, heavily commented, especially around the state machine.
3. README.md
Must include all sections below.
README section: What the app does
One paragraph.
README section: Sample preparation
Critical for the app to feel consistent. Specify that each of the 12 samples should be:

Trimmed tightly at the start — remove any leading silence. Even 50ms of silence before the sample's first audible moment will make that note feel "late" compared to others. Zoom in and cut to the zero-crossing just before the first transient.
Volume-matched — normalize all 12 to the same peak or perceived loudness (RMS -16 LUFS is a reasonable target). Without this, some notes will feel startlingly loud and others too quiet, which disrupts the training loop.
Same format and sample rate — all WAV, all 44.1kHz, all same bit depth (16-bit is fine). Mixing formats works but is a common source of subtle loading or playback bugs.
Reasonable length — 1.5 to 3 seconds is the sweet spot. Longer samples overlap if the user changes notes quickly. Shorter samples don't give the associative cue time to register.
No fade-out needed — Tone.js handles release envelope.

README section: Deployment to GitHub Pages
Step-by-step:

Create new GitHub repo (public, name it e.g. pitch-trainer)
Put all project files in repo root (not in subfolder)
Commit and push to main branch
Repo Settings → Pages → Source: "Deploy from a branch" → Branch: main → /root → Save
Wait ~1 minute, then visit https://YOURUSERNAME.github.io/pitch-trainer/
On iPhone: open URL in Safari, tap Start, grant mic permission
To update: commit + push. Pages redeploys automatically in ~30 seconds.

README section: Tuning CONFIG
Explain each parameter, expected range, and symptoms of it being too high/low.
README section: Browser support
Name the tested-good browsers and the flaky ones per the Browser Support section above.
README section: Troubleshooting
Cover each known trap from the list above, framed as user-facing symptom → fix.
4. .gitignore
.DS_Store
node_modules/
*.log
.vscode/
.idea/
Testing checklist — verify each before declaring done

 Loads in desktop Chrome on http://localhost without errors
 Start button disables on tap, hides on successful init
 After granting mic, "Listening" status appears
 Humming updates the big pitch class letter
 Corresponding sample plays audibly
 Holding steady note does NOT cause rapid retriggering
 Sliding between notes triggers new samples after stability window
 Going silent and re-humming same note retriggers correctly
 Debug readout shows plausible frequencies (A4 hum ≈ 440Hz)
 Frequency stays accurate across different volumes
 Boundary test: slow glissando B3→C4 shows clean pitch class transition, no B↔C flicker
 Boundary test: slow glissando E4→F4 shows clean transition
 Boundary test: glissando B4→C5 shows clean transition across octave
 Missing sample file → clear error message, app doesn't crash
 Mic permission denied → clear error, Start button re-enabled
 Tap Start twice rapidly → only one init runs
 Induce an init error, verify cleanup: no orphaned audio graph, no leaked mic track (check browser's site settings — mic indicator should go away)
 README deployment steps followable by non-developer

Follow-up features (do not build now, but structure v1 to accommodate)

Delayed feedback mode (1.5s pause after singing stops before sample plays)
Hit/miss logging per pitch class
Quiz mode (play sample → user sings back → verify)
Swap-in alternate sample banks (piano, sine, different PP sets) for timbre rotation
Native iOS port with AudioKit for background operation


Prompts for Claude Code
Initial prompt:

Read PLAN.md. Confirm you understand the spec, then build index.html, app.js, README.md, and .gitignore according to the spec. Don't ask permission between files — build all four, then stop. Pay particular attention to the "Pitch state machine" and "Cleanup behavior" sections — those are the parts most likely to be implemented incorrectly.

After testing prompt template:

Testing on desktop Chrome. Observing: [symptom]. Debug readout shows: freq=X, clarity=Y, RMS=Z. Which CONFIG values should I adjust, or is there a bug in the state machine?

Guardrail prompts if Claude Code drifts

If he adds a build step: "No build step. Libraries load from esm.sh via ES module imports. Re-read 'Tech stack' in PLAN.md."
If he adds TypeScript/React: "Vanilla JS only. Remove and restart."
If pitch detection seems wrong: "Check echoCancellation, noiseSuppression, autoGainControl are all false in getUserMedia. Check audioCtx.sampleRate is passed to detector.findPitch, not hardcoded."
If samples don't play: "Verify Tone.start() is inside Start click handler. Verify await Tone.loaded() before listening loop. Verify sample map keys use sharps."
If display flickers rapidly: "State machine bug. Verify candidatePitchClass, candidateSince, latchedPitchClass, armed are module-scoped, not reset each frame. Walk through the frame logic in PLAN.md section 'Pitch state machine'."
If retry stacks audio graphs: "Cleanup not running. Verify the cleanup function stops mic tracks, cancels rAF, disconnects nodes, closes AudioContext, and disposes Sampler. Run it before every re-init."
If he adds features beyond spec: "Remove anything not in Deliverables. v1 is intentionally minimal."


That's the full updated spec. The key structural improvements from your additions:

Cleanup is now a first-class concern rather than an afterthought — it's defined as a named behavior with an ordered checklist, referenced from multiple places that need it.
The state machine has names, which means Claude Code will produce code that matches the mental model in the spec rather than inventing his own variable names and drifting in subtle ways.
Boundary testing is explicit in the checklist, so he can't mark the work done without actually verifying the off-by-one cases.
Sample prep guidance lives in the README section, where it'll actually reach you when you're preparing samples rather than being buried in a general "tips" pile.
The cooldown is optional and default-off, which is the right call — it preserves it as a tool without letting it mask state machine bugs during initial testing.
Browser support is scoped upfront, so when Firefox mobile misbehaves, the answer is "known, out of scope" rather than "let's debug."