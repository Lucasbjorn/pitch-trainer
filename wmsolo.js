// Working Memory — standalone re-run.
//
// A longer, more carefully explained version of the battery's n-back, built to
// replace a botched run without disturbing anything else. Three deliberate
// separations from the battery:
//
//   • Its own IndexedDB database (pt-wm-solo). The battery's `pt-battery` is
//     never opened, never version-bumped, never written to.
//   • Its own tab and its own key handling, so no listener fights the battery's.
//   • Its own export. Runs here never appear in the battery's dataset.
//
// It reads two things from the battery — the audio engine and a few pure
// helpers — but writes nothing back.
//
// Differences from the battery version, both on purpose:
//   • Fixed loads (2-back and 3-back, alternating) rather than an adaptive
//     level. A moving target is one more thing to misunderstand, and this run
//     exists because the task was misunderstood.
//   • A worked audio demo and a feedback practice block before anything counts.

import * as A from "./battery-audio.js";
import { makeRng, uid, dPrime, criterionC, median, mean, download, toCsv, stamp, envInfo } from "./battery-core.js";
import { buildNbackSeq } from "./battery-tasks.js";

const SOA_MS = 1750;
const TONE_MS = 300;
const POOL = 6;
const SPACING_CENTS = 137;
const BLOCK_LEN = 22;
const LOADS = [2, 3, 2, 3, 2, 3, 2, 3];      // alternating, so load is not confounded with fatigue
const PRACTICE_LEN = 14;

// ---------------------------------------------------------------------------
// Storage — a separate database. Nothing here can reach the battery's data.
// ---------------------------------------------------------------------------
const DB_NAME = "pt-wm-solo";
let dbP = null;
function openDb() {
  if (dbP) return dbP;
  dbP = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "run_id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
function putRun(run) {
  return openDb().then((db) => new Promise((res, rej) => {
    const t = db.transaction("runs", "readwrite");
    t.objectStore("runs").put(run);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  }));
}
function allRuns() {
  return openDb().then((db) => new Promise((res, rej) => {
    const t = db.transaction("runs", "readonly");
    const q = t.objectStore("runs").getAll();
    q.onsuccess = () => res((q.result || []).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))));
    q.onerror = () => rej(q.error);
  }));
}

