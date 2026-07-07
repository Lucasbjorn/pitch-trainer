// Shared performance stats — per pitch-class and per interval/voicing type.
//
// Every drill reports outcomes here. Correct answers given with NO assistance
// (crutch faded out AND no hint AND first try) build an "unassisted streak";
// a long streak (rare) earns a mastery award. Interval/chord/pattern reps also
// credit each note they contain, so working a voicing strengthens its notes.

const KEY = "pt.stats.v1";
const AWARD_STREAK = 15; // consecutive unassisted-correct to master (rare)

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function blank() { return { seen: 0, correct: 0, unassisted: 0, streak: 0, best: 0, mastered: false }; }

function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) {}
  s.notes = s.notes || {};
  s.intervals = s.intervals || {};
  s.awards = s.awards || [];
  return s;
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }

function bump(map, key, correct, assisted) {
  const e = map[key] || blank();
  e.seen++;
  if (correct) e.correct++;
  if (correct && !assisted) {
    e.unassisted++; e.streak++; if (e.streak > e.best) e.best = e.streak;
  } else {
    e.streak = 0;
  }
  map[key] = e;
  return e;
}
function maybeAward(s, kind, name, e) {
  if (!e.mastered && e.streak >= AWARD_STREAK) {
    e.mastered = true;
    const id = `${kind}:${name}`;
    if (!s.awards.find((x) => x.id === id)) {
      const aw = { id, kind, name, date: new Date().toISOString().slice(0, 10) };
      s.awards.push(aw);
      return aw;
    }
  }
  return null;
}

// Returns an array of any newly-earned awards (usually empty).
export function recordNote(name, correct, assisted) {
  const s = load();
  const e = bump(s.notes, name, correct, assisted);
  const aw = maybeAward(s, "note", name, e);
  save(s);
  return aw ? [aw] : [];
}

// `notes` = pitch-class names contained in the interval/voicing/pattern.
export function recordInterval(label, notes, correct, assisted) {
  const s = load();
  const out = [];
  const e = bump(s.intervals, label, correct, assisted);
  const a = maybeAward(s, "interval", label, e); if (a) out.push(a);
  (notes || []).forEach((n) => {
    const ne = bump(s.notes, n, correct, assisted);
    const na = maybeAward(s, "note", n, ne); if (na) out.push(na);
  });
  save(s);
  return out;
}

// Credit a set of notes directly (patterns / multi-note drills with no type).
export function recordNotes(notes, correct, assisted) {
  const s = load();
  const out = [];
  (notes || []).forEach((n) => {
    const ne = bump(s.notes, n, correct, assisted);
    const na = maybeAward(s, "note", n, ne); if (na) out.push(na);
  });
  save(s);
  return out;
}

export function getStats() { return load(); }

// ---------------------------------------------------------------------------
// Stats tab
// ---------------------------------------------------------------------------
export function setupStats(ctx) {
  const rootEl = document.getElementById("stats");

  function pct(e) { return e && e.seen ? Math.round((e.correct / e.seen) * 100) : 0; }

  function render() {
    const s = load();

    const noteCells = PITCH_NAMES.map((n) => {
      const e = s.notes[n] || blank();
      const cls = e.mastered ? "mastered" : e.best > 0 ? "started" : "";
      return `<div class="stat-note ${cls}">
        <div class="stat-note-name">${n}${e.mastered ? " ⭐" : ""}</div>
        <div class="stat-note-pct">${pct(e)}%</div>
        <div class="stat-note-sub">best ${e.best}</div>
      </div>`;
    }).join("");

    const ivKeys = Object.keys(s.intervals);
    const ivRows = ivKeys.length ? ivKeys.map((k) => {
      const e = s.intervals[k];
      return `<div class="hist-row"><span>${e.mastered ? "⭐ " : ""}${k}</span><span>${pct(e)}% · best ${e.best}</span></div>`;
    }).join("") : `<div class="hist-empty">No interval/voicing reps yet.</div>`;

    const awards = s.awards.length ? s.awards.slice().reverse().map((a) =>
      `<div class="award">🏆 <b>${a.name}</b> <span>${a.kind} · ${a.date}</span></div>`).join("")
      : `<div class="hist-empty">No awards yet — master a note or interval with no assistance to earn one (rare).</div>`;

    rootEl.innerHTML = `
      <div class="stats-home">
        <h1 class="screen-title">Stats</h1>
        <div class="panel">
          <div class="panel-title">Notes <span class="panel-sub">accuracy · best unassisted streak</span></div>
          <div class="stat-note-grid">${noteCells}</div>
        </div>
        <div class="panel">
          <div class="panel-title">Intervals &amp; voicings</div>
          ${ivRows}
        </div>
        <div class="panel">
          <div class="panel-title">Awards</div>
          ${awards}
        </div>
      </div>`;
  }

  return {
    async enter() { render(); ctx.setStatus("Stats"); },
    exit() {},
  };
}
