// Tune Learner tab — internalize a jazz standard one measure at a time.
//
// Pick a tune; the app picks a LINE for the session (melody or the bass line =
// chord roots) and loops the current measure on piano until you tap "Got it",
// then moves to the next measure. The goal is to burn the absolute sound of
// each bar into your head before moving on.
//
// NOTE ON DATA: chord roots are accurate; melodies are best-effort
// transcriptions and are meant to be corrected — edit the `mel` arrays below.
// Note format: "E4" (sharps only), "r" = rest. `b` = beats (4/4 assumed).

const LS_KEY = "pt.tune.v1";

const TUNES = [
  {
    id: "autumn",
    name: "Autumn Leaves",
    key: "E minor",
    bpm: 100,
    bassOct: 2,
    bars: [
      { ch: "Am7",     root: "A",  mel: [["E4",1],["F#4",1],["G4",1],["C5",1]] },
      { ch: "D7",      root: "D",  mel: [["B4",2],["A4",2]] },
      { ch: "Gmaj7",   root: "G",  mel: [["D4",1],["E4",1],["F#4",1],["B4",1]] },
      { ch: "Cmaj7",   root: "C",  mel: [["A4",2],["G4",2]] },
      { ch: "F#m7b5",  root: "F#", mel: [["A4",1],["B4",1],["C5",1],["F#4",1]] },
      { ch: "B7",      root: "B",  mel: [["D#5",2],["B4",2]] },
      { ch: "Em",      root: "E",  mel: [["E5",2],["B4",2]] },
      { ch: "Em",      root: "E",  mel: [["E4",4]] },
    ],
  },
  {
    id: "bluebossa",
    name: "Blue Bossa",
    key: "C minor",
    bpm: 138,
    bassOct: 2,
    bars: [
      { ch: "Cm7",     root: "C",  mel: [["G4",1],["C5",1],["D#5",2]] },
      { ch: "Cm7",     root: "C",  mel: [["D5",2],["C5",2]] },
      { ch: "Fm7",     root: "F",  mel: [["F4",1],["G#4",1],["C5",2]] },
      { ch: "Fm7",     root: "F",  mel: [["A#4",2],["G#4",2]] },
      { ch: "Dm7b5",   root: "D",  mel: [["G#4",2],["F4",2]] },
      { ch: "G7",      root: "G",  mel: [["G4",1],["A#4",1],["D5",1],["F5",1]] },
      { ch: "Cm7",     root: "C",  mel: [["D#5",2],["C5",2]] },
      { ch: "Cm7",     root: "C",  mel: [["C5",4]] },
      { ch: "Ebm7",    root: "D#", mel: [["A#4",1],["D#5",1],["F#5",2]] },
      { ch: "Ab7",     root: "G#", mel: [["G#4",1],["C5",1],["D#5",2]] },
      { ch: "Dbmaj7",  root: "C#", mel: [["C#5",2],["G#4",2]] },
      { ch: "Dbmaj7",  root: "C#", mel: [["C#5",4]] },
      { ch: "Dm7b5",   root: "D",  mel: [["G#4",2],["F4",2]] },
      { ch: "G7",      root: "G",  mel: [["G4",1],["F4",1],["D#4",1],["D4",1]] },
      { ch: "Cm7",     root: "C",  mel: [["D#4",2],["C4",2]] },
      { ch: "G7",      root: "G",  mel: [["G4",4]] },
    ],
  },
  {
    id: "flyme",
    name: "Fly Me to the Moon",
    key: "C major",
    bpm: 120,
    bassOct: 2,
    bars: [
      { ch: "Am7",     root: "A",  mel: [["C5",1],["B4",1],["A4",1],["G4",1]] },
      { ch: "Dm7",     root: "D",  mel: [["A4",1],["G4",1],["F4",1],["E4",1]] },
      { ch: "G7",      root: "G",  mel: [["D4",1],["E4",1],["F4",1],["G4",1]] },
      { ch: "Cmaj7",   root: "C",  mel: [["C5",4]] },
      { ch: "Fmaj7",   root: "F",  mel: [["A4",1],["G4",1],["F4",1],["E4",1]] },
      { ch: "Bm7b5",   root: "B",  mel: [["D4",1],["E4",1],["F4",1],["F#4",1]] },
      { ch: "E7",      root: "E",  mel: [["E4",2],["r",2]] },
      { ch: "Am7",     root: "A",  mel: [["A4",4]] },
    ],
  },
];

