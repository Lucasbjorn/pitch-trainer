// calibrate-data.js — the data spine of Daily Calibration + the training drills.
// (suggestDrills() is the rule-based coach behind the Training Hub.)
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

export const SCHEMA_VERSION = 2;   // record shape (v2 adds mode, protocol, localDate, sessionOfDay)
export const PROTOCOL = 2;         // calibration protocol: v1 = first week, v2 = harder hold/anchor + song anchors
export const SKILLS = ["cue", "name", "imagine", "anchor", "hold", "twins", "triad", "tune"];
export const SKILL_TITLE = { cue: "Song anchors", name: "Blindfold naming", imagine: "Imagine & sing", anchor: "Anchor lock", hold: "Hold it", twins: "Octave twins", triad: "Find the note", tune: "In tune?" };
export const STATIONS_GRADED = SKILLS;
export const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const kindOf = (s) => s.kind || "calibration";      // v1 sessions were all calibrations
const modeOf = (t) => t.mode || "calibration";
const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DB_NAME = "pitches-calibration", DB_VER = 1, LS_KEY = "pt.cal.data", SYNC_KEY = "pt.cal.syncedThrough", PULL_KEY = "pt.cal.pulledThrough";

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

// Many records in one transaction (used when pulling a device's backlog).
async function putMany(store, objs) {
  if (!objs.length) return;
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite"), os = tx.objectStore(store);
      objs.forEach((o) => os.put(o));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  } catch (_) { const d = lsLoad(); objs.forEach((o) => { d[store][o.id] = o; }); lsSave(d); }
}

