// calibrate-data.js — the data spine of Daily Calibration.
//
//   Storage   every trial is written the moment it happens (IndexedDB, with a
//             localStorage fallback) + an optional Supabase backup (cal_rows).
//   analyze() raw trials → a model of the ear: mechanism indices estimated from
//             RANDOMIZED within-session manipulations (cleanser on/off, piano vs
//             sine, octave spread), reaction-time structure, confusions, context.
//   makePlan() the adaptive program for the next session: per-station
//             difficulty levels (a staircase across days), weak-note weighting,
//             and a trial budget that leans into the weakest station.
//
// analyze() and makePlan() are pure, so they're unit-tested against simulated
// listeners (tools/test-cal-analysis.mjs). See CALIBRATION.md for the protocol.

export const SCHEMA_VERSION = 1;
export const STATIONS_GRADED = ["imagine", "anchor", "hold", "name", "twins", "triad"];
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DB_NAME = "pitches-calibration", DB_VER = 1, LS_KEY = "pt.cal.data", SYNC_KEY = "pt.cal.syncedThrough";

// =============================================================================
// STORAGE
// =============================================================================
let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("no indexedDB"));
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("trials")) db.createObjectStore("trials", { keyPath: "id" }).createIndex("sessionId", "sessionId");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
function lsLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || { sessions: {}, trials: {} }; } catch (_) { return { sessions: {}, trials: {} }; } }
function lsSave(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (_) {} }

async function put(store, obj) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(obj);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  } catch (_) {
    const d = lsLoad(); d[store][obj.id] = obj; lsSave(d);   // fallback: never drop a trial
  }
}
async function getAll(store) {
  let rows = [];
  try {
    const db = await openDB();
    rows = await new Promise((res, rej) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
  } catch (_) {}
  const extra = Object.values(lsLoad()[store] || {});               // union with any fallback writes
  if (!extra.length) return rows;
  const byId = new Map(rows.map((x) => [x.id, x]));
  extra.forEach((x) => { if (!byId.has(x.id)) byId.set(x.id, x); });
  return [...byId.values()];
}

export const putTrial = (t) => put("trials", t);
export const putSession = (s) => put("sessions", { ...s, updatedAt: Date.now() });
export async function allData() {
  const [sessions, trials] = await Promise.all([getAll("sessions"), getAll("trials")]);
  sessions.sort((a, b) => a.startedAt - b.startedAt);
  trials.sort((a, b) => a.t - b.t || a.gi - b.gi);
  return { sessions, trials };
}
export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (_) {}
  return false;
}

// ---- optional cloud backup (injected so this module stays backend-agnostic) ----
let cloud = { upload: null, download: null };
export function setCloud(c) { cloud = { ...cloud, ...c }; }
export async function syncCloud() {
  if (!cloud.upload) return { ok: false, reason: "no backend" };
  const since = +(localStorage.getItem(SYNC_KEY) || 0);
  const { sessions, trials } = await allData();
  const rows = [
    ...sessions.map((s) => ({ kind: "session", obj: s, t: s.updatedAt || s.startedAt })),
    ...trials.map((t) => ({ kind: "trial", obj: t, t: t.t })),
  ].filter((r) => r.t > since).sort((a, b) => a.t - b.t);
  if (!rows.length) return { ok: true, n: 0 };
  let maxT = since;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    let ok = false;
    try { ok = await cloud.upload(batch); } catch (_) {}
    if (!ok) return { ok: false, n: i, reason: "upload failed (signed in? table created?)" };
    maxT = Math.max(maxT, batch[batch.length - 1].t);
    try { localStorage.setItem(SYNC_KEY, String(maxT)); } catch (_) {}
  }
  return { ok: true, n: rows.length };
}

