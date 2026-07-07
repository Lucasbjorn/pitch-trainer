// Tune Learner — an iReal-Pro-style chord chart you internalize bar by bar.
//
// Shows the changes as a measures grid. Plays the BASS LINE (chord roots) —
// which is reliable functional harmony — spoon-fed one bar at a time. You can
// transpose to any key and sing the bass motion back from memory.
//
// Melodies of standards are copyrighted, so none are baked in. To work a
// melody, IMPORT a MIDI file you have — it's parsed in-browser and becomes a
// loopable/singable line. Chord changes below are common versions; edit freely.

import { PitchDetector } from "https://esm.sh/pitchy@4";
import { Midi } from "https://esm.sh/@tonejs/midi";

const LS_KEY = "pt.tune.v3";
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Chord charts: each section is a label + rows of measures. A measure is a
// string; two chords in a bar are space-separated ("Dm7 G7").
const TUNES = [
  {
    id: "myideal", name: "My Ideal", quality: "major", tonicPc: 0, bpm: 84, bassOct: 2,
    sections: [
      { label: "A", bars: ["Cmaj7 A7", "Dm7", "Bb7 A7", "D7"] },
      { label: "B", bars: ["G7 Dm7", "G7 E7", "Am7 D7", "Ab7 G7"] },
      { label: "A", bars: ["Cmaj7 A7", "Dm7", "Bb7 A7", "D7"] },
      { label: "C", bars: ["Dm7", "Fm7 Bb7", "Cmaj7 B7 Bb7", "Am7 D7 G7", "C6"] },
    ],
  },
  {
    id: "autumn", name: "Autumn Leaves", quality: "minor", tonicPc: 7, bpm: 100, bassOct: 2,
    sections: [
      { label: "A", bars: ["Cm7", "F7", "Bbmaj7", "Ebmaj7", "Am7b5", "D7", "Gm7", "Gm7"] },
      { label: "A", bars: ["Cm7", "F7", "Bbmaj7", "Ebmaj7", "Am7b5", "D7", "Gm7", "Gm7"] },
      { label: "B", bars: ["Am7b5", "D7", "Gm7", "Gm7", "Cm7", "F7", "Bbmaj7", "Bbmaj7"] },
      { label: "C", bars: ["Am7b5", "D7", "Gm7 F7", "Bbmaj7 Ebmaj7", "Am7b5", "D7", "Gm7", "Gm7"] },
    ],
  },
  {
    id: "bluebossa", name: "Blue Bossa", quality: "minor", tonicPc: 0, bpm: 138, bassOct: 2,
    sections: [
      { label: "A", bars: ["Cm7", "Cm7", "Fm7", "Fm7", "Dm7b5", "G7", "Cm7", "Cm7"] },
      { label: "B", bars: ["Ebm7", "Ab7", "Dbmaj7", "Dbmaj7", "Dm7b5", "G7", "Cm7", "G7"] },
    ],
  },
  {
    id: "flyme", name: "Fly Me to the Moon", quality: "major", tonicPc: 0, bpm: 120, bassOct: 2,
    sections: [
      { label: "A", bars: ["Am7", "Dm7", "G7", "Cmaj7", "Fmaj7", "Bm7b5", "E7", "Am7"] },
      { label: "B", bars: ["Dm7", "G7", "Cmaj7", "Am7", "Dm7", "G7", "Cmaj7", "Cmaj7"] },
    ],
  },
];

const REPS_PER_BAR = 3;
const REVIEW_EVERY = 4;
const MIC = { minClarity: 0.9, minRms: 0.015, minFreq: 70, maxFreq: 1000, holdMs: 90 };