// ---------------------------------------------------------------------------
export function setupWmSolo(ctx) {
  const root = document.getElementById("wmsolo");
  const $ = (s) => root.querySelector(s);

  let active = false;
  let abort = false;
  let presses = null;          // { t } collected while a block plays
  let waiting = null;          // resolve fn for "press space to continue"

  function onKey(e) {
    if (!active) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault();
    if (presses) { presses.push({ t: performance.now() }); pulse(); return; }
    if (waiting) { const w = waiting; waiting = null; w(); }
  }
  window.addEventListener("keydown", onKey);

  function pulse() {
    const el = $("#wm-pulse");
    if (!el) return;
    el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  }
  function tapBtn() {
    // The big on-screen button mirrors the space bar, so a friend can drive it.
    const b = $("#wm-tap");
    if (b) b.onclick = () => onKey({ key: " ", preventDefault() {} });
  }
  function awaitGo() {
    return new Promise((res) => { waiting = res; tapBtn(); });
  }

  const shell = (inner) => { root.innerHTML = `<div class="bt wm">${inner}</div>`; };

  // =========================================================================
  // Home
  // =========================================================================
  async function renderHome() {
    abort = true; presses = null; waiting = null; A.stopAll();
    const runs = await allRuns().catch(() => []);
    const done = runs.filter((r) => r.status === "complete").length;
    shell(`
      <button class="bt-back" id="wm-back">‹ Battery</button>
      <h1 class="bt-title">Working Memory — standalone</h1>
      <p class="bt-sub">A longer, more carefully explained re-run of the tone memory test. About 8 minutes.
        Saved completely separately from the battery — nothing here touches your experiment data.
        ${done ? `<b>${done}</b> run${done === 1 ? "" : "s"} recorded.` : "No runs yet."}</p>

      <div class="bt-panel">
        <div class="bt-panel-t">Before you start</div>
        <p class="bt-note">Headphones on, same volume as always. You will get a walkthrough, a worked example you can hear,
          and a practice round with feedback before anything is recorded. Take the practice as many times as you want.</p>
        <div class="bt-fields">
          <label>Label for this run<input id="wm-label" class="bt-input" placeholder="e.g. Hour 36 redo"></label>
        </div>
      </div>

      <button class="bt-btn primary wide" id="wm-start">Start walkthrough</button>
      <div class="bt-row" style="margin-top:1rem">
        <button class="bt-btn ghost" id="wm-export">Download data</button>
      </div>
      <div class="bt-foot">Press <b>space</b> when a tone repeats. A big button on screen does the same thing, so a friend can tap it for you.</div>
    `);
    $("#wm-back").addEventListener("click", () => ctx.goBattery && ctx.goBattery());
    $("#wm-start").addEventListener("click", () => startFlow($("#wm-label").value.trim()));
    $("#wm-export").addEventListener("click", exportAll);
  }

  async function exportAll() {
    const runs = await allRuns();
    if (!runs.length) { alert("No runs recorded yet."); return; }
    const rows = [];
    for (const r of runs) {
      for (const t of r.trials) {
        rows.push({
          run_id: r.run_id, run_label: r.label, started_at: r.started_at, status: r.status,
          block_index: t.block_index, n_back: t.n_back, position: t.position,
          pool_index: t.pool_index, frequency_hz: t.frequency_hz, pool_base_hz: t.pool_base_hz,
          is_target: t.is_target ? 1 : 0, is_lure: t.is_lure ? 1 : 0,
          responded: t.responded ? 1 : 0, correct: t.correct ? 1 : 0,
          outcome: t.outcome, rt_ms: t.rt_ms, soa_ms: SOA_MS, tone_ms: TONE_MS,
        });
      }
    }
    download(`wm-solo-trials-${stamp()}.csv`, toCsv(rows), "text/csv");
    download(`wm-solo-${stamp()}.json`, JSON.stringify(runs, null, 2), "application/json");
  }

  // =========================================================================
  // Walkthrough — the part that was unclear last time
  // =========================================================================
  function tonesFor(baseHz) {
    return Array.from({ length: POOL }, (_, k) => A.centsShift(baseHz, k * SPACING_CENTS));
  }
  function bufFor(freq) {
    return A.toBuffer(A.renderTone({ freq, durMs: TONE_MS, timbre: "organ", rms: A.REF_RMS }).data);
  }

  async function startFlow(label) {
    await A.ensureEngine();
    abort = false;
    await explain2Back();
    if (abort) return;
    let pass = false;
    while (!pass && !abort) pass = await practiceRound();
    if (abort) return;
    await runAll(label);
  }

  async function explain2Back() {
    shell(`
      <h1 class="bt-title">How this works</h1>
      <div class="wm-explain">
        <p>You will hear a slow stream of tones — one roughly every two seconds.</p>
        <p><b>Press space when the tone you just heard is the same as the tone <u>two before it</u>.</b></p>
        <p class="wm-eg">
          <span>A</span><span>B</span><span class="hit">A ← press</span><span>C</span><span>D</span><span class="hit">C ← press</span>
        </p>
        <p>The third tone is the same as the first, so it counts. The sixth matches the fourth, so it counts.</p>
        <p class="wm-warn">Tones that repeat <b>right after each other</b> do not count. Neither do tones three apart.
          Only exactly two back.</p>
        <p>Do nothing at all when it is not a match. There is no penalty for missing one — just keep listening.</p>
        <p>Later blocks change to <b>three back</b>. You will be told clearly before each block, and the number is on screen the whole time.</p>
      </div>
      <div class="bt-row center">
        <button class="bt-btn" id="wm-demo">Hear an example</button>
        <button class="bt-btn primary" id="wm-next">I understand — practice</button>
      </div>
      <div class="wm-demo-row" id="wm-demorow"></div>
    `);
    $("#wm-demo").addEventListener("click", playDemo);
    return new Promise((res) => {
      $("#wm-next").addEventListener("click", () => res());
    });
  }

  /** Worked example: the sequence plays, and each match lights up as it lands. */
  async function playDemo() {
    const btn = $("#wm-demo");
    if (btn) btn.disabled = true;
    const seq = [0, 3, 0, 4, 1, 4, 2, 1];
    const matches = new Set([2, 5]);
    const pool = tonesFor(300);
    const bufs = pool.map(bufFor);
    const row = $("#wm-demorow");
    row.innerHTML = seq.map((_, i) => `<span class="wm-slot" data-i="${i}">·</span>`).join("");
    const t0 = A.nextSlot() + 0.3;
    const onsets = seq.map((v, i) => A.playAt(bufs[v], t0 + (i * SOA_MS) / 1000).onsetPerf);
    for (let i = 0; i < seq.length; i++) {
      await A.sleep(Math.max(0, onsets[i] - performance.now()));
      const el = row.querySelector(`[data-i="${i}"]`);
      if (el) {
        el.textContent = matches.has(i) ? "MATCH" : "—";
        el.className = `wm-slot ${matches.has(i) ? "hit" : "on"}`;
      }
      if (matches.has(i)) { const c = A.renderClick({}); A.playMono(c.data, A.nextSlot()); }
    }
    await A.sleep(700);
    if (btn) btn.disabled = false;
  }

  // =========================================================================
  // Practice — feedback on, nothing recorded
  // =========================================================================
  async function practiceRound() {
    const rng = makeRng(`wm-practice-${Date.now()}`);
    const baseHz = 300 * Math.pow(2, rng.range(-0.2, 0.2));
    const pool = tonesFor(baseHz);
    const bufs = pool.map(bufFor);
    const { seq, targets } = buildNbackSeq(PRACTICE_LEN, 2, POOL, rng);
    const tset = new Set(targets);

    shell(`
      <h1 class="bt-title">Practice — 2 back</h1>
      <p class="bt-sub">Feedback is on and nothing is recorded. Press space when a tone matches the one two before it.</p>
      <div class="wm-stage">
        <div class="bt-receipt" id="wm-pulse"></div>
        <div class="wm-load">2 BACK</div>
        <div class="wm-live" id="wm-live">get ready…</div>
        <button class="wm-tap" id="wm-tap">MATCH<span>space</span></button>
      </div>
      <div class="wm-track" id="wm-track"></div>
      <div class="bt-row center"><button class="bt-btn ghost" id="wm-quit">back</button></div>
    `);
    tapBtn();
    $("#wm-quit").addEventListener("click", () => { abort = true; renderHome(); });

    const track = $("#wm-track");
    track.innerHTML = seq.map((_, i) => `<span class="wm-slot" data-i="${i}">·</span>`).join("");
    await A.sleep(900);
    if (abort) return true;

    const res = await runBlock(seq, tset, bufs, {
      onTone: (i, responded, correct, isTarget) => {
        const el = track.querySelector(`[data-i="${i}"]`);
        if (el) {
          el.textContent = isTarget ? (responded ? "✓" : "missed") : (responded ? "✗" : "·");
          el.className = `wm-slot ${correct ? (isTarget ? "hit" : "on") : "bad"}`;
        }
        const live = $("#wm-live");
        if (live) {
          live.textContent = isTarget
            ? (responded ? "yes — that was a match" : "that one was a match")
            : (responded ? "that was not a match" : "…");
          live.className = `wm-live ${correct ? "ok" : "bad"}`;
        }
      },
    });
    if (abort) return true;

    const hits = res.filter((r) => r.is_target && r.responded).length;
    const nT = res.filter((r) => r.is_target).length;
    const fas = res.filter((r) => !r.is_target && r.responded).length;
    const good = hits >= Math.ceil(nT * 0.6) && fas <= 2;

    shell(`
      <h1 class="bt-title">${good ? "Got it." : "Let's try that again."}</h1>
      <p class="bt-sub">You caught <b>${hits}</b> of <b>${nT}</b> matches${fas ? `, and pressed <b>${fas}</b> time${fas === 1 ? "" : "s"} when it was not a match` : ""}.
        ${good ? "That is the task. The real run has no feedback." : "Remember: compare each tone to the one <b>two before</b> it, not the one right before."}</p>
      <div class="bt-row center">
        <button class="bt-btn ${good ? "" : "primary"}" id="wm-again">Practice again</button>
        <button class="bt-btn ${good ? "primary" : ""}" id="wm-go">Start the real run</button>
      </div>
      <div class="bt-row center" style="margin-top:0.6rem"><button class="bt-btn ghost" id="wm-quit2">back</button></div>
    `);
    return new Promise((res2) => {
      $("#wm-again").addEventListener("click", () => res2(false));
      $("#wm-go").addEventListener("click", () => res2(true));
      $("#wm-quit2").addEventListener("click", () => { abort = true; renderHome(); res2(true); });
    });
  }

  // =========================================================================
  // Block runner — shared by practice and the real run
  // =========================================================================
  async function runBlock(seq, targetSet, bufs, { onTone = null, nBack = 2 } = {}) {
    presses = [];
    const t0 = A.nextSlot() + 0.5;
    const onsets = seq.map((v, i) => A.playAt(bufs[v], t0 + (i * SOA_MS) / 1000).onsetPerf);
    const out = [];
    for (let i = 0; i < seq.length; i++) {
      if (abort) break;
      const windowEnd = onsets[i] + SOA_MS - 120;
      await A.sleep(Math.max(0, windowEnd - performance.now()));
      const p = presses.find((x) => x.t >= onsets[i] - 150 && x.t <= windowEnd && !x.used);
      if (p) p.used = true;
      const isTarget = targetSet.has(i);
      const responded = !!p;
      const correct = isTarget ? responded : !responded;
      out.push({
        position: i, pool_index: seq[i], is_target: isTarget, responded, correct,
        rt_ms: p ? +(p.t - onsets[i]).toFixed(1) : null,
        outcome: isTarget ? (responded ? "hit" : "miss") : (responded ? "false_alarm" : "correct_rejection"),
        n_back: nBack,
      });
      if (onTone) onTone(i, responded, correct, isTarget);
    }
    presses = null;
    return out;
  }

  // =========================================================================
  // The real run
  // =========================================================================
  async function runAll(label) {
    const runId = uid();
    const seed = `wm-${Date.now().toString(36)}`;
    const rng = makeRng(seed);
    const run = {
      run_id: runId, label: label || "(unlabelled)", seed,
      started_at: new Date().toISOString(), ended_at: null, status: "in_progress",
      app: "wm-solo", version: "1.0.0",
      config: { soa_ms: SOA_MS, tone_ms: TONE_MS, block_len: BLOCK_LEN, loads: LOADS, pool: POOL, spacing_cents: SPACING_CENTS },
      audio: A.audioConfig(), env: envInfo(),
      trials: [],
    };

    for (let bi = 0; bi < LOADS.length; bi++) {
      if (abort) return;
      const n = LOADS[bi];
      const baseHz = 300 * Math.pow(2, rng.range(-0.3, 0.3));
      const pool = tonesFor(baseHz);
      const bufs = pool.map(bufFor);
      const { seq, targets, lures } = buildNbackSeq(BLOCK_LEN, n, POOL, rng);
      const tset = new Set(targets), lset = new Set(lures);
      const pct = Math.round((bi / LOADS.length) * 100);

      // Between-block screen. The load is stated plainly and stays on screen.
      shell(`
        <div class="wm-head">
          <div class="bt-runprog">Block <b>${bi + 1}</b> of <b>${LOADS.length}</b> — <b>${pct}%</b> done</div>
          <div class="bt-runbar"><div class="bt-runbar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="wm-ready">
          <div class="wm-load big">${n} BACK</div>
          <p class="bt-sub">Press space when a tone is the same as the one <b>${n === 2 ? "two" : "three"} before it</b>.</p>
          <button class="bt-btn primary" id="wm-tap">Press space to begin</button>
          <div class="bt-row center" style="margin-top:1rem"><button class="bt-btn ghost" id="wm-quit">stop</button></div>
        </div>
      `);
      $("#wm-quit").addEventListener("click", () => { abort = true; renderHome(); });
      await awaitGo();
      if (abort) return;

      shell(`
        <div class="wm-head">
          <div class="bt-runprog">Block <b>${bi + 1}</b> of <b>${LOADS.length}</b></div>
          <div class="bt-runbar"><div class="bt-runbar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="wm-stage">
          <div class="bt-receipt" id="wm-pulse"></div>
          <div class="wm-load big">${n} BACK</div>
          <div class="wm-live" id="wm-live">listen…</div>
          <button class="wm-tap" id="wm-tap">MATCH<span>space</span></button>
        </div>
      `);
      tapBtn();

      const res = await runBlock(seq, tset, bufs, { nBack: n });
      if (abort) return;

      for (const r of res) {
        run.trials.push({
          ...r, block_index: bi, n_back: n,
          frequency_hz: +pool[r.pool_index].toFixed(3),
          pool_base_hz: +baseHz.toFixed(3),
          is_lure: lset.has(r.position),
        });
      }
      run.status = "in_progress";
      await putRun(run).catch((e) => console.error("wm save failed", e));   // saved after every block
    }

    run.status = "complete";
    run.ended_at = new Date().toISOString();
    run.summary = summarize(run.trials);
    await putRun(run).catch((e) => console.error("wm save failed", e));

    const name = `wm-solo-${stamp()}-${(run.label || "run").replace(/[^\w-]+/g, "_")}.json`;
    try { download(name, JSON.stringify(run, null, 2), "application/json"); } catch (_) {}

    const mins = ((new Date(run.ended_at) - new Date(run.started_at)) / 60000).toFixed(1);
    shell(`
      <div class="bt-done">
        <div class="bt-done-mark">✓</div>
        <h1 class="bt-title">Run complete. Data saved.</h1>
        <p class="bt-sub">${run.trials.length} tones · ${mins} minutes · backup file <b>${name}</b> in your Downloads.</p>
        <p class="bt-note center">No results are shown, same as the battery.</p>
        <button class="bt-btn primary" id="wm-home">Done</button>
      </div>
    `);
    $("#wm-home").addEventListener("click", renderHome);
  }

  function summarize(trials) {
    const out = {};
    for (const n of [...new Set(trials.map((t) => t.n_back))].sort()) {
      const ts = trials.filter((t) => t.n_back === n);
      const sig = ts.filter((t) => t.is_target), noi = ts.filter((t) => !t.is_target);
      const hits = sig.filter((t) => t.responded).length;
      const fas = noi.filter((t) => t.responded).length;
      const nLure = noi.filter((t) => t.is_lure).length;
      out[`n${n}`] = {
        n: ts.length, n_targets: sig.length, hits, misses: sig.length - hits,
        false_alarms: fas,
        hit_rate: sig.length ? +(hits / sig.length).toFixed(4) : null,
        fa_rate: noi.length ? +(fas / noi.length).toFixed(4) : null,
        lure_fa_rate: nLure ? +(noi.filter((t) => t.is_lure && t.responded).length / nLure).toFixed(4) : null,
        d_prime: +(dPrime(hits, sig.length, fas, noi.length) ?? 0).toFixed(4),
        criterion_c: +(criterionC(hits, sig.length, fas, noi.length) ?? 0).toFixed(4),
        accuracy: +(ts.filter((t) => t.correct).length / ts.length).toFixed(4),
        median_hit_rt_ms: median(sig.filter((t) => t.rt_ms != null).map((t) => t.rt_ms)),
      };
    }
    const ds = Object.values(out).map((o) => o.d_prime);
    return { by_load: out, mean_d_prime: ds.length ? +mean(ds).toFixed(4) : null };
  }

  return {
    async enter() {
      active = true; abort = false;
      ctx.setStatus("Working Memory");
      await renderHome();
    },
    exit() {
      active = false; abort = true; presses = null; waiting = null;
      A.stopAll();
    },
  };
}