// ---- device identity (sessions are tagged, so analysis can compare phone vs laptop) ----
export function deviceInfo() {
  let id = null;
  try { id = localStorage.getItem("pt.cal.device"); if (!id) { id = `dev-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem("pt.cal.device", id); } } catch (_) {}
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return { id, kind: /iPhone|iPad|iPod|Android|Mobi/i.test(ua) ? "phone" : "desktop" };
}

// =============================================================================
// SYNC — account-based, two-way (phone ↔ laptop). Backend injected via setCloud:
//   upload(rows) → bool · download(since) → { rows:[{kind,data,updated_at}], maxAt }
// • push: this device's own records changed since the last push (by record time)
// • pull: everything the SERVER touched since our last pull (server clock), merged
//   into local storage tagged _pulled — pulled records are never pushed back, so
//   two devices can't ping-pong the same rows forever.
// =============================================================================
let cloud = { upload: null, download: null, status: null };
export function setCloud(c) { cloud = { ...cloud, ...c }; }
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export async function syncCloud() {           // push
  if (!cloud.upload) return { ok: false, reason: "no backend" };
  const since = +(lsGet(SYNC_KEY) || 0);
  const { sessions, trials } = await allData();
  const rows = [
    ...sessions.map((s) => ({ kind: "session", obj: s, t: s.updatedAt || s.startedAt })),
    ...trials.map((t) => ({ kind: "trial", obj: t, t: t.t })),
  ].filter((r) => r.t > since && !r.obj._pulled).sort((a, b) => a.t - b.t);
  if (!rows.length) return { ok: true, n: 0 };
  let maxT = since;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    let ok = false;
    try { ok = await cloud.upload(batch); } catch (_) {}
    if (!ok) return { ok: false, n: i, reason: "upload failed (signed in? table created?)" };
    maxT = Math.max(maxT, batch[batch.length - 1].t);
    lsSet(SYNC_KEY, String(maxT));
  }
  return { ok: true, n: rows.length };
}

export async function pullCloud() {
  if (!cloud.download) return { ok: false, reason: "no backend" };
  let res = null;
  try { res = await cloud.download(lsGet(PULL_KEY) || null); } catch (_) {}
  if (!res || !Array.isArray(res.rows)) return { ok: false, reason: "download failed (signed in? table created?)" };
  const { sessions, trials } = await allData();
  const S = new Map(sessions.map((x) => [x.id, x])), T = new Set(trials.map((x) => x.id));
  const newS = [], newT = [];
  res.rows.forEach((r) => {
    const o = r.data; if (!o || !o.id) return;
    if (r.kind === "session") {
      const cur = S.get(o.id);
      if (cur && !cur._pulled) return;                                  // this device's own session: local is the truth
      if (!cur || (o.updatedAt || 0) > (cur.updatedAt || 0)) newS.push({ ...o, _pulled: true });
    } else if (!T.has(o.id)) { newT.push({ ...o, _pulled: true }); T.add(o.id); }
  });
  await putMany("sessions", newS);
  await putMany("trials", newT);
  if (res.maxAt) lsSet(PULL_KEY, res.maxAt);
  return { ok: true, n: newS.length + newT.length };
}

// Pull then push. Never throws.
export async function syncAll() {
  const pull = await pullCloud().catch(() => ({ ok: false, reason: "pull error" }));
  const push = await syncCloud().catch(() => ({ ok: false, reason: "push error" }));
  return { ok: pull.ok && push.ok, pulled: pull.n || 0, pushed: push.n || 0, reason: (!pull.ok && pull.reason) || (!push.ok && push.reason) || null };
}
export async function cloudStatus() {
  if (!cloud.status) return { configured: false };
  try { return await cloud.status(); } catch (_) { return { configured: false }; }
}

// ---- export ------------------------------------------------------------------
const clean = (o) => { const { _pulled, ...rest } = o; return rest; };
export async function exportBundle({ includeCloud = true } = {}) {
  let pulled = 0;
  if (includeCloud && cloud.download) { const r = await pullCloud().catch(() => null); pulled = (r && r.n) || 0; }
  const { sessions, trials } = await allData();
  return {
    app: "pitches-daily-calibration", schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(), tzOffsetMin: new Date().getTimezoneOffset(), pulledFromCloud: pulled,
    sessions: sessions.map(clean), trials: trials.map(clean), analysis: analyze({ sessions, trials }),
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
// Handles protocol v1 (first week) and v2 records side by side.
const graded = (t) => typeof t.correct === "boolean";
const anchorOffCents = (t) => (t.stim.offsetCents != null ? t.stim.offsetCents : (t.stim.offset || 0) * 100);
const centsDist = (c) => { const m = ((c % 1200) + 1200) % 1200; return Math.min(m, 1200 - m); };
const holdCents = (t) => (t.stim.probeCents != null ? Math.abs(t.stim.probeCents) : Math.abs(t.stim.probeOffset || 0) * 100);

export function analyze({ sessions = [], trials = [] } = {}) {
  const T = trials.filter((t) => !t.practice);
  const by = (st) => T.filter((t) => t.station === st);
  const name = by("name");
  const nameClean = name.filter((t) => t.stim && t.stim.wash !== false && t.stim.timbre !== "sine"); // canonical condition
  const out = {
    generatedAt: new Date().toISOString(),
    nSessions: sessions.filter((s) => kindOf(s) === "calibration").length,
    nDrills: sessions.filter((s) => kindOf(s) === "drill").length,
    nTrials: T.length, indices: {},
  };

  // ---- sessions, days, and the daily "cold reading" ---------------------------------
  // Several runs a day are common, so progress is tracked per DAY on the first
  // completed calibration (cold, unpracticed); later runs count as practice.
  const bySess = new Map();
  T.forEach((t) => { if (!bySess.has(t.sessionId)) bySess.set(t.sessionId, []); bySess.get(t.sessionId).push(t); });
  out.timeline = sessions.map((s) => {
    const ts = bySess.get(s.id) || [];
    const all = prop(ts), nm = prop(ts.filter((t) => t.station === "name"));
    return { id: s.id, kind: kindOf(s), skill: s.skill || null, date: s.localDate || localDate(s.startedAt), protocol: s.protocol || 1,
      sessionOfDay: s.sessionOfDay || null, completed: !!s.completed, acc: all.acc, n: all.n, nameAcc: nm.acc, nameN: nm.n,
      checkin: s.checkin || null, durSec: s.durSec || null, levels: s.plan ? s.plan.levels : null };
  });
  const days = new Map();
  out.timeline.forEach((x) => { if (!days.has(x.date)) days.set(x.date, []); days.get(x.date).push(x); });
  out.daily = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, xs]) => {
    const cals = xs.filter((x) => x.kind === "calibration" && x.completed);
    const dayTrials = T.filter((t) => localDate(t.t) === date);
    return { date, calRuns: cals.length, drillRuns: xs.filter((x) => x.kind === "drill").length,
      cold: cals.length ? cals[0].acc : null, coldName: cals.length ? cals[0].nameAcc : null,
      all: prop(dayTrials).acc, nTrials: dayTrials.length };
  });
  const td = out.daily.filter((d) => d.cold != null);
  const tr = ols(td.map((_, i) => i), td.map((d) => d.cold));
  out.trend = { daysUsed: td.length, coldSlopePerDay: tr.slope, r: tr.r };

  out.stations = {};
  SKILLS.forEach((st) => { out.stations[st] = prop(by(st)); });

  // ---- pitch map (naming, all conditions/modes) -----------------------------------
  out.pcMap = PC.map((nm, pc) => {
    const g = name.filter((t) => t.stim.pc === pc), p = prop(g);
    return { pc, name: nm, ...p, medRt: median(g.filter((t) => t.correct).map((t) => t.rt).filter(Number.isFinite)) };
  });

  // ---- 1. Relative-pitch leak: accuracy WITHOUT vs WITH the atonal cleanser -------------
  {
    const piano = name.filter((t) => t.stim.timbre !== "sine");
    const noWash = prop(piano.filter((t) => t.stim.wash === false)), wash = prop(piano.filter((t) => t.stim.wash !== false));
    const ci = diffCI(noWash, wash);
    const wrong = name.filter((t) => t.correct === false && Number.isFinite(t.stim.prevPc));
    const persev = wrong.length ? wrong.filter((t) => t.resp === t.stim.prevPc).length / wrong.length : null;
    out.indices.rpLeak = { noWash, wash, diff: ci ? ci.d : null, ci, perseveration: persev, nWrong: wrong.length,
      enough: noWash.n >= 8 && wash.n >= 15 };
  }

  // ---- 2. Hidden anchor: does RT grow with distance from some note? ------------------
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

  // ---- 3. Gut vs compute ---------------------------------------------------------------
  {
    const g = nameClean.filter((t) => graded(t) && Number.isFinite(t.rt));
    const rc = g.filter((t) => t.correct).map((t) => t.rt), rw = g.filter((t) => !t.correct).map((t) => t.rt);
    out.indices.gut = { n: g.length, medRtCorrect: median(rc), medRtWrong: median(rw),
      fastCorrectRate: g.length ? g.filter((t) => t.correct && t.rt < 1500).length / g.length : null };
  }

  // ---- 4. Timbre lock: piano vs pure sine ----------------------------------------------
  {
    const w = name.filter((t) => t.stim.wash !== false);
    const piano = prop(w.filter((t) => t.stim.timbre !== "sine")), sine = prop(w.filter((t) => t.stim.timbre === "sine"));
    out.indices.timbre = { piano, sine, diff: diffCI(piano, sine), enough: sine.n >= 8 && piano.n >= 15 };
  }

  // ---- 5. Register dependence ------------------------------------------------------------
  {
    const octs = [...new Set(nameClean.map((t) => t.stim.oct))].sort();
    const rows = octs.map((o) => ({ oct: o, ...prop(nameClean.filter((t) => t.stim.oct === o)) })).filter((r) => r.n >= 5);
    const accs = rows.map((r) => r.acc);
    out.indices.register = { byOct: rows, spread: accs.length >= 2 ? Math.max(...accs) - Math.min(...accs) : null };
  }

  // ---- 6. Chroma vs height (octave twins) ----------------------------------------------
  {
    const tw = by("twins");
    const offs = [...new Set(tw.map((t) => cdist(0, t.stim.offset)))].sort((a, b) => a - b);
    out.indices.chroma = { ...prop(tw), byOffset: offs.map((d) => ({ semis: d, ...prop(tw.filter((t) => cdist(0, t.stim.offset) === d)) })) };
  }

  // ---- 7. Pitch memory (hold it): decay + TONE-interference cost ------------------------
  //  Intervening tones wreck an echoic trace but not a labeled one, so the
  //  noise-vs-tones gap says whether you're holding the SOUND or the NAME.
  {
    const h = by("hold").filter(graded);
    const intf = (t) => t.stim.interference || "noise";
    const durs = [...new Set(h.map((t) => t.stim.dur))].sort((a, b) => a - b);
    const f = ols(h.map((t) => t.stim.dur), h.map((t) => (t.correct ? 1 : 0)));
    const noise = prop(h.filter((t) => intf(t) === "noise")), tones = prop(h.filter((t) => intf(t) === "tones"));
    const cents = [...new Set(h.filter((t) => !t.stim.same).map(holdCents))].sort((a, b) => a - b);
    out.indices.hold = { n: h.length, byDur: durs.map((d) => ({ dur: d, ...prop(h.filter((t) => t.stim.dur === d)) })), accPerSecond: f.slope,
      noise, tones, toneCost: diffCI(noise, tones), enoughCost: noise.n >= 8 && tones.n >= 8,
      byCents: cents.map((c) => ({ cents: c, ...prop(h.filter((t) => !t.stim.same && holdCents(t) === c)) })) };
  }

  // ---- 8. Inner pitch (sung production) ----------------------------------------------------
  {
    const s = by("imagine").filter((t) => t.sing && t.sing.ok && Number.isFinite(t.sing.cents));
    const c = s.map((t) => t.sing.cents);
    const self = by("imagine").filter((t) => t.resp === "nailed" || t.resp === "off");
    out.indices.imagery = { nSung: s.length, meanBiasCents: mean(c), meanAbsCents: mean(c.map(Math.abs)),
      within50: s.length ? c.filter((x) => Math.abs(x) <= 50).length / s.length : null,
      octaveSung: median(s.map((t) => t.sing.oct)), selfNailedRate: self.length ? self.filter((t) => t.resp === "nailed").length / self.length : null, nSelf: self.length };
  }

  // ---- 9. Anchor precision: hit rate + false alarms by lure distance (cents) ----------------
  {
    const a = by("anchor").filter(graded);
    const hits = prop(a.filter((t) => t.stim.isAnchor));
    const lures = a.filter((t) => !t.stim.isAnchor);
    const ds = [...new Set(lures.map((t) => centsDist(anchorOffCents(t))))].sort((x, y) => x - y);
    out.indices.anchorLock = { hitRate: hits.acc, nHits: hits.n,
      falseAlarmsByCents: ds.map((d) => { const g = lures.filter((t) => centsDist(anchorOffCents(t)) === d); return { cents: d, n: g.length, faRate: g.length ? g.filter((t) => t.resp === "yes").length / g.length : null }; }) };
  }

  // ---- 10. Song anchors (PP-MIDI association) -------------------------------------------
  {
    const cu = by("cue");
    out.indices.song = { ...prop(cu), cueToNote: prop(cu.filter((t) => t.stim.kind === "cue2note")), noteToCue: prop(cu.filter((t) => t.stim.kind === "note2cue")),
      byPc: PC.map((nm, pc) => ({ name: nm, ...prop(cu.filter((t) => t.stim.pc === pc)) })) };
  }

  // ---- 11. In tune? (categorical tuning template) -------------------------------------------
  {
    const tu = by("tune").filter(graded);
    const off = tu.filter((t) => !t.stim.inTune);
    const cs = [...new Set(off.map((t) => Math.abs(t.stim.cents)))].sort((a, b) => a - b);
    out.indices.tune = { ...prop(tu), inTune: prop(tu.filter((t) => t.stim.inTune)), detuned: prop(off),
      byCents: cs.map((c) => ({ cents: c, ...prop(off.filter((t) => Math.abs(t.stim.cents) === c)) })) };
  }

  // ---- 12. Confusions + systematic shift ---------------------------------------------------
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

  // ---- 13. Context: when is your AP best? ---------------------------------------------------
  {
    const sessOf = new Map(sessions.map((s) => [s.id, s]));
    const G = T.filter(graded);
    const groupBy = (keyFn) => { const m = new Map(); G.forEach((t) => { const k = keyFn(t); if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }); return [...m.entries()].map(([k, g]) => ({ key: k, ...prop(g) })).sort((a, b) => String(a.key).localeCompare(String(b.key))); };
    const bucket = (h) => (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");
    const pos = G.map((t) => { const g = (bySess.get(t.sessionId) || []).filter(graded); return { t, half: g.indexOf(t) < g.length / 2 ? "first" : "second" }; });
    const sAttr = (t, f) => { const s = sessOf.get(t.sessionId); return s ? f(s) : null; };
    out.context = {
      timeOfDay: groupBy((t) => bucket(t.hour)),
      energy: groupBy((t) => sAttr(t, (s) => (s.checkin ? s.checkin.energy : null))),
      musicToday: groupBy((t) => sAttr(t, (s) => (s.checkin ? s.checkin.music : null))),
      runOfDay: groupBy((t) => sAttr(t, (s) => (kindOf(s) === "calibration" && s.sessionOfDay ? (s.sessionOfDay === 1 ? "1st run" : "2nd+ run") : null))),
      mode: groupBy((t) => modeOf(t)),
      device: groupBy((t) => sAttr(t, (s) => (s.device ? s.device.kind : null))),
      warmup: ["first", "second"].map((h) => ({ half: h, ...prop(pos.filter((x) => x.half === h).map((x) => x.t)) })),
    };
  }
  return out;
}

// =============================================================================
// PARAMETERS + ADAPTIVE PLAN — the "living" part (protocol v2)
// =============================================================================
export const LEVEL_MAX = 5;
const lvlIdx = (L) => Math.max(1, Math.min(LEVEL_MAX, Math.round(L) || 1)) - 1;

// One table drives both the daily calibration and the drills.
export function paramsFor(skill, L) {
  const l = lvlIdx(L);
  switch (skill) {
    case "cue": return { choices: [4, 6, 12, 12, 12][l], mixBare: l >= 1, cleanse: l >= 2 };
    case "imagine": return { secs: [8, 7, 6, 5, 4][l] };
    case "anchor": return { lures: [[-300, -200, -100, 100, 200, 300, 500, 700], [-200, -100, 100, 200], [-200, -100, -100, 100, 100, 200], [-100, -50, 50, 100], [-50, -30, 30, 50]][l], octaves: l >= 2 ? [3, 4, 5] : [4] };
    case "name": return { octaves: [[4], [3, 4], [3, 4, 5], [2, 3, 4, 5], [2, 3, 4, 5, 6]][l], noWashFrac: 0.3, sineFrac: 0.2 };
    case "hold": return { range: [[3, 6], [4, 8], [5, 10], [6, 13], [8, 16]][l], cents: [60, 45, 30, 20, 12][l], tonesFrac: 0.5, distractors: [3, 4, 5, 6, 7][l] };
    case "twins": return { offsets: [[3, 4, 5, 6, 7, 8, 9], [2, 3, 4, 5, 9, 10], [1, 2, 3, 9, 10, 11], [1, 2, 10, 11], [1, 11]][l] };
    case "triad": return { firstInv: l >= 1, secondInv: l >= 2, dimAug: l >= 3, spread: l >= 4 };
    case "tune": return { cents: [50, 35, 25, 15, 10][l] };
    default: return {};
  }
}

// Calibration levels from history. Runs are pooled PER DAY and a station moves
// at most one step per day (≥80% up, ≤50% down, min 3 graded trials), so doing
// the calibration three times in an afternoon can't fake three days of progress.
export function stationLevels(sessions = []) {
  const L = Object.fromEntries(SKILLS.map((s) => [s, 1]));
  const days = new Map();
  sessions.filter((s) => kindOf(s) === "calibration" && s.completed && s.summary).forEach((s) => {
    const d = s.localDate || localDate(s.startedAt);
    if (!days.has(d)) days.set(d, {});
    const agg = days.get(d);
    Object.entries(s.summary).forEach(([st, r]) => { if (!agg[st]) agg[st] = { n: 0, k: 0 }; agg[st].n += r.n; agg[st].k += r.k; });
  });
  [...days.keys()].sort().forEach((d) => {
    const agg = days.get(d);
    SKILLS.forEach((st) => {
      const r = agg[st]; if (!r || r.n < 3) return;
      const a = r.k / r.n;
      if (a >= 0.8) L[st] = Math.min(LEVEL_MAX, L[st] + 1);
      else if (a <= 0.5) L[st] = Math.max(1, L[st] - 1);
    });
  });
  return L;
}

// Per-note weights: Beta(1,1)-smoothed error rate over recent pitch-naming
// (blindfold naming + song anchors). Weak notes come up more.
export function noteWeights(trials = []) {
  const recent = trials.filter((t) => (t.station === "name" || t.station === "cue") && graded(t) && t.stim && Number.isFinite(t.stim.pc)).slice(-200);
  return PC.map((_, pc) => {
    const g = recent.filter((t) => t.stim.pc === pc), k = g.filter((t) => t.correct).length;
    return 0.6 + 1.8 * (1 - (k + 1) / (g.length + 2));
  });
}

export function makePlan({ sessions = [], trials = [] } = {}) {
  const L = stationLevels(sessions);
  const pcWeights = noteWeights(trials);
  const counts = { cue: 4, imagine: 3, anchor: 5, name: 6, hold: 4, twins: 4, triad: 4, lockin: 2 };
  const last3 = sessions.filter((s) => kindOf(s) === "calibration" && s.completed && s.summary).slice(-3);
  const accOf = (st) => { let n = 0, k = 0; last3.forEach((s) => { const r = s.summary[st]; if (r) { n += r.n; k += r.k; } }); return n >= 4 ? k / n : null; };
  const ranked = ["cue", "anchor", "hold", "name", "twins", "triad"].map((st) => [st, accOf(st)]).filter(([, a]) => a != null).sort((x, y) => x[1] - y[1]);
  let focus = null;
  if (ranked.length >= 3) {
    focus = ranked[0][0]; counts[focus] += 2;
    const top = ranked[ranked.length - 1][0]; counts[top] = Math.max(3, counts[top] - 1);
  }
  const params = Object.fromEntries(SKILLS.map((s) => [s, paramsFor(s, L[s])]));
  const [h0, h1] = params.hold.range;
  const holdDurs = Array.from({ length: counts.hold }, (_, i) => Math.round(h0 + ((h1 - h0) * i) / Math.max(1, counts.hold - 1)));
  const order = pcWeights.map((w, pc) => [w, pc]).sort((a, b) => b[0] - a[0]).map(([, pc]) => pc);
  return { protocol: PROTOCOL, levels: L, focus, counts, pcWeights, params, holdDurs, cueLearn: order.slice(0, 2) };
}

// ---- the coach: which drill next, and why ------------------------------------------
const DAY = 86400000;
export function suggestDrills(data = {}, now = Date.now()) {
  const { sessions = [], trials = [] } = data;
  const today = localDate(now);
  const calToday = sessions.some((s) => kindOf(s) === "calibration" && s.completed && (s.localDate || localDate(s.startedAt)) === today);
  const recent = trials.filter((t) => t.t >= now - 3 * DAY && graded(t));
  const a = analyze(data), I = a.indices;
  const weak = a.pcMap.filter((p) => p.n >= 3 && p.acc < 0.75).sort((x, y) => x.acc - y.acc).slice(0, 3).map((p) => p.name);
  const drillSess = sessions.filter((s) => kindOf(s) === "drill");
  const ranked = SKILLS.map((sk) => {
    const g = prop(recent.filter((t) => t.station === sk));
    let score = g.n >= 4 ? 1 - g.acc : 0.45;
    let reason = g.n >= 4 ? `${Math.round(g.acc * 100)}% over the last 3 days` : "not much data on this yet";
    const flag = (bonus, why) => { score += bonus; reason = why; };
    const last = Math.max(0, ...drillSess.filter((s) => s.skill === sk).map((s) => s.endedAt || s.startedAt));
    if (!last || now - last > 2 * DAY) score += 0.15;
    if (last && now - last < 20 * 60000) score -= 0.3;                                   // variety: just did it
    if (drillSess.some((s) => s.skill === sk && (s.events || []).some((e) => e.type === "tooEasy" && now - e.t < DAY))) score -= 0.35;
    if (sk === "cue") { score += 0.1; if (weak.length) flag(0.15, `your shakiest notes are ${weak.join(", ")} — drill their song tags`); }
    if (sk === "name") {
      const rp = I.rpLeak, an = I.anchor, tb = I.timbre;
      if (tb.enough && tb.diff && tb.diff.lo > 0.1) flag(0.15, "pure tones trip you up — naming mixes them in");
      if (an.verdict === "counting-from-anchor") flag(0.2, `you seem to count up from ${an.anchorName} — drill direct naming`);
      if (rp.enough && rp.ci && rp.ci.lo > 0.05) flag(0.35, "you name better right after hearing a labeled note — train without that crutch");
    }
    if (sk === "hold" && I.hold.enoughCost && I.hold.toneCost && I.hold.toneCost.d > 0.2) flag(0.2, "notes in between knock the pitch out of memory — practice holding it by name");
    return { skill: sk, title: SKILL_TITLE[sk], score: Math.round(score * 100) / 100, reason };
  }).sort((x, y) => y.score - x.score);
  return { calibrateFirst: !calToday, ranked };
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
