// Practice Routine tab — a guided practice session builder + habit tracker.
//
// Flow: Home (streak + faction balance) → Setup (time + skills) → Runner
// (timed segments with built-in "analyze, don't play" micro-breaks) → Summary.
//
// The session divides your available time across the skills you pick. Every
// ~10 min of playing it inserts a 1-min analysis break (a memory-consolidation
// trick — you stop playing and just think about what you played). A 1-min
// break also sits between tasks. Completed minutes are tallied per "faction"
// (visual / physical / auditory) and stored so the app can flag a discipline
// you're neglecting.
//
// Renders entirely into #practice. State persists in localStorage.

const LS_KEY = "pt.practice.v1";

const SKILLS = [
  { key: "sightreading", name: "Sight reading",   faction: "visual",   icon: "👁️", guidable: true,
    guideNote: "Read the line below at a steady tempo — eyes ahead, don't stop." },
  { key: "transcribing", name: "Transcribing",    faction: "auditory", icon: "👂", guidable: true,
    guideNote: "Play the phrase, then find every note by ear. Replay as needed." },
  { key: "tune",         name: "Learning a tune", faction: "physical", icon: "🎵", guidable: true,
    guideNote: "Work this tune. Melody, then changes, then from memory." },
  { key: "drills",       name: "Drills (all keys)",faction: "physical", icon: "💪", guidable: true,
    guideNote: "Run this drill slowly, both hands, metronome on." },
  { key: "voicings",     name: "Voicings book",   faction: "visual",   icon: "📖", guidable: true,
    guideNote: "Work this voicing through the given key, all inversions." },
];

const FACTIONS = {
  visual:   { name: "Visual",   icon: "👁️", color: "#5b9df9" },
  physical: { name: "Physical", icon: "💪", color: "#f79f5b" },
  auditory: { name: "Auditory", icon: "👂", color: "#7bd88f" },
};

const TIME_PRESETS = [15, 30, 45, 60];
const CHUNK_MIN = 10;     // play minutes between analysis breaks
const ANALYZE_MIN = 1;    // analysis break length
const TRANSITION_MIN = 1; // break between tasks

// Guided content pools
const KEYS = ["C", "F", "Bb", "Eb", "Ab", "Db", "G", "D", "A", "E", "B", "F#"];
const TUNES = ["Autumn Leaves", "Blue Bossa", "All The Things You Are", "Take Five",
  "So What", "Misty", "Fly Me to the Moon", "Giant Steps", "Isn't She Lovely",
  "Georgia On My Mind", "There Will Never Be Another You", "Body and Soul"];
const DRILLS = ["major scale, 2 octaves", "dorian mode", "ii–V–I", "diminished 7th arpeggios",
  "chromatic approach patterns", "pentatonic runs", "3rds and 6ths", "whole-tone scale"];
const VOICING_TYPES = ["Drop 2 (maj7)", "Drop 2 (min7)", "Drop 3 (dom7)", "rootless A (ii–V–I)",
  "rootless B (ii–V–I)", "quartal voicings", "shell voicings", "block chords"];
const SCALE_DEGREES = ["C", "D", "E", "F", "G", "A", "B"];

