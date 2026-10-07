// calibrate.js — "Daily Calibration": a private, automated ~6-minute routine
// that primes ABSOLUTE-pitch cognition over relative, and doubles as an
// instrument: every trial is logged (calibrate-data.js), difficulty adapts
// across days, and randomized contrasts inside each session let analyze()
// infer HOW you're getting notes right. Lucas-only, behind 1234.
// Protocol + field reference: CALIBRATION.md.
//
// Why these stations (adult AP-training research):
//  • Note categorization with immediate feedback produces real, months-retained
//    AP gains in some adults; learning tracks auditory working memory and
//    singing accuracy (Van Hedger, Heald & Nusbaum 2019). → Blindfold naming.
//  • Production / imagery (name → hear it inside → sing → verify) builds the
//    internal template, not just recognition. → Imagine it (+ optional mic).
//  • One rock-solid long-term reference bootstraps the rest. → Anchor lock.
//  • Intervening TONES (not noise) disrupt pitch memory (Deutsch), so a quiet
//    atonal "cleanser" before absolute trials wipes the last labeled note and
//    blocks counting from it. In naming it's randomly SKIPPED on ~30% of
//    trials — the accuracy gap is the relative-pitch-leak index.
//  • Working memory predicts AP learnability. → Hold it (through noise).
//  • AP keys on chroma (note name) independent of height. → Octave twins.
//  • ~20% of cleansed naming trials are pure sine — is the skill timbre-bound?
//  • Associative song cues deepen long-term anchors. → Lock-in (PP-MIDI bank).

import { PitchDetector } from "https://esm.sh/pitchy@4";
import * as D from "./calibrate-data.js";
import { calUpload, calDownload } from "./social.js";

