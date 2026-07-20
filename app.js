// Pitch Trainer — vanilla ES module, no build step.
// See PLAN.md for the passive-mode spec. Quiz modes and the multi-sample bank
// are later additions; all sample playback now flows through SampleBank.

import { PitchDetector } from "https://esm.sh/pitchy@4";
import * as Tone from "https://esm.sh/tone@14";
import { setupLearn } from "./learn.js";
import { setupPractice } from "./practice.js";
import { setupTune } from "./tune.js";
import { setupYesNo } from "./yesno.js";
import { setupStats } from "./stats.js";
import { setupApGames } from "./apgames.js";
import { setupMicrotone } from "./microtone.js";
import { setupHub } from "./hub.js";

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const CONFIG = {
  minFreq: 35,
  maxFreq: 2400,
  minClarity: 0.85,
  minAmplitude: 0.01,
  stabilityMs: 100,             // back to the calm value from the spec
  retriggerCooldownMs: 0,
  sameNoteRetriggerMs: 2000,    // keep: holding same pitch 2s → refires
  silenceRetriggerMs: 250,      // calmer: brief dropouts no longer clear latch
  fftSize: 2048,
  sampleOctave: 4,
  releaseDuration: "2n",
};

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Fallback if samples/manifest.json is missing or malformed.
const DEFAULT_MANIFEST = {
  "C":  ["c.wav"],  "C#": ["cs.wav"],
  "D":  ["d.wav"],  "D#": ["ds.wav"],
  "E":  ["e.wav"],  "F":  ["f.wav"],
  "F#": ["fs.wav"], "G":  ["g.wav"],
  "G#": ["gs.wav"], "A":  ["a.wav"],
  "A#": ["as.wav"], "B":  ["b.wav"],
};

async function loadManifest() {
  try {
    const r = await fetch("samples/manifest.json", { cache: "no-cache" });
    if (!r.ok) return DEFAULT_MANIFEST;
    const data = await r.json();
    for (const pc of PITCH_NAMES) {
      if (!Array.isArray(data[pc]) || data[pc].length === 0) {
        data[pc] = DEFAULT_MANIFEST[pc];
      }
    }
    return data;
  } catch (_) {
    return DEFAULT_MANIFEST;
  }
}

