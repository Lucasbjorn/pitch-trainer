// Testing Battery — core infrastructure.
//
//   • Seeded PRNG so every session is reproducible from its seed alone.
//   • Balanced / stratified sampling helpers, so difficulty is equated across
//     sessions instead of being left to chance.
//   • ZEST: Bayesian adaptive threshold estimation.
//   • IndexedDB store with trial-level granularity, plus CSV/JSON export.

export const BATTERY_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for stimulus generation. */
export function makeRng(seed) {
  let a = (typeof seed === "string" ? hashStr(seed) : seed) >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.logRange = (lo, hi) => lo * Math.pow(hi / lo, rng());
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  rng.bool = () => rng() < 0.5;
  return rng;
}

export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle, then repair runs where consecutive items share a key. Used so the
 * same pitch class never appears twice in a row (which would hand him a free
 * comparison) while keeping the overall distribution exactly balanced.
 */
export function shuffleNoRepeat(arr, keyFn, rng, tries = 200) {
  for (let t = 0; t < tries; t++) {
    const a = shuffled(arr, rng);
    let ok = true;
    for (let i = 1; i < a.length; i++) if (keyFn(a[i]) === keyFn(a[i - 1])) { ok = false; break; }
    if (ok) return a;
  }
  return shuffled(arr, rng);
}

