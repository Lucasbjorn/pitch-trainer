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

import { recordNote, recordInterval, recordNotes } from "./stats.js";

const LS_KEY = "pt.learn.v1";

const POOL_ORDER = ["C", "E", "G", "A", "D", "F", "B", "C#", "D#", "F#", "G#", "A#"];

// Pattern phase — short absolute phrases, defined as semitone offsets from a
// root. Generic pedagogical shapes; add your own by extending this list.
const PATTERNS = [
  { key: "1235",     name: "1–2–3–5 (major)",     offs: [0, 2, 4, 7] },
  { key: "123up",    name: "1–2–3 up",            offs: [0, 2, 4] },
  { key: "chromdn",  name: "chromatic down ×4",   offs: [0, -1, -2, -3] },
  { key: "arp",      name: "major arpeggio",      offs: [0, 4, 7, 12] },
  { key: "minarp",   name: "minor arpeggio",      offs: [0, 3, 7, 12] },
  { key: "enclose",  name: "upper enclosure",     offs: [0, 2, 1, -1, 0] },
  { key: "desccell", name: "descending cell",      offs: [0, -2, -7, 1, 0, -2] },
];

const INTERVAL_LABELS = {
  1: "m2", 2: "M2", 3: "m3", 4: "M3", 5: "P4", 6: "TT",
  7: "P5", 8: "m6", 9: "M6", 10: "m7", 11: "M7", 12: "P8",
};

const PHASES = [
  { key: "pitches",  icon: "🎯", name: "Pitches",   blurb: "Single notes with the PP-MIDI crutch. Pool grows as you nail it." },
  { key: "intervals",icon: "🎼", name: "Intervals", blurb: "Memorize two specific voicings of one interval, by absolute sound." },
  { key: "triads",   icon: "🎹", name: "Triads",    blurb: "Discriminate 3 triad voicings by absolute sound." },
  { key: "voicings", icon: "🧩", name: "Voicings",  blurb: "Three 7th-chord voicings, discriminated by ear." },
  { key: "pattern",  icon: "🎶", name: "Pattern",   blurb: "Learn a lick absolutely, then spot it in every key." },
  { key: "relative", icon: "🔭", name: "Wide Leap", blurb: "Two notes octaves apart — name the top note or the interval." },
  { key: "yesno",    icon: "✅", name: "Yes / No",  blurb: "A piano note — does it match the note shown?" },
];

const REPS_PER_NOTE   = 10;   // correct reps before the pitch pool grows
const INTERVAL_SET    = 12;   // reps before a new option set is drawn
const PHASE_UNLOCK_AT = 20;   // correct reps to unlock the next phase (2-4)
const DISCRIM_OPTIONS = 3;    // # of absolute options (A/B/C) to discriminate
const AWARD_STREAK    = 15;   // mirrors stats.js; shown in the celebration
const FORCE_DB        = -4;   // clearly-audible level for hint/decompose/training-wheels crutch