// ---------------------------------------------------------------------------
// SampleBank — buffers per pitch class (possibly multiple variants), played
// via Tone.ToneBufferSource instances so we can set playbackRate per trigger
// and pick a specific sample to play (vs Tone.Sampler's nearest-note lookup).
// ---------------------------------------------------------------------------
class SampleBank {
  constructor() {
    this.buffers = {};   // { pc: Tone.ToneAudioBuffer[] (indexed to manifest) }
    this.baseFreq = {};  // { pc: Hz for pc+sampleOctave }
    this.octave = null;
  }
  async load(manifest, octave) {
    this.octave = octave;
    const jobs = [];
    for (const pc of PITCH_NAMES) {
      const files = manifest[pc];
      this.buffers[pc] = new Array(files.length);
      this.baseFreq[pc] = Tone.Frequency(`${pc}${octave}`).toFrequency();
      files.forEach((file, i) => {
        const buf = new Tone.ToneAudioBuffer();
        jobs.push(
          buf.load(`samples/${file}`).then(() => {
            this.buffers[pc][i] = buf;
          }).catch((err) => {
            throw new Error(`samples/${file}: ${err && err.message ? err.message : err}`);
          })
        );
      });
    }
    await Promise.all(jobs);
  }
  variantCount(pc) {
    return (this.buffers[pc] || []).length;
  }
  play(pc, { playbackRate = 1, variantIdx = null, stopAfter = null, volume = 0 } = {}) {
    const bufs = this.buffers[pc];
    if (!bufs || bufs.length === 0) return null;
    const idx = variantIdx != null ? variantIdx : Math.floor(Math.random() * bufs.length);
    const buf = bufs[idx];
    if (!buf) return null;
    const gain = new Tone.Gain(Tone.dbToGain(volume)).toDestination();
    const src = new Tone.ToneBufferSource({
      url: buf,
      playbackRate,
      fadeOut: 0.05,
    }).connect(gain);
    const now = Tone.now();
    src.start(now);
    if (stopAfter) {
      try { src.stop(now + Tone.Time(stopAfter).toSeconds()); } catch (_) {}
    }
    src.onended = () => {
      try { src.dispose(); } catch (_) {}
      try { gain.dispose(); } catch (_) {}
    };
    return { variantIdx: idx };
  }
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $note       = document.getElementById("note");
const $debug      = document.getElementById("debug");
const $start      = document.getElementById("start");
const $status     = document.getElementById("status");
const $quiz       = document.getElementById("quiz");
const $quizScore  = document.getElementById("quiz-score");
const $quizResult = document.getElementById("quiz-result");
const $quizReplay = document.getElementById("quiz-replay");
const $quizNext   = document.getElementById("quiz-next");
const $modeBtns   = document.querySelectorAll(".mode-btn");
const $submodeBtns = document.querySelectorAll(".submode-btn");
const $ansSample  = document.getElementById("ans-sample");
const $ansPitch   = document.getElementById("ans-pitch");
const $ansAmount  = document.getElementById("ans-amount");
const $followup   = document.getElementById("followup");
const $followupBtns = document.getElementById("followup-btns");
const $followupSkip = document.getElementById("followup-skip");

// Intervals mode DOM
const $intervals       = document.getElementById("intervals");
const $intervalType    = document.getElementById("interval-type");
const $intervalsScore  = document.getElementById("intervals-score");
const $intervalsResult = document.getElementById("intervals-result");
const $intervalsRoots  = document.getElementById("intervals-roots");
const $intervalsHint   = document.getElementById("intervals-hint");
const $intervalsReplay = document.getElementById("intervals-replay");
const $intervalsNext   = document.getElementById("intervals-next");

// Learn + Practice + Tune containers
const $learn    = document.getElementById("learn");
const $practice = document.getElementById("practice");
const $tune     = document.getElementById("tune");
const $yesno    = document.getElementById("yesno");
const $stats    = document.getElementById("stats");
const $apgames  = document.getElementById("apgames");
const $microtone = document.getElementById("microtone");

// ---------------------------------------------------------------------------
// Shared sample bank (lazy; created on first mode init)
// ---------------------------------------------------------------------------
let sampleBank = null;
async function ensureSampleBank() {
  if (sampleBank) return sampleBank;
  await Tone.start();
  Tone.getContext().lookAhead = 0;
  const manifest = await loadManifest();
  const bank = new SampleBank();
  await bank.load(manifest, CONFIG.sampleOctave);
  sampleBank = bank;
  return sampleBank;
}

// ---------------------------------------------------------------------------
// Mode state
// ---------------------------------------------------------------------------
let mode    = "passive";        // "passive" | "quiz" | "intervals"
let submode = "sample";         // "sample" | "pitch" | "amount"

// Passive mode audio-graph state.
let audioCtx   = null;
let stream     = null;
let source     = null;
let analyser   = null;
let detector   = null;
let buffer     = null;
let rafHandle  = null;
let running    = false;

// Pitch state machine (same names as PLAN.md).
let candidatePitchClass = null;
let candidateSince      = 0;
let latchedPitchClass   = null;
let armed               = true;
let lastTriggerTime     = 0;
let silenceSince        = 0;

function resetStateMachine() {
  candidatePitchClass = null;
  candidateSince      = 0;
  latchedPitchClass   = null;
  armed               = true;
  lastTriggerTime     = 0;
  silenceSince        = 0;
}

// Quiz state
let quiz = null;                // per-round data
let quizScore = { correct: 0, total: 0 };
let autoAdvanceHandle = null;

// Intervals state
let piano = null;
let pianoLoading = null;        // shared promise while loading
let intervals = null;           // per-round data
let intervalsScore = { correct: 0, total: 0 };

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setStatus(msg, isError = false) {
  $status.textContent = msg;
  $status.classList.toggle("error", isError);
}
function showStartButton() {
  $start.classList.remove("hidden");
  $start.disabled = false;
}
function hideStartButton() {
  $start.classList.add("hidden");
}
function clearDisplay() {
  $note.textContent = "—";
  $note.classList.add("idle");
  $debug.textContent = "freq: — Hz \u00a0 clarity: — \u00a0 rms: —";
}
function showPitch(name) {
  $note.textContent = name;
  $note.classList.remove("idle");
}
function showDebug(freq, clarity, rms) {
  $debug.textContent =
    `freq: ${freq.toFixed(1)} Hz \u00a0 clarity: ${clarity.toFixed(2)} \u00a0 rms: ${rms.toFixed(3)}`;
}
function updateScore() {
  $quizScore.textContent = `${quizScore.correct} / ${quizScore.total}`;
}
function showAnswerGroup(which) {
  $ansSample.classList.toggle("active", which === "sample");
  $ansPitch.classList.toggle("active",  which === "pitch");
  $ansAmount.classList.toggle("active", which === "amount");
}
function hideAllAnswerGroups() {
  $ansSample.classList.remove("active");
  $ansPitch.classList.remove("active");
  $ansAmount.classList.remove("active");
}

// ---------------------------------------------------------------------------
// Passive cleanup
// ---------------------------------------------------------------------------
async function cleanupPassive() {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (stream) {
    try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    stream = null;
  }
  if (source)   { try { source.disconnect(); }   catch (_) {} source = null; }
  if (analyser) { try { analyser.disconnect(); } catch (_) {} analyser = null; }
  if (audioCtx) { try { await audioCtx.close(); } catch (_) {} audioCtx = null; }
  resetStateMachine();
  detector = null;
  buffer   = null;
  running  = false;
  showStartButton();
  clearDisplay();
}

// ---------------------------------------------------------------------------
// Passive mode
// ---------------------------------------------------------------------------
async function initPassive() {
  if (running) return;
  running = true;
  $start.disabled = true;

  try {
    setStatus("Starting audio…");
    // Resume Tone's audio context inside this user gesture. Required because the
    // app may have preloaded the sample bank on load (opening on Learn), which
    // creates the context suspended; without this, sample playback is silent.
    await Tone.start();
    setStatus("Loading samples…");
    await ensureSampleBank();

    setStatus("Requesting microphone…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        throw new Error("Microphone access denied. Tap Start to retry.");
      }
      if (err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
        throw new Error("No microphone detected.");
      }
      throw new Error(`Microphone error: ${err && err.message ? err.message : err}`);
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source   = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = CONFIG.fftSize;
    source.connect(analyser);

    buffer   = new Float32Array(analyser.fftSize);
    detector = PitchDetector.forFloat32Array(analyser.fftSize);

    hideStartButton();
    setStatus("Listening");
    resetStateMachine();
    rafHandle = requestAnimationFrame(passiveLoop);
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? err.message : String(err);
    await cleanupPassive();
    setStatus(msg, true);
  }
}

function passiveLoop() {
  rafHandle = requestAnimationFrame(passiveLoop);
  if (!analyser || !detector || !buffer || !audioCtx) return;

  analyser.getFloatTimeDomainData(buffer);

  let sumSq = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / buffer.length);