export function setupTune(ctx) {
  const { Tone } = ctx;
  const root = document.getElementById("tune");
  const imported = []; // user-imported MIDI tunes (this session)

  let view = "home";
  let tune = null;
  let flat = [];            // flattened bars for the current tune
  let line = "bass";        // "bass" | "melody"
  let keyPc = 0;
  let barIdx = 0;
  let bpm = 120;
  let usePiano = true;
  let usePpmidi = false;
  let ready = false;

  let rep = 0, paused = false, noteTimers = [], masterTimer = null;
  let loopMode = "feed";    // "feed" | "bar" | "section" | "all"
  let mic = null;

  // ---- persistence ----
  function loadStore() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; } }
  function saveCfg() {
    const s = loadStore();
    s[tune.id] = { bpm, keyPc, usePiano, usePpmidi };
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {}
  }

  // ---- chord helpers ----
  function rootPcOf(ch) {
    const m = ch.match(/^([A-G])([#b]?)/);
    if (!m) return 0;
    let pc = LETTER_PC[m[1]];
    if (m[2] === "#") pc++; if (m[2] === "b") pc--;
    return ((pc % 12) + 12) % 12;
  }
  function transpose() {
    const raw = ((keyPc - tune.tonicPc) % 12 + 12) % 12;
    return raw > 6 ? raw - 12 : raw;
  }
  function transposeChord(ch, semis) {
    return ch.split(/\s+/).map((tok) =>
      tok.split("/").map((part) => {
        const m = part.match(/^([A-G][#b]?)(.*)$/);
        if (!m) return part;
        const pc = ((rootPcOf(part) + semis) % 12 + 12) % 12;
        return FLAT[pc] + m[2];
      }).join("/")
    ).join(" ");
  }

  function spb() { return 60 / bpm; }
  function barSeconds() { return 4 * spb(); }

  // ---- playback ----
  function fireNote(name, durSec, vel) {
    const now = Tone.now();
    if (usePiano) {
      const piano = ctx.getPiano();
      if (piano) { try { piano.triggerAttackRelease(name, durSec * 0.95, now, vel); } catch (_) {} }
    }
    if (usePpmidi) {
      const bank = ctx.getBank();
      if (bank) {
        // OG one-octave sample for the pitch class — no pitch-shifting.
        const midi = Tone.Frequency(name).toMidi();
        const pcName = PC[((midi % 12) + 12) % 12];
        try { bank.play(pcName, { volume: -3, stopAfter: Math.max(0.35, durSec) }); } catch (_) {}
      }
    }
  }
  function barEvents(i) {
    const bar = flat[i];
    if (line === "melody" && bar.mel) {
      let at = 0; const evs = [];
      bar.mel.forEach(([n, b]) => { const d = b * spb(); if (n !== "r") evs.push({ name: n, dur: d, at }); at += d; });
      return { evs, total: Math.max(at, barSeconds()) };
    }
    // bass: play each chord's root in its slice of the bar
    const chords = (bar.ch || "").trim().split(/\s+/).filter(Boolean);
    const slot = barSeconds() / Math.max(1, chords.length);
    const evs = chords.map((ch, ci) => {
      const pc = ((rootPcOf(ch) + transpose()) % 12 + 12) % 12;
      return { name: FLAT[pc] + tune.bassOct, dur: slot * 0.98, at: ci * slot, vel: 0.9 };
    });
    return { evs, total: barSeconds() };
  }
  function scheduleBar(i, atSec) {
    barEvents(i).evs.forEach((ev) => {
      noteTimers.push(setTimeout(() => fireNote(ev.name, ev.dur, ev.vel ?? 0.82), (atSec + ev.at) * 1000));
    });
    return barEvents(i).total;
  }
  function clearTimers() { noteTimers.forEach(clearTimeout); noteTimers = []; if (masterTimer) { clearTimeout(masterTimer); masterTimer = null; } }

  // ---- guided auto-progression ----
  function guidedStep() {
    if (paused || !ready) return;
    clearTimers();
    scheduleBar(barIdx, 0);
    masterTimer = setTimeout(afterBar, (barEvents(barIdx).total + spb()) * 1000);
    highlightBar();
    updateHud();
  }
  function sectionBars(i) { return flat.map((b, k) => (b.sec === flat[i].sec ? k : -1)).filter((k) => k >= 0); }
  function afterBar() {
    if (loopMode === "bar") { guidedStep(); return; }        // ∞ this bar
    if (loopMode === "section") {
      const sb = sectionBars(barIdx); const pos = sb.indexOf(barIdx);
      barIdx = sb[(pos + 1) % sb.length]; guidedStep(); return; // ∞ this section
    }
    if (loopMode === "all") { barIdx = (barIdx + 1) % flat.length; guidedStep(); return; } // ∞ whole tune
    // "feed": loop each bar N times, review at phrase ends, then advance.
    rep++;
    if (rep < REPS_PER_BAR) { guidedStep(); return; }
    rep = 0;
    const atEnd = barIdx >= flat.length - 1;
    if ((barIdx + 1) % REVIEW_EVERY === 0 || atEnd) {
      doReview(0, barIdx, () => { if (atEnd) return renderDone(); barIdx++; guidedStep(); });
    } else { barIdx++; guidedStep(); }
  }
  function doReview(start, end, cb) {
    clearTimers();
    setHud(`🔁 review — bars ${start + 1}–${end + 1}`);
    let t = 0;
    for (let i = start; i <= end; i++) { scheduleBar(i, t); t += barEvents(i).total + 0.05; }
    masterTimer = setTimeout(cb, (t + 0.4) * 1000);
  }
  function pauseGuided() { paused = true; clearTimers(); }
  function resumeGuided() { paused = false; guidedStep(); }

  // ---- rendering ----
  function allTunes() { return [...imported, ...TUNES]; }
  function renderHome() {
    stopAll();
    const cards = allTunes().map((t) => `
      <button class="learn-card" data-tune="${t.id}">
        <div class="learn-card-icon">${t.imported ? "📥" : "🎵"}</div>
        <div class="learn-card-body">
          <div class="learn-card-title">${t.name}</div>
          <div class="learn-card-blurb">${PC[t.tonicPc]} ${t.quality} · ${t.sections.reduce((a, s) => a + s.bars.length, 0)} bars${t.imported ? " · imported" : ""}</div>
        </div>
        <div class="learn-card-chev">›</div>
      </button>`).join("");
    root.innerHTML = `
      <div class="learn-home">
        <h1 class="screen-title">Tune Learner</h1>
        <p class="screen-sub">Read the chart, then let it spoon-feed the bass motion bar by bar and sing it back. Import a MIDI to work a melody.</p>
        <label class="primary-btn" style="display:block;text-align:center;cursor:pointer">
          📥 Import a MIDI file<input type="file" id="tune-file" accept=".mid,.midi" hidden>
        </label>
        <div class="learn-cards">${cards}</div>
        <p class="screen-sub" style="margin-top:1rem;font-size:0.8rem">Changes are common versions — edit them, and correct any you know.</p>
      </div>`;
    root.querySelectorAll("[data-tune]").forEach((b) => b.addEventListener("click", () => startSession(b.dataset.tune)));
    root.querySelector("#tune-file").addEventListener("change", onImport);
  }

  function startSession(id) {
    tune = allTunes().find((t) => t.id === id);
    if (!tune) return;
    flat = [];
    tune.sections.forEach((s, si) => s.bars.forEach((b, bi) =>
      flat.push(typeof b === "string" ? { ch: b, sec: si, first: bi === 0, label: s.label } : { ...b, sec: si, first: bi === 0, label: s.label })));
    const cfg = loadStore()[id] || {};
    bpm = cfg.bpm || tune.bpm;
    keyPc = cfg.keyPc ?? tune.tonicPc;
    usePiano = cfg.usePiano ?? true;
    usePpmidi = cfg.usePpmidi ?? false;
    line = tune.hasMelody ? "melody" : "bass";
    barIdx = 0; rep = 0; paused = false;
    view = "session";
    renderSession();
    guidedStep();
  }

  function keyOptions() {
    return PC.map((n, i) => `<option value="${i}" ${i === keyPc ? "selected" : ""}>${n} ${tune.quality === "minor" ? "min" : "maj"}</option>`).join("");
  }
  function chartHtml() {
    let idx = 0;
    return tune.sections.map((s) => {
      const cells = s.bars.map((b) => {
        const i = idx++;
        const chRaw = typeof b === "string" ? b : (b.ch || "·");
        const txt = tune.imported ? `${i + 1}` : transposeChord(chRaw, transpose());
        return `<div class="chart-cell ${i === barIdx ? "cur" : ""}" data-bar="${i}">${txt}</div>`;
      }).join("");
      return `<div class="chart-sec"><div class="chart-label">${s.label}</div><div class="chart-grid">${cells}</div></div>`;
    }).join("");
  }
  function renderSession() {
    root.innerHTML = `
      <div class="tune-session">
        <div class="setup-top">
          <button class="icon-btn" id="tune-back">‹ Tunes</button>
          <div class="trainer-title">${tune.name}</div>
          <div style="width:60px"></div>
        </div>
        <div class="tune-controls">
          <label class="mini">Key <select id="tune-key">${keyOptions()}</select></label>
          ${tune.hasMelody ? `<div class="line-toggle">
            <button class="seg ${line === "melody" ? "active" : ""}" data-line="melody">🎼 Melody</button>
            <button class="seg ${line === "bass" ? "active" : ""}" data-line="bass">🎸 Bass</button>
          </div>` : `<span class="mini" style="color:var(--muted)">🎸 Bass line</span>`}
        </div>
        <div class="tune-checks">
          <label><input type="checkbox" id="ck-piano" ${usePiano ? "checked" : ""}> Piano</label>
          <label><input type="checkbox" id="ck-ppmidi" ${usePpmidi ? "checked" : ""}> PP-MIDI</label>
          <label class="mini">Loop
            <select id="tune-loopmode">
              <option value="feed"    ${loopMode === "feed" ? "selected" : ""}>spoon-feed</option>
              <option value="bar"     ${loopMode === "bar" ? "selected" : ""}>this bar ∞</option>
              <option value="section" ${loopMode === "section" ? "selected" : ""}>this section ∞</option>
              <option value="all"     ${loopMode === "all" ? "selected" : ""}>whole tune ∞</option>
            </select>
          </label>
        </div>
        <div class="chart" id="tune-chart">${chartHtml()}</div>
        <div class="tune-hud" id="tune-hud">🔁 looping bar ${barIdx + 1}…</div>
        <div class="tune-tempo">
          <span>Tempo</span>
          <input type="range" id="tune-bpm" min="50" max="240" step="2" value="${bpm}">
          <span id="tune-bpm-val">${bpm} bpm</span>
        </div>
        <button class="primary-btn" id="tune-sing">🎤 Sing test (through bar ${barIdx + 1})</button>
        <div class="tune-actions">
          <button class="ghost" id="tune-pause">${paused ? "▶ resume" : "⏸ pause"}</button>
          <button class="ghost" id="tune-prev">‹ prev</button>
          <button class="ghost" id="tune-next">next ›</button>
        </div>
      </div>`;
    root.querySelector("#tune-back").addEventListener("click", () => { stopAll(); view = "home"; renderHome(); });
    root.querySelector("#tune-key").addEventListener("change", (e) => { keyPc = +e.target.value; saveCfg(); renderSession(); guidedStep(); });
    root.querySelectorAll("[data-line]").forEach((b) => b.addEventListener("click", () => { line = b.dataset.line; renderSession(); guidedStep(); }));
    root.querySelector("#ck-piano").addEventListener("change", (e) => { usePiano = e.target.checked; saveCfg(); });
    root.querySelector("#ck-ppmidi").addEventListener("change", (e) => { usePpmidi = e.target.checked; saveCfg(); });
    root.querySelector("#tune-loopmode").addEventListener("change", (e) => { loopMode = e.target.value; rep = 0; guidedStep(); });
    root.querySelectorAll("[data-bar]").forEach((c) => c.addEventListener("click", () => { barIdx = +c.dataset.bar; rep = 0; renderSession(); guidedStep(); }));
    root.querySelector("#tune-sing").addEventListener("click", startSing);
    root.querySelector("#tune-pause").addEventListener("click", () => { paused ? resumeGuided() : pauseGuided(); const b = root.querySelector("#tune-pause"); if (b) b.textContent = paused ? "▶ resume" : "⏸ pause"; });
    root.querySelector("#tune-prev").addEventListener("click", () => { if (barIdx > 0) { barIdx--; rep = 0; renderSession(); guidedStep(); } });
    root.querySelector("#tune-next").addEventListener("click", () => { if (barIdx < flat.length - 1) { barIdx++; rep = 0; renderSession(); guidedStep(); } else renderDone(); });
    const range = root.querySelector("#tune-bpm");
    range.addEventListener("input", () => { bpm = +range.value; root.querySelector("#tune-bpm-val").textContent = `${bpm} bpm`; });
    range.addEventListener("change", () => { saveCfg(); guidedStep(); });
  }
  function highlightBar() {
    root.querySelectorAll(".chart-cell").forEach((c) => c.classList.toggle("cur", +c.dataset.bar === barIdx));
    const sing = root.querySelector("#tune-sing"); if (sing) sing.textContent = `🎤 Sing test (through bar ${barIdx + 1})`;
  }
  function setHud(t) { const e = root.querySelector("#tune-hud"); if (e) e.textContent = t; }
  function updateHud() { setHud(paused ? "⏸ paused" : `🔁 bar ${barIdx + 1} — rep ${Math.min(rep + 1, REPS_PER_BAR)}/${REPS_PER_BAR}`); }

  function renderDone() {
    stopAll();
    root.innerHTML = `
      <div class="summary">
        <div class="summary-emoji">🎉</div>
        <h1 class="screen-title">${tune.name} — worked through!</h1>
        <p class="screen-sub">All ${flat.length} bars of the ${line} in ${PC[keyPc]}.</p>
        <button class="primary-btn" id="tune-singall">🎤 Sing the whole thing</button>
        <div class="tune-actions">
          <button class="ghost" id="tune-again">run it again</button>
          <button class="ghost" id="tune-home2">tunes</button>
        </div>
      </div>`;
    root.querySelector("#tune-singall").addEventListener("click", () => { barIdx = flat.length - 1; startSing(); });
    root.querySelector("#tune-again").addEventListener("click", () => { barIdx = 0; rep = 0; renderSession(); guidedStep(); });
    root.querySelector("#tune-home2").addEventListener("click", () => { view = "home"; renderHome(); });
  }

  // ---- MIDI import ----
  async function onImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const midi = new Midi(buf);
      const track = midi.tracks.reduce((a, b) => (b.notes.length > (a ? a.notes.length : -1) ? b : a), null);
      const notes = track ? track.notes : [];
      if (!notes.length) throw new Error("No notes found in that MIDI.");
      const detBpm = Math.round((midi.header.tempos[0] && midi.header.tempos[0].bpm) || 120);
      const secPerBar = 4 * (60 / detBpm);
      const nBars = Math.max(1, Math.ceil(midi.durationTicks ? midi.duration / secPerBar : notes[notes.length - 1].time / secPerBar + 1));
      const bars = Array.from({ length: nBars }, () => []);
      notes.forEach((n) => {
        const bi = Math.min(nBars - 1, Math.floor(n.time / secPerBar));
        const beats = Math.max(0.25, Math.round((n.duration / (60 / detBpm)) * 2) / 2);
        bars[bi].push([n.name, beats]);
      });
      const t = {
        id: "imp" + imported.length, name: file.name.replace(/\.midi?$/i, ""), imported: true, hasMelody: true,
        quality: "major", tonicPc: 0, bpm: detBpm, bassOct: 2,
        sections: [{ label: "Imported", bars: bars.map((mel) => ({ ch: "", mel: mel.length ? mel : [["r", 4]] })) }],
      };
      imported.unshift(t);
      startSession(t.id);
    } catch (err) {
      ctx.setStatus("MIDI import failed: " + (err && err.message ? err.message : err), true);
    }
  }

  // ---- singing test ----
  function singTarget() {
    const pcs = [];
    for (let i = 0; i <= barIdx; i++) {
      const bar = flat[i];
      if (line === "melody" && bar.mel) {
        bar.mel.forEach(([n]) => { if (n !== "r") pcs.push(((Tone.Frequency(n).toMidi() + transpose()) % 12 + 12) % 12); });
      } else {
        (bar.ch || "").trim().split(/\s+/).filter(Boolean).forEach((ch) => pcs.push(((rootPcOf(ch) + transpose()) % 12 + 12) % 12));
      }
    }
    return pcs;
  }
  async function startSing() {
    pauseGuided();
    const target = singTarget();
    renderSing(target);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const detector = PitchDetector.forFloat32Array(analyser.fftSize);
      mic = { stream, ac, analyser, buf, detector, raf: null, ptr: 0, target, holdStart: 0, released: true, lastPc: -1 };
      loopSing();
    } catch (err) { setSingStatus("Mic error: " + (err && err.message ? err.message : err), true); }
  }
  function loopSing() {
    if (!mic) return;
    mic.raf = requestAnimationFrame(loopSing);
    mic.analyser.getFloatTimeDomainData(mic.buf);
    let sq = 0; for (let i = 0; i < mic.buf.length; i++) sq += mic.buf[i] * mic.buf[i];
    const rms = Math.sqrt(sq / mic.buf.length);
    const [freq, clarity] = mic.detector.findPitch(mic.buf, mic.ac.sampleRate);
    const valid = rms >= MIC.minRms && clarity >= MIC.minClarity && freq >= MIC.minFreq && freq <= MIC.maxFreq;
    const now = performance.now();
    const want = mic.target[mic.ptr];
    if (!valid) { mic.released = true; mic.holdStart = 0; setSingLive("—"); return; }
    const pc = ((Math.round(12 * Math.log2(freq / 440) + 69) % 12) + 12) % 12;
    setSingLive(PC[pc]);
    if (pc === want && mic.released) {
      if (mic.holdStart === 0) mic.holdStart = now;
      if (now - mic.holdStart >= MIC.holdMs) {
        mic.ptr++; mic.released = false; mic.holdStart = 0; markSing();
        if (mic.ptr >= mic.target.length) return singPass();
      }
    } else if (pc !== want) { mic.holdStart = 0; if (pc !== mic.lastPc) mic.released = true; }
    mic.lastPc = pc;
  }
  function stopSing() {
    if (!mic) return;
    if (mic.raf) cancelAnimationFrame(mic.raf);
    try { mic.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { mic.ac.close(); } catch (_) {}
    mic = null;
  }
  function renderSing(target) {
    root.innerHTML = `
      <div class="tune-session">
        <div class="setup-top">
          <button class="icon-btn" id="sing-back">‹ Back</button>
          <div class="trainer-title">Sing the ${line}</div>
          <div style="width:60px"></div>
        </div>
        <p class="screen-sub">Sing the ${line === "bass" ? "bass motion" : "melody"} through bar ${barIdx + 1} in ${PC[keyPc]}. Any octave.</p>
        <div class="sing-target" id="sing-target">${target.map((pc, i) => `<span class="sng" data-i="${i}">${PC[pc]}</span>`).join("")}</div>
        <div class="tune-bar-card"><div class="tune-bar-num">heard</div><div class="tune-chord" id="sing-live">—</div><div class="tune-loop" id="sing-status">listening…</div></div>
        <div class="tune-actions">
          <button class="ghost" id="sing-restart">restart</button>
          <button class="ghost" id="sing-done">back to chart</button>
        </div>
      </div>`;
    root.querySelector("#sing-back").addEventListener("click", exitSing);
    root.querySelector("#sing-done").addEventListener("click", exitSing);
    root.querySelector("#sing-restart").addEventListener("click", () => { if (mic) { mic.ptr = 0; mic.released = true; mic.holdStart = 0; markSing(); setSingStatus("listening…"); } });
  }
  function exitSing() { stopSing(); paused = false; renderSession(); guidedStep(); }
  function markSing() {
    root.querySelectorAll(".sng").forEach((el, i) => el.classList.toggle("hit", i < (mic ? mic.ptr : 0)));
    setSingStatus(`${mic ? mic.ptr : 0} / ${mic ? mic.target.length : 0}`);
  }
  function singPass() { stopSing(); setSingStatus("✅ Nailed it!"); const l = root.querySelector("#sing-live"); if (l) l.textContent = "🎉"; }
  function setSingLive(t) { const e = root.querySelector("#sing-live"); if (e) e.textContent = t; }
  function setSingStatus(t, err) { const e = root.querySelector("#sing-status"); if (e) { e.textContent = t; e.style.color = err ? "#f66" : ""; } }

  function stopAll() { clearTimers(); stopSing(); }

  return {
    async enter() {
      view = "home"; renderHome();
      ctx.setStatus("Loading piano…");
      try { await Promise.all([ctx.ensurePiano(), ctx.ensureSampleBank()]); ready = true; ctx.setStatus("Tune Learner"); }
      catch (err) { ctx.setStatus(err && err.message ? err.message : String(err), true); }
    },
    exit() { stopAll(); },
  };
}