export function setupPractice(ctx) {
  const { Tone } = ctx;
  const root = document.getElementById("practice");

  let store = loadStore();
  let view = "home";
  let setup = { minutes: 30, chosen: {} }; // chosen[key] = { on, guide }
  let run = null;
  let ticker = null;
  let chimeSynth = null;

  // ---- persistence ----
  function loadStore() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) {}
    return { history: s.history ?? [] }; // [{date, minutes, factions:{...}}]
  }
  function saveStore() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (_) {} }

  // ---- date + streak helpers ----
  function todayStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function computeStreak() {
    const days = new Set(store.history.map((h) => h.date));
    let streak = 0;
    const d = new Date();
    // Allow today to be unpracticed yet without breaking a run.
    if (!days.has(todayStr(d))) d.setDate(d.getDate() - 1);
    while (days.has(todayStr(d))) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }
  function factionTotals(days = 14) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const totals = { visual: 0, physical: 0, auditory: 0 };
    store.history.forEach((h) => {
      if (new Date(h.date) >= cutoff) {
        for (const f of Object.keys(totals)) totals[f] += (h.factions && h.factions[f]) || 0;
      }
    });
    return totals;
  }
  function weekMinutes() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    return store.history.filter((h) => new Date(h.date) >= cutoff)
      .reduce((s, h) => s + (h.minutes || 0), 0);
  }

  // =========================================================================
  // HOME
  // =========================================================================
  function renderHome() {
    const streak = computeStreak();
    const totals = factionTotals();
    const totalMin = totals.visual + totals.physical + totals.auditory;
    const suggestion = neglectSuggestion(totals, totalMin);

    const bars = Object.entries(FACTIONS).map(([key, f]) => {
      const val = totals[key];
      const pct = totalMin ? Math.round((val / totalMin) * 100) : 0;
      return `
        <div class="faction-row">
          <div class="faction-label">${f.icon} ${f.name}</div>
          <div class="faction-track"><div class="faction-fill" style="width:${pct}%;background:${f.color}"></div></div>
          <div class="faction-val">${Math.round(val)}m</div>
        </div>`;
    }).join("");

    const recent = store.history.slice(-5).reverse().map((h) =>
      `<div class="hist-row"><span>${h.date}</span><span>${Math.round(h.minutes)} min</span></div>`
    ).join("") || `<div class="hist-empty">No sessions yet — start one below.</div>`;

    root.innerHTML = `
      <div class="practice-home">
        <h1 class="screen-title">Practice</h1>
        <div class="stat-cards">
          <div class="stat-card">
            <div class="stat-big">${streak}🔥</div>
            <div class="stat-label">day streak</div>
          </div>
          <div class="stat-card">
            <div class="stat-big">${Math.round(weekMinutes())}</div>
            <div class="stat-label">min this week</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">Balance <span class="panel-sub">last 14 days</span></div>
          ${bars}
          ${suggestion ? `<div class="suggestion">💡 ${suggestion}</div>` : ""}
        </div>

        <button class="primary-btn" id="pr-new">Start a session</button>

        <div class="panel">
          <div class="panel-title">Recent</div>
          ${recent}
        </div>
      </div>`;

    root.querySelector("#pr-new").addEventListener("click", () => { view = "setup"; renderSetup(); });
  }

  function neglectSuggestion(totals, totalMin) {
    if (totalMin < 5) return null;
    let worst = null, worstShare = 1;
    for (const [key, f] of Object.entries(FACTIONS)) {
      const share = totals[key] / totalMin;
      if (share < worstShare) { worstShare = share; worst = f; }
    }
    if (worst && worstShare < 0.2) {
      const skill = SKILLS.find((s) => s.faction === Object.keys(FACTIONS).find((k) => FACTIONS[k] === worst));
      return `Your <b>${worst.name.toLowerCase()}</b> side is light lately — add some ${skill ? skill.name.toLowerCase() : worst.name.toLowerCase()}.`;
    }
    return null;
  }

  // =========================================================================
  // SETUP
  // =========================================================================
  function renderSetup() {
    const presets = TIME_PRESETS.map((m) =>
      `<button class="chip ${setup.minutes === m ? "active" : ""}" data-min="${m}">${m}m</button>`).join("");

    const skillRows = SKILLS.map((s) => {
      const c = setup.chosen[s.key] || { on: false, guide: false };
      return `
        <div class="skill-row ${c.on ? "on" : ""}" data-key="${s.key}">
          <button class="skill-toggle" data-key="${s.key}">
            <span class="skill-check">${c.on ? "✓" : ""}</span>
            <span class="skill-icon">${s.icon}</span>
            <span class="skill-name">${s.name}<span class="skill-faction">${FACTIONS[s.faction].name}</span></span>
          </button>
          <div class="skill-mode ${c.on ? "" : "hidden"}">
            <button class="seg ${!c.guide ? "active" : ""}" data-key="${s.key}" data-guide="0">Own material</button>
            <button class="seg ${c.guide ? "active" : ""}" data-key="${s.key}" data-guide="1">Guide me</button>
          </div>
        </div>`;
    }).join("");

    root.innerHTML = `
      <div class="practice-setup">
        <div class="setup-top">
          <button class="icon-btn" id="pr-back">‹ Back</button>
          <div class="trainer-title">New session</div>
          <div style="width:52px"></div>
        </div>

        <div class="panel">
          <div class="panel-title">How long?</div>
          <div class="chip-row">${presets}</div>
          <div class="custom-time">
            <input type="range" id="pr-range" min="5" max="120" step="5" value="${setup.minutes}">
            <span id="pr-range-val">${setup.minutes} min</span>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">What are you working on?</div>
          <div class="skill-list">${skillRows}</div>
        </div>

        <div id="pr-plan" class="panel plan-panel" style="display:none"></div>

        <button class="primary-btn" id="pr-start" disabled>Pick at least one skill</button>
      </div>`;

    root.querySelector("#pr-back").addEventListener("click", () => { view = "home"; renderHome(); });

    root.querySelectorAll(".chip").forEach((b) =>
      b.addEventListener("click", () => { setup.minutes = +b.dataset.min; renderSetup(); }));

    const range = root.querySelector("#pr-range");
    range.addEventListener("input", () => {
      setup.minutes = +range.value;
      root.querySelector("#pr-range-val").textContent = `${setup.minutes} min`;
      root.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", +c.dataset.min === setup.minutes));
      refreshPlanPreview();
    });

    root.querySelectorAll(".skill-toggle").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.key;
        const c = setup.chosen[k] || { on: false, guide: false };
        c.on = !c.on;
        setup.chosen[k] = c;
        renderSetup();
      }));

    root.querySelectorAll(".seg").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.key;
        if (setup.chosen[k]) { setup.chosen[k].guide = b.dataset.guide === "1"; renderSetup(); }
      }));

    const startBtn = root.querySelector("#pr-start");
    const anyOn = Object.values(setup.chosen).some((c) => c.on);
    startBtn.disabled = !anyOn;
    startBtn.textContent = anyOn ? "Start session ▶" : "Pick at least one skill";
    if (anyOn) startBtn.addEventListener("click", startSession);

    refreshPlanPreview();
  }

  function chosenSkills() {
    return SKILLS.filter((s) => setup.chosen[s.key] && setup.chosen[s.key].on);
  }

  function refreshPlanPreview() {
    const panel = root.querySelector("#pr-plan");
    if (!panel) return;
    const skills = chosenSkills();
    if (!skills.length) { panel.style.display = "none"; return; }
    const timeline = buildTimeline(setup.minutes, skills);
    const play = timeline.filter((s) => s.type === "play").reduce((a, s) => a + s.minutes, 0);
    const brk  = timeline.filter((s) => s.type !== "play").reduce((a, s) => a + s.minutes, 0);
    panel.style.display = "";
    panel.innerHTML = `
      <div class="panel-title">Plan <span class="panel-sub">${play}m play · ${brk}m breaks</span></div>
      <div class="plan-list">
        ${timeline.map((s) => planRow(s)).join("")}
      </div>`;
  }
  function planRow(seg) {
    if (seg.type === "analyze") return `<div class="plan-seg brk">🧠 Analyze (no playing) · ${seg.minutes}m</div>`;
    if (seg.type === "transition") return `<div class="plan-seg brk">☕ Break · ${seg.minutes}m</div>`;
    const s = SKILLS.find((x) => x.key === seg.skill);
    return `<div class="plan-seg"><span>${s.icon} ${s.name}</span><span>${seg.minutes}m</span></div>`;
  }

  // ---- timeline builder ----
  function buildTimeline(totalMinutes, skills) {
    const n = skills.length;
    // Reserve transition breaks, then estimate analysis breaks, then split the
    // remaining play time across tasks.
    const transitions = Math.max(0, n - 1);
    let playBudget = Math.max(n, totalMinutes - transitions);
    let analyze = Math.floor(playBudget / (CHUNK_MIN + 0)); // rough first pass
    playBudget = Math.max(n, totalMinutes - transitions - analyze);

    // Distribute play minutes as evenly as possible.
    const base = Math.floor(playBudget / n);
    let rem = playBudget - base * n;
    const perTask = skills.map(() => base + (rem-- > 0 ? 1 : 0));

    const segs = [];
    let playSinceBreak = 0;
    skills.forEach((s, ti) => {
      let remaining = Math.max(1, perTask[ti]);
      while (remaining > 0) {
        let chunk = Math.min(CHUNK_MIN - playSinceBreak, remaining);
        if (chunk <= 0) chunk = Math.min(CHUNK_MIN, remaining);
        segs.push({ type: "play", skill: s.key, minutes: chunk });
        remaining -= chunk;
        playSinceBreak += chunk;
        if (playSinceBreak >= CHUNK_MIN && (remaining > 0 || ti < n - 1)) {
          segs.push({ type: "analyze", minutes: ANALYZE_MIN });
          playSinceBreak = 0;
        }
      }
      if (ti < n - 1) {
        segs.push({ type: "transition", minutes: TRANSITION_MIN });
        playSinceBreak = 0;
      }
    });
    return segs;
  }

  // =========================================================================
  // RUNNER
  // =========================================================================
  async function startSession() {
    const skills = chosenSkills();
    const timeline = buildTimeline(setup.minutes, skills);
    // Attach guided content to play segments.
    timeline.forEach((seg) => {
      if (seg.type === "play") {
        const skill = SKILLS.find((s) => s.key === seg.skill);
        const guide = setup.chosen[seg.skill].guide;
        seg.guide = guide;
        seg.content = guide ? makeGuideContent(skill) : null;
      }
    });

    run = {
      timeline,
      idx: 0,
      remaining: timeline[0].minutes * 60,
      paused: false,
      factionSec: { visual: 0, physical: 0, auditory: 0 },
      lastPhrase: null,
    };
    view = "runner";
    try { await Tone.start(); } catch (_) {}
    renderRunner();
    startTicker();
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      if (!run || run.paused) return;
      const seg = run.timeline[run.idx];
      if (seg.type === "play") {
        const skill = SKILLS.find((s) => s.key === seg.skill);
        run.factionSec[skill.faction] += 1;
      }
      run.remaining -= 1;
      if (run.remaining <= 0) {
        advanceSegment();
      } else {
        updateRunnerClock();
      }
    }, 1000);
  }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function advanceSegment() {
    chime();
    run.idx++;
    if (run.idx >= run.timeline.length) return finishSession(true);
    run.remaining = run.timeline[run.idx].minutes * 60;
    renderRunner();
  }

  function renderRunner() {
    const seg = run.timeline[run.idx];
    const playSegs = run.timeline.filter((s) => s.type === "play");
    const playDoneCount = run.timeline.slice(0, run.idx).filter((s) => s.type === "play").length;
    const curTaskNum = Math.min(playDoneCount + (seg.type === "play" ? 1 : 0), playSegs.length);

    let title, sub, body, accent;
    if (seg.type === "play") {
      const s = SKILLS.find((x) => x.key === seg.skill);
      accent = FACTIONS[s.faction].color;
      title = `${s.icon} ${s.name}`;
      sub = `Task ${curTaskNum} of ${playSegs.length} · ${FACTIONS[s.faction].name}`;
      body = seg.guide
        ? `<div class="guide-note">${s.guideNote}</div>
           <div class="guide-content">${seg.content.html}</div>
           ${seg.content.audio ? `<button class="ghost" id="pr-phrase">▶ play phrase</button>` : ""}`
        : `<div class="guide-note">Your own material — the app's just keeping time.</div>`;
    } else if (seg.type === "analyze") {
      accent = "#a78bfa";
      title = "🧠 Analyze";
      sub = "Micro-break — don't play";
      body = `<div class="guide-note">Hands off. Replay in your head what you just practiced — what worked, what didn't. This is when it sticks.</div>`;
    } else {
      accent = "#94a3b8";
      title = "☕ Break";
      sub = "Reset before the next task";
      body = `<div class="guide-note">Stretch, breathe, sip water.</div>`;
    }

    root.innerHTML = `
      <div class="runner" style="--accent:${accent}">
        <div class="setup-top">
          <button class="icon-btn" id="pr-end">✕ End</button>
          <div class="trainer-title">Session</div>
          <div style="width:52px"></div>
        </div>
        <div class="runner-sub">${sub}</div>
        <div class="runner-title">${title}</div>
        <div class="runner-clock" id="pr-clock">${fmt(run.remaining)}</div>
        <div class="runner-ring"><div class="runner-ring-bar" id="pr-ring"></div></div>
        <div class="runner-body">${body}</div>
        <div class="runner-controls">
          <button class="ghost" id="pr-pause">${run.paused ? "▶ Resume" : "⏸ Pause"}</button>
          <button class="ghost" id="pr-skip">skip →</button>
        </div>
        <div class="runner-next">${nextLabel()}</div>
      </div>`;

    root.querySelector("#pr-end").addEventListener("click", () => finishSession(false));
    root.querySelector("#pr-pause").addEventListener("click", togglePause);
    root.querySelector("#pr-skip").addEventListener("click", advanceSegment);
    const phrase = root.querySelector("#pr-phrase");
    if (phrase) phrase.addEventListener("click", () => playPhrase(seg.content));
    updateRunnerClock();

    // Auto-play the transcription phrase once on entry.
    if (seg.type === "play" && seg.guide && seg.content && seg.content.audio) {
      setTimeout(() => playPhrase(seg.content), 400);
    }
  }

  function nextLabel() {
    const nxt = run.timeline[run.idx + 1];
    if (!nxt) return "Last segment — finish strong 💪";
    if (nxt.type === "play") { const s = SKILLS.find((x) => x.key === nxt.skill); return `Next: ${s.icon} ${s.name}`; }
    if (nxt.type === "analyze") return "Next: 🧠 analyze break";
    return "Next: ☕ break";
  }

  function updateRunnerClock() {
    const clock = root.querySelector("#pr-clock");
    if (clock) clock.textContent = fmt(run.remaining);
    const ring = root.querySelector("#pr-ring");
    if (ring) {
      const seg = run.timeline[run.idx];
      const frac = 1 - run.remaining / (seg.minutes * 60);
      ring.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    }
  }

  function togglePause() {
    run.paused = !run.paused;
    const b = root.querySelector("#pr-pause");
    if (b) b.textContent = run.paused ? "▶ Resume" : "⏸ Pause";
  }

  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ---- guided content ----
  function makeGuideContent(skill) {
    const key = KEYS[Math.floor(Math.random() * KEYS.length)];
    if (skill.key === "sightreading") {
      const line = Array.from({ length: 8 }, () =>
        SCALE_DEGREES[Math.floor(Math.random() * SCALE_DEGREES.length)]).join("  ");
      return { html: `<div class="read-line">Key of ${key}:<br><span class="notes">${line}</span></div>` };
    }
    if (skill.key === "transcribing") {
      const phrase = randomPhrase();
      return { html: `<div class="read-line">Transcribe this ${phrase.length}-note phrase by ear.</div>`, audio: phrase };
    }
    if (skill.key === "tune") {
      return { html: `<div class="read-line big">${TUNES[Math.floor(Math.random() * TUNES.length)]}</div>` };
    }
    if (skill.key === "drills") {
      return { html: `<div class="read-line"><b>${key}</b> — ${DRILLS[Math.floor(Math.random() * DRILLS.length)]}</div>` };
    }
    if (skill.key === "voicings") {
      return { html: `<div class="read-line">${VOICING_TYPES[Math.floor(Math.random() * VOICING_TYPES.length)]} in <b>${key}</b></div>` };
    }
    return { html: "" };
  }

  function randomPhrase() {
    // A short diatonic-ish melodic line in C, as MIDI notes around octave 4.
    const scale = [60, 62, 64, 65, 67, 69, 71, 72];
    const len = 4 + Math.floor(Math.random() * 4);
    const notes = [];
    let i = Math.floor(Math.random() * scale.length);
    for (let k = 0; k < len; k++) {
      i = Math.max(0, Math.min(scale.length - 1, i + (Math.floor(Math.random() * 5) - 2)));
      notes.push(scale[i]);
    }
    return notes;
  }
  async function playPhrase(content) {
    if (!content || !content.audio) return;
    try {
      await ctx.ensurePiano();
      const piano = ctx.getPiano();
      const now = Tone.now();
      content.audio.forEach((midi, i) => {
        const name = Tone.Frequency(midi, "midi").toNote();
        piano.triggerAttackRelease(name, "4n", now + i * 0.45, 0.8);
      });
    } catch (_) {}
  }

  function chime() {
    try {
      if (!chimeSynth) chimeSynth = new Tone.Synth({ envelope: { attack: 0.005, release: 0.3 } }).toDestination();
      const now = Tone.now();
      chimeSynth.triggerAttackRelease("C6", "16n", now);
      chimeSynth.triggerAttackRelease("G6", "16n", now + 0.14);
    } catch (_) {}
  }

  // =========================================================================
  // SUMMARY + record
  // =========================================================================
  function finishSession(completed) {
    stopTicker();
    const factionsMin = {
      visual:   run.factionSec.visual / 60,
      physical: run.factionSec.physical / 60,
      auditory: run.factionSec.auditory / 60,
    };
    const totalMin = factionsMin.visual + factionsMin.physical + factionsMin.auditory;

    if (totalMin >= 0.5) {
      const date = todayStr();
      const existing = store.history.find((h) => h.date === date);
      if (existing) {
        existing.minutes += totalMin;
        for (const f of Object.keys(factionsMin)) existing.factions[f] = (existing.factions[f] || 0) + factionsMin[f];
      } else {
        store.history.push({ date, minutes: totalMin, factions: { ...factionsMin } });
      }
      saveStore();
    }

    const streak = computeStreak();
    root.innerHTML = `
      <div class="summary">
        <div class="summary-emoji">${completed ? "🎉" : "✅"}</div>
        <h1 class="screen-title">${completed ? "Session complete!" : "Session ended"}</h1>
        <div class="stat-cards">
          <div class="stat-card"><div class="stat-big">${Math.round(totalMin)}</div><div class="stat-label">minutes played</div></div>
          <div class="stat-card"><div class="stat-big">${streak}🔥</div><div class="stat-label">day streak</div></div>
        </div>
        <div class="panel">
          <div class="panel-title">This session</div>
          ${Object.entries(FACTIONS).map(([k, f]) => {
            const pct = totalMin ? Math.round((factionsMin[k] / totalMin) * 100) : 0;
            return `<div class="faction-row">
              <div class="faction-label">${f.icon} ${f.name}</div>
              <div class="faction-track"><div class="faction-fill" style="width:${pct}%;background:${f.color}"></div></div>
              <div class="faction-val">${Math.round(factionsMin[k])}m</div></div>`;
          }).join("")}
        </div>
        <button class="primary-btn" id="pr-done">Done</button>
      </div>`;
    root.querySelector("#pr-done").addEventListener("click", () => { run = null; view = "home"; renderHome(); });
    run = null;
  }

  // =========================================================================
  // Enter / exit
  // =========================================================================
  function renderCurrent() {
    if (view === "home") return renderHome();
    if (view === "setup") return renderSetup();
    if (view === "runner") return renderRunner();
  }

  return {
    async enter() {
      store = loadStore();
      view = "home";
      renderHome();
      ctx.setStatus("Practice");
    },
    exit() {
      stopTicker();
      // Preserve an in-progress run so returning to the tab resumes it.
      if (view !== "runner") run = null;
    },
  };
}