  const [freq, clarity] = detector.findPitch(buffer, audioCtx.sampleRate);
  showDebug(freq, clarity, rms);

  const validPitch =
    rms >= CONFIG.minAmplitude &&
    clarity >= CONFIG.minClarity &&
    freq >= CONFIG.minFreq &&
    freq <= CONFIG.maxFreq;

  const now = performance.now();

  if (validPitch) {
    silenceSince = 0;
    const midi = 12 * Math.log2(freq / 440) + 69;
    const pc   = ((Math.round(midi) % 12) + 12) % 12;
    showPitch(PITCH_NAMES[pc]);

    if (pc === candidatePitchClass) {
      const stableLongEnough = now - candidateSince >= CONFIG.stabilityMs;
      const cooldownOk =
        CONFIG.retriggerCooldownMs === 0 ||
        now - lastTriggerTime >= CONFIG.retriggerCooldownMs;

      if (
        CONFIG.sameNoteRetriggerMs > 0 &&
        pc === latchedPitchClass &&
        now - lastTriggerTime >= CONFIG.sameNoteRetriggerMs
      ) {
        latchedPitchClass = null;
        armed = true;
      }

      if (stableLongEnough && armed && pc !== latchedPitchClass && cooldownOk) {
        try {
          sampleBank.play(PITCH_NAMES[pc], { stopAfter: CONFIG.releaseDuration });
        } catch (err) {
          console.error("Trigger error:", err);
        }
        latchedPitchClass = pc;
        armed             = false;
        lastTriggerTime   = now;
      }
    } else {
      candidatePitchClass = pc;
      candidateSince      = now;
      if (pc !== latchedPitchClass) armed = true;
    }
  } else {
    if (silenceSince === 0) silenceSince = now;
    if (
      CONFIG.silenceRetriggerMs > 0 &&
      now - silenceSince >= CONFIG.silenceRetriggerMs
    ) {
      latchedPitchClass = null;
    }
    candidatePitchClass = null;
    armed = true;
    $note.classList.add("idle");
  }
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------
async function initQuiz() {
  try {
    setStatus("Loading quiz samples…");
    await ensureSampleBank();
    setStatus(`Quiz — ${submodeLabel()}`);
    startQuizRound();
  } catch (err) {
    console.error(err);
    setStatus(err && err.message ? err.message : String(err), true);
  }
}

function submodeLabel() {
  return { sample: "Sample", pitch: "Pitch", amount: "Amount" }[submode] || submode;
}

function randPc()          { return Math.floor(Math.random() * 12); }
function randChoice(arr)   { return arr[Math.floor(Math.random() * arr.length)]; }
function pcName(i)         { return PITCH_NAMES[((i % 12) + 12) % 12]; }

function startQuizRound() {
  if (!sampleBank) return;

  cancelAutoAdvance();
  $quizResult.textContent = "";
  $quizResult.className   = "";
  $followup.classList.remove("active");
  $quizNext.classList.remove("visible");

  if (submode === "sample") {
    const labeledPc  = randPc();
    const isInTune   = Math.random() < 0.5;
    // Shift defaults to ±100c (1 semitone) so the discrimination is clear.
    // The ±50c quarter-tone was the reason the previous quiz felt easier to
    // judge on timbre — the sample was being swapped to a neighbor half the
    // time. Now we force the same sample and a larger shift.
    const shiftCents = isInTune ? 0 : (Math.random() < 0.5 ? 100 : -100);
    quiz = { submode, labeledPc, samplePc: labeledPc, shiftCents, isInTune, variantIdx: null, awaiting: "primary" };
    $note.textContent = PITCH_NAMES[labeledPc];
    $note.classList.remove("idle");
    showAnswerGroup("sample");
    playCurrent();
  } else if (submode === "pitch") {
    const labeledPc = randPc();
    const matches   = Math.random() < 0.5;
    let targetPc, microShift;
    if (matches) {
      targetPc   = labeledPc;
      microShift = 0;
    } else {
      // 60% different semitone (clearly wrong), 40% microtonal off from labeled.
      if (Math.random() < 0.6) {
        const delta = 1 + Math.floor(Math.random() * 11); // 1..11
        targetPc   = (labeledPc + delta) % 12;
        microShift = 0;
      } else {
        targetPc   = labeledPc;
        const mag  = randChoice([25, 50, 75]);
        microShift = (Math.random() < 0.5 ? 1 : -1) * mag;
      }
    }
    const samplePc = randPc(); // any sample — rate will be computed
    quiz = { submode, labeledPc, samplePc, targetPc, microShift, matches, variantIdx: null, awaiting: "primary" };
    $note.textContent = PITCH_NAMES[labeledPc];
    $note.classList.remove("idle");
    showAnswerGroup("pitch");
    playCurrent();
  } else if (submode === "amount") {
    const labeledPc  = randPc();
    const shiftCents = randChoice([-100, -50, 0, 50, 100]);
    quiz = { submode, labeledPc, samplePc: labeledPc, shiftCents, variantIdx: null, awaiting: "primary" };
    $note.textContent = PITCH_NAMES[labeledPc];
    $note.classList.remove("idle");
    showAnswerGroup("amount");
    playCurrent();
  }
}

function playCurrent() {
  if (!quiz || !sampleBank) return;
  try {
    let rate;
    if (quiz.submode === "pitch") {
      const targetFreq = sampleBank.baseFreq[pcName(quiz.targetPc)] * Math.pow(2, quiz.microShift / 1200);
      const sampleFreq = sampleBank.baseFreq[pcName(quiz.samplePc)];
      rate = targetFreq / sampleFreq;
    } else {
      rate = Math.pow(2, quiz.shiftCents / 1200);
    }
    const result = sampleBank.play(pcName(quiz.samplePc), {
      playbackRate: rate,
      variantIdx: quiz.variantIdx, // stable across replay once set
    });
    if (result && quiz.variantIdx == null) quiz.variantIdx = result.variantIdx;
  } catch (err) {
    console.error("Quiz trigger error:", err);
  }
}

function showFeedback(correct, message) {
  $quizResult.textContent = message;
  $quizResult.className   = correct ? "correct" : "wrong";
}

function onAnswerSample(userSaysInTune) {
  if (!quiz || quiz.awaiting !== "primary" || quiz.submode !== "sample") return;
  quiz.awaiting = null;
  quizScore.total++;
  const correct = userSaysInTune === quiz.isInTune;
  if (correct) quizScore.correct++;
  updateScore();
  showFeedback(
    correct,
    correct
      ? "Correct!"
      : `Nope — it was ${quiz.isInTune ? "in tune" : `off by ${quiz.shiftCents > 0 ? "+" : ""}${quiz.shiftCents}¢`}`
  );
  $quizNext.classList.add("visible");
  autoAdvance();
}

function onAnswerPitch(userSaysMatches) {
  if (!quiz || quiz.awaiting !== "primary" || quiz.submode !== "pitch") return;
  quizScore.total++;
  const correct = userSaysMatches === quiz.matches;
  if (correct) quizScore.correct++;
  updateScore();

  let msg;
  const heardName = PITCH_NAMES[quiz.targetPc] + (quiz.microShift
    ? ` (${quiz.microShift > 0 ? "+" : ""}${quiz.microShift}¢)`
    : "");
  if (quiz.matches) {
    msg = correct
      ? `Correct! Pitch was ${PITCH_NAMES[quiz.labeledPc]}.`
      : `Wrong — pitch did match the label (${PITCH_NAMES[quiz.labeledPc]}).`;
  } else {
    msg = correct
      ? `Correct! Heard ${heardName}, label was ${PITCH_NAMES[quiz.labeledPc]}.`
      : `Wrong — it didn't match. Heard ${heardName}.`;
  }
  showFeedback(correct, msg);

  // Follow-up: always ask what pitch they heard (reinforces pitch ID).
  quiz.awaiting = "followup";
  buildFollowupButtons();
  $followup.classList.add("active");
  $quizNext.classList.add("visible");
}

function buildFollowupButtons() {
  $followupBtns.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const b = document.createElement("button");
    b.className   = "answer-btn small";
    b.type        = "button";
    b.textContent = PITCH_NAMES[i];
    b.addEventListener("click", () => onFollowup(i));
    $followupBtns.appendChild(b);
  }
}

