// Microtone — "Human Benchmark for music": tests of fine pitch resolution.
// All tones are pure synth (sine) — NO PP-MIDI on shifted/in-between pitches.
// (Exception: game 3 plays the PP-MIDI cue only when it reveals an exact note.)
//
//   1. JND      — adaptive just-noticeable-difference: hear a pitch ×3, then a
//                 test that's sharp/flat; the gap halves as you nail it
//                 (1/2 semitone down toward 1/512).
//   2. Micro    — quarter-tone interval ID on a 24-note keyboard.
//   3. On/Between — is this pitch exactly a note, or in between two?

const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const IVL = ["unison", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7", "8ve"];
const KMIN = 1, KMAX = 9;        // JND difficulty: gap = 100/2^k cents (50¢ … ~0.2¢)
const KEYS = 25;                 // Micro keyboard: 0..24 quarter-tones (one octave)

const GAMES = [
  { id: "jnd",   icon: "📏", name: "JND",         blurb: "Just-noticeable difference — the gap halves as you keep getting it right." },
  { id: "micro", icon: "🎛️", name: "Quarter-tones", blurb: "Name microtonal intervals on a 24-note keyboard." },
  { id: "onbtw", icon: "🎯", name: "On or Between", blurb: "Is this pitch exactly a note, or wedged between two?" },
];

// Interval families for the guided learner, ordered easiest/most-useful first.
// `qt` = the exact interval in quarter-tones (semitones × 2).
const FAMILIES = [
  { name: "Perfect 5th", short: "P5", qt: 14 },
  { name: "Perfect 4th", short: "P4", qt: 10 },
  { name: "Major 3rd",   short: "M3", qt: 8 },
  { name: "Major 6th",   short: "M6", qt: 18 },
  { name: "Minor 3rd",   short: "m3", qt: 6 },
  { name: "Minor 6th",   short: "m6", qt: 16 },
  { name: "Major 2nd",   short: "M2", qt: 4 },
  { name: "Minor 7th",   short: "m7", qt: 20 },
  { name: "Octave",      short: "8ve", qt: 24 },
];
const FAM_MASTER = 4; // correct tests to master a family and unlock the next

export function setupMicrotone(ctx) {
  const { Tone } = ctx;
  const root = document.getElementById("microtone");
  let active = false, ready = false, view = "home", g = null, autoTimer = null;
  let publicMode = false;   // launched from the friends app → no training wheels

  let synth = null;
  function ensureSynth() {
    if (!synth) {
      // Polyphonic so scheduled/overlapping tones don't retrigger-glitch, and a
      // gentle sine-curve attack removes the click/buzz at note onset.
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.03, attackCurve: "sine", decay: 0.05, sustain: 0.9, release: 0.16, releaseCurve: "linear" },
      }).toDestination();
      synth.volume.value = -6; // headroom so it never clips (which also buzzes)
    }
    return synth;
  }
  function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function centsFreq(f, cents) { return f * Math.pow(2, cents / 1200); }
  function tone(freq, at = 0, dur = 0.5) { try { ensureSynth().triggerAttackRelease(freq, dur, Tone.now() + at); } catch (_) {} }
  function cancelAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }
  const $ = (s) => root.querySelector(s);

  function backBtn(id) { return `<div class="setup-top"><button class="icon-btn" id="${id}">‹ Games</button><div class="trainer-title"></div><div style="width:60px"></div></div>`; }

  // ---- Home ----
  function renderHome() {
    cancelAuto();
    const cards = GAMES.map((x) => `
      <button class="learn-card" data-game="${x.id}">
        <div class="learn-card-icon">${x.icon}</div>
        <div class="learn-card-body"><div class="learn-card-title">${x.name}</div><div class="learn-card-blurb">${x.blurb}</div></div>
        <div class="learn-card-chev">›</div>
      </button>`).join("");
    root.innerHTML = `
      <div class="learn-home">
        <h1 class="screen-title">Microtone</h1>
        <p class="screen-sub">How fine is your pitch resolution? Pure-tone tests that push your ear below the semitone.</p>
        <div class="learn-cards">${cards}</div>
      </div>`;
    root.querySelectorAll("[data-game]").forEach((b) => b.addEventListener("click", () => open(b.dataset.game)));
  }
  function open(id) { cancelAuto(); if (id === "learn") startLearn(); else if (id === "jnd") startJnd(); else if (id === "micro") startMicro(); else startOnBtw(); }
  // Back from a game: to the main app home when launched from the friends app,
  // otherwise to the microtone menu (Lab).
  function goBack() { cancelAuto(); if (publicMode && ctx.goHome) return ctx.goHome(); view = "home"; renderHome(); }

  // =========================================================================
  // 1. JND — adaptive staircase on pitch difference
  // =========================================================================
  let jScore = { correct: 0, total: 0 }, jBest = 0;
  function startJnd() {
    view = "jnd"; jScore = { correct: 0, total: 0 }; jBest = 0;
    root.innerHTML = `
      <div class="apg">
        ${backBtn("j-back")}
        <div class="apg-score" id="j-score">0 / 0</div>
        <div class="apg-sub">Same pitch ×3, then a test. Is the test higher or lower?</div>
        <div class="big-note" id="j-gap" style="font-size:2.4rem">—</div>
        <div class="yn-answers">
          <button class="answer-btn" id="j-up">Higher ⬆</button>
          <button class="answer-btn" id="j-dn">Lower ⬇</button>
        </div>
        <div class="apg-result" id="j-res"></div>
        <div class="tune-actions"><button class="ghost" id="j-replay">replay ↺</button><button class="ghost" id="j-next" style="visibility:hidden">next →</button></div>
      </div>`;
    $("#j-back").addEventListener("click", goBack);
    $("#j-up").addEventListener("click", () => jAnswer(true));
    $("#j-dn").addEventListener("click", () => jAnswer(false));
    $("#j-replay").addEventListener("click", jPlay);
    $("#j-next").addEventListener("click", jNew);
    if (!g || g.game !== "jnd") g = { game: "jnd", k: 1 };
    jNew();
  }
  function jNew() {
    cancelAuto();
    const base = 52 + Math.floor(Math.random() * 17);   // E3..A4
    const dir = Math.random() < 0.5 ? 1 : -1;
    g = { game: "jnd", k: g.k || 1, base, dir, done: false };
    g.cents = 100 / Math.pow(2, g.k);
    $("#j-gap").textContent = jGapLabel(g.k);
    $("#j-res").textContent = ""; $("#j-res").className = "apg-result";
    $("#j-next").style.visibility = "hidden";
    setDisabled(["j-up", "j-dn"], false);
    jPlay();
  }
  function jGapLabel(k) { return `gap 1/${Math.pow(2, k)} tone · ${(100 / Math.pow(2, k)).toFixed(1)}¢`; }
  function jPlay() {
    const bf = midiFreq(g.base);
    tone(bf, 0); tone(bf, 0.55); tone(bf, 1.1);
    tone(centsFreq(bf, g.dir * g.cents), 1.85, 0.6);
  }
  function jAnswer(higher) {
    if (!g || g.done) return;
    g.done = true; setDisabled(["j-up", "j-dn"], true);
    const correct = higher === (g.dir > 0);
    jScore.total++; if (correct) jScore.correct++;
    $("#j-score").textContent = `${jScore.correct} / ${jScore.total}`;
    if (correct) { jBest = Math.max(jBest, g.k); g.k = Math.min(KMAX, g.k + 1); }
    else { g.k = Math.max(KMIN, g.k - 1); }
    $("#j-res").textContent = `${correct ? "✅" : "❌"} it was ${g.dir > 0 ? "higher" : "lower"} · best 1/${Math.pow(2, jBest)} tone`;
    $("#j-res").className = "apg-result " + (correct ? "ok" : "wrong");
    $("#j-next").style.visibility = "visible";
    autoTimer = setTimeout(jNew, 1300);
  }

  // =========================================================================
  // 2. Micro — quarter-tone interval ID on a 24-note keyboard
  // =========================================================================
  let mScore = { correct: 0, total: 0 }, mNums = false;
  let mWheels = localStorage.getItem("pt.micro.wheels") === "1";
  function wheelsOn() { return mWheels && !publicMode; }
  function startMicro() {
    view = "micro"; mScore = { correct: 0, total: 0 };
    root.innerHTML = `
      <div class="apg">
        ${backBtn("m-back")}
        <div class="apg-score" id="m-score">0 / 0</div>
        <div class="apg-sub" id="m-sub">Reference plays, then the test. Tap the test note.</div>
        <div class="micro-kbd" id="m-kbd"></div>
        <div class="apg-result" id="m-res"></div>
        <div class="tune-actions">
          <button class="ghost" id="m-replay">replay ↺</button>
          <button class="ghost" id="m-next" style="visibility:hidden">next →</button>
        </div>
      </div>`;
    mNums = false;   // interval-number labels removed
    $("#m-back").addEventListener("click", goBack);
    $("#m-replay").addEventListener("click", mPlay);
    $("#m-next").addEventListener("click", mNew);
    mNew();
  }
  // Training wheels: PP-MIDI cue alongside any IN-TUNE (ET, even index) pitch.
  function ppCue(q) { if (wheelsOn() && q % 2 === 0) { const b = ctx.getBank(); if (b) b.play(PC[((q / 2) % 12 + 12) % 12], {}); } }
  function playKey(q) { tone(centsFreq(midiFreq(M_BASE), q * 50), 0, 0.6); ppCue(q); }
  const M_BASE = 60; // fixed keyboard: C4 at the left, never shifts
  function mNew() {
    cancelAuto();
    // ref = the given (highlighted) key — ALWAYS a real note (even index, never
    // a quarter tone). test = the one to identify (any of 0..23).
    const ref = 2 * Math.floor(Math.random() * 12);
    let test; do { test = Math.floor(Math.random() * 24); } while (test === ref);
    g = { game: "micro", ref, test, done: false, picked: -1 };
    $("#m-res").textContent = ""; $("#m-res").className = "apg-result";
    $("#m-next").style.visibility = "hidden";
    renderKbd();
    mPlay();
  }
  function mPlay() {
    const f0 = midiFreq(M_BASE);
    tone(centsFreq(f0, g.ref * 50), 0, 0.6);   // reference (highlighted)
    ppCue(g.ref);                               // training wheels on the reference
    tone(centsFreq(f0, g.test * 50), 0.9, 0.6); // test (pure tone — not revealed)
  }
  function etLabel(j) { return mNums ? `${j}` : PC[j]; } // fixed C..B labels
  function keyClass(q) {
    return ["mkey", q % 2 === 0 ? "et" : "qt",
      q === g.ref ? "ref" : "",
      g.done && q === g.test ? "correct" : "",
      g.done && q === g.picked && q !== g.test ? "wrong" : ""].join(" ");
  }
  function renderKbd() {
    const kbd = $("#m-kbd"); if (!kbd) return;
    // Bottom row: 12 equal "white" keys (the ET notes C..B), quarter index 2j.
    const et = Array.from({ length: 12 }, (_, j) =>
      `<button class="${keyClass(2 * j)}" data-q="${2 * j}">${etLabel(j)}</button>`).join("");
    // Overlay: 12 "black"-style quarter keys, straddling each ET key's right edge.
    const qt = Array.from({ length: 12 }, (_, j) => {
      const left = (j + 1) * (100 / 12);
      return `<button class="${keyClass(2 * j + 1)}" data-q="${2 * j + 1}" style="left:calc(${left}% - 11px)"></button>`;
    }).join("");
    kbd.innerHTML = `<div class="mkbd-et">${et}</div>${qt}`;
    kbd.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => onKey(+b.dataset.q)));
  }
  function onKey(q) {
    if (!g) return;
    playKey(q);            // every tap sounds — hear your guess, or explore freely
    if (g.done) return;    // already answered → just exploring, don't re-grade
    mAnswer(q);
  }
  function mAnswer(q) {
    g.done = true; g.picked = q;
    const correct = q === g.test;
    mScore.total++; if (correct) mScore.correct++;
    $("#m-score").textContent = `${mScore.correct} / ${mScore.total}`;
    $("#m-res").textContent = `${correct ? "✅" : "❌"} ${qtLabel(g.test - g.ref)}${correct ? "" : " — tap around to compare"}`;
    $("#m-res").className = "apg-result " + (correct ? "ok" : "wrong");
    renderKbd();
    $("#m-next").style.visibility = "visible";
    if (correct) autoTimer = setTimeout(mNew, 1600); // auto-advance only when right
  }
  function qtLabel(d) {
    const dir = d >= 0 ? "up" : "down";
    const t = Math.abs(d);
    const semi = t / 2;
    if (Number.isInteger(semi)) return `${IVL[semi]} ${dir} (${t} q-tones)`;
    const lo = Math.floor(semi);
    return `${dir}, between ${IVL[lo]} and ${IVL[lo + 1]} — ¼-tone (${t} q-tones)`;
  }

  // =========================================================================
  // 3. On or Between
  // =========================================================================
  let oScore = { correct: 0, total: 0 };
  function startOnBtw() {
    view = "onbtw"; oScore = { correct: 0, total: 0 };
    root.innerHTML = `
      <div class="apg">
        ${backBtn("o-back")}
        <div class="apg-score" id="o-score">0 / 0</div>
        <div class="apg-sub">Exactly on a note, or wedged between two?</div>
        <div class="yn-answers">
          <button class="answer-btn" id="o-on">On a note ✓</button>
          <button class="answer-btn" id="o-btw">In between ✗</button>
        </div>
        <div class="apg-result" id="o-res"></div>
        <div class="tune-actions"><button class="ghost" id="o-replay">replay ↺</button><button class="ghost" id="o-next" style="visibility:hidden">next →</button></div>
      </div>`;
    $("#o-back").addEventListener("click", goBack);
    $("#o-on").addEventListener("click", () => oAnswer(true));
    $("#o-btw").addEventListener("click", () => oAnswer(false));
    $("#o-replay").addEventListener("click", oPlay);
    $("#o-next").addEventListener("click", oNew);
    oNew();
  }
  function oNew() {
    cancelAuto();
    const midi = 12 * (4 + Math.floor(Math.random() * 3)) + Math.floor(Math.random() * 12); // ~C3..B5
    const onNote = Math.random() < 0.5;
    const off = onNote ? 0 : (Math.random() < 0.5 ? -1 : 1) * 50; // exactly between two notes (±50¢ = quarter tone)
    g = { game: "onbtw", midi, onNote, off, done: false };
    $("#o-res").textContent = ""; $("#o-res").className = "apg-result";
    $("#o-next").style.visibility = "hidden";
    setDisabled(["o-on", "o-btw"], false);
    oPlay();
  }
  function oPlay() { tone(centsFreq(midiFreq(g.midi), g.off), 0, 0.9); }
  function oAnswer(saysOn) {
    if (!g || g.done) return;
    g.done = true; setDisabled(["o-on", "o-btw"], true);
    const correct = saysOn === g.onNote;
    oScore.total++; if (correct) oScore.correct++;
    $("#o-score").textContent = `${oScore.correct} / ${oScore.total}`;
    if (g.onNote) {
      $("#o-res").textContent = `${correct ? "✅" : "❌"} exactly ${PC[((g.midi % 12) + 12) % 12]}`;
      const bank = ctx.getBank(); if (bank) bank.play(PC[((g.midi % 12) + 12) % 12], {}); // PP-MIDI cue on an exact note
    } else {
      const lo = g.off > 0 ? g.midi : g.midi - 1;
      $("#o-res").textContent = `${correct ? "✅" : "❌"} exactly between ${PC[((lo % 12) + 12) % 12]} and ${PC[(((lo + 1) % 12) + 12) % 12]} (±50¢)`;
    }
    $("#o-res").className = "apg-result " + (correct ? "ok" : "wrong");
    $("#o-next").style.visibility = "visible";
    autoTimer = setTimeout(oNew, 1600);
  }

  function setDisabled(ids, d) { ids.forEach((id) => { const e = $(`#${id}`); if (e) e.disabled = d; }); }

  // ---- MIDI keyboard input ----
  // Micro: single key = that note; two adjacent keys (played together) = the
  // quarter-tone between them. Learn: play the exact note = "exact"; the two
  // keys straddling it = ♭¼ (upper is the exact) / ♯¼ (lower is the exact).
  function midiRoute(msg) {
    if (!g) return;
    if (g.game === "micro") {
      if (msg.kind === "note") { const q = (msg.midi - M_BASE) * 2; if (q >= 0 && q <= 23) onKey(q); }
      else { const q = (msg.low - M_BASE) * 2 + 1; if (q >= 1 && q <= 23) onKey(q); }
    } else if (g.game === "learn") {
      const exact = Math.round(topMidi(g.fam, 0));
      if (msg.kind === "note") { if (msg.midi === exact) onLChoice(0); }
      else { if (msg.high === exact) onLChoice(-1); else if (msg.low === exact) onLChoice(1); }
    }
  }

  // =========================================================================
  // Guided learner — absorb the ¼-tone ladder, then master ♭¼/exact/♯¼ per family
  // =========================================================================
  let lScore = { correct: 0, total: 0 }, lLast = null, lLadderT = null;
  let lWheels = localStorage.getItem("pt.micro.learn.wheels") === "1";
  let lState = lLoad();
  function lLoad() { try { const s = JSON.parse(localStorage.getItem("pt.micro.learn")); if (s && s.fam) return s; } catch (_) {} return { pool: 1, fam: {} }; }
  function lSave() { try { localStorage.setItem("pt.micro.learn", JSON.stringify(lState)); } catch (_) {} }
  function famState(f) { if (!lState.fam[f.short]) lState.fam[f.short] = { studied: false, correct: 0, mastered: false }; return lState.fam[f.short]; }
  function cueMidi(m) { const b = ctx.getBank(); if (b) b.play(PC[((Math.round(m) % 12) + 12) % 12], {}); }
  const TUNE = { "-1": "¼ flat", "0": "exact", "1": "¼ sharp" };

  function startLearn() {
    view = "learn"; lScore = { correct: 0, total: 0 };
    root.innerHTML = `
      <div class="apg">
        ${backBtn("l-back")}
        <div class="apg-score" id="l-score">0 / 0</div>
        <div class="apg-sub" id="l-prompt">…</div>
        <div class="yn-answers" id="l-ans">
          <button class="answer-btn" data-c="-1">¼ flat ⬇</button>
          <button class="answer-btn" data-c="0">exact ✓</button>
          <button class="answer-btn" data-c="1">¼ sharp ⬆</button>
        </div>
        <div class="apg-result" id="l-res"></div>
        <div class="tune-actions">
          <button class="ghost" id="l-ladder">🎹 ladder</button>
          <button class="ghost" id="l-replay">replay ↺</button>
          <button class="ghost" id="l-next" style="visibility:hidden">next →</button>
        </div>
        <label class="autonext"><input type="checkbox" id="l-wheels" ${lWheels ? "checked" : ""}> 🛞 training wheels</label>
      </div>`;
    $("#l-back").addEventListener("click", () => { view = "home"; renderHome(); });
    $("#l-ladder").addEventListener("click", lLadder);
    $("#l-replay").addEventListener("click", lReplay);
    $("#l-next").addEventListener("click", lNext);
    $("#l-wheels").addEventListener("change", (e) => { lWheels = e.target.checked; localStorage.setItem("pt.micro.learn.wheels", lWheels ? "1" : "0"); });
    root.querySelectorAll("#l-ans [data-c]").forEach((b) => b.addEventListener("click", () => onLChoice(+b.dataset.c)));
    lNew();
  }
  function lLadder() {
    if (lLadderT) return;
    const rt = 57; // A3, walk one octave of quarter-tones
    for (let q = 0; q <= 24; q++) tone(centsFreq(midiFreq(rt), q * 50), q * 0.32, 0.3);
    const sub = $("#l-prompt"); const prev = sub ? sub.textContent : "";
    if (sub) sub.textContent = "🎹 …absorbing the ¼-tone ladder…";
    lLadderT = setTimeout(() => { lLadderT = null; if (sub) sub.textContent = prev; }, 24 * 320 + 400);
  }
  function activeFamilies() { return FAMILIES.slice(0, lState.pool); }
  function lNew() {
    cancelAuto();
    const fams = activeFamilies();
    let cand = fams.filter((f) => f.short !== lLast || fams.length === 1);
    cand.sort((a, b) => { const A = famState(a), B = famState(b); return (A.studied ? 1 : 0) - (B.studied ? 1 : 0) || A.correct - B.correct || Math.random() - 0.5; });
    const fam = cand[0];
    const st = famState(fam);
    lLast = fam.short;
    const rootMidi = 55 + Math.floor(Math.random() * 8); // G3..D4, relative task
    $("#l-res").textContent = ""; $("#l-res").className = "apg-result";
    setDisabled(["l-next"], false);
    if (!st.studied) {
      g = { game: "learn", mode: "study", fam, root: rootMidi };
      $("#l-prompt").innerHTML = `Study the <b>${fam.name}</b> — hear ♭¼, exact, ♯¼. Tap a button to re-hear each.`;
      setLNext(true, "test me →");
      lStudyPlay();
    } else {
      const tuning = [-1, 0, 1][Math.floor(Math.random() * 3)];
      g = { game: "learn", mode: "test", fam, root: rootMidi, tuning, done: false };
      $("#l-prompt").innerHTML = `<b>${fam.name}</b> — was the second note ♭¼, exact, or ♯¼?`;
      root.querySelectorAll("#l-ans [data-c]").forEach((b) => (b.disabled = false));
      setLNext(false);
      lPlay(g.tuning);
    }
    $("#l-score").textContent = `pool ${lState.pool}/${FAMILIES.length} · ${fam.short}`;
  }
  function setLNext(vis, label) { const e = $("#l-next"); if (e) { e.style.visibility = vis ? "visible" : "hidden"; if (label) e.textContent = label; else e.textContent = "next →"; } }
  function topMidi(fam, c) { return g.root + (fam.qt + c) / 2; }
  function playInterval(c, at0 = 0) {
    const rf = midiFreq(g.root);
    tone(rf, at0, 0.6);
    if (lWheels) cueMidi(g.root);
    tone(centsFreq(rf, (g.fam.qt + c) * 50), at0 + 0.9, 0.6);
    if (lWheels && c === 0) setTimeout(() => cueMidi(topMidi(g.fam, 0)), (at0 + 0.9) * 1000); // exact top is a real note
  }
  function lPlay(tuning) { playInterval(tuning); }
  function lReplay() { if (!g) return; if (g.mode === "study") lStudyPlay(); else lPlay(g.tuning); }
  function lStudyPlay() {
    const rf = midiFreq(g.root);
    tone(rf, 0, 0.5); if (lWheels) cueMidi(g.root);
    [-1, 0, 1].forEach((c, i) => {
      const at = 0.8 + i * 0.85;
      tone(centsFreq(rf, (g.fam.qt + c) * 50), at, 0.5);
      if (lWheels && c === 0) setTimeout(() => cueMidi(topMidi(g.fam, 0)), at * 1000);
    });
  }
  function onLChoice(c) {
    if (!g) return;
    if (g.mode === "test" && !g.done) { lAnswer(c); return; }
    playInterval(c); // study preview, or post-answer comparison
  }
  function lNext() {
    if (g && g.mode === "study") { famState(g.fam).studied = true; lSave(); }
    lNew();
  }
  function lAnswer(c) {
    g.done = true;
    root.querySelectorAll("#l-ans [data-c]").forEach((b) => (b.disabled = true));
    const st = famState(g.fam);
    const correct = c === g.tuning;
    lScore.total++; if (correct) lScore.correct++;
    $("#l-score").textContent = `${lScore.correct} / ${lScore.total}`;
    let grew = "";
    if (correct) {
      st.correct++;
      if (st.correct >= FAM_MASTER && !st.mastered) {
        st.mastered = true;
        if (lState.pool < FAMILIES.length) { lState.pool++; grew = ` — unlocked ${FAMILIES[lState.pool - 1].name}!`; }
      }
    }
    lSave();
    $("#l-res").textContent = `${correct ? "✅" : "❌"} it was ${TUNE[String(g.tuning)]}${grew} — tap a button to compare`;
    $("#l-res").className = "apg-result " + (correct ? "ok" : "wrong");
    if (g.tuning === 0 && lWheels) cueMidi(topMidi(g.fam, 0));
    setLNext(true);
    if (correct) autoTimer = setTimeout(lNew, 1500); // auto only when right; wrong lets you explore
  }

  return {
    async enter() {
      active = true; view = "home"; publicMode = false; renderHome();
      ctx.setStatus("Microtone");
      if (ctx.setMidiHandler) ctx.setMidiHandler(midiRoute);
      try { await ctx.ensureSampleBank(); await Tone.start(); ready = true; } catch (_) {}
    },
    openGame(id, opts) { publicMode = !!(opts && opts.public); if (id) open(id); else renderHome(); }, // jump straight into one game
    exit() { active = false; cancelAuto(); g = null; if (ctx.clearMidiHandler) ctx.clearMidiHandler(); },
  };
}
