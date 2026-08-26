// Testing Battery — the seven test modules.
//
// Every module exposes the same shape:
//
//   { id, title, blurb, keysHint, instructions[], count(practice),
//     make({ rng, practice, io, seed }) -> {
//        total, async runTrial(i), summary(trials), serialize(), restore(s) } }
//
// runTrial returns the module-specific half of a trial record; the shell adds
// session identity, timestamps and indices. Modules never show correctness
// outside practice mode — feedback during a real session would let expectation
// contaminate later timepoints.

import * as A from "./battery-audio.js";
import { makeZest, shuffled, shuffleNoRepeat, dPrime, criterionC, median, mean } from "./battery-core.js";

const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const roveLevel = (rng, dB = 2) => A.REF_RMS * A.dbToGain(rng.range(-dB, dB));

/** Signed circular semitone error, -6..+5. */
function pcError(chosen, correct) {
  return ((chosen - correct + 18) % 12) - 6;
}

function pctCorrect(trials) {
  const scored = trials.filter((t) => t.correct != null);
  return scored.length ? scored.filter((t) => t.correct).length / scored.length : null;
}

/** Hints per trial in the note-naming task: each one replays the note twice. */
const HINT_MAX = 2;

/**
 * Ceiling / floor detection. A module sitting at either end stops being able to
 * show change in one direction, which is the failure mode worth catching early
 * — ideally at baseline, while the design can still be adjusted.
 */
function rangeFlags(accuracy, chance = 0.5) {
  if (accuracy == null) return { at_ceiling: null, at_floor: null };
  return {
    at_ceiling: accuracy >= 0.95,
    at_floor: accuracy <= chance + 0.05,
    headroom: +(1 - accuracy).toFixed(4),
  };
}

// ===========================================================================
// 1. Note Naming  (pitch-class tagging)
//
// Not an absolute-pitch test. The question is whether isolated pitches become
// easier to mentally tag after prolonged auditory attention.
//
// Balance: 12 pitch classes x 4 repetitions, with register and timbre assigned
// by orthogonal modular rules, so across a session every pitch class is heard
// in every register and every timbre. That removes the risk of one session
// accidentally getting all its hard classes in the worst register.
//
// A burst of random microtonal tones runs before every trial. Without it, trial
// N+1 is answered by comparing against trial N, which makes this a relative
// pitch test instead.
// ===========================================================================
const REGISTER_OCTAVES = [3, 4, 5];
const PROBE_LABELS = { f: "song_reference", g: "immediate_feel", h: "guess", j: "other" };

/**
 * 12 pitch classes x 4 repetitions. Register and timbre come from orthogonal
 * modular rules, so each appears exactly 16 times across the module and every
 * pitch class is heard in every register and every timbre. Exported so the
 * balance can be asserted directly rather than trusted.
 */
export function buildTaggingPlan(rng, practice) {
  const plan = [];
  if (practice) {
    for (let i = 0; i < 4; i++) plan.push({ pc: rng.int(12), reg: rng.int(3), timbre: rng.pick(A.TIMBRES), probe: false });
  } else {
    for (let r = 0; r < 1; r++) {
      for (let pc = 0; pc < 12; pc++) {
        plan.push({ pc, reg: (pc + r) % 3, timbre: A.TIMBRES[(pc + 2 * r) % 3], probe: false });
      }
    }
  }
  const order = practice ? plan : shuffleNoRepeat(plan, (t) => t.pc, rng);
  // Metacognition probe on a third of trials — enough for a per-session
  // breakdown, cheap enough not to bloat the module.
  const probeIdx = new Set(shuffled(order.map((_, i) => i), rng).slice(0, Math.round(order.length / 3)));
  order.forEach((t, i) => { t.probe = probeIdx.has(i); });
  return order;
}

const tagging = {
  id: "tagging",
  title: "Note Naming",
  blurb: "Name the pitch class of single isolated notes.",
  keysHint: "H hears it again (2 max) · SPACE when decided · then say the note",
  instructions: [
    "Note naming.",
    "You will hear a burst of scrambled tones, then one single note.",
    "Take as long as you like. This is not a speed test — accuracy is the only thing that counts here, so think it through.",
    "If you want to hear the note again, press H. That plays it twice more. You get two of those per trial.",
    "When you have decided, press the space bar, then say the note out loud and your friend will enter it.",
    "If you are unsure, give your best guess. Do not leave a trial blank.",
    "Sometimes you will then be asked how you knew.",
  ],
  count: (practice) => (practice ? 4 : 12),

  make({ rng, practice, io }) {
    const order = buildTaggingPlan(rng, practice);

    return {
      total: order.length,
      serialize: () => ({}),
      restore: () => {},

      async runTrial(i) {
        const p = order[i];
        const midi = 12 * (p.reg === 0 ? 3 : p.reg === 1 ? 4 : 5) + 12 + p.pc; // C3=48
        const octave = REGISTER_OCTAVES[p.reg];
        const freq = A.midiToFreq(midi);
        const durMs = p.timbre === "struck" ? 1300 : 1000;

        // Flush echoic pitch memory.
        io.status("…");
        const scr = A.renderScramble({ n: 6, toneMs: 140, rand: rng, rms: A.REF_RMS * 0.75 });
        const sh = A.playMono(scr.data, A.nextSlot());
        await A.waitFor(sh, 350);

        const tone = A.renderTone({ freq, durMs, timbre: p.timbre, rms: roveLevel(rng, 1.5) });
        io.status("LISTEN");
        const h = A.playMono(tone.data, A.nextSlot());
        io.status("TAKE YOUR TIME");

        // Hint = the note played twice more, up to HINT_MAX times per trial.
        // Hint use is logged rather than penalised: whether he needs a second
        // listen is itself a measure, and it may move over the experiment even
        // if raw accuracy does not.
        let hints = 0;
        const onHint = () => {
          if (hints >= HINT_MAX) return 0;
          hints++;
          const t0 = A.nextSlot();
          A.playMono(tone.data, t0);
          A.playMono(tone.data, t0 + (durMs + 500) / 1000);
          return HINT_MAX - hints;
        };

        // Two-stage response, but with no time pressure: he decides at leisure,
        // presses space, and only then says the note. The space press keeps
        // decision time free of the friend's own reaction time; the identity is
        // entered afterwards so accuracy is never limited by interface speed.
        const dec = await io.awaitDecision({
          onsetPerf: h.onsetPerf, timeoutMs: 180000, onHint, hintsLeft: HINT_MAX,
        });
        io.receipt();

        let chosen = dec.pc;
        let entry = { method: dec.method, timedOut: dec.timedOut };
        if (chosen == null && !dec.timedOut) {
          io.status("WHICH NOTE?");
          const res = await io.awaitPitchClasses(1, { timeoutMs: 120000, noRt: true });
          chosen = res.pcs.length ? res.pcs[0] : null;
          entry = { method: res.method, timedOut: res.timedOut };
        }

        const correct = chosen == null ? null : chosen === p.pc;
        const err = chosen == null ? null : pcError(chosen, p.pc);

        let probeAns = null;
        if (p.probe && chosen != null) {
          io.status("HOW DID YOU KNOW?");
          io.prompt("song reference &nbsp;·&nbsp; felt like that note &nbsp;·&nbsp; guessed &nbsp;·&nbsp; other");
          const pr = await io.awaitChoice({ map: PROBE_LABELS, timeoutMs: 60000, onsetPerf: performance.now() });
          probeAns = pr.value;
          io.receipt();
          io.prompt("");
        }

        if (practice) io.feedback(correct, `${correct ? "Correct" : "Was"} ${PC_NAMES[p.pc]}${octave}`);

        return {
          difficulty: null,
          stim: {
            midi_note: midi, frequency_hz: +freq.toFixed(4), pitch_class: p.pc,
            pitch_class_name: PC_NAMES[p.pc], octave, register_index: p.reg,
            timbre: p.timbre, duration_ms: durMs,
            target_rms: tone.meas.target_rms, applied_gain: +tone.meas.applied_gain.toFixed(5),
            peak: +tone.meas.peak.toFixed(4), limited: tone.meas.limited,
            scramble_freqs: scr.freqs.map((f) => +f.toFixed(2)),
          },
          correct_answer: PC_NAMES[p.pc],
          response: chosen == null ? null : PC_NAMES[chosen],
          response_pc: chosen,
          correct,
          // Decision time, tone onset -> space bar. Recorded, but NOT something
          // the task asks him to optimise. Trials with hints have inflated RT by
          // construction, so filter on hints_used == 0 for a clean RT measure.
          rt_ms: dec.rtMs,
          input_method: entry.method,
          timed_out: dec.timedOut || entry.timedOut,
          extra: {
            semitone_error_signed: err,
            semitone_error_abs: err == null ? null : Math.min(Math.abs(err), 12 - Math.abs(err)),
            probe_asked: p.probe, probe_response: probeAns,
            decision_method: dec.method,
            hints_used: hints, n_plays: 1 + hints * 2, unaided: hints === 0,
          },
        };
      },

      summary(trials) {
        const scored = trials.filter((t) => t.correct != null);
        const byPc = {};
        for (const t of scored) {
          const k = t.stim.pitch_class_name;
          byPc[k] = byPc[k] || { n: 0, correct: 0 };
          byPc[k].n++; if (t.correct) byPc[k].correct++;
        }
        const byReg = {};
        for (const t of scored) {
          const k = `oct${t.stim.octave}`;
          byReg[k] = byReg[k] || { n: 0, correct: 0 };
          byReg[k].n++; if (t.correct) byReg[k].correct++;
        }
        const byTim = {};
        for (const t of scored) {
          const k = t.stim.timbre;
          byTim[k] = byTim[k] || { n: 0, correct: 0 };
          byTim[k].n++; if (t.correct) byTim[k].correct++;
        }
        const unaided = scored.filter((t) => t.extra.unaided);
        const aided = scored.filter((t) => !t.extra.unaided);
        return {
          n: scored.length,
          accuracy: pctCorrect(scored),
          chance: 1 / 12,
          // RT only means anything on trials where he did not ask to re-hear it.
          median_rt_ms: median(unaided.map((t) => t.rt_ms)),
          median_rt_ms_all: median(scored.map((t) => t.rt_ms)),
          mean_abs_semitone_error: mean(scored.map((t) => t.extra.semitone_error_abs)),
          within_1_semitone: scored.length
            ? scored.filter((t) => t.extra.semitone_error_abs <= 1).length / scored.length : null,
          hints_used_total: scored.reduce((a, t) => a + t.extra.hints_used, 0),
          hint_rate: scored.length ? +(aided.length / scored.length).toFixed(4) : null,
          accuracy_unaided: pctCorrect(unaided),
          accuracy_with_hint: pctCorrect(aided),
          n_unaided: unaided.length,
          by_pitch_class: byPc, by_register: byReg, by_timbre: byTim,
          ...rangeFlags(pctCorrect(scored), 1 / 12),
        };
      },
    };
  },
};