function onFollowup(pcGuess) {
  if (!quiz || quiz.awaiting !== "followup") return;
  quiz.awaiting = null;
  const correct = pcGuess === quiz.targetPc;
  const heardName = PITCH_NAMES[quiz.targetPc] + (quiz.microShift
    ? ` (${quiz.microShift > 0 ? "+" : ""}${quiz.microShift}¢)`
    : "");
  const prev = $quizResult.textContent;
  showFeedback(
    correct,
    `${prev} — pitch guess ${correct ? "right" : `wrong (said ${PITCH_NAMES[pcGuess]}, was ${heardName})`}`
  );
  autoAdvance(2500);
}

function onAnswerAmount(shiftGuess) {
  if (!quiz || quiz.awaiting !== "primary" || quiz.submode !== "amount") return;
  quiz.awaiting = null;
  quizScore.total++;
  const correct = shiftGuess === quiz.shiftCents;
  if (correct) quizScore.correct++;
  updateScore();
  showFeedback(
    correct,
    correct ? `Correct — ${amountLabel(quiz.shiftCents)}` : `Wrong — it was ${amountLabel(quiz.shiftCents)}`
  );
  $quizNext.classList.add("visible");
  autoAdvance();
}

function amountLabel(cents) {
  if (cents === 0) return "in tune";
  const dir = cents > 0 ? "↑" : "↓";
  const mag = Math.abs(cents);
  if (mag === 100) return `½ step ${dir}`;
  if (mag === 50)  return `¼ step ${dir}`;
  return `${cents}¢`;
}