// ---- export ------------------------------------------------------------------
export async function exportBundle({ includeCloud = true } = {}) {
  let { sessions, trials } = await allData();
  let cloudRows = 0;
  if (includeCloud && cloud.download) {
    try {
      const rows = await cloud.download();
      if (rows && rows.length) {
        cloudRows = rows.length;
        const S = new Map(sessions.map((s) => [s.id, s])), T = new Map(trials.map((t) => [t.id, t]));
        rows.forEach((r) => {
          const o = r.data; if (!o || !o.id) return;
          if (r.kind === "session") { const cur = S.get(o.id); if (!cur || (o.updatedAt || 0) > (cur.updatedAt || 0)) S.set(o.id, o); }
          else if (!T.has(o.id)) T.set(o.id, o);
        });
        sessions = [...S.values()].sort((a, b) => a.startedAt - b.startedAt);
        trials = [...T.values()].sort((a, b) => a.t - b.t || a.gi - b.gi);
      }
    } catch (_) {}
  }
  return {
    app: "pitches-daily-calibration", schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(), tzOffsetMin: new Date().getTimezoneOffset(), cloudRows,
    sessions, trials, analysis: analyze({ sessions, trials }),
  };
}
export function trialsToCSV(trials) {
  const flat = trials.map((t) => {
    const o = {};
    Object.entries(t).forEach(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v)) Object.entries(v).forEach(([k2, v2]) => { o[`${k}_${k2}`] = v2; });
      else o[k] = v;
    });
    return o;
  });
  const cols = [...new Set(flat.flatMap((o) => Object.keys(o)))];
  const cell = (v) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...flat.map((o) => cols.map((c) => cell(o[c])).join(","))].join("\n");
}