// ===========================================================================
// 2. Fine Pitch Discrimination
//
// One ZEST track plus fixed-difficulty anchor trials. Anchors deliberately do
// NOT feed the posterior, so they remain a completely model-free check: if the
// adaptive threshold and the raw anchor accuracy ever disagree about which way
// things moved, the anchors are the ones to believe.
//
// Base frequency roves every trial so no long-term reference can be built, and
// level roves +/-2 dB so loudness can never stand in for pitch.
//
// Adaptive parameters are shared across all three adaptive modules — see
// ZEST_ROBUST for why they are what they are.
// ===========================================================================
const ANCHOR_CENTS = [25, 12, 6, 3];

// Assumed psychometric slope and prior width, chosen by simulation rather than
// by taste. A shallow assumed slope with a wide prior makes the estimator's
// bias almost independent of both the true slope and the true threshold
// (measured bias 1.00-1.10 across true slopes of 1.0 to 3.0). Sharper settings
// give a slightly tighter estimate but introduce level-dependent shrinkage,
// which would distort the shape of the change over time — the one thing this
// experiment is actually trying to measure.
const ZEST_ROBUST = { beta: 1.0, priorSdLog: 1.2, guess: 0.5, lapse: 0.02 };

const discrim = {
  id: "discrim",
  title: "Pitch Discrimination",
  blurb: "Is the second tone higher or lower than the first?",
  keysHint: "F = lower   ·   J = higher",
  instructions: [
    "Pitch discrimination.",
    "You will hear two tones. Decide whether the second is higher or lower than the first.",
    "Press F for lower, J for higher. Those are the two keys with the little bumps.",
    "The difference gets very small. Guess when you are not sure.",
  ],
  count: (practice) => (practice ? 6 : 20),

  make({ rng, practice, io }) {
    const zest = makeZest({ min: 0.2, max: 120, priorMode: 12, ...ZEST_ROBUST });

    const plan = [];
    if (practice) {
      [60, 30, 15, 15, 8, 8].forEach((c) => plan.push({ kind: "anchor", cents: c }));
    } else {
      for (let k = 0; k < 16; k++) plan.push({ kind: "adapt" });
      for (const c of ANCHOR_CENTS) plan.push({ kind: "anchor", cents: c });
    }
    const order = practice ? plan : shuffled(plan, rng);

    return {
      total: order.length,
      serialize: () => ({ z: zest.serialize() }),
      restore: (s) => { if (s && s.z) zest.restore(s.z); },

      async runTrial(i) {
        const p = order[i];
        const z = p.kind === "adapt" ? zest : null;
        const before = z ? z.state() : null;
        const cents = p.kind === "anchor" ? p.cents : z.next(rng);
        const dir = rng.sign();                            // +1 = second tone higher

        const baseHz = rng.logRange(300, 700);
        const f1 = baseHz;
        const f2 = A.centsShift(baseHz, dir * cents);
        const t1 = A.renderSine({ freq: f1, durMs: 500, rms: roveLevel(rng) });
        const t2 = A.renderSine({ freq: f2, durMs: 500, rms: roveLevel(rng) });

        io.status("LISTEN");
        const t0 = A.nextSlot();
        A.playMono(t1.data, t0);
        const h2 = A.playMono(t2.data, t0 + 0.9);          // 500 ms tone + 400 ms gap
        await A.sleep(Math.max(0, h2.onsetPerf - performance.now()));
        io.status("HIGHER or LOWER?");

        const res = await io.awaitChoice({
          map: { f: "lower", j: "higher", arrowdown: "lower", arrowup: "higher" },
          onsetPerf: h2.onsetPerf, timeoutMs: 20000,
        });
        io.receipt();

        const correct = res.value == null ? null : (res.value === "higher") === (dir > 0);
        if (z && correct != null) z.update(cents, correct);
        if (practice) io.feedback(correct, `It was ${dir > 0 ? "higher" : "lower"} — ${cents.toFixed(1)} cents`);

        return {
          difficulty: +cents.toFixed(4),
          stim: {
            base_hz: +baseHz.toFixed(3), f1_hz: +f1.toFixed(4), f2_hz: +f2.toFixed(4),
            delta_cents: +cents.toFixed(4), direction: dir > 0 ? "higher" : "lower",
            tone_ms: 500, isi_ms: 400,
            rms_1: +t1.meas.target_rms.toFixed(5), rms_2: +t2.meas.target_rms.toFixed(5),
            peak_1: +t1.meas.peak.toFixed(4), peak_2: +t2.meas.peak.toFixed(4),
          },
          correct_answer: dir > 0 ? "higher" : "lower",
          response: res.value, correct, rt_ms: res.rtMs,
          input_method: res.method, timed_out: res.timedOut,
          block: p.kind === "anchor" ? "anchor" : "adaptive",
          adaptive: z ? {
            kind: p.kind,
            mean_before: before && +before.mean.toFixed(4),
            sd_log10_before: before && +before.sd_log10.toFixed(4),
            mean_after: +z.state().mean.toFixed(4),
            sd_log10_after: +z.state().sd_log10.toFixed(4),
          } : { kind: "anchor" },
        };
      },

      summary(trials) {
        const anchors = {};
        for (const t of trials.filter((x) => x.block === "anchor" && x.correct != null)) {
          const k = `c${t.stim.delta_cents}`;
          anchors[k] = anchors[k] || { n: 0, correct: 0 };
          anchors[k].n++; if (t.correct) anchors[k].correct++;
        }
        return {
          n: trials.length,
          threshold_cents: +zest.estimate().toFixed(3),
          ci68_cents: zest.ci68().map((v) => +v.toFixed(3)),
          posterior_sd_log10: +zest.sdLog10().toFixed(4),
          anchor_accuracy: anchors,
          median_rt_ms: median(trials.map((t) => t.rt_ms)),
          overall_accuracy: pctCorrect(trials),
          ...rangeFlags(pctCorrect(trials), 0.5),
        };
      },
    };
  },
};

