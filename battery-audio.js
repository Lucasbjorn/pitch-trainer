// Testing Battery — audio engine.
//
// Deliberately does NOT use Tone.js. Every experimental stimulus is synthesized
// straight into a Float32Array and handed to an AudioBufferSourceNode, because
// psychophysics needs three things Tone's synth graph can't guarantee:
//
//   1. Exact RMS — so loudness never becomes an accidental cue (critical for the
//      harmonicity task, where a level difference would give the answer away).
//   2. Exact envelopes — raised-cosine ramps in the sample data, so there is no
//      oscillator-start click and no attack-transient artifact.
//   3. Exact onset time — AudioBufferSourceNode.start(t) is sample-accurate, and
//      getOutputTimestamp() maps that to the performance.now() clock so reaction
//      times are measured from the real acoustic onset, not from the JS call.
//
// One AudioContext for the whole battery, one master gain that is set once at
// calibration and never touched again.

export const PREFERRED_SR = 48000;

// Reference RMS for a single tone (~-22 dBFS). Everything is normalized to this
// or to a multiple of it, so the master gain and the OS volume are the only
// things that determine loudness. Leaves >20 dB of peak headroom.
export const REF_RMS = 0.08;

let engine = null;

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------
export function getEngine() { return engine; }

export async function ensureEngine() {
  if (engine) {
    if (engine.ctx.state === "suspended") { try { await engine.ctx.resume(); } catch (_) {} }
    return engine;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx;
  // Forcing 48 kHz keeps stimulus rendering bit-identical across machines. If
  // the device refuses, fall back and log whatever rate we actually got.
  try { ctx = new AC({ sampleRate: PREFERRED_SR, latencyHint: "interactive" }); }
  catch (_) { ctx = new AC({ latencyHint: "interactive" }); }
  try { await ctx.resume(); } catch (_) {}
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  engine = { ctx, master, sr: ctx.sampleRate, live: new Set() };
  return engine;
}

export function audioConfig() {
  if (!engine) return null;
  const { ctx } = engine;
  return {
    sample_rate: ctx.sampleRate,
    base_latency_s: ctx.baseLatency ?? null,
    output_latency_s: ctx.outputLatency ?? null,
    state: ctx.state,
    max_channels: ctx.destination.maxChannelCount,
    master_gain: engine.master.gain.value,
    ref_rms: REF_RMS,
    forced_sr: ctx.sampleRate === PREFERRED_SR,
  };
}

/** Stop every scheduled source. Used on pause, module abort and tab exit. */
export function stopAll() {
  if (!engine) return;
  for (const src of engine.live) { try { src.stop(); } catch (_) {} try { src.disconnect(); } catch (_) {} }
  engine.live.clear();
}

// ---------------------------------------------------------------------------
// Clock bridge: AudioContext time -> performance.now() time
//
// getOutputTimestamp() pairs "the frame leaving the output device right now"
// with the performance clock, so it already includes output latency. That pair
// is the only correct way to say when a scheduled buffer will actually be heard.
// ---------------------------------------------------------------------------
export function perfTimeForCtxTime(t) {
  const { ctx } = engine;
  let ts = null;
  try { ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null; } catch (_) {}
  if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
    return ts.performanceTime + (t - ts.contextTime) * 1000;
  }
  const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  return performance.now() + (t - ctx.currentTime + lat) * 1000;
}

/** Scheduling lead. Long enough to never glitch, short enough to feel instant. */
export const LEAD_S = 0.09;

export function nextSlot() { return engine.ctx.currentTime + LEAD_S; }

// ---------------------------------------------------------------------------
// DSP primitives
// ---------------------------------------------------------------------------
export function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
export function centsShift(f, cents) { return f * Math.pow(2, cents / 1200); }
export function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
export function dbToGain(db) { return Math.pow(10, db / 20); }

/** Raised-cosine (Hann) attack/release applied in-place. No clicks, ever. */
export function applyRamps(x, sr, attackMs, releaseMs) {
  const n = x.length;
  const a = Math.min(n >> 1, Math.max(1, Math.round((sr * attackMs) / 1000)));
  const r = Math.min(n >> 1, Math.max(1, Math.round((sr * releaseMs) / 1000)));
  for (let i = 0; i < a; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
  for (let i = 0; i < r; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / r);
}

// Deterministic phase per partial index. Random phases would change the crest
// factor from render to render; all-zero phases would stack into an impulsive
// peak. This rule is reproducible and keeps partials decorrelated, so the
// harmonic and inharmonic tokens of a trial are treated identically.
function phaseFor(k) { return ((k * k * 0.7139 + k * 0.3271) % 1) * 2 * Math.PI; }

/**
 * Additive synthesis.
 * @param partials [{ freq, amp }]
 * @param opt { attackMs, releaseMs, decayTau } decayTau in seconds = struck decay
 */
export function synthPartials(sr, durMs, partials, opt = {}) {
  const n = Math.max(1, Math.round((sr * durMs) / 1000));
  const x = new Float32Array(n);
  for (let p = 0; p < partials.length; p++) {
    const { freq, amp } = partials[p];
    if (!(freq > 0) || freq >= sr / 2 || !(amp > 0)) continue;
    const w = (2 * Math.PI * freq) / sr;
    const ph = phaseFor(p + 1);
    for (let i = 0; i < n; i++) x[i] += amp * Math.sin(w * i + ph);
  }
  if (opt.decayTau) {
    const k = -1 / (sr * opt.decayTau);
    for (let i = 0; i < n; i++) x[i] *= Math.exp(k * i);
  }
  applyRamps(x, sr, opt.attackMs ?? 15, opt.releaseMs ?? 30);
  return x;
}

export function rmsOf(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}
export function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return p;
}

