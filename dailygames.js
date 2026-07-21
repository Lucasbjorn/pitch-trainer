// Daily games (beyond "Smallest Interval"). Each runner drives the #daily
// element via a small game ctx `g` supplied by hub.js:
//   g.el                     the container
//   g.tone(freqHz, at, dur)  pure sine (for microtonal detuning)
//   g.piano(name, at, dur, v) salamander piano
//   g.finish(score, label)   end the game (score: lower = better)
//   g.quit()                 back to Home
// All games are relative-pitch (no absolute-pitch knowledge needed) and score
// as a single number so they slot straight into the leaderboard.

const NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiName = (m) => NN[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const centsFreq = (f, c) => f * Math.pow(2, c / 1200);
const IN = ["uni", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7", "P8"]; // by semitones
const IVL12 = ["8ve", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7"];    // reduced (semis % 12)

// Generic N-round multiple-choice quiz.
function quizGame(g, cfg) {
  let round = 0, correct = 0, cur = null, done = false;
  const S = (x) => (typeof x === "function" ? x(cur) : x);
  function next() {
    if (round >= cfg.n) return g.finish(cfg.n - correct, `${correct}/${cfg.n}`);
    round++; cur = cfg.generate(); cur._res = ""; cur._cls = ""; done = false;
    render(); cfg.play(cur);
  }
  function render() {
    const opts = cfg.options(cur).map((o) => `<button class="dg-opt" data-i="${o.val}" ${done ? "disabled" : ""}>${o.label}</button>`).join("");
    g.el.innerHTML = `
      <div class="dg">
        <button class="dg-x" data-quit>✕</button>
        <div class="dg-name">${cfg.title}</div>
        <div class="dg-prog">${round} / ${cfg.n} · ${correct} right</div>
        ${cfg.controls ? `<div class="dg-controls">${S(cfg.controls)}</div>` : ""}
        <div class="dg-q">${S(cfg.sub)}</div>
        <div class="dg-grid">${opts}</div>
        <div class="dg-result ${cur._cls}" id="dg-res">${cur._res}</div>
        <button class="dg-replay" data-replay>replay ↺</button>
      </div>`;
    g.el.querySelector("[data-quit]").onclick = g.quit;
    g.el.querySelector("[data-replay]").onclick = () => cfg.play(cur);
    g.el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => answer(b.dataset.i)));
    if (cfg.wire) cfg.wire(g.el, render);
  }
  function answer(v) {
    if (done) return; done = true;
    const ok = cfg.correctOf(cur, v);
    if (ok) correct++;
    cur._res = (ok ? "✅ " : "❌ ") + cfg.revealOf(cur);
    cur._cls = ok ? "ok" : "wrong";
    const res = g.el.querySelector("#dg-res"); res.textContent = cur._res; res.className = "dg-result " + cur._cls;
    g.el.querySelectorAll("[data-i]").forEach((b) => (b.disabled = true));
    setTimeout(next, 1150);
  }
  next();
}

// ---- Interval Ear (relative interval ID) ----
function runInterval(g) {
  quizGame(g, {
    n: 10, title: "Interval Ear", sub: "Name the interval you heard",
    generate: () => { const root = 55 + Math.floor(Math.random() * 10); const semis = 1 + Math.floor(Math.random() * 12); return { root, top: root + semis, semis }; },
    play: (c) => { g.piano(midiName(c.root), 0, 0.7); g.piano(midiName(c.top), 0.6, 0.7); },
    options: () => Array.from({ length: 12 }, (_, i) => ({ val: i + 1, label: IN[i + 1] })),
    correctOf: (c, v) => +v === c.semis,
    revealOf: (c) => `${IN[c.semis]} (${midiName(c.root)} → ${midiName(c.top)})`,
  });
}

// ---- Compound Leap (far-apart notes; interval-type or top-note, toggle) ----
function runLeap(g) {
  let mode = localStorage.getItem("pt.leap.mode") || "interval";
  quizGame(g, {
    n: 10, title: "Compound Leap",
    sub: () => mode === "interval" ? "What interval (reduced to one octave)?" : "Name the TOP note",
    controls: (c) => `
      <div class="dg-toggle">
        <button class="seg ${mode === "interval" ? "active" : ""}" data-m="interval">Interval</button>
        <button class="seg ${mode === "second" ? "active" : ""}" data-m="second">Top note</button>
      </div>${mode === "second" ? `<div class="dg-given">bottom note: <b>${NN[c.root % 12]}</b></div>` : ""}`,
    wire: (el, rerender) => el.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; localStorage.setItem("pt.leap.mode", mode); rerender(); })),
    generate: () => { const root = 40 + Math.floor(Math.random() * 8); const semis = (2 + Math.floor(Math.random() * 2)) * 12 + Math.floor(Math.random() * 12); return { root, top: root + semis, semis }; },
    play: (c) => { g.piano(midiName(c.root), 0, 0.8); g.piano(midiName(c.top), 0.95, 0.8); },
    options: () => mode === "interval" ? IVL12.map((l, i) => ({ val: i, label: l })) : NN.map((n, i) => ({ val: i, label: n })),
    correctOf: (c, v) => mode === "interval" ? (+v === c.semis % 12) : (+v === c.top % 12),
    revealOf: (c) => mode === "interval" ? `${IVL12[c.semis % 12]} · ${c.semis} semitones` : `${NN[c.top % 12]} (${midiName(c.root)} → ${midiName(c.top)})`,
  });
}

