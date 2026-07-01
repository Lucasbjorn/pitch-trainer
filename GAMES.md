# Mini-Game Ideas — Pitch Trainer

Backlog of ear-training games to add. The shared goal is **strengthening absolute pitch (AP)** and **weakening the brain's reflex to fall back on relative pitch (RP)**. Notes on why each game serves that goal are included so future-you (or future Claude) can keep the design honest when building.

Conventions used below:
- "Sample" = a clip from the existing `samples/` library (the song-cue library that the passive mode uses).
- "Synth tone" = a Tone.js-generated sound (`Tone.Synth`, `Tone.Oscillator`, `Tone.Sampler` of a piano), **not** drawn from `samples/`.
- "Cold start" = no reference tone played in the seconds before the question. This is critical for AP training — if any pitch is in working memory, the brain solves the question with RP.

---

## 1. Note ID — multiple choice (user-described, top priority)

**Mechanic:**
1. Play a single note as a synth tone (piano, sine, or selectable). Not from `samples/`.
2. Show 3 buttons, each labeled with a pitch class. One is correct, two are distractors.
3. User taps an answer.
   - Tapping plays the *sample* for the chosen pitch class (so the user gets the auditory cue for the answer they're considering).
   - User can keep tapping different answer buttons to compare — only the **first** tap counts toward score.
   - Correct/wrong feedback can be shown after the first tap, or only after "Next."
4. "Next" button advances to a new round.

**Distractor selection:** picking distractors at random produces too many easy rounds (e.g. C vs F# vs A). Better:
- One distractor a semitone away (hard).
- One distractor a perfect 4th or 5th away (medium).
- Or randomize among "1 semitone, 2 semitones, 5 semitones" relative to correct.

**Why this trains AP:** the synth tone is timbrally neutral, so the user can't lean on a song memory to identify it. Hearing the *sample* after answering reinforces the pitch-class → song association in the right direction (label first, cue second).

**Scoring:** percent correct on first guess; per-pitch-class breakdown (so user can see "I'm bad at D# specifically").

---

## 2. Guess the Chord (user-described)

**Mechanic:**
1. Play a chord built by triggering 3 samples from `samples/` simultaneously.
2. User selects the chord type (major / minor) and root.
3. Inversions: root, first, second — randomize.

**Implementation note:** trigger three `sampler.triggerAttackRelease()` calls with the appropriate notes at the same `Tone.now()`. The samples are short song-cues — they'll voice-overlap into a recognizable chord.

**Progression tiers:**
- **Tier 1**: major triads only, root position only, fixed octave. User picks root pitch class.
- **Tier 2**: major + minor, root position. User picks root + quality.
- **Tier 3**: add inversions. UI shows root/quality/inversion or just "name the chord."
- **Tier 4**: add 7ths (maj7, min7, dom7), sus2/sus4.
- **Tier 5**: add diminished and augmented.

**Why this trains AP:** chord identification is usually done via interval relationships (RP). By forcing root identification *first*, you must hear the root as an absolute pitch class, not relative to something. Inversions specifically punish RP-only listeners since the bass note moves.

**Distractor controls:** offer answer buttons that group by quality (major/minor/dim) rather than by interval intuition. No "play a reference note" button — that defeats the purpose.

---

## 3. Minor Pentatonic Scale Listening (user-described)

**Mechanic:**
1. Pick a random root (12 keys).
2. Play the minor pentatonic scale up and down using synth tones (or samples, optional toggle).
3. Display the root key and the notes as they play.
4. Loop a few times, then move to a new key.

**Minor pentatonic intervals:** root, ♭3, 4, 5, ♭7 (5 notes per octave).

**Configurable:**
- Tempo (ms per note)
- Number of repeats per key before changing
- Octave range (1 octave, 2 octaves)
- Synth choice (piano sample, sine, triangle)
- Optional: highlight root note (color or louder)

**Why this trains AP:** ambient soaking — passive listening with the root *labeled* builds key recognition. The scale shape is always the same intervallically, so the brain has to anchor on the absolute root pitch rather than the scale pattern.

**Variant:** "key change quiz" — at the start of each new key, pause and ask the user to name the new root before revealing.

---

## 4. Cold-Start Single Note ID (no multiple choice)

Like Game 1 but harder — type the answer (or pick from all 12 buttons in a circle of fifths layout). Forces full recall instead of recognition.

**Anti-cheat:** after each round, play 1–2 seconds of pink/brown noise to flush short-term pitch memory. This is crucial for AP — without it, the user just compares each note to the one before.

---

## 5. Timbre-Invariant Note ID

Same as Game 4, but each round uses a **different timbre** — sine, square, sawtooth, piano sample, voice sample, bell, etc. The user must identify pitch class regardless of timbre.

**Why this matters:** AP is the ability to identify pitch *as an attribute*, separate from instrument. Practicing across timbres breaks any timbre-specific cheats (e.g. "I only know C# on a piano").

---

## 6. Octave-Invariant Note ID

Same as Game 4, but the random note is played in a random octave (e.g. C2, C5, C7). The user identifies the **pitch class** only, ignoring octave.

**Why:** AP at the pitch-class level is the foundational layer. Some people develop full pitch-with-octave AP, but pitch class is the more useful and trainable target.

---

## 7. Spaced-Repetition Drill

Wraps any of Games 1, 4, 5, 6 with a per-pitch-class accuracy tracker. Notes the user gets wrong come up more often. Notes the user nails get pushed to longer intervals (Leitner-style boxes).

**Persistence:** localStorage so progress survives reloads. Show a 12-cell heatmap of per-class accuracy on the start screen.

**Why:** the most efficient way to improve AP is to spend most of your time on the classes you're weakest at, not on the ones you already know.

---

## 8. Drone Training

A continuous drone tone plays in the background (configurable pitch class — "today's key"). The user sings notes; the app detects them and shows the pitch class **relative to the drone** (e.g. "you're singing the 5th"). After a few minutes, switch the drone (with notice) and see if the user can re-anchor.

**Why:** the drone establishes a stable reference *temporarily*. Switching it forces re-grounding to absolute pitch. Indian classical music uses this exact mechanism for Shruti training.

**This is the most ambient AP exercise** — can run while doing other things.

---

## 9. Song-Start Reverse Quiz

Inverse of the existing passive mode:
- The app names a pitch class.
- The user must hum/sing the correct pitch.
- The app's pitch detector confirms.
- After correct, the corresponding sample plays as reinforcement.

**Why:** active production tests deeper recall than passive recognition. Singing engages motor memory, which interleaves with pitch memory and tends to stick.

---

## 10. Fast-Fade Recognition

Tone plays for a configurable short duration (200ms → 100ms → 50ms as user advances). User identifies. Forces snap recognition rather than analytical comparison.

**Why:** AP holders typically identify pitches in under 100ms — they hear the note as a category, not as a comparison process. Building this speed is what shifts the brain from "calculate" to "recognize."

---

## 11. Find the Wrong Note

Play an ascending scale, arpeggio, or familiar melody. One note is detuned by ±50¢ or replaced with a wrong pitch. User identifies *which* note was wrong.

**Why:** trains the "feel" of in-tune absolute pitches in context. Variant of the existing tune/off-tune quiz with melody-level structure.

---

## 12. Cross-Modal Anchoring (color or shape)

Assign each pitch class a color (or shape, or emoji). User practices both directions:
- See color → name pitch
- Hear pitch → name color

This is the "synesthesia trick" — many AP holders report seeing pitches as colors. Reverse-engineering it via deliberate practice builds a non-linguistic anchor for each class.

**Implementation:** a settings page where the user picks their color mapping (or accepts a default). Then a Game-1-style quiz where buttons are colored swatches instead of letters.

---

## 13. Key-of-the-Day Mode

Settings: pick a "key for today." Throughout the day (or a session), all training games play notes only in that key. After a few days in one key, the user develops a strong absolute reference for *that* key, then rotates.

**Why:** trying to learn all 12 pitch classes simultaneously is the standard way AP training fails. Training one class deeply, then another, builds stable anchors.

---

## 14. Sing Back After Delay

Play a note. Wait 3–5 seconds (showing a countdown). Then ask the user to sing it. Pitch detector confirms accuracy.

**Why:** working memory for pitch decays in seconds for non-AP listeners. The delay defeats short-term auditory memory and forces the user to encode the pitch *as a label* (which is what AP does naturally).

---

## 15. Recall Without Hearing

Show a pitch class label (e.g. "F#"). User must sing it cold, no reference tone, no playback. Pitch detector grades accuracy in cents.

**Why:** the deepest test of AP — pure label-to-pitch recall, no auditory input at all. Most ambitious target.

---

## Cross-cutting notes

- **Always default to cold start** (no reference, no preceding note) for AP-targeted games. Add a "play a reference C first" option only as a beginner crutch.
- **Track per-pitch-class accuracy** in localStorage across all games. Surface it as a heatmap on the home screen.
- **Sample bank rotation**: long-term, having multiple sample sets (piano, voice, bells, the user's own song-cues) and rotating them weekly prevents the brain from over-fitting to one timbre.
- **Avoid interval-based UI** (e.g. "what interval?", "name the 3rd of this chord"). Those games actively reinforce RP and would compete with AP development.
- **Allow turning the visible debug overlay off** during quiz games — it's distracting and the freq display is a hint.
- **Mobile UX**: every game should be tappable one-handed, no small targets, big readable feedback.

## Build-order suggestion

If picking what to build next:
1. **Game 3** (Minor pentatonic listener) — easiest to build, immediate value, no scoring logic.
2. **Game 1** (Note ID multiple choice) — moderate, sets up the scoring/tracking infrastructure that later games reuse.
3. **Game 7** (Spaced-repetition wrapper) — once Game 1 exists, layering SRS on top is small additional code and dramatically increases practice efficiency.
4. **Game 2** (Chord ID) — depends on having sample-overlap working cleanly; build after #1.
5. **Game 8** (Drone training) — combines passive mode's pitch detector with a continuous-tone playback layer; nontrivial but powerful.

Everything else is incremental.