/** Scale to an exact RMS. Returns measurements worth logging per stimulus. */
export function normalizeRms(x, target = REF_RMS) {
  const rms = rmsOf(x) || 1e-9;
  const g = target / rms;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  let peak = peakOf(x);
  let limited = false;
  if (peak > 0.97) {                       // must never happen; log it if it does
    const s = 0.97 / peak;
    for (let i = 0; i < x.length; i++) x[i] *= s;
    peak = 0.97; limited = true;
  }
  return { applied_gain: g, target_rms: target, peak, limited };
}

export function mixInto(dst, src, offsetSamples, gain = 1) {
  const off = Math.round(offsetSamples);
  const n = Math.min(src.length, dst.length - off);
  for (let i = 0; i < n; i++) dst[off + i] += src[i] * gain;
}

// ---------------------------------------------------------------------------
// Timbres for the note-naming task.
//
// Three synthetic timbres rather than real instrument samples: they are exactly
// reproducible, identically levelled, and they stop him leaning on one
// instrument's remembered character instead of the pitch itself.
// ---------------------------------------------------------------------------
export const TIMBRES = ["sine", "organ", "struck"];

export function timbrePartials(name, f0) {
  if (name === "sine") return { partials: [{ freq: f0, amp: 1 }], opt: { attackMs: 25, releaseMs: 45 } };
  if (name === "organ") {
    const partials = [];
    for (let k = 1; k <= 8; k++) partials.push({ freq: f0 * k, amp: 1 / k });
    return { partials, opt: { attackMs: 25, releaseMs: 45 } };
  }
  // struck: piano-like, with the slight stiffness stretch real strings have.
  const B = 0.0003;
  const partials = [];
  for (let k = 1; k <= 12; k++) {
    partials.push({ freq: f0 * k * Math.sqrt(1 + B * k * k), amp: 1 / Math.pow(k, 1.2) });
  }
  return { partials, opt: { attackMs: 5, releaseMs: 40, decayTau: 0.75 } };
}

export function renderTone({ freq, durMs = 1000, timbre = "organ", rms = REF_RMS }) {
  const { sr } = engine;
  const { partials, opt } = timbrePartials(timbre, freq);
  const x = synthPartials(sr, durMs, partials, opt);
  const meas = normalizeRms(x, rms);
  return { data: x, meas, durMs };
}

/** Pure sine — the workhorse for discrimination, memory and masking stimuli. */
export function renderSine({ freq, durMs = 500, rms = REF_RMS, attackMs = 20, releaseMs = 20 }) {
  const { sr } = engine;
  const x = synthPartials(sr, durMs, [{ freq, amp: 1 }], { attackMs, releaseMs });
  const meas = normalizeRms(x, rms);
  return { data: x, meas, durMs };
}

// ---------------------------------------------------------------------------
// Harmonic / inharmonic complexes
//
// Jitter method follows the standard inharmonicity paradigm: each partial's
// harmonic number n is perturbed by j_n ~ U(-J, +J), so f_n = (n + j_n) * F0.
// Adjacent partials are kept at least MIN_SPACING_HZ apart so the manipulation
// can't collapse two partials into an obvious beating pair. Both intervals of a
// trial are RMS-matched, so level is never a cue.
// ---------------------------------------------------------------------------
const MIN_SPACING_HZ = 30;

export function jitteredPartialNumbers(nPartials, jitter, rand) {
  const nums = [1];                              // F0 stays put: pitch is not the cue
  for (let n = 2; n <= nPartials; n++) nums.push(n + (rand() * 2 - 1) * jitter);
  return nums;
}

export function renderComplex({ f0, nPartials = 12, partialNumbers = null, durMs = 700, rms = REF_RMS, attackMs = 25, releaseMs = 35 }) {
  const { sr } = engine;
  const nums = partialNumbers || Array.from({ length: nPartials }, (_, i) => i + 1);
  const freqs = nums.map((n) => n * f0);
  // Enforce minimum spacing so inharmonicity never degenerates into a beat cue.
  for (let i = 1; i < freqs.length; i++) {
    if (freqs[i] - freqs[i - 1] < MIN_SPACING_HZ) freqs[i] = freqs[i - 1] + MIN_SPACING_HZ;
  }
  const partials = freqs.map((f, i) => ({ freq: f, amp: 1 / Math.pow(i + 1, 1.0) }));
  const x = synthPartials(sr, durMs, partials, { attackMs, releaseMs });
  const meas = normalizeRms(x, rms);
  return { data: x, meas, durMs, freqs, partial_numbers: nums };
}