// ---- Spot the Sour Note (original: one scale degree detuned) ----
function runMistuned(g) {
  const MAJ = [0, 2, 4, 5, 7, 9, 11, 12];
  quizGame(g, {
    n: 8, title: "Spot the Sour Note", sub: "An ascending scale — which note is out of tune?",
    generate: () => ({ root: 53 + Math.floor(Math.random() * 8), bad: Math.floor(Math.random() * 8), off: (Math.random() < 0.5 ? -1 : 1) * 35 }),
    play: (c) => MAJ.forEach((iv, i) => g.tone(centsFreq(midiFreq(c.root + iv), i === c.bad ? c.off : 0), i * 0.42, 0.4)),
    options: () => Array.from({ length: 8 }, (_, i) => ({ val: i, label: `${i + 1}` })),
    correctOf: (c, v) => +v === c.bad,
    revealOf: (c) => `note ${c.bad + 1} was ${c.off > 0 ? "sharp" : "flat"} ${Math.abs(c.off)}¢`,
  });
}

// ---- Chord Progression (diatonic triads / 7ths; complex modes grayed) ----
function runProg(g) {
  const MAJ = [0, 2, 4, 5, 7, 9, 11];
  const ROMAN = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
  const NPROG = 3, LEN = 4;
  let sevenths = localStorage.getItem("pt.prog.7") === "1";
  let progN = 0, ci = 0, correct = 0, key = 0, degrees = [], done = false;
  const total = NPROG * LEN;

  function chordMidis(deg) {
    const ivs = sevenths ? [0, 2, 4, 6] : [0, 2, 4];
    return ivs.map((st) => { const sd = deg + st; return 48 + key + MAJ[sd % 7] + 12 * Math.floor(sd / 7); });
  }
  function playChord(deg, at) { chordMidis(deg).forEach((m) => g.piano(midiName(m), at, 0.85, 0.8)); }
  function playAll() { degrees.forEach((d, i) => playChord(d, i * 0.95)); }
  function newProg() {
    key = Math.floor(Math.random() * 12);
    degrees = [0]; for (let i = 1; i < LEN; i++) degrees.push(Math.floor(Math.random() * 7));
    ci = 0; done = false;
    render(); playAll();
  }
  function render() {
    const strip = degrees.map((d, i) => `<span class="prog-slot ${i === ci ? "cur" : ""} ${i < ci ? "past" : ""}">${i < ci ? ROMAN[d] : (i === ci ? "?" : "·")}</span>`).join("");
    const btns = ROMAN.map((r, i) => `<button class="dg-opt rn" data-i="${i}" ${done ? "disabled" : ""}>${r}</button>`).join("");
    g.el.innerHTML = `
      <div class="dg">
        <button class="dg-x" data-quit>✕</button>
        <div class="dg-name">Chord Progression</div>
        <div class="dg-prog">progression ${progN + 1}/${NPROG} · ${correct} right</div>
        <div class="dg-controls">
          <div class="dg-toggle">
            <button class="seg ${!sevenths ? "active" : ""}" data-sev="0">Triads</button>
            <button class="seg ${sevenths ? "active" : ""}" data-sev="1">7ths</button>
            <button class="seg locked" disabled>+ modes soon</button>
          </div>
        </div>
        <div class="dg-q">Key of <b>${NN[key]}</b> — name chord <b>${ci + 1}</b></div>
        <div class="prog-strip">${strip}</div>
        <div class="dg-grid rn-grid">${btns}</div>
        <div class="dg-result ${window._pr_cls || ""}" id="dg-res">${window._pr_res || ""}</div>
        <div class="dg-actions">
          <button class="dg-replay" data-all>replay all</button>
          <button class="dg-replay" data-cur>replay this chord</button>
        </div>
      </div>`;
    g.el.querySelector("[data-quit]").onclick = g.quit;
    g.el.querySelector("[data-all]").onclick = playAll;
    g.el.querySelector("[data-cur]").onclick = () => playChord(degrees[ci], 0);
    g.el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => answer(+b.dataset.i)));
    g.el.querySelectorAll("[data-sev]").forEach((b) => (b.onclick = () => { sevenths = b.dataset.sev === "1"; localStorage.setItem("pt.prog.7", sevenths ? "1" : "0"); render(); }));
  }
  function answer(r) {
    if (done) return; done = true;
    const ok = r === degrees[ci];
    if (ok) correct++;
    window._pr_res = `${ok ? "✅" : "❌"} chord ${ci + 1} was ${ROMAN[degrees[ci]]}`;
    window._pr_cls = ok ? "ok" : "wrong";
    const res = g.el.querySelector("#dg-res"); res.textContent = window._pr_res; res.className = "dg-result " + window._pr_cls;
    g.el.querySelectorAll("[data-i]").forEach((b) => (b.disabled = true));
    setTimeout(() => {
      window._pr_res = ""; window._pr_cls = "";
      ci++;
      if (ci >= LEN) { progN++; if (progN >= NPROG) return g.finish(total - correct, `${correct}/${total}`); newProg(); }
      else { done = false; render(); playChord(degrees[ci], 0.1); }
    }, 1150);
  }
  newProg();
}

