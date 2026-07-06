// Learn tab — a progressive ear-training curriculum.
//
// Phases build from the smallest subunit up:
//   1. Pitches   — single notes, PP MIDI samples as the crutch; the answer
//                  pool grows by one note every 10 correct reps.
//   2. Intervals — memorize the sound of TWO specific voicings of one interval
//                  at different octaves (e.g. C3–E3 vs A4–C#5). ~half the reps
//                  overlay the PP MIDI samples as a crutch, half are clean.
//   3. Triads    — major vs minor, then root ID.
//   4. Voicings  — 4-note 7th chords (maj7 / min7 / dom7).
//
// Progress persists in localStorage so the path resumes where you left off.
// Everything renders into #learn; index.html only supplies the empty container.

const LS_KEY = "pt.learn.v1";

const POOL_ORDER = ["C", "E", "G", "A", "D", "F", "B", "C#", "D#", "F#", "G#", "A#"];

const INTERVAL_LABELS = {
  1: "m2", 2: "M2", 3: "m3", 4: "M3", 5: "P4", 6: "TT",
  7: "P5", 8: "m6", 9: "M6", 10: "m7", 11: "M7", 12: "P8",
};

const PHASES = [
  { key: "pitches",  icon: "🎯", name: "Pitches",   blurb: "Single notes with the PP-MIDI crutch. Pool grows as you nail it." },
  { key: "intervals",icon: "🎼", name: "Intervals", blurb: "Memorize two specific voicings of one interval, by absolute sound." },
  { key: "triads",   icon: "🎹", name: "Triads",    blurb: "Memorize two specific triad voicings by absolute sound." },
  { key: "voicings", icon: "🧩", name: "Voicings",  blurb: "Two specific 7th-chord voicings, discriminated by ear." },
];

const REPS_PER_NOTE   = 10;   // correct reps before the pitch pool grows
const INTERVAL_SET    = 12;   // reps before a new option set is drawn
const PHASE_UNLOCK_AT = 20;   // correct reps to unlock the next phase (2-4)
const DISCRIM_OPTIONS = 3;    // # of absolute options (A/B/C) to discriminate

const LETTERS = ["A", "B", "C", "D", "E", "F"];

// Faded scaffolding: the PP-MIDI crutch starts loud and fades a notch with
// each first-try-correct, then jumps back up when you miss. "strength" is a
// 0..1 value persisted per phase; 1 = full crutch, 0 = no crutch (clean).
const CRUTCH_FADE = 0.15;     // strength removed per first-try correct (~7 to fade)
const CRUTCH_BUMP = 0.6;      // strength restored on a wrong answer

// Chord types for the absolute-discrimination phases. Both voicings in a pair
// share one type so you're memorizing the absolute sound/register, not
// telling quality apart relatively.
const TRIAD_TYPES   = { Major: [0, 4, 7], Minor: [0, 3, 7] };
const SEVENTH_TYPES = { maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10] };