// ===========================================================================
// 3. Harmonicity / Inharmonicity
//
// Two-interval forced choice ("which one was inharmonic") rather than a single
// tone judged harmonic-or-not, because a one-interval version measures response
// criterion as much as sensitivity, and criterion is exactly the thing likely
// to drift over 48 sleepless hours.
//
// Both intervals share an F0, a partial count, a duration and an RMS. The only
// difference is partial-frequency jitter.
// ===========================================================================
const HARM_ANCHORS = [0.30, 0.12, 0.05, 0.02];

const harmonicity = {
  id: "harmonicity",
  title: "Harmonicity",
  blurb: "Which of the two sounds had mistuned partials?",
  keysHint: "F = first sound   ·   J = second sound",
  instructions: [
    "Harmonicity.",
    "You will hear two complex tones with the same pitch.",
    "One is perfectly harmonic. In the other, the overtones are slightly mistuned, so it sounds rougher, or less like a single note.",
    "Press F if the mistuned one was first, J if it was second.",
    "They are matched in loudness, so loudness will not tell you the answer.",
  ],
  // The headline measure: Landry, Shiller & Champoux (2013) found harmonicity
  // discrimination improved after only 90 minutes of visual deprivation, so
  // this module gets the most trials and the tightest threshold estimate.
  count: (practice) => (practice ? 6 : 20),

  make({ rng, practice, io }) {
    const zest = makeZest({ min: 0.0015, max: 0.6, priorMode: 0.08, ...ZEST_ROBUST });

    const plan = [];
    if (practice) {
      [0.45, 0.28, 0.28, 0.15, 0.15, 0.08].forEach((j) => plan.push({ kind: "anchor", jitter: j }));
    } else {
      for (let k = 0; k < 16; k++) plan.push({ kind: "adapt" });
      for (const j of HARM_ANCHORS) plan.push({ kind: "anchor", jitter: j });
    }
    const order = practice ? plan : shuffled(plan, rng);

    return {
      total: order.length,
      serialize: () => ({ z: zest.serialize() }),
      restore: (s) => { if (s && s.z) zest.restore(s.z); },

      async runTrial(i) {
        const p = order[i];
        const z = p.kind === "adapt" ? zest : null;
        const before = z ? z.state() : null;
        const jitter = p.kind === "anchor" ? p.jitter : z.next(rng);
        const inharmFirst = rng.bool();

        const f0 = rng.logRange(150, 340);
        const nP = 12;
        const nums = A.jitteredPartialNumbers(nP, jitter, rng);
        const level = roveLevel(rng, 1.5);              // same level for BOTH intervals
        const harm = A.renderComplex({ f0, nPartials: nP, durMs: 700, rms: level });
        const inh = A.renderComplex({ f0, partialNumbers: nums, durMs: 700, rms: level });

        io.status("LISTEN");
        const t0 = A.nextSlot();
        A.playMono(inharmFirst ? inh.data : harm.data, t0);
        const h2 = A.playMono(inharmFirst ? harm.data : inh.data, t0 + 1.2);
        await A.sleep(Math.max(0, h2.onsetPerf + 700 - performance.now()));
        io.status("FIRST or SECOND?");

        const res = await io.awaitChoice({
          map: { f: "first", j: "second", arrowleft: "first", arrowright: "second" },
          onsetPerf: h2.onsetPerf, timeoutMs: 20000,
        });
        io.receipt();

        const answer = inharmFirst ? "first" : "second";
        const correct = res.value == null ? null : res.value === answer;
        if (z && correct != null) z.update(jitter, correct);
        if (practice) io.feedback(correct, `Mistuned one was ${answer} — jitter ${(jitter * 100).toFixed(1)}%`);

        return {
          difficulty: +jitter.toFixed(5),
          stim: {
            f0_hz: +f0.toFixed(3), n_partials: nP,
            jitter_fraction: +jitter.toFixed(5), jitter_percent_of_f0: +(jitter * 100).toFixed(3),
            partial_numbers: nums.map((n) => +n.toFixed(4)),
            harmonic_freqs: harm.freqs.map((f) => +f.toFixed(2)),
            inharmonic_freqs: inh.freqs.map((f) => +f.toFixed(2)),
            inharmonic_interval: inharmFirst ? 1 : 2,
            tone_ms: 700, isi_ms: 500,
            rms_both: +level.toFixed(5),
            peak_harmonic: +harm.meas.peak.toFixed(4), peak_inharmonic: +inh.meas.peak.toFixed(4),
          },
          correct_answer: answer, response: res.value, correct,
          rt_ms: res.rtMs, input_method: res.method, timed_out: res.timedOut,
          block: p.kind === "anchor" ? "anchor" : "adaptive",
          adaptive: z ? {
            kind: p.kind,
            mean_before: before && +before.mean.toFixed(5),
            sd_log10_before: before && +before.sd_log10.toFixed(4),
            mean_after: +z.state().mean.toFixed(5),
            sd_log10_after: +z.state().sd_log10.toFixed(4),
          } : { kind: "anchor" },
        };
      },

      summary(trials) {
        const anchors = {};
        for (const t of trials.filter((x) => x.block === "anchor" && x.correct != null)) {
          const k = `j${t.stim.jitter_percent_of_f0}`;
          anchors[k] = anchors[k] || { n: 0, correct: 0 };
          anchors[k].n++; if (t.correct) anchors[k].correct++;
        }
        const est = zest.estimate();
        return {
          n: trials.length,
          threshold_jitter_fraction: +est.toFixed(5),
          threshold_jitter_percent: +(est * 100).toFixed(3),
          ci68_percent: zest.ci68().map((v) => +(v * 100).toFixed(3)),
          posterior_sd_log10: +zest.sdLog10().toFixed(4),
          anchor_accuracy: anchors,
          median_rt_ms: median(trials.map((t) => t.rt_ms)),
          overall_accuracy: pctCorrect(trials),
          ...rangeFlags(pctCorrect(trials), 0.5),
        };
      },
    };
  },
};

// ===========================================================================
// 4. Pitch Memory Retention
//
// Three retention conditions at fixed difficulty, rather than one delay with an
// adaptive difficulty. That separates two different things that "auditory
// memory got better" could mean:
//
//   short        1.5 s silence   — baseline encoding
//   long         5 s silence     — passive decay
//   interference 5 s + 4 tones   — resistance to interference
//
// Deutsch showed interference dominates decay for pitch memory, so the
// short-vs-long-vs-interference contrast is where the interesting result lives.
// ===========================================================================
const MEM_CONDITIONS = [
  { id: "short", delayMs: 1500, nInterf: 0 },
  { id: "long", delayMs: 5000, nInterf: 0 },
  { id: "interference", delayMs: 5000, nInterf: 4 },
];
const MEM_DELTAS = [12, 25];