function autoAdvance(ms = 1800) {
  cancelAutoAdvance();
  autoAdvanceHandle = setTimeout(() => {
    autoAdvanceHandle = null;
    startQuizRound();
  }, ms);
}
function cancelAutoAdvance() {
  if (autoAdvanceHandle) {
    clearTimeout(autoAdvanceHandle);
    autoAdvanceHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Intervals mode
// ---------------------------------------------------------------------------
const INTERVAL_LABELS = {
  1:  "m2",  2:  "M2",  3:  "m3",  4:  "M3",
  5:  "P4",  6:  "TT",  7:  "P5",  8:  "m6",
  9:  "M6",  10: "m7",  11: "M7",  12: "P8",
};

async function ensurePiano() {
  if (piano) return piano;
  if (pianoLoading) return pianoLoading;
  pianoLoading = (async () => {
    await Tone.start();
    Tone.getContext().lookAhead = 0;
    // Salamander piano samples via Tone.js CDN. Loading every 3 semis in
    // octaves 2-6 keeps interpolation artifacts small in the playable range.
    const p = new Tone.Sampler({
      urls: {
        "A2":  "A2.mp3",  "C3":  "C3.mp3",  "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
        "A3":  "A3.mp3",  "C4":  "C4.mp3",  "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
        "A4":  "A4.mp3",  "C5":  "C5.mp3",  "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
        "A5":  "A5.mp3",  "C6":  "C6.mp3",
      },
      release: 1.2,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
    }).toDestination();
    await Tone.loaded();
    piano = p;
    return piano;
  })();
  try { return await pianoLoading; }
  finally { pianoLoading = null; }
}

async function initIntervals() {
  try {
    setStatus("Loading piano samples…");
    await Promise.all([ensurePiano(), ensureSampleBank()]);
    setStatus(`Intervals — ${INTERVAL_LABELS[getIntervalSemis()]}`);
    buildRootButtons();
    startIntervalsRound();
  } catch (err) {
    console.error(err);
    setStatus(err && err.message ? err.message : String(err), true);
  }
}

function getIntervalSemis() {
  return parseInt($intervalType.value, 10);
}

function midiToNoteName(midi) {
  return Tone.Frequency(midi, "midi").toNote();
}

function midiToPc(midi) {
  return ((midi % 12) + 12) % 12;
}

function buildRootButtons() {
  $intervalsRoots.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const b = document.createElement("button");
    b.className   = "answer-btn small";
    b.type        = "button";
    b.textContent = PITCH_NAMES[i];
    b.addEventListener("click", () => onIntervalsAnswer(i));
    $intervalsRoots.appendChild(b);
  }
}

function updateIntervalsScore() {
  $intervalsScore.textContent = `${intervalsScore.correct} / ${intervalsScore.total}`;
}

function showIntervalsResult(kind, msg) {
  $intervalsResult.textContent = msg;
  $intervalsResult.className   = kind === "correct" ? "correct" : kind === "wrong" ? "wrong" : "";
}

function startIntervalsRound() {
  const semis = getIntervalSemis();
  // Root MIDI range: octaves 3-5 (48..71). Constrain so top note stays ≤ 84 (C6).
  const minRoot = 48;
  const maxRoot = Math.min(71, 84 - semis);
  const rootMidi = minRoot + Math.floor(Math.random() * (maxRoot - minRoot + 1));

  intervals = {
    semis,
    rootMidi,
    topMidi: rootMidi + semis,
    attempts: 0,
    awaiting: "primary",
  };

  showIntervalsResult(null, "Which note is the root?");
  $intervalsNext.classList.remove("visible");
  $note.textContent = "?";
  $note.classList.remove("idle");

  playInterval({ overlay: false });
}

function playInterval({ overlay = false } = {}) {
  if (!piano || !intervals) return;
  const rootName = midiToNoteName(intervals.rootMidi);
  const topName  = midiToNoteName(intervals.topMidi);
  const now      = Tone.now();
  const dur      = "1n";
  const vel      = overlay ? 0.55 : 0.85;
  try {
    piano.triggerAttackRelease(rootName, dur, now, vel);
    piano.triggerAttackRelease(topName,  dur, now, vel);
  } catch (err) { console.error("Piano trigger error:", err); }

  if (overlay && sampleBank) {
    // Original samples at their native recorded pitch — no pitch-shift. They
    // align by pitch class (their own OG note), even if the piano is voicing
    // a different octave.
    const rootPc = midiToPc(intervals.rootMidi);
    const topPc  = midiToPc(intervals.topMidi);
    sampleBank.play(PITCH_NAMES[rootPc], { volume: -6 }); // ~50% amplitude
    sampleBank.play(PITCH_NAMES[topPc],  { volume: -6 });
  }
}

function playIntervalHint() {
  if (!piano || !intervals) return;
  const rootName = midiToNoteName(intervals.rootMidi);
  const topName  = midiToNoteName(intervals.topMidi);
  const now      = Tone.now();
  try {
    piano.triggerAttackRelease(rootName, "2n", now,        0.85);
    piano.triggerAttackRelease(topName,  "2n", now + 0.95, 0.85);
  } catch (err) { console.error("Piano hint error:", err); }
}

function onIntervalsAnswer(pcGuess) {
  if (!intervals || intervals.awaiting !== "primary") return;
  const rootPc = midiToPc(intervals.rootMidi);
  const correct = pcGuess === rootPc;
  intervals.attempts++;

  if (correct) {
    intervalsScore.total++;
    if (intervals.attempts === 1) intervalsScore.correct++;
    updateIntervalsScore();
    intervals.awaiting = null;
    const attemptNote = intervals.attempts === 1 ? "" : ` (attempt ${intervals.attempts})`;
    showIntervalsResult(
      "correct",
      `Correct${attemptNote}! ${midiToNoteName(intervals.rootMidi)} → ${midiToNoteName(intervals.topMidi)} (${INTERVAL_LABELS[intervals.semis]})`
    );
    $note.textContent = PITCH_NAMES[rootPc];
    $intervalsNext.classList.add("visible");
  } else {
    showIntervalsResult(
      "wrong",
      `Nope — was ${PITCH_NAMES[pcGuess]}? Try again with sample overlay.`
    );
    setTimeout(() => playInterval({ overlay: true }), 400);
  }
}

function skipIntervalsRound() {
  if (intervals && intervals.awaiting === "primary") {
    intervalsScore.total++;
    updateIntervalsScore();
  }
  startIntervalsRound();
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------
async function switchMode(newMode) {
  if (newMode === mode) return;
  const oldMode = mode;
  mode = newMode;

  // "quiz-mode" shrinks the shared #note display (used by quiz + intervals).
  document.body.classList.toggle("quiz-mode", newMode === "quiz" || newMode === "intervals");
  document.body.classList.toggle("mode-learn", newMode === "learn");
  document.body.classList.toggle("mode-practice", newMode === "practice");
  document.body.classList.toggle("mode-tune", newMode === "tune");
  document.body.classList.toggle("mode-yesno", newMode === "yesno");
  document.body.classList.toggle("mode-stats", newMode === "stats");
  document.body.classList.toggle("mode-apgames", newMode === "apgames");
  document.body.classList.toggle("mode-microtone", newMode === "microtone");

  $modeBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === newMode);
  });

  // Exit whichever module owned the previous tab.
  if (oldMode === "learn")    learnMod.exit();
  if (oldMode === "practice") practiceMod.exit();
  if (oldMode === "tune")     tuneMod.exit();
  if (oldMode === "yesno")    yesnoMod.exit();
  if (oldMode === "stats")    statsMod.exit();
  if (oldMode === "apgames")  apgamesMod.exit();
  if (oldMode === "microtone") microtoneMod.exit();

  // Common teardown of any non-passive UI.
  cancelAutoAdvance();
  quiz = null;
  intervals = null;
  $quiz.classList.remove("active");
  $intervals.classList.remove("active");
  $learn.classList.remove("active");
  $practice.classList.remove("active");
  $tune.classList.remove("active");
  $yesno.classList.remove("active");
  $stats.classList.remove("active");
  $apgames.classList.remove("active");
  $microtone.classList.remove("active");
  hideAllAnswerGroups();
  $followup.classList.remove("active");

  if (newMode === "passive") {
    $debug.style.display = "";
    clearDisplay();
    setStatus("Tap Start to begin");
    showStartButton();
    quizScore = { correct: 0, total: 0 };
    updateScore();
  } else if (newMode === "quiz") {
    await cleanupPassive();
    hideStartButton();
    $debug.style.display = "none";
    $quiz.classList.add("active");
    quizScore = { correct: 0, total: 0 };
    updateScore();
    $quizResult.textContent = "";
    $quizResult.className   = "";
    setStatus("Quiz mode");
    await initQuiz();
  } else if (newMode === "intervals") {
    await cleanupPassive();
    hideStartButton();
    $debug.style.display = "none";
    $intervals.classList.add("active");
    intervalsScore = { correct: 0, total: 0 };
    updateIntervalsScore();
    $intervalsResult.textContent = "";
    $intervalsResult.className   = "";
    setStatus("Intervals mode");
    await initIntervals();
  } else if (newMode === "learn") {
    await cleanupPassive();
    hideStartButton();
    $learn.classList.add("active");
    await learnMod.enter();
  } else if (newMode === "practice") {
    await cleanupPassive();
    hideStartButton();
    $practice.classList.add("active");
    await practiceMod.enter();
  } else if (newMode === "tune") {
    await cleanupPassive();
    hideStartButton();
    $tune.classList.add("active");
    await tuneMod.enter();
  } else if (newMode === "yesno") {
    await cleanupPassive();
    hideStartButton();
    $yesno.classList.add("active");
    await yesnoMod.enter();
  } else if (newMode === "stats") {
    await cleanupPassive();
    hideStartButton();
    $stats.classList.add("active");
    await statsMod.enter();
  } else if (newMode === "apgames") {
    await cleanupPassive();
    hideStartButton();
    $apgames.classList.add("active");
    await apgamesMod.enter();
  } else if (newMode === "microtone") {
    await cleanupPassive();
    hideStartButton();
    $microtone.classList.add("active");
    await microtoneMod.enter();
  }
}

