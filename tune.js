// Tune Learner tab — internalize a jazz standard, spoon-fed one bar at a time.
//
// The app auto-loops each bar a few times, then advances on its own and does
// cumulative reviews at phrase boundaries, so an easily-distracted brain can
// stay locked in without babysitting a loop. You pick the key; it renders on
// piano and/or the PP-MIDI voices. Singing tests make you sing the bass motion
// or melody back from memory.
//
// DATA: chord roots are reliable; melodies are best-effort transcriptions
// (pitches matter, rhythm is approximate) — edit the `mel` arrays to correct.
// Note format: "E4" (sharps only), "r" = rest. `b` = beats (4/4). Roots are
// pitch-class names. `tonicPc` = the pitch class the data is written in.

import { PitchDetector } from "https://esm.sh/pitchy@4";

const LS_KEY = "pt.tune.v2";
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const TUNES = [
  {
    id: "myideal", name: "My Ideal", quality: "major", tonicPc: 0, bpm: 80, bassOct: 2,
    bars: [
      { ch: "Cmaj7",   root: "C",  mel: [["E4",2],["G4",2]] },
      { ch: "Em7 A7",  root: "E",  mel: [["G4",1],["F4",1],["E4",1],["D4",1]] },
      { ch: "Dm7",     root: "D",  mel: [["F4",2],["A4",2]] },
      { ch: "G7",      root: "G",  mel: [["G4",4]] },
      { ch: "Em7",     root: "E",  mel: [["E4",2],["G4",2]] },
      { ch: "A7",      root: "A",  mel: [["C5",2],["B4",2]] },
      { ch: "Dm7 G7",  root: "D",  mel: [["A4",2],["F4",2]] },
      { ch: "Cmaj7",   root: "C",  mel: [["G4",4]] },
    ],
  },
  {
    id: "autumn", name: "Autumn Leaves", quality: "minor", tonicPc: 4, bpm: 100, bassOct: 2,
    bars: [
      { ch: "Am7",    root: "A",  mel: [["E4",1],["F#4",1],["G4",1],["C5",1]] },
      { ch: "D7",     root: "D",  mel: [["B4",2],["A4",2]] },
      { ch: "Gmaj7",  root: "G",  mel: [["D4",1],["E4",1],["F#4",1],["B4",1]] },
      { ch: "Cmaj7",  root: "C",  mel: [["A4",2],["G4",2]] },
      { ch: "F#m7b5", root: "F#", mel: [["A4",1],["B4",1],["C5",1],["F#4",1]] },
      { ch: "B7",     root: "B",  mel: [["D#5",2],["B4",2]] },
      { ch: "Em",     root: "E",  mel: [["E5",2],["B4",2]] },
      { ch: "Em",     root: "E",  mel: [["E4",4]] },
    ],
  },
  {
    id: "bluebossa", name: "Blue Bossa", quality: "minor", tonicPc: 0, bpm: 138, bassOct: 2,
    bars: [
      { ch: "Cm7",    root: "C",  mel: [["G4",1],["C5",1],["D#5",2]] },
      { ch: "Cm7",    root: "C",  mel: [["D5",2],["C5",2]] },
      { ch: "Fm7",    root: "F",  mel: [["F4",1],["G#4",1],["C5",2]] },
      { ch: "Fm7",    root: "F",  mel: [["A#4",2],["G#4",2]] },
      { ch: "Dm7b5",  root: "D",  mel: [["G#4",2],["F4",2]] },
      { ch: "G7",     root: "G",  mel: [["G4",1],["A#4",1],["D5",1],["F5",1]] },
      { ch: "Cm7",    root: "C",  mel: [["D#5",2],["C5",2]] },
      { ch: "Cm7",    root: "C",  mel: [["C5",4]] },
      { ch: "Ebm7",   root: "D#", mel: [["A#4",1],["D#5",1],["F#5",2]] },
      { ch: "Ab7",    root: "G#", mel: [["G#4",1],["C5",1],["D#5",2]] },
      { ch: "Dbmaj7", root: "C#", mel: [["C#5",2],["G#4",2]] },
      { ch: "Dbmaj7", root: "C#", mel: [["C#5",4]] },
      { ch: "Dm7b5",  root: "D",  mel: [["G#4",2],["F4",2]] },
      { ch: "G7",     root: "G",  mel: [["G4",1],["F4",1],["D#4",1],["D4",1]] },
      { ch: "Cm7",    root: "C",  mel: [["D#4",2],["C4",2]] },
      { ch: "G7",     root: "G",  mel: [["G4",4]] },
    ],
  },
  {
    id: "flyme", name: "Fly Me to the Moon", quality: "major", tonicPc: 0, bpm: 120, bassOct: 2,
    bars: [
      { ch: "Am7",    root: "A",  mel: [["C5",1],["B4",1],["A4",1],["G4",1]] },
      { ch: "Dm7",    root: "D",  mel: [["A4",1],["G4",1],["F4",1],["E4",1]] },
      { ch: "G7",     root: "G",  mel: [["D4",1],["E4",1],["F4",1],["G4",1]] },
      { ch: "Cmaj7",  root: "C",  mel: [["C5",4]] },
      { ch: "Fmaj7",  root: "F",  mel: [["A4",1],["G4",1],["F4",1],["E4",1]] },
      { ch: "Bm7b5",  root: "B",  mel: [["D4",1],["E4",1],["F4",1],["F#4",1]] },
      { ch: "E7",     root: "E",  mel: [["E4",2],["r",2]] },
      { ch: "Am7",    root: "A",  mel: [["A4",4]] },
    ],
  },
];

