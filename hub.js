// Home hub (NYT-mini style) + daily games. The clean iPhone-first landing;
// "Lucas's Lab" reveals the full trainer suite underneath.

const DAYMS = 86400000;
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function setupHub(ctx) {
  const { Tone } = ctx;
  const home = document.getElementById("home");
  const daily = document.getElementById("daily");

  let synth = null;
  function ensureSynth() {
    if (!synth) {
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.03, attackCurve: "sine", decay: 0.05, sustain: 0.9, release: 0.16, releaseCurve: "linear" },
      }).toDestination();
      synth.volume.value = -6;
    }
    return synth;
  }
  function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function centsFreq(f, c) { return f * Math.pow(2, c / 1200); }
  function tone(freq, at = 0, dur = 0.5) { try { ensureSynth().triggerAttackRelease(freq, dur, Tone.now() + at); } catch (_) {} }

  function loadDaily(id) { try { return JSON.parse(localStorage.getItem(`pt.daily.${id}`)) || {}; } catch (_) { return {}; } }
  function saveDaily(id, o) { try { localStorage.setItem(`pt.daily.${id}`, JSON.stringify(o)); } catch (_) {} }

  // =========================================================================
  // HOME
  // =========================================================================
  const DAILIES = [
    { id: "jnd", title: "Smallest Interval", sub: "How fine is your ear today?", icon: "📏", color: "#6c8cff", live: true },
    { id: "prog", title: "Chord Progression", sub: "Name the diatonic changes", icon: "🎹", color: "#f79f5b", live: false },
    { id: "leap", title: "Compound Leap", sub: "Intervals octaves apart", icon: "🪃", color: "#7bd88f", live: false },
  ];

  function renderHome() {
    const d = new Date();
    const dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const cards = DAILIES.map((game) => {
      const rec = loadDaily(game.id);
      const played = rec.date === todayStr();
      let tag = "";
      if (!game.live) tag = `<span class="hub-tag soon">soon</span>`;
      else if (played) tag = `<span class="hub-tag done">✓ ${rec.label || "done"}</span>`;
      else tag = `<span class="hub-tag play">Play</span>`;
      return `
        <button class="hub-card ${game.live ? "" : "locked"}" data-daily="${game.id}" ${game.live ? "" : "disabled"}>
          <div class="hub-icon" style="background:${game.color}">${game.icon}</div>
          <div class="hub-card-body">
            <div class="hub-card-title">${game.title}</div>
            <div class="hub-card-sub">${game.sub}</div>
          </div>
          ${tag}
        </button>`;
    }).join("");

    home.innerHTML = `
      <div class="hub">
        <div class="hub-head">
          <div class="hub-date">${dateStr}</div>
          <h1 class="hub-title">Ear Games</h1>
        </div>
        <div class="hub-section-label">Today's puzzles</div>
        <div class="hub-cards">${cards}</div>
        <button class="hub-lab" data-lab>🧪 Lucas's Lab — all the trainers ›</button>
        <div class="hub-foot">One attempt per game per day. Leaderboard coming soon.</div>
      </div>`;

    home.querySelectorAll("[data-daily]").forEach((b) => b.addEventListener("click", () => ctx.goDaily(b.dataset.daily)));
    home.querySelector("[data-lab]").addEventListener("click", () => ctx.goLucas());
  }

  // =========================================================================
  // DAILY GAME: Smallest Interval (adaptive JND, 2 lives, one attempt/day)
  // =========================================================================
  let jnd = null;
  const JND_START = 100;   // starting gap in cents (1 semitone — easy)
  const JND_LIVES = 2;

  function fracLabel(cents) {
    const n = Math.round(100 / cents);
    return `1/${n} tone`;
  }
  async function startDaily(id) {
    try { await Tone.start(); } catch (_) {}
    if (id !== "jnd") return;
    const rec = loadDaily("jnd");
    if (rec.date === todayStr()) return renderDailyDone(rec);
    jnd = { lives: JND_LIVES, delta: JND_START, best: null, done: false };
    jndNext();
  }
  function jndPlay() {
    const bf = midiFreq(52 + Math.floor(Math.random() * 17)); // random ref each round
    tone(bf, 0); tone(bf, 0.55); tone(bf, 1.1);
    tone(centsFreq(bf, jnd.dir * jnd.delta), 1.85, 0.6);
  }
  function jndNext() {
    jnd.dir = Math.random() < 0.5 ? 1 : -1;
    renderDailyPlay();
    jndPlay();
  }
  function renderDailyPlay() {
    const hearts = "❤️".repeat(jnd.lives) + "🖤".repeat(JND_LIVES - jnd.lives);
    daily.innerHTML = `
      <div class="dg">
        <button class="dg-x" data-home>✕</button>
        <div class="dg-name">Smallest Interval</div>
        <div class="dg-lives">${hearts}</div>
        <div class="dg-gap">${fracLabel(jnd.delta)}<span>${jnd.delta.toFixed(1)}¢ apart</span></div>
        <div class="dg-q">Same note ×3, then the test. Higher or lower?</div>
        <div class="dg-ans">
          <button class="dg-btn" data-dir="up">Higher ⬆</button>
          <button class="dg-btn" data-dir="dn">Lower ⬇</button>
        </div>
        <button class="dg-replay" data-replay>replay ↺</button>
        ${jnd.best ? `<div class="dg-best">best so far · ${fracLabel(jnd.best)}</div>` : ""}
      </div>`;
    daily.querySelector("[data-home]").addEventListener("click", () => ctx.goHome());
    daily.querySelector("[data-replay]").addEventListener("click", jndPlay);
    daily.querySelectorAll("[data-dir]").forEach((b) => b.addEventListener("click", () => jndAnswer(b.dataset.dir === "up")));
  }
  function jndAnswer(higher) {
    if (!jnd || jnd.done) return;
    const correct = higher === (jnd.dir > 0);
    if (correct) {
      jnd.best = jnd.best == null ? jnd.delta : Math.min(jnd.best, jnd.delta);
      jnd.delta = jnd.delta / 2;         // smaller gap — harder
    } else {
      jnd.lives -= 1;
      jnd.delta = Math.min(JND_START, jnd.delta * 2); // bigger gap — easier
    }
    if (jnd.lives <= 0) return jndEnd();
    jndNext();
  }
  function jndEnd() {
    jnd.done = true;
    const scoreCents = jnd.best == null ? JND_START * 2 : jnd.best; // never got one → worst
    const rec = { date: todayStr(), score: Math.round(scoreCents * 100) / 100, label: fracLabel(scoreCents) };
    saveDaily("jnd", rec);
    renderDailyDone(rec, true);
  }
  function renderDailyDone(rec, justFinished) {
    daily.innerHTML = `
      <div class="dg dg-result">
        <button class="dg-x" data-home>✕</button>
        <div class="dg-emoji">${justFinished ? "🎉" : "✅"}</div>
        <div class="dg-name">Smallest Interval</div>
        <div class="dg-score">${rec.label}</div>
        <div class="dg-score-sub">${rec.score}¢ — ${justFinished ? "your score today" : "you've already played today"}</div>
        <div class="dg-q">${justFinished ? "Nice. Come back tomorrow for a new one." : "Come back tomorrow for a new puzzle."}</div>
        <button class="dg-cta" data-home>Back to games</button>
        <div class="dg-best">Leaderboard coming soon — you'll be able to compare with friends.</div>
      </div>`;
    daily.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => ctx.goHome()));
  }

  return { renderHome, startDaily };
}