const memory = {
  id: "memory",
  title: "Pitch Memory",
  blurb: "After a delay, was the second tone higher or lower?",
  keysHint: "F = lower   ·   J = higher",
  instructions: [
    "Pitch memory.",
    "You hear a tone, then a gap, then a second tone.",
    "Decide whether the second tone is higher or lower than the first.",
    "F for lower, J for higher.",
    "On some trials, other tones play during the gap. Ignore them. They are never the answer.",
  ],
  count: (practice) => (practice ? 6 : 24),

  make({ rng, practice, io }) {
    const plan = [];
    if (practice) {
      for (let i = 0; i < 6; i++) {
        plan.push({ cond: MEM_CONDITIONS[i % 3], delta: 50, dir: rng.sign() });
      }
    } else {
      for (const cond of MEM_CONDITIONS) {
        for (const delta of MEM_DELTAS) {
          for (const dir of [-1, 1]) {
            for (let r = 0; r < 2; r++) plan.push({ cond, delta, dir });
          }
        }
      }
    }
    const order = practice ? plan : shuffled(plan, rng);

    return {
      total: order.length,
      serialize: () => ({}),
      restore: () => {},

      async runTrial(i) {
        const p = order[i];
        const baseHz = rng.logRange(300, 700);
        const cmpHz = A.centsShift(baseHz, p.dir * p.delta);
        const std = A.renderSine({ freq: baseHz, durMs: 500, rms: roveLevel(rng) });
        const cmp = A.renderSine({ freq: cmpHz, durMs: 500, rms: roveLevel(rng) });

        // Interference tones sit in the same frequency region as the standard —
        // that is what makes them interfere rather than just pass the time.
        const interf = [];
        for (let k = 0; k < p.cond.nInterf; k++) {
          const f = rng.logRange(300, 700);
          interf.push({ freq: f, atMs: 700 + k * 1000, tone: A.renderSine({ freq: f, durMs: 300, rms: roveLevel(rng) }) });
        }

        io.status("LISTEN");
        const t0 = A.nextSlot();
        A.playMono(std.data, t0);
        for (const it of interf) A.playMono(it.tone.data, t0 + 0.5 + it.atMs / 1000);
        const cmpAt = t0 + 0.5 + p.cond.delayMs / 1000;
        const h2 = A.playMono(cmp.data, cmpAt);
        await A.sleep(Math.max(0, h2.onsetPerf - performance.now()));
        io.status("HIGHER or LOWER?");

        const res = await io.awaitChoice({
          map: { f: "lower", j: "higher", arrowdown: "lower", arrowup: "higher" },
          onsetPerf: h2.onsetPerf, timeoutMs: 20000,
        });
        io.receipt();

        const answer = p.dir > 0 ? "higher" : "lower";
        const correct = res.value == null ? null : res.value === answer;
        if (practice) io.feedback(correct, `It was ${answer} by ${p.delta} cents`);

        return {
          difficulty: p.delta,
          stim: {
            condition: p.cond.id, delay_ms: p.cond.delayMs, n_interference: p.cond.nInterf,
            interference_hz: interf.map((x) => +x.freq.toFixed(2)),
            interference_at_ms: interf.map((x) => x.atMs),
            standard_hz: +baseHz.toFixed(4), comparison_hz: +cmpHz.toFixed(4),
            delta_cents: p.delta, direction: answer, tone_ms: 500,
            rms_standard: +std.meas.target_rms.toFixed(5), rms_comparison: +cmp.meas.target_rms.toFixed(5),
          },
          correct_answer: answer, response: res.value, correct,
          rt_ms: res.rtMs, input_method: res.method, timed_out: res.timedOut,
          block: p.cond.id,
        };
      },

      summary(trials) {
        const byCond = {};
        for (const t of trials.filter((x) => x.correct != null)) {
          const k = t.stim.condition;
          byCond[k] = byCond[k] || { n: 0, correct: 0, rts: [] };
          byCond[k].n++; if (t.correct) byCond[k].correct++;
          byCond[k].rts.push(t.rt_ms);
        }
        const out = {};
        for (const [k, v] of Object.entries(byCond)) {
          out[k] = { n: v.n, accuracy: +(v.correct / v.n).toFixed(4), median_rt_ms: median(v.rts) };
        }
        const byDelta = {};
        for (const t of trials.filter((x) => x.correct != null)) {
          const k = `c${t.stim.delta_cents}`;
          byDelta[k] = byDelta[k] || { n: 0, correct: 0 };
          byDelta[k].n++; if (t.correct) byDelta[k].correct++;
        }
        const s = out.short && out.short.accuracy;
        const inf = out.interference && out.interference.accuracy;
        return {
          n: trials.length,
          accuracy: pctCorrect(trials),
          by_condition: out,
          by_delta_cents: byDelta,
          interference_cost: s != null && inf != null ? +(s - inf).toFixed(4) : null,
          median_rt_ms: median(trials.map((t) => t.rt_ms)),
          ...rangeFlags(pctCorrect(trials), 0.5),
        };
      },
    };
  },
};

// ===========================================================================
// 5. Chord Segregation
//
// Difficulty is stratified rather than random: every session runs exactly one
// chord of each (size x voicing-type) combination, so session 5 cannot get an
// easier hand than session 1. The notes are transposed randomly each time, so
// the chords are never the same twice.
//
// The number of notes is announced. That trades away an enumeration measure but
// removes a response-criterion confound, and it makes the blindfolded response
// protocol trivial: enter N notes and the trial submits itself.
// ===========================================================================
export const CHORD_TEMPLATES = {
  2: {
    close: [[0, 3], [0, 4], [0, 5]],
    wide: [[0, 11], [0, 14], [0, 16]],
    tense: [[0, 1], [0, 2], [0, 13]],
  },
  3: {
    stacked: [[0, 4, 7], [0, 3, 7], [0, 3, 6], [0, 4, 8]],
    spread: [[0, 7, 16], [0, 5, 14], [0, 9, 17]],
    cluster: [[0, 1, 3], [0, 2, 3], [0, 1, 5], [0, 2, 6]],
  },
  4: {
    stacked: [[0, 4, 7, 11], [0, 3, 7, 10], [0, 4, 7, 10], [0, 3, 6, 9]],
    spread: [[0, 7, 16, 21], [0, 5, 14, 21], [0, 9, 16, 23]],
    mixed: [[0, 2, 7, 13], [0, 1, 6, 11], [0, 3, 8, 14]],
  },
  5: {
    stacked: [[0, 4, 7, 11, 14], [0, 3, 7, 10, 14], [0, 4, 7, 10, 15]],
    spread: [[0, 7, 16, 21, 26], [0, 5, 14, 21, 28], [0, 9, 16, 23, 26]],
    mixed: [[0, 2, 5, 9, 16], [0, 1, 6, 11, 15], [0, 3, 8, 13, 18]],
  },
  6: {
    stacked: [[0, 4, 7, 11, 14, 18], [0, 3, 7, 10, 14, 17], [0, 4, 7, 10, 14, 18]],
    spread: [[0, 7, 14, 21, 28, 35], [0, 9, 16, 23, 30, 37], [0, 5, 14, 23, 28, 37]],
    mixed: [[0, 2, 5, 9, 16, 23], [0, 1, 6, 11, 15, 20], [0, 3, 8, 13, 18, 23]],
  },
};

// Chord segregation escalates on the number of simultaneous notes. Every
// session starts at 3 so the entry point is comparable; get one exactly right
// and the next is bigger, miss and it steps back.
const CHORD_START_SIZE = 3;
const CHORD_MIN_SIZE = 2;
const CHORD_MAX_SIZE = 6;