function switchSubmode(newSubmode) {
  if (newSubmode === submode) return;
  submode = newSubmode;
  $submodeBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.submode === newSubmode);
  });
  cancelAutoAdvance();
  quizScore = { correct: 0, total: 0 };
  updateScore();
  $quizResult.textContent = "";
  $quizResult.className   = "";
  setStatus(`Quiz — ${submodeLabel()}`);
  if (sampleBank) startQuizRound();
}

// ---------------------------------------------------------------------------
// Web MIDI input (Chrome on macOS). A module can register a handler via
// ctx.setMidiHandler; note-ons are buffered for a short grace window so two
// adjacent keys pressed together resolve to the quarter-tone between them.
// When no module handler is set, a single note falls back to clicking a
// matching pitch-class answer button in the active tab.
// ---------------------------------------------------------------------------
let midiHandler = null;
const MIDI_GRACE = 180;         // ms window to detect a "simultaneous" two-key press
let midiBuf = [];
let midiTimer = null;

function midiNoteOn(note) {
  midiBuf.push(note);
  if (midiTimer) clearTimeout(midiTimer);
  midiTimer = setTimeout(resolveMidi, MIDI_GRACE);
}
function resolveMidi() {
  midiTimer = null;
  const notes = [...new Set(midiBuf)].sort((a, b) => a - b);
  midiBuf = [];
  if (!notes.length) return;
  if (notes.length >= 2) {
    for (let i = 0; i < notes.length - 1; i++) {
      if (notes[i + 1] - notes[i] === 1) return dispatchMidi({ kind: "pair", low: notes[i], high: notes[i + 1] });
    }
  }
  dispatchMidi({ kind: "note", midi: notes[notes.length - 1] });
}
function dispatchMidi(msg) {
  if (midiHandler) { try { midiHandler(msg); } catch (_) {} return; }
  if (msg.kind !== "note") return; // global fallback only handles single notes
  const pc = ((msg.midi % 12) + 12) % 12;
  const cont = document.querySelector("#learn.active,#apgames.active,#quiz.active,#intervals.active,#yesno.active,#microtone.active") || document.body;
  const btn = cont.querySelector(`[data-pc="${pc}"]`) || cont.querySelector(`[data-pc="${PITCH_NAMES[pc]}"]`);
  if (btn) btn.click();
}
function initMidi() {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess().then((access) => {
    const attach = () => access.inputs.forEach((inp) => { inp.onmidimessage = onMidiMessage; });
    attach();
    access.onstatechange = attach;
  }).catch(() => {});
}
function onMidiMessage(e) {
  const [status, note, vel] = e.data;
  if ((status & 0xf0) === 0x90 && vel > 0) midiNoteOn(note);
}

