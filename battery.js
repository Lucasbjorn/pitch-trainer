// Testing Battery — session shell.
//
// Owns the screens, the session lifecycle, input routing and progress. The task
// modules in battery-tasks.js know nothing about the DOM; they talk to the `io`
// object built here.
//
// Two rules this file enforces above all else:
//   1. No performance feedback during a real session. Knowing you improved 18%
//      at hour 12 changes how you attack hour 24.
//   2. Every trial is written to IndexedDB the moment it completes, so a
//      refresh, a crash or a closed lid costs one trial, never a session.

import * as A from "./battery-audio.js";
import {
  BATTERY_VERSION, makeRng, store, uid, envInfo, download, stamp,
  toCsv, flattenTrial, flattenSession, requestPersistentStorage, storageEstimate,
} from "./battery-core.js";
import { CORE_MODULES, OPTIONAL_MODULES, MODULES, modulesFor, PC_NAMES } from "./battery-tasks.js";
import { renderResults } from "./battery-results.js";

const LS = {
  device: "pt.bat.device",
  phones: "pt.bat.phones",
  volume: "pt.bat.volume",
  tts: "pt.bat.tts",
  modules: "pt.bat.modules",
};

const SESSION_LABELS = ["Baseline", "Hour 2", "Hour 6", "Hour 12", "Hour 24", "Hour 36", "Hour 48", "Post Vision"];