// Drop any template with a duplicated pitch class, so a typo above can never
// silently produce a chord whose answer set is smaller than its note count.
export function validTemplates(size, type) {
  return (CHORD_TEMPLATES[size][type] || []).filter((iv) => new Set(iv.map((x) => ((x % 12) + 12) % 12)).size === iv.length);
}

const chords = {
  id: "chords",
  title: "Chord Segregation",
  blurb: "Name every pitch class in a simultaneous chord.",
  keysHint: "Play each note you hear on the MIDI keyboard. R replays.",
  instructions: [
    "Chord segregation.",
    "You will hear several notes at once, and you will be told how many.",
    "Play every note you hear on the MIDI keyboard, in any octave and any order.",
    "The trial submits itself once you have entered that many notes.",
    "Press R to hear the chord again. You get two replays.",
    "Get one exactly right and the next chord gains a note, up to six. Miss any note and it drops back one.",
  ],
  count: (practice) => (practice ? 3 : 12),

  make({ rng, practice, io }) {
    const nTrials = practice ? 3 : 12;
    let size = CHORD_START_SIZE;
    const sizeLog = [];

    return {
      total: nTrials,
      serialize: () => ({ size, sizeLog }),
      restore: (s) => {
        if (!s) return;
        if (typeof s.size === "number") size = s.size;
        if (Array.isArray(s.sizeLog)) { sizeLog.length = 0; sizeLog.push(...s.sizeLog); }
      },

      async runTrial(i) {
        const p = { size, type: rng.pick(Object.keys(CHORD_TEMPLATES[size])) };
        const tmpls = validTemplates(p.size, p.type);
        const iv = rng.pick(tmpls);
        const maxIv = Math.max(...iv);
        const bassLo = 45, bassHi = Math.max(bassLo, 88 - maxIv);   // top note stays <= E6
        const bass = bassLo + rng.int(bassHi - bassLo + 1);
        const midis = iv.map((x) => bass + x);
        const truePcs = midis.map((m) => ((m % 12) + 12) % 12);
        const freqs = midis.map((m) => A.midiToFreq(m));

        const chord = A.renderChord({ freqs, durMs: 2000, rms: A.REF_RMS * 1.5 });
        let replays = 0;

        io.status(`${p.size} NOTES`);
        io.prompt(`Listen — <b>${p.size}</b> notes`);
        await io.say(`${p.size} notes`);
        const h = A.playMono(chord.data, A.nextSlot());
        await A.waitFor(h, 150);
        io.status("PLAY THE NOTES");

        const res = await io.awaitPitchClasses(p.size, {
          onsetPerf: h.onsetPerf, timeoutMs: 90000,
          onReplay: () => {
            if (replays >= 2) return false;
            replays++;
            A.playMono(chord.data, A.nextSlot());
            return true;
          },
        });
        io.receipt();
        io.prompt("");

        const chosen = res.pcs;
        const trueSet = new Set(truePcs);
        const chosenSet = new Set(chosen);
        const tp = [...chosenSet].filter((x) => trueSet.has(x));
        const fp = [...chosenSet].filter((x) => !trueSet.has(x));
        const fn = [...trueSet].filter((x) => !chosenSet.has(x));
        const precision = chosenSet.size ? tp.length / chosenSet.size : null;
        const recall = trueSet.size ? tp.length / trueSet.size : null;
        const f1 = precision != null && recall != null && precision + recall > 0
          ? (2 * precision * recall) / (precision + recall) : 0;

        // Escalate only on an exactly-right chord; anything less steps back.
        const exact = fn.length === 0 && fp.length === 0;
        const sizeBefore = p.size;
        const sizeAfter = exact
          ? Math.min(CHORD_MAX_SIZE, p.size + 1)
          : Math.max(CHORD_MIN_SIZE, p.size - 1);
        sizeLog.push({ trial: i, size: sizeBefore, exact, next: sizeAfter });
        size = sizeAfter;

        if (practice) {
          io.feedback(exact, `Chord was ${truePcs.map((x) => PC_NAMES[x]).join(" ")} — next chord has ${sizeAfter} notes`);
        }

        return {
          difficulty: p.size,
          stim: {
            chord_size: p.size, voicing_type: p.type, interval_vector: iv,
            bass_midi: bass, midi_notes: midis,
            note_names: midis.map((m) => `${PC_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`),
            pitch_classes: truePcs, pitch_class_names: truePcs.map((x) => PC_NAMES[x]),
            frequencies_hz: freqs.map((f) => +f.toFixed(3)),
            spread_semitones: maxIv, duration_ms: 2000,
            peak: +chord.meas.peak.toFixed(4), limited: chord.meas.limited,
          },
          correct_answer: truePcs.map((x) => PC_NAMES[x]).join(" "),
          response: chosen.map((x) => PC_NAMES[x]).join(" "),
          correct: fn.length === 0 && fp.length === 0,
          rt_ms: res.rtMs,
          input_method: res.method, timed_out: res.timedOut,
          block: `size${p.size}`,
          adaptive: { size_before: sizeBefore, exact, size_after: sizeAfter },
          extra: {
            true_positives: tp.length, false_positives: fp.length, missed: fn.length,
            missed_names: fn.map((x) => PC_NAMES[x]), false_positive_names: fp.map((x) => PC_NAMES[x]),
            precision, recall, f1: +f1.toFixed(4),
            replays, rt_total_ms: res.rtTotalMs, entry_rts_ms: res.entryRts,
          },
        };
      },

      summary(trials) {
        const bySize = {};
        for (const t of trials) {
          const k = `size${t.stim.chord_size}`;
          bySize[k] = bySize[k] || { n: 0, tp: 0, fp: 0, fn: 0, exact: 0, notes: 0 };
          const b = bySize[k];
          b.n++; b.tp += t.extra.true_positives; b.fp += t.extra.false_positives;
          b.fn += t.extra.missed; b.notes += t.stim.chord_size;
          if (t.correct) b.exact++;
        }
        for (const b of Object.values(bySize)) {
          b.note_accuracy = +(b.tp / b.notes).toFixed(4);
          b.exact_rate = +(b.exact / b.n).toFixed(4);
        }
        const totTp = trials.reduce((a, t) => a + t.extra.true_positives, 0);
        const totNotes = trials.reduce((a, t) => a + t.stim.chord_size, 0);
        const sizes = trials.map((t) => t.stim.chord_size);
        const solved = trials.filter((t) => t.correct).map((t) => t.stim.chord_size);
        return {
          n: trials.length,
          // The escalating headline: the biggest chord he actually got exactly
          // right, and the average size the staircase settled around.
          max_size_solved: solved.length ? Math.max(...solved) : null,
          mean_size: sizes.length ? +mean(sizes).toFixed(3) : null,
          max_size_reached: sizes.length ? Math.max(...sizes) : null,
          final_size: size,
          size_log: sizeLog,
          note_accuracy: totNotes ? +(totTp / totNotes).toFixed(4) : null,
          exact_chord_rate: trials.length ? +(trials.filter((t) => t.correct).length / trials.length).toFixed(4) : null,
          mean_f1: mean(trials.map((t) => t.extra.f1)),
          total_false_positives: trials.reduce((a, t) => a + t.extra.false_positives, 0),
          total_missed: trials.reduce((a, t) => a + t.extra.missed, 0),
          total_replays: trials.reduce((a, t) => a + t.extra.replays, 0),
          by_size: bySize,
          median_rt_ms: median(trials.map((t) => t.rt_ms)),
          ...rangeFlags(totNotes ? totTp / totNotes : null, 0.1),
        };
      },
    };
  },
};