const REPS_PER_BAR = 3;      // auto-loops of a bar before advancing
const REVIEW_EVERY = 4;      // bars between cumulative "everything so far" reviews

// Mic gates for the singing test.
const MIC = { minClarity: 0.9, minRms: 0.015, minFreq: 70, maxFreq: 1000, holdMs: 90 };

export function setupTune(ctx) {
  const { Tone } = ctx;
  const root = document.getElementById("tune");

  let view = "home";
  let tune = null;
  let line = "bass";          // "melody" | "bass"
  let keyPc = 0;              // selected tonic pitch class
  let barIdx = 0;
  let bpm = 120;
  let usePiano = true;
  let usePpmidi = false;
  let ready = false;

  // guided scheduler
  let rep = 0;
  let paused = false;
  let noteTimers = [];
  let masterTimer = null;

  // mic (sing test)
  let mic = null;

  // ---- persistence ----
  function loadStore() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; } }
  function saveTuneCfg() {
    const s = loadStore();
    s[tune.id] = { bpm, keyPc, usePiano, usePpmidi };
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {}
  }

  // ---- music helpers ----
  function transpose() {
    const raw = ((keyPc - tune.tonicPc) % 12 + 12) % 12;
    return raw > 6 ? raw - 12 : raw; // nearest direction
  }
  function spb() { return 60 / bpm; }
  function barSeconds() { return 4 * spb(); }
  function nameToMidi(name) { return Tone.Frequency(name).toMidi(); }
  function pcOf(x) {
    const midi = (/\d/.test(x) ? nameToMidi(x) : nameToMidi(x + "4")) + transpose();
    return ((midi % 12) + 12) % 12;
  }

  function fireNote(name, durSec, vel) {
    if (name === "r") return;
    const midi = nameToMidi(name) + transpose();
    const tname = Tone.Frequency(midi, "midi").toNote();
    const now = Tone.now();
    if (usePiano) {
      const piano = ctx.getPiano();
      if (piano) { try { piano.triggerAttackRelease(tname, durSec * 0.95, now, vel); } catch (_) {} }
    }
    if (usePpmidi) {
      const bank = ctx.getBank();
      if (bank) {
        const pcName = PC[((midi % 12) + 12) % 12];
        const base = bank.baseFreq[pcName];
        const freq = Tone.Frequency(midi, "midi").toFrequency();
        try { bank.play(pcName, { playbackRate: freq / base, volume: -3, stopAfter: Math.max(0.35, durSec) }); } catch (_) {}
      }
    }
  }

  function barEvents(i) {
    const bar = tune.bars[i];
    if (line === "bass") {
      return { evs: [{ name: `${bar.root}${tune.bassOct}`, dur: barSeconds() * 0.98, at: 0, vel: 0.9 }], total: barSeconds() };
    }
    let at = 0; const evs = [];
    bar.mel.forEach(([n, b]) => { const d = b * spb(); evs.push({ name: n, dur: d, at, vel: 0.82 }); at += d; });
    return { evs, total: at };
  }
  function scheduleBarAt(i, atSec) {
    const { evs } = barEvents(i);
    evs.forEach((ev) => {
      const id = setTimeout(() => fireNote(ev.name, ev.dur, ev.vel), (atSec + ev.at) * 1000);
      noteTimers.push(id);
    });
    return barEvents(i).total;
  }
  function clearTimers() {
    noteTimers.forEach(clearTimeout); noteTimers = [];
    if (masterTimer) { clearTimeout(masterTimer); masterTimer = null; }
  }

  // ---- guided auto-progression ----
  function guidedStep() {
    if (paused || !ready) return;
    clearTimers();
    scheduleBarAt(barIdx, 0);
    const period = (barEvents(barIdx).total + spb()) * 1000; // + 1-beat breath
    masterTimer = setTimeout(afterBar, period);
    updateHud();
  }
  function afterBar() {
    rep++;
    if (rep < REPS_PER_BAR) { guidedStep(); return; }
    rep = 0;
    const atEnd = barIdx >= tune.bars.length - 1;
    const reviewPoint = (barIdx + 1) % REVIEW_EVERY === 0 || atEnd;
    if (reviewPoint) {
      doReview(0, barIdx, () => { if (atEnd) return renderDone(); barIdx++; renderSession(); guidedStep(); });
    } else {
      barIdx++; renderSession(); guidedStep();
    }
  }
  function doReview(start, end, cb) {
    clearTimers();
    setHud(`🔁 review — bars ${start + 1}–${end + 1}`);
    let t = 0;
    for (let i = start; i <= end; i++) { scheduleBarAt(i, t); t += barEvents(i).total + 0.05; }
    masterTimer = setTimeout(cb, (t + 0.4) * 1000);
  }
  function pauseGuided() { paused = true; clearTimers(); updateHud(); }
  function resumeGuided() { paused = false; guidedStep(); }

  // ---- rendering ----
  function renderHome() {
    stopAll();
    const cards = TUNES.map((t) => `
      <button class="learn-card" data-tune="${t.id}">
        <div class="learn-card-icon">🎵</div>
        <div class="learn-card-body">
          <div class="learn-card-title">${t.name}</div>
          <div class="learn-card-blurb">${PC[t.tonicPc]} ${t.quality} · ${t.bars.length} bars</div>
        </div>
        <div class="learn-card-chev">›</div>
      </button>`).join("");
    root.innerHTML = `
      <div class="learn-home">
        <h1 class="screen-title">Tune Learner</h1>
        <p class="screen-sub">The app spoon-feeds a standard bar by bar — auto-looping and reviewing so you stay locked in. Then sing it back from memory.</p>
        <div class="learn-cards">${cards}</div>
        <p class="screen-sub" style="margin-top:1rem;font-size:0.8rem">Melodies are approximate transcriptions — tell me which to fix.</p>
      </div>`;
    root.querySelectorAll("[data-tune]").forEach((b) => b.addEventListener("click", () => startSession(b.dataset.tune)));
  }

  function startSession(id) {
    tune = TUNES.find((t) => t.id === id);
    if (!tune) return;
    const cfg = loadStore()[id] || {};
    bpm = cfg.bpm || tune.bpm;
    keyPc = cfg.keyPc ?? tune.tonicPc;
    usePiano = cfg.usePiano ?? true;
    usePpmidi = cfg.usePpmidi ?? false;
    line = Math.random() < 0.5 ? "melody" : "bass";
    barIdx = 0; rep = 0; paused = false;
    view = "session";
    renderSession();
    guidedStep();
  }

  function keyOptions() {
    return PC.map((n, i) => `<option value="${i}" ${i === keyPc ? "selected" : ""}>${n} ${tune.quality === "minor" ? "min" : "maj"}</option>`).join("");
  }

  function renderSession() {
    const bar = tune.bars[barIdx];
    const notes = line === "bass"
      ? PC[pcOf(bar.root)]
      : bar.mel.map(([n]) => (n === "r" ? "·" : PC[pcOf(n)])).join("  ");
    root.innerHTML = `
      <div class="tune-session">
        <div class="setup-top">
          <button class="icon-btn" id="tune-back">‹ Tunes</button>
          <div class="trainer-title">${tune.name}</div>
          <div style="width:60px"></div>
        </div>

        <div class="tune-controls">
          <label class="mini">Key
            <select id="tune-key">${keyOptions()}</select>
          </label>
          <div class="line-toggle">
            <button class="seg ${line === "melody" ? "active" : ""}" data-line="melody">🎼 Melody</button>
            <button class="seg ${line === "bass" ? "active" : ""}" data-line="bass">🎸 Bass</button>
          </div>
        </div>

        <div class="tune-checks">
          <label><input type="checkbox" id="ck-piano" ${usePiano ? "checked" : ""}> Piano</label>
          <label><input type="checkbox" id="ck-ppmidi" ${usePpmidi ? "checked" : ""}> PP-MIDI</label>
        </div>

        <div class="tune-bar-card">
          <div class="tune-bar-num">Bar ${barIdx + 1} / ${tune.bars.length}</div>
          <div class="tune-chord">${bar.ch}</div>
          <div class="tune-notes">${notes}</div>
          <div class="tune-loop" id="tune-hud">🔁 looping…</div>
        </div>

        <div class="tune-tempo">
          <span>Tempo</span>
          <input type="range" id="tune-bpm" min="50" max="220" step="2" value="${bpm}">
          <span id="tune-bpm-val">${bpm} bpm</span>
        </div>

        <button class="primary-btn" id="tune-sing">🎤 Sing test (everything so far)</button>

        <div class="tune-actions">
          <button class="ghost" id="tune-pause">${paused ? "▶ resume" : "⏸ pause"}</button>
          <button class="ghost" id="tune-prev">‹ prev</button>
          <button class="ghost" id="tune-next">next ›</button>
        </div>
      </div>`;

    root.querySelector("#tune-back").addEventListener("click", () => { view = "home"; renderHome(); });
    root.querySelector("#tune-key").addEventListener("change", (e) => { keyPc = +e.target.value; saveTuneCfg(); renderSession(); guidedStep(); });
    root.querySelectorAll("[data-line]").forEach((b) => b.addEventListener("click", () => { line = b.dataset.line; renderSession(); guidedStep(); }));
    root.querySelector("#ck-piano").addEventListener("change", (e) => { usePiano = e.target.checked; saveTuneCfg(); });
    root.querySelector("#ck-ppmidi").addEventListener("change", (e) => { usePpmidi = e.target.checked; saveTuneCfg(); });
    root.querySelector("#tune-sing").addEventListener("click", startSing);
    root.querySelector("#tune-pause").addEventListener("click", () => { paused ? resumeGuided() : pauseGuided(); renderPauseLabel(); });
    root.querySelector("#tune-prev").addEventListener("click", () => { if (barIdx > 0) { barIdx--; rep = 0; renderSession(); guidedStep(); } });
    root.querySelector("#tune-next").addEventListener("click", () => { if (barIdx < tune.bars.length - 1) { barIdx++; rep = 0; renderSession(); guidedStep(); } else renderDone(); });

    const range = root.querySelector("#tune-bpm");
    range.addEventListener("input", () => { bpm = +range.value; root.querySelector("#tune-bpm-val").textContent = `${bpm} bpm`; });
    range.addEventListener("change", () => { saveTuneCfg(); guidedStep(); });
    updateHud();
  }
  function renderPauseLabel() { const b = root.querySelector("#tune-pause"); if (b) b.textContent = paused ? "▶ resume" : "⏸ pause"; }
  function setHud(txt) { const e = root.querySelector("#tune-hud"); if (e) e.textContent = txt; }
  function updateHud() { setHud(paused ? "⏸ paused" : `🔁 rep ${Math.min(rep + 1, REPS_PER_BAR)}/${REPS_PER_BAR}`); }

  function renderDone() {
    stopAll();
    root.innerHTML = `
      <div class="summary">
        <div class="summary-emoji">🎉</div>
        <h1 class="screen-title">${tune.name} — worked through!</h1>
        <p class="screen-sub">You covered all ${tune.bars.length} bars of the ${line} line in ${PC[keyPc]}. Sing the whole thing, or take the other line.</p>
        <button class="primary-btn" id="tune-singall">🎤 Sing the whole tune</button>
        <div class="tune-actions">
          <button class="ghost" id="tune-again">run it again</button>
          <button class="ghost" id="tune-other">try the ${line === "bass" ? "melody" : "bass"}</button>
          <button class="ghost" id="tune-home2">tunes</button>
        </div>
      </div>`;
    root.querySelector("#tune-singall").addEventListener("click", () => { barIdx = tune.bars.length - 1; startSing(); });
    root.querySelector("#tune-again").addEventListener("click", () => { barIdx = 0; rep = 0; renderSession(); guidedStep(); });
    root.querySelector("#tune-other").addEventListener("click", () => { line = line === "bass" ? "melody" : "bass"; barIdx = 0; rep = 0; renderSession(); guidedStep(); });
    root.querySelector("#tune-home2").addEventListener("click", () => { view = "home"; renderHome(); });
  }

  // ---- singing test ----
  function buildSingTarget() {
    const pcs = [];
    for (let i = 0; i <= barIdx; i++) {
      const bar = tune.bars[i];
      if (line === "bass") pcs.push(pcOf(bar.root));
      else bar.mel.forEach(([n]) => { if (n !== "r") pcs.push(pcOf(n)); });
    }
    return pcs;
  }
  async function startSing() {
    pauseGuided();
    const target = buildSingTarget();
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
    } catch (err) {
      setSingStatus("Mic error: " + (err && err.message ? err.message : err), true);
    }
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
    const midi = 12 * Math.log2(freq / 440) + 69;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    setSingLive(PC[pc]);
    if (pc === want && mic.released) {
      if (mic.holdStart === 0) mic.holdStart = now;
      if (now - mic.holdStart >= MIC.holdMs) {
        mic.ptr++; mic.released = false; mic.holdStart = 0;
        markSingProgress();
        if (mic.ptr >= mic.target.length) return singPass();
      }
    } else if (pc !== want) {
      mic.holdStart = 0;
      if (pc !== mic.lastPc) mic.released = true; // moved off → ready for next (handles repeats)
    }
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
        <p class="screen-sub">Sing the ${line === "bass" ? "bass motion" : "melody"} through bar ${barIdx + 1}. Any octave — it checks pitch classes in order.</p>
        <div class="sing-target" id="sing-target">${target.map((pc, i) => `<span class="sng" data-i="${i}">${PC[pc]}</span>`).join("")}</div>
        <div class="tune-bar-card">
          <div class="tune-bar-num">heard</div>
          <div class="tune-chord" id="sing-live">—</div>
          <div class="tune-loop" id="sing-status">listening…</div>
        </div>
        <div class="tune-actions">
          <button class="ghost" id="sing-restart">restart</button>
          <button class="ghost" id="sing-done">back to loop</button>
        </div>
      </div>`;
    root.querySelector("#sing-back").addEventListener("click", exitSing);
    root.querySelector("#sing-done").addEventListener("click", exitSing);
    root.querySelector("#sing-restart").addEventListener("click", () => { if (mic) { mic.ptr = 0; mic.released = true; mic.holdStart = 0; markSingProgress(); setSingStatus("listening…"); } });
  }
  function exitSing() { stopSing(); paused = false; renderSession(); guidedStep(); }
  function markSingProgress() {
    root.querySelectorAll(".sng").forEach((el, i) => el.classList.toggle("hit", i < (mic ? mic.ptr : 0)));
    setSingStatus(`${mic ? mic.ptr : 0} / ${mic ? mic.target.length : 0}`);
  }
  function singPass() {
    stopSing();
    setSingStatus("✅ Nailed it!");
    const live = root.querySelector("#sing-live"); if (live) { live.textContent = "🎉"; }
  }
  function setSingLive(t) { const e = root.querySelector("#sing-live"); if (e) e.textContent = t; }
  function setSingStatus(t, err) { const e = root.querySelector("#sing-status"); if (e) { e.textContent = t; e.style.color = err ? "#f66" : ""; } }

  function stopAll() { clearTimers(); stopSing(); }

  return {
    async enter() {
      view = "home";
      renderHome();
      ctx.setStatus("Loading piano…");
      try {
        await Promise.all([ctx.ensurePiano(), ctx.ensureSampleBank()]);
        ready = true;
        ctx.setStatus("Tune Learner");
      } catch (err) {
        ctx.setStatus(err && err.message ? err.message : String(err), true);
      }
    },
    exit() { stopAll(); },
  };
}