export function setupBattery(ctx) {
  const root = document.getElementById("battery");
  const $ = (s) => root.querySelector(s);

  let active = false;
  let view = "home";
  let session = null;          // live session record
  let runner = null;           // { modules, moduleIndex, trialIndex, run, trials }
  let pauseRequested = false;
  let aborted = false;
  // Spoken instructions are off unless explicitly switched on. Instructions are
  // on screen and a friend is operating the machine, so the voice is just delay.
  let ttsOn = localStorage.getItem(LS.tts) === "1";

  // -------------------------------------------------------------------------
  // Input routing. Keyboard, MIDI and friend-clicks all funnel through one
  // pending-request object, so a task never cares which was used — it just gets
  // a value, a timestamp and the method that produced it.
  // -------------------------------------------------------------------------
  let pending = null;          // { kind, resolve, ... }
  let spaceCollector = null;   // array of { t, method } while an n-back block runs

  function nowStamp() { return performance.now(); }

  function handleInput(ev) {
    // ev: { kind: 'key'|'midi'|'click', key?, pc?, method, t }
    if (spaceCollector && ((ev.kind === "key" && ev.key === " ") || (ev.kind === "click" && ev.key === "space"))) {
      spaceCollector.push({ t: ev.t, method: ev.method });
      flashReceipt();
      return true;
    }
    if (!pending) return false;

    if (pending.kind === "choice") {
      const k = ev.kind === "midi" ? null : String(ev.key || "").toLowerCase();
      if (k && Object.prototype.hasOwnProperty.call(pending.map, k)) {
        const p = pending; pending = null;
        p.done({ value: p.map[k], rtMs: p.onsetPerf != null ? +(ev.t - p.onsetPerf).toFixed(1) : null, method: ev.method, raw: k, timedOut: false });
        return true;
      }
      if (k === "r" && pending.onReplay) { pending.onReplay(); return true; }
      return false;
    }

    if (pending.kind === "decision") {
      if (ev.kind === "midi") {
        const p = pending; pending = null;
        p.done({ pc: ev.pc, rtMs: +(ev.t - p.onsetPerf).toFixed(1), method: "midi", timedOut: false });
        return true;
      }
      const k = String(ev.key || "").toLowerCase();
      if (k === "h" && pending.onHint) { updateHintButton(pending.onHint()); return true; }
      if (k === " " || k === "space") {
        const p = pending; pending = null;
        p.done({ pc: null, rtMs: +(ev.t - p.onsetPerf).toFixed(1), method: ev.method, timedOut: false });
        return true;
      }
      return false;
    }

    if (pending.kind === "pcs") {
      if (ev.kind === "midi" || (ev.kind === "click" && ev.pc != null)) {
        const p = pending;
        if (p.pcs.includes(ev.pc)) return true;            // no duplicates in a chord
        p.pcs.push(ev.pc);
        p.entryRts.push(p.onsetPerf != null ? +(ev.t - p.onsetPerf).toFixed(1) : null);
        if (p.rtMs == null && p.onsetPerf != null) p.rtMs = +(ev.t - p.onsetPerf).toFixed(1);
        p.method = ev.kind === "midi" ? "midi" : "click";
        renderPcProgress(p);
        if (p.pcs.length >= p.n) {
          pending = null;
          p.done({ pcs: p.pcs, rtMs: p.rtMs, rtTotalMs: p.onsetPerf != null ? +(ev.t - p.onsetPerf).toFixed(1) : null, entryRts: p.entryRts, method: p.method, timedOut: false });
        }
        return true;
      }
      const k = String(ev.key || "").toLowerCase();
      if (k === "backspace" && pending.pcs.length) {
        pending.pcs.pop(); pending.entryRts.pop(); renderPcProgress(pending); return true;
      }
      if (k === "r" && pending.onReplay) { pending.onReplay(); return true; }
      return false;
    }

    if (pending.kind === "go") {
      const k = String(ev.key || "").toLowerCase();
      if (ev.kind !== "midi" && (k === " " || k === "space" || k === "enter")) {
        const p = pending; pending = null; p.done({ ok: true });
        return true;
      }
      return false;
    }
    return false;
  }

  function onKeyDown(e) {
    if (!active) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "p" || e.key === "P") {
      if (view === "run") { e.preventDefault(); pauseRequested = true; showPauseHint(); return; }
    }
    if (handleInput({ kind: "key", key: e.key, method: "key", t: nowStamp() })) e.preventDefault();
  }

  function onMidi(msg) {
    if (!active || msg.kind !== "note") return;
    handleInput({ kind: "midi", pc: ((msg.midi % 12) + 12) % 12, midi: msg.midi, method: "midi", t: nowStamp() });
  }

  // -------------------------------------------------------------------------
  // Text to speech — instructions only, never a stimulus.
  // -------------------------------------------------------------------------
  function say(text) {
    if (!ttsOn || !window.speechSynthesis) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.02;
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        u.onend = fin; u.onerror = fin;
        setTimeout(fin, Math.max(2500, text.length * 95));   // guard: some voices never fire onend
        window.speechSynthesis.speak(u);
      } catch (_) { resolve(); }
    });
  }
  function shutUp() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {} }

  // -------------------------------------------------------------------------
  // The io object handed to task modules
  // -------------------------------------------------------------------------
  function flashReceipt() {
    const el = $("#bt-receipt");
    if (!el) return;
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
  }

  function renderPcProgress(p) {
    const el = $("#bt-entered");
    if (el) el.textContent = p.pcs.map((x) => PC_NAMES[x]).join("  ") || "—";
    const g = $("#bt-pcgrid");
    if (g) g.querySelectorAll("[data-pc]").forEach((b) => b.classList.toggle("picked", p.pcs.includes(+b.dataset.pc)));
  }

  function showChoiceButtons(map, extras = []) {
    const box = $("#bt-choices");
    if (!box) return;
    const seen = new Set();
    const rows = [];
    for (const [k, v] of Object.entries(map)) {
      if (seen.has(v)) continue;
      seen.add(v);
      rows.push(`<button class="bt-choice" data-key="${k}">${String(v).replace(/_/g, " ")}<span>${k === " " ? "space" : k.toUpperCase()}</span></button>`);
    }
    for (const e of extras) {
      rows.push(`<button class="bt-choice aux" data-key="${e.key}" ${e.disabled ? "disabled" : ""}>${e.label}<span>${e.key.toUpperCase()}</span></button>`);
    }
    box.innerHTML = rows.join("");
    box.classList.add("on");
    box.querySelectorAll("[data-key]").forEach((b) =>
      b.addEventListener("click", () => handleInput({ kind: "click", key: b.dataset.key, method: "click", t: nowStamp() })));
  }

  /** Re-label the hint button in place as the allowance is spent. */
  function updateHintButton(left) {
    const b = root.querySelector('#bt-choices [data-key="h"]');
    if (!b) return;
    if (left <= 0) { b.disabled = true; b.innerHTML = `no hints left<span>H</span>`; }
    else b.innerHTML = `hear it again (${left} left)<span>H</span>`;
  }
  function hideChoiceButtons() { const b = $("#bt-choices"); if (b) { b.classList.remove("on"); b.innerHTML = ""; } }

  function showPcGrid(n) {
    const box = $("#bt-pcwrap");
    if (!box) return;
    box.classList.add("on");
    $("#bt-pcneed").textContent = n > 1 ? `${n} notes` : "";
    $("#bt-entered").textContent = "—";
    const g = $("#bt-pcgrid");
    g.innerHTML = PC_NAMES.map((nm, i) => `<button class="bt-pc" data-pc="${i}">${nm}</button>`).join("");
    g.querySelectorAll("[data-pc]").forEach((b) =>
      b.addEventListener("click", () => handleInput({ kind: "click", pc: +b.dataset.pc, method: "click", t: nowStamp() })));
  }
  function hidePcGrid() { const b = $("#bt-pcwrap"); if (b) b.classList.remove("on"); }

  function withTimeout(p, ms, onTimeout) {
    let t = null;
    return Promise.race([
      p.then((v) => { if (t) clearTimeout(t); return v; }),
      new Promise((res) => { t = setTimeout(() => { pending = null; res(onTimeout()); }, ms); }),
    ]);
  }

  const io = {
    status(text) { const e = $("#bt-status"); if (e) e.textContent = text; },
    prompt(html) { const e = $("#bt-prompt"); if (e) e.innerHTML = html || ""; },
    say,

    awaitChoice({ map, onsetPerf, timeoutMs = 20000, onReplay = null }) {
      showChoiceButtons(map);
      const p = new Promise((done) => { pending = { kind: "choice", map, onsetPerf, onReplay, done }; });
      return withTimeout(p, timeoutMs, () => ({ value: null, rtMs: null, method: "timeout", timedOut: true }))
        .then((r) => { hideChoiceButtons(); return r; });
    },

    /**
     * Space bar (or a MIDI note, which doubles as the answer) stops the clock.
     * There is no time pressure attached to this — it exists so decision time
     * can be recorded without the friend's own reaction time contaminating it.
     * `onHint` returns how many hints remain, so the button can relabel itself.
     */
    awaitDecision({ onsetPerf, timeoutMs = 120000, onHint = null, hintsLeft = 0 }) {
      const extras = onHint ? [{ key: "h", label: `hear it again (${hintsLeft} left)`, disabled: hintsLeft <= 0 }] : [];
      showChoiceButtons({ " ": "I've decided" }, extras);
      const p = new Promise((done) => { pending = { kind: "decision", onsetPerf, onHint, done }; });
      return withTimeout(p, timeoutMs, () => ({ pc: null, rtMs: null, method: "timeout", timedOut: true }))
        .then((r) => { hideChoiceButtons(); return r; });
    },

    awaitPitchClasses(n, { onsetPerf = null, timeoutMs = 60000, onReplay = null, noRt = false } = {}) {
      showPcGrid(n);
      const st = { kind: "pcs", n, pcs: [], entryRts: [], rtMs: null, method: null, onsetPerf: noRt ? null : onsetPerf, onReplay };
      const p = new Promise((done) => { pending = Object.assign(st, { done }); });
      return withTimeout(p, timeoutMs, () => ({ pcs: st.pcs, rtMs: st.rtMs, rtTotalMs: null, entryRts: st.entryRts, method: st.method || "timeout", timedOut: true }))
        .then((r) => { hidePcGrid(); return r; });
    },

    awaitGo(label = "Press space to continue") {
      io.prompt(`<span class="bt-go">${label}</span>`);
      showChoiceButtons({ " ": "continue" });
      return new Promise((done) => { pending = { kind: "go", done }; })
        .then((r) => { hideChoiceButtons(); io.prompt(""); return r; });
    },

    receipt() {
      flashReceipt();
      try { const c = A.renderClick({ rand: Math.random }); A.playMono(c.data, A.nextSlot()); } catch (_) {}
    },

    /** Practice only. The shell refuses to render this during a real session. */
    feedback(ok, text) {
      if (!session || !session.is_practice) return;
      const e = $("#bt-feedback");
      if (!e) return;
      e.textContent = text;
      e.className = `bt-feedback ${ok ? "ok" : "bad"}`;
      setTimeout(() => { if (e) { e.textContent = ""; e.className = "bt-feedback"; } }, 1600);
    },

    collectSpace() { spaceCollector = []; return spaceCollector; },
    stopCollectSpace() { spaceCollector = null; },

    async blockIntro(title, text) {
      io.status(title);
      io.prompt(text);
      await say(text);
      await A.sleep(500);
      io.prompt("");
    },
  };

  // =========================================================================
  // Screens
  // =========================================================================
  function shell(inner, cls = "") {
    root.innerHTML = `<div class="bt ${cls}">${inner}</div>`;
  }

  function renderHome() {
    view = "home";
    shutUp();
    A.stopAll();
    store.allSessions().then((all) => {
      const real = all.filter((s) => !s.is_practice);
      const open = real.find((s) => s.status === "in_progress");
      const done = real.filter((s) => s.status === "complete");
      const resumeCard = open ? `
        <div class="bt-resume">
          <div><b>Unfinished session:</b> ${open.label || "(unlabelled)"} — started ${new Date(open.started_at).toLocaleString()}</div>
          <div class="bt-row">
            <button class="bt-btn primary" id="bt-resume">Resume it</button>
            <button class="bt-btn ghost" id="bt-abandon">Mark abandoned</button>
          </div>
        </div>` : "";

      shell(`
        <h1 class="bt-title">Testing Battery</h1>
        <p class="bt-sub">Standardized auditory measurements, repeated across the deprivation timeline.
          ${done.length ? `<b>${done.length}</b> completed session${done.length === 1 ? "" : "s"} recorded.` : "No sessions recorded yet."}</p>
        ${resumeCard}
        <div class="bt-cards">
          <button class="bt-card go" id="bt-start">
            <div class="bt-card-t">Run a session</div>
            <div class="bt-card-b">The full battery. ~25 minutes. No feedback until it is over.</div>
          </button>
          <button class="bt-card" id="bt-practice">
            <div class="bt-card-t">Practice</div>
            <div class="bt-card-b">Short versions with feedback. Never enters the dataset. Do this until every task feels automatic, <i>before</i> baseline.</div>
          </button>
          <button class="bt-card" id="bt-setup">
            <div class="bt-card-t">Audio setup &amp; check</div>
            <div class="bt-card-b">Headphones, channels, volume. Run once per session start.</div>
          </button>
        </div>
        <div class="bt-foot">Keys: <b>F</b> and <b>J</b> for two-choice answers · <b>space</b> for "I know it" · <b>P</b> pauses · <b>R</b> replays where allowed.</div>
      `);
      $("#bt-start").addEventListener("click", () => renderSetup("meta"));
      $("#bt-practice").addEventListener("click", renderPracticeMenu);
      $("#bt-setup").addEventListener("click", () => renderSetup("home"));
      if (open) {
        $("#bt-resume").addEventListener("click", () => resumeSession(open));
        $("#bt-abandon").addEventListener("click", async () => {
          open.status = "abandoned"; await store.putSession(open); renderHome();
        });
      }
      armAdminSequence();
    });
  }

  // Results are deliberately unreachable by accident: typing "admin" here, or
  // loading the page with ?admin=1. Nothing on screen advertises it.
  function armAdminSequence() {
    let buf = "";
    const onKey = (e) => {
      if (view !== "home") { window.removeEventListener("keydown", onKey); return; }
      buf = (buf + e.key).slice(-5).toLowerCase();
      if (buf === "admin") { window.removeEventListener("keydown", onKey); openAdmin(); }
    };
    window.addEventListener("keydown", onKey);
  }

  // ---- audio setup / calibration ----
  function renderSetup(next) {
    view = "setup";
    const dev = localStorage.getItem(LS.device) || "";
    const ph = localStorage.getItem(LS.phones) || "";
    const vol = localStorage.getItem(LS.volume) || "";
    shell(`
      <button class="bt-back" id="bt-back">‹ Battery</button>
      <h1 class="bt-title">Audio setup</h1>
      <p class="bt-sub">Same headphones, same computer, same output device, same volume — every session. Differences here look exactly like real effects in the data.</p>

      <div class="bt-panel">
        <div class="bt-panel-t">1 · Level</div>
        <p class="bt-note">Play the reference tone and set your system volume so it is clearly audible but comfortable. Then never touch the volume again for the rest of the experiment.</p>
        <button class="bt-btn" id="bt-tone">Play reference tone</button>
        <button class="bt-btn" id="bt-noise">Play reference noise</button>
      </div>

      <div class="bt-panel">
        <div class="bt-panel-t">2 · Channel check</div>
        <p class="bt-note">The cocktail-party test relies on left/right cues. If the channels are swapped or the output is mono, that measure is meaningless.</p>
        <div class="bt-row">
          <button class="bt-btn" id="bt-left">Play LEFT only</button>
          <button class="bt-btn" id="bt-right">Play RIGHT only</button>
        </div>
        <label class="bt-check"><input type="checkbox" id="bt-lr"> Channels confirmed correct</label>
      </div>

      <div class="bt-panel">
        <div class="bt-panel-t">3 · Rig</div>
        <div class="bt-fields">
          <label>Computer / device<input id="bt-dev" value="${esc(dev)}" placeholder="MacBook Pro M3"></label>
          <label>Headphones<input id="bt-ph" value="${esc(ph)}" placeholder="Sennheiser HD 600"></label>
          <label>Volume setting<input id="bt-vol" value="${esc(vol)}" placeholder="e.g. 6/16 notches, or 45%"></label>
        </div>
        <label class="bt-check"><input type="checkbox" id="bt-tts" ${ttsOn ? "checked" : ""}> Speak instructions aloud</label>
        <p class="bt-note" id="bt-audioinfo">—</p>
      </div>

      <div class="bt-panel">
        <div class="bt-panel-t">4 · Storage</div>
        <p class="bt-note" id="bt-storage">Checking…</p>
      </div>

      <button class="bt-btn primary wide" id="bt-next">${next === "meta" ? "Continue to session details" : "Save and go back"}</button>
    `);

    $("#bt-back").addEventListener("click", renderHome);

    // Ask once per setup visit; Chrome grants silently for bookmarked sites.
    (async () => {
      const p = await requestPersistentStorage();
      const est = await storageEstimate();
      const used = est && est.usage_bytes != null ? ` · ${(est.usage_bytes / 1048576).toFixed(1)} MB stored` : "";
      const el = $("#bt-storage");
      if (!el) return;
      el.innerHTML = p === true
        ? `Data is stored in this browser and is <b>protected from automatic cleanup</b>${used}. A backup file also downloads after every session — keep those.`
        : p === false
          ? `⚠️ The browser would <b>not</b> guarantee this data against automatic cleanup${used}. It is very unlikely to be dropped, but the per-session backup files in your Downloads are the copy that matters. Do not clear site data for this address.`
          : `Data is stored in this browser${used}. A backup file downloads after every session — keep those, and do not clear site data for this address.`;
    })();

    const persist = () => {
      localStorage.setItem(LS.device, $("#bt-dev").value.trim());
      localStorage.setItem(LS.phones, $("#bt-ph").value.trim());
      localStorage.setItem(LS.volume, $("#bt-vol").value.trim());
    };
    $("#bt-tts").addEventListener("change", (e) => {
      ttsOn = e.target.checked; localStorage.setItem(LS.tts, ttsOn ? "1" : "0");
    });

    const withAudio = (fn) => async () => {
      await A.ensureEngine();
      const c = A.audioConfig();
      $("#bt-audioinfo").textContent =
        `${c.sample_rate} Hz${c.forced_sr ? "" : " (device rate — 48 kHz unavailable)"} · base latency ${(c.base_latency_s * 1000 || 0).toFixed(1)} ms · output latency ${((c.output_latency_s || 0) * 1000).toFixed(1)} ms`;
      fn();
    };
    $("#bt-tone").addEventListener("click", withAudio(() => {
      const t = A.renderTone({ freq: 440, durMs: 1500, timbre: "organ" });
      A.playMono(t.data, A.nextSlot());
    }));
    $("#bt-noise").addEventListener("click", withAudio(() => {
      const n = A.renderNoise({ durMs: 1800 });
      A.playMono(n.data, A.nextSlot());
    }));
    $("#bt-left").addEventListener("click", withAudio(() => {
      const t = A.renderTone({ freq: 523.25, durMs: 900, timbre: "organ" });
      A.playAt(A.toPannedBuffer(t.data, "left"), A.nextSlot());
    }));
    $("#bt-right").addEventListener("click", withAudio(() => {
      const t = A.renderTone({ freq: 659.25, durMs: 900, timbre: "organ" });
      A.playAt(A.toPannedBuffer(t.data, "right"), A.nextSlot());
    }));
    $("#bt-next").addEventListener("click", async () => {
      persist();
      await A.ensureEngine();
      if (next === "meta") renderMeta(); else renderHome();
    });
  }

  // ---- session metadata ----
  function renderMeta() {
    view = "meta";
    const savedMods = JSON.parse(localStorage.getItem(LS.modules) || "null");
    const activeIds = new Set(savedMods && savedMods.length ? savedMods : CORE_MODULES.map((m) => m.id));
    const optRows = OPTIONAL_MODULES.map((m) => `
      <label class="bt-check"><input type="checkbox" class="bt-opt" value="${m.id}" ${activeIds.has(m.id) ? "checked" : ""}> Also run <b>${m.title}</b> — ${m.blurb}</label>`).join("");

    shell(`
      <button class="bt-back" id="bt-back">‹ Battery</button>
      <h1 class="bt-title">Session details</h1>
      <p class="bt-sub">Thirty seconds of context. These are the variables that explain a bad hour-12 score that has nothing to do with hearing.</p>

      <div class="bt-panel">
        <div class="bt-panel-t">Label</div>
        <div class="bt-chips" id="bt-chips">${SESSION_LABELS.map((l) => `<button class="bt-chip" data-l="${l}">${l}</button>`).join("")}</div>
        <input id="bt-label" class="bt-input" placeholder="Session label">
      </div>

      <div class="bt-panel">
        <div class="bt-panel-t">State</div>
        <div class="bt-fields">
          <label>Hours since blindfold went on<input id="bt-hours" type="number" step="0.5" placeholder="0"></label>
          <label>Currently<select id="bt-blind"><option value="1">Blindfolded</option><option value="0">Vision restored</option></select></label>
          <label>Hours slept last night<input id="bt-slept" type="number" step="0.5" placeholder="7"></label>
          <label>Caffeine since waking (mg)<input id="bt-caff" type="number" step="10" placeholder="0"></label>
        </div>
        ${slider("sleepq", "Sleep quality", 5)}
        ${slider("fatigue", "Fatigue", 5)}
        ${slider("focus", "Focus", 5)}
        ${slider("stress", "Stress", 5)}
        <label class="bt-field-wide">Notes<textarea id="bt-notes" rows="2" placeholder="Anything unusual — headache, noisy room, took the blindfold off briefly…"></textarea></label>
      </div>

      <div class="bt-panel">
        <div class="bt-panel-t">Modules</div>
        <p class="bt-note">Five core tests run every session. Changing this set between sessions breaks comparability — decide once, before baseline, and leave it.</p>
        ${optRows}
      </div>

      <button class="bt-btn primary wide" id="bt-go">Begin session</button>
    `);

    $("#bt-back").addEventListener("click", renderHome);
    root.querySelectorAll("#bt-chips .bt-chip").forEach((b) =>
      b.addEventListener("click", () => { $("#bt-label").value = b.dataset.l; }));
    root.querySelectorAll(".bt-slider input").forEach((i) =>
      i.addEventListener("input", () => { i.parentElement.querySelector("output").textContent = i.value; }));
    $("#bt-go").addEventListener("click", () => {
      const ids = [...CORE_MODULES.map((m) => m.id),
        ...[...root.querySelectorAll(".bt-opt")].filter((c) => c.checked).map((c) => c.value)];
      localStorage.setItem(LS.modules, JSON.stringify(ids));
      const meta = {
        hours_since_blindfold: numOrNull($("#bt-hours").value),
        blindfolded: $("#bt-blind").value === "1",
        hours_slept: numOrNull($("#bt-slept").value),
        caffeine_mg: numOrNull($("#bt-caff").value),
        sleep_quality: +$("#bt-sleepq").value,
        fatigue: +$("#bt-fatigue").value,
        focus: +$("#bt-focus").value,
        stress: +$("#bt-stress").value,
        device: localStorage.getItem(LS.device) || "",
        headphones: localStorage.getItem(LS.phones) || "",
        volume_setting: localStorage.getItem(LS.volume) || "",
        notes: $("#bt-notes").value.trim(),
      };
      startSession({ label: $("#bt-label").value.trim() || "(unlabelled)", meta, practice: false, moduleIds: ids });
    });
  }

  function slider(id, label, def) {
    return `<div class="bt-slider"><span>${label}</span>
      <input id="bt-${id}" type="range" min="1" max="10" value="${def}"><output>${def}</output></div>`;
  }
  function numOrNull(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---- practice menu ----
  function renderPracticeMenu() {
    view = "practice";
    shell(`
      <button class="bt-back" id="bt-back">‹ Battery</button>
      <h1 class="bt-title">Practice</h1>
      <p class="bt-sub">Feedback on, nothing saved to the dataset. Repeat these until the tasks are boring — every bit of "learning the interface" you do here is improvement you will <i>not</i> mistake for an effect of the blindfold later.</p>
      <div class="bt-cards">
        ${MODULES.map((m) => `<button class="bt-card" data-mod="${m.id}">
          <div class="bt-card-t">${m.title}</div>
          <div class="bt-card-b">${m.blurb}</div>
        </button>`).join("")}
        <button class="bt-card go" data-mod="__all">
          <div class="bt-card-t">All core modules, short</div>
          <div class="bt-card-b">A dry run of the whole sequence at practice length.</div>
        </button>
      </div>
    `);
    $("#bt-back").addEventListener("click", renderHome);
    root.querySelectorAll("[data-mod]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.mod;
      const ids = id === "__all" ? CORE_MODULES.map((m) => m.id) : [id];
      startSession({ label: `Practice — ${id === "__all" ? "all" : id}`, meta: {}, practice: true, moduleIds: ids });
    }));
  }

  // =========================================================================
  // Session lifecycle
  // =========================================================================
  async function startSession({ label, meta, practice, moduleIds }) {
    await A.ensureEngine();
    const persisted = await requestPersistentStorage();
    const mods = practice && moduleIds.length === 1
      ? MODULES.filter((m) => m.id === moduleIds[0])
      : modulesFor(moduleIds);

    session = {
      session_id: uid(),
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ended_at: null,
      status: "in_progress",
      is_practice: !!practice,
      label,
      seed: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      battery_version: BATTERY_VERSION,
      module_ids: mods.map((m) => m.id),
      meta,
      calibration: A.audioConfig(),
      env: Object.assign(envInfo(), { origin: location.origin, storage_persisted: persisted }),
      progress: { module_index: 0, trial_index: 0, module_state: null },
      summary: {},
      modules_completed: [],
      n_trials: 0,
    };
    if (!practice) await store.putSession(session);   // practice never touches the store
    runner = { mods, moduleIndex: 0, trialIndex: 0, run: null, trials: [], globalIndex: 0 };
    await runLoop();
  }

  async function resumeSession(sess) {
    await A.ensureEngine();
    session = sess;
    const mods = modulesFor(sess.module_ids);
    const prior = await store.trialsFor(sess.session_id);
    runner = {
      mods,
      moduleIndex: sess.progress.module_index || 0,
      trialIndex: sess.progress.trial_index || 0,
      run: null,
      trials: prior,
      globalIndex: prior.length,
      restoreState: sess.progress.module_state || null,
    };
    await runLoop();
  }

  /**
   * Per-module and per-trial RNG streams are reseeded deterministically, so a
   * resumed session generates exactly the stimuli it would have generated had
   * it never been interrupted.
   */
  function makeSwappableRng(seedBase) {
    let cur = makeRng(seedBase);
    const fn = () => cur();
    fn.int = (n) => cur.int(n);
    fn.range = (a, b) => cur.range(a, b);
    fn.logRange = (a, b) => cur.logRange(a, b);
    fn.pick = (a) => cur.pick(a);
    fn.sign = () => cur.sign();
    fn.bool = () => cur.bool();
    fn.reseed = (s) => { cur = makeRng(s); };
    return fn;
  }

  function totalPlanned() {
    return runner.mods.reduce((a, m) => a + m.count(session.is_practice), 0);
  }
  function completedCount() { return runner.globalIndex; }

  function renderRunScreen(mod) {
    view = "run";
    const total = totalPlanned();
    const done = completedCount();
    const pct = Math.round((done / Math.max(1, total)) * 100);
    shell(`
      <div class="bt-runhead">
        <div class="bt-runprog">Test <b>${runner.moduleIndex + 1}</b> of <b>${runner.mods.length}</b> — <b>${pct}%</b> complete</div>
        <div class="bt-runbar"><div class="bt-runbar-fill" id="bt-bar" style="width:${pct}%"></div></div>
        <div class="bt-runmeta">
          <span id="bt-modname">${mod.title}</span>
          <span id="bt-remain">≈ ${Math.max(0, total - done)} trials remaining</span>
        </div>
      </div>
      <div class="bt-stage">
        <div class="bt-receipt" id="bt-receipt"></div>
        <div class="bt-status" id="bt-status">…</div>
        <div class="bt-promptline" id="bt-prompt"></div>
        <div class="bt-feedback" id="bt-feedback"></div>
        <div class="bt-choices" id="bt-choices"></div>
        <div class="bt-pcwrap" id="bt-pcwrap">
          <div class="bt-pcneed" id="bt-pcneed"></div>
          <div class="bt-pcgrid" id="bt-pcgrid"></div>
          <div class="bt-entered" id="bt-entered">—</div>
        </div>
      </div>
      <div class="bt-runfoot">
        <span class="bt-keys">${mod.keysHint}</span>
        <button class="bt-btn ghost small" id="bt-pause">Pause</button>
      </div>
    `, "running");
    $("#bt-pause").addEventListener("click", () => { pauseRequested = true; showPauseHint(); });
  }

  function updateProgress() {
    const total = totalPlanned(), done = completedCount();
    const pct = Math.round((done / Math.max(1, total)) * 100);
    const bar = $("#bt-bar"); if (bar) bar.style.width = `${pct}%`;
    const rp = root.querySelector(".bt-runprog");
    if (rp) rp.innerHTML = `Test <b>${runner.moduleIndex + 1}</b> of <b>${runner.mods.length}</b> — <b>${pct}%</b> complete`;
    const rem = $("#bt-remain"); if (rem) rem.textContent = `≈ ${Math.max(0, total - done)} trials remaining`;
  }

  function showPauseHint() {
    const e = $("#bt-prompt");
    if (e) e.innerHTML = `<span class="bt-pausing">Pausing after this trial…</span>`;
  }

  async function renderInstructions(mod) {
    view = "instr";
    shell(`
      <div class="bt-instr">
        <div class="bt-instr-step">Test ${runner.moduleIndex + 1} of ${runner.mods.length}</div>
        <h1 class="bt-title">${mod.title}</h1>
        <ul class="bt-instr-list">${mod.instructions.map((l) => `<li>${l}</li>`).join("")}</ul>
        <div class="bt-keys big">${mod.keysHint}</div>
        <div class="bt-promptline" id="bt-prompt"></div>
        <div class="bt-choices" id="bt-choices"></div>
      </div>
    `);
    say(mod.instructions.join(" "));               // not awaited: space can cut it short
    await io.awaitGo("Press space when you are ready");
    shutUp();
  }

  async function renderBreak() {
    view = "break";
    A.stopAll();
    const total = totalPlanned(), done = completedCount();
    shell(`
      <div class="bt-break">
        <h1 class="bt-title">Break</h1>
        <p class="bt-sub">Test ${runner.moduleIndex} of ${runner.mods.length} done. Stretch, drink something, take as long as you want — the clock is not part of the measurement.</p>
        <div class="bt-runbar"><div class="bt-runbar-fill" style="width:${Math.round((done / Math.max(1, total)) * 100)}%"></div></div>
        <div class="bt-promptline" id="bt-prompt"></div>
        <div class="bt-choices" id="bt-choices"></div>
        <button class="bt-btn ghost small" id="bt-quit">Pause and leave</button>
      </div>
    `);
    $("#bt-quit").addEventListener("click", () => { aborted = true; pending = null; renderHome(); });
    await say("Break. Press space when you are ready to continue.");
    await io.awaitGo("Press space to continue");
  }

  async function renderPause() {
    view = "pause";
    A.stopAll();
    shutUp();
    return new Promise((resolve) => {
      shell(`
        <div class="bt-break">
          <h1 class="bt-title">Paused</h1>
          <p class="bt-sub">Everything up to this point is saved. You can close the tab and resume later from the battery home screen.</p>
          <div class="bt-row center">
            <button class="bt-btn primary" id="bt-resume2">Resume</button>
            <button class="bt-btn ghost" id="bt-leave">Leave (resume later)</button>
          </div>
        </div>
      `);
      $("#bt-resume2").addEventListener("click", () => { pauseRequested = false; resolve("resume"); });
      $("#bt-leave").addEventListener("click", () => { aborted = true; resolve("leave"); });
    });
  }

  async function runLoop() {
    aborted = false;
    pauseRequested = false;

    while (runner.moduleIndex < runner.mods.length) {
      const mod = runner.mods[runner.moduleIndex];

      if (!runner.run) {
        const rng = makeSwappableRng(`${session.seed}:${mod.id}:plan`);
        runner.run = mod.make({ rng, practice: session.is_practice, io, seed: session.seed });
        runner.run._rng = rng;
        if (runner.restoreState) { try { runner.run.restore(runner.restoreState); } catch (_) {} runner.restoreState = null; }
        if (runner.trialIndex === 0) await renderInstructions(mod);
        if (aborted) return;
        renderRunScreen(mod);
      }

      while (runner.trialIndex < runner.run.total) {
        if (aborted) return;
        const canPause = !runner.run.pauseSafe || runner.run.pauseSafe(runner.trialIndex);
        if (pauseRequested && canPause) {
          io.stopCollectSpace();
          const what = await renderPause();
          if (what === "leave" || aborted) { await saveProgress(); return renderHome(); }
          renderRunScreen(mod);
        }

        const i = runner.trialIndex;
        runner.run._rng.reseed(`${session.seed}:${mod.id}:t${i}`);

        const tStart = performance.now();
        const tStartIso = new Date().toISOString();
        let part;
        try {
          part = await runner.run.runTrial(i);
        } catch (err) {
          console.error("Battery trial error", mod.id, i, err);
          part = { stim: { error: String(err && err.message || err) }, correct: null, response: null, rt_ms: null };
        }
        if (aborted) return;

        const trial = Object.assign({
          trial_uid: uid(),
          session_id: session.session_id,
          session_label: session.label,
          is_practice: session.is_practice,
          module: mod.id,
          module_title: mod.title,
          trial_index: i,
          global_index: runner.globalIndex,
          block: null,
          seed: `${session.seed}:${mod.id}:t${i}`,
          ts_trial_start: tStartIso,
          ts_trial_end: new Date().toISOString(),
          trial_duration_ms: +(performance.now() - tStart).toFixed(1),
          battery_version: BATTERY_VERSION,
          difficulty: null, adaptive: null, extra: null,
          input_method: null, timed_out: false,
        }, part);

        runner.trials.push(trial);
        runner.globalIndex++;
        runner.trialIndex++;
        if (!session.is_practice) await store.putTrial(trial);
        updateProgress();
        await saveProgress();
        await A.sleep(session.is_practice ? 900 : 550);   // inter-trial interval
      }

      // Module finished.
      const modTrials = runner.trials.filter((t) => t.module === mod.id);
      try { session.summary[mod.id] = runner.run.summary(modTrials); } catch (err) { console.error(err); }
      session.modules_completed = [...new Set([...(session.modules_completed || []), mod.id])];
      runner.moduleIndex++;
      runner.trialIndex = 0;
      runner.run = null;
      await saveProgress();

      if (runner.moduleIndex < runner.mods.length) {
        await renderBreak();
        if (aborted) return;
      }
    }

    await finishSession();
  }

  async function saveProgress() {
    if (!session || session.is_practice) return;
    session.progress = {
      module_index: runner.moduleIndex,
      trial_index: runner.trialIndex,
      module_state: runner.run ? safeSerialize(runner.run) : null,
    };
    session.n_trials = runner.globalIndex;
    try { await store.putSession(session); } catch (err) { console.error("session save failed", err); }
  }
  function safeSerialize(run) { try { return run.serialize(); } catch (_) { return null; } }

  async function finishSession() {
    view = "done";
    A.stopAll();
    session.status = "complete";
    session.ended_at = new Date().toISOString();
    session.n_trials = runner.globalIndex;

    let backupName = null;
    if (!session.is_practice) {
      await store.putSession(session);
      // Belt and braces: IndexedDB can be evicted, and this experiment cannot be
      // re-run. A file on disk is the copy that survives anything.
      backupName = `battery-${stamp()}-${(session.label || "session").replace(/[^\w-]+/g, "_")}.json`;
      try {
        download(backupName, JSON.stringify({ session, trials: runner.trials }, null, 2), "application/json");
      } catch (err) { console.error(err); backupName = null; }
    }

    const mins = ((new Date(session.ended_at) - new Date(session.started_at)) / 60000).toFixed(1);
    shell(`
      <div class="bt-done">
        <div class="bt-done-mark">✓</div>
        <h1 class="bt-title">${session.is_practice ? "Practice complete." : "Session complete. Data saved."}</h1>
        <p class="bt-sub">${session.is_practice
          ? "Nothing from a practice run enters the dataset."
          : `${runner.globalIndex} trials · ${mins} minutes${backupName ? ` · backup file <b>${esc(backupName)}</b> saved to your Downloads` : ""}`}</p>
        ${session.is_practice ? "" : `<p class="bt-note center">No results are shown during the experiment. That is deliberate — knowing how a session went would change how you approach the next one.</p>`}
        <button class="bt-btn primary" id="bt-done-home">Back to battery</button>
      </div>
    `);
    await say(session.is_practice ? "Practice complete." : "Session complete. Data saved.");
    $("#bt-done-home").addEventListener("click", renderHome);
    session = null; runner = null;
  }

  // =========================================================================
  // Admin / results
  // =========================================================================
  function openAdmin() {
    view = "admin";
    A.stopAll();
    renderResults(root, {
      onBack: renderHome,
      exportCsv: async () => {
        const [sessions, trials] = await Promise.all([store.allSessions(), store.allTrials()]);
        const real = trials.filter((t) => !t.is_practice);
        download(`battery-trials-${stamp()}.csv`, toCsv(real.map(flattenTrial)), "text/csv");
        download(`battery-sessions-${stamp()}.csv`, toCsv(sessions.filter((s) => !s.is_practice).map(flattenSession)), "text/csv");
      },
      exportJson: async () => {
        const [sessions, trials] = await Promise.all([store.allSessions(), store.allTrials()]);
        download(`battery-all-${stamp()}.json`, JSON.stringify({
          exported_at: new Date().toISOString(), battery_version: BATTERY_VERSION,
          sessions, trials,
        }, null, 2), "application/json");
      },
    });
  }

  // =========================================================================
  // Tab lifecycle
  // =========================================================================
  window.addEventListener("keydown", onKeyDown);

  return {
    async enter(opts) {
      active = true;
      ctx.setStatus("Testing Battery");
      if (ctx.setMidiHandler) ctx.setMidiHandler(onMidi);
      if (opts && opts.admin) openAdmin(); else renderHome();
    },
    exit() {
      active = false;
      pending = null;
      spaceCollector = null;
      aborted = true;
      A.stopAll();
      shutUp();
      if (ctx.clearMidiHandler) ctx.clearMidiHandler();
    },
    openAdmin,
  };
}