// ===========================================================================
// 6. Auditory Working Memory  —  ADAPTIVE n-back on microtonal tones
//
// The load climbs. Every session starts at 2-back so the entry point is always
// comparable, then after each block the level moves: clear it nearly clean and
// the next block goes one deeper, struggle and it steps back. A trained
// musician would sit at ceiling on a fixed 2-back, which would hide any real
// change; letting it climb means the measurement follows him up.
//
// Two headline numbers come out, and they answer different questions:
//   • level reached  — how deep he got. Escalating, intuitive, good on camera.
//   • d' per level   — sensitivity at a given load, separated from response
//                      bias, so a session where he simply pressed more often
//                      does not masquerade as improvement.
//
// The tone pool sits on a 137-cent grid with a randomly roved base, so the
// items have no note names to rehearse verbally — which was the specific
// failure mode to avoid for a trained musician.
// ===========================================================================
const NB_POOL = 6;
const NB_SPACING_CENTS = 137;
const NB_SOA_MS = 1750;
const NB_TONE_MS = 300;
const NB_START_LEVEL = 2;          // identical every session: a fixed entry point
const NB_MIN_LEVEL = 1;
const NB_MAX_LEVEL = 6;
const NB_UP_ERRORS = 2;            // <= this many errors in a block -> go deeper
const NB_DOWN_ERRORS = 5;          // >= this many -> step back

export function buildNbackSeq(len, n, pool, rng) {
  const nTargets = Math.round((len - n) * 0.36);
  const eligible = [];
  for (let i = n; i < len; i++) eligible.push(i);
  const targets = new Set(shuffled(eligible, rng).slice(0, nTargets));
  const seq = new Array(len).fill(-1);
  const lures = new Set();
  for (let i = 0; i < len; i++) {
    if (i < n) { seq[i] = rng.int(pool); continue; }
    if (targets.has(i)) { seq[i] = seq[i - n]; continue; }
    // Lure: match at n-1 or n+1 back. Stops him answering on bare familiarity.
    const lureLag = rng.bool() ? n - 1 : n + 1;
    const j = i - lureLag;
    if (lureLag > 0 && j >= 0 && seq[j] !== seq[i - n] && rng() < 0.28) {
      seq[i] = seq[j]; lures.add(i); continue;
    }
    let v; do { v = rng.int(pool); } while (v === seq[i - n]);
    seq[i] = v;
  }
  // Arrays rather than Sets so a block survives serialize/restore on resume.
  return { seq, targets: [...targets].sort((a, b) => a - b), lures: [...lures].sort((a, b) => a - b) };
}

const workmem = {
  id: "workmem",
  title: "Auditory Working Memory",
  blurb: "Press space when a tone repeats N tones back.",
  keysHint: "SPACE = this tone matches the one N back",
  instructions: [
    "Auditory working memory.",
    "A steady stream of tones will play. These tones are deliberately not musical notes, so you cannot name them.",
    "Press the space bar whenever the current tone is the same as the tone a certain number of steps earlier.",
    "You will be told how many steps back at the start of each block. It begins at two back.",
    "If you get a block nearly perfect, the next one goes one step deeper. If you struggle, it steps back. So it should always feel hard — that is working as intended.",
    "Do nothing when it is not a match.",
  ],
  count: (practice) => (practice ? 20 : 40),

  make({ rng, practice, io }) {
    const nBlocks = 2;
    const blockLen = practice ? 10 : 20;
    const built = [];                    // blocks are built lazily: n depends on how the previous one went
    let level = NB_START_LEVEL;
    const levelLog = [];

    function ensureBlock(bi) {
      while (built.length <= bi) {
        const n = level;
        const baseHz = 300 * Math.pow(2, rng.range(-0.3, 0.3));
        const pool = Array.from({ length: NB_POOL }, (_, k) => A.centsShift(baseHz, k * NB_SPACING_CENTS));
        built.push({ n, len: blockLen, baseHz, pool, ...buildNbackSeq(blockLen, n, NB_POOL, rng) });
      }
      return built[bi];
    }

    let running = null;   // presses collected during the currently playing block
    const blockStarts = new Set();
    for (let bi = 0; bi < nBlocks; bi++) blockStarts.add(bi * blockLen);

    return {
      total: nBlocks * blockLen,
      serialize: () => ({ level, built, levelLog }),
      restore: (s) => {
        if (!s) return;
        if (typeof s.level === "number") level = s.level;
        if (Array.isArray(s.built)) { built.length = 0; built.push(...s.built); }
        if (Array.isArray(s.levelLog)) { levelLog.length = 0; levelLog.push(...s.levelLog); }
      },
      // The tone stream is scheduled a whole block at a time, so pausing partway
      // through would leave the response windows pointing at audio that has
      // already been cancelled. Pausing waits for the next block boundary.
      pauseSafe: (i) => blockStarts.has(i),

      async runTrial(k) {
        const bi = Math.floor(k / blockLen);
        const i = k % blockLen;
        const b = ensureBlock(bi);

        // At the head of a block, schedule the whole stream at once. Web Audio
        // scheduling is sample-accurate, so this gives exact SOAs — far better
        // than driving 22 tones off setTimeout.
        if (i === 0) {
          await io.blockIntro(`${b.n}-BACK`, `Press SPACE when a tone matches the one ${b.n} back.`);
          const buffers = b.pool.map((f) =>
            A.toBuffer(A.renderTone({ freq: f, durMs: NB_TONE_MS, timbre: "organ", rms: A.REF_RMS }).data));
          const t0 = A.nextSlot() + 0.6;
          const onsets = [];
          for (let j = 0; j < b.len; j++) {
            const h = A.playAt(buffers[b.seq[j]], t0 + (j * NB_SOA_MS) / 1000);
            onsets.push(h.onsetPerf);
          }
          running = { onsets, presses: io.collectSpace(), errors: 0 };
          io.status(`${b.n}-BACK`);
        }

        const onset = running.onsets[i];
        // Response window closes just before the next tone lands.
        const windowEnd = onset + NB_SOA_MS - 120;
        await A.sleep(Math.max(0, windowEnd - performance.now()));

        const press = running.presses.find((p) => p.t >= onset - 150 && p.t <= windowEnd && !p.used);
        if (press) press.used = true;

        const isTarget = b.targets.includes(i);
        const responded = !!press;
        const correct = isTarget ? responded : !responded;
        if (!correct) running.errors++;

        const levelBefore = b.n;
        let levelAfter = b.n;
        if (i === b.len - 1) {
          io.stopCollectSpace();
          const errs = running.errors;
          if (errs <= NB_UP_ERRORS) levelAfter = Math.min(NB_MAX_LEVEL, b.n + 1);
          else if (errs >= NB_DOWN_ERRORS) levelAfter = Math.max(NB_MIN_LEVEL, b.n - 1);
          level = levelAfter;
          levelLog.push({ block: bi, n: b.n, errors: errs, next: levelAfter });
          if (practice) {
            io.feedback(errs <= NB_UP_ERRORS,
              `${errs} error${errs === 1 ? "" : "s"} at ${b.n}-back — next block is ${levelAfter}-back`);
            await A.sleep(1600);
          }
        }

        return {
          difficulty: b.n,
          stim: {
            n_back: b.n, block_index: bi, position: i, block_length: b.len,
            pool_index: b.seq[i], frequency_hz: +b.pool[b.seq[i]].toFixed(3),
            pool_base_hz: +b.baseHz.toFixed(3), pool_spacing_cents: NB_SPACING_CENTS,
            pool_hz: b.pool.map((f) => +f.toFixed(3)),
            is_target: isTarget, is_lure: b.lures.includes(i),
            soa_ms: NB_SOA_MS, tone_ms: NB_TONE_MS,
          },
          correct_answer: isTarget ? "press" : "no_press",
          response: responded ? "press" : "no_press",
          correct,
          rt_ms: press ? +(press.t - onset).toFixed(1) : null,
          input_method: press ? press.method : "none",
          timed_out: false,
          block: `${b.n}back`,
          adaptive: i === b.len - 1
            ? { level_before: levelBefore, block_errors: running.errors, level_after: levelAfter }
            : { level_before: levelBefore },
          extra: {
            outcome: isTarget ? (responded ? "hit" : "miss") : (responded ? "false_alarm" : "correct_rejection"),
          },
        };
      },

      summary(trials) {
        const out = {};
        for (const nb of [...new Set(trials.map((t) => t.stim.n_back))].sort((a, b) => a - b)) {
          const ts = trials.filter((t) => t.stim.n_back === nb);
          const sig = ts.filter((t) => t.stim.is_target);
          const noi = ts.filter((t) => !t.stim.is_target);
          const hits = sig.filter((t) => t.response === "press").length;
          const fas = noi.filter((t) => t.response === "press").length;
          const lureFas = noi.filter((t) => t.stim.is_lure && t.response === "press").length;
          const nLure = noi.filter((t) => t.stim.is_lure).length;
          out[`n${nb}`] = {
            n: ts.length, n_targets: sig.length, hits, misses: sig.length - hits,
            false_alarms: fas, correct_rejections: noi.length - fas,
            hit_rate: sig.length ? +(hits / sig.length).toFixed(4) : null,
            fa_rate: noi.length ? +(fas / noi.length).toFixed(4) : null,
            lure_fa_rate: nLure ? +(lureFas / nLure).toFixed(4) : null,
            d_prime: +(dPrime(hits, sig.length, fas, noi.length) ?? 0).toFixed(4),
            criterion_c: +(criterionC(hits, sig.length, fas, noi.length) ?? 0).toFixed(4),
            accuracy: +(ts.filter((t) => t.correct).length / ts.length).toFixed(4),
            median_hit_rt_ms: median(sig.filter((t) => t.rt_ms != null).map((t) => t.rt_ms)),
          };
        }
        const levels = levelLog.map((l) => l.n);
        const ds = Object.values(out).map((o) => o.d_prime);
        // Blocks cleared at the up-threshold. This is the escalating number:
        // the deepest load he actually held, not merely the deepest he saw.
        const cleared = levelLog.filter((l) => l.errors <= NB_UP_ERRORS).map((l) => l.n);
        return {
          n: trials.length,
          start_level: NB_START_LEVEL,
          levels_seen: levels,
          mean_level: levels.length ? +mean(levels).toFixed(3) : null,
          max_level_reached: levels.length ? Math.max(...levels) : null,
          max_level_cleared: cleared.length ? Math.max(...cleared) : null,
          final_level: level,
          block_log: levelLog,
          by_load: out,
          mean_d_prime: ds.length ? +mean(ds).toFixed(4) : null,
          ...rangeFlags(trials.length ? trials.filter((t) => t.correct).length / trials.length : null, 0.64),
        };
      },
    };
  },
};

