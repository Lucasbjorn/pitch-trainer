// AP Mini Games — a grab-bag of absolute-pitch drills that use angles the
// Learn phases don't:
//   • Cold Sing — production: name shown, NO reference, you sing it; graded in
//     cents. (The missing "produce from a label" modality.)
//   • Last Note — a phrase in a random key sets up a relative-pitch context;
//     you name the ABSOLUTE pitch of the final note, overriding the context.
//   • Reflex — snap note ID against the clock; trains categorical speed.
//
// Renders into #apgames. Reuses the shared ctx (piano, sample bank, stats).

import { PitchDetector } from "https://esm.sh/pitchy@4";
import { recordNote } from "./stats.js";

const MIC = { minClarity: 0.85, minRms: 0.012, minFreq: 70, maxFreq: 1200, holdMs: 320 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const GAMES = [
  { id: "coldsing", icon: "🎤", name: "Cold Sing", blurb: "A note name, no reference — sing it from memory. Graded in cents." },
  { id: "lastnote", icon: "🎯", name: "Last Note", blurb: "A phrase in a random key — name the absolute pitch of the LAST note." },
  { id: "reflex",   icon: "⚡", name: "Reflex",   blurb: "Snap-identify a note against the clock. Build categorical speed." },
];

export function setupApGames(ctx) {
  const { Tone, PITCH_NAMES } = ctx;
  const root = document.getElementById("apgames");

  let view = "home";
  let ready = false;
  let active = false;
  let game = null;      // per-game transient state
  let mic = null;
  let autoTimer = null;

  function pcName(i) { return PITCH_NAMES[((i % 12) + 12) % 12]; }
  function playPiano(name, dur = "2n", vel = 0.85, at = 0) {
    const p = ctx.getPiano();
    if (p) { try { p.triggerAttackRelease(name, dur, Tone.now() + at, vel); } catch (_) {} }
  }
  function playCue(pc) { const b = ctx.getBank(); if (b) b.play(pcName(pc), {}); }
  function cancelAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }
  const $ = (s) => root.querySelector(s);

  // =========================================================================
  // Home
  // =========================================================================
  function renderHome() {
    stopMic(); cancelAuto();
    const cards = GAMES.map((g) => `
      <button class="learn-card" data-game="${g.id}">
        <div class="learn-card-icon">${g.icon}</div>
        <div class="learn-card-body">
          <div class="learn-card-title">${g.name}</div>
          <div class="learn-card-blurb">${g.blurb}</div>
        </div>
        <div class="learn-card-chev">›</div>
      </button>`).join("");
    root.innerHTML = `
      <div class="learn-home">
        <h1 class="screen-title">AP Mini Games</h1>
        <p class="screen-sub">Angles the Learn path doesn't cover — producing pitches from memory, beating a relative-pitch context, and raw speed.</p>
        <div class="learn-cards">${cards}</div>
      </div>`;
    root.querySelectorAll("[data-game]").forEach((b) => b.addEventListener("click", () => openGame(b.dataset.game)));
  }
  function backBtn(id) {
    return `<div class="setup-top"><button class="icon-btn" id="${id}">‹ Games</button><div class="trainer-title"></div><div style="width:60px"></div></div>`;
  }
  function openGame(id) {
    cancelAuto();
    if (id === "coldsing") return startColdSing();
    if (id === "lastnote") return startLastNote();
    if (id === "reflex")   return startReflex();
  }

  // =========================================================================
  // 1. Cold Sing — production, graded in cents (NO reference tone / no noise)
  // =========================================================================
  let csTol = parseInt(localStorage.getItem("pt.ap.cs.tol") || "40", 10);
  let csRef = localStorage.getItem("pt.ap.cs.ref") === "1"; // beginner: hear it first
  let csScore = { correct: 0, total: 0 };

  function centsToTarget(freq, targetPc) {
    const midf = 12 * Math.log2(freq / 440) + 69;
    const k = Math.round((midf - targetPc) / 12);
    return (midf - (targetPc + 12 * k)) * 100; // signed cents to nearest octave of target
  }
  function startColdSing() {
    view = "coldsing";
    csScore = { correct: 0, total: 0 };
    renderColdSing();
    startMic();     // one permission prompt; stays on across rounds
    csNewRound();
  }
  function renderColdSing() {
    root.innerHTML = `
      <div class="apg">
        ${backBtn("cs-back")}
        <div class="apg-score" id="cs-score">0 / 0</div>
        <div class="big-note" id="cs-note">—</div>
        <div class="apg-sub" id="cs-sub">sing it</div>
        <div class="needle"><div class="needle-zone" id="cs-zone"></div><div class="needle-center"></div><div class="needle-mark" id="cs-mark"></div></div>
        <div class="apg-live" id="cs-live">—</div>
        <div class="tune-actions">
          <button class="ghost" id="cs-reveal">reveal ♪</button>
          <button class="ghost" id="cs-next">next →</button>
        </div>
        <div class="apg-opts">
          <label class="mini">Tolerance
            <select id="cs-tol">
              <option value="50" ${csTol === 50 ? "selected" : ""}>±50¢ (easy)</option>
              <option value="40" ${csTol === 40 ? "selected" : ""}>±40¢</option>
              <option value="30" ${csTol === 30 ? "selected" : ""}>±30¢</option>
              <option value="15" ${csTol === 15 ? "selected" : ""}>±15¢ (hard)</option>
            </select>
          </label>
          <label class="autonext"><input type="checkbox" id="cs-ref" ${csRef ? "checked" : ""}> reference first</label>
        </div>
      </div>`;
    $("#cs-back").addEventListener("click", () => { view = "home"; renderHome(); });
    $("#cs-reveal").addEventListener("click", csReveal);
    $("#cs-next").addEventListener("click", csNewRound);
    $("#cs-tol").addEventListener("change", (e) => { csTol = +e.target.value; localStorage.setItem("pt.ap.cs.tol", csTol); });
    $("#cs-ref").addEventListener("change", (e) => { csRef = e.target.checked; localStorage.setItem("pt.ap.cs.ref", csRef ? "1" : "0"); });
    updateNeedleZone();
  }
  function updateNeedleZone() {
    const z = $("#cs-zone"); if (!z) return;
    const w = (Math.min(csTol, 50) / 50) * 50; // half-width in %
    z.style.left = `${50 - w}%`; z.style.width = `${2 * w}%`;
  }
  function csNewRound() {
    cancelAuto();
    if (!game) game = {};
    let pc; do { pc = Math.floor(Math.random() * 12); } while (pc === game.lastPc && Math.random() < 0.9);
    game = { lastPc: pc, targetPc: pc, done: false, hold: 0, best: 999, revealed: false };
    $("#cs-note").textContent = pcName(pc);
    setCsSub(csRef ? "listen, then sing it" : "sing it — no reference");
    setCsLive("—"); setNeedle(null); updateNeedleZone();
    const nx = $("#cs-next"); if (nx) nx.style.visibility = "hidden";
    if (csRef) { playPiano(`${pcName(pc)}4`, "2n", 0.85); } // beginner crutch: hear the target
  }
  function setCsSub(t, cls) { const e = $("#cs-sub"); if (e) { e.textContent = t; e.className = "apg-sub " + (cls || ""); } }
  function setCsLive(t) { const e = $("#cs-live"); if (e) e.textContent = t; }
  function setNeedle(cents) {
    const m = $("#cs-mark"); if (!m) return;
    if (cents === null) { m.style.opacity = "0"; return; }
    const clamped = Math.max(-50, Math.min(50, cents));
    m.style.opacity = "1"; m.style.left = `${50 + clamped}%`;
    m.style.background = Math.abs(cents) <= csTol ? "var(--good)" : "var(--bad)";
  }
  function csOnPitch(freq) {
    if (!game || game.done || game.revealed) return;
    const cents = centsToTarget(freq, game.targetPc);
    setNeedle(cents);
    setCsLive(`${cents > 0 ? "+" : ""}${Math.round(cents)}¢ ${Math.abs(cents) <= csTol ? "🎯" : cents > 0 ? "(sharp)" : "(flat)"}`);
    if (Math.abs(cents) <= csTol) {
      if (game.hold === 0) game.hold = performance.now();
      if (performance.now() - game.hold >= MIC.holdMs) csHit();
    } else { game.hold = 0; }
  }
  function csSilence() { if (game && !game.done) { game.hold = 0; setNeedle(null); setCsLive("—"); } }
  function csHit() {
    game.done = true;
    csScore.total++; csScore.correct++;
    $("#cs-score").textContent = `${csScore.correct} / ${csScore.total}`;
    setCsSub(`✅ ${pcName(game.targetPc)} — nailed it`, "ok");
    celebrate(recordNote(pcName(game.targetPc), true, csRef));
    playCue(game.targetPc);
    const nx = $("#cs-next"); if (nx) nx.style.visibility = "visible";
    autoTimer = setTimeout(csNewRound, 1600);
  }
  function csReveal() {
    if (!game || game.done) return;
    game.revealed = true;
    csScore.total++;
    $("#cs-score").textContent = `${csScore.correct} / ${csScore.total}`;
    recordNote(pcName(game.targetPc), false, true);
    setCsSub(`♪ ${pcName(game.targetPc)} — that's the pitch`, "");
    playPiano(`${pcName(game.targetPc)}4`, "2n", 0.9);
    setTimeout(() => playCue(game.targetPc), 400);
    const nx = $("#cs-next"); if (nx) nx.style.visibility = "visible";
  }

  // ---- shared mic (Cold Sing) ----
  async function startMic() {
    if (mic) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
      mic = { stream, ac, analyser, buf: new Float32Array(analyser.fftSize), detector: PitchDetector.forFloat32Array(analyser.fftSize), raf: null };
      micLoop();
    } catch (err) { setCsSub("Mic error: " + (err && err.message ? err.message : err), "wrong"); }
  }
  function micLoop() {
    if (!mic) return;
    mic.raf = requestAnimationFrame(micLoop);
    mic.analyser.getFloatTimeDomainData(mic.buf);
    let sq = 0; for (let i = 0; i < mic.buf.length; i++) sq += mic.buf[i] * mic.buf[i];
    const rms = Math.sqrt(sq / mic.buf.length);
    const [freq, clarity] = mic.detector.findPitch(mic.buf, mic.ac.sampleRate);
    if (rms >= MIC.minRms && clarity >= MIC.minClarity && freq >= MIC.minFreq && freq <= MIC.maxFreq) csOnPitch(freq);
    else csSilence();
  }
  function stopMic() {
    if (!mic) return;
    if (mic.raf) cancelAnimationFrame(mic.raf);
    try { mic.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { mic.ac.close(); } catch (_) {}
    mic = null;
  }

  // =========================================================================
  // 2. Last Note — AP through a relative-pitch smokescreen
  // =========================================================================
  let lnScore = { correct: 0, total: 0 };
  function genPhrase() {
    const key = Math.floor(Math.random() * 12);
    const oct = 4;
    const rootMidi = 12 * (oct + 1) + key;
    const len = 4 + Math.floor(Math.random() * 3);
    let deg = 3 + Math.floor(Math.random() * 4);
    const midis = [];
    for (let i = 0; i < len; i++) {
      deg = Math.max(0, Math.min(13, deg + (Math.floor(Math.random() * 5) - 2)));
      midis.push(rootMidi + MAJOR[deg % 7] + 12 * Math.floor(deg / 7));
    }
    return midis;
  }
  function startLastNote() {
    view = "lastnote";
    lnScore = { correct: 0, total: 0 };
    root.innerHTML = `
      <div class="apg">
        ${backBtn("ln-back")}
        <div class="apg-score" id="ln-score">0 / 0</div>
        <div class="apg-sub" id="ln-sub">Name the pitch of the LAST note</div>
        <div class="note-grid" id="ln-grid">${PITCH_NAMES.map((n, i) => `<button class="answer-btn small" data-pc="${i}">${n}</button>`).join("")}</div>
        <div class="apg-result" id="ln-result"></div>
        <div class="tune-actions">
          <button class="ghost" id="ln-replay">play again ↺</button>
          <button class="ghost" id="ln-next" style="visibility:hidden">next →</button>
        </div>
      </div>`;
    $("#ln-back").addEventListener("click", () => { view = "home"; renderHome(); });
    $("#ln-replay").addEventListener("click", () => lnPlay());
    $("#ln-next").addEventListener("click", lnNewRound);
    root.querySelectorAll("#ln-grid [data-pc]").forEach((b) => b.addEventListener("click", () => lnAnswer(+b.dataset.pc)));
    lnNewRound();
  }
  function lnPlay() {
    if (!game) return;
    game.midis.forEach((m, i) => playPiano(Tone.Frequency(m, "midi").toNote(), "4n", 0.85, i * 0.42));
  }
  function lnNewRound() {
    cancelAuto();
    const midis = genPhrase();
    game = { midis, targetPc: ((midis[midis.length - 1] % 12) + 12) % 12, done: false };
    $("#ln-result").textContent = ""; $("#ln-result").className = "apg-result";
    root.querySelectorAll("#ln-grid [data-pc]").forEach((b) => (b.disabled = false));
    $("#ln-next").style.visibility = "hidden";
    lnPlay();
  }
  function lnAnswer(pc) {
    if (!game || game.done) return;
    game.done = true;
    root.querySelectorAll("#ln-grid [data-pc]").forEach((b) => (b.disabled = true));
    const correct = pc === game.targetPc;
    lnScore.total++; if (correct) lnScore.correct++;
    $("#ln-score").textContent = `${lnScore.correct} / ${lnScore.total}`;
    const names = game.midis.map((m) => Tone.Frequency(m, "midi").toNote()).join(" ");
    $("#ln-result").textContent = correct ? `✅ ${pcName(game.targetPc)}  ·  ${names}` : `❌ was ${pcName(game.targetPc)}  ·  ${names}`;
    $("#ln-result").className = "apg-result " + (correct ? "ok" : "wrong");
    celebrate(recordNote(pcName(game.targetPc), correct, false));
    playCue(game.targetPc);
    $("#ln-next").style.visibility = "visible";
    autoTimer = setTimeout(lnNewRound, 1900);
  }

  // =========================================================================
  // 3. Reflex — snap note ID against the clock
  // =========================================================================
  let rxScore = { correct: 0, total: 0, sumMs: 0, best: Infinity };
  function startReflex() {
    view = "reflex";
    rxScore = { correct: 0, total: 0, sumMs: 0, best: Infinity };
    root.innerHTML = `
      <div class="apg">
        ${backBtn("rx-back")}
        <div class="apg-score" id="rx-score">0 / 0</div>
        <div class="apg-sub" id="rx-sub">tap the note as fast as you can</div>
        <div class="note-grid" id="rx-grid">${PITCH_NAMES.map((n, i) => `<button class="answer-btn small" data-pc="${i}">${n}</button>`).join("")}</div>
        <div class="apg-result" id="rx-result"></div>
        <div class="tune-actions">
          <button class="ghost" id="rx-replay">replay ↺</button>
          <button class="ghost" id="rx-next" style="visibility:hidden">next →</button>
        </div>
        <div class="apg-sub" id="rx-stats"></div>
      </div>`;
    $("#rx-back").addEventListener("click", () => { view = "home"; renderHome(); });
    $("#rx-replay").addEventListener("click", () => { if (game) playPiano(`${pcName(game.targetPc)}${game.oct}`, "2n", 0.9); });
    $("#rx-next").addEventListener("click", rxNewRound);
    root.querySelectorAll("#rx-grid [data-pc]").forEach((b) => b.addEventListener("click", () => rxAnswer(+b.dataset.pc)));
    rxNewRound();
  }
  function rxNewRound() {
    cancelAuto();
    const pc = Math.floor(Math.random() * 12);
    const oct = 3 + Math.floor(Math.random() * 2);
    game = { targetPc: pc, oct, done: false, t0: 0 };
    $("#rx-result").textContent = ""; $("#rx-result").className = "apg-result";
    root.querySelectorAll("#rx-grid [data-pc]").forEach((b) => (b.disabled = false));
    $("#rx-next").style.visibility = "hidden";
    playPiano(`${pcName(pc)}${oct}`, "2n", 0.9);
    game.t0 = performance.now();
  }
  function rxAnswer(pc) {
    if (!game || game.done) return;
    game.done = true;
    const ms = Math.round(performance.now() - game.t0);
    root.querySelectorAll("#rx-grid [data-pc]").forEach((b) => (b.disabled = true));
    const correct = pc === game.targetPc;
    rxScore.total++;
    if (correct) { rxScore.correct++; rxScore.sumMs += ms; if (ms < rxScore.best) rxScore.best = ms; }
    $("#rx-score").textContent = `${rxScore.correct} / ${rxScore.total}`;
    $("#rx-result").textContent = correct ? `✅ ${pcName(game.targetPc)} · ${ms} ms` : `❌ was ${pcName(game.targetPc)}`;
    $("#rx-result").className = "apg-result " + (correct ? "ok" : "wrong");
    const avg = rxScore.correct ? Math.round(rxScore.sumMs / rxScore.correct) : 0;
    $("#rx-stats").textContent = rxScore.correct ? `avg ${avg} ms · best ${rxScore.best} ms` : "";
    celebrate(recordNote(pcName(game.targetPc), correct, false));
    if (!correct) playCue(game.targetPc);
    $("#rx-next").style.visibility = "visible";
    autoTimer = setTimeout(rxNewRound, correct ? 750 : 1600);
  }

  // ---- award banner (shared) ----
  function celebrate(awards) {
    const list = Array.isArray(awards) ? awards : [];
    if (!list.length) return;
    ctx.setStatus(`🏆 Mastered ${list[0].name}!`);
  }

  // ---- keyboard: number keys pick note-grid answers ----
  const KEYMAP = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
  window.addEventListener("keydown", (e) => {
    if (!active) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const idx = KEYMAP.indexOf(e.key);
    if (idx < 0) return;
    const btns = [...root.querySelectorAll(".note-grid [data-pc]")];
    if (btns[idx]) { e.preventDefault(); btns[idx].click(); }
  });

  return {
    async enter() {
      active = true; view = "home"; renderHome();
      ctx.setStatus("Loading AP games…");
      try { await Promise.all([ctx.ensurePiano(), ctx.ensureSampleBank()]); ready = true; ctx.setStatus("AP Mini Games"); }
      catch (err) { ctx.setStatus(err && err.message ? err.message : String(err), true); }
    },
    exit() { active = false; stopMic(); cancelAuto(); game = null; },
  };
}
