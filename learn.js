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
const INTERVAL_SET    = 12;   // reps before a new voicing pair is drawn
const PHASE_UNLOCK_AT = 20;   // correct reps to unlock the next phase (2-4)

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

  // ---- persistence ----
  function loadProg() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) {}
    // Spread saved-over-defaults so new fields (like `crutch`) backfill onto
    // existing progress.
    return {
      unlocked: p.unlocked ?? 1,                 // how many phases unlocked (>=1)
      pitches:  { pool: 3, correctInPool: 0, total: 0, crutch: 1, ...(p.pitches   || {}) },
      intervals:{ semis: 4, reps: 0, correct: 0, crutch: 1,        ...(p.intervals || {}) },
      triads:   { correct: 0, type: "Major", crutch: 1,           ...(p.triads    || {}) },
      voicings: { correct: 0, type: "maj7", crutch: 1,            ...(p.voicings  || {}) },
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
  function overlaySamples(pcs, db = -6) {
    const bank = ctx.getBank();
    if (!bank) return;
    pcs.forEach((pc) => bank.play(pc, { volume: db }));
  }

  // ---- crutch scheduling ----
  // Map strength (0..1) to the overlay gain in dB, or null when faded out.
  function crutchGainDb(strength) {
    if (strength <= 0.05) return null;   // gone — clean playback
    return -18 * (1 - strength);         // strength 1 → 0 dB, fading toward ~-17
  }
  function crutchTag(strength) {
    if (crutchGainDb(strength) === null) return "<span class='tag clean'>no crutch</span>";
    return `<span class='tag'>crutch ${Math.round(strength * 100)}%</span>`;
  }
  function fadeCrutch(o) { o.crutch = Math.max(0, (o.crutch ?? 1) - CRUTCH_FADE); }
  function bumpCrutch(o) { o.crutch = Math.min(1, (o.crutch ?? 1) + CRUTCH_BUMP); }

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
      </div>`;

    root.querySelector("#learn-back").addEventListener("click", () => { view = "home"; render(); });
    root.querySelector("#learn-replay").addEventListener("click", () => replay());
    root.querySelector("#learn-hint").addEventListener("click", () => hint());
    root.querySelector("#learn-next").addEventListener("click", () => nextRound());

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
  function startRound() {
    if (!ready) { setPrompt("Loading sounds…"); return; }
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
  // The target sound is a plain piano note; the PP-MIDI song-cue is layered on
  // top as the crutch and fades out as you improve.
  function playPitch(pc, strength) {
    playPiano(noteName(PITCH_NAMES[pc], 4), "1n", 0.85);
    const db = crutchGainDb(strength);
    if (db !== null) overlaySamples([pc], db);
  }
  function startPitches() {
    const pool = POOL_ORDER.slice(0, prog.pitches.pool);
    const pc   = pool[Math.floor(Math.random() * pool.length)];
    session = {
      pc,
      attempts: 0,
      replay: () => playPitch(pc, prog.pitches.crutch),
      hint:   () => playPitch(pc, 1),
    };
    setScore(`pool ${prog.pitches.pool}/12`);
    setBar(prog.pitches.correctInPool / REPS_PER_NOTE);
    setPrompt(`Which note is this? ${crutchTag(prog.pitches.crutch)}`);
    showHint(true);

    const btns = pool.map((n) =>
      `<button class="answer-btn small" data-pc="${n}">${n}</button>`
    ).join("");
    setAnswers(btns);
    root.querySelectorAll("#learn-answers button").forEach((b) =>
      b.addEventListener("click", () => answerPitch(b.dataset.pc))
    );

    playPitch(pc, prog.pitches.crutch);
  }
  function answerPitch(guess) {
    if (!session || session.done) return;
    session.attempts++;
    const correct = guess === session.pc;
    if (correct) {
      session.done = true;
      if (session.attempts === 1) {
        fadeCrutch(prog.pitches);
        prog.pitches.correctInPool++;
        prog.pitches.total++;
        if (prog.pitches.correctInPool >= REPS_PER_NOTE) {
          if (prog.pitches.pool < 12) {
            prog.pitches.pool++;
            prog.pitches.correctInPool = 0;
            unlockGate(1); // ensure intervals stays unlockable
            setPrompt(`✅ ${session.pc} — new note unlocked: <b>${POOL_ORDER[prog.pitches.pool - 1]}</b>`);
          } else {
            prog.pitches.correctInPool = REPS_PER_NOTE;
            unlockGate(1);
            setPrompt(`✅ ${session.pc} — all 12 notes mastered! Intervals unlocked.`);
          }
        } else {
          setPrompt(`✅ Correct — ${session.pc}`);
        }
      } else {
        setPrompt(`✅ ${session.pc} (took ${session.attempts})`);
      }
      saveProg();
      setBar(prog.pitches.correctInPool / REPS_PER_NOTE);
      showNext(true);
    } else {
      bumpCrutch(prog.pitches);
      saveProg();
      setPrompt(`❌ Not ${guess}. Crutch back on — listen again…`);
      setTimeout(() => playPitch(session.pc, prog.pitches.crutch), 350);
    }
  }

  // ---- Phase 2: Intervals (2-voicing discrimination) -------------------------
  function drawIntervalPair(semis) {
    // Two distinct roots at distinct octaves so each voicing owns an absolute
    // register — the whole point is memorizing the sound of that exact spot.
    const octs = [3, 4, 5];
    let a, b, guard = 0;
    do {
      const oa = octs[Math.floor(Math.random() * octs.length)];
      const ob = octs[Math.floor(Math.random() * octs.length)];
      const ra = Math.floor(Math.random() * 12);
      const rb = Math.floor(Math.random() * 12);
      a = { rootPc: ra, oct: oa };
      b = { rootPc: rb, oct: ob };
      guard++;
    } while (guard < 30 && a.rootPc === b.rootPc && a.oct === b.oct);
    return [a, b].map((v) => ({
      ...v,
      rootName: noteName(PITCH_NAMES[v.rootPc], v.oct),
      topPc: (v.rootPc + semis) % 12,
      topName: noteName(PITCH_NAMES[(v.rootPc + semis) % 12], v.oct + Math.floor((v.rootPc + semis) / 12)),
    }));
  }
  function startIntervals() {
    const semis = prog.intervals.semis;
    if (!session || !session.pair || session.setReps >= INTERVAL_SET) {
      session = { pair: drawIntervalPair(semis), setReps: 0 };
    }
    const which = Math.random() < 0.5 ? 0 : 1;
    const strength = prog.intervals.crutch;
    session.which = which;
    session.done = false;
    session.attempts = 0;
    session.replay = () => playVoicing(session.pair[which], prog.intervals.crutch);
    session.hint   = () => playVoicing(session.pair[which], 1);

    setScore(`${INTERVAL_LABELS[semis]} · ${Math.min(prog.intervals.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`);
    setBar(Math.min(prog.intervals.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
    setPrompt(`Which voicing did you hear? ${crutchTag(strength)}`);
    showHint(true);

    const [A, B] = session.pair;
    setAnswers(`
      <div class="voicing-choices">
        <button class="voicing-btn" data-which="0"><b>A</b><span>${A.rootName}–${A.topName}</span></button>
        <button class="voicing-btn" data-which="1"><b>B</b><span>${B.rootName}–${B.topName}</span></button>
      </div>
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

    playVoicing(session.pair[which], strength);
  }
  function playVoicing(v, strength) {
    playPiano([v.rootName, v.topName], "1n", 0.85);
    const db = crutchGainDb(strength);
    if (db !== null) overlaySamples([v.rootPc, v.topPc], db);
  }
  function answerInterval(which) {
    if (!session || session.done) return;
    session.attempts++;
    const correct = which === session.which;
    if (correct) {
      session.done = true;
      session.setReps++;
      if (session.attempts === 1) {
        fadeCrutch(prog.intervals);
        prog.intervals.reps++;
        prog.intervals.correct++;
        if (prog.intervals.correct >= PHASE_UNLOCK_AT) unlockGate(2);
        saveProg();
      }
      const v = session.pair[which];
      setPrompt(`✅ Voicing ${which === 0 ? "A" : "B"} — ${v.rootName}–${v.topName}`);
      setBar(Math.min(prog.intervals.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
      setScore(`${INTERVAL_LABELS[prog.intervals.semis]} · ${Math.min(prog.intervals.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`);
      showNext(true);
    } else {
      bumpCrutch(prog.intervals);
      saveProg();
      setPrompt(`❌ That was the other one. Crutch back on…`);
      setTimeout(() => playVoicing(session.pair[session.which], prog.intervals.crutch), 350);
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
  function drawChordVoicing(intervals) {
    const octs = [3, 4, 5];
    const oct = octs[Math.floor(Math.random() * octs.length)];
    const rootPc = Math.floor(Math.random() * 12);
    const rootMidi = pcOctToMidi(rootPc, oct);
    const midis = intervals.map((iv) => rootMidi + iv);
    return {
      rootPc, oct, rootMidi,
      names: midis.map(midiName),
      tones: midis.map((m) => ((m % 12) + 12) % 12),
      label: `${PITCH_NAMES[rootPc]}${oct}`,
    };
  }
  function drawChordPair(intervals) {
    let a, b, guard = 0;
    do {
      a = drawChordVoicing(intervals);
      b = drawChordVoicing(intervals);
      guard++;
    } while (guard < 40 && a.rootMidi === b.rootMidi);
    return [a, b];
  }
  function playChord(v, strength) {
    playPiano(v.names, "1n", 0.85);
    const db = crutchGainDb(strength);
    if (db !== null) overlaySamples(v.tones, db);
  }
  function startChordDiscrim(phaseKey) {
    const cfg = chordConfig(phaseKey);
    const type = cfg.prog.type;
    const intervals = cfg.types[type];

    if (!session || !session.pair || session.type !== type || session.setReps >= INTERVAL_SET) {
      session = { pair: drawChordPair(intervals), setReps: 0, type };
    }
    const which = Math.random() < 0.5 ? 0 : 1;
    const strength = cfg.prog.crutch;
    session.which = which;
    session.done = false;
    session.attempts = 0;
    session.replay = () => playChord(session.pair[which], cfg.prog.crutch);
    session.hint   = () => playChord(session.pair[which], 1);

    const scoreTxt = `${type} · ${Math.min(cfg.prog.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`;
    setScore(scoreTxt);
    setBar(Math.min(cfg.prog.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
    setPrompt(`Which voicing did you hear? ${crutchTag(strength)}`);
    showHint(true);

    const [A, B] = session.pair;
    const typeOpts = Object.keys(cfg.types)
      .map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${t}</option>`).join("");
    setAnswers(`
      <div class="voicing-choices">
        <button class="voicing-btn" data-which="0"><b>A</b><span>${A.label} ${type}</span></button>
        <button class="voicing-btn" data-which="1"><b>B</b><span>${B.label} ${type}</span></button>
      </div>
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

    playChord(session.pair[which], strength);
  }
  function answerChordDiscrim(phaseKey, which) {
    if (!session || session.done) return;
    const cfg = chordConfig(phaseKey);
    session.attempts++;
    const correct = which === session.which;
    if (correct) {
      session.done = true;
      session.setReps++;
      if (session.attempts === 1) {
        fadeCrutch(cfg.prog);
        cfg.prog.correct++;
        if (cfg.prog.correct >= PHASE_UNLOCK_AT) unlockGate(cfg.phaseIndex);
        saveProg();
      }
      const v = session.pair[which];
      setPrompt(`✅ Voicing ${which === 0 ? "A" : "B"} — ${v.label} ${session.type}`);
      setBar(Math.min(cfg.prog.correct, PHASE_UNLOCK_AT) / PHASE_UNLOCK_AT);
      setScore(`${session.type} · ${Math.min(cfg.prog.correct, PHASE_UNLOCK_AT)}/${PHASE_UNLOCK_AT}`);
      showNext(true);
    } else {
      bumpCrutch(cfg.prog);
      saveProg();
      setPrompt(`❌ That was the other one. Crutch back on…`);
      setTimeout(() => playChord(session.pair[session.which], cfg.prog.crutch), 350);
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