// ===========================================================================
// 7. Cocktail Party / Auditory Masking
//
// Tonal informational masking rather than speech. Browser speech synthesis
// varies by OS and cannot be routed through Web Audio at a controlled SNR, so a
// speech version would not be comparable between sessions or machines. This is
// fully synthetic and identical everywhere.
//
// Target: an 8-tone melody that rises or falls. Masker: random tones outside a
// protected band around the target, redrawn on every burst. Two interleaved
// adaptive tracks:
//
//   colocated  — target and masker both diotic (fused at the centre)
//   separated  — masker given a 700 us ITD plus an 8 dB ILD, so it lateralises
//                to the right while the target stays centred
//
// The difference between the two thresholds is spatial release from masking,
// in dB. That single number is the video-friendly output.
// ===========================================================================
const MASK_ITD_US = 700;
const MASK_ILD_DB = 8;
const MASK_BURST_MS = 60;
const MASK_SOA_MS = 100;
const MASK_N_BURSTS = 8;
const MASK_N_MASKERS = 6;

const masking = {
  id: "masking",
  title: "Cocktail Party",
  blurb: "Did the target melody rise or fall, through the competing tones?",
  keysHint: "F = fell   ·   J = rose",
  instructions: [
    "Cocktail party.",
    "You will hear a short melody hidden inside a cloud of competing tones.",
    "The melody is the one that moves smoothly. Decide whether it went up or down overall.",
    "Press F if it fell, J if it rose.",
    "Headphones are required for this test.",
  ],
  // The headline output here is a *difference* between two thresholds, so its
  // noise is sqrt(2) times each one's. At 16 trials per condition the noise on
  // spatial release (~4.6 dB) is the same size as the effect being looked for
  // (typically 5-10 dB), which would make the measure useless. 24 trials per
  // condition brings it down to roughly 3.8 dB.
  count: (practice) => (practice ? 6 : 16),

  make({ rng, practice, io }) {
    // One condition only. Spatial release is a difference of two thresholds,
    // and at the trial count a 10-minute battery allows its noise would be
    // larger than the effect — a number that misleads is worse than none.
    const conds = ["colocated"];
    const zests = {};
    // ZEST variable is masker-to-target amplitude ratio: bigger = harder.
    // Threshold converts to target-to-masker ratio in dB as -20*log10(x).
    conds.forEach((c) => { zests[c] = makeZest({ min: 0.12, max: 40, priorMode: 1.0, ...ZEST_ROBUST }); });

    const plan = [];
    if (practice) {
      conds.forEach((c) => [0.4, 0.7, 1.0, 1.5, 0.55, 1.2].forEach((x) => plan.push({ kind: "anchor", cond: c, x })));
    } else {
      for (const c of conds) {
        for (let k = 0; k < 14; k++) plan.push({ kind: "adapt", cond: c });
        for (const x of [0.63, 1.58]) plan.push({ kind: "anchor", cond: c, x });   // TMR +4 / -4 dB
      }
    }
    const order = practice ? plan : shuffled(plan, rng);

    return {
      total: order.length,
      serialize: () => ({ z: Object.fromEntries(conds.map((c) => [c, zests[c].serialize()])) }),
      restore: (s) => { if (s && s.z) conds.forEach((c) => s.z[c] && zests[c].restore(s.z[c])); },

      async runTrial(i) {
        const p = order[i];
        const z = zests[p.cond];
        const before = z.state();
        const x = p.kind === "anchor" ? p.x : z.next(rng);
        const tmrDb = -20 * Math.log10(x);
        const rising = rng.bool();

        const sr = A.getEngine().sr;
        const centerHz = rng.logRange(700, 1400);
        const spanSemis = 6;
        const lo = A.centsShift(centerHz, (-spanSemis / 2) * 100);
        const targetFreqs = [];
        for (let k = 0; k < MASK_N_BURSTS; k++) {
          const frac = k / (MASK_N_BURSTS - 1);
          const step = rising ? frac : 1 - frac;
          targetFreqs.push(A.centsShift(lo, step * spanSemis * 100 + rng.range(-25, 25)));
        }
        const tMin = Math.min(...targetFreqs), tMax = Math.max(...targetFreqs);
        const protLo = tMin / 1.7, protHi = tMax * 1.7;   // ~0.77 octave protected band

        const totalMs = MASK_N_BURSTS * MASK_SOA_MS + 40;
        const nSamp = Math.round((sr * totalMs) / 1000);
        const target = new Float32Array(nSamp);
        const masker = new Float32Array(nSamp);
        const maskerFreqs = [];

        for (let k = 0; k < MASK_N_BURSTS; k++) {
          const at = (sr * k * MASK_SOA_MS) / 1000;
          const tb = A.renderSine({ freq: targetFreqs[k], durMs: MASK_BURST_MS, rms: 0.1, attackMs: 12, releaseMs: 12 });
          A.mixInto(target, tb.data, at);
          const burst = [];
          for (let m = 0; m < MASK_N_MASKERS; m++) {
            // 250-4500 Hz rather than a narrower span: it leaves roughly equal
            // log-frequency room above and below the protected band, so maskers
            // do not pile up on one side of the target.
            let f;
            do { f = rng.logRange(250, 4500); } while (f > protLo && f < protHi);
            burst.push(+f.toFixed(1));
            const mb = A.renderSine({ freq: f, durMs: MASK_BURST_MS, rms: 0.1 / Math.sqrt(MASK_N_MASKERS), attackMs: 12, releaseMs: 12 });
            A.mixInto(masker, mb.data, at);
          }
          maskerFreqs.push(burst);
        }

        // Unit-RMS each stream, then set the ratio. Normalizing the mixture (not
        // the parts) keeps overall loudness constant across trials, so absolute
        // level never leaks the difficulty.
        const tr = A.rmsOf(target) || 1e-9, mr = A.rmsOf(masker) || 1e-9;
        for (let n = 0; n < nSamp; n++) { target[n] /= tr; masker[n] /= mr; }
        for (let n = 0; n < nSamp; n++) masker[n] *= x;

        let buffer;
        if (p.cond === "colocated") {
          const mix = new Float32Array(nSamp);
          for (let n = 0; n < nSamp; n++) mix[n] = target[n] + masker[n];
          A.normalizeRms(mix, A.REF_RMS * 1.3);
          buffer = A.toStereoBuffer(mix, mix);
        } else {
          const delay = Math.round((sr * MASK_ITD_US) / 1e6);
          const gR = A.dbToGain(MASK_ILD_DB / 2), gL = A.dbToGain(-MASK_ILD_DB / 2);
          const L = new Float32Array(nSamp), R = new Float32Array(nSamp);
          for (let n = 0; n < nSamp; n++) {
            R[n] = target[n] + masker[n] * gR;                                  // masker leads right
            L[n] = target[n] + (n >= delay ? masker[n - delay] * gL : 0);
          }
          const combined = Math.sqrt((A.rmsOf(L) ** 2 + A.rmsOf(R) ** 2) / 2) || 1e-9;
          const g = (A.REF_RMS * 1.3) / combined;
          for (let n = 0; n < nSamp; n++) { L[n] *= g; R[n] *= g; }
          buffer = A.toStereoBuffer(L, R);
        }

        io.status("LISTEN");
        const h = A.playAt(buffer, A.nextSlot());
        await A.waitFor(h);
        io.status("UP or DOWN?");

        const res = await io.awaitChoice({
          map: { f: "fell", j: "rose", arrowdown: "fell", arrowup: "rose" },
          onsetPerf: h.endPerf, timeoutMs: 20000,
        });
        io.receipt();

        const answer = rising ? "rose" : "fell";
        const correct = res.value == null ? null : res.value === answer;
        // Anchors stay out of the posterior, so raw accuracy at a fixed TMR
        // remains an independent, model-free check on the adaptive threshold.
        if (correct != null && p.kind === "adapt") z.update(x, correct);
        if (practice) io.feedback(correct, `It ${answer} — target ${tmrDb.toFixed(1)} dB vs masker`);

        return {
          difficulty: +tmrDb.toFixed(3),
          stim: {
            condition: p.cond, tmr_db: +tmrDb.toFixed(3), masker_to_target_ratio: +x.toFixed(5),
            target_direction: answer, target_center_hz: +centerHz.toFixed(2),
            target_span_semitones: spanSemis,
            target_freqs_hz: targetFreqs.map((f) => +f.toFixed(2)),
            masker_freqs_hz: maskerFreqs,
            protected_band_hz: [+protLo.toFixed(1), +protHi.toFixed(1)],
            n_bursts: MASK_N_BURSTS, burst_ms: MASK_BURST_MS, soa_ms: MASK_SOA_MS,
            n_maskers_per_burst: MASK_N_MASKERS,
            itd_us: p.cond === "separated" ? MASK_ITD_US : 0,
            ild_db: p.cond === "separated" ? MASK_ILD_DB : 0,
          },
          correct_answer: answer, response: res.value, correct,
          rt_ms: res.rtMs, input_method: res.method, timed_out: res.timedOut,
          block: p.cond,
          adaptive: {
            kind: p.kind, condition: p.cond,
            mean_before: +before.mean.toFixed(4), sd_log10_before: +before.sd_log10.toFixed(4),
            mean_after: +z.state().mean.toFixed(4), sd_log10_after: +z.state().sd_log10.toFixed(4),
            tmr_db_estimate: +(-20 * Math.log10(z.estimate())).toFixed(3),
          },
        };
      },

      summary(trials) {
        const out = {};
        for (const c of conds) {
          const est = zests[c].estimate();
          const ts = trials.filter((t) => t.block === c && t.correct != null);
          const anchors = {};
          for (const t of ts.filter((x) => x.adaptive && x.adaptive.kind === "anchor")) {
            const k = `tmr${t.stim.tmr_db > 0 ? "+" : ""}${Math.round(t.stim.tmr_db)}`;
            anchors[k] = anchors[k] || { n: 0, correct: 0 };
            anchors[k].n++; if (t.correct) anchors[k].correct++;
          }
          out[c] = {
            n: ts.length,
            tmr_threshold_db: +(-20 * Math.log10(est)).toFixed(3),
            ci68_db: zests[c].ci68().map((v) => +(-20 * Math.log10(v)).toFixed(2)).sort((a, b) => a - b),
            posterior_sd_log10: +zests[c].sdLog10().toFixed(4),
            accuracy: ts.length ? +(ts.filter((t) => t.correct).length / ts.length).toFixed(4) : null,
            anchor_accuracy: anchors,
            median_rt_ms: median(ts.map((t) => t.rt_ms)),
          };
        }
        return {
          n: trials.length,
          colocated_tmr_db: out.colocated ? out.colocated.tmr_threshold_db : null,
          separated_tmr_db: out.separated ? out.separated.tmr_threshold_db : null,
          spatial_release_db: out.colocated && out.separated
            ? +(out.colocated.tmr_threshold_db - out.separated.tmr_threshold_db).toFixed(3) : null,
          by_condition: out,
          overall_accuracy: pctCorrect(trials),
          ...rangeFlags(pctCorrect(trials), 0.5),
        };
      },
    };
  },
};