export function setupCalibrate(ctx) {
  const { Tone, PITCH_NAMES } = ctx;
  const PC = PITCH_NAMES;
  const root = document.getElementById("calibrate");
  const ANCHOR = 0;                                   // home note: C
  D.setCloud({ upload: calUpload, download: calDownload });

  let abort = false, timers = [], noiseNode = null, _resolve = null, gen = 0;
  let session = null, plan = null, gi = 0, lastLabeled = null;
  let sine = null, mic = null, micCtx = null;
  let tally = {};

  // ---- tiny async framework -------------------------------------------------
  const sleep = (ms) => new Promise((r) => timers.push(setTimeout(r, ms)));
  function later(fn, ms) { const g = gen; const t = setTimeout(() => { if (!abort && g === gen) fn(); }, ms); timers.push(t); return t; }
  function clearTimers() { gen++; timers.forEach(clearTimeout); timers = []; }
  function wait() { return new Promise((res) => { _resolve = res; }); }
  function done(v) { if (_resolve) { const r = _resolve; _resolve = null; r(v); } }
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rand(a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pcOf = (m) => ((m % 12) + 12) % 12;

  // ---- audio ------------------------------------------------------------------
  const midiName = (m) => `${PC[pcOf(m)]}${Math.floor(m / 12) - 1}`;
  const midiOf = (pc, oct) => (oct + 1) * 12 + pc;               // C4 = 60
  async function piano() { await ctx.ensurePiano(); return ctx.getPiano(); }
  async function playMidi(m, dur = 1.4, at = 0, vel = 0.8) {
    const p = await piano(); try { p.triggerAttackRelease(midiName(m), dur, Tone.now() + at, vel); } catch (_) {}
  }
  function ensureSine() {
    if (!sine) {
      sine = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.03, attackCurve: "sine", decay: 0.1, sustain: 0.85, release: 0.35 } }).toDestination();
      sine.volume.value = -6;
    }
    return sine;
  }
  async function playStim(m, timbre, dur = 1.4) {
    if (timbre === "sine") { try { ensureSine().triggerAttackRelease(440 * Math.pow(2, (m - 69) / 12), dur, Tone.now()); } catch (_) {} }
    else await playMidi(m, dur);
  }
  async function playChord(midis, dur = 1.8, vel = 0.65) {
    const p = await piano(); midis.forEach((m) => { try { p.triggerAttackRelease(midiName(m), dur, Tone.now(), vel); } catch (_) {} });
  }
  async function arpeggiate(midis, gap = 0.46) {
    const p = await piano();
    midis.forEach((m, i) => { try { p.triggerAttackRelease(midiName(m), 0.6, Tone.now() + i * gap, 0.8); } catch (_) {} });
    await sleep(midis.length * gap * 1000 + 300);
  }
  // Atonal "palette cleanser": a quiet scatter of random notes across registers
  // that overwrites pitch working memory, so the next judgment can't be made by
  // counting from the last note you were told the name of.
  async function cleanser() {
    const p = await piano(); const now = Tone.now(), N = 9;
    for (let i = 0; i < N; i++) { try { p.triggerAttackRelease(midiName(36 + rand(48)), 0.14, now + i * 0.085, 0.28 + Math.random() * 0.15); } catch (_) {} }
    await sleep(N * 85 + 650);
  }
  function stopNoise() { if (noiseNode) { try { noiseNode.n.stop(); noiseNode.n.dispose(); noiseNode.g.dispose(); } catch (_) {} noiseNode = null; } }
  function noiseBed(ms, db = -26) {       // steady low pink noise for the "hold it" delay
    return new Promise((res) => {
      stopNoise();
      try {
        const g = new Tone.Gain(0).toDestination(), n = new Tone.Noise("pink").connect(g); n.start();
        const now = Tone.now(), end = now + ms / 1000, lvl = Tone.dbToGain(db);
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(lvl, now + 0.08);
        g.gain.setValueAtTime(lvl, Math.max(now + 0.09, end - 0.3)); g.gain.linearRampToValueAtTime(0, end);
        noiseNode = { n, g };
      } catch (_) {}
      later(() => { stopNoise(); res(); }, ms + 80);
    });
  }
  async function cue(pc) { try { const b = ctx.getBank && ctx.getBank(); if (b) b.play(PC[pcOf(pc)], {}); } catch (_) {} }

  // ---- mic (optional sung production in "Imagine it") ----------------------------
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

  // ---- DOM ----------------------------------------------------------------------
  const $ = (s) => root.querySelector(s);
  const TOTAL = 8;
  function stage(html) {
    root.innerHTML = html;
    const x = $("#cal-exit");
    if (x) x.onclick = () => { exit(); if (ctx.goHome) ctx.goHome(); };
  }
  function header(step, title) {
    return `<div class="cal-top">
        <button class="cal-x" id="cal-exit">✕</button>
        <div class="cal-prog"><div class="cal-prog-bar" style="width:${Math.round(((step - 1) / TOTAL) * 100)}%"></div></div>
        <div class="cal-step">${step}/${TOTAL}</div>
      </div>
      <div class="cal-kicker">${title}${plan && plan.focus && FOCUS_OF[title] === plan.focus ? " · today's focus" : ""}</div>`;
  }
  const FOCUS_OF = { "Anchor lock": "anchor", "Hold it": "hold", "Blindfold naming": "name", "Octave twins": "twins", "Find the note": "triad" };
  function setPhase(t) { const el = $("#cal-phase"); if (el) el.textContent = t; }
  function fb(ok, html) { const el = $("#cal-fb"); if (el) { el.innerHTML = html; el.className = "cal-fb " + (ok ? "ok" : "bad"); } }
  // Show a choice group, resolve with its value + reaction time from reveal to tap.
  async function ask(groupSel) {
    const g = $(groupSel); if (!g) return { v: null, rt: null };
    g.hidden = false;
    const shown = performance.now();
    g.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v)));
    const v = await wait();
    return { v, rt: Math.round(performance.now() - shown) };
  }
  function markChoices(groupSel, right, chosen) {
    root.querySelectorAll(`${groupSel} [data-v]`).forEach((b) => {
      b.onclick = null;
      if (b.dataset.v === String(right)) b.classList.add("ok"); else if (b.dataset.v === String(chosen)) b.classList.add("bad");
    });
  }

  // ---- logging ------------------------------------------------------------------
  function record(station, correct) {
    if (typeof correct !== "boolean") return;
    tally[station] = tally[station] || { n: 0, k: 0 };
    tally[station].n++; if (correct) tally[station].k++;
  }
  function logTrial(station, ti, fields) {
    if (!session) return;
    const now = new Date();
    const tr = {
      id: `${session.id}:${gi}`, sessionId: session.id, schema: D.SCHEMA_VERSION, station, ti, gi: gi++,
      t: now.getTime(), hour: now.getHours(), dow: now.getDay(),
      level: plan && plan.levels[station] != null ? plan.levels[station] : null,
      correct: null, rt: null, ...fields,
    };
    D.putTrial(tr).catch(() => {});
  }
  async function beginSession(checkin) {
    const all = await D.allData();
    plan = D.makePlan(all);
    const first = all.sessions.length ? all.sessions[0].startedAt : Date.now();
    tally = {}; gi = 0; lastLabeled = null;
    session = {
      id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, schema: D.SCHEMA_VERSION,
      startedAt: Date.now(), dayIndex: Math.floor((Date.now() - first) / 86400000), sessionNumber: all.sessions.length + 1,
      checkin, plan, completed: false, sing: singOn(), summary: {},
      env: { ua: navigator.userAgent, tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null, standalone: window.matchMedia("(display-mode: standalone)").matches },
    };
    await D.putSession(session);
    D.requestPersist();
  }
  async function endSession(completed) {
    if (!session) return;
    const s = session; session = null;
    s.completed = completed; s.endedAt = Date.now(); s.durSec = Math.round((s.endedAt - s.startedAt) / 1000); s.summary = { ...tally };
    await D.putSession(s).catch(() => {});
    D.syncCloud().catch(() => {});
    return s;
  }

  // ===========================================================================
  // STATIONS
  // ===========================================================================
  async function stAttune(step) {
    clearTimers();
    const t0 = performance.now(); let skipped = false, reps = 0;
    stage(header(step, "Attune") + `
      <div class="cal-stage">
        <div class="cal-big pulse" id="cal-anchor">${PC[ANCHOR]}</div>
        <div class="cal-say">Breathe. Let your home note settle in — hum it quietly.</div>
        <div class="cal-hint">Everything today is measured from here.</div>
        <button class="cal-cta ghost-cta" id="cal-skip">I've got it →</button>
      </div>`);
    $("#cal-skip").onclick = () => { skipped = true; done(); };
    const myGen = gen;
    const beat = async () => {
      if (abort || myGen !== gen) return;
      const el = $("#cal-anchor"); if (el) { el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); }
      await playMidi(midiOf(ANCHOR, 4), 1.6, 0, 0.75);
      if (abort || myGen !== gen) return;
      lastLabeled = midiOf(ANCHOR, 4); reps++;
      if (reps >= 4) later(() => done(), 4200); else later(beat, 6500);
    };
    beat();
    await wait();
    logTrial("attune", 0, { stim: { pc: ANCHOR, reps }, durMs: Math.round(performance.now() - t0), skipped });
  }

  async function stImagine(step) {
    const n = plan.counts.imagine, pcs = D.weightedPick(plan.pcWeights, n), sing = singOn();
    for (let i = 0; i < n && !abort; i++) {
      clearTimers();
      const pc = pcs[i];
      stage(header(step, "Imagine it") + `<div class="cal-stage"><div class="cal-trialcount">${i + 1}/${n}</div><div class="cal-phase">🌀 clearing your ear…</div></div>`);
      await cleanser(); if (abort) return;
      stage(header(step, "Imagine it") + `
        <div class="cal-stage">
          <div class="cal-trialcount">${i + 1}/${n}</div>
          <div class="cal-say">Hear this note ringing in your mind:</div>
          <div class="cal-big">${PC[pc]}</div>
          <div class="cal-count" id="cal-count">${plan.imagineSecs}</div>
          <div class="cal-hint">No sound yet — ${sing ? "get ready to sing it" : "sing it silently"}.</div>
        </div>`);
      await countdown($("#cal-count"), plan.imagineSecs); if (abort) return;
      let sung = null;
      if (sing) {
        stage(header(step, "Imagine it") + `
          <div class="cal-stage">
            <div class="cal-big">🎤</div>
            <div class="cal-say">Sing <b>${PC[pc]}</b> now — hold it steady</div>
            <div class="cal-meter"><div class="cal-meter-bar" id="cal-meter"></div></div>
          </div>`);
        sung = await captureSung(2300, (lvl) => { const b = $("#cal-meter"); if (b) b.style.width = `${Math.round(lvl * 100)}%`; });
        if (abort) return;
        if (sung.ok) {   // signed cents to the nearest octave of the target note
          sung.cents = Math.round(((((sung.midi - pc) % 12) + 18) % 12 - 6) * 100);
          sung.oct = Math.floor(Math.round(sung.midi) / 12) - 1;
        }
      }
      const truth = midiOf(pc, 4);
      await playMidi(truth, 1.8, 0, 0.85); lastLabeled = truth;
      if (sung && sung.ok) {
        const c = sung.cents, correct = Math.abs(c) <= 50;
        record("imagine", correct);
        logTrial("imagine", i, { stim: { pc, secs: plan.imagineSecs }, resp: "sung", correct, sing: sung });
        const how = Math.abs(c) <= 15 ? "dead on 🎯" : `${c > 0 ? "+" : ""}${c}¢ ${c > 0 ? "sharp" : "flat"}`;
        stage(header(step, "Imagine it") + `
          <div class="cal-stage">
            <div class="cal-say">That was</div><div class="cal-big ok-glow">${PC[pc]}</div>
            <div class="cal-fb ${correct ? "ok" : "bad"}">You sang ${how}${Math.abs(c) > 50 ? ` — closer to ${PC[pcOf(Math.round(sung.midi))]}` : ""}</div>
          </div>`);
        await sleep(2700);
      } else {
        stage(header(step, "Imagine it") + `
          <div class="cal-stage">
            <div class="cal-say">That was</div><div class="cal-big ok-glow">${PC[pc]}</div>
            ${sung ? `<div class="cal-hint">(mic didn't catch a clear pitch)</div>` : ""}
            <div class="cal-say">How close were you?</div>
            <div class="cal-choices" id="cal-ch">
              <button class="cal-choice" data-v="nailed">🎯 Nailed it</button>
              <button class="cal-choice" data-v="off">😬 Off</button>
            </div>
          </div>`);
        later(() => done(null), 6000);
        const { v, rt } = await ask("#cal-ch");
        if (abort) return;
        logTrial("imagine", i, { stim: { pc, secs: plan.imagineSecs }, resp: v, rt: v ? rt : null, sing: sung });
      }
    }
  }

  async function stAnchor(step) {
    const n = plan.counts.anchor;
    for (let i = 0; i < n && !abort; i++) {
      clearTimers();
      const isAnchor = Math.random() < 0.5;
      const offset = isAnchor ? 0 : pick(plan.anchorOffsets), oct = pick(plan.anchorOctaves);
      const pc = (ANCHOR + offset) % 12, m = midiOf(pc, oct);
      stage(header(step, "Anchor lock") + `
        <div class="cal-stage">
          <div class="cal-trialcount">${i + 1}/${n}</div>
          <div class="cal-say">Is this your home note — <b>${PC[ANCHOR]}</b>?</div>
          <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
          <div class="cal-choices" id="cal-ch" hidden>
            <button class="cal-choice" data-v="yes">Yes, it's ${PC[ANCHOR]}</button>
            <button class="cal-choice" data-v="no">No</button>
          </div>
          <div class="cal-fb" id="cal-fb"></div>
        </div>`);
      await cleanser(); if (abort) return;       // compare to LONG-TERM C, not the C you just heard
      setPhase("🎧 listen");
      await playMidi(m, 1.5); await sleep(800); if (abort) return;
      setPhase("your call ↓");
      const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return;
      const correct = (v === "yes") === isAnchor;
      record("anchor", correct);
      logTrial("anchor", i, { stim: { pc, isAnchor, offset, oct }, resp: v, correct, rt });
      markChoices("#cal-ch", isAnchor ? "yes" : "no", v);
      fb(correct, correct ? `✅ Right — that was ${midiName(m)}` : `❌ That was ${midiName(m)}. Here's ${PC[ANCHOR]}:`);
      await sleep(500);
      await playMidi(midiOf(ANCHOR, 4), 1.4); lastLabeled = midiOf(ANCHOR, 4);
      await sleep(1200);
    }
  }

  async function stHold(step) {
    const durs = plan.holdDurs;
    for (let i = 0; i < durs.length && !abort; i++) {
      clearTimers();
      const m = midiOf(rand(12), 4), same = Math.random() < 0.5;
      const probeOffset = same ? 0 : (Math.random() < 0.5 ? -1 : 1), probe = m + probeOffset;
      stage(header(step, "Hold it") + `
        <div class="cal-stage">
          <div class="cal-trialcount">${i + 1}/${durs.length} · ${durs[i]}s hold</div>
          <div class="cal-say">Lock onto this note. Keep it alive in your head — don't hum.</div>
          <div class="cal-phase" id="cal-phase">🎧 listen</div>
          <div class="cal-count" id="cal-count"></div>
          <div class="cal-choices" id="cal-ch" hidden>
            <button class="cal-choice" data-v="same">Same</button>
            <button class="cal-choice" data-v="diff">Different</button>
          </div>
          <div class="cal-fb" id="cal-fb"></div>
        </div>`);
      await playMidi(m, 1.3); await sleep(1300); if (abort) return;
      setPhase("🌫️ hold it…");
      countdown($("#cal-count"), durs[i]);
      await noiseBed(durs[i] * 1000); if (abort) return;
      const ce = $("#cal-count"); if (ce) ce.textContent = "";
      setPhase("🎧 probe");
      await playMidi(probe, 1.3); await sleep(1100); if (abort) return;
      setPhase("same note?");
      const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return;
      const correct = (v === "same") === same;
      record("hold", correct);
      logTrial("hold", i, { stim: { pc: pcOf(m), dur: durs[i], same, probeOffset }, resp: v, correct, rt });
      markChoices("#cal-ch", same ? "same" : "diff", v);
      fb(correct, `${correct ? "✅" : "❌"} ${same ? "Same" : "Different"} — ${midiName(m)} → ${midiName(probe)}`);
      lastLabeled = probe;
      await sleep(2200);
    }
  }

  // The diagnostic core. Within the session, cleanser presence and timbre are
  // stratified-randomized so analyze() can separate the mechanisms.
  async function stName(step) {
    const n = plan.counts.name;
    const order = shuffle([...Array(n).keys()]);
    const nNo = Math.max(1, Math.round(n * plan.nameNoWashFrac));
    const noWash = new Set(order.slice(0, nNo));
    const nSine = n >= 5 ? Math.max(1, Math.round(n * plan.nameSineFrac)) : 0;
    const sineSet = new Set(order.slice(nNo, nNo + nSine));       // sine only on cleansed trials
    for (let i = 0; i < n && !abort; i++) {
      clearTimers();
      const wash = !noWash.has(i), timbre = sineSet.has(i) ? "sine" : "piano";
      const oct = pick(plan.nameOctaves), pc = D.weightedPick(plan.pcWeights, 1)[0], m = midiOf(pc, oct);
      const prevMidi = lastLabeled, prevPc = prevMidi == null ? null : pcOf(prevMidi);
      stage(header(step, "Blindfold naming") + `
        <div class="cal-stage">
          <div class="cal-trialcount">${i + 1}/${n}</div>
          <div class="cal-say">Name it — no reference tone.</div>
          <div class="cal-phase" id="cal-phase">${wash ? "🌀 clearing…" : "…"}</div>
          <div class="cal-grid" id="cal-grid" hidden>
            ${PC.map((nm, j) => `<button class="cal-key" data-v="${j}">${nm}</button>`).join("")}
          </div>
          <div class="cal-fb" id="cal-fb"></div>
        </div>`);
      if (wash) await cleanser(); else await sleep(700);
      if (abort) return;
      setPhase(timbre === "sine" ? "🎧 listen (pure tone)" : "🎧 listen");
      await playStim(m, timbre, 1.4); await sleep(900); if (abort) return;
      setPhase("name it ↓");
      const { v, rt } = await ask("#cal-grid"); if (abort || v == null) return;
      const resp = parseInt(v, 10), correct = resp === pc;
      record("name", correct);
      logTrial("name", i, {
        stim: { pc, oct, midi: m, wash, timbre, prevMidi, prevPc, prevInt: prevPc == null ? null : D.circ(prevPc, pc) },
        resp, correct, rt, errSemis: correct ? 0 : D.circ(pc, resp),
      });
      markChoices("#cal-grid", pc, resp);
      fb(correct, correct ? `✅ ${PC[pc]}` : `❌ it was ${PC[pc]}`);
      await sleep(450);
      await playStim(m, timbre, 1.2); lastLabeled = m;     // hear the truth
      await sleep(1300);
    }
  }

  async function stTwins(step) {
    const n = plan.counts.twins;
    for (let i = 0; i < n && !abort; i++) {
      clearTimers();
      const a = rand(12), offset = pick(plan.twinOffsets), b = (a + offset) % 12;
      const octs = shuffle([3, 4, 5]), oddSlot = rand(3);
      const notes = octs.map((o, j) => midiOf(j === oddSlot ? b : a, o));
      let replays = 0;
      stage(header(step, "Octave twins") + `
        <div class="cal-stage">
          <div class="cal-trialcount">${i + 1}/${n}</div>
          <div class="cal-say">Two of these share a note name, in different octaves. Which one is the odd one out?</div>
          <div class="cal-dots">${[0, 1, 2].map((j) => `<span class="cal-dot" data-d="${j}">${j + 1}</span>`).join("")}</div>
          <button class="cal-cta ghost-cta" id="cal-replay">▶ replay</button>
          <div class="cal-choices" id="cal-ch" hidden>${[0, 1, 2].map((j) => `<button class="cal-choice" data-v="${j}">${j + 1}</button>`).join("")}</div>
          <div class="cal-fb" id="cal-fb"></div>
        </div>`);
      const playSeq = async () => {
        for (let j = 0; j < 3 && !abort; j++) {
          root.querySelectorAll(".cal-dot").forEach((d) => d.classList.toggle("on", +d.dataset.d === j));
          await playMidi(notes[j], 0.9); await sleep(900);
        }
        root.querySelectorAll(".cal-dot").forEach((d) => d.classList.remove("on"));
      };
      $("#cal-replay").onclick = () => { replays++; playSeq(); };
      await playSeq(); if (abort) return;
      const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return;
      const resp = parseInt(v, 10), correct = resp === oddSlot;
      record("twins", correct);
      logTrial("twins", i, { stim: { a, b, offset, octs, oddSlot, notes }, resp, correct, rt, replays });
      markChoices("#cal-ch", oddSlot, resp);
      fb(correct, `${correct ? "✅" : "❌"} ${notes.map(midiName).join(" · ")}`);
      lastLabeled = notes[2];
      await sleep(2600);
    }
  }

  async function stTriad(step) {
    const n = plan.counts.triad, q = plan.triad, POS = ["bottom", "middle", "top"];
    const SHAPE = { maj: [4, 7], min: [3, 7], dim: [3, 6], aug: [4, 8] };
    for (let i = 0; i < n && !abort; i++) {
      clearTimers();
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
      stage(header(step, "Find the note") + `
        <div class="cal-stage">
          <div class="cal-trialcount">${i + 1}/${n}</div>
          <div class="cal-say">There's a <b>${PC[targetPc]}</b> in this chord.<br>Bottom, middle, or top?</div>
          <div class="cal-phase" id="cal-phase">🌀 clearing…</div>
          <button class="cal-cta ghost-cta" id="cal-replay">▶ replay chord</button>
          <div class="cal-choices col" id="cal-ch" hidden>${POS.map((p, j) => `<button class="cal-choice" data-v="${j}">${p[0].toUpperCase() + p.slice(1)}</button>`).join("")}</div>
          <div class="cal-fb" id="cal-fb"></div>
        </div>`);
      $("#cal-replay").onclick = () => { replays++; playChord(chord); };
      await cleanser(); if (abort) return;
      setPhase("🎧 listen");
      await playChord(chord); await sleep(1700); if (abort) return;
      setPhase("");
      const { v, rt } = await ask("#cal-ch"); if (abort || v == null) return;
      const resp = parseInt(v, 10), correct = resp === posIdx;
      record("triad", correct);
      logTrial("triad", i, { stim: { rootPc: pcOf(r), quality, inversion, spread, chord, targetPc, posIdx }, resp, correct, rt, replays });
      markChoices("#cal-ch", posIdx, resp);
      fb(correct, `${correct ? "✅" : "❌"} ${PC[targetPc]} was the <b>${POS[posIdx]}</b> note`);
      await sleep(500);
      await arpeggiate(chord); lastLabeled = chord[2];
      await sleep(400);
    }
  }

  // Reinforce the notes you're currently weakest on (plan.pcWeights).
  async function stLockin(step) {
    const n = plan.counts.lockin, pcs = D.weightedPick(plan.pcWeights.map((w) => w * w), n);
    for (let i = 0; i < n && !abort; i++) {
      clearTimers();
      const pc = pcs[i];
      stage(header(step, "Lock it in") + `
        <div class="cal-stage">
          <div class="cal-big ok-glow">${PC[pc]}</div>
          <div class="cal-say" id="cal-say">feel where it sits…</div>
        </div>`);
      await playMidi(midiOf(pc, 4), 1.6, 0, 0.85); lastLabeled = midiOf(pc, 4);
      await sleep(700); if (abort) return;
      const s = $("#cal-say"); if (s) s.textContent = "…and its tag";
      await cue(pc);
      await sleep(2200);
      logTrial("lockin", i, { stim: { pc, weight: Math.round(plan.pcWeights[pc] * 100) / 100 } });
    }
  }

  function countdown(el, secs) {
    return new Promise((res) => {
      let s = secs; if (el) el.textContent = s;
      const tick = () => {
        if (abort) return res();
        s--;
        if (s <= 0) { if (el) el.textContent = "♪"; return res(); }
        if (el) el.textContent = s; later(tick, 1000);
      };
      later(tick, 1000);
    });
  }

  // ===========================================================================
  // FLOW
  // ===========================================================================
  const STATIONS = [stAttune, stImagine, stAnchor, stHold, stName, stTwins, stTriad, stLockin];
  const NAMES = ["Attune", "Imagine it", "Anchor lock", "Hold it", "Blindfold naming", "Octave twins", "Find the note", "Lock it in"];

  function checkin() {
    return new Promise((res) => {
      const ans = { energy: null, music: null, output: null };
      const row = (q, label, opts) => `<div class="cal-ci-row"><div class="cal-ci-l">${label}</div><div class="cal-ci-opts">${opts.map(([v, t]) => `<button class="cal-ci" data-q="${q}" data-val="${v}">${t}</button>`).join("")}</div></div>`;
      stage(`<div class="cal-stage cal-checkin">
          <div class="cal-top"><button class="cal-x" id="cal-exit">✕</button><div class="cal-prog"><div class="cal-prog-bar" style="width:0%"></div></div><div class="cal-step">0/${TOTAL}</div></div>
          <div class="cal-kicker">Quick check-in</div>
          <div class="cal-say">Two taps — it's how we find when your AP is sharpest.</div>
          ${row("energy", "Energy", [["low", "😴 low"], ["ok", "😐 ok"], ["high", "⚡ high"]])}
          ${row("music", "Music heard today", [["none", "none"], ["some", "some"], ["lots", "lots"]])}
          ${row("output", "Listening on", [["headphones", "🎧 headphones"], ["speaker", "🔊 speaker"]])}
          <button class="cal-cta big" id="cal-go">Start →</button>
        </div>`);
      root.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => {
        ans[b.dataset.q] = b.dataset.val;
        root.querySelectorAll(`[data-q="${b.dataset.q}"]`).forEach((x) => x.classList.toggle("sel", x === b));
      }));
      $("#cal-go").onclick = () => res(ans);
    });
  }

  async function begin() {
    const ci = await checkin();
    if (singOn() && !micCtx) { try { micCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }  // inside the tap → not suspended on iOS
    abort = false;
    try { await Tone.start(); } catch (_) {}
    stage(`<div class="cal-stage cal-trans"><div class="cal-big">🎧</div><div class="cal-say">tuning up…</div></div>`);
    try { await ctx.ensurePiano(); } catch (_) {}
    try { await ctx.ensureSampleBank(); } catch (_) {}
    if (singOn()) await ensureMic();
    await beginSession(ci);
    for (let i = 0; i < STATIONS.length && !abort; i++) {
      await STATIONS[i](i + 1);
      if (abort) return;
      if (i < STATIONS.length - 1) await transition(i + 1);
    }
    if (!abort) await finish();
  }

  async function transition(step) {
    clearTimers();
    stage(`<div class="cal-stage cal-trans">
        <div class="cal-prog" style="max-width:220px"><div class="cal-prog-bar" style="width:${Math.round((step / TOTAL) * 100)}%"></div></div>
        <div class="cal-big">✓</div>
        <div class="cal-say">nice — next: <b>${NAMES[step]}</b></div>
      </div>`);
    await sleep(1100);
  }

  // ---- streak -------------------------------------------------------------------
  const dkey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function loadLog() { try { return JSON.parse(localStorage.getItem("pt.cal.log")) || {}; } catch (_) { return {}; } }
  function markToday(acc, n) { const l = loadLog(); l[dkey(new Date())] = { acc, n }; try { localStorage.setItem("pt.cal.log", JSON.stringify(l)); } catch (_) {} }
  function streak() {
    const l = loadLog(), c = new Date();
    if (!l[dkey(c)]) { c.setDate(c.getDate() - 1); if (!l[dkey(c)]) return 0; }
    let n = 0; while (l[dkey(c)]) { n++; c.setDate(c.getDate() - 1); } return n;
  }

  async function finish() {
    clearTimers();
    const before = plan.levels;
    let n = 0, k = 0; Object.values(tally).forEach((r) => { n += r.n; k += r.k; });
    const acc = n ? Math.round((k / n) * 100) : null;
    markToday(acc, n);
    await endSession(true);
    stopMic();
    const after = D.stationLevels((await D.allData()).sessions);
    const LABEL = { imagine: "Imagine it", anchor: "Anchor lock", hold: "Hold it", name: "Blindfold naming", twins: "Octave twins", triad: "Find the note" };
    const moves = Object.keys(after).filter((st) => after[st] !== before[st])
      .map((st) => `<div class="cal-move ${after[st] > before[st] ? "up" : "down"}">${after[st] > before[st] ? "⬆" : "⬇"} ${LABEL[st]} → level ${after[st]}</div>`).join("");
    stage(`<div class="cal-stage cal-finish">
        <div class="cal-big">🎯</div>
        <div class="cal-title2">Calibrated.</div>
        <div class="cal-say">You're in absolute-pitch mode. Carry the anchor with you today.</div>
        <div class="cal-stats">
          <div class="cal-stat"><div class="cal-stat-n">🔥 ${streak()}</div><div class="cal-stat-l">day streak</div></div>
          ${acc != null ? `<div class="cal-stat"><div class="cal-stat-n">${acc}%</div><div class="cal-stat-l">on target</div></div>` : ""}
        </div>
        ${moves ? `<div class="cal-moves"><div class="cal-hint">Tomorrow's program adjusted:</div>${moves}</div>` : ""}
        <button class="cal-cta" id="cal-model">📊 Your ear model</button>
        <button class="cal-cta ghost-cta" id="cal-done">Done</button>
      </div>`);
    $("#cal-model").onclick = () => renderInsights();
    $("#cal-done").onclick = () => { if (ctx.goHome) ctx.goHome(); };
  }

  // ===========================================================================
  // INSIGHTS — "your ear model"
  // ===========================================================================
  const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const pts = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${Math.round(x * 100)} pts`);
  function card(title, value, read, meta = "") {
    return `<div class="cal-ins-card"><div class="cal-ins-t">${title}</div><div class="cal-ins-v">${value}</div><div class="cal-ins-r">${read}</div>${meta ? `<div class="cal-ins-m">${meta}</div>` : ""}</div>`;
  }
  const needs = (have, need, what) => `Needs more data — ${have}/${need} ${what}.`;

  async function renderInsights() {
    clearTimers();
    stage(`<div class="cal-stage cal-trans"><div class="cal-big">📊</div><div class="cal-say">reading your data…</div></div>`);
    const data = await D.allData();
    const a = D.analyze(data), next = D.makePlan(data), I = a.indices;
    const tl = a.timeline.filter((s) => s.n > 0).slice(-14);

    const trend = tl.length ? `<div class="cal-trend">${tl.map((s) => `<div class="cal-tbar" title="${s.date}: ${pct(s.acc)}"><div style="height:${Math.round((s.acc || 0) * 100)}%"></div></div>`).join("")}</div>
      <div class="cal-ins-m">Last ${tl.length} sessions · overall accuracy${a.trend.namingSlopePerSession != null ? ` · naming ${a.trend.namingSlopePerSession >= 0 ? "+" : ""}${(a.trend.namingSlopePerSession * 100).toFixed(1)} pts/session` : ""}</div>` : `<div class="cal-hint">No sessions yet.</div>`;

    const pcMap = `<div class="cal-pcmap">${a.pcMap.map((p) => {
      const col = p.n >= 3 ? `hsl(${Math.round(p.acc * 120)},70%,${p.acc > 0.5 ? 40 : 50}%)` : "var(--card2)";
      return `<div class="cal-pc" style="background:${col};color:${p.n >= 3 ? "#fff" : "var(--muted)"}"><b>${p.name}</b><span>${p.n >= 3 ? pct(p.acc) : `n=${p.n}`}</span></div>`;
    }).join("")}</div>`;

    const rp = I.rpLeak;
    const rpRead = !rp.enough ? needs(rp.noWash.n + rp.wash.n, 23, "naming trials (with & without the cleanser)")
      : rp.ci.lo > 0.05 ? "You name notes better right after hearing a labeled one → you're partly <b>computing from the last note</b> (relative pitch)."
      : rp.ci.hi < 0.1 && Math.abs(rp.diff) < 0.1 ? "The cleanser makes no difference → you're <b>not leaning on the last note</b>. ✓"
      : "Inconclusive so far — keep going.";
    const persev = rp.perseveration != null && rp.nWrong >= 6 && rp.perseveration > 0.2 ? ` When wrong, ${pct(rp.perseveration)} of the time you answer the <i>previous</i> note.` : "";

    const an = I.anchor;
    const anVal = an.verdict === "counting-from-anchor" ? an.anchorName : an.verdict === "flat" ? "Flat ✓" : "—";
    const anRead = an.verdict === "needs-data" ? needs(an.n, 15, "correct naming trials")
      : an.verdict === "counting-from-anchor" ? `~${Math.round(an.msPerSemitone)} ms slower per semitone away from <b>${an.anchorName}</b> (p=${an.p.toFixed(3)}). You seem to <b>find notes by counting from ${an.anchorName}</b>.`
      : "Reaction time doesn't grow with distance from any note — consistent with <b>direct recognition</b>.";

    const gut = I.gut;
    const tb = I.timbre;
    const tbRead = !tb.enough ? needs(tb.sine.n, 8, "pure-tone trials")
      : tb.diff.lo > 0.1 ? "Much better on piano than pure tone → your note memory is partly <b>tied to piano timbre</b>."
      : "Pure tones about as good as piano → the memory is <b>timbre-general</b>. ✓";
    const reg = I.register;
    const ch = I.chroma, hd = I.hold, im = I.imagery, al = I.anchorLock, sh = I.shift;
    const fa1 = (al.falseAlarmsByDist.find((x) => x.semis === 1) || {}).faRate;
    const ctxBest = (rows) => { const r = rows.filter((x) => x.n >= 8).sort((x, y) => y.acc - x.acc); return r.length >= 2 ? `${r[0].key} (${pct(r[0].acc)}) vs ${r[r.length - 1].key} (${pct(r[r.length - 1].acc)})` : null; };
    const tod = ctxBest(a.context.timeOfDay), en = ctxBest(a.context.energy);
    const wu = a.context.warmup;

    const levels = Object.entries(next.levels).map(([st, l]) => `<span class="cal-chip">${({ imagine: "Imagine", anchor: "Anchor", hold: "Hold", name: "Naming", twins: "Twins", triad: "Triads" })[st]} L${l}</span>`).join("");

    stage(`<div class="cal-ins">
        <div class="cal-top"><button class="cal-x" id="cal-back">‹</button><div class="cal-ins-h">Your ear model</div><div style="width:2rem"></div></div>
        <div class="cal-ins-sum">${a.nSessions} sessions · ${a.nTrials} trials · 🔥 ${streak()}</div>
        <div class="cal-sec">Trend</div>${trend}
        <div class="cal-sec">Pitch map <span>naming accuracy by note</span></div>${pcMap}
        <div class="cal-sec">How you're getting notes <span>mechanism tests</span></div>
        ${card("Relative-pitch leak", rp.enough ? pts(rp.diff) : "—", rpRead + persev, rp.enough ? `no cleanser ${pct(rp.noWash.acc)} (n=${rp.noWash.n}) · cleanser ${pct(rp.wash.acc)} (n=${rp.wash.n})` : "")}
        ${card("Hidden anchor", anVal, anRead, an.n ? `n=${an.n} correct trials` : "")}
        ${card("Gut vs compute", gut.medRtCorrect ? `${(gut.medRtCorrect / 1000).toFixed(1)}s` : "—", gut.n >= 10 ? `Median time on correct answers. ${pct(gut.fastCorrectRate)} are fast (<1.5s) hits — fast + right is what categorical AP looks like.` : needs(gut.n, 10, "naming trials"), gut.medRtWrong ? `wrong answers: ${(gut.medRtWrong / 1000).toFixed(1)}s` : "")}
        ${card("Timbre lock", tb.enough ? pts(tb.diff.d) : "—", tbRead, `piano ${pct(tb.piano.acc)} · sine ${pct(tb.sine.acc)} (n=${tb.sine.n})`)}
        ${card("Register cues", reg.spread != null ? pts(reg.spread) : "—", reg.spread == null ? "Needs ≥5 trials in two octaves." : reg.spread > 0.25 ? "Accuracy swings a lot by octave → you may be using <b>register</b> (where it sits in your voice) as a cue." : "Similar across octaves → you're hearing <b>chroma</b>, not height. ✓", reg.byOct.map((r) => `oct ${r.oct}: ${pct(r.acc)}`).join(" · "))}
        ${card("Chroma vs height", pct(ch.acc), ch.n >= 6 ? "Octave twins: spotting the odd note name across octaves." : needs(ch.n, 6, "octave-twins trials"), ch.byOffset.filter((x) => x.n).map((x) => `${x.semis}st: ${pct(x.acc)}`).join(" · "))}
        ${card("Pitch memory", hd.accPerSecond != null && hd.n >= 8 ? `${(hd.accPerSecond * 100).toFixed(1)} pts/s` : "—", hd.n >= 8 ? "How fast a held note decays through noise (closer to 0 = steadier memory)." : needs(hd.n, 8, "hold trials"), hd.byDur.map((x) => `${x.dur}s: ${pct(x.acc)}`).join(" · "))}
        ${card("Inner pitch", im.nSung ? `${im.meanBiasCents > 0 ? "+" : ""}${Math.round(im.meanBiasCents)}¢` : "—", im.nSung >= 5 ? `Your sung template runs ${Math.abs(im.meanBiasCents) < 15 ? "dead center" : im.meanBiasCents > 0 ? "<b>sharp</b>" : "<b>flat</b>"}; ${pct(im.within50)} within a quarter-tone (avg miss ${Math.round(im.meanAbsCents)}¢).` : `Turn on 🎤 singing to measure your internal template.${im.nSelf ? ` Self-rated "nailed it": ${pct(im.selfNailedRate)}.` : ""}`, im.nSung ? `n=${im.nSung} sung` : "")}
        ${card("Anchor precision", pct(al.hitRate), al.nHits >= 5 ? `Hit rate on real ${PC[ANCHOR]}s.${fa1 != null ? ` Fooled by a semitone neighbor ${pct(fa1)} of the time.` : ""}` : needs(al.nHits, 5, "anchor trials"), al.falseAlarmsByDist.filter((x) => x.n).map((x) => `±${x.semis}: ${pct(x.faRate)} FA`).join(" · "))}
        <div class="cal-sec">Confusions</div>
        ${a.confusions.length ? `<div class="cal-conf">${a.confusions.map((c) => `<div><b>${c.from} → ${c.to}</b> ×${c.n} <span>${c.kind}</span></div>`).join("")}</div>${sh.nWrong >= 6 ? `<div class="cal-ins-m">Errors lean ${sh.meanSignedSemis > 0.3 ? "sharp" : sh.meanSignedSemis < -0.3 ? "flat" : "neither way"} (mean ${sh.meanSignedSemis.toFixed(2)} st).</div>` : ""}` : `<div class="cal-hint">No naming errors logged yet.</div>`}
        <div class="cal-sec">When you're sharpest</div>
        <div class="cal-ins-r">${[tod && `Time of day: ${tod}`, en && `Energy: ${en}`, wu.every((h) => h.n >= 8) ? `Warm-up: first half ${pct(wu[0].acc)} → second half ${pct(wu[1].acc)}` : null].filter(Boolean).join("<br>") || "Needs a few more sessions."}</div>
        <div class="cal-sec">Tomorrow's program</div>
        <div class="cal-chips">${levels}</div>
        <div class="cal-ins-m">${next.focus ? `Extra reps on <b>${next.focus}</b> (your weakest lately). ` : ""}Weak notes are oversampled; levels move up after ≥80% and down after ≤50%.</div>
        <div class="cal-sec">Your data</div>
        <div class="cal-exp">
          <button class="cal-cta ghost-cta" id="cal-json">⬇ Export JSON</button>
          <button class="cal-cta ghost-cta" id="cal-csv">⬇ Export CSV</button>
          <button class="cal-cta ghost-cta" id="cal-sync">☁️ Back up</button>
        </div>
        <div class="cal-ins-m" id="cal-exp-msg">Everything is saved on this device as you go. Export when you want me to analyze it.</div>
      </div>`);
    $("#cal-back").onclick = () => enter();
    $("#cal-json").onclick = async () => { msg("preparing…"); const b = await D.exportBundle(); await saveFile(`calibration-${dkey(new Date())}.json`, JSON.stringify(b, null, 1), "application/json"); msg(`Exported ${b.trials.length} trials from ${b.sessions.length} sessions${b.cloudRows ? ` (merged ${b.cloudRows} cloud rows)` : ""}.`); };
    $("#cal-csv").onclick = async () => { const b = await D.exportBundle(); await saveFile(`calibration-trials-${dkey(new Date())}.csv`, D.trialsToCSV(b.trials), "text/csv"); msg(`Exported ${b.trials.length} trials as CSV.`); };
    $("#cal-sync").onclick = async () => { msg("backing up…"); const r = await D.syncCloud(); msg(r.ok ? `☁️ Backed up ${r.n} new rows.` : `Backup unavailable — ${r.reason}. (Sign in + run db/calibration.sql once.)`); };
  }
  function msg(t) { const el = $("#cal-exp-msg"); if (el) el.textContent = t; }
  async function saveFile(name, text, type) {
    const blob = new Blob([text], { type });
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    try {
      const file = new File([blob], name, { type });
      if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (_) {}
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---- home -------------------------------------------------------------------
  async function enter() {
    abort = false; clearTimers();
    const s = streak(), didToday = !!loadLog()[dkey(new Date())];
    let nSess = 0, next = null;
    try { const data = await D.allData(); nSess = data.sessions.filter((x) => x.completed).length; next = D.makePlan(data); } catch (_) {}
    stage(`<div class="cal-home">
        <button class="cal-x" id="cal-exit">✕</button>
        <div class="cal-badge">LUCAS ONLY</div>
        <h1 class="cal-title2">Daily Calibration</h1>
        <p class="cal-blurb">A ~6-minute guided primer that flips your ear into <b>absolute</b>-pitch mode — and quietly runs experiments on <i>how</i> you hear, adapting the program day by day.</p>
        <div class="cal-streakline">${s > 0 ? `🔥 ${s}-day streak${didToday ? " · done today ✓" : ""}` : "Build a daily streak 🔥"}${nSess ? ` · ${nSess} sessions` : ""}</div>
        ${next && next.focus ? `<div class="cal-hint" style="margin-bottom:0.6rem">Today's focus: <b>${next.focus}</b></div>` : ""}
        <button class="cal-cta big" id="cal-begin">${didToday ? "Run it again" : "Begin"} · 🎧 headphones</button>
        <label class="cal-toggle"><input type="checkbox" id="cal-sing" ${singOn() ? "checked" : ""}> 🎤 Sing in “Imagine it” (mic measures your inner pitch)</label>
        <button class="cal-cta ghost-cta" id="cal-model">📊 Your ear model</button>
        <div class="cal-foot">Grounded in adult AP-training research: note categorization with feedback, pitch imagery/production, working memory, and tone-based interference. Every trial is logged on this device.</div>
      </div>`);
    $("#cal-begin").onclick = () => begin();
    $("#cal-model").onclick = () => renderInsights();
    $("#cal-sing").onchange = (e) => { try { localStorage.setItem("pt.cal.sing", e.target.checked ? "1" : "0"); } catch (_) {} };
  }

  function exit() {
    abort = true; clearTimers(); stopNoise(); _resolve = null;
    if (session) endSession(false);     // keep partial sessions — their trials are already saved
    stopMic();
  }

  return { enter, exit };
}