// =============================================================================
// MATH HELPERS
// =============================================================================
export const circ = (from, to) => ((((to - from) % 12) + 18) % 12) - 6;   // signed semitones, −6..+5
export const cdist = (a, b) => Math.abs(circ(a, b));                     // 0..6
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function prop(arr) { const g = arr.filter((t) => typeof t.correct === "boolean"); const k = g.filter((t) => t.correct).length; return { n: g.length, k, acc: g.length ? k / g.length : null }; }
function ols(xs, ys) {
  const n = xs.length; if (n < 3) return { n, slope: null, r: null };
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!sxx || !syy) return { n, slope: 0, r: 0 };
  return { n, slope: sxy / sxx, r: sxy / Math.sqrt(sxx * syy) };
}
function diffCI(a, b) {        // a − b with an approximate 95% CI (two proportions)
  if (!a.n || !b.n) return null;
  const d = a.acc - b.acc, se = Math.sqrt((a.acc * (1 - a.acc)) / a.n + (b.acc * (1 - b.acc)) / b.n);
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se };
}
function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// =============================================================================
// ANALYSIS — a model of the ear
// =============================================================================
export function analyze({ sessions = [], trials = [] } = {}) {
  const T = trials.filter((t) => !t.practice);
  const by = (st) => T.filter((t) => t.station === st);
  const name = by("name");
  const nameClean = name.filter((t) => t.stim && t.stim.wash !== false && t.stim.timbre !== "sine"); // the canonical condition
  const out = { generatedAt: new Date().toISOString(), nSessions: sessions.length, nTrials: T.length, indices: {} };

  // ---- per-session timeline + learning trend --------------------------------
  const bySess = new Map();
  T.forEach((t) => { if (!bySess.has(t.sessionId)) bySess.set(t.sessionId, []); bySess.get(t.sessionId).push(t); });
  out.timeline = sessions.map((s) => {
    const ts = bySess.get(s.id) || [];
    const all = prop(ts), nm = prop(ts.filter((t) => t.station === "name"));
    return { id: s.id, date: new Date(s.startedAt).toISOString().slice(0, 10), dayIndex: s.dayIndex, completed: !!s.completed,
      acc: all.acc, n: all.n, nameAcc: nm.acc, nameN: nm.n, checkin: s.checkin || null, durSec: s.durSec || null, levels: s.plan ? s.plan.levels : null };
  });
  const tl = out.timeline.filter((x) => x.nameN >= 3);
  const tr = ols(tl.map((_, i) => i), tl.map((x) => x.nameAcc));
  out.trend = { sessionsUsed: tl.length, namingSlopePerSession: tr.slope, r: tr.r };

  // ---- stations ----------------------------------------------------------------
  out.stations = {};
  STATIONS_GRADED.forEach((st) => { out.stations[st] = prop(by(st)); });

  // ---- pitch map (naming, all conditions) ------------------------------------------
  out.pcMap = PC.map((nm, pc) => {
    const g = name.filter((t) => t.stim.pc === pc), p = prop(g);
    return { pc, name: nm, ...p, medRt: median(g.filter((t) => t.correct).map((t) => t.rt).filter(Number.isFinite)) };
  });

  // ---- 1. Relative-pitch leak: accuracy WITHOUT vs WITH the atonal cleanser -------------
  //  The cleanser wipes the last labeled note from working memory; if accuracy
  //  drops when it's there, you were computing from that note (relative pitch).
  {
    const piano = name.filter((t) => t.stim.timbre !== "sine");
    const noWash = prop(piano.filter((t) => t.stim.wash === false)), wash = prop(piano.filter((t) => t.stim.wash !== false));
    const ci = diffCI(noWash, wash);
    const wrong = name.filter((t) => t.correct === false && Number.isFinite(t.stim.prevPc));
    const persev = wrong.length ? wrong.filter((t) => t.resp === t.stim.prevPc).length / wrong.length : null;
    out.indices.rpLeak = { noWash, wash, diff: ci ? ci.d : null, ci, perseveration: persev, nWrong: wrong.length,
      enough: noWash.n >= 8 && wash.n >= 15 };
  }

  // ---- 2. Inferred anchor: does RT grow with distance from some note? --------------
  //  True AP: RT is flat across notes. Counting from an anchor: RT rises with the
  //  distance from it. Test all 12 candidates; permutation test guards against
  //  picking the best of 12 by luck.
  {
    const pts = nameClean.filter((t) => t.correct && Number.isFinite(t.rt) && t.rt < 15000);
    const fit = (a, rts) => ols(pts.map((t) => cdist(t.stim.pc, a)), rts);
    const rts = pts.map((t) => t.rt);
    let best = { anchor: null, slope: null, r: -1 };
    for (let a = 0; a < 12; a++) { const f = fit(a, rts); if (f.r != null && f.r > best.r) best = { anchor: a, slope: f.slope, r: f.r }; }
    let p = null;
    if (pts.length >= 15 && best.anchor != null) {
      const rnd = seeded(pts.length * 7919 + 13); let hits = 0; const ITER = 300;
      for (let it = 0; it < ITER; it++) {
        const sh = [...rts]; for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
        let m = -1; for (let a = 0; a < 12; a++) { const f = fit(a, sh); if (f.r != null && f.r > m) m = f.r; }
        if (m >= best.r) hits++;
      }
      p = (hits + 1) / (ITER + 1);
    }
    const accByDist = best.anchor == null ? [] : [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, ...prop(nameClean.filter((t) => cdist(t.stim.pc, best.anchor) === d)) }));
    out.indices.anchor = { n: pts.length, anchor: best.anchor, anchorName: best.anchor == null ? null : PC[best.anchor],
      msPerSemitone: best.slope, r: best.r < 0 ? null : best.r, p, accByDist,
      verdict: pts.length < 15 ? "needs-data" : (p != null && p < 0.05 && best.slope > 40 ? "counting-from-anchor" : "flat") };
  }

  // ---- 3. Gut vs compute: is a correct answer a fast categorical hit? -------------
  {
    const g = nameClean.filter((t) => typeof t.correct === "boolean" && Number.isFinite(t.rt));
    const rc = g.filter((t) => t.correct).map((t) => t.rt), rw = g.filter((t) => !t.correct).map((t) => t.rt);
    out.indices.gut = { n: g.length, medRtCorrect: median(rc), medRtWrong: median(rw),
      fastCorrectRate: g.length ? g.filter((t) => t.correct && t.rt < 1500).length / g.length : null };
  }

  // ---- 4. Timbre lock: piano vs pure sine ----------------------------------------
  {
    const w = name.filter((t) => t.stim.wash !== false);
    const piano = prop(w.filter((t) => t.stim.timbre !== "sine")), sine = prop(w.filter((t) => t.stim.timbre === "sine"));
    out.indices.timbre = { piano, sine, diff: diffCI(piano, sine), enough: sine.n >= 8 && piano.n >= 15 };
  }

  // ---- 5. Register dependence: accuracy by octave ---------------------------------
  {
    const octs = [...new Set(nameClean.map((t) => t.stim.oct))].sort();
    const rows = octs.map((o) => ({ oct: o, ...prop(nameClean.filter((t) => t.stim.oct === o)) })).filter((r) => r.n >= 5);
    const accs = rows.map((r) => r.acc);
    out.indices.register = { byOct: rows, spread: accs.length >= 2 ? Math.max(...accs) - Math.min(...accs) : null };
  }

  // ---- 6. Chroma vs height (octave twins) -----------------------------------------
  {
    const tw = by("twins");
    const offs = [...new Set(tw.map((t) => cdist(0, t.stim.offset)))].sort((a, b) => a - b);
    out.indices.chroma = { ...prop(tw), byOffset: offs.map((d) => ({ semis: d, ...prop(tw.filter((t) => cdist(0, t.stim.offset) === d)) })) };
  }

  // ---- 7. Working-memory decay (hold it) -----------------------------------------
  {
    const h = by("hold").filter((t) => typeof t.correct === "boolean");
    const durs = [...new Set(h.map((t) => t.stim.dur))].sort((a, b) => a - b);
    const f = ols(h.map((t) => t.stim.dur), h.map((t) => (t.correct ? 1 : 0)));
    out.indices.hold = { n: h.length, byDur: durs.map((d) => ({ dur: d, ...prop(h.filter((t) => t.stim.dur === d)) })), accPerSecond: f.slope };
  }

  // ---- 8. Inner pitch (sung production): template bias in cents --------------------
  {
    const s = by("imagine").filter((t) => t.sing && t.sing.ok && Number.isFinite(t.sing.cents));
    const c = s.map((t) => t.sing.cents);
    const self = by("imagine").filter((t) => t.resp === "nailed" || t.resp === "off");
    out.indices.imagery = { nSung: s.length, meanBiasCents: mean(c), meanAbsCents: mean(c.map(Math.abs)),
      within50: s.length ? c.filter((x) => Math.abs(x) <= 50).length / s.length : null,
      octaveSung: median(s.map((t) => t.sing.oct)), selfNailedRate: self.length ? self.filter((t) => t.resp === "nailed").length / self.length : null, nSelf: self.length };
  }

  // ---- 9. Anchor precision: false alarms by distance from C ------------------------
  {
    const a = by("anchor");
    const hits = prop(a.filter((t) => t.stim.isAnchor));
    const lures = a.filter((t) => !t.stim.isAnchor);
    const ds = [...new Set(lures.map((t) => cdist(0, t.stim.offset)))].sort((x, y) => x - y);
    out.indices.anchorLock = { hitRate: hits.acc, nHits: hits.n,
      falseAlarmsByDist: ds.map((d) => { const g = lures.filter((t) => cdist(0, t.stim.offset) === d); return { semis: d, n: g.length, faRate: g.length ? g.filter((t) => t.resp === "yes").length / g.length : null }; }) };
  }

  // ---- 10. Confusions + systematic shift --------------------------------------------
  {
    const wrong = name.filter((t) => t.correct === false && Number.isFinite(t.resp));
    const counts = new Map();
    wrong.forEach((t) => { const k = `${t.stim.pc}>${t.resp}`; counts.set(k, (counts.get(k) || 0) + 1); });
    const kind = (d) => { const a = Math.abs(d); return a === 1 ? "semitone neighbor" : a === 2 ? "whole step" : a === 5 ? "4th/5th (tonal)" : a === 6 ? "tritone" : a === 3 || a === 4 ? "third" : "other"; };
    out.confusions = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => {
      const [f, to] = k.split(">").map(Number); const d = circ(f, to);
      return { from: PC[f], to: PC[to], n, semis: d, kind: kind(d) };
    });
    const errs = wrong.map((t) => circ(t.stim.pc, t.resp));
    out.indices.shift = { nWrong: errs.length, meanSignedSemis: mean(errs), sharpRate: errs.length ? errs.filter((e) => e > 0).length / errs.length : null };
  }

  // ---- 11. Context: when is your AP best? ---------------------------------------------
  {
    const sessOf = new Map(sessions.map((s) => [s.id, s]));
    const graded = T.filter((t) => typeof t.correct === "boolean");
    const groupBy = (keyFn) => { const m = new Map(); graded.forEach((t) => { const k = keyFn(t); if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }); return [...m.entries()].map(([k, g]) => ({ key: k, ...prop(g) })).sort((a, b) => String(a.key).localeCompare(String(b.key))); };
    const bucket = (h) => (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");
    const pos = graded.map((t) => { const g = (bySess.get(t.sessionId) || []).filter((x) => typeof x.correct === "boolean"); return { t, half: g.indexOf(t) < g.length / 2 ? "first" : "second" }; });
    out.context = {
      timeOfDay: groupBy((t) => bucket(t.hour)),
      energy: groupBy((t) => { const s = sessOf.get(t.sessionId); return s && s.checkin ? s.checkin.energy : null; }),
      musicToday: groupBy((t) => { const s = sessOf.get(t.sessionId); return s && s.checkin ? s.checkin.music : null; }),
      warmup: ["first", "second"].map((h) => ({ half: h, ...prop(pos.filter((x) => x.half === h).map((x) => x.t)) })),
    };
  }
  return out;
}