// ---- Guess Who (full track plays; name the tune + who's on each instrument) ----
import { PUZZLES, START_DATE } from "./guesswho-clips.js";
function norm(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
// Small edit distance for typo tolerance.
function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
// "Close enough": exact, containment (≥4 chars), or ≤1-2 typos.
function closeEnough(guess, target) {
  const a = norm(guess), b = norm(target);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  return lev(a, b) <= (b.length > 6 ? 2 : 1);
}
function gwMatch(guess, field) { return [field.answer, ...(field.accept || [])].some((t) => closeEnough(guess, t)); }

function runGuessWho(g) {
  const LIVES = 3;
  // Puzzle of the day: days since START_DATE, looping through the list.
  const dayIdx = Math.max(0, Math.floor((Date.now() - new Date(START_DATE + "T00:00:00")) / 86400000));
  const pz = PUZZLES.length ? PUZZLES[dayIdx % PUZZLES.length] : null;

  function notReady(msg) {
    g.el.innerHTML = `
      <div class="dg dg-result">
        <button class="dg-x" data-quit>✕</button>
        <div class="dg-emoji">🎧</div>
        <div class="dg-name">Guess Who</div>
        <div class="dg-q">${msg}</div>
        <button class="dg-cta" data-quit>Back to games</button>
      </div>`;
    g.el.querySelectorAll("[data-quit]").forEach((b) => (b.onclick = g.quit));
  }
  if (!pz) return notReady("No puzzles loaded yet — check back soon.");

  const fields = [{ label: "Tune name", ...pz.tune }, ...pz.fields];
  const hints = pz.hints || [];
  const revealed = [];            // hints unlocked so far (one per wrong guess)
  const audio = new Audio(pz.src); audio.preload = "auto";
  let mistakes = 0, done = false, audioBroken = false;
  const locked = fields.map(() => false);
  audio.addEventListener("error", () => { audioBroken = true; if (!done) notReady("Today's track isn't uploaded yet — check back soon."); });
  audio.addEventListener("ended", () => { if (!done) end(); });   // song over = game over

  function stopAudio() { try { audio.pause(); } catch (_) {} }
  function correctCount() { return locked.filter(Boolean).length; }
  function end() {
    done = true; stopAudio();
    const c = correctCount();
    // Reveal screen first, then submit the score (lower = better on the board).
    g.el.innerHTML = `
      <div class="dg dg-result">
        <div class="dg-emoji">${c === fields.length ? "🏆" : c >= 3 ? "🎷" : "🎧"}</div>
        <div class="dg-name">Guess Who</div>
        <div class="dg-score">${c}/${fields.length}</div>
        <div class="dg-score-sub">${pz.tune.answer}</div>
        <div class="gwp-reveal">${pz.reveal}</div>
        ${hints.length ? `<div class="gwp-hints" style="margin-top:0.9rem;text-align:left">${hints.map((h) => `<div class="gwp-hint">💡 ${h}</div>`).join("")}</div>` : ""}
        <button class="dg-cta" data-done>Continue</button>
      </div>`;
    g.el.querySelector("[data-done]").onclick = () => g.finish(fields.length - c, `${c}/${fields.length}`);
  }

  function render() {
    const hearts = "❤️".repeat(LIVES - mistakes) + "🖤".repeat(mistakes);
    const rows = fields.map((f, i) => `
      <div class="gwp-row ${locked[i] ? "ok" : ""}">
        <span class="gwp-lbl">${f.label}</span>
        ${locked[i]
          ? `<span class="gwp-ans">✓ ${f.answer}</span>`
          : `<input data-i="${i}" placeholder="…" autocomplete="off" autocapitalize="off">
             <button class="gwp-go" data-go="${i}">✓</button>`}
      </div>`).join("");
    g.el.innerHTML = `
      <div class="dg">
        <button class="dg-x" data-quit>✕</button>
        <div class="dg-name">Guess Who</div>
        <div class="dg-lives">${hearts}</div>
        <button class="dg-cta gwp-play" data-play>${audio.paused ? "▶ Play the track" : "⏸ Pause"}</button>
        <div class="dg-q">Name the tune and who's playing what. ${LIVES} misses and it's over — and when the song ends, time's up.</div>
        ${revealed.length ? `<div class="gwp-hints">${revealed.map((h) => `<div class="gwp-hint">💡 ${h}</div>`).join("")}</div>` : ""}
        <div class="gwp-fields">${rows}</div>
        <div class="dg-result" id="gwp-res"></div>
      </div>`;
    g.el.querySelector("[data-quit]").onclick = () => { stopAudio(); g.quit(); };
    g.el.querySelector("[data-play]").onclick = () => {
      if (audioBroken) return;
      if (audio.paused) { try { audio.play(); } catch (_) {} } else { stopAudio(); }
      const b = g.el.querySelector("[data-play]"); if (b) b.textContent = audio.paused ? "▶ Play the track" : "⏸ Pause";
    };
    g.el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => submit(parseInt(b.dataset.go, 10))));
    g.el.querySelectorAll("input[data-i]").forEach((inp) => {
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(parseInt(inp.dataset.i, 10)); });
    });
  }
  function submit(i) {
    if (done || locked[i]) return;
    const inp = g.el.querySelector(`input[data-i="${i}"]`);
    const v = (inp && inp.value) || "";
    if (!norm(v)) return;
    if (gwMatch(v, fields[i])) {
      locked[i] = true;
      if (correctCount() === fields.length) return end();
      render(); // audio is a standalone JS object, so it keeps playing across re-renders
      const res = g.el.querySelector("#gwp-res"); res.textContent = "✅ got it"; res.className = "dg-result ok";
    } else {
      mistakes++;
      const gotHint = hints[mistakes - 1] != null;
      if (gotHint) revealed.push(hints[mistakes - 1]);   // reveal a fact on each wrong guess
      if (mistakes >= LIVES) return end();
      render();
      const res = g.el.querySelector("#gwp-res");
      res.textContent = gotHint ? "❌ not it — here's a hint 💡" : `❌ not it — ${LIVES - mistakes} left`;
      res.className = "dg-result wrong";
    }
  }
  render();
}

export const DAILY_RUNNERS = { interval: runInterval, leap: runLeap, mistuned: runMistuned, prog: runProg, guesswho: runGuessWho };