// ---------------------------------------------------------------------------
// Learn + Practice modules — share audio + helpers via a small ctx object.
// ---------------------------------------------------------------------------
const sharedCtx = {
  Tone,
  PITCH_NAMES,
  INTERVAL_LABELS,
  ensureSampleBank,
  ensurePiano,
  getBank:  () => sampleBank,
  getPiano: () => piano,
  midiToNoteName,
  midiToPc,
  setStatus,
  setMidiHandler: (fn) => { midiHandler = fn; },
  clearMidiHandler: () => { midiHandler = null; midiBuf = []; if (midiTimer) { clearTimeout(midiTimer); midiTimer = null; } },
};
const learnMod    = setupLearn(sharedCtx);
const practiceMod = setupPractice(sharedCtx);
const tuneMod     = setupTune(sharedCtx);
const yesnoMod    = setupYesNo(sharedCtx);
const statsMod    = setupStats(sharedCtx);
const apgamesMod  = setupApGames(sharedCtx);
const microtoneMod = setupMicrotone(sharedCtx);

// ---------------------------------------------------------------------------
// Top-level view: Home hub / a Daily game / Lucas's Lab (the full trainer suite)
// ---------------------------------------------------------------------------
function setTopView(v) {
  document.body.classList.toggle("view-home",  v === "home");
  document.body.classList.toggle("view-daily", v === "daily");
  document.body.classList.toggle("view-lucas", v === "lucas");
}
function goHome()      { setTopView("home"); document.body.classList.remove("solo-lab"); hubMod.renderHome(); }
function goDaily(id)   { setTopView("daily"); hubMod.startDaily(id); }
function goLucas()     { setTopView("lucas"); document.body.classList.remove("solo-lab", "show-tabs"); switchMode("learn"); } // full Lab (password-gated in hub)
async function goMicrotone(gameId) {
  setTopView("lucas"); document.body.classList.add("solo-lab"); document.body.classList.remove("show-tabs");
  if (mode !== "microtone") await switchMode("microtone");
  if (gameId) microtoneMod.openGame(gameId, { public: true });  // jump straight in, no training wheels
} // one game, no Lab nav
const hubMod = setupHub({ Tone, PITCH_NAMES, setStatus, ensureSampleBank, getBank: () => sampleBank, ensurePiano, getPiano: () => piano, goHome, goDaily, goLucas, goMicrotone });