// =============================================================================
// ADAPTIVE PLAN — the "living" part
// =============================================================================
export const LEVEL_MAX = 5;
const HOLD_RANGE = [[2, 7], [3, 9], [4, 12], [5, 15], [6, 18]];                      // seconds of hush
const ANCHOR_OFFS = [[3, 4, 5, 7, 8, 9], [2, 3, 5, 7, 10], [1, 2, 3, 5, 7, 10, 11], [1, 2, 10, 11], [1, 11, 1, 11, 2, 10]];
const NAME_OCTS = [[4], [3, 4], [3, 4, 5], [2, 3, 4, 5], [2, 3, 4, 5, 6]];
const TWIN_OFFS = [[5, 6, 7], [3, 4, 5, 6, 7], [2, 3, 4, 5, 9, 10], [1, 2, 3, 9, 10, 11], [1, 11, 1, 11, 2, 10]];

// Replay completed sessions in order: a station's level goes up after a session
// at ≥80% and down after ≤50% (min 3 graded trials). Deterministic from history,
// so there's no separate state to corrupt.
export function stationLevels(sessions = []) {
  const L = Object.fromEntries(STATIONS_GRADED.map((s) => [s, 1]));
  sessions.filter((s) => s.completed && s.summary).sort((a, b) => a.startedAt - b.startedAt).forEach((s) => {
    STATIONS_GRADED.forEach((st) => {
      const r = s.summary[st]; if (!r || r.n < 3) return;
      const a = r.k / r.n;
      if (a >= 0.8) L[st] = Math.min(LEVEL_MAX, L[st] + 1);
      else if (a <= 0.5) L[st] = Math.max(1, L[st] - 1);
    });
  });
  return L;
}