/** Equal-amplitude simultaneous notes, whole mixture normalized to one RMS. */
export function renderChord({ freqs, durMs = 2000, rms = REF_RMS * 1.6, nPartials = 6 }) {
  const { sr } = engine;
  const partials = [];
  for (const f of freqs) {
    for (let k = 1; k <= nPartials; k++) partials.push({ freq: f * k, amp: 1 / (k * freqs.length) });
  }
  const x = synthPartials(sr, durMs, partials, { attackMs: 30, releaseMs: 60 });
  const meas = normalizeRms(x, rms);
  return { data: x, meas, durMs };
}

/**
 * Scramble tones — a short burst of random non-12-TET tones used to flush
 * echoic pitch memory between trials. Without this, a note-naming test becomes
 * an interval-naming test: he just compares to whatever he heard last.
 */
export function renderScramble({ n = 6, toneMs = 140, loHz = 220, hiHz = 1200, rand = Math.random, rms = REF_RMS * 0.8 }) {
  const { sr } = engine;
  const total = n * toneMs;
  const out = new Float32Array(Math.round((sr * total) / 1000));
  const freqs = [];
  for (let i = 0; i < n; i++) {
    const f = loHz * Math.pow(hiHz / loHz, rand());   // log-uniform, continuous
    freqs.push(f);
    const t = synthPartials(sr, toneMs, [{ freq: f, amp: 1 }, { freq: f * 2, amp: 0.3 }], { attackMs: 12, releaseMs: 20 });
    mixInto(out, t, (sr * i * toneMs) / 1000);
  }
  const meas = normalizeRms(out, rms);
  return { data: out, meas, durMs: total, freqs };
}

/** Short broadband click. Never varies with correctness — it is a receipt, not feedback. */
export function renderClick({ durMs = 22, rand = Math.random, rms = REF_RMS * 0.5 }) {
  const { sr } = engine;
  const n = Math.round((sr * durMs) / 1000);
  const x = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) { lp = 0.6 * lp + 0.4 * (rand() * 2 - 1); x[i] = lp; }
  applyRamps(x, sr, 3, durMs - 4);
  normalizeRms(x, rms);
  return { data: x, durMs };
}

export function renderNoise({ durMs = 1500, rms = REF_RMS, rand = Math.random }) {
  const { sr } = engine;
  const n = Math.round((sr * durMs) / 1000);
  const x = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) { lp = 0.85 * lp + 0.15 * (rand() * 2 - 1); x[i] = lp; }
  applyRamps(x, sr, 40, 40);
  normalizeRms(x, rms);
  return { data: x, durMs };
}

// ---------------------------------------------------------------------------
// Buffer assembly + playback
// ---------------------------------------------------------------------------
export function toBuffer(mono) {
  const { ctx, sr } = engine;
  const b = ctx.createBuffer(1, mono.length, sr);
  b.copyToChannel(mono, 0);
  return b;
}

/** Stereo from separate channels. Used for ITD/ILD spatial separation. */
export function toStereoBuffer(left, right) {
  const { ctx, sr } = engine;
  const n = Math.max(left.length, right.length);
  const b = ctx.createBuffer(2, n, sr);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  L.set(left.subarray(0, Math.min(left.length, n)));
  R.set(right.subarray(0, Math.min(right.length, n)));
  return b;
}

/** Left-only tone, for the headphone channel check. */
export function toPannedBuffer(mono, side) {
  const { ctx, sr } = engine;
  const b = ctx.createBuffer(2, mono.length, sr);
  if (side !== "right") b.copyToChannel(mono, 0);
  if (side !== "left") b.copyToChannel(mono, 1);
  return b;
}

/**
 * Schedule a buffer. Returns the acoustic onset on the performance clock, which
 * is what every reaction time in the battery is measured from.
 */
export function playAt(buffer, ctxTime) {
  const { ctx, master, live } = engine;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(master);
  const t = ctxTime != null ? ctxTime : nextSlot();
  src.start(t);
  live.add(src);
  src.onended = () => { live.delete(src); try { src.disconnect(); } catch (_) {} };
  return {
    src,
    ctxTime: t,
    onsetPerf: perfTimeForCtxTime(t),
    endPerf: perfTimeForCtxTime(t + buffer.duration),
    durMs: buffer.duration * 1000,
  };
}

export function playMono(mono, ctxTime) { return playAt(toBuffer(mono), ctxTime); }

/** Resolves when the audio has finished, using the audio clock rather than setTimeout. */
export function waitFor(handle, extraMs = 0) {
  const ms = Math.max(0, handle.endPerf - performance.now() + extraMs);
  return new Promise((r) => setTimeout(r, ms));
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