// Resume Tone's audio context on the very first user interaction, so audio is
// unlocked regardless of which tab the app opened on (it opens on Learn, which
// preloads audio outside a gesture and leaves the context suspended).
function unlockAudioOnce() {
  Tone.start().catch(() => {});
  window.removeEventListener("pointerdown", unlockAudioOnce);
  window.removeEventListener("keydown", unlockAudioOnce);
}
window.addEventListener("pointerdown", unlockAudioOnce);
window.addEventListener("keydown", unlockAudioOnce);

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$start.addEventListener("click", () => { initPassive(); });

$modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => { if (btn.dataset.mode) switchMode(btn.dataset.mode); });
});
$submodeBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchSubmode(btn.dataset.submode));
});

document.getElementById("btn-sample-intune").addEventListener("click", () => onAnswerSample(true));
document.getElementById("btn-sample-off").addEventListener("click",    () => onAnswerSample(false));
document.getElementById("btn-pitch-match").addEventListener("click",   () => onAnswerPitch(true));
document.getElementById("btn-pitch-nomatch").addEventListener("click", () => onAnswerPitch(false));
document.querySelectorAll(".amount-btn").forEach((btn) => {
  btn.addEventListener("click", () => onAnswerAmount(parseInt(btn.dataset.cents, 10)));
});

$followupSkip.addEventListener("click", () => {
  if (quiz && quiz.awaiting === "followup") {
    quiz.awaiting = null;
    autoAdvance(300);
  }
});

$quizReplay.addEventListener("click", () => {
  if (!quiz || !sampleBank) return;
  playCurrent();
});
$quizNext.addEventListener("click", () => {
  cancelAutoAdvance();
  startQuizRound();
});

// Intervals wiring
$intervalType.addEventListener("change", () => {
  if (mode !== "intervals") return;
  intervalsScore = { correct: 0, total: 0 };
  updateIntervalsScore();
  setStatus(`Intervals — ${INTERVAL_LABELS[getIntervalSemis()]}`);
  startIntervalsRound();
});
$intervalsHint.addEventListener("click", () => {
  if (!intervals) return;
  playIntervalHint();
});
$intervalsReplay.addEventListener("click", () => {
  if (!intervals) return;
  playInterval({ overlay: false });
});
$intervalsNext.addEventListener("click", () => {
  skipIntervalsRound();
});

// Home button in the Lab nav returns to the hub.
document.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", goHome));

// Open on the clean Home hub by default.
goHome();

// Connect any MIDI keyboards (Chrome on macOS).
initMidi();