export function makePlan({ sessions = [], trials = [] } = {}) {
  const L = stationLevels(sessions);
  // Weak notes get sampled more (Beta(1,1)-smoothed error rate over recent naming).
  const recent = trials.filter((t) => t.station === "name" && typeof t.correct === "boolean").slice(-150);
  const pcWeights = PC.map((_, pc) => {
    const g = recent.filter((t) => t.stim.pc === pc), k = g.filter((t) => t.correct).length;
    return 0.6 + 1.8 * (1 - (k + 1) / (g.length + 2));
  });
  // Budget: weakest station (last 3 sessions) +2 trials, strongest −1.
  const counts = { imagine: 3, anchor: 5, hold: 4, name: 6, twins: 4, triad: 5, lockin: 3 };
  const last3 = sessions.filter((s) => s.completed && s.summary).slice(-3);
  const accOf = (st) => { let n = 0, k = 0; last3.forEach((s) => { const r = s.summary[st]; if (r) { n += r.n; k += r.k; } }); return n >= 4 ? k / n : null; };
  const ranked = ["anchor", "hold", "name", "twins", "triad"].map((st) => [st, accOf(st)]).filter(([, a]) => a != null).sort((x, y) => x[1] - y[1]);
  let focus = null;
  if (ranked.length >= 3) {
    focus = ranked[0][0]; counts[focus] += 2;
    const top = ranked[ranked.length - 1][0]; counts[top] = Math.max(3, counts[top] - 1);
  }
  const [h0, h1] = HOLD_RANGE[L.hold - 1];
  const holdDurs = Array.from({ length: counts.hold }, (_, i) => Math.round(h0 + ((h1 - h0) * i) / Math.max(1, counts.hold - 1)));
  return {
    version: 1, levels: L, focus, counts, pcWeights,
    imagineSecs: [8, 7, 6, 5, 4][L.imagine - 1],
    holdDurs,
    anchorOffsets: ANCHOR_OFFS[L.anchor - 1],
    anchorOctaves: L.anchor >= 3 ? [3, 4, 5] : [4],
    nameOctaves: NAME_OCTS[L.name - 1],
    // Diagnostic contrasts are held CONSTANT across levels so the indices stay comparable over weeks.
    nameNoWashFrac: 0.3, nameSineFrac: 0.2,
    twinOffsets: TWIN_OFFS[L.twins - 1],
    triad: { firstInv: L.triad >= 2, secondInv: L.triad >= 3, dimAug: L.triad >= 4, spread: L.triad >= 5 },
  };
}

// Weighted pick of k distinct pitch classes.
export function weightedPick(weights, k = 1, rnd = Math.random) {
  const out = [], w = [...weights];
  for (let i = 0; i < k; i++) {
    const tot = w.reduce((s, x) => s + x, 0); let r = rnd() * tot, j = 0;
    while (j < 11 && r >= w[j]) { r -= w[j]; j++; }
    out.push(j); w[j] = 0;
  }
  return out;
}