const LETTERS = ["A", "B", "C", "D", "E", "F"];
// Simple-interval names indexed by (compound semitones % 12); 0 = octave(s).
const REL_LABELS = ["8ve", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7"];

// Faded scaffolding: the PP-MIDI crutch starts loud and fades a notch with
// each first-try-correct, then jumps back up when you miss. "strength" is a
// 0..1 value persisted per phase; 1 = full crutch, 0 = no crutch (clean).
const CRUTCH_FADE = 0.15;     // strength removed per first-try correct (~7 to fade)
const CRUTCH_BUMP = 0.6;      // strength restored on a wrong answer
// Discrimination phases (Intervals/Triads/Voicings) draw a fresh set of random
// roots every INTERVAL_SET reps, so a purely per-note crutch barely moves
// within a set. These drive a per-SET crutch that visibly fades as you nail the
// current set and jumps back on a miss.
const SET_FADE = 0.22;        // (legacy) per-set crutch removed per correct rep
const SET_BUMP = 0.4;         // (legacy) per-set crutch restored on a wrong answer

// Discrimination engine (Intervals/Triads/Voicings): a 3-down/1-up staircase on
// the crutch SUPPORT level (psychophysics — converges to ~79% accuracy), plus
// spaced item scheduling across all 12 keys with study→test exposure.
const SUPPORT_MAX     = 5;    // crutch level 0..5 (0 = clean, no crutch)
const STAIR_DOWN      = 3;    // correct-in-a-row to lower support (3-down/1-up)
const CLEAN_TO_MASTER = 2;    // clean (crutch-off) correct tests to master an item
const ROTATE_AFTER    = 3;    // correct-in-a-row on an item before it rotates out (keeps the set fresh)
const REVIEW_GAP      = 18;   // test-rounds before a mastered item is due for review
const REVIEW_PROB     = 0.35; // chance a freed slot pulls a due review item vs a new key

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
  let trainingWheels = localStorage.getItem("pt.learn.wheels") === "1";
  let ynImagine = localStorage.getItem("pt.learn.yn.imagine") === "1";
  let ynTimer = null;
  function loadYnAllowed() {
    try { const a = JSON.parse(localStorage.getItem("pt.learn.yn.allowed")); if (Array.isArray(a) && a.length) return new Set(a); } catch (_) {}
    return new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  }
  let ynAllowed = loadYnAllowed();
  let sess = { correct: 0, total: 0 }; // running per-visit score for the phase

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
      pattern:  { patKey: "1235", correct: 0, pool: 3, correctInPool: 0, ...(p.pattern || {}) },
      relative: { mode: "relative", correct: 0,        ...(p.relative || {}) },
      disc:     { ...(p.disc || {}) },     // per-item state: `${phase}:${type}:${root}`
      support:  { ...(p.support || {}) },  // per-type staircase: `${phase}:${type}`
      discT:    p.discT ?? 0,              // global test-round counter (review scheduling)
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
  function avgStrength(names) { return names.reduce((a, n) => a + noteStrength(n), 0) / Math.max(1, names.length); }
  function fadeNote(name, amt = CRUTCH_FADE) { prog.notes[name] = Math.max(0, noteStrength(name) - amt); }
  // A slip on a nearly-mastered note only refreshes the crutch briefly (so it
  // plays once or twice more) instead of yanking full scaffolding back.
  function bumpNote(name, amt = CRUTCH_BUMP) {
    const cur = noteStrength(name);
    prog.notes[name] = cur < 0.1 ? 0.3 : Math.min(1, cur + amt);
  }
  function anyCrutchAudible(names) {
    if (trainingWheels) return true;
    const uniq = [...new Set(names)];
    const s = uniq.reduce((a, n) => a + noteStrength(n), 0) / uniq.length;
    return crutchGainDb(s) !== null;
  }

  // Single-note overlay (Pitches, Yes/No reveal) — each note at its own level.
  // Original-pitch samples, never shifted. Training wheels forces full.
  function overlayByMastery(names, full = false) {
    const bank = ctx.getBank();
    if (!bank) return;
    names.forEach((name) => {
      const db = (full || trainingWheels) ? FORCE_DB : crutchGainDb(noteStrength(name));
      if (db !== null) bank.play(name, { volume: db });
    });
  }
  // Multi-note overlay (Intervals, Triads, Voicings, Pattern) — all notes play
  // together at ONE uniform level (their average) so the whole shape sounds;
  // you never hear just one note because the other happens to be mastered.
  function overlayUniform(names, full = false) {
    const bank = ctx.getBank();
    if (!bank) return;
    const uniq = [...new Set(names)];
    const s = uniq.reduce((a, n) => a + noteStrength(n), 0) / uniq.length;
    const db = (full || trainingWheels) ? FORCE_DB : crutchGainDb(s);
    if (db === null) return;
    uniq.forEach((name) => bank.play(name, { volume: db }));
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
    if (key === "pattern")  { const p = PATTERNS.find((x) => x.key === prog.pattern.patKey); return `${p ? p.name : ""} · ${prog.pattern.correct} correct`; }
    if (key === "relative") return `${prog.relative.correct} correct`;
    if (key === "yesno")    return `match-or-not drill`;
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
        <div class="trainer-sess" id="learn-sess">session 0/0</div>
        <div class="learn-award" id="learn-award"></div>
        <div class="trainer-prompt" id="learn-prompt"></div>
        <div class="trainer-answers" id="learn-answers"></div>
        <div class="trainer-actions">
          <button class="ghost" id="learn-replay">play again ↺</button>
          <button class="ghost" id="learn-hint" style="display:none">hint ♪</button>
          <button class="ghost" id="learn-next" style="visibility:hidden">next →</button>
        </div>
        <div class="trainer-actions" id="learn-decomp-row" style="display:none">
          <button class="ghost" id="learn-decomp">decompose ✂︎</button>
          <button class="ghost" id="learn-decomp-pp">decompose + PP ✂︎</button>
        </div>
        <div class="learn-opts">
          <label class="autonext"><input type="checkbox" id="learn-autonext"> auto-next on correct</label>
          <label class="autonext"><input type="checkbox" id="learn-wheels"> 🛞 training wheels</label>
        </div>
      </div>`;

    root.querySelector("#learn-back").addEventListener("click", () => { cancelAutoNext(); view = "home"; render(); });
    root.querySelector("#learn-replay").addEventListener("click", () => replay());
    root.querySelector("#learn-hint").addEventListener("click", () => hint());
    root.querySelector("#learn-next").addEventListener("click", () => { cancelAutoNext(); nextRound(); });
    root.querySelector("#learn-decomp").addEventListener("click", () => { if (session && session.decompose) session.decompose(false); });
    root.querySelector("#learn-decomp-pp").addEventListener("click", () => { if (session && session.decompose) { session.hintUsed = true; session.decompose(true); } });
    const autoCb = root.querySelector("#learn-autonext");
    autoCb.checked = autoNext;
    autoCb.addEventListener("change", () => {
      autoNext = autoCb.checked;
      localStorage.setItem("pt.learn.autonext", autoNext ? "1" : "0");
    });
    const wheelsCb = root.querySelector("#learn-wheels");
    wheelsCb.checked = trainingWheels;
    wheelsCb.addEventListener("change", () => {
      trainingWheels = wheelsCb.checked;
      localStorage.setItem("pt.learn.wheels", trainingWheels ? "1" : "0");
    });

    startRound();
  }

  // Assistance = crutch was audible, hint used, or not first try.
  function celebrate(awards) {
    const list = Array.isArray(awards) ? awards : (awards ? [awards] : []);
    if (!list.length) return;
    const a = list[0];
    const e = $("#learn-award");
    if (!e) return;
    e.textContent = `🏆 Mastered ${a.name} — no-assist streak of ${AWARD_STREAK}!`;
    e.classList.add("show");
    setTimeout(() => { const el = $("#learn-award"); if (el) el.classList.remove("show"); }, 4000);
  }

  const $ = (id) => root.querySelector(id);
  function setPrompt(html)     { const e = $("#learn-prompt"); if (e) e.innerHTML = html; }
  function setScore(txt)       { const e = $("#learn-score");  if (e) e.textContent = txt; }
  function setBar(frac)        { const e = $("#learn-bar");    if (e) e.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; }
  function showNext(v)         { const e = $("#learn-next");   if (e) e.style.visibility = v ? "visible" : "hidden"; }
  function showHint(v)         { const e = $("#learn-hint");   if (e) e.style.display = v ? "" : "none"; }
  function showDecompose(v)    { const e = $("#learn-decomp-row"); if (e) e.style.display = v ? "flex" : "none"; }
  function setAnswers(html)    { const e = $("#learn-answers");if (e) e.innerHTML = html; }
  function bumpSess(correct)   {
    sess.total++; if (correct) sess.correct++;
    const e = $("#learn-sess");
    if (e) e.textContent = `session ${sess.correct}/${sess.total} · ${Math.round((sess.correct / sess.total) * 100)}%`;
  }

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
    showDecompose(false); // only chord phases turn this on
    if (phaseKey === "pitches")   return startPitches();
    if (phaseKey === "intervals") return startDisc("intervals");
    if (phaseKey === "triads")    return startDisc("triads");
    if (phaseKey === "voicings")  return startDisc("voicings");
    if (phaseKey === "pattern")   return startPattern();
    if (phaseKey === "relative")  return startRelative();
    if (phaseKey === "yesno")     return startYesNo();
  }
  function nextRound() { startRound(); }
  function replay()    { if (session && session.replay) session.replay(); }
  function hint()      { if (session) session.hintUsed = true; if (session && session.hint) session.hint(); }

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
      hintUsed: false,
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
    if (session.attempts === 1) {
      bumpSess(correct);
      const assisted = session.hintUsed || anyCrutchAudible([session.note]);
      celebrate(recordNote(session.note, correct, assisted));
    }
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

  // ---- Phases 2-4: discrimination engine (Intervals / Triads / Voicings) -----
  // A 3-down/1-up staircase tunes the crutch SUPPORT level (psychophysics —
  // converges to ~79% accuracy). Items (one root per key) are scheduled across
  // all 12 keys: a new item gets a STUDY exposure (crutch on, answer revealed)
  // before it is TESTED later (spaced, since the 3 slots interleave). Master an
  // item by identifying it crutch-off; it retires and a new key rotates in, and
  // mastered items return for retention checks. The A/B/C slots keep positions.
  function levelDb(L) { return L <= 0 ? null : -4 - (SUPPORT_MAX - L) * 3; }

  function discCfg(pk) {
    if (pk === "intervals") {
      return {
        typeKey: () => String(prog.intervals.semis),
        typeLabelShort: () => INTERVAL_LABELS[prog.intervals.semis],
        typeOptions: () => Object.entries(INTERVAL_LABELS).map(([s, l]) => ({ value: s, label: l })),
        selId: "learn-int-sel", selLabel: "Interval",
        onType: (v) => { prog.intervals.semis = parseInt(v, 10); },
        offsets: () => [0, prog.intervals.semis],
        label: (r) => `${PITCH_NAMES[r]}–${PITCH_NAMES[((r + prog.intervals.semis) % 12 + 12) % 12]}`,
        record: (notes, c, a) => recordInterval(INTERVAL_LABELS[prog.intervals.semis], notes, c, a),
        decompose: false,
      };
    }
    const isTri = pk === "triads";
    const P = isTri ? prog.triads : prog.voicings;
    const TY = isTri ? TRIAD_TYPES : SEVENTH_TYPES;
    const nm = isTri ? "Triad" : "Voicing";
    return {
      typeKey: () => P.type,
      typeLabelShort: () => P.type,
      typeOptions: () => Object.keys(TY).map((t) => ({ value: t, label: t })),
      selId: "learn-chord-sel", selLabel: `${nm} type`,
      onType: (v) => { P.type = v; },
      offsets: () => TY[P.type],
      label: (r) => `${PITCH_NAMES[r]} ${P.type}`,
      record: (notes, c, a) => recordInterval(P.type, notes, c, a),
      decompose: true,
    };
  }

  function itemKey(pk, tk, r) { return `${pk}:${tk}:${r}`; }
  function getItem(pk, tk, r) {
    const k = itemKey(pk, tk, r);
    return prog.disc[k] || (prog.disc[k] = { seen: 0, clean: 0, mastered: false, dueAt: 0 });
  }
  function getSup(pk, tk) {
    const k = `${pk}:${tk}`;
    return prog.support[k] || (prog.support[k] = { L: 4, streak: 0 });
  }
  function masteredCount(pk, tk) { let n = 0; for (let r = 0; r < 12; r++) if (getItem(pk, tk, r).mastered) n++; return n; }

  function shapeNoteNames(root, offsets) { return offsets.map((o) => PITCH_NAMES[(((root + o) % 12) + 12) % 12]); }
  function playShape(root, oct, offsets, db) {
    const rootMidi = pcOctToMidi(root, oct);
    playPiano(offsets.map((o) => midiName(rootMidi + o)), "1n", 0.95);
    if (db !== null && db !== undefined) {
      const bank = ctx.getBank();
      if (bank) offsets.forEach((o) => bank.play(PITCH_NAMES[(((root + o) % 12) + 12) % 12], { volume: db }));
    }
  }
  function playShapeArp(root, oct, offsets) {
    const rootMidi = pcOctToMidi(root, oct);
    playPiano(offsets.map((o) => midiName(rootMidi + o)), "2n", 0.9, 0.42); // separate notes, no crutch
  }
  function decomposeShape(root, oct, offsets, withPp) {
    const rootMidi = pcOctToMidi(root, oct);
    const names = offsets.map((o) => midiName(rootMidi + o));
    const pcs = shapeNoteNames(root, offsets);
    const pairs = [];
    for (let i = 0; i < names.length - 1; i++) pairs.push([[names[i], names[i + 1]], [pcs[i], pcs[i + 1]]]);
    if (names.length > 2) pairs.push([[names[0], names[names.length - 1]], [pcs[0], pcs[pcs.length - 1]]]);
    const piano = ctx.getPiano();
    const gap = 0.85;
    pairs.forEach(([pn, pp], i) => {
      const at = Tone.now() + 0.05 + i * gap;
      if (piano) { try { piano.triggerAttackRelease(pn, "2n", at, 0.9); } catch (_) {} }
      if (withPp) setTimeout(() => { const b = ctx.getBank(); if (b) pp.forEach((n) => b.play(n, { volume: FORCE_DB })); }, (0.05 + i * gap) * 1000);
    });
  }

  function initSlots(pk, tk) {
    const roots = [...Array(12).keys()];
    roots.sort((a, b) => {
      const ia = getItem(pk, tk, a), ib = getItem(pk, tk, b);
      return (ia.mastered ? 1 : 0) - (ib.mastered ? 1 : 0) || ia.seen - ib.seen || Math.random() - 0.5;
    });
    return roots.slice(0, 3);
  }
  function pickTarget(pk, tk) {
    const all = [0, 1, 2];
    const pool = all.filter((i) => i !== session.lastTarget);
    const use = pool.length ? pool : all;
    const w = use.map((i) => { const it = getItem(pk, tk, session.slots[i]); return it.seen === 0 ? 3 : (it.mastered ? 0.6 : 1); });
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let j = 0; j < use.length; j++) { r -= w[j]; if (r <= 0) return use[j]; }
    return use[use.length - 1];
  }
  function swapSlot(pk, tk, idx) {
    const inUse = new Set(session.slots);
    let choice = null;
    if (Math.random() < REVIEW_PROB) {
      const due = [];
      for (let r = 0; r < 12; r++) { if (inUse.has(r)) continue; const it = getItem(pk, tk, r); if (it.mastered && it.dueAt <= prog.discT) due.push(r); }
      if (due.length) choice = due[Math.floor(Math.random() * due.length)];
    }
    if (choice === null) {
      const fresh = [];
      for (let r = 0; r < 12; r++) { if (inUse.has(r)) continue; if (!getItem(pk, tk, r).mastered) fresh.push(r); }
      if (fresh.length) {
        fresh.sort((a, b) => {
          const A = getItem(pk, tk, a), B = getItem(pk, tk, b);
          const ad = A.dueAt > prog.discT ? 1 : 0, bd = B.dueAt > prog.discT ? 1 : 0; // not-yet-due last
          return ad - bd || A.seen - B.seen || Math.random() - 0.5;
        });
        choice = fresh[0];
      }
    }
    if (choice === null) {
      const any = [];
      for (let r = 0; r < 12; r++) if (!inUse.has(r)) any.push(r);
      choice = any.length ? any[Math.floor(Math.random() * any.length)] : session.slots[idx];
    }
    session.slots[idx] = choice; // keep the slot's on-screen position
  }
  function highlightSlot(idx) {
    root.querySelectorAll(".voicing-btn").forEach((b, i) => b.classList.toggle("study-hl", i === idx));
  }
  function renderDiscButtons(D) {
    const btns = session.slots.map((r, i) => `<button class="voicing-btn" data-which="${i}"><b>${LETTERS[i]}</b><span>${D.label(r)}</span></button>`).join("");
    const opts = D.typeOptions().map((o) => `<option value="${o.value}" ${o.value === session.tk ? "selected" : ""}>${o.label}</option>`).join("");
    setAnswers(`
      <div class="voicing-choices">${btns}</div>
      <div class="interval-picker"><label>${D.selLabel} <select id="${D.selId}">${opts}</select></label></div>`);
    root.querySelectorAll(".voicing-btn").forEach((b) => b.addEventListener("click", () => answerDisc(session.pk, +b.dataset.which)));
    const sel = $(`#${D.selId}`);
    if (sel) sel.addEventListener("change", () => { const pk = session.pk; D.onType(sel.value); saveProg(); session = null; startDisc(pk); });
  }
  function discScore(pk, tk, sup) {
    const D = discCfg(pk);
    return `${D.typeLabelShort()} · ${masteredCount(pk, tk)}/12 · ${sup.L === 0 ? "no crutch" : "crutch " + sup.L}`;
  }
  function startDisc(pk) {
    const D = discCfg(pk);
    const tk = D.typeKey();
    if (!session || session.pk !== pk || session.tk !== tk || !session.slots) {
      session = { pk, tk, slots: initSlots(pk, tk), lastTarget: -1 };
    }
    session.offsets = D.offsets();
    const target = pickTarget(pk, tk);
    const root = session.slots[target];
    const item = getItem(pk, tk, root);
    const sup = getSup(pk, tk);
    const oct = 3 + Math.floor(Math.random() * 2);
    const mode = item.seen === 0 ? "study" : "test";
    const db = mode === "study" ? FORCE_DB : (trainingWheels ? FORCE_DB : levelDb(sup.L));
    session.target = target; session.mode = mode; session.oct = oct;
    session.done = false; session.attempts = 0; session.hintUsed = false;
    session.replay = () => playShape(root, oct, session.offsets, mode === "study" ? FORCE_DB : db);
    session.hint   = () => playShapeArp(root, oct, session.offsets);
    if (D.decompose) { session.decompose = (pp) => decomposeShape(root, oct, session.offsets, pp); showDecompose(true); } else showDecompose(false);
    showHint(true);

    setScore(discScore(pk, tk, sup));
    setBar(masteredCount(pk, tk) / 12);
    renderDiscButtons(D);

    if (mode === "study") {
      setPrompt(`🔊 Study — this one is <b>${D.label(root)}</b>`);
      highlightSlot(target);
      item.seen++; saveProg();     // exposure done; it will be TESTED later (spaced)
      showNext(true);
      playShape(root, oct, session.offsets, FORCE_DB);
    } else {
      setPrompt(`Which one did you hear?`);
      showNext(false);
      playShape(root, oct, session.offsets, db);
    }
  }
  function answerDisc(pk, slotIdx) {
    if (!session || session.done) return;
    const tk = session.tk;
    if (session.mode === "study") { session.lastTarget = session.target; startDisc(pk); return; }
    const D = discCfg(pk);
    session.attempts++;
    const target = session.target;
    const root = session.slots[target];
    const item = getItem(pk, tk, root);
    const sup = getSup(pk, tk);
    const correct = slotIdx === target;
    const heard = shapeNoteNames(root, session.offsets);
    const cleanTest = sup.L === 0 && !trainingWheels; // truly unassisted?
    if (session.attempts === 1) {
      bumpSess(correct);
      prog.discT = (prog.discT || 0) + 1;
      celebrate(D.record(heard, correct, session.hintUsed || !cleanTest));
    }
    session.done = true;
    if (correct) {
      sup.streak = (sup.streak || 0) + 1;
      if (sup.streak >= STAIR_DOWN) { sup.L = Math.max(0, sup.L - 1); sup.streak = 0; } // 3-down staircase
      item.streak = (item.streak || 0) + 1;
      if (cleanTest) { item.clean = (item.clean || 0) + 1; if (item.clean >= CLEAN_TO_MASTER) item.mastered = true; }
      // Rotate the item OUT after a few correct-in-a-row (regardless of crutch)
      // so the on-screen set keeps changing and cycles through all 12 keys.
      // Mastered items schedule a longer review before they can return.
      if (item.mastered || item.streak >= ROTATE_AFTER) {
        item.dueAt = prog.discT + (item.mastered ? REVIEW_GAP * 2 : REVIEW_GAP);
        item.streak = 0;
        swapSlot(pk, tk, target);
      }
      saveProg();
      setPrompt(`✅ ${LETTERS[target]} — ${D.label(root)}`);
      setScore(discScore(pk, tk, sup));
      setBar(masteredCount(pk, tk) / 12);
      session.lastTarget = target;
      showNext(true); maybeAutoNext();
    } else {
      sup.L = Math.min(SUPPORT_MAX, sup.L + 1); sup.streak = 0; // 1-up staircase
      item.clean = 0; item.streak = 0; item.mastered = false; item.seen = 0; // re-study it later (spaced)
      saveProg();
      setPrompt(`❌ was ${LETTERS[target]} — ${D.label(root)}`);
      setTimeout(() => playShape(root, session.oct, session.offsets, FORCE_DB), 350); // corrective, crutch on
      session.lastTarget = target;
      showNext(true); maybeAutoNext(1600);
    }
  }

  // ---- Phase: Pattern -------------------------------------------------------
  // Play a short phrase (semitone offsets from a random root) with the crutch;
  // identify the pitch it starts on. Crutch fades per note like everything else.
  function patternPcs(rootPc, offs) {
    return offs.map((o) => PITCH_NAMES[(((rootPc + o) % 12) + 12) % 12]);
  }
  // Play the phrase note-by-note; each PP-MIDI sample fires WITH its own piano
  // note (in sequence), not all stacked at once. Whole phrase uses one uniform
  // crutch level so it fades coherently.
  function playPattern(rootPc, oct, offs, full = false) {
    const rootMidi = pcOctToMidi(rootPc, oct);
    const piano = ctx.getPiano();
    const bank = ctx.getBank();
    const names = patternPcs(rootPc, offs);
    const avg = names.reduce((a, n) => a + noteStrength(n), 0) / names.length;
    const db = (full || trainingWheels) ? FORCE_DB : crutchGainDb(avg);
    const gap = 0.42;
    offs.forEach((o, i) => {
      const midi = rootMidi + o;
      const at = Tone.now() + 0.05 + i * gap;
      if (piano) { try { piano.triggerAttackRelease(midiName(midi), "4n", at, 0.9); } catch (_) {} }
      if (db !== null && bank) {
        const pcName = PITCH_NAMES[((midi % 12) + 12) % 12];
        setTimeout(() => bank.play(pcName, { volume: db }), (0.05 + i * gap) * 1000);
      }
    });
  }
  function hintPattern(rootPc, oct, offs) {
    const rootMidi = pcOctToMidi(rootPc, oct);
    playPiano(offs.map((o) => midiName(rootMidi + o)), "4n", 0.9, 0.42); // no crutch
  }
  function startPattern() {
    const pat = PATTERNS.find((p) => p.key === prog.pattern.patKey) || PATTERNS[0];
    const pool = POOL_ORDER.slice(0, prog.pattern.pool);
    const rootName = pool[Math.floor(Math.random() * pool.length)];
    const rootPc = PITCH_NAMES.indexOf(rootName);
    const oct = 3 + Math.floor(Math.random() * 2);
    session = {
      rootPc, oct, offs: pat.offs, done: false, attempts: 0, hintUsed: false,
      replay: () => playPattern(rootPc, oct, pat.offs),
      hint:   () => hintPattern(rootPc, oct, pat.offs),
    };
    setScore(`pool ${prog.pattern.pool}/12`);
    setBar(prog.pattern.correctInPool / REPS_PER_NOTE);
    setPrompt(`Where does the phrase start?`);
    showHint(true);
    const patOpts = PATTERNS.map((p) => `<option value="${p.key}" ${p.key === pat.key ? "selected" : ""}>${p.name}</option>`).join("");
    const btns = pool.map((n) => `<button class="answer-btn" data-pc="${PITCH_NAMES.indexOf(n)}">${n}</button>`).join("");
    setAnswers(`
      <div class="pattern-picker"><label>Phrase <select id="learn-pat-sel">${patOpts}</select></label></div>
      <div class="note-grid wide">${btns}</div>`);
    root.querySelectorAll("#learn-answers [data-pc]").forEach((b) =>
      b.addEventListener("click", () => answerPattern(+b.dataset.pc)));
    const sel = $("#learn-pat-sel");
    if (sel) sel.addEventListener("change", () => { prog.pattern.patKey = sel.value; saveProg(); startPattern(); });
    playPattern(rootPc, oct, pat.offs);
  }
  function answerPattern(pcGuess) {
    if (!session || session.done) return;
    session.attempts++;
    const correct = pcGuess === session.rootPc;
    const notes = patternPcs(session.rootPc, session.offs);
    if (session.attempts === 1) {
      bumpSess(correct);
      const assisted = session.hintUsed || anyCrutchAudible(notes);
      celebrate(recordNotes(notes, correct, assisted));
    }
    if (correct) {
      session.done = true;
      if (session.attempts === 1) {
        notes.forEach((n) => fadeNote(n, CRUTCH_FADE * 0.4));
        prog.pattern.correct++;
        prog.pattern.correctInPool++;
        if (prog.pattern.correctInPool >= REPS_PER_NOTE && prog.pattern.pool < 12) {
          prog.pattern.pool++; prog.pattern.correctInPool = 0;
          setPrompt(`✅ ${PITCH_NAMES[session.rootPc]} — new option added: <b>${POOL_ORDER[prog.pattern.pool - 1]}</b>`);
        } else {
          setPrompt(`✅ starts on ${PITCH_NAMES[session.rootPc]}`);
        }
        saveProg();
      } else {
        setPrompt(`✅ starts on ${PITCH_NAMES[session.rootPc]}`);
      }
      setBar(prog.pattern.correctInPool / REPS_PER_NOTE);
      setScore(`pool ${prog.pattern.pool}/12`);
      showNext(true);
      maybeAutoNext();
    } else {
      notes.forEach((n) => bumpNote(n));
      setPrompt(`❌ Not ${PITCH_NAMES[pcGuess]}. Crutch back on…`);
      setTimeout(() => playPattern(session.rootPc, session.oct, session.offs), 350);
    }
  }

  // ---- Phase: Yes / No ------------------------------------------------------
  function playYn(pc, oct) { playPiano(`${PITCH_NAMES[pc]}${oct}`, "1n", 0.92); }
  function ynSetAnswersDisabled(d) { root.querySelectorAll("#learn-answers [data-yn]").forEach((b) => (b.disabled = d)); }
  function startYesNo() {
    if (ynTimer) { clearTimeout(ynTimer); ynTimer = null; }
    const allowed = [...ynAllowed];
    const pool = allowed.length ? allowed : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const shownPc = pool[Math.floor(Math.random() * pool.length)];
    const isSame = Math.random() < 0.5;
    // Distractor is drawn evenly from ALL 12 (minus the shown note), not just
    // the selected pool.
    const playedPc = isSame ? shownPc : (shownPc + 1 + Math.floor(Math.random() * 11)) % 12;
    const oct = 3 + Math.floor(Math.random() * 2);
    session = { shownPc, playedPc, isSame, oct, done: false, replay: () => playYn(playedPc, oct) };

    setScore("");
    setBar(0);
    showHint(false);
    setPrompt(`<span class="big-note">${PITCH_NAMES[shownPc]}</span><span class="yn-sub" id="yn-sub">${ynImagine ? "imagine it… 🎧" : "Does the piano note match?"}</span>`);

    const chips = PITCH_NAMES.map((n, i) =>
      `<button class="yn-chip ${ynAllowed.has(i) ? "on" : ""}" data-pick="${i}">${n}</button>`).join("");
    setAnswers(`
      <div class="yn-answers"><button class="answer-btn" data-yn="1">Yes ✓</button><button class="answer-btn" data-yn="0">No ✗</button></div>
      <div class="yn-config">
        <label class="autonext"><input type="checkbox" id="yn-imagine" ${ynImagine ? "checked" : ""}> imagine first (2s)</label>
        <div class="yn-pick-label">notes to test:</div>
        <div class="yn-pick">${chips}</div>
      </div>`);
    root.querySelectorAll("[data-yn]").forEach((b) => b.addEventListener("click", () => answerYesNo(b.dataset.yn === "1")));
    root.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.pick;
      if (ynAllowed.has(i)) { if (ynAllowed.size > 1) ynAllowed.delete(i); } else ynAllowed.add(i);
      localStorage.setItem("pt.learn.yn.allowed", JSON.stringify([...ynAllowed]));
      startYesNo();
    }));
    const imgCb = root.querySelector("#yn-imagine");
    imgCb.addEventListener("change", () => { ynImagine = imgCb.checked; localStorage.setItem("pt.learn.yn.imagine", ynImagine ? "1" : "0"); startYesNo(); });

    // Training wheels: hear the SHOWN note's OG sample as a reference first.
    session.wheelsRef = trainingWheels;
    if (trainingWheels) { const bank = ctx.getBank(); if (bank) bank.play(PITCH_NAMES[shownPc], {}); }
    const delay = ynImagine ? 2000 : (trainingWheels ? 1200 : 0);
    if (delay > 0) {
      ynSetAnswersDisabled(true);
      ynTimer = setTimeout(() => {
        ynTimer = null;
        const sub = $("#yn-sub"); if (sub && ynImagine) sub.textContent = "Does the piano note match?";
        ynSetAnswersDisabled(false);
        playYn(playedPc, oct);
      }, delay);
    } else {
      playYn(playedPc, oct);
    }
  }
  function answerYesNo(saidYes) {
    if (!session || session.done) return;
    if (ynTimer) return; // still in the imagine window
    session.done = true;
    const correct = saidYes === session.isSame;
    const shownName = PITCH_NAMES[session.shownPc];
    const heard = PITCH_NAMES[session.playedPc];
    bumpSess(correct);
    celebrate(recordNote(shownName, correct, !!session.wheelsRef)); // ref heard = assisted
    const sub = $("#yn-sub");
    if (sub) sub.innerHTML = `${correct ? "✅ Correct" : "❌ Wrong"} — played was <b>${heard}</b> (${session.isSame ? "match" : "different"})`;
    const bank = ctx.getBank(); if (bank) bank.play(shownName, {}); // OG sample anchor of shown note
    showNext(true);
    maybeAutoNext(1500);
  }

  // ---- Phase: Wide Leap (relative / absolute) -------------------------------
  // Two notes octaves apart. Absolute: name the top note's pitch class.
  // Relative: name the interval (reduced within an octave).
  function playRelative() {
    const piano = ctx.getPiano();
    const now = Tone.now();
    const s = session;
    if (piano) {
      try {
        piano.triggerAttackRelease(midiName(s.botMidi), "2n", now, 0.9);
        piano.triggerAttackRelease(midiName(s.topMidi), "2n", now + 0.6, 0.9);
      } catch (_) {}
    }
    // No PP-MIDI here unless training wheels are on — then BOTH notes get it.
    if (trainingWheels) {
      const bank = ctx.getBank();
      if (bank) {
        bank.play(PITCH_NAMES[s.botPc], { volume: FORCE_DB });
        setTimeout(() => bank.play(PITCH_NAMES[s.topPc], { volume: FORCE_DB }), 600);
      }
    }
  }
  function hintRelative() {
    const piano = ctx.getPiano();
    const now = Tone.now();
    if (piano) {
      try {
        piano.triggerAttackRelease(midiName(session.botMidi), "2n", now, 0.9);
        piano.triggerAttackRelease(midiName(session.topMidi), "2n", now + 1.0, 0.9);
      } catch (_) {}
    }
  }
  function startRelative() {
    const botPc = Math.floor(Math.random() * 12);
    const botMidi = pcOctToMidi(botPc, 2);
    const octs = 2 + Math.floor(Math.random() * 2); // 2 or 3 octaves
    const simple = Math.floor(Math.random() * 12);
    const total = octs * 12 + simple;
    const topMidi = botMidi + total;
    const topPc = ((topMidi % 12) + 12) % 12;
    session = {
      mode: "absolute", botPc, botMidi, topMidi, topPc, total, done: false, attempts: 0, hintUsed: false,
      replay: () => playRelative(),
      hint:   () => hintRelative(),
    };
    setScore(`${prog.relative.correct} correct`);
    setBar((prog.relative.correct % 10) / 10);
    setPrompt(`Bottom note: <b>${PITCH_NAMES[botPc]}</b> — name the <b>top note</b>`);
    showHint(true);

    const opts = PITCH_NAMES.map((n, i) => `<button class="answer-btn small" data-pc="${i}">${n}</button>`).join("");
    setAnswers(`<div class="note-grid">${opts}</div>`);
    root.querySelectorAll("#learn-answers [data-pc]").forEach((b) => b.addEventListener("click", () => answerRelative(+b.dataset.pc)));

    playRelative();
  }
  function answerRelative(val) {
    if (!session || session.done) return;
    session.attempts++;
    const topName = PITCH_NAMES[session.topPc];
    const correct = val === session.topPc;
    if (session.attempts === 1) {
      bumpSess(correct);
      celebrate(recordNote(topName, correct, session.hintUsed || trainingWheels));
    }
    const reveal = `${midiName(session.botMidi)} → ${midiName(session.topMidi)} · ${session.total} semis (${REL_LABELS[session.total % 12]})`;
    if (correct) {
      session.done = true;
      if (session.attempts === 1) { fadeNote(topName); prog.relative.correct++; saveProg(); }
      setPrompt(`✅ ${reveal}`);
      setBar((prog.relative.correct % 10) / 10);
      setScore(`${prog.relative.correct} correct`);
      showNext(true);
      maybeAutoNext();
    } else {
      bumpNote(topName);
      setPrompt(`❌ top was ${topName}`);
      setTimeout(() => playRelative(), 350);
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
    sess = { correct: 0, total: 0 }; // fresh running score per phase visit
    render();
  }

  // Keyboard: number keys pick answer options in order (12 slots).
  const KEYMAP = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
  window.addEventListener("keydown", (e) => {
    if (view !== "trainer") return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const idx = KEYMAP.indexOf(e.key);
    if (idx < 0) return;
    const btns = [...root.querySelectorAll("#learn-answers button")];
    if (btns[idx]) { e.preventDefault(); btns[idx].click(); }
  });

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