export function setupLearn(ctx) {
  const { Tone, PITCH_NAMES } = ctx;
  const root = document.getElementById("learn");

  let prog = loadProg();
  let view = "home";       // "home" | "trainer"
  let phaseKey = null;
  let session = null;      // per-trainer transient state
  let ready = false;
  let autoNext = localStorage.getItem("pt.learn.autonext") === "1";
  let autoNextTimer = null;

  // ---- persistence ----
  function loadProg() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) {}
    // Per-pitch-class crutch strength (0..1). This is the core mastery model:
    // each note tracks how much scaffolding it still needs, so notes you know
    // cold (say Eb, C) lose the crutch while shakier ones keep it. Shared across
    // every phase — a note learned in one context is learned everywhere.
    const notes = {};
    PITCH_NAMES.forEach((n) => { notes[n] = 1; });
    // Spread saved-over-defaults so new fields backfill onto existing progress.
    return {
      unlocked: PHASES.length,                    // dev: all phases unlocked
      notes:    { ...notes, ...(p.notes || {}) },
      pitches:  { pool: 3, correctInPool: 0, total: 0, ...(p.pitches   || {}) },
      intervals:{ semis: 4, reps: 0, correct: 0,        ...(p.intervals || {}) },
      triads:   { correct: 0, type: "Major",           ...(p.triads    || {}) },
      voicings: { correct: 0, type: "maj7",            ...(p.voicings  || {}) },
    };
  }
  function saveProg() { try { localStorage.setItem(LS_KEY, JSON.stringify(prog)); } catch (_) {} }

  // ---- audio helpers ----
  function noteName(pc, oct) { return `${pc}${oct}`; }
  function midiName(midi)    { return Tone.Frequency(midi, "midi").toNote(); }
  function pcOctToMidi(pc, oct) { return 12 * (oct + 1) + pc; } // C4 = 60
  function playPiano(names, dur = "1n", vel = 0.85, gap = 0) {
    const piano = ctx.getPiano();
    if (!piano) return;
    const now = Tone.now();
    const list = Array.isArray(names) ? names : [names];
    list.forEach((n, i) => {
      try { piano.triggerAttackRelease(n, dur, now + i * gap, vel); } catch (_) {}
    });
  }
  // ---- per-note crutch scheduling ----
  // The piano note is the TARGET and always plays at full clarity. The song-cue
  // sample is layered UNDER it as the crutch, capped well below the piano so it
  // supports rather than masks — and it fades per note as that note is learned.
  function crutchGainDb(strength) {
    if (strength <= 0.05) return null;   // faded out — clean piano only
    return -8 - (1 - strength) * 12;     // strength 1 → -8 dB (under the piano), fading to ~-19
  }
  function noteStrength(name) { return prog.notes[name] ?? 1; }
  function fadeNote(name, amt = CRUTCH_FADE) { prog.notes[name] = Math.max(0, noteStrength(name) - amt); }
  function bumpNote(name, amt = CRUTCH_BUMP) { prog.notes[name] = Math.min(1, noteStrength(name) + amt); }

  // Overlay one or more pitch classes (by NAME) at each note's own crutch level.
  // Always the original-pitch sample — never pitch-shifted — so it aligns by
  // pitch class with its own OG note regardless of the target's octave.
  function overlayByMastery(names, full = false) {
    const bank = ctx.getBank();
    if (!bank) return;
    names.forEach((name) => {
      const db = full ? -8 : crutchGainDb(noteStrength(name));
      if (db !== null) bank.play(name, { volume: db });
    });
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  function render() {
    if (view === "home") return renderHome();
    return renderTrainer();
  }

  function renderHome() {
    const cards = PHASES.map((ph, i) => {
      const locked = i + 1 > prog.unlocked;
      const sub = phaseSubtitle(ph.key, i, locked);
      return `
        <button class="learn-card ${locked ? "locked" : ""}" data-phase="${ph.key}" ${locked ? "disabled" : ""}>
          <div class="learn-card-icon">${locked ? "🔒" : ph.icon}</div>
          <div class="learn-card-body">
            <div class="learn-card-title">${ph.name}</div>
            <div class="learn-card-blurb">${ph.blurb}</div>
            <div class="learn-card-sub">${sub}</div>
          </div>
          <div class="learn-card-chev">${locked ? "" : "›"}</div>
        </button>`;
    }).join("");

    root.innerHTML = `
      <div class="learn-home">
        <h1 class="screen-title">Learn</h1>
        <p class="screen-sub">Build from single notes up to voicings. Finish a phase to unlock the next.</p>
        <div class="learn-cards">${cards}</div>
      </div>`;

    root.querySelectorAll(".learn-card:not(.locked)").forEach((b) =>
      b.addEventListener("click", () => enterTrainer(b.dataset.phase))
    );
  }

  function phaseSubtitle(key, i, locked) {
    if (locked) return "Locked";
    if (key === "pitches") {
      const p = prog.pitches;
      return `Pool ${p.pool}/12 · ${p.correctInPool}/${REPS_PER_NOTE} to next note`;
    }
    if (key === "intervals") {
      const p = prog.intervals;
      return `${INTERVAL_LABELS[p.semis]} · ${Math.min(p.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT} to advance`;
    }
    if (key === "triads")   return `${prog.triads.type} · ${Math.min(prog.triads.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT} to advance`;
    if (key === "voicings") return `${prog.voicings.type} · ${Math.min(prog.voicings.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT} to advance`;
    return "";
  }

  function renderTrainer() {
    const ph = PHASES.find((p) => p.key === phaseKey);
    root.innerHTML = `
      <div class="trainer">
        <div class="trainer-top">
          <button class="icon-btn" id="learn-back">‹ Back</button>
          <div class="trainer-title">${ph.icon} ${ph.name}</div>
          <div class="trainer-score" id="learn-score"></div>
        </div>
        <div class="trainer-progress"><div class="trainer-progress-bar" id="learn-bar"></div></div>
        <div class="trainer-prompt" id="learn-prompt"></div>
        <div class="trainer-answers" id="learn-answers"></div>
        <div class="trainer-actions">
          <button class="ghost" id="learn-replay">play again ↺</button>
          <button class="ghost" id="learn-hint" style="display:none">hint ♪</button>
          <button class="ghost" id="learn-next" style="visibility:hidden">next →</button>
        </div>
        <label class="autonext"><input type="checkbox" id="learn-autonext"> auto-next on correct</label>
      </div>`;

    root.querySelector("#learn-back").addEventListener("click", () => { cancelAutoNext(); view = "home"; render(); });
    root.querySelector("#learn-replay").addEventListener("click", () => replay());
    root.querySelector("#learn-hint").addEventListener("click", () => hint());
    root.querySelector("#learn-next").addEventListener("click", () => { cancelAutoNext(); nextRound(); });
    const autoCb = root.querySelector("#learn-autonext");
    autoCb.checked = autoNext;
    autoCb.addEventListener("change", () => {
      autoNext = autoCb.checked;
      localStorage.setItem("pt.learn.autonext", autoNext ? "1" : "0");
    });

    startRound();
  }

  const $ = (id) => root.querySelector(id);
  function setPrompt(html)     { const e = $("#learn-prompt"); if (e) e.innerHTML = html; }
  function setScore(txt)       { const e = $("#learn-score");  if (e) e.textContent = txt; }
  function setBar(frac)        { const e = $("#learn-bar");    if (e) e.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; }
  function showNext(v)         { const e = $("#learn-next");   if (e) e.style.visibility = v ? "visible" : "hidden"; }
  function showHint(v)         { const e = $("#learn-hint");   if (e) e.style.display = v ? "" : "none"; }
  function setAnswers(html)    { const e = $("#learn-answers");if (e) e.innerHTML = html; }

  // =========================================================================
  // Round dispatch
  // =========================================================================
  function cancelAutoNext() {
    if (autoNextTimer) { clearTimeout(autoNextTimer); autoNextTimer = null; }
  }
  // Call after a correct answer; advances automatically if the toggle is on.
  function maybeAutoNext(delay = 850) {
    if (!autoNext) return;
    cancelAutoNext();
    autoNextTimer = setTimeout(() => { autoNextTimer = null; startRound(); }, delay);
  }

  function startRound() {
    if (!ready) { setPrompt("Loading sounds…"); return; }
    cancelAutoNext();
    showNext(false);
    if (phaseKey === "pitches")   return startPitches();
    if (phaseKey === "intervals") return startIntervals();
    if (phaseKey === "triads")    return startChordDiscrim("triads");
    if (phaseKey === "voicings")  return startChordDiscrim("voicings");
  }
  function nextRound() { startRound(); }
  function replay()    { if (session && session.replay) session.replay(); }
  function hint()      { if (session && session.hint) session.hint(); }

  // ---- Phase 1: Pitches ------------------------------------------------------
  // The target sound is a plain piano note; the PP-MIDI song-cue is layered
  // UNDER it as the crutch and fades out per note as that note is learned.
  // `note` is a pitch-class NAME (e.g. "C", "Eb"→"D#"), matching POOL_ORDER.
  function playPitch(note, oct, full = false) {
    playPiano(`${note}${oct}`, "1n", 0.95);
    overlayByMastery([note], full);
  }
  // Weighted pick: notes that still need the crutch come up more often, but
  // mastered notes still get occasional review (spaced-repetition style).
  function pickPitch(pool) {
    const weights = pool.map((n) => 0.2 + noteStrength(n));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function startPitches() {
    const pool = POOL_ORDER.slice(0, prog.pitches.pool);
    const note = pickPitch(pool);
    // Random octave straddling middle C (3 or 4 → C3…B4) so you can't anchor to
    // a fixed register and slip into relative pitch.
    const oct = 3 + Math.floor(Math.random() * 2);
    session = {
      note,
      oct,
      attempts: 0,
      replay: () => playPitch(note, oct),
      hint:   () => playPiano(`${note}${oct}`, "2n", 0.9), // clean note, no crutch
    };
    setScore(`pool ${prog.pitches.pool}/12`);
    setBar(prog.pitches.correctInPool / REPS_PER_NOTE);
    setPrompt(`Which note is this?`);
    showHint(true);

    const btns = pool.map((n) =>
      `<button class="answer-btn small" data-pc="${n}">${n}</button>`
    ).join("");
    setAnswers(btns);
    root.querySelectorAll("#learn-answers button[data-pc]").forEach((b) =>
      b.addEventListener("click", () => answerPitch(b.dataset.pc))
    );

    playPitch(note, oct);
  }
  function answerPitch(guess) {
    if (!session || session.done) return;
    session.attempts++;
    const correct = guess === session.note;
    if (correct) {
      session.done = true;
      if (session.attempts === 1) {
        fadeNote(session.note);
        prog.pitches.correctInPool++;
        prog.pitches.total++;
        if (prog.pitches.correctInPool >= REPS_PER_NOTE) {
          if (prog.pitches.pool < 12) {
            prog.pitches.pool++;
            prog.pitches.correctInPool = 0;
            unlockGate(1);
            setPrompt(`✅ ${session.note} — new note unlocked: <b>${POOL_ORDER[prog.pitches.pool - 1]}</b>`);
          } else {
            prog.pitches.correctInPool = REPS_PER_NOTE;
            unlockGate(1);
            setPrompt(`✅ ${session.note} — all 12 notes in play! Intervals unlocked.`);
          }
        } else {
          setPrompt(`✅ ${session.note}`);
        }
      } else {
        setPrompt(`✅ ${session.note}`);
      }
      saveProg();
      setBar(prog.pitches.correctInPool / REPS_PER_NOTE);
      showNext(true);
      maybeAutoNext();
    } else {
      bumpNote(session.note);
      saveProg();
      setPrompt(`❌ Not ${guess}. Crutch back on for ${session.note}…`);
      setTimeout(() => playPitch(session.note, session.oct), 350);
    }
  }

  // ---- Phase 2: Intervals (2-voicing discrimination) -------------------------
  // A and B are two fixed ROOT pitch classes (same interval on top). Each round
  // the octave is re-rolled from the two octaves around middle C, so the pair is
  // learned octave-independently and can't be anchored to a fixed register.
  function pickDistinctRoots(n) {
    const roots = [];
    let guard = 0;
    while (roots.length < n && guard < 300) {
      const r = Math.floor(Math.random() * 12);
      if (!roots.includes(r)) roots.push(r);
      guard++;
    }
    return roots;
  }
  function drawIntervalSet(semis) {
    return pickDistinctRoots(DISCRIM_OPTIONS).map((rootPc) => ({
      rootPc,
      topPc: (rootPc + semis) % 12,
      label: `${PITCH_NAMES[rootPc]}–${PITCH_NAMES[(rootPc + semis) % 12]}`,
    }));
  }
  function intervalPianoNames(v, oct) {
    const rootMidi = pcOctToMidi(v.rootPc, oct);
    return [midiName(rootMidi), midiName(rootMidi + prog.intervals.semis)];
  }
  function playInterval(v, oct, full = false) {
    playPiano(intervalPianoNames(v, oct), "1n", 0.95);
    overlayByMastery([PITCH_NAMES[v.rootPc], PITCH_NAMES[v.topPc]], full);
  }
  function hintInterval(v, oct) {
    // Separate notes, no crutch — nothing else.
    playPiano(intervalPianoNames(v, oct), "2n", 0.9, 0.45);
  }
  function startIntervals() {
    const semis = prog.intervals.semis;
    if (!session || !session.pair || session.setReps >= INTERVAL_SET) {
      session = { pair: drawIntervalSet(semis), setReps: 0 };
    }
    const which = Math.floor(Math.random() * session.pair.length);
    const oct = 3 + Math.floor(Math.random() * 2); // re-roll octave each round
    session.which = which;
    session.oct = oct;
    session.done = false;
    session.attempts = 0;
    session.replay = () => playInterval(session.pair[which], oct);
    session.hint   = () => hintInterval(session.pair[which], oct);

    setScore(`${INTERVAL_LABELS[semis]} · ${Math.min(prog.intervals.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`);
    setBar(Math.min(prog.intervals.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
    setPrompt(`Which one did you hear?`);
    showHint(true);

    const btns = session.pair.map((v, i) =>
      `<button class="voicing-btn" data-which="${i}"><b>${LETTERS[i]}</b><span>${v.label}</span></button>`
    ).join("");
    setAnswers(`
      <div class="voicing-choices">${btns}</div>
      <div class="interval-picker">
        <label>Interval
          <select id="learn-int-sel">
            ${Object.entries(INTERVAL_LABELS).map(([s, l]) =>
              `<option value="${s}" ${+s === semis ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
      </div>`);
    root.querySelectorAll(".voicing-btn").forEach((b) =>
      b.addEventListener("click", () => answerInterval(+b.dataset.which))
    );
    const sel = $("#learn-int-sel");
    if (sel) sel.addEventListener("change", () => {
      prog.intervals.semis = parseInt(sel.value, 10);
      saveProg();
      session = null;
      startIntervals();
    });

    playInterval(session.pair[which], oct);
  }
  function answerInterval(which) {
    if (!session || session.done) return;
    session.attempts++;
    const correct = which === session.which;
    const v = session.pair[session.which];
    const heard = [PITCH_NAMES[v.rootPc], PITCH_NAMES[v.topPc]];
    if (correct) {
      session.done = true;
      session.setReps++;
      if (session.attempts === 1) {
        heard.forEach((n) => fadeNote(n, CRUTCH_FADE * 0.5)); // indirect evidence → gentler fade
        prog.intervals.reps++;
        prog.intervals.correct++;
        if (prog.intervals.correct >= PHASE_UNLOCK_AT) unlockGate(2);
        saveProg();
      }
      setPrompt(`✅ ${LETTERS[which]} — ${session.pair[which].label}`);
      setBar(Math.min(prog.intervals.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
      setScore(`${INTERVAL_LABELS[prog.intervals.semis]} · ${Math.min(prog.intervals.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`);
      showNext(true);
      maybeAutoNext();
    } else {
      heard.forEach((n) => bumpNote(n));
      saveProg();
      setPrompt(`❌ Not that one. Crutch back on…`);
      setTimeout(() => playInterval(session.pair[session.which], session.oct), 350);
    }
  }

  // ---- Phases 3 & 4: chord discrimination (absolute) -------------------------
  // Same idea as the Intervals phase, one level up: draw TWO specific voicings
  // of one chord type at different roots/octaves, play one, and identify which
  // exact voicing it was. ~half the reps carry the PP-MIDI crutch.
  function chordConfig(phaseKey) {
    if (phaseKey === "triads") {
      return { prog: prog.triads, types: TRIAD_TYPES, phaseIndex: 3, name: "Triad" };
    }
    return { prog: prog.voicings, types: SEVENTH_TYPES, phaseIndex: 4, name: "Voicing" };
  }
  // Identity is the ROOT pitch class; octave re-rolls each round (same as
  // Intervals) so triads/voicings are learned octave-independently.
  function drawChordSet(intervals) {
    return pickDistinctRoots(DISCRIM_OPTIONS).map((rootPc) => ({
      rootPc,
      tones: intervals.map((iv) => (rootPc + iv) % 12),
      label: PITCH_NAMES[rootPc],
    }));
  }
  function chordNoteNames(v) { return v.tones.map((t) => PITCH_NAMES[t]); }
  function chordPianoNames(v, oct) {
    const rootMidi = pcOctToMidi(v.rootPc, oct);
    return session.intervals.map((iv) => midiName(rootMidi + iv));
  }
  function playChord(v, oct, full = false) {
    playPiano(chordPianoNames(v, oct), "1n", 0.95);
    overlayByMastery(chordNoteNames(v), full);
  }
  function hintChord(v, oct) {
    // Separate notes, no crutch — nothing else.
    playPiano(chordPianoNames(v, oct), "2n", 0.9, 0.4);
  }
  function startChordDiscrim(phaseKey) {
    const cfg = chordConfig(phaseKey);
    const type = cfg.prog.type;
    const intervals = cfg.types[type];

    if (!session || !session.pair || session.type !== type || session.setReps >= INTERVAL_SET) {
      session = { pair: drawChordSet(intervals), setReps: 0, type };
    }
    session.intervals = intervals;
    const which = Math.floor(Math.random() * session.pair.length);
    const oct = 3 + Math.floor(Math.random() * 2); // re-roll octave each round
    session.which = which;
    session.oct = oct;
    session.done = false;
    session.attempts = 0;
    session.replay = () => playChord(session.pair[which], oct);
    session.hint   = () => hintChord(session.pair[which], oct);

    const scoreTxt = `${type} · ${Math.min(cfg.prog.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`;
    setScore(scoreTxt);
    setBar(Math.min(cfg.prog.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
    setPrompt(`Which one did you hear?`);
    showHint(true);

    const typeOpts = Object.keys(cfg.types)
      .map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${t}</option>`).join("");
    const btns = session.pair.map((v, i) =>
      `<button class="voicing-btn" data-which="${i}"><b>${LETTERS[i]}</b><span>${v.label} ${type}</span></button>`
    ).join("");
    setAnswers(`
      <div class="voicing-choices">${btns}</div>
      <div class="interval-picker">
        <label>${cfg.name} type
          <select id="learn-chord-sel">${typeOpts}</select>
        </label>
      </div>`);
    root.querySelectorAll(".voicing-btn").forEach((b) =>
      b.addEventListener("click", () => answerChordDiscrim(phaseKey, +b.dataset.which))
    );
    const sel = $("#learn-chord-sel");
    if (sel) sel.addEventListener("change", () => {
      cfg.prog.type = sel.value;
      saveProg();
      session = null;
      startChordDiscrim(phaseKey);
    });

    playChord(session.pair[which], oct);
  }
  function answerChordDiscrim(phaseKey, which) {
    if (!session || session.done) return;
    const cfg = chordConfig(phaseKey);
    session.attempts++;
    const correct = which === session.which;
    const heard = chordNoteNames(session.pair[session.which]);
    if (correct) {
      session.done = true;
      session.setReps++;
      if (session.attempts === 1) {
        heard.forEach((n) => fadeNote(n, CRUTCH_FADE * 0.4)); // indirect → gentle fade
        cfg.prog.correct++;
        if (cfg.prog.correct >= PHASE_UNLOCK_AT) unlockGate(cfg.phaseIndex);
        saveProg();
      }
      const v = session.pair[which];
      setPrompt(`✅ ${LETTERS[which]} — ${v.label} ${session.type}`);
      setBar(Math.min(cfg.prog.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
      setScore(`${session.type} · ${Math.min(cfg.prog.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`);
      showNext(true);
      maybeAutoNext();
    } else {
      heard.forEach((n) => bumpNote(n));
      saveProg();
      setPrompt(`❌ Not that one. Crutch back on…`);
      setTimeout(() => playChord(session.pair[session.which], session.oct), 350);
    }
  }

  // ---- unlock helper ----
  function unlockGate(phaseIndexJustCleared) {
    // phaseIndexJustCleared is 1-based position of the phase that grants unlock.
    if (prog.unlocked < phaseIndexJustCleared + 1) {
      prog.unlocked = phaseIndexJustCleared + 1;
      saveProg();
    }
  }

  // =========================================================================
  // Enter / exit (called by app.js switchMode)
  // =========================================================================
  async function enterTrainer(key) {
    phaseKey = key;
    view = "trainer";
    session = null;
    render();
  }

  return {
    async enter() {
      prog = loadProg();
      view = "home";
      render();
      ctx.setStatus("Loading Learn…");
      try {
        await Promise.all([ctx.ensureSampleBank(), ctx.ensurePiano()]);
        ready = true;
        ctx.setStatus("Learn");
        if (view === "trainer") startRound();
      } catch (err) {
        ctx.setStatus(err && err.message ? err.message : String(err), true);
      }
    },
    exit() {
      session = null;
      view = "home";
    },
  };
}