export function setupTune(ctx) {
  const { Tone } = ctx;
  const root = document.getElementById("tune");

  let view = "home";       // "home" | "session"
  let tune = null;
  let line = "bass";       // "melody" | "bass"
  let barIdx = 0;
  let bpm = 120;
  let loopTimer = null;
  let ready = false;

  // ---- persistence (remember last tempo per tune, and per-tune progress) ----
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveStore(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {} }

  // ---- audio ----
  function spb() { return 60 / bpm; }
  function barSeconds() { return 4 * spb(); }

  function playBar() {
    const piano = ctx.getPiano();
    if (!piano || !tune) return;
    const bar = tune.bars[barIdx];
    const now = Tone.now() + 0.06;
    if (line === "bass") {
      const dur = barSeconds() * 0.98;
      try { piano.triggerAttackRelease(`${bar.root}${tune.bassOct}`, dur, now, 0.9); } catch (_) {}
    } else {
      let t = now;
      bar.mel.forEach(([n, b]) => {
        const dur = b * spb();
        if (n !== "r") { try { piano.triggerAttackRelease(n, dur * 0.95, t, 0.82); } catch (_) {} }
        t += dur;
      });
    }
  }

  function startLoop() {
    stopLoop();
    if (!ready) return;
    playBar();
    // Loop period = one bar plus a 1-beat breath so reps don't run together.
    const period = (barSeconds() + spb()) * 1000;
    loopTimer = setInterval(playBar, period);
  }
  function stopLoop() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }

  // ---- rendering ----
  function renderHome() {
    stopLoop();
    const cards = TUNES.map((t) => `
      <button class="learn-card" data-tune="${t.id}">
        <div class="learn-card-icon">🎵</div>
        <div class="learn-card-body">
          <div class="learn-card-title">${t.name}</div>
          <div class="learn-card-blurb">${t.key} · ${t.bars.length} bars</div>
        </div>
        <div class="learn-card-chev">›</div>
      </button>`).join("");

    root.innerHTML = `
      <div class="learn-home">
        <h1 class="screen-title">Tune Learner</h1>
        <p class="screen-sub">Loop a standard one bar at a time until the sound sticks, then move on. The app picks melody or bass line for the session.</p>
        <div class="learn-cards">${cards}</div>
        <p class="screen-sub" style="margin-top:1rem;font-size:0.8rem">Melody transcriptions are approximate — tell me which to fix.</p>
      </div>`;

    root.querySelectorAll("[data-tune]").forEach((b) =>
      b.addEventListener("click", () => startSession(b.dataset.tune)));
  }

  function startSession(id) {
    tune = TUNES.find((t) => t.id === id);
    if (!tune) return;
    const store = loadStore();
    bpm = (store[id] && store[id].bpm) || tune.bpm;
    line = Math.random() < 0.5 ? "melody" : "bass"; // app decides for the session
    barIdx = 0;
    view = "session";
    renderSession();
    startLoop();
  }

  function renderSession() {
    const bar = tune.bars[barIdx];
    const notes = line === "bass"
      ? `${bar.root}${tune.bassOct}`
      : bar.mel.map(([n]) => (n === "r" ? "·" : n)).join("  ");

    root.innerHTML = `
      <div class="tune-session">
        <div class="setup-top">
          <button class="icon-btn" id="tune-back">‹ Tunes</button>
          <div class="trainer-title">${tune.name}</div>
          <div style="width:60px"></div>
        </div>

        <div class="line-toggle">
          <button class="seg ${line === "melody" ? "active" : ""}" data-line="melody">🎼 Melody</button>
          <button class="seg ${line === "bass" ? "active" : ""}" data-line="bass">🎸 Bass (roots)</button>
        </div>

        <div class="tune-bar-card">
          <div class="tune-bar-num">Bar ${barIdx + 1} / ${tune.bars.length}</div>
          <div class="tune-chord">${bar.ch}</div>
          <div class="tune-notes">${notes}</div>
          <div class="tune-loop">🔁 looping…</div>
        </div>

        <div class="tune-tempo">
          <span>Tempo</span>
          <input type="range" id="tune-bpm" min="50" max="220" step="2" value="${bpm}">
          <span id="tune-bpm-val">${bpm} bpm</span>
        </div>

        <button class="primary-btn" id="tune-got">Got it — next bar ›</button>

        <div class="tune-actions">
          <button class="ghost" id="tune-prev">‹ prev bar</button>
          <button class="ghost" id="tune-replay">replay ↺</button>
          <button class="ghost" id="tune-whole">play whole tune</button>
        </div>
      </div>`;

    root.querySelector("#tune-back").addEventListener("click", () => { view = "home"; renderHome(); });
    root.querySelectorAll("[data-line]").forEach((b) =>
      b.addEventListener("click", () => { line = b.dataset.line; renderSession(); startLoop(); }));
    root.querySelector("#tune-got").addEventListener("click", nextBar);
    root.querySelector("#tune-prev").addEventListener("click", prevBar);
    root.querySelector("#tune-replay").addEventListener("click", () => { stopLoop(); startLoop(); });
    root.querySelector("#tune-whole").addEventListener("click", playWholeTune);

    const range = root.querySelector("#tune-bpm");
    range.addEventListener("input", () => {
      bpm = +range.value;
      root.querySelector("#tune-bpm-val").textContent = `${bpm} bpm`;
    });
    range.addEventListener("change", () => {
      const store = loadStore();
      store[tune.id] = { bpm };
      saveStore(store);
      startLoop(); // apply new tempo
    });
  }

  function nextBar() {
    if (barIdx >= tune.bars.length - 1) return renderDone();
    barIdx++;
    renderSession();
    startLoop();
  }
  function prevBar() {
    if (barIdx === 0) return;
    barIdx--;
    renderSession();
    startLoop();
  }

  function playWholeTune() {
    stopLoop();
    const piano = ctx.getPiano();
    if (!piano) return;
    let t = Tone.now() + 0.08;
    tune.bars.forEach((bar) => {
      if (line === "bass") {
        piano.triggerAttackRelease(`${bar.root}${tune.bassOct}`, barSeconds() * 0.98, t, 0.9);
      } else {
        let tt = t;
        bar.mel.forEach(([n, b]) => {
          const dur = b * spb();
          if (n !== "r") piano.triggerAttackRelease(n, dur * 0.95, tt, 0.82);
          tt += dur;
        });
      }
      t += barSeconds();
    });
    // Resume the current-bar loop after the run-through finishes.
    setTimeout(startLoop, (barSeconds() * tune.bars.length + 0.3) * 1000);
  }

  function renderDone() {
    stopLoop();
    root.innerHTML = `
      <div class="summary">
        <div class="summary-emoji">🎉</div>
        <h1 class="screen-title">${tune.name} — done!</h1>
        <p class="screen-sub">You worked all ${tune.bars.length} bars of the ${line} line. Run it again or take the other line.</p>
        <button class="primary-btn" id="tune-again">Run it again</button>
        <div class="tune-actions">
          <button class="ghost" id="tune-other">try the ${line === "bass" ? "melody" : "bass"}</button>
          <button class="ghost" id="tune-home2">back to tunes</button>
        </div>
      </div>`;
    root.querySelector("#tune-again").addEventListener("click", () => { barIdx = 0; renderSession(); startLoop(); });
    root.querySelector("#tune-other").addEventListener("click", () => {
      line = line === "bass" ? "melody" : "bass"; barIdx = 0; renderSession(); startLoop();
    });
    root.querySelector("#tune-home2").addEventListener("click", () => { view = "home"; renderHome(); });
  }

  return {
    async enter() {
      view = "home";
      renderHome();
      ctx.setStatus("Loading piano…");
      try {
        await ctx.ensurePiano();
        ready = true;
        ctx.setStatus("Tune Learner");
      } catch (err) {
        ctx.setStatus(err && err.message ? err.message : String(err), true);
      }
    },
    exit() { stopLoop(); },
  };
}
