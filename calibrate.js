// calibrate.js — Lucas's private AP Training Hub (behind 1234; not part of the
// friends' game). Three things live here:
//   • Daily Calibration — a fixed ~7-minute run of every skill; the clean daily
//     reading. Protocol v2 (song anchors early, harder hold/anchor).
//   • Drills — each skill as an endless adaptive drill. End, switch, or flag
//     "too easy / too hard" any time; all of it is logged.
//   • The coach (calibrate-data.js suggestDrills) — suggests the next drill and why.
// Every trial goes to calibrate-data.js (IndexedDB + optional private backup).
// Protocol, fields and analysis handoff: CALIBRATION.md.
//
// Research basis: note categorization with feedback builds adult AP (Van Hedger
// et al. 2019); production/imagery builds the internal template; intervening
// TONES (not noise) disrupt pitch memory (Deutsch) → an atonal cleanser before
// absolute trials, randomly skipped in naming to measure relative-pitch leak;
// PP-MIDI song tags give every pitch class an associative handle.

import { PitchDetector } from "https://esm.sh/pitchy@4";
import * as D from "./calibrate-data.js";
import { calUpload, calDownload, calCloudStatus, signInGoogle } from "./social.js";

export function setupCalibrate(ctx) {
  const { Tone, PITCH_NAMES } = ctx;
  const PC = PITCH_NAMES;
  const root = document.getElementById("calibrate");
  // The day's anchor note (rotates daily, weakest first; "always C" toggle).
  const anchorMode = () => { try { return localStorage.getItem("pt.cal.anchorMode") || "rotate"; } catch (_) { return "rotate"; } };
  let dayAnchor = 0;
  const TITLE = D.SKILL_TITLE;
  const META = {
    cue:     { icon: "🎵", color: "#ffe1a6", blurb: "Each note's song tag — hear the tag, name the note (and back)." },
    name:    { icon: "🎯", color: "#c8d8ff", blurb: "Name a note cold. No reference, cleanser in between." },
    imagine: { icon: "🧠", color: "#e6dbff", blurb: "Hear a named note inside, then sing it — the mic grades you." },
    anchor:  { icon: "⚓", color: "#bfe9cf", blurb: "Is this C? Lures get within a quarter-tone." },
    hold:    { icon: "🧊", color: "#d4f1f4", blurb: "Hold a pitch through noise or stray notes. Cents-fine." },
    twins:   { icon: "🪞", color: "#ffd9e6", blurb: "Three octaves, one odd note name out." },
    triad:   { icon: "🎹", color: "#fde2c8", blurb: "There's an E♭ in this chord — bottom, middle or top?" },
    tune:    { icon: "🎚️", color: "#dff3d8", blurb: "Exactly on a note, or a hair off? (pure pitch — no timbre tells)" },
    tri:     { icon: "🧭", color: "#e0e7ff", blurb: "Hear a note, imagine an anchor, find it from there. Which mental anchors work best?" },
    pair:    { icon: "👯", color: "#fef3c7", blurb: "E♭ or D? Tell next-door notes apart with no reference." },
  };
  // window.__calTestCloud lets the Playwright sync test stand in a fake server for Supabase.
  D.setCloud((typeof window !== "undefined" && window.__calTestCloud) || { upload: calUpload, download: calDownload, status: calCloudStatus });

  let abort = false, timers = [], noiseNode = null, _resolve = null, gen = 0;
  let run = null;                                     // the active calibration or drill
  let lastLabeled = null, sine = null, mic = null, micCtx = null;

  // ---- tiny async framework -------------------------------------------------
  // Every in-flight sleep is resolvable, so ✕ / ⇄ can release a trial that's
  // mid-wait (e.g. 16 s into a hold) instead of leaving it hanging forever.
  const pending = new Set();
  const sleep = (ms) => (abort ? Promise.resolve() : new Promise((res) => {
    const fin = () => { clearTimeout(t); pending.delete(fin); res(); };
    const t = setTimeout(fin, ms);
    pending.add(fin);
  }));
  function flushWaits() { [...pending].forEach((f) => f()); }
  function later(fn, ms) { const g = gen; const t = setTimeout(() => { if (!abort && g === gen) fn(); }, ms); timers.push(t); return t; }
  function clearTimers() { gen++; timers.forEach(clearTimeout); timers = []; }
  function wait() { return new Promise((res) => { _resolve = res; }); }
  function done(v) { if (_resolve) { const r = _resolve; _resolve = null; r(v); } }
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rand(a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pcOf = (m) => ((Math.round(m) % 12) + 12) % 12;
  const clampL = (l) => Math.max(1, Math.min(D.LEVEL_MAX, l));
  const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // ---- audio ------------------------------------------------------------------
  const midiName = (m) => `${PC[pcOf(m)]}${Math.floor(Math.round(m) / 12) - 1}`;
  const midiOf = (pc, oct) => (oct + 1) * 12 + pc;               // C4 = 60
  const hzOf = (m, cents = 0) => 440 * Math.pow(2, (m + cents / 100 - 69) / 12);
  async function piano() { await ctx.ensurePiano(); return ctx.getPiano(); }
  async function playMidi(m, dur = 1.4, at = 0, vel = 0.8) {
    if (abort) return;
    const p = await piano(); try { p.triggerAttackRelease(midiName(m), dur, Tone.now() + at, vel); } catch (_) {}
  }
  async function playHz(m, cents, dur = 1.4, vel = 0.8) {           // microtonal piano (Sampler repitches)
    if (abort) return;
    const p = await piano(); try { p.triggerAttackRelease(hzOf(m, cents), dur, Tone.now(), vel); } catch (_) {}
  }
  function ensureSine() {
    if (!sine) {
      sine = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.03, attackCurve: "sine", decay: 0.1, sustain: 0.85, release: 0.35 } }).toDestination();
      sine.volume.value = -6;
    }
    return sine;
  }
  async function playStim(m, timbre, dur = 1.4) {
    if (abort) return;
    if (timbre === "sine") { try { ensureSine().triggerAttackRelease(hzOf(m), dur, Tone.now()); } catch (_) {} }
    else await playMidi(m, dur);
  }
  async function playChord(midis, dur = 1.8, vel = 0.65) {
    if (abort) return;
    const p = await piano(); midis.forEach((m) => { try { p.triggerAttackRelease(midiName(m), dur, Tone.now(), vel); } catch (_) {} });
  }
  async function arpeggiate(midis, gap = 0.46) {
    if (abort) return;
    const p = await piano();
    midis.forEach((m, i) => { try { p.triggerAttackRelease(midiName(m), 0.6, Tone.now() + i * gap, 0.8); } catch (_) {} });
    await sleep(midis.length * gap * 1000 + 300);
  }
  // Atonal "palette cleanser": random notes that overwrite pitch working memory.
  // detuned=true scatters them ±50¢ too, so it leaves NO in-tune grid behind to
  // judge the next note against (needed wherever tuning itself is the question).
  async function cleanser(detuned = false) {
    if (abort) return;
    const p = await piano(); const now = Tone.now(), N = 9;
    for (let i = 0; i < N; i++) {
      const m = 36 + rand(48);
      try { p.triggerAttackRelease(detuned ? hzOf(m, Math.random() * 100 - 50) : midiName(m), 0.14, now + i * 0.085, 0.28 + Math.random() * 0.15); } catch (_) {}
    }
    await sleep(N * 85 + 650);
  }
  // Synth voices for tuning-critical stimuli: in-tune and detuned notes go through
  // IDENTICAL processing (no piano-sample repitching), with a random voice and
  // ±2 dB per trial, so pitch is the only thing that differs.
  const VOICES = ["triangle", "sine", "fmsine", "amtriangle"];
  const voices = {};
  function voice(type) {
    if (!voices[type]) {
      voices[type] = new Tone.PolySynth(Tone.Synth, { oscillator: { type }, envelope: { attack: 0.01, decay: 1.1, sustain: 0.25, release: 0.5 } }).toDestination();
    }
    return voices[type];
  }
  async function playTuned(m, cents, type, dur = 1.4) {
    if (abort) return;
    try { const v = voice(type); v.volume.value = -8 + (Math.random() * 4 - 2); v.triggerAttackRelease(hzOf(m, cents), dur, Tone.now()); } catch (_) {}
  }
  function stopNoise() { if (noiseNode) { try { noiseNode.n.stop(); noiseNode.n.dispose(); noiseNode.g.dispose(); } catch (_) {} noiseNode = null; } }
  function noiseBed(ms, db = -26) {
    return new Promise((res) => {
      stopNoise();
      try {
        const g = new Tone.Gain(0).toDestination(), n = new Tone.Noise("pink").connect(g); n.start();
        const now = Tone.now(), end = now + ms / 1000, lvl = Tone.dbToGain(db);
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(lvl, now + 0.08);
        g.gain.setValueAtTime(lvl, Math.max(now + 0.09, end - 0.3)); g.gain.linearRampToValueAtTime(0, end);
        noiseNode = { n, g };
      } catch (_) {}
      sleep(ms + 80).then(() => { stopNoise(); res(); });
    });
  }
  // Stray notes during a hold (never the held note's own name).
  async function distractors(n, ms, avoidPc) {
    if (abort) return;
    const p = await piano(), now = Tone.now();
    for (let i = 0; i < n; i++) {
      let m; do { m = 48 + rand(36); } while (pcOf(m) === avoidPc);
      try { p.triggerAttackRelease(midiName(m), 0.35, now + ((i + 0.5) * ms) / n / 1000, 0.45); } catch (_) {}
    }
    await sleep(ms);
  }
  // The PP-MIDI song tag for a pitch class; resolves when the sample ends.
  async function cueSample(pc, wait = true) {
    if (abort) return;
    try {
      const b = ctx.getBank && ctx.getBank(); if (!b) return;
      const nm = PC[pcOf(pc)], r = b.play(nm, {});
      if (!wait) return;                                            // fire and go (answer while it plays)
      const buf = r && b.buffers[nm] && b.buffers[nm][r.variantIdx];
      await sleep(Math.min(3500, ((buf && buf.duration) || 1) * 1000) + 120);
    } catch (_) {}
  }
  // note → its tag → note again (so the last thing heard is the labeled note).
  async function noteCue(pc, oct = 4) {
    const m = midiOf(pcOf(pc), oct), g0 = gen, alive = () => !abort && gen === g0;
    if (!alive()) return;
    exposed(pc);
    await playMidi(m, 0.9); await sleep(750); if (!alive()) return;
    await cueSample(pc); if (!alive()) return;
    await playMidi(m, 1.0); await sleep(700);
    lastLabeled = m;
  }

  // ---- mic (optional sung production in "Imagine") ------------------------------
  const singOn = () => { try { return localStorage.getItem("pt.cal.sing") === "1"; } catch (_) { return false; } };
  async function ensureMic() {
    if (mic) return mic;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ac = micCtx || new (window.AudioContext || window.webkitAudioContext)();
      micCtx = ac; try { await ac.resume(); } catch (_) {}
      const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 2048; src.connect(an);
      mic = { stream, src, an, buf: new Float32Array(an.fftSize), det: PitchDetector.forFloat32Array(an.fftSize), sr: ac.sampleRate };
    } catch (_) { mic = null; }
    return mic;
  }
  function stopMic() {
    if (mic) { try { mic.stream.getTracks().forEach((t) => t.stop()); mic.src.disconnect(); } catch (_) {} mic = null; }
    if (micCtx) { try { micCtx.close(); } catch (_) {} micCtx = null; }
  }
  async function captureSung(ms, onLevel) {
    const m = await ensureMic(); if (!m) return { ok: false, reason: "no-mic" };
    const hz = [], end = performance.now() + ms;
    while (performance.now() < end && !abort) {
      m.an.getFloatTimeDomainData(m.buf);
      let rms = 0; for (let i = 0; i < m.buf.length; i++) rms += m.buf[i] * m.buf[i]; rms = Math.sqrt(rms / m.buf.length);
      const [p, clarity] = m.det.findPitch(m.buf, m.sr);
      if (clarity > 0.88 && p > 65 && p < 1100 && rms > 0.008) hz.push(p);
      if (onLevel) onLevel(Math.min(1, rms * 12), hz.length);
      await new Promise((r) => setTimeout(r, 30));
    }
    if (hz.length < 8) return { ok: false, reason: "no-pitch", frames: hz.length };
    hz.sort((a, b) => a - b);
    const med = hz[hz.length >> 1], midi = 69 + 12 * Math.log2(med / 440);
    return { ok: true, hz: Math.round(med * 10) / 10, midi: Math.round(midi * 100) / 100, frames: hz.length };
  }
  async function prepAudio(needMic) {
    if (needMic && singOn() && !micCtx) { try { micCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }  // inside the tap
    try { await Tone.start(); } catch (_) {}
    try { await ctx.ensurePiano(); } catch (_) {}
    try { await ctx.ensureSampleBank(); } catch (_) {}
    if (needMic && singOn()) await ensureMic();
  }

  // ---- DOM ----------------------------------------------------------------------
  const $ = (s) => root.querySelector(s);
  function stage(html) {
    root.innerHTML = html;
    const w = (id, fn) => { const el = root.querySelector(id); if (el) el.onclick = fn; };
    w("#cal-exit", () => interrupt("hub"));
    w("#dr-end", () => interrupt("end"));
    w("#dr-switch", () => interrupt("switch"));
    w("#dr-easy", () => bump(+1));
    w("#dr-hard", () => bump(-1));
  }
  function interrupt(intent) { if (!run) return; run.intent = intent; abort = true; clearTimers(); stopNoise(); done(null); flushWaits(); }
  function toast(t) {
    let el = document.getElementById("cal-toast");
    if (!el) { el = document.createElement("div"); el.id = "cal-toast"; el.className = "toast cal-toast"; document.body.appendChild(el); }
    el.textContent = t; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), 2300);
  }
  // Header: calibration shows overall progress; a drill shows level + live stats.
  function head(skill, info = {}) {
    if (run.mode === "drill") {
      const acc = run.g ? `${Math.round((run.k / run.g) * 100)}%` : "—", hs = run.skill;   // always the host drill's header
      return `<div class="dr-top">
          <button class="cal-x" id="dr-end" title="end">✕</button>
          <div class="dr-title">${META[hs].icon} ${TITLE[hs]} <span class="dr-lv">L${run.level}</span></div>
          <button class="dr-sw" id="dr-switch" title="switch drill">⇄</button>
        </div>
        <div class="dr-stats">${run.n} done · ${acc} · 🔥 ${run.streak}</div>
        ${info.popup ? `<div class="cal-popup">⚓ Pop-up — anchor check</div>` : ""}`;
    }
    const title = info.popup ? "⚓ Anchor pop-up" : run.stepTitle || TITLE[skill];
    return `<div class="cal-top">
        <button class="cal-x" id="cal-exit">✕</button>
        <div class="cal-prog"><div class="cal-prog-bar" style="width:${Math.round(((run.step - 1) / CAL.length) * 100)}%"></div></div>
        <div class="cal-step">${run.step}/${CAL.length}</div>
      </div>
      <div class="cal-kicker">${title}${run.plan.focus && run.plan.focus === skill ? " · today's focus" : ""}</div>
      ${info.n ? `<div class="cal-trialcount">${info.i + 1}/${info.n}</div>` : ""}`;
  }
  const foot = (info = {}) => (run && run.mode === "drill" && !info.popup ? `<div class="dr-foot"><button id="dr-hard">😵 too hard</button><button id="dr-easy">😴 too easy</button></div>` : "");
  function setPhase(t) { const el = $("#cal-phase"); if (el) el.textContent = t; }
  function fb(ok, html) { const el = $("#cal-fb"); if (el) { el.innerHTML = html; el.className = "cal-fb " + (ok ? "ok" : "bad"); } }
  async function ask(sel) {
    const g = $(sel); if (!g) return { v: null, rt: null };
    g.hidden = false;
    const shown = performance.now();
    g.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v)));
    const v = await wait();
    return { v, rt: Math.round(performance.now() - shown) };
  }
  // A short breather before each question's first sound, so the note you just
  // answered isn't followed straight away by the next one (no relative shortcut).
  const BREATH = 700;
  // "▶ replay (1×)": one extra listen, logged; hidden once you answer.
  const replayBtn = `<button class="cal-cta ghost-cta cal-r1" id="cal-r1" hidden>▶ replay (1×)</button>`;
  function armReplay(fn) {
    const st = { n: 0 }, b = $("#cal-r1");
    if (b) { b.hidden = false; b.onclick = () => { if (st.n) return; st.n = 1; b.disabled = true; b.textContent = "replayed"; fn(); }; }
    return st;
  }
  // Anchor exposure clock — pop-ups log how long since you last heard today's note.
  function exposed(pc) { if (run && pcOf(pc) === run.anchor) { run.lastAnchorAt = Date.now(); run.trialsSinceAnchor = 0; } }
  function markChoices(sel, right, chosen) {
    const r1 = $("#cal-r1"); if (r1) r1.hidden = true;
    root.querySelectorAll(`${sel} [data-v]`).forEach((b) => {
      b.onclick = null;
      if (b.dataset.v === String(right)) b.classList.add("ok"); else if (b.dataset.v === String(chosen)) b.classList.add("bad");
    });
  }
  const grid = (opts) => `<div class="cal-grid" id="cal-grid" hidden${opts.length < 12 ? ` style="grid-template-columns:repeat(${opts.length === 4 ? 2 : 3},1fr)"` : ""}>${opts.map((j) => `<button class="cal-key" data-v="${j}">${PC[j]}</button>`).join("")}</div>`;

  // ---- levels, conditions, logging ---------------------------------------------
  const lvlFor = (skill) => (run.mode === "drill" && skill === run.skill ? run.level : run.plan.levels[skill] || 1);
  const P = (skill) => D.paramsFor(skill, lvlFor(skill));
  // Stratified condition blocks, so randomized contrasts stay balanced in both modes.
  function nextCond(skill) {
    const q = run.sched[skill] || (run.sched[skill] = []);
    if (!q.length) q.push(...makeBlock(skill, run.mode === "calibration" ? run.plan.counts[skill] || 6 : skill === "tri" ? 12 : 10));
    return q.shift();
  }
  function makeBlock(skill, n) {
    const arr = Array.from({ length: n }, () => ({})), idx = () => shuffle([...Array(n).keys()]);
    const p = P(skill);
    if (skill === "name") {
      const nNo = Math.max(1, Math.round(n * p.noWashFrac)), nSine = n >= 5 ? Math.max(1, Math.round(n * p.sineFrac)) : 0;
      idx().forEach((j, r) => { arr[j].wash = r >= nNo; arr[j].timbre = r >= nNo && r < nNo + nSine ? "sine" : "piano"; });
    }
    if (skill === "hold") {
      idx().forEach((j, r) => { arr[j].interference = r < Math.round(n * p.tonesFrac) ? "tones" : "noise"; });
      idx().forEach((j, r) => { arr[j].same = r < Math.floor(n / 2); });
    }
    if (skill === "anchor") idx().forEach((j, r) => { arr[j].isAnchor = r < Math.ceil(n / 2); });
    if (skill === "tune") idx().forEach((j, r) => { arr[j].inTune = r < Math.ceil(n / 2); });
    if (skill === "cue") idx().forEach((j, r) => { arr[j].bare = r % 2 === 1; });
    if (skill === "tri") idx().forEach((j, r) => { arr[j].anchor = r % 12; });
    return arr;
  }
  function logTrial(skill, fields) {
    if (!run || !run.session) return;
    const now = new Date();
    D.putTrial({
      id: `${run.session.id}:${run.seq}`, sessionId: run.session.id, schema: D.SCHEMA_VERSION, protocol: D.PROTOCOL,
      mode: run.mode, station: skill, gi: run.seq++, t: now.getTime(), hour: now.getHours(), dow: now.getDay(),
      level: lvlFor(skill), rtFrom: "onset", correct: null, rt: null, ...fields,
    }).catch(() => {});
    pushSoon();
  }
  // Trickle-push during a run so a dropped phone loses at most ~45 s of cloud copy.
  let pushT = null;
  function pushSoon() { if (pushT) return; pushT = setTimeout(() => { pushT = null; D.syncCloud().catch(() => {}); }, 45000); }
  function record(skill, correct) {
    if (typeof correct !== "boolean") return;
    const r = run.tally[skill] || (run.tally[skill] = { n: 0, k: 0 });
    r.n++; if (correct) r.k++;
    run.trialsSinceAnchor = (run.trialsSinceAnchor || 0) + 1;
  }
  const weightedPc = () => D.weightedPick(run.plan.pcWeights, 1)[0];

  // ===========================================================================
  // SKILL TRIALS — one trial each; shared by calibration and drills.
  // Return { correct } (true/false/null), or null if interrupted.
  // ===========================================================================
  async function trCue(info) {
    const p = P("cue"), cond = nextCond("cue"), pc = weightedPc();
    const kind = p.mixBare && cond.bare ? "note2cue" : "cue2note";
    let opts = PC.map((_, j) => j);
    if (p.choices < 12) opts = shuffle([pc, ...shuffle(opts.filter((j) => j !== pc)).slice(0, p.choices - 1)]).sort((a, b) => a - b);
    stage(head("cue", info) + `
      <div class="cal-stage">
        <div class="cal-say">${kind === "cue2note" ? "Which note does this song tag start on?" : "Bare note — what's its song tag? Hear it inside, then name the note."}</div>
        <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
        ${grid(opts)}
        ${replayBtn}
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    await sleep(BREATH); await cleanser(); if (abort) return null;
    const hear = () => (kind === "cue2note" ? cueSample(pc, false) : playMidi(midiOf(pc, 4), 1.4));
    await hear(); if (abort) return null;
    setPhase(kind === "cue2note" ? "🎧 name its first note ↓" : "🎧 …its tag? name it ↓");
    const rp = armReplay(hear);
    const { v, rt } = await ask("#cal-grid"); if (abort || v == null) return null;
    const resp = +v, correct = resp === pc;
    record("cue", correct);
    logTrial("cue", { ti: info.i, stim: { pc, kind, choices: opts.length, cleansed: true }, resp, correct, rt, replays: rp.n });
    markChoices("#cal-grid", pc, resp);
    fb(correct, `${correct ? "✅" : "❌"} ${PC[pc]} — note · tag · note`);
    await sleep(500);
    await noteCue(pc);
    return abort ? null : { correct };
  }

  async function trImagine(info) {
    const p = P("imagine"), pc = weightedPc(), sing = singOn();
    stage(head("imagine", info) + `<div class="cal-stage"><div class="cal-phase">🌀 clearing your ear…</div></div>` + foot());
    await sleep(BREATH); await cleanser(); if (abort) return null;
    stage(head("imagine", info) + `
      <div class="cal-stage">
        <div class="cal-say">Hear this note ringing in your mind:</div>
        <div class="cal-big">${PC[pc]}</div>
        <div class="cal-count" id="cal-count">${p.secs}</div>
        <div class="cal-hint">No sound yet — ${sing ? "get ready to sing it" : "sing it silently"}.</div>
      </div>` + foot());
    await countdown($("#cal-count"), p.secs); if (abort) return null;
    let sung = null;
    if (sing) {
      stage(head("imagine", info) + `
        <div class="cal-stage"><div class="cal-big">🎤</div><div class="cal-say">Sing <b>${PC[pc]}</b> now — hold it steady</div>
          <div class="cal-meter"><div class="cal-meter-bar" id="cal-meter"></div></div></div>` + foot());
      sung = await captureSung(2300, (lvl) => { const b = $("#cal-meter"); if (b) b.style.width = `${Math.round(lvl * 100)}%`; });
      if (abort) return null;
      if (sung.ok) { sung.cents = Math.round(((((sung.midi - pc) % 12) + 18) % 12 - 6) * 100); sung.oct = Math.floor(Math.round(sung.midi) / 12) - 1; }
    }
    if (sung && sung.ok) {
      const c = sung.cents, correct = Math.abs(c) <= 50;
      record("imagine", correct);
      logTrial("imagine", { ti: info.i, stim: { pc, secs: p.secs }, resp: "sung", correct, sing: sung });
      const how = Math.abs(c) <= 15 ? "dead on 🎯" : `${c > 0 ? "+" : ""}${c}¢ ${c > 0 ? "sharp" : "flat"}`;
      stage(head("imagine", info) + `<div class="cal-stage"><div class="cal-say">That's</div><div class="cal-big ok-glow">${PC[pc]}</div>
        <div class="cal-fb ${correct ? "ok" : "bad"}">You sang ${how}${Math.abs(c) > 50 ? ` — closer to ${PC[pcOf(sung.midi)]}` : ""}</div></div>` + foot());
      await noteCue(pc);
      return abort ? null : { correct };
    }
    stage(head("imagine", info) + `
      <div class="cal-stage"><div class="cal-say">That's</div><div class="cal-big ok-glow">${PC[pc]}</div>
        ${sung ? `<div class="cal-hint">(mic didn't catch a clear pitch)</div>` : ""}
        <div class="cal-say">How close were you?</div>
        <div class="cal-choices" id="cal-ch" hidden><button class="cal-choice" data-v="nailed">🎯 Nailed it</button><button class="cal-choice" data-v="off">😬 Off</button></div>
      </div>` + foot());
    await noteCue(pc); if (abort) return null;
    later(() => done(null), 6000);
    const { v, rt } = await ask("#cal-ch"); if (abort) return null;
    logTrial("imagine", { ti: info.i, stim: { pc, secs: p.secs }, resp: v, rt: v ? rt : null, sing: sung });
    return { correct: null };
  }

  async function trAnchor(info) {
    const p = P("anchor"), cond = nextCond("anchor"), isAnchor = !!cond.isAnchor;
    const A = run.anchor, subSemi = p.lures.some((c) => c % 100 !== 0);
    const vtype = subSemi ? pick(VOICES) : null;                     // cent-level lures → identical synth path for all
    const offsetCents = isAnchor ? 0 : pick(p.lures), oct = pick(p.octaves), base = midiOf(A, oct);
    const label = isAnchor ? midiName(base) : offsetCents % 100 === 0 ? midiName(base + offsetCents / 100) : `${PC[A]} ${offsetCents > 0 ? "+" : ""}${offsetCents}¢`;
    stage(head("anchor", info) + `
      <div class="cal-stage">
        <div class="cal-say">Is this today's note — exactly <b>${PC[A]}</b>?</div>
        <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
        <div class="cal-choices" id="cal-ch" hidden><button class="cal-choice" data-v="yes">Yes, it's ${PC[A]}</button><button class="cal-choice" data-v="no">No</button></div>
        ${replayBtn}
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot(info));
    const sinceMs = run.lastAnchorAt ? Date.now() - run.lastAnchorAt : null, sinceTrials = run.trialsSinceAnchor ?? null;
    await sleep(BREATH); await cleanser(true); if (abort) return null;
    const hear = () => (vtype ? playTuned(base, offsetCents, vtype, 1.5) : playHz(base, offsetCents, 1.5));
    setPhase("🎧 your call ↓");
    await hear(); if (abort) return null;
    const rp = armReplay(hear);
    const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return null;
    const correct = (v === "yes") === isAnchor;
    record("anchor", correct);
    logTrial("anchor", { ti: info.i, stim: { pc: pcOf(base + offsetCents / 100), anchorPc: A, isAnchor, offsetCents, oct, voice: vtype || "piano",
      popup: !!info.popup, host: run.mode === "drill" ? run.skill : run.curSkill || null, sinceAnchorMs: sinceMs, trialsSinceAnchor: sinceTrials }, resp: v, correct, rt, replays: rp.n });
    markChoices("#cal-ch", isAnchor ? "yes" : "no", v);
    fb(correct, `${correct ? "✅ Right" : "❌ Nope"} — that was ${label}. Here's ${PC[A]}:`);
    await sleep(400);
    await noteCue(A);
    return abort ? null : { correct };
  }

  // The diagnostic core: cleanser presence + timbre come from a stratified block.
  async function trName(info) {
    const p = P("name"), cond = nextCond("name");
    const wash = cond.wash !== false, timbre = cond.timbre || "piano";
    const oct = pick(p.octaves), pc = weightedPc(), m = midiOf(pc, oct);
    const prevMidi = lastLabeled, prevPc = prevMidi == null ? null : pcOf(prevMidi);
    stage(head("name", info) + `
      <div class="cal-stage">
        <div class="cal-say">Name it — no reference tone.</div>
        <div class="cal-phase" id="cal-phase">${wash ? "🌀 clearing…" : "…"}</div>
        ${grid(PC.map((_, j) => j))}
        ${replayBtn}
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    // No-cleanser trials (the relative-pitch test) still get a real pause after the last note.
    const preGapMs = wash ? BREATH : 1800;
    await sleep(preGapMs); if (wash) await cleanser();
    if (abort) return null;
    setPhase(timbre === "sine" ? "🎧 name it ↓ (pure tone)" : "🎧 name it ↓");
    await playStim(m, timbre, 1.4); if (abort) return null;
    const rp = armReplay(() => playStim(m, timbre, 1.4));
    const { v, rt } = await ask("#cal-grid"); if (abort || v == null) return null;
    const resp = +v, correct = resp === pc;
    record("name", correct);
    logTrial("name", { ti: info.i, stim: { pc, oct, midi: m, wash, timbre, prevMidi, prevPc, prevInt: prevPc == null ? null : D.circ(prevPc, pc), preGapMs },
      resp, correct, rt, replays: rp.n, errSemis: correct ? 0 : D.circ(pc, resp) });
    markChoices("#cal-grid", pc, resp);
    fb(correct, correct ? `✅ ${PC[pc]}` : `❌ it was ${PC[pc]}`);
    await sleep(400);
    exposed(pc);
    await playStim(m, timbre, 1.0); await sleep(700);
    await cueSample(pc);
    await playStim(m, timbre, 1.0); await sleep(700);           // end on the labeled note
    lastLabeled = m;
    return abort ? null : { correct };
  }

  async function trHold(info) {
    const p = P("hold"), cond = nextCond("hold");
    const dur = run.mode === "calibration" && run.plan.holdDurs[info.i] ? run.plan.holdDurs[info.i] : p.range[0] + rand(p.range[1] - p.range[0] + 1);
    const pc = rand(12), m = midiOf(pc, 4), same = !!cond.same, interference = cond.interference || "noise";
    const probeCents = same ? 0 : (Math.random() < 0.5 ? -1 : 1) * p.cents;
    const vtype = pick(VOICES);                                      // same voice for both → only pitch can differ
    stage(head("hold", info) + `
      <div class="cal-stage">
        <div class="cal-hint">${dur}s hold · ${interference === "tones" ? "stray notes" : "noise"} · ±${p.cents}¢</div>
        <div class="cal-say">Lock onto this note. Keep it alive — don't hum.</div>
        <div class="cal-phase" id="cal-phase">🎧 listen</div>
        <div class="cal-count" id="cal-count"></div>
        <div class="cal-choices" id="cal-ch" hidden><button class="cal-choice" data-v="same">Same</button><button class="cal-choice" data-v="diff">Different</button></div>
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    await sleep(BREATH); if (abort) return null;
    await playTuned(m, 0, vtype, 1.3); await sleep(1300); if (abort) return null;
    setPhase(interference === "tones" ? "🎹 ignore these… hold it" : "🌫️ hold it…");
    countdown($("#cal-count"), dur);
    if (interference === "tones") await distractors(p.distractors, dur * 1000, pc); else await noiseBed(dur * 1000);
    if (abort) return null;
    const ce = $("#cal-count"); if (ce) ce.textContent = "";
    setPhase("🎧 probe — same note?");
    await playTuned(m, probeCents, vtype, 1.3); if (abort) return null;
    const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return null;
    const correct = (v === "same") === same;
    record("hold", correct);
    logTrial("hold", { ti: info.i, stim: { pc, dur, same, probeCents, interference, distractors: interference === "tones" ? p.distractors : 0, voice: vtype }, resp: v, correct, rt });
    markChoices("#cal-ch", same ? "same" : "diff", v);
    fb(correct, `${correct ? "✅" : "❌"} ${same ? "Same note" : `Different — probe was ${probeCents > 0 ? "+" : ""}${probeCents}¢`} (${midiName(m)})`);
    lastLabeled = m;
    await sleep(2000);
    return abort ? null : { correct };
  }

  async function trTwins(info) {
    const p = P("twins"), a = rand(12), offset = pick(p.offsets), b = (a + offset) % 12;
    const octs = shuffle([3, 4, 5]), oddSlot = rand(3);
    const notes = octs.map((o, j) => midiOf(j === oddSlot ? b : a, o));
    let replays = 0;
    stage(head("twins", info) + `
      <div class="cal-stage">
        <div class="cal-say">Two of these share a note name, in different octaves. Which is the odd one out?</div>
        <div class="cal-dots">${[0, 1, 2].map((j) => `<span class="cal-dot" data-d="${j}">${j + 1}</span>`).join("")}</div>
        <button class="cal-cta ghost-cta" id="cal-replay">▶ replay</button>
        <div class="cal-choices" id="cal-ch" hidden>${[0, 1, 2].map((j) => `<button class="cal-choice" data-v="${j}">${j + 1}</button>`).join("")}</div>
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    const playSeq = async () => {
      for (let j = 0; j < 3 && !abort; j++) {
        root.querySelectorAll(".cal-dot").forEach((d) => d.classList.toggle("on", +d.dataset.d === j));
        await playMidi(notes[j], 0.9);
        if (j < 2) await sleep(900);                                 // answer as soon as the 3rd note starts
      }
      setTimeout(() => root.querySelectorAll(".cal-dot").forEach((d) => d.classList.remove("on")), 800);
    };
    $("#cal-replay").onclick = () => { replays++; playSeq(); };
    await sleep(BREATH); await playSeq(); if (abort) return null;
    const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return null;
    const resp = +v, correct = resp === oddSlot;
    record("twins", correct);
    logTrial("twins", { ti: info.i, stim: { a, b, offset, octs, oddSlot, notes }, resp, correct, rt, replays });
    markChoices("#cal-ch", oddSlot, resp);
    fb(correct, `${correct ? "✅" : "❌"} ${notes.map(midiName).join(" · ")}`);
    lastLabeled = notes[2];
    await sleep(2400);
    return abort ? null : { correct };
  }

  async function trTriad(info) {
    const q = P("triad"), POS = ["bottom", "middle", "top"];
    const SHAPE = { maj: [4, 7], min: [3, 7], dim: [3, 6], aug: [4, 8] };
    const quality = pick(["maj", "min"].concat(q.dimAug ? ["dim", "aug"] : []));
    const [third, fifth] = SHAPE[quality];
    const inversion = pick([0].concat(q.firstInv ? [1] : [], q.secondInv ? [2] : []));
    const r = midiOf(rand(12), pick([3, 4]));
    let chord = inversion === 0 ? [r, r + third, r + fifth] : inversion === 1 ? [r + third, r + fifth, r + 12] : [r + fifth, r + 12, r + 12 + third];
    const spread = q.spread && Math.random() < 0.5;
    if (spread) chord = [chord[0], chord[1] + 12, chord[2] + 12];
    chord.sort((x, y) => x - y);
    const posIdx = rand(3), targetPc = pcOf(chord[posIdx]);
    let replays = 0;
    stage(head("triad", info) + `
      <div class="cal-stage">
        <div class="cal-say">There's a <b>${PC[targetPc]}</b> in this chord.<br>Bottom, middle, or top?</div>
        <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
        <button class="cal-cta ghost-cta" id="cal-replay">▶ replay chord</button>
        <div class="cal-choices col" id="cal-ch" hidden>${POS.map((p, j) => `<button class="cal-choice" data-v="${j}">${p[0].toUpperCase() + p.slice(1)}</button>`).join("")}</div>
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    $("#cal-replay").onclick = () => { replays++; playChord(chord); };
    await sleep(BREATH); await cleanser(); if (abort) return null;
    setPhase("🎧 where is it? ↓");
    await playChord(chord); if (abort) return null;
    const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return null;
    const resp = +v, correct = resp === posIdx;
    record("triad", correct);
    logTrial("triad", { ti: info.i, stim: { rootPc: pcOf(r), quality, inversion, spread, chord, targetPc, posIdx }, resp, correct, rt, replays });
    markChoices("#cal-ch", posIdx, resp);
    fb(correct, `${correct ? "✅" : "❌"} ${PC[targetPc]} was the <b>${POS[posIdx]}</b> note`);
    await sleep(400);
    await arpeggiate(chord); if (abort) return null;
    exposed(targetPc);
    await playMidi(chord[posIdx], 0.9); await sleep(650);
    await cueSample(targetPc);
    lastLabeled = chord[posIdx];
    return abort ? null : { correct };
  }

  async function trTune(info) {
    const p = P("tune"), cond = nextCond("tune"), inTune = !!cond.inTune;
    const pc = weightedPc(), oct = pick([3, 4, 5]), m = midiOf(pc, oct);
    const cents = inTune ? 0 : (Math.random() < 0.5 ? -1 : 1) * p.cents;
    const vtype = pick(VOICES);
    stage(head("tune", info) + `
      <div class="cal-stage">
        <div class="cal-say">Exactly on a note — or a hair off?</div>
        <div class="cal-hint">off by ±${p.cents}¢ when it's off</div>
        <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
        <div class="cal-choices" id="cal-ch" hidden><button class="cal-choice" data-v="in">🎯 In tune</button><button class="cal-choice" data-v="off">〰️ Off</button></div>
        ${replayBtn}
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    await sleep(BREATH); await cleanser(true); if (abort) return null;
    setPhase("🎧 in tune or off? ↓");
    await playTuned(m, cents, vtype, 1.6); if (abort) return null;
    const rp = armReplay(() => playTuned(m, cents, vtype, 1.6));
    const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return null;
    const correct = (v === "in") === inTune;
    record("tune", correct);
    logTrial("tune", { ti: info.i, stim: { pc, oct, inTune, cents, voice: vtype }, resp: v, correct, rt, replays: rp.n });
    markChoices("#cal-ch", inTune ? "in" : "off", v);
    fb(correct, `${correct ? "✅" : "❌"} ${inTune ? `Right on ${PC[pc]}` : `${cents > 0 ? "+" : ""}${cents}¢ off ${PC[pc]}`} — here's the real one:`);
    await sleep(400);
    await noteCue(pc, oct);
    return abort ? null : { correct };
  }

  // Triangulate: mystery note → imagine an assigned anchor → find the note from it.
  // Anchors are stratified over all 12, so the data shows which mental anchors work.
  async function trTri(info) {
    const p = P("tri"), cond = nextCond("tri"), anchor = Number.isFinite(cond.anchor) ? cond.anchor : rand(12);
    const dists = []; for (let d = -p.maxDist; d <= p.maxDist; d++) if (d) dists.push(d);
    const dist = pick(dists), target = (anchor + dist + 12) % 12, oct = pick(p.octaves), m = midiOf(target, oct);
    let replays = 0;
    stage(head("tri", info) + `
      <div class="cal-stage">
        <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
        <div class="cal-say" id="tri-say">Listen to the mystery note.</div>
        <button class="cal-cta ghost-cta" id="cal-replay" hidden>▶ replay mystery note</button>
        ${grid(PC.map((_, j) => j))}
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    $("#cal-replay").onclick = () => { replays++; playMidi(m, 1.2); };
    await sleep(BREATH); await cleanser(); if (abort) return null;
    setPhase(`🧭 imagine ${PC[anchor]} → name it ↓`);
    const say = $("#tri-say"); if (say) say.innerHTML = `Mystery note… now hear <b>${PC[anchor]}</b> in your head (don't hum).<br>From ${PC[anchor]}, find the mystery note.`;
    await playMidi(m, 1.4); if (abort) return null;
    const rb = $("#cal-replay"); if (rb) rb.hidden = false;
    const { v, rt } = await ask("#cal-grid"); if (abort || v == null) return null;
    const resp = +v, correct = resp === target;
    record("tri", correct);
    logTrial("tri", { ti: info.i, stim: { anchor, target, dist, oct, midi: m }, resp, correct, rt, replays, errSemis: correct ? 0 : D.circ(target, resp) });
    markChoices("#cal-grid", target, resp);
    const rel = `${Math.abs(dist)} semitone${Math.abs(dist) > 1 ? "s" : ""} ${dist > 0 ? "above" : "below"} ${PC[anchor]}`;
    fb(correct, `${correct ? "✅" : "❌"} ${PC[target]} — ${rel}. Hear both with their tags: ${PC[anchor]} → ${PC[target]}`);
    await sleep(400);
    // The real anchor, then the mystery note — each followed by its PP-MIDI tag, in order.
    exposed(anchor); exposed(target);
    setPhase(`⚓ anchor: ${PC[anchor]}`);
    await playMidi(m - dist, 0.9); await sleep(750); if (abort) return null;
    await cueSample(anchor); if (abort) return null;
    setPhase(`🎯 mystery: ${PC[target]}`);
    await playMidi(m, 1.0); await sleep(750); if (abort) return null;
    await cueSample(target); if (abort) return null;
    lastLabeled = m;
    return abort ? null : { correct };
  }

  // Neighbors: "E♭ or D?" — chroma between next-door notes, no reference.
  async function trPair(info) {
    const p = P("pair"), lo = rand(12), hi = (lo + p.step) % 12, pair = [lo, hi];
    const pc = Math.random() < 0.5 ? lo : hi, oct = pick(p.octaves), m = midiOf(pc, oct);
    const vtype = p.synth && Math.random() < 0.5 ? pick(VOICES) : null;
    stage(head("pair", info) + `
      <div class="cal-stage">
        <div class="cal-say">Is this <b>${PC[lo]}</b> or <b>${PC[hi]}</b>?</div>
        <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
        <div class="cal-choices" id="cal-ch" hidden>${pair.map((x) => `<button class="cal-choice big-note" data-v="${x}">${PC[x]}</button>`).join("")}</div>
        ${replayBtn}
        <div class="cal-fb" id="cal-fb"></div>
      </div>` + foot());
    await sleep(BREATH); await cleanser(); if (abort) return null;
    const hear = () => (vtype ? playTuned(m, 0, vtype, p.dur) : playMidi(m, p.dur));
    setPhase(vtype ? "🎧 which one? (synth)" : "🎧 which one?");
    await hear(); if (abort) return null;
    const rp = armReplay(hear);
    const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return null;
    const resp = +v, correct = resp === pc;
    record("pair", correct);
    logTrial("pair", { ti: info.i, stim: { pc, pair, step: p.step, oct, timbre: vtype || "piano", dur: p.dur }, resp, correct, rt, replays: rp.n });
    markChoices("#cal-ch", pc, resp);
    fb(correct, `${correct ? "✅" : "❌"} it was ${PC[pc]}`);
    await sleep(300);
    await noteCue(pc, oct);
    return abort ? null : { correct };
  }

  const TRIAL = { cue: trCue, name: trName, imagine: trImagine, anchor: trAnchor, hold: trHold, twins: trTwins, triad: trTriad, tune: trTune, tri: trTri, pair: trPair };

  async function countdown(el, secs) {
    for (let s = secs; s > 0; s--) { if (abort) return; if (el) el.textContent = s; await sleep(1000); }
    if (el && !abort) el.textContent = "♪";
  }

  // ===========================================================================
  // DAILY CALIBRATION (protocol v2)
  // ===========================================================================
  async function calAttune() {
    clearTimers();
    const t0 = performance.now(); let skipped = false;
    stage(head("attune") + `
      <div class="cal-stage">
        <div class="cal-hint">${anchorMode() === "fixed" ? "your home note" : "today's note · rotates daily, weakest first"}</div>
        <div class="cal-big pulse" id="cal-anchor">${PC[run.anchor]}</div>
        <div class="cal-say">Breathe. Let it settle in — hum it quietly.</div>
        <div class="cal-hint">Note · its song tag · note. It's your anchor for today.</div>
        <button class="cal-cta ghost-cta" id="cal-skip">I've got it →</button>
      </div>`);
    $("#cal-skip").onclick = () => { skipped = true; done(); };
    const myGen = gen; let reps = 0;
    const beat = async () => {
      if (abort || myGen !== gen) return;
      const el = $("#cal-anchor"); if (el) { el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); }
      await noteCue(run.anchor);
      if (abort || myGen !== gen) return;
      reps++;
      if (reps >= 3) later(() => done(), 2500); else later(beat, 2600);
    };
    beat();
    await wait();
    logTrial("attune", { stim: { pc: run.anchor, reps }, durMs: Math.round(performance.now() - t0), skipped });
  }
  // Learn phase before Song anchors: the weakest notes, note · tag · note.
  async function calCueLearn() {
    for (const pc of run.plan.cueLearn) {
      if (abort) return;
      clearTimers();
      stage(head("cue") + `<div class="cal-stage"><div class="cal-hint">learn</div><div class="cal-big ok-glow">${PC[pc]}</div><div class="cal-say">note · its tag · note</div></div>`);
      await noteCue(pc); await sleep(500);
      logTrial("cue", { stim: { pc, kind: "learn" } });
    }
  }
  async function calBlock(skill) {
    if (skill === "cue") await calCueLearn();
    run.curSkill = skill;
    const n = run.plan.counts[skill];
    for (let i = 0; i < n && !abort; i++) {
      clearTimers();
      const r = await TRIAL[skill]({ i, n });
      if (abort || r === null) return;
      run.slot = (run.slot || 0) + 1;
      if (run.popSlots && run.popSlots.has(run.slot)) { clearTimers(); const pr = await trAnchor({ popup: true }); if (abort || pr === null) return; }
    }
  }
  // Anchor checks no longer come as a block (you'd still hear the last one):
  // they pop up at random points between other questions, never back to back.
  function makePopSlots(plan) {
    const S = ["cue", "imagine", "name", "hold", "twins", "triad"].reduce((a, k) => a + (plan.counts[k] || 0), 0);
    const K = plan.counts.anchor || 5, picks = new Set();
    for (const c of shuffle([...Array(Math.max(0, S - 2)).keys()].map((x) => x + 2))) {
      if (picks.size >= K) break;
      if (![...picks].some((q) => Math.abs(q - c) < 2)) picks.add(c);
    }
    return picks;
  }
  async function calLockin() {
    const pcs = D.weightedPick(run.plan.pcWeights.map((w) => w * w), run.plan.counts.lockin);
    for (const pc of pcs) {
      if (abort) return;
      clearTimers();
      stage(head("lockin") + `<div class="cal-stage"><div class="cal-big ok-glow">${PC[pc]}</div><div class="cal-say">feel where it sits — and its tag</div></div>`);
      await noteCue(pc); await sleep(400);
      logTrial("lockin", { stim: { pc, weight: Math.round(run.plan.pcWeights[pc] * 100) / 100 } });
    }
  }
  const CAL = [
    { title: "Attune", fn: calAttune },
    { title: "Song anchors", fn: () => calBlock("cue") },
    { title: "Imagine it", fn: () => calBlock("imagine") },
    { title: "Blindfold naming", fn: () => calBlock("name") },
    { title: "Hold it", fn: () => calBlock("hold") },
    { title: "Octave twins", fn: () => calBlock("twins") },
    { title: "Find the note", fn: () => calBlock("triad") },
    { title: "Lock it in", fn: calLockin },
  ];

  function checkin() {
    return new Promise((res) => {
      const ans = { energy: null, music: null, output: null };
      const row = (q, label, opts) => `<div class="cal-ci-row"><div class="cal-ci-l">${label}</div><div class="cal-ci-opts">${opts.map(([v, t]) => `<button class="cal-ci" data-q="${q}" data-val="${v}">${t}</button>`).join("")}</div></div>`;
      root.innerHTML = `<div class="cal-stage cal-checkin">
          <div class="cal-top"><button class="cal-x" id="ci-back">✕</button><div class="cal-prog"><div class="cal-prog-bar" style="width:0%"></div></div><div class="cal-step">0/${CAL.length}</div></div>
          <div class="cal-kicker">Quick check-in</div>
          <div class="cal-say">Two taps — it's how we find when your AP is sharpest.</div>
          ${row("energy", "Energy", [["low", "😴 low"], ["ok", "😐 ok"], ["high", "⚡ high"]])}
          ${row("music", "Music heard today", [["none", "none"], ["some", "some"], ["lots", "lots"]])}
          ${row("output", "Listening on", [["headphones", "🎧 headphones"], ["speaker", "🔊 speaker"]])}
          <button class="cal-cta big" id="cal-go">Start →</button>
        </div>`;
      root.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => {
        ans[b.dataset.q] = b.dataset.val;
        root.querySelectorAll(`[data-q="${b.dataset.q}"]`).forEach((x) => x.classList.toggle("sel", x === b));
      }));
      $("#ci-back").onclick = () => res(null);
      $("#cal-go").onclick = () => res(ans);
    });
  }

  async function startCalibration() {
    const ci = await checkin();
    if (!ci) return enter();
    const p = prepAudio(true);                                 // first sync part runs inside the tap
    root.innerHTML = `<div class="cal-stage cal-trans"><div class="cal-big">🎧</div><div class="cal-say">tuning up…</div></div>`;
    await p;
    const all = await D.allData();
    const today = D.localDate(Date.now());
    const plan = D.makePlan(all);
    dayAnchor = D.anchorOfDay(all, today, anchorMode());
    const session = {
      id: newId("s"), kind: "calibration", schema: D.SCHEMA_VERSION, protocol: D.PROTOCOL,
      startedAt: Date.now(), localDate: today,
      sessionOfDay: all.sessions.filter((s) => D.kindOf(s) === "calibration" && (s.localDate || D.localDate(s.startedAt)) === today).length + 1,
      dayIndex: all.sessions.length ? Math.floor((Date.now() - all.sessions[0].startedAt) / 86400000) : 0,
      checkin: ci, plan, completed: false, sing: singOn(), summary: {}, device: D.deviceInfo(), anchorPc: dayAnchor, anchorMode: anchorMode(),
      env: { ua: navigator.userAgent, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null, standalone: window.matchMedia("(display-mode: standalone)").matches },
    };
    await D.putSession(session);
    D.requestPersist();
    abort = false; lastLabeled = null;
    run = { mode: "calibration", anchor: dayAnchor, popSlots: makePopSlots(plan), slot: 0, session, plan, step: 0, stepTitle: "", sched: {}, tally: {}, seq: 0, intent: null };
    for (let s = 0; s < CAL.length && !abort; s++) {
      run.step = s + 1; run.stepTitle = CAL[s].title;
      await CAL[s].fn();
      if (abort) break;
      if (s < CAL.length - 1) await transition(s + 1);
    }
    if (abort) { const intent = run.intent; await endCalibration(false); if (intent === "hub") enter(); return; }
    await finishCalibration();
  }
  async function transition(step) {
    clearTimers();
    root.innerHTML = `<div class="cal-stage cal-trans">
        <div class="cal-prog" style="max-width:220px"><div class="cal-prog-bar" style="width:${Math.round((step / CAL.length) * 100)}%"></div></div>
        <div class="cal-big">✓</div>
        <div class="cal-say">nice — next: <b>${CAL[step].title}</b></div>
      </div>`;
    await sleep(1100);
  }
  async function endCalibration(completed) {
    if (!run || run.mode !== "calibration" || run.ended) return null;
    run.ended = true;
    const s = run.session;
    Object.assign(s, { completed, endedAt: Date.now(), summary: { ...run.tally } });
    s.durSec = Math.round((s.endedAt - s.startedAt) / 1000);
    await D.putSession(s).catch(() => {});
    D.syncAll().then(noteSync).catch(() => {});
    return s;
  }

  // ---- streak (calibration days) -------------------------------------------------
  const dkey = (d) => D.localDate(d.getTime());
  function loadLog() { try { return JSON.parse(localStorage.getItem("pt.cal.log")) || {}; } catch (_) { return {}; } }
  function markToday(acc, n) { const l = loadLog(), k = dkey(new Date()); l[k] = { acc, n, runs: ((l[k] && l[k].runs) || 0) + 1 }; try { localStorage.setItem("pt.cal.log", JSON.stringify(l)); } catch (_) {} }
  // Calibration days from synced sessions (any device) + this device's legacy log.
  function streakFrom(sessions = []) {
    const days = new Set(Object.keys(loadLog()));
    sessions.forEach((x) => { if (D.kindOf(x) === "calibration" && x.completed) days.add(x.localDate || D.localDate(x.startedAt)); });
    const c = new Date();
    if (!days.has(dkey(c))) { c.setDate(c.getDate() - 1); if (!days.has(dkey(c))) return 0; }
    let n = 0; while (days.has(dkey(c))) { n++; c.setDate(c.getDate() - 1); } return n;
  }

  async function finishCalibration() {
    clearTimers();
    const before = run.plan.levels;
    let n = 0, k = 0; Object.values(run.tally).forEach((r) => { n += r.n; k += r.k; });
    const acc = n ? Math.round((k / n) * 100) : null;
    markToday(acc, n);
    const s = await endCalibration(true);
    stopMic();
    run = null;
    const data = await D.allData();
    const after = D.stationLevels(data.sessions);
    const coach = D.suggestDrills(data);
    const moves = Object.keys(after).filter((st) => after[st] !== before[st])
      .map((st) => `<div class="cal-move ${after[st] > before[st] ? "up" : "down"}">${after[st] > before[st] ? "⬆" : "⬇"} ${TITLE[st]} → level ${after[st]}</div>`).join("");
    const nextUp = coach.ranked[0];
    root.innerHTML = `<div class="cal-stage cal-finish">
        <div class="cal-big">🎯</div>
        <div class="cal-title2">Calibrated.</div>
        <div class="cal-say">You're in absolute-pitch mode. Carry the anchor with you today.</div>
        <div class="cal-stats">
          <div class="cal-stat"><div class="cal-stat-n">🔥 ${streakFrom(data.sessions)}</div><div class="cal-stat-l">day streak</div></div>
          ${acc != null ? `<div class="cal-stat"><div class="cal-stat-n">${acc}%</div><div class="cal-stat-l">on target</div></div>` : ""}
          ${s && s.sessionOfDay > 1 ? `<div class="cal-stat"><div class="cal-stat-n">#${s.sessionOfDay}</div><div class="cal-stat-l">run today</div></div>` : ""}
        </div>
        ${moves ? `<div class="cal-moves"><div class="cal-hint">Program adjusted:</div>${moves}</div>` : ""}
        <div class="cal-coach-mini">Coach: <b>${META[nextUp.skill].icon} ${nextUp.title}</b> — ${nextUp.reason}</div>
        <button class="cal-cta" id="fin-drill">🏋️ Keep training: ${nextUp.title}</button>
        <button class="cal-cta ghost-cta" id="fin-hub">Training hub</button>
        <button class="cal-cta ghost-cta" id="fin-model">📊 Your ear model</button>
      </div>`;
    $("#fin-drill").onclick = () => startDrill(nextUp.skill);
    $("#fin-hub").onclick = () => enter();
    $("#fin-model").onclick = () => renderInsights();
  }

  // ===========================================================================
  // DRILLS — endless, adaptive; end / switch / too easy / too hard any time
  // ===========================================================================
  function drillLevels() { try { return JSON.parse(localStorage.getItem("pt.cal.drillLv")) || {}; } catch (_) { return {}; } }
  function saveDrillLevel(skill, l) { const d = drillLevels(); d[skill] = l; try { localStorage.setItem("pt.cal.drillLv", JSON.stringify(d)); } catch (_) {} }
  // Latest drill session for the skill (from ANY synced device) wins, then this
  // device's memory, then the calibration level.
  function drillLevel(skill, plan, sessions = []) {
    const last = sessions.filter((x) => D.kindOf(x) === "drill" && x.skill === skill && (x.endLevel || x.startLevel))
      .sort((a, b) => (a.endedAt || a.startedAt) - (b.endedAt || b.startedAt)).pop();
    return clampL((last && (last.endLevel || last.startLevel)) || drillLevels()[skill] || plan.levels[skill] || 1);
  }

  function setLevel(to, type) {
    const from = run.level; to = clampL(to);
    run.events.push({ t: Date.now(), type, from, to, atTrial: run.n });
    if (to === from) return false;
    run.level = to; saveDrillLevel(run.skill, to);
    const lv = $(".dr-lv"); if (lv) lv.textContent = `L${to}`;
    return true;
  }
  function bump(delta) {
    if (!run || run.mode !== "drill") return;
    const moved = setLevel(run.level + delta, delta > 0 ? "tooEasy" : "tooHard");
    run.recent = [];
    toast(moved ? `${delta > 0 ? "⏫" : "⏬"} Level ${run.level} from the next one` : delta > 0 ? "Already maxed — try ⇄ switch" : "Already at level 1");
  }
  function adapt(correct) {
    run.recent.push(correct); if (run.recent.length > 3) run.recent.shift();
    if (run.recent.length === 3 && run.recent.every(Boolean)) { if (setLevel(run.level + 1, "autoUp")) toast(`⬆ Level ${run.level}`); run.recent = []; }
    else if (run.recent.filter((x) => !x).length >= 2) { if (setLevel(run.level - 1, "autoDown")) toast(`⬇ Level ${run.level}`); run.recent = []; }
  }

  async function startDrill(skill) {
    const p = prepAudio(skill === "imagine");
    root.innerHTML = `<div class="cal-stage cal-trans"><div class="cal-big">${META[skill].icon}</div><div class="cal-say">${TITLE[skill]}…</div></div>`;
    await p;
    const data = await D.allData();
    const plan = D.makePlan(data), level = drillLevel(skill, plan, data.sessions);
    dayAnchor = D.anchorOfDay(data, D.localDate(Date.now()), anchorMode());
    const session = { id: newId("d"), kind: "drill", skill, schema: D.SCHEMA_VERSION, protocol: D.PROTOCOL, startedAt: Date.now(),
      localDate: D.localDate(Date.now()), startLevel: level, events: [], completed: false, sing: singOn(), device: D.deviceInfo(), anchorPc: dayAnchor };
    await D.putSession(session);
    D.requestPersist();
    abort = false; lastLabeled = null; clearTimers();
    run = { mode: "drill", anchor: dayAnchor, skill, level, plan, session, events: session.events, n: 0, g: 0, k: 0, streak: 0, best: 0, recent: [], sched: {}, tally: {}, seq: 0, intent: null };
    while (!abort) {
      clearTimers();
      const r = await TRIAL[skill]({ i: run.n });
      if (abort || r === null) break;
      run.n++;
      if (typeof r.correct === "boolean") {
        run.g++;
        if (r.correct) { run.k++; run.streak++; run.best = Math.max(run.best, run.streak); } else run.streak = 0;
        adapt(r.correct);
      }
      if (run.n % 15 === 0) toast(run.g && run.k / run.g > 0.85 ? "Crushing it — try ⏫ or ⇄ something new" : `${run.n} in — ⇄ switch anytime`);
      run.sincePop = (run.sincePop || 0) + 1;
      const popRate = typeof window !== "undefined" && window.__calPopRate != null ? window.__calPopRate : 0.22;   // test hook
      if (run.sincePop >= 3 && Math.random() < popRate) {         // ⚓ anchor pop-up between drill questions
        run.sincePop = 0; clearTimers();
        const pr = await trAnchor({ popup: true });
        if (abort || pr === null) break;
      }
    }
    const intent = run.intent || "end";
    const s = await endDrill(intent);
    if (intent === "exit") return;
    if (intent === "switch") return showPicker(skill);
    return drillSummary(s);
  }
  async function endDrill(reason) {
    if (!run || run.mode !== "drill" || run.ended) return null;
    run.ended = true;
    const s = run.session;
    Object.assign(s, { completed: true, endedAt: Date.now(), endReason: reason, n: run.n, graded: run.g, k: run.k, endLevel: run.level, bestStreak: run.best, summary: { ...run.tally } });
    s.durSec = Math.round((s.endedAt - s.startedAt) / 1000);
    const r = { ...s, skill: run.skill };
    run = null;
    stopMic();
    await D.putSession(s).catch(() => {});
    D.syncAll().then(noteSync).catch(() => {});
    return r;
  }
  async function drillSummary(s) {
    const data = await D.allData();
    const coach = D.suggestDrills(data);
    const alt = coach.ranked.find((x) => x.skill !== s.skill) || coach.ranked[0];
    const mins = Math.max(1, Math.round(s.durSec / 60));
    root.innerHTML = `<div class="cal-stage cal-finish">
        <div class="cal-big">${META[s.skill].icon}</div>
        <div class="cal-title2">${TITLE[s.skill]}</div>
        <div class="cal-stats">
          <div class="cal-stat"><div class="cal-stat-n">${s.n}</div><div class="cal-stat-l">done · ${mins}m</div></div>
          <div class="cal-stat"><div class="cal-stat-n">${s.graded ? pct(s.k / s.graded) : "—"}</div><div class="cal-stat-l">on target</div></div>
          <div class="cal-stat"><div class="cal-stat-n">L${s.startLevel}→${s.endLevel}</div><div class="cal-stat-l">best 🔥 ${s.bestStreak}</div></div>
        </div>
        <div class="cal-coach-mini">Coach: <b>${META[alt.skill].icon} ${alt.title}</b> — ${alt.reason}</div>
        <button class="cal-cta" id="sum-next">▶ ${alt.title}</button>
        <button class="cal-cta ghost-cta" id="sum-again">↻ ${TITLE[s.skill]} again</button>
        <button class="cal-cta ghost-cta" id="sum-hub">Training hub</button>
      </div>`;
    $("#sum-next").onclick = () => startDrill(alt.skill);
    $("#sum-again").onclick = () => startDrill(s.skill);
    $("#sum-hub").onclick = () => enter();
  }
  async function showPicker(from) {
    const coach = D.suggestDrills(await D.allData());
    const top = coach.ranked.find((x) => x.skill !== from) || coach.ranked[0];
    root.innerHTML = `<div class="cal-picker">
        <div class="dr-top"><button class="cal-x" id="pk-hub">‹</button><div class="dr-title">Switch to…</div><div style="width:2rem"></div></div>
        <div class="cal-coach-mini">Coach suggests <b>${top.title}</b> — ${top.reason}</div>
        <div class="hub-cards">${D.DRILLS.filter((sk) => sk !== from).map((sk) => drillCard(sk, sk === top.skill ? "suggested" : "")).join("")}</div>
      </div>`;
    $("#pk-hub").onclick = () => enter();
    root.querySelectorAll("[data-drill]").forEach((b) => (b.onclick = () => startDrill(b.dataset.drill)));
  }
  function drillCard(sk, note, stats) {
    return `<button class="hub-card cal-dcard" data-drill="${sk}" style="background:${META[sk].color}">
        <span class="hub-emoji">${META[sk].icon}</span>
        <div class="hub-card-top"><div class="hub-card-title">${TITLE[sk]}</div><div class="hub-card-sub">${META[sk].blurb}</div></div>
        <div class="hub-card-foot"><span class="hub-foot-tag">▶ ${note === "suggested" ? "Suggested" : "Drill"}</span><span class="hub-foot-note">${stats || ""}</span></div>
      </button>`;
  }

  // ===========================================================================
  // TRAINING HUB (home of Lucas mode)
  // ===========================================================================
  async function enter(opts = {}) {
    abort = false; clearTimers(); run = null;
    root.innerHTML = `<div class="cal-stage cal-trans"><div class="cal-big">🎯</div></div>`;
    let data = { sessions: [], trials: [] };
    try { data = await D.allData(); } catch (_) {}
    const coach = D.suggestDrills(data), plan = D.makePlan(data);
    const today = D.localDate(Date.now());
    dayAnchor = D.anchorOfDay(data, today, anchorMode());
    const calsToday = data.sessions.filter((s) => D.kindOf(s) === "calibration" && s.completed && (s.localDate || D.localDate(s.startedAt)) === today);
    const sumAcc = (s) => { let n = 0, k = 0; Object.values(s.summary || {}).forEach((r) => { n += r.n; k += r.k; }); return n ? k / n : null; };
    const since = Date.now() - 3 * 86400000;
    const recentAcc = (sk) => { const g = data.trials.filter((t) => t.station === sk && t.t >= since && typeof t.correct === "boolean"); return g.length >= 3 ? g.filter((t) => t.correct).length / g.length : null; };
    const s = streakFrom(data.sessions), nCal = data.sessions.filter((x) => D.kindOf(x) === "calibration" && x.completed).length;
    const lastCal = calsToday[calsToday.length - 1];
    const top = coach.ranked[0];
    const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    root.innerHTML = `<div class="cal-hub">
        <button class="cal-x" id="hub-exit">✕</button>
        <div class="cal-badge">LUCAS ONLY</div>
        <h1 class="cal-title2">Training</h1>
        <div class="cal-streakline">${s > 0 ? `🔥 ${s}-day streak` : "Start a streak 🔥"}${nCal ? ` · ${nCal} calibrations` : ""}</div>
        <div class="cal-sync top" id="cal-sync">☁️ checking sync…</div>

        <button class="cal-hub-cal" id="hub-cal">
          <div class="chc-k">DAILY CALIBRATION</div>
          <div class="chc-t">${lastCal ? `✓ Done at ${fmtTime(lastCal.startedAt)}${sumAcc(lastCal) != null ? ` · ${pct(sumAcc(lastCal))}` : ""}` : "Today's reading"}</div>
          <div class="chc-s">${lastCal ? `Run it again — extra runs count as practice (run #${calsToday.length + 1}).` : "~7 min · song tags, imagery, naming, holds, chords. Your clean daily data point."}</div>
          <div class="chc-anchor">⚓ Today's note: <b>${PC[dayAnchor]}</b>${anchorMode() === "fixed" ? " (always C)" : " · rotates daily, weakest first"}</div>
          <div class="chc-go">${lastCal ? "↻ Run again" : "▶ Start"}</div>
        </button>

        <div class="cal-sec">Coach</div>
        <div class="cal-coach">
          ${coach.calibrateFirst
            ? `<div class="cc-t">Start with today's calibration</div><div class="cc-r">It's your clean daily reading — then I'll pick drills from what it shows.</div>`
            : `<div class="cc-t">${META[top.skill].icon} ${top.title}</div><div class="cc-r">${top.reason}.</div>
               <button class="cal-cta" data-drill="${top.skill}">▶ Start drill</button>
               <div class="cc-alt">or: ${coach.ranked.slice(1, 3).map((x) => `<a data-drill="${x.skill}">${x.title}</a>`).join(" · ")}</div>`}
        </div>

        <div class="cal-sec">Drills <span>endless · adaptive · ⚓ anchor checks pop up anytime</span></div>
        <div class="hub-cards">${D.DRILLS.map((sk) => drillCard(sk, !coach.calibrateFirst && sk === top.skill ? "suggested" : "", `L${drillLevel(sk, plan, data.sessions)}${recentAcc(sk) != null ? ` · ${pct(recentAcc(sk))}` : ""}`)).join("")}</div>

        <div class="cal-sec">You</div>
        <button class="cal-cta ghost-cta" id="hub-model">📊 Your ear model & data</button>
        <label class="cal-toggle"><input type="checkbox" id="cal-sing" ${singOn() ? "checked" : ""}> 🎤 Sing in “Imagine” (mic measures your inner pitch)</label>
        <label class="cal-toggle"><input type="checkbox" id="cal-fixc" ${anchorMode() === "fixed" ? "checked" : ""}> ⚓ Always use C as the anchor (instead of a daily note)</label>
        <div class="cal-foot">Everything is logged on this device as you go, and synced to your account when you’re signed in. Export from “Your ear model” when you want me to analyze it.</div>
      </div>`;
    $("#hub-exit").onclick = () => { exit(); if (ctx.goHome) ctx.goHome(); };
    $("#hub-cal").onclick = () => startCalibration();
    $("#hub-model").onclick = () => renderInsights();
    root.querySelectorAll("[data-drill]").forEach((b) => (b.onclick = () => startDrill(b.dataset.drill)));
    $("#cal-sing").onchange = (e) => { try { localStorage.setItem("pt.cal.sing", e.target.checked ? "1" : "0"); } catch (_) {} };
    $("#cal-fixc").onchange = (e) => { try { localStorage.setItem("pt.cal.anchorMode", e.target.checked ? "fixed" : "rotate"); } catch (_) {} enter({ skipSync: true }); };
    if (opts.skipSync) renderSync(lastStatus || { configured: true }, false); else backgroundSync();
  }

  // ---- account sync (phone ↔ laptop) --------------------------------------------
  let lastSync = null, lastStatus = null, syncing = false;
  function noteSync(r) { lastSync = { at: Date.now(), ...r }; return r; }
  const agoText = (t) => { const x = Math.round((Date.now() - t) / 1000); return x < 60 ? "just now" : x < 3600 ? `${Math.round(x / 60)}m ago` : `${Math.round(x / 3600)}h ago`; };
  async function backgroundSync() {
    if (syncing) return; syncing = true;
    let st = { configured: false };
    try {
      st = await D.cloudStatus();
      renderSync(st, true);
      if (st.signedIn && st.tableOk) {
        const r = noteSync(await D.syncAll());
        if (r.pulled > 0 && $(".cal-hub")) { syncing = false; return enter({ skipSync: true }); }   // show the other device's runs
      }
    } catch (_) {}
    syncing = false;
    renderSync(st, false);
  }
  function renderSync(st, busy) {
    const el = $("#cal-sync"); if (!el) return;
    lastStatus = st;
    if (!st || !st.configured) { el.hidden = true; return; }
    if (!st.signedIn) {
      el.innerHTML = `☁️ <b>Sync phone ↔ laptop</b><div class="cs-s">Sign in once on each device and every run lives in one place.</div><button class="cal-cta" id="sync-signin">Sign in with Google</button>`;
      $("#sync-signin").onclick = () => signInGoogle(`${location.origin}/?calibrate=1`);
      return;
    }
    const who = st.name || st.email || "you";
    if (!st.tableOk) { el.innerHTML = `☁️ Signed in as <b>${who}</b> — sync isn't available yet: ${st.reason || "unknown error"}. Everything stays safe on this device meanwhile.`; return; }
    if (busy) { el.innerHTML = `☁️ Syncing as <b>${who}</b>…`; return; }
    el.innerHTML = lastSync && !lastSync.ok
      ? `☁️ Sync hiccup — ${lastSync.reason || "try again"}. Your data is safe on this device. <a id="sync-now">Retry</a>`
      : `☁️ Synced as <b>${who}</b>${lastSync ? ` · ${agoText(lastSync.at)}` : ""}${lastSync && (lastSync.pulled || lastSync.pushed) ? ` · ↓${lastSync.pulled} ↑${lastSync.pushed}` : ""} · <a id="sync-now">Sync now</a>`;
    const b = $("#sync-now"); if (b) b.onclick = () => backgroundSync();
  }

  // ===========================================================================
  // INSIGHTS — "your ear model"
  // ===========================================================================
  const pts = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${Math.round(x * 100)} pts`);
  function card(title, value, read, meta = "") {
    return `<div class="cal-ins-card"><div class="cal-ins-t">${title}</div><div class="cal-ins-v">${value}</div><div class="cal-ins-r">${read}</div>${meta ? `<div class="cal-ins-m">${meta}</div>` : ""}</div>`;
  }
  const needs = (have, need, what) => `Needs more data — ${have}/${need} ${what}.`;

  async function renderInsights() {
    clearTimers();
    root.innerHTML = `<div class="cal-stage cal-trans"><div class="cal-big">📊</div><div class="cal-say">reading your data…</div></div>`;
    const data = await D.allData();
    const a = D.analyze(data), next = D.makePlan(data), I = a.indices, dl = drillLevels();
    const days = a.daily.filter((d) => d.cold != null).slice(-14);

    const trend = days.length ? `<div class="cal-trend">${days.map((d) => `<div class="cal-tbar" title="${d.date}: ${pct(d.cold)}${d.calRuns > 1 ? ` (+${d.calRuns - 1} more runs)` : ""}"><div style="height:${Math.round((d.cold || 0) * 100)}%"></div></div>`).join("")}</div>
      <div class="cal-ins-m">First calibration of each day (the cold reading)${a.trend.coldSlopePerDay != null ? ` · ${a.trend.coldSlopePerDay >= 0 ? "+" : ""}${(a.trend.coldSlopePerDay * 100).toFixed(1)} pts/day` : ""}. ${a.nDrills} drill sets logged.</div>` : `<div class="cal-hint">No calibrations yet.</div>`;

    const pcMap = `<div class="cal-pcmap">${a.pcMap.map((p) => {
      const col = p.n >= 3 ? `hsl(${Math.round(p.acc * 120)},70%,${p.acc > 0.5 ? 40 : 50}%)` : "var(--card2)";
      return `<div class="cal-pc" style="background:${col};color:${p.n >= 3 ? "#fff" : "var(--muted)"}"><b>${p.name}</b><span>${p.n >= 3 ? pct(p.acc) : `n=${p.n}`}</span></div>`;
    }).join("")}</div>`;

    const rp = I.rpLeak;
    const rpRead = !rp.enough ? needs(rp.noWash.n + rp.wash.n, 23, "naming trials (with & without the cleanser)")
      : rp.ci.lo > 0.05 ? "You name notes better right after hearing a labeled one → you're partly <b>computing from the last note</b> (relative pitch)."
      : rp.ci.hi < 0.1 && Math.abs(rp.diff) < 0.1 ? "The cleanser makes no difference → you're <b>not leaning on the last note</b>. ✓" : "Inconclusive so far — keep going.";
    const persev = rp.perseveration != null && rp.nWrong >= 6 && rp.perseveration > 0.2 ? ` When wrong, ${pct(rp.perseveration)} of the time you answer the <i>previous</i> note.` : "";
    const an = I.anchor;
    const anRead = an.verdict === "needs-data" ? needs(an.n, 15, "correct naming trials")
      : an.verdict === "counting-from-anchor" ? `~${Math.round(an.msPerSemitone)} ms slower per semitone away from <b>${an.anchorName}</b> (p=${an.p.toFixed(3)}). You seem to <b>find notes by counting from ${an.anchorName}</b>.`
      : "Reaction time doesn't grow with distance from any note — consistent with <b>direct recognition</b>.";
    const gut = I.gut, tb = I.timbre, reg = I.register, ch = I.chroma, hd = I.hold, im = I.imagery, al = I.anchorLock, sh = I.shift, so = I.song, tu = I.tune, ma = I.mentalAnchors, nb = I.neighbors;
    const tbRead = !tb.enough ? needs(tb.sine.n, 8, "pure-tone trials")
      : tb.diff.lo > 0.1 ? "Much better on piano than pure tone → your note memory is partly <b>tied to piano timbre</b>." : "Pure tones about as good as piano → the memory is <b>timbre-general</b>. ✓";
    const holdRead = hd.enoughCost
      ? (hd.toneCost.lo > 0.1 ? "Stray notes during the hold hurt much more than noise → you're holding the <b>sound</b>, not the <b>name</b>." : "Stray notes hurt about as much as noise → you're holding the pitch <b>by name</b>. ✓")
      : needs(Math.min(hd.noise.n, hd.tones.n), 8, "holds of each kind (noise / stray notes)");
    const fa100 = (al.falseAlarmsByCents.find((x) => x.cents === 100) || {}).faRate;
    const ctxBest = (rows) => { const r = rows.filter((x) => x.n >= 8).sort((x, y) => y.acc - x.acc); return r.length >= 2 ? `${r[0].key} (${pct(r[0].acc)}) vs ${r[r.length - 1].key} (${pct(r[r.length - 1].acc)})` : null; };
    const C = a.context, wu = C.warmup;
    const lines = [ctxBest(C.timeOfDay) && `Time of day: ${ctxBest(C.timeOfDay)}`, ctxBest(C.energy) && `Energy: ${ctxBest(C.energy)}`,
      ctxBest(C.runOfDay) && `Run of the day: ${ctxBest(C.runOfDay)}`, ctxBest(C.mode) && `Mode: ${ctxBest(C.mode)}`, ctxBest(C.device) && `Device: ${ctxBest(C.device)}`,
      wu.every((h) => h.n >= 8) ? `Warm-up: first half ${pct(wu[0].acc)} → second half ${pct(wu[1].acc)}` : null].filter(Boolean);
    const chips = (lv) => Object.entries(lv).map(([st, l]) => `<span class="cal-chip">${TITLE[st]} L${l}</span>`).join("");

    root.innerHTML = `<div class="cal-ins">
        <div class="cal-top"><button class="cal-x" id="cal-back">‹</button><div class="cal-ins-h">Your ear model</div><div style="width:2rem"></div></div>
        <div class="cal-ins-sum">${a.nSessions} calibrations · ${a.nDrills} drill sets · ${a.nTrials} trials · 🔥 ${streakFrom(data.sessions)}</div>
        <div class="cal-sec">Daily reading</div>${trend}
        <div class="cal-sec">Pitch map <span>naming accuracy by note</span></div>${pcMap}
        <div class="cal-sec">How you're getting notes <span>mechanism tests</span></div>
        ${card("Relative-pitch leak", rp.enough ? pts(rp.diff) : "—", rpRead + persev, rp.enough ? `no cleanser ${pct(rp.noWash.acc)} (n=${rp.noWash.n}) · cleanser ${pct(rp.wash.acc)} (n=${rp.wash.n})` : "")}
        ${card("Hidden anchor", an.verdict === "counting-from-anchor" ? an.anchorName : an.verdict === "flat" ? "Flat ✓" : "—", anRead, an.n ? `n=${an.n} correct trials` : "")}
        ${card("Gut vs compute", gut.medRtCorrect ? `${(gut.medRtCorrect / 1000).toFixed(1)}s` : "—", gut.n >= 10 ? `Median time on correct answers. ${pct(gut.fastCorrectRate)} are fast (<1.5s) hits — fast + right is what categorical AP looks like.` : needs(gut.n, 10, "naming trials"), gut.medRtWrong ? `wrong answers: ${(gut.medRtWrong / 1000).toFixed(1)}s` : "")}
        ${card("Song anchors", pct(so.acc), so.n >= 8 ? `Tag → note ${pct(so.cueToNote.acc)} · bare note → tag ${pct(so.noteToCue.acc)}. The bare-note direction is the real AP bridge.` : needs(so.n, 8, "song-anchor trials"), so.byPc.filter((x) => x.n >= 2).sort((x, y) => x.acc - y.acc).slice(0, 4).map((x) => `${x.name} ${pct(x.acc)}`).join(" · "))}
        ${card("Hold it", hd.enoughCost ? pts(hd.toneCost.d) : "—", holdRead, `noise ${pct(hd.noise.acc)} (n=${hd.noise.n}) · stray notes ${pct(hd.tones.acc)} (n=${hd.tones.n})${hd.byCents.length ? " · " + hd.byCents.map((x) => `${x.cents}¢ ${pct(x.acc)}`).join(" · ") : ""}`)}
        ${card("In tune?", pct(tu.acc), tu.n >= 8 ? `Spotting a detuned note with no reference — your tuning template. Right-on notes called right ${pct(tu.inTune.acc)}.` : needs(tu.n, 8, "in-tune trials"), tu.byCents.map((x) => `±${x.cents}¢: ${pct(x.acc)}`).join(" · "))}
        ${card("Timbre lock", tb.enough ? pts(tb.diff.d) : "—", tbRead, `piano ${pct(tb.piano.acc)} · sine ${pct(tb.sine.acc)} (n=${tb.sine.n})`)}
        ${card("Register cues", reg.spread != null ? pts(reg.spread) : "—", reg.spread == null ? "Needs ≥5 trials in two octaves." : reg.spread > 0.25 ? "Accuracy swings a lot by octave → you may be using <b>register</b> as a cue." : "Similar across octaves → you're hearing <b>chroma</b>, not height. ✓", reg.byOct.map((r) => `oct ${r.oct}: ${pct(r.acc)}`).join(" · "))}
        ${card("Chroma vs height", pct(ch.acc), ch.n >= 6 ? "Octave twins: spotting the odd note name across octaves." : needs(ch.n, 6, "octave-twins trials"), ch.byOffset.filter((x) => x.n).map((x) => `${x.semis}st: ${pct(x.acc)}`).join(" · "))}
        ${card("Inner pitch", im.nSung ? `${im.meanBiasCents > 0 ? "+" : ""}${Math.round(im.meanBiasCents)}¢` : "—", im.nSung >= 5 ? `Your sung template runs ${Math.abs(im.meanBiasCents) < 15 ? "dead center" : im.meanBiasCents > 0 ? "<b>sharp</b>" : "<b>flat</b>"}; ${pct(im.within50)} within a quarter-tone (avg miss ${Math.round(im.meanAbsCents)}¢).` : `Turn on 🎤 singing to measure your internal template.${im.nSelf ? ` Self-rated "nailed it": ${pct(im.selfNailedRate)}.` : ""}`, im.nSung ? `n=${im.nSung} sung` : "")}
        ${card("Anchor precision", pct(al.hitRate), al.nHits >= 5 ? `Hit rate on the real anchor note.${fa100 != null ? ` Fooled by a semitone neighbor ${pct(fa100)} of the time.` : ""}${al.byAnchor.length > 1 ? ` By note: ${al.byAnchor.map((x) => `${x.name} ${pct(x.acc)}`).join(", ")}.` : ""}` : needs(al.nHits, 5, "anchor trials"), [al.byDelay.filter((x) => x.n).map((x) => `${x.label}: ${pct(x.acc)}`).join(" · "), al.falseAlarmsByCents.filter((x) => x.n).map((x) => `±${x.cents}¢: ${pct(x.faRate)} fooled`).join(" · ")].filter(Boolean).join(" — "))}
        ${card("Mental anchors", ma.best.length ? ma.best[0].name : "—", ma.best.length >= 2 ? `Triangulating from an imagined note works best from <b>${ma.best.map((x) => x.name).join(", ")}</b> and worst from <b>${ma.worst.map((x) => x.name).join(", ")}</b>.` : needs(ma.byAnchor.filter((x) => x.n >= 3).length, 2, "anchors with 3+ Triangulate trials"), ma.byDist.map((x) => `${x.dist}st: ${pct(x.acc)}`).join(" · "))}
        ${card("Neighbors", pct(nb.acc), nb.n >= 8 ? `Telling next-door notes apart with no reference.${nb.pairs.filter((x) => x.n >= 3).length ? ` Muddiest: ${nb.pairs.filter((x) => x.n >= 3).slice(0, 3).map((x) => `${x.pair} ${pct(x.acc)}`).join(", ")}.` : ""}` : needs(nb.n, 8, "Neighbors trials"), `semitone ${pct(nb.semitone.acc)} · whole step ${pct(nb.wholeStep.acc)}`)}
        <div class="cal-sec">Confusions</div>
        ${a.confusions.length ? `<div class="cal-conf">${a.confusions.map((c) => `<div><b>${c.from} → ${c.to}</b> ×${c.n} <span>${c.kind}</span></div>`).join("")}</div>${sh.nWrong >= 6 ? `<div class="cal-ins-m">Errors lean ${sh.meanSignedSemis > 0.3 ? "sharp" : sh.meanSignedSemis < -0.3 ? "flat" : "neither way"} (mean ${sh.meanSignedSemis.toFixed(2)} st).</div>` : ""}` : `<div class="cal-hint">No naming errors logged yet.</div>`}
        <div class="cal-sec">When you're sharpest</div>
        <div class="cal-ins-r">${lines.join("<br>") || "Needs a few more sessions."}</div>
        <div class="cal-sec">Program</div>
        <div class="cal-ins-m" style="margin-bottom:0.4rem">Next calibration${next.focus ? ` · extra reps on <b>${TITLE[next.focus]}</b>` : ""}:</div>
        <div class="cal-chips">${chips(next.levels)}</div>
        <div class="cal-ins-m" style="margin:0.7rem 0 0.4rem">Drill levels (move inside drills + your ⏫/⏬):</div>
        <div class="cal-chips">${chips(Object.fromEntries(D.DRILLS.map((sk) => [sk, drillLevel(sk, next, data.sessions)])))}</div>
        <div class="cal-ins-m">Calibration levels move at most one step per day (≥80% up, ≤50% down); weak notes are oversampled.</div>
        <div class="cal-sec">Your data</div>
        <div class="cal-exp">
          <button class="cal-cta ghost-cta" id="cal-json">⬇ Export JSON</button>
          <button class="cal-cta ghost-cta" id="cal-csv">⬇ Export CSV</button>
          <button class="cal-cta ghost-cta" id="cal-syncnow">☁️ Sync now</button>
        </div>
        <div class="cal-ins-m" id="cal-exp-msg">Everything is saved on this device as you go. Export when you want me to analyze it.</div>
      </div>`;
    $("#cal-back").onclick = () => enter();
    $("#cal-json").onclick = async () => { msg("preparing…"); const b = await D.exportBundle(); await saveFile(`calibration-${D.localDate(Date.now())}.json`, JSON.stringify(b, null, 1), "application/json"); msg(`Exported ${b.trials.length} trials from ${b.sessions.length} sessions${b.pulledFromCloud ? ` (pulled ${b.pulledFromCloud} new from the cloud first)` : ""}.`); };
    $("#cal-csv").onclick = async () => { const b = await D.exportBundle(); await saveFile(`calibration-trials-${D.localDate(Date.now())}.csv`, D.trialsToCSV(b.trials), "text/csv"); msg(`Exported ${b.trials.length} trials as CSV.`); };
    $("#cal-syncnow").onclick = async () => { msg("syncing…"); const r = noteSync(await D.syncAll()); msg(r.ok ? `☁️ Synced — ↓${r.pulled} pulled, ↑${r.pushed} pushed.` : `Sync unavailable — ${r.reason}. (Sign in on the hub first.)`); };
  }
  function msg(t) { const el = $("#cal-exp-msg"); if (el) el.textContent = t; }
  async function saveFile(name, text, type) {
    const blob = new Blob([text], { type });
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    try {
      const file = new File([blob], name, { type });
      if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (_) {}
    const url = URL.createObjectURL(blob), el = document.createElement("a");
    el.href = url; el.download = name; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Leaving Lucas mode: stop audio, save whatever run was in progress.
  function exit() {
    if (run) run.intent = run.intent || "exit";
    abort = true; clearTimers(); stopNoise(); done(null); flushWaits();
    if (run && run.mode === "calibration") endCalibration(false);
    stopMic();
  }

  return { enter, exit };
}