// ===========================================================================
// The battery.
//
// Five core modules, not seven. Each core module either has direct evidence at
// this timescale or produces a continuous, well-powered measure:
//
//   discrim      pitch discrimination threshold in cents. Gougoux et al. 2004
//                (Nature) found large pitch-direction advantages in the blind.
//   harmonicity  the strongest short-duration result there is: Landry, Shiller
//                & Champoux 2013 saw improvement after 90 minutes blindfolded.
//   workmem      d' from n-back. Amedi et al. 2003 found superior memory in the
//                blind, correlated with visual-cortex recruitment.
//   masking      spatial release from masking. Lewald 2007 found better sound
//                localization after 90 minutes of light deprivation.
//   tagging      no literature at this timescale and low power on raw accuracy,
//                but decision RT and semitone error are continuous and it is the
//                measure with the most narrative value.
//
// Pitch memory and chord segregation are available but off by default. Pitch
// memory is largely redundant with the n-back, which measures the same storage
// with far better power; chord segregation has no supporting literature and is
// the slowest module per trial. Spending those minutes on more trials in the
// five above buys more than two extra weakly-powered tests would.
//
// Order is fixed, not randomized. Randomizing would turn fatigue into a random
// effect that differs between sessions; fixing it makes fatigue a constant that
// subtracts out of every session-to-session comparison. Note naming runs first
// because it wants a fresh ear, and the cocktail party test runs last because
// it is the most attention-hungry.
// ===========================================================================
export const CORE_MODULES = [tagging, discrim, harmonicity, workmem, masking];
export const OPTIONAL_MODULES = [memory, chords];
export const MODULES = [tagging, discrim, harmonicity, memory, chords, workmem, masking];
export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m]));

/** Resolve a saved module-id list back to modules, in canonical battery order. */
export function modulesFor(ids) {
  const set = new Set(ids && ids.length ? ids : CORE_MODULES.map((m) => m.id));
  return MODULES.filter((m) => set.has(m.id));
}

export { PC_NAMES };
