// Testing Battery — results dashboard.
//
// Deliberately walled off from the testing flow (typing "admin" on the battery
// home, or ?admin=1). Nothing here should ever be seen mid-experiment.
//
// Charts are hand-rolled inline SVG rather than a charting library: no network
// dependency during a 48-hour run, and full control over how it looks if a
// frame of it ends up in the video.

import { store } from "./battery-core.js";
import { MODULES, MODULE_BY_ID, PC_NAMES } from "./battery-tasks.js";

const C = {
  green: "#16a34a", blue: "#2563eb", magenta: "#c026d3", amber: "#f59e0b",
  red: "#ef4444", cyan: "#0891b2", slate: "#64748b",
};
const SERIES_COLORS = [C.green, C.blue, C.magenta, C.amber, C.cyan, C.red];

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v, d = 2) => (v == null || !isFinite(v) ? "—" : (+v).toFixed(d));

// ---------------------------------------------------------------------------
// SVG chart primitives
// ---------------------------------------------------------------------------
function niceScale(lo, hi) {
  if (!(isFinite(lo) && isFinite(hi))) return { lo: 0, hi: 1, ticks: [0, 0.5, 1] };
  if (lo === hi) { lo -= Math.abs(lo || 1) * 0.2; hi += Math.abs(hi || 1) * 0.2; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const span = hi - lo;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const mult = [1, 2, 2.5, 5, 10].find((m) => span / (step * m) <= 5) || 10;
  const s = step * mult;
  const t0 = Math.floor(lo / s) * s;
  const ticks = [];
  for (let t = t0; t <= hi + s * 0.5; t += s) ticks.push(+t.toFixed(10));
  return { lo: Math.min(lo, ticks[0]), hi: Math.max(hi, ticks[ticks.length - 1]), ticks };
}

/**
 * Multi-series line chart over sessions. Points may carry lo/hi for the
 * credible interval from the adaptive estimator — a threshold without its
 * uncertainty invites reading noise as signal.
 */
function lineChart({ series, xLabels, yLabel, lowerBetter = false, height = 260, yZero = false, pctAxis = false }) {
  const W = 720, H = height, L = 62, R = 18, T = 18, B = 58;
  const iw = W - L - R, ih = H - T - B;
  const all = series.flatMap((s) => s.points.flatMap((p) => [p.y, p.lo, p.hi].filter((v) => v != null && isFinite(v))));
  if (!all.length) return `<div class="rs-empty">No data yet.</div>`;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (yZero) lo = Math.min(0, lo);
  const sc = niceScale(lo, hi);
  const n = Math.max(1, xLabels.length - 1);
  const X = (i) => L + (xLabels.length === 1 ? iw / 2 : (i / n) * iw);
  const Y = (v) => T + ih - ((v - sc.lo) / (sc.hi - sc.lo)) * ih;

  const grid = sc.ticks.map((t) =>
    `<line x1="${L}" y1="${Y(t).toFixed(1)}" x2="${W - R}" y2="${Y(t).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>
     <text x="${L - 9}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end" class="rs-tick">${pctAxis ? Math.round(t * 100) + "%" : fmt(t, Math.abs(t) < 1 ? 2 : 1)}</text>`).join("");

  const xticks = xLabels.map((lb, i) =>
    `<text x="${X(i).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" class="rs-xtick">${esc(lb)}</text>`).join("");

  const body = series.map((s, si) => {
    const col = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
    const pts = s.points.map((p, i) => ({ ...p, i })).filter((p) => p.y != null && isFinite(p.y));
    if (!pts.length) return "";
    const path = pts.map((p, k) => `${k ? "L" : "M"}${X(p.i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
    const bars = pts.filter((p) => p.lo != null && p.hi != null && isFinite(p.lo) && isFinite(p.hi)).map((p) =>
      `<line x1="${X(p.i).toFixed(1)}" y1="${Y(p.lo).toFixed(1)}" x2="${X(p.i).toFixed(1)}" y2="${Y(p.hi).toFixed(1)}" stroke="${col}" stroke-width="1.5" opacity="0.45"/>
       <line x1="${(X(p.i) - 4).toFixed(1)}" y1="${Y(p.lo).toFixed(1)}" x2="${(X(p.i) + 4).toFixed(1)}" y2="${Y(p.lo).toFixed(1)}" stroke="${col}" stroke-width="1.5" opacity="0.45"/>
       <line x1="${(X(p.i) - 4).toFixed(1)}" y1="${Y(p.hi).toFixed(1)}" x2="${(X(p.i) + 4).toFixed(1)}" y2="${Y(p.hi).toFixed(1)}" stroke="${col}" stroke-width="1.5" opacity="0.45"/>`).join("");
    const dots = pts.map((p) =>
      `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="5" fill="#fff" stroke="${col}" stroke-width="2.5"><title>${esc(xLabels[p.i])}: ${fmt(p.y, 3)}</title></circle>`).join("");
    return `${bars}<path d="${path}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
  }).join("");

  const legend = series.length > 1 ? `<div class="rs-legend">${series.map((s, si) =>
    `<span><i style="background:${s.color || SERIES_COLORS[si % SERIES_COLORS.length]}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";

  return `
    <div class="rs-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
        ${grid}
        <line x1="${L}" y1="${T}" x2="${L}" y2="${T + ih}" stroke="#cbd5e1"/>
        <line x1="${L}" y1="${T + ih}" x2="${W - R}" y2="${T + ih}" stroke="#cbd5e1"/>
        ${body}${xticks}
        <text x="12" y="${T + ih / 2}" transform="rotate(-90 12 ${T + ih / 2})" text-anchor="middle" class="rs-ylabel">${esc(yLabel)}${lowerBetter ? "  (lower = better)" : ""}</text>
      </svg>
      ${legend}
    </div>`;
}

function barChart({ bars, yLabel, height = 240, pctAxis = false, color = C.green }) {
  const W = 720, H = height, L = 62, R = 18, T = 18, B = 58;
  const iw = W - L - R, ih = H - T - B;
  const vals = bars.map((b) => b.y).filter((v) => v != null && isFinite(v));
  if (!vals.length) return `<div class="rs-empty">No data yet.</div>`;
  const sc = niceScale(Math.min(0, ...vals), Math.max(...vals));
  const Y = (v) => T + ih - ((v - sc.lo) / (sc.hi - sc.lo)) * ih;
  const bw = iw / bars.length;
  const grid = sc.ticks.map((t) =>
    `<line x1="${L}" y1="${Y(t).toFixed(1)}" x2="${W - R}" y2="${Y(t).toFixed(1)}" stroke="#e2e8f0"/>
     <text x="${L - 9}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end" class="rs-tick">${pctAxis ? Math.round(t * 100) + "%" : fmt(t, Math.abs(t) < 1 ? 2 : 1)}</text>`).join("");
  const body = bars.map((b, i) => {
    if (b.y == null || !isFinite(b.y)) return "";
    const x = L + i * bw + bw * 0.16, w = bw * 0.68;
    const y0 = Y(Math.max(0, sc.lo)), y1 = Y(b.y);
    return `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" rx="3" fill="${b.color || color}" opacity="0.85"><title>${esc(b.label)}: ${fmt(b.y, 3)}</title></rect>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" class="rs-xtick">${esc(b.label)}</text>`;
  }).join("");
  return `<div class="rs-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${grid}<line x1="${L}" y1="${T}" x2="${L}" y2="${T + ih}" stroke="#cbd5e1"/>
    <line x1="${L}" y1="${Y(Math.max(0, sc.lo)).toFixed(1)}" x2="${W - R}" y2="${Y(Math.max(0, sc.lo)).toFixed(1)}" stroke="#cbd5e1"/>
    ${body}
    <text x="12" y="${T + ih / 2}" transform="rotate(-90 12 ${T + ih / 2})" text-anchor="middle" class="rs-ylabel">${esc(yLabel)}</text>
  </svg></div>`;
}

/** Confusion matrix: rows = note played, columns = note named. */
function confusionHeat(matrix, labels) {
  const cell = 34, pad = 42;
  const n = labels.length;
  const W = pad + n * cell + 10, H = pad + n * cell + 10;
  let maxOff = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (r !== c) maxOff = Math.max(maxOff, matrix[r][c]);
  let maxDiag = 0;
  for (let r = 0; r < n; r++) maxDiag = Math.max(maxDiag, matrix[r][r]);
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = matrix[r][c];
      const isDiag = r === c;
      const t = isDiag ? (maxDiag ? v / maxDiag : 0) : (maxOff ? v / maxOff : 0);
      const fill = v === 0 ? "#f1f5f9" : isDiag
        ? `rgba(22,163,74,${0.15 + 0.85 * t})`
        : `rgba(239,68,68,${0.12 + 0.7 * t})`;
      cells.push(`<rect x="${pad + c * cell}" y="${pad + r * cell}" width="${cell - 2}" height="${cell - 2}" rx="4" fill="${fill}"><title>played ${labels[r]} → said ${labels[c]}: ${v}</title></rect>${v ? `<text x="${pad + c * cell + (cell - 2) / 2}" y="${pad + r * cell + (cell - 2) / 2 + 4}" text-anchor="middle" class="rs-cellnum" fill="${t > 0.55 ? "#fff" : "#334155"}">${v}</text>` : ""}`);
    }
  }
  const rowLabels = labels.map((l, r) => `<text x="${pad - 8}" y="${pad + r * cell + cell / 2 + 2}" text-anchor="end" class="rs-tick">${l}</text>`).join("");
  const colLabels = labels.map((l, c) => `<text x="${pad + c * cell + (cell - 2) / 2}" y="${pad - 10}" text-anchor="middle" class="rs-tick">${l}</text>`).join("");
  return `<div class="rs-chart wide"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <text x="4" y="16" class="rs-tick">played ↓ / said →</text>
    ${rowLabels}${colLabels}${cells.join("")}
  </svg></div>`;
}

// ---------------------------------------------------------------------------
// Metric plumbing
// ---------------------------------------------------------------------------
const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

function seriesFrom(sessions, path, { lo = null, hi = null } = {}) {
  return sessions.map((s, i) => ({
    i,
    y: get(s.summary || {}, path) ?? null,
    lo: lo ? get(s.summary || {}, lo) ?? null : null,
    hi: hi ? get(s.summary || {}, hi) ?? null : null,
  }));
}

function xLabelsFor(sessions, mode) {
  return sessions.map((s, i) => {
    if (mode === "hours" && s.meta && s.meta.hours_since_blindfold != null) return `${s.meta.hours_since_blindfold}h`;
    return s.label && s.label !== "(unlabelled)" ? s.label : `S${i + 1}`;
  });
}

function panel(title, sub, body) {
  return `<section class="rs-panel"><h2 class="rs-h2">${esc(title)}</h2>${sub ? `<p class="rs-sub">${sub}</p>` : ""}${body}</section>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------
export async function renderResults(root, { onBack, exportCsv, exportJson }) {
  root.innerHTML = `<div class="rs"><div class="rs-loading">Loading data…</div></div>`;
  const [allSessions, allTrials] = await Promise.all([store.allSessions(), store.allTrials()]);
  const sessions = allSessions.filter((s) => !s.is_practice && s.status === "complete");
  const trials = allTrials.filter((t) => !t.is_practice);

  let xMode = "label";
  let tab = "overview";
  let rawSession = "all";
  let rawModule = "all";

  function draw() {
    const xs = xLabelsFor(sessions, xMode);
    root.innerHTML = `
      <div class="rs">
        <div class="rs-top">
          <button class="rs-back" id="rs-back">‹ Battery</button>
          <div class="rs-title-wrap">
            <h1 class="rs-title">Results</h1>
            <div class="rs-meta">${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${trials.length} trials</div>
          </div>
          <div class="rs-actions">
            <button class="rs-btn" id="rs-csv">Export CSV</button>
            <button class="rs-btn" id="rs-json">Export JSON</button>
          </div>
        </div>
        <div class="rs-tabs">
          ${["overview", "modules", "confounds", "sessions", "raw"].map((t) =>
            `<button class="rs-tab ${tab === t ? "on" : ""}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
          <label class="rs-xtoggle"><input type="checkbox" id="rs-xmode" ${xMode === "hours" ? "checked" : ""}> x-axis: hours blindfolded</label>
        </div>
        <div class="rs-body">${sessions.length ? bodyFor(tab, xs) : `<div class="rs-empty big">No completed sessions yet. Run the battery and come back.</div>`}</div>
      </div>`;

    root.querySelector("#rs-back").addEventListener("click", onBack);
    root.querySelector("#rs-csv").addEventListener("click", exportCsv);
    root.querySelector("#rs-json").addEventListener("click", exportJson);
    root.querySelector("#rs-xmode").addEventListener("change", (e) => { xMode = e.target.checked ? "hours" : "label"; draw(); });
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; draw(); }));
    if (tab === "raw") wireRaw();
    if (tab === "sessions") wireSessions();
  }

  function bodyFor(t, xs) {
    if (t === "overview") return overview(xs);
    if (t === "modules") return modulesTab(xs);
    if (t === "confounds") return confounds(xs);
    if (t === "sessions") return sessionsTab();
    return rawTab();
  }

  // ---- Overview: the five headline numbers, one chart each ----
  function overview(xs) {
    const cards = [
      { id: "discrim", label: "Pitch discrimination", path: "discrim.threshold_cents", unit: "cents", lower: true },
      { id: "harmonicity", label: "Harmonicity threshold", path: "harmonicity.threshold_jitter_percent", unit: "% jitter", lower: true },
      { id: "workmem", label: "Working memory (mean d′)", path: "workmem.mean_d_prime", unit: "d′", lower: false },
      { id: "masking", label: "Spatial release", path: "masking.spatial_release_db", unit: "dB", lower: false },
      { id: "tagging", label: "Note naming", path: "tagging.accuracy", unit: "correct", lower: false, pct: true },
    ].filter((c) => sessions.some((s) => get(s.summary || {}, c.path) != null));

    const tiles = cards.map((c) => {
      const vals = sessions.map((s) => get(s.summary || {}, c.path)).filter((v) => v != null);
      const first = vals[0], last = vals[vals.length - 1];
      const delta = first != null && last != null ? last - first : null;
      const good = delta == null ? null : (c.lower ? delta < 0 : delta > 0);
      return `<div class="rs-tile">
        <div class="rs-tile-l">${esc(c.label)}</div>
        <div class="rs-tile-v">${c.pct ? `${fmt(last * 100, 1)}%` : fmt(last, 2)}<span>${c.pct ? "" : " " + c.unit}</span></div>
        <div class="rs-tile-d ${good == null ? "" : good ? "up" : "down"}">
          ${delta == null ? "—" : `${delta > 0 ? "+" : ""}${c.pct ? fmt(delta * 100, 1) + " pts" : fmt(delta, 2)} since first session`}
        </div>
      </div>`;
    }).join("");

    return `
      ${panel("Headline measures", "Latest value, and the change from the first session. Everything below keeps the full trial-level data underneath it.", `<div class="rs-tiles">${tiles || `<div class="rs-empty">No summaries yet.</div>`}</div>`)}
      ${panel("Pitch discrimination threshold", "80%-correct point from two interleaved Bayesian tracks. Bars are the 68% credible interval — a change smaller than the bar is not a change.", lineChart({
        series: [{ name: "threshold", points: seriesFrom(sessions, "discrim.threshold_cents").map((p, i) => ({ ...p, lo: (get(sessions[i].summary, "discrim.ci68_cents") || [])[0], hi: (get(sessions[i].summary, "discrim.ci68_cents") || [])[1] })) }],
        xLabels: xs, yLabel: "cents", lowerBetter: true,
      }))}
      ${panel("Harmonicity detection threshold", "Smallest partial-mistuning he can reliably hear, as a percentage of F0. This is the measure with direct short-deprivation evidence behind it.", lineChart({
        series: [{ name: "threshold", color: C.magenta, points: seriesFrom(sessions, "harmonicity.threshold_jitter_percent").map((p, i) => ({ ...p, lo: (get(sessions[i].summary, "harmonicity.ci68_percent") || [])[0], hi: (get(sessions[i].summary, "harmonicity.ci68_percent") || [])[1] })) }],
        xLabels: xs, yLabel: "% of F0", lowerBetter: true,
      }))}
      ${panel("Auditory working memory", "d′ separates sensitivity from response bias, so a session where he simply pressed more often does not masquerade as improvement.", lineChart({
        series: [
          { name: "2-back", color: C.blue, points: seriesFrom(sessions, "workmem.by_load.n2.d_prime") },
          { name: "3-back", color: C.amber, points: seriesFrom(sessions, "workmem.by_load.n3.d_prime") },
        ], xLabels: xs, yLabel: "d′", yZero: true,
      }))}
      ${panel("Cocktail party", "Target-to-masker ratio threshold in each spatial condition, and the release from masking that separation buys.", lineChart({
        series: [
          { name: "co-located", color: C.slate, points: seriesFrom(sessions, "masking.colocated_tmr_db") },
          { name: "separated", color: C.cyan, points: seriesFrom(sessions, "masking.separated_tmr_db") },
          { name: "spatial release", color: C.green, points: seriesFrom(sessions, "masking.spatial_release_db") },
        ], xLabels: xs, yLabel: "dB", lowerBetter: false,
      }))}
      ${panel("Note naming", "Accuracy against a 8.3% chance line, plus decision time from tone onset to the space bar.", `
        ${lineChart({
          series: [
            { name: "accuracy", color: C.green, points: seriesFrom(sessions, "tagging.accuracy") },
            { name: "within 1 semitone", color: C.amber, points: seriesFrom(sessions, "tagging.within_1_semitone") },
            { name: "chance", color: "#cbd5e1", points: sessions.map((s, i) => ({ i, y: 1 / 12 })) },
          ], xLabels: xs, yLabel: "proportion correct", pctAxis: true, yZero: true,
        })}
        ${lineChart({
          series: [{ name: "median decision RT", color: C.blue, points: seriesFrom(sessions, "tagging.median_rt_ms") }],
          xLabels: xs, yLabel: "ms", lowerBetter: true, height: 220,
        })}`)}
    `;
  }

  // ---- Modules: the finer-grained breakdowns ----
  function modulesTab(xs) {
    const tag = trials.filter((t) => t.module === "tagging");
    const mat = Array.from({ length: 12 }, () => new Array(12).fill(0));
    for (const t of tag) {
      const r = t.stim && t.stim.pitch_class, c = t.response_pc;
      if (r != null && c != null) mat[r][c]++;
    }
    const pcBars = PC_NAMES.map((nm, i) => {
      const ts = tag.filter((t) => t.stim && t.stim.pitch_class === i && t.correct != null);
      return { label: nm, y: ts.length ? ts.filter((t) => t.correct).length / ts.length : null };
    });
    const probe = {};
    for (const t of tag) {
      const p = t.extra && t.extra.probe_response;
      if (!p) continue;
      probe[p] = probe[p] || { n: 0, correct: 0 };
      probe[p].n++; if (t.correct) probe[p].correct++;
    }

    const memOn = sessions.some((s) => get(s.summary, "memory.by_condition"));
    const chordOn = sessions.some((s) => get(s.summary, "chords.by_size"));

    return `
      ${panel("Note naming — per pitch class", "Pooled across every session. Uneven bars are the associative anchors he already has; a flattening of this profile over the experiment would be the interesting result.",
        barChart({ bars: pcBars, yLabel: "proportion correct", pctAxis: true }))}
      ${panel("Note naming — confusion matrix", "Green diagonal is correct. Red off-diagonal shows which notes get mistaken for which — semitone-adjacent errors mean something very different from tritone errors.",
        confusionHeat(mat, PC_NAMES))}
      ${panel("Note naming — how did you know?", "Self-reported strategy on the sampled trials, with the accuracy that went with it. A rising 'it just felt like that note' rate that also carries rising accuracy is the thing worth filming.",
        Object.keys(probe).length ? `<table class="rs-table"><thead><tr><th>Strategy</th><th>Trials</th><th>Accuracy</th></tr></thead><tbody>
          ${Object.entries(probe).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, " "))}</td><td>${v.n}</td><td>${fmt((v.correct / v.n) * 100, 1)}%</td></tr>`).join("")}
        </tbody></table>` : `<div class="rs-empty">No probe responses yet.</div>`)}
      ${panel("Working memory — hits vs false alarms", "Plotted apart because they move independently: fatigue usually raises false alarms before it lowers hits.", lineChart({
        series: [
          { name: "2-back hit rate", color: C.blue, points: seriesFrom(sessions, "workmem.by_load.n2.hit_rate") },
          { name: "2-back false alarms", color: C.red, points: seriesFrom(sessions, "workmem.by_load.n2.fa_rate") },
          { name: "3-back hit rate", color: C.amber, points: seriesFrom(sessions, "workmem.by_load.n3.hit_rate") },
          { name: "3-back false alarms", color: C.magenta, points: seriesFrom(sessions, "workmem.by_load.n3.fa_rate") },
        ], xLabels: xs, yLabel: "rate", pctAxis: true, yZero: true,
      }))}
      ${panel("Working memory — response bias", "Criterion c. Drift here without a d′ change means he changed his strategy, not his memory.", lineChart({
        series: [
          { name: "2-back c", color: C.blue, points: seriesFrom(sessions, "workmem.by_load.n2.criterion_c") },
          { name: "3-back c", color: C.amber, points: seriesFrom(sessions, "workmem.by_load.n3.criterion_c") },
        ], xLabels: xs, yLabel: "criterion c", height: 220,
      }))}
      ${panel("Anchor trials", "Fixed-difficulty trials that bypass the adaptive procedure entirely. If the Bayesian thresholds and these disagree about the direction of change, trust these.", `
        ${lineChart({
          series: [25, 12, 6, 3].map((c, i) => ({
            name: `${c} cents`, color: SERIES_COLORS[i],
            points: sessions.map((s, si) => {
              const a = get(s.summary, `discrim.anchor_accuracy.c${c}`);
              return { i: si, y: a && a.n ? a.correct / a.n : null };
            }),
          })), xLabels: xs, yLabel: "proportion correct", pctAxis: true, yZero: true,
        })}`)}
      ${memOn ? panel("Pitch memory by retention condition", "Separates plain decay from interference resistance.", lineChart({
        series: [
          { name: "short (1.5 s)", color: C.green, points: seriesFrom(sessions, "memory.by_condition.short.accuracy") },
          { name: "long (5 s)", color: C.blue, points: seriesFrom(sessions, "memory.by_condition.long.accuracy") },
          { name: "long + interference", color: C.red, points: seriesFrom(sessions, "memory.by_condition.interference.accuracy") },
        ], xLabels: xs, yLabel: "proportion correct", pctAxis: true, yZero: true,
      })) : ""}
      ${chordOn ? panel("Chord segregation by chord size", "Proportion of the notes present that he named.", lineChart({
        series: [2, 3, 4, 5].map((n, i) => ({
          name: `${n} notes`, color: SERIES_COLORS[i],
          points: seriesFrom(sessions, `chords.by_size.size${n}.note_accuracy`),
        })), xLabels: xs, yLabel: "note accuracy", pctAxis: true, yZero: true,
      })) : ""}
    `;
  }

  // ---- Confounds ----
  function confounds(xs) {
    const m = (k) => sessions.map((s, i) => ({ i, y: s.meta ? s.meta[k] ?? null : null }));
    return `
      ${panel("Self-report across sessions", "Before reading anything into a dip, check whether it tracks one of these. A bad hour-12 score that lines up with a fatigue spike is a fatigue result, not a hearing result.", lineChart({
        series: [
          { name: "fatigue", color: C.red, points: m("fatigue") },
          { name: "focus", color: C.green, points: m("focus") },
          { name: "stress", color: C.amber, points: m("stress") },
          { name: "sleep quality", color: C.blue, points: m("sleep_quality") },
        ], xLabels: xs, yLabel: "1–10", yZero: true,
      }))}
      ${panel("Sleep and caffeine", "", lineChart({
        series: [
          { name: "hours slept", color: C.cyan, points: m("hours_slept") },
          { name: "caffeine (mg ÷ 10)", color: C.magenta, points: sessions.map((s, i) => ({ i, y: s.meta && s.meta.caffeine_mg != null ? s.meta.caffeine_mg / 10 : null })) },
        ], xLabels: xs, yLabel: "hours / mg÷10", yZero: true, height: 220,
      }))}
      ${panel("Rig consistency", "Any row that differs from the others is a candidate explanation for that session being an outlier.", `
        <table class="rs-table"><thead><tr><th>Session</th><th>Device</th><th>Headphones</th><th>Volume</th><th>Sample rate</th><th>Output latency</th></tr></thead><tbody>
        ${sessions.map((s) => `<tr>
          <td>${esc(s.label)}</td><td>${esc(s.meta && s.meta.device)}</td><td>${esc(s.meta && s.meta.headphones)}</td>
          <td>${esc(s.meta && s.meta.volume_setting)}</td><td>${esc(get(s, "calibration.sample_rate"))} Hz</td>
          <td>${fmt((get(s, "calibration.output_latency_s") || 0) * 1000, 1)} ms</td></tr>`).join("")}
        </tbody></table>`)}
    `;
  }

  // ---- Sessions ----
  function sessionsTab() {
    return panel("All sessions", "Completed and incomplete. Deleting a session removes its trials too.", `
      <table class="rs-table"><thead><tr>
        <th>Label</th><th>Started</th><th>Status</th><th>Hrs blind</th><th>Trials</th><th>Duration</th><th>Modules</th><th></th>
      </tr></thead><tbody>
      ${allSessions.filter((s) => !s.is_practice).slice().reverse().map((s) => `<tr>
        <td><b>${esc(s.label)}</b></td>
        <td>${new Date(s.started_at).toLocaleString()}</td>
        <td><span class="rs-pill ${s.status}">${s.status.replace("_", " ")}</span></td>
        <td>${s.meta && s.meta.hours_since_blindfold != null ? s.meta.hours_since_blindfold : "—"}</td>
        <td>${s.n_trials ?? "—"}</td>
        <td>${s.started_at && s.ended_at ? fmt((new Date(s.ended_at) - new Date(s.started_at)) / 60000, 1) + " min" : "—"}</td>
        <td class="rs-dim">${(s.modules_completed || []).map((m) => (MODULE_BY_ID[m] || {}).title || m).join(", ") || "—"}</td>
        <td><button class="rs-del" data-del="${s.session_id}">delete</button></td>
      </tr>`).join("")}
      </tbody></table>`);
  }
  function wireSessions() {
    root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Delete this session and all of its trials? This cannot be undone.")) return;
      await store.deleteSession(b.dataset.del);
      const i = allSessions.findIndex((s) => s.session_id === b.dataset.del);
      if (i >= 0) allSessions.splice(i, 1);
      const j = sessions.findIndex((s) => s.session_id === b.dataset.del);
      if (j >= 0) sessions.splice(j, 1);
      draw();
    }));
  }

  // ---- Raw trials ----
  function rawTab() {
    let rows = trials;
    if (rawSession !== "all") rows = rows.filter((t) => t.session_id === rawSession);
    if (rawModule !== "all") rows = rows.filter((t) => t.module === rawModule);
    const shown = rows.slice(0, 400);
    return panel("Raw trials", `${rows.length} matching trials${rows.length > shown.length ? ` — showing the first ${shown.length}. Export for the full set.` : ""}`, `
      <div class="rs-filters">
        <label>Session <select id="rs-fs"><option value="all">All</option>
          ${allSessions.filter((s) => !s.is_practice).map((s) => `<option value="${s.session_id}" ${rawSession === s.session_id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select></label>
        <label>Module <select id="rs-fm"><option value="all">All</option>
          ${MODULES.map((m) => `<option value="${m.id}" ${rawModule === m.id ? "selected" : ""}>${esc(m.title)}</option>`).join("")}
        </select></label>
      </div>
      <div class="rs-scroll"><table class="rs-table mono"><thead><tr>
        <th>#</th><th>Session</th><th>Module</th><th>Block</th><th>Difficulty</th><th>Correct answer</th><th>Response</th><th>✓</th><th>RT (ms)</th><th>Stimulus</th>
      </tr></thead><tbody>
      ${shown.map((t) => `<tr>
        <td>${t.global_index}</td><td>${esc(t.session_label)}</td><td>${esc(t.module)}</td>
        <td>${esc(t.block)}</td><td>${t.difficulty ?? "—"}</td>
        <td>${esc(t.correct_answer)}</td><td>${esc(t.response)}</td>
        <td class="${t.correct === true ? "ok" : t.correct === false ? "bad" : ""}">${t.correct == null ? "—" : t.correct ? "✓" : "✗"}</td>
        <td>${t.rt_ms ?? "—"}</td>
        <td class="rs-stim" title="${esc(JSON.stringify(t.stim))}">${esc(JSON.stringify(t.stim).slice(0, 90))}…</td>
      </tr>`).join("")}
      </tbody></table></div>`);
  }
  function wireRaw() {
    root.querySelector("#rs-fs").addEventListener("change", (e) => { rawSession = e.target.value; draw(); });
    root.querySelector("#rs-fm").addEventListener("change", (e) => { rawModule = e.target.value; draw(); });
  }

  draw();
}