export function uid() {
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${r()}${r()}-${r()}-${r()}-${r()}-${r()}${r()}${r()}`;
}

// ---------------------------------------------------------------------------
// ZEST — Bayesian adaptive threshold estimation
//
// Maintains a posterior over log10(threshold) on a fixed grid. Places the next
// stimulus at the posterior mean and reports the posterior mean as the estimate.
// Reaches a given precision in roughly half the trials a 2-down-1-up staircase
// needs, which is what makes a 7-module battery fit inside 30 minutes.
//
// Psychometric function: Weibull on the stimulus magnitude,
//     P(correct | x) = g + (1 - g - lapse) * (1 - exp(-(x/T)^beta))
// With g = 0.5 the threshold parameter T sits at ~80% correct.
//
// Anchor trials at fixed levels are folded into the same posterior — a Bayesian
// update is valid at any stimulus level — but are flagged in the trial log so a
// model-free accuracy-at-fixed-difficulty analysis is still possible offline.
// ---------------------------------------------------------------------------
export function makeZest({
  min, max, gridN = 80, beta = 2.0, guess = 0.5, lapse = 0.02,
  priorMode = null, priorSdLog = 0.55, jitter = 0.08,
}) {
  const lo = Math.log10(min), hi = Math.log10(max);
  const grid = Array.from({ length: gridN }, (_, i) => lo + ((hi - lo) * i) / (gridN - 1));
  const mode = Math.log10(priorMode != null ? priorMode : Math.sqrt(min * max));
  let post = grid.map((t) => Math.exp(-0.5 * Math.pow((t - mode) / priorSdLog, 2)));
  const hist = [];
  norm();

  function norm() { const s = post.reduce((a, b) => a + b, 0) || 1; post = post.map((p) => p / s); }
  function pCorrect(x, tLog) {
    const T = Math.pow(10, tLog);
    return guess + (1 - guess - lapse) * (1 - Math.exp(-Math.pow(x / T, beta)));
  }
  function meanLog() { return grid.reduce((a, t, i) => a + t * post[i], 0); }
  function sdLog() {
    const m = meanLog();
    return Math.sqrt(grid.reduce((a, t, i) => a + post[i] * (t - m) * (t - m), 0));
  }
  function clamp(x) { return Math.min(max, Math.max(min, x)); }

  return {
    /** Next stimulus magnitude: posterior mean, with a little jitter so the
     *  sequence never becomes predictable enough to respond to by rhythm. */
    next(rng) {
      const j = jitter ? (rng ? rng() : Math.random()) * 2 * jitter - jitter : 0;
      return clamp(Math.pow(10, meanLog() + j));
    },
    update(x, correct) {
      for (let i = 0; i < grid.length; i++) {
        const p = pCorrect(x, grid[i]);
        post[i] *= correct ? p : 1 - p;
      }
      norm();
      hist.push({ x, correct, mean: Math.pow(10, meanLog()), sd_log10: sdLog() });
    },
    estimate() { return Math.pow(10, meanLog()); },
    sdLog10() { return sdLog(); },
    /** 68% credible interval in stimulus units — a usable error bar for graphs. */
    ci68() {
      const m = meanLog(), s = sdLog();
      return [Math.pow(10, m - s), Math.pow(10, m + s)];
    },
    state() { return { mean: Math.pow(10, meanLog()), sd_log10: sdLog(), n: hist.length }; },
    history() { return hist.slice(); },
    serialize() { return { post: post.slice(), hist: hist.slice() }; },
    restore(s) { if (s && s.post && s.post.length === grid.length) { post = s.post.slice(); hist.length = 0; hist.push(...(s.hist || [])); } },
    params: { min, max, beta, guess, lapse, gridN },
  };
}

// ---------------------------------------------------------------------------
// Signal-detection helpers (n-back scoring)
// ---------------------------------------------------------------------------
function invNorm(p) {
  // Acklam's inverse normal CDF approximation — plenty accurate for d'.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** d' with the loglinear correction, so perfect or zero scores stay finite. */
export function dPrime(hits, nSignal, fas, nNoise) {
  if (!nSignal || !nNoise) return null;
  const h = (hits + 0.5) / (nSignal + 1);
  const f = (fas + 0.5) / (nNoise + 1);
  return invNorm(h) - invNorm(f);
}
export function criterionC(hits, nSignal, fas, nNoise) {
  if (!nSignal || !nNoise) return null;
  const h = (hits + 0.5) / (nSignal + 1);
  const f = (fas + 0.5) / (nNoise + 1);
  return -0.5 * (invNorm(h) + invNorm(f));
}
export function median(xs) {
  const a = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function mean(xs) {
  const a = xs.filter((x) => typeof x === "number" && isFinite(x));
  return a.length ? a.reduce((p, q) => p + q, 0) / a.length : null;
}

// ---------------------------------------------------------------------------
// Storage — IndexedDB
//
// Trials are written one at a time, the moment they complete. A refresh, a
// crash or a closed lid costs at most the trial in progress.
// ---------------------------------------------------------------------------
const DB_NAME = "pt-battery";
const DB_VER = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "session_id" });
      }
      if (!db.objectStoreNames.contains("trials")) {
        const s = db.createObjectStore("trials", { keyPath: "trial_uid" });
        s.createIndex("by_session", "session_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/**
 * Ask the browser to exempt this origin from automatic storage eviction.
 * Chrome grants it silently for bookmarked / high-engagement sites. Worth
 * asking for: a 48-hour experiment cannot be re-run, and the default policy
 * lets a browser clear IndexedDB under disk pressure without warning.
 * Returns true (persisted), false (refused) or null (not supported).
 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (_) { return null; }
}

export async function storageEstimate() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage_bytes: e.usage ?? null, quota_bytes: e.quota ?? null };
  } catch (_) { return null; }
}

export const store = {
  putSession(sess) { return tx("sessions", "readwrite", (s) => s.put(sess)); },
  getSession(id) { return tx("sessions", "readonly", (s) => s.get(id)); },
  allSessions() {
    return tx("sessions", "readonly", (s) => s.getAll()).then((rows) =>
      (rows || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
  },
  putTrial(tr) { return tx("trials", "readwrite", (s) => s.put(tr)); },
  putTrials(list) { return tx("trials", "readwrite", (s) => { list.forEach((t) => s.put(t)); return null; }); },
  allTrials() {
    return tx("trials", "readonly", (s) => s.getAll()).then((rows) =>
      (rows || []).sort((a, b) => String(a.ts_trial_start).localeCompare(String(b.ts_trial_start))));
  },
  trialsFor(sessionId) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction("trials", "readonly");
      const idx = t.objectStore("trials").index("by_session");
      const req = idx.getAll(sessionId);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.global_index - b.global_index));
      req.onerror = () => reject(req.error);
    }));
  },
  async deleteSession(id) {
    const trials = await store.trialsFor(id);
    await tx("trials", "readwrite", (s) => { trials.forEach((tr) => s.delete(tr.trial_uid)); return null; });
    await tx("sessions", "readwrite", (s) => s.delete(id));
  },
  async clearAll() {
    await tx("trials", "readwrite", (s) => s.clear());
    await tx("sessions", "readwrite", (s) => s.clear());
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function csvCell(v) {
  if (v == null) return "";
  if (typeof v === "object") v = JSON.stringify(v);
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns = null) {
  if (!rows.length) return "";
  const cols = columns || [...rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set())];
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

/**
 * Flatten a trial for CSV. Nested stimulus parameters become stim_* columns,
 * and the untouched object is kept in stim_json so a trial can always be
 * reconstructed exactly, even if a future analysis wants a field we never
 * thought to break out into its own column.
 */
export function flattenTrial(t) {
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === "stim" || k === "adaptive" || k === "extra") continue;
    out[k] = v && typeof v === "object" ? JSON.stringify(v) : v;
  }
  for (const [k, v] of Object.entries(t.stim || {})) {
    out[`stim_${k}`] = v && typeof v === "object" ? JSON.stringify(v) : v;
  }
  for (const [k, v] of Object.entries(t.adaptive || {})) {
    out[`adapt_${k}`] = v && typeof v === "object" ? JSON.stringify(v) : v;
  }
  for (const [k, v] of Object.entries(t.extra || {})) {
    out[`x_${k}`] = v && typeof v === "object" ? JSON.stringify(v) : v;
  }
  out.stim_json = JSON.stringify(t.stim || {});
  return out;
}

export function flattenSession(s) {
  const out = {
    session_id: s.session_id, label: s.label, status: s.status,
    is_practice: s.is_practice ? 1 : 0,
    created_at: s.created_at, started_at: s.started_at, ended_at: s.ended_at,
    duration_min: s.started_at && s.ended_at
      ? +(((new Date(s.ended_at) - new Date(s.started_at)) / 60000).toFixed(2)) : null,
    seed: s.seed, battery_version: s.battery_version,
    n_trials: s.n_trials ?? null,
    modules_completed: (s.modules_completed || []).join("|"),
  };
  for (const [k, v] of Object.entries(s.meta || {})) out[`meta_${k}`] = v;
  for (const [k, v] of Object.entries(s.calibration || {})) out[`cal_${k}`] = v && typeof v === "object" ? JSON.stringify(v) : v;
  for (const [k, v] of Object.entries(s.env || {})) out[`env_${k}`] = v && typeof v === "object" ? JSON.stringify(v) : v;
  for (const [mod, sum] of Object.entries(s.summary || {})) {
    for (const [k, v] of Object.entries(sum || {})) {
      out[`sum_${mod}_${k}`] = v && typeof v === "object" ? JSON.stringify(v) : v;
    }
  }
  return out;
}

export function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function envInfo() {
  return {
    user_agent: navigator.userAgent,
    platform: navigator.platform || null,
    language: navigator.language,
    hardware_concurrency: navigator.hardwareConcurrency ?? null,
    device_memory: navigator.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height}`,
    dpr: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tz_offset_min: new Date().getTimezoneOffset(),
  };
}
