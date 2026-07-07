// Yes / No mode — a fast match/no-match drill.
//
// A pitch-class letter is shown; a piano note plays that is a 50/50 shot at
// being that same pitch class or a random different one. You answer Yes (it
// matched) or No. Then it reveals right/wrong, tells you what note actually
// played, and plays the PP-MIDI sample of the SHOWN note as the anchor.

export function setupYesNo(ctx) {
  const { Tone, PITCH_NAMES } = ctx;
  const root = document.getElementById("yesno");

  let ready = false;
  let round = null;
  let score = { correct: 0, total: 0 };
  let autoNext = localStorage.getItem("pt.yesno.autonext") === "1";
  let autoTimer = null;

  function cancelAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }

  function playPiano(pc, oct) {
    const piano = ctx.getPiano();
    if (piano) { try { piano.triggerAttackRelease(`${PITCH_NAMES[pc]}${oct}`, "1n", Tone.now(), 0.9); } catch (_) {} }
  }
  function playSample(pc) {
    const bank = ctx.getBank();
    if (bank) bank.play(PITCH_NAMES[pc], {}); // OG-pitch sample of the shown note
  }

  function render() {
    root.innerHTML = `
      <div class="yn">
        <div class="trainer-score" id="yn-score">0 / 0</div>
        <div class="yn-note" id="yn-note">—</div>
        <div class="yn-sub" id="yn-sub">Does the piano note match?</div>
        <div class="yn-answers">
          <button class="answer-btn" id="yn-yes">Yes ✓</button>
          <button class="answer-btn" id="yn-no">No ✗</button>
        </div>
        <div class="yn-result" id="yn-result"></div>
        <div class="trainer-actions">
          <button class="ghost" id="yn-replay">play again ↺</button>
          <button class="ghost" id="yn-next" style="visibility:hidden">next →</button>
        </div>
        <label class="autonext"><input type="checkbox" id="yn-auto"> auto-next on answer</label>
      </div>`;
    root.querySelector("#yn-yes").addEventListener("click", () => answer(true));
    root.querySelector("#yn-no").addEventListener("click", () => answer(false));
    root.querySelector("#yn-replay").addEventListener("click", () => { if (round) playPiano(round.playedPc, round.oct); });
    root.querySelector("#yn-next").addEventListener("click", () => { cancelAuto(); newRound(); });
    const cb = root.querySelector("#yn-auto");
    cb.checked = autoNext;
    cb.addEventListener("change", () => { autoNext = cb.checked; localStorage.setItem("pt.yesno.autonext", autoNext ? "1" : "0"); });
  }

  const $ = (s) => root.querySelector(s);
  function setResult(html, cls) { const e = $("#yn-result"); if (e) { e.innerHTML = html; e.className = "yn-result " + (cls || ""); } }
  function showNext(v) { const e = $("#yn-next"); if (e) e.style.visibility = v ? "visible" : "hidden"; }
  function setAnswersDisabled(d) { $("#yn-yes").disabled = d; $("#yn-no").disabled = d; }

  function newRound() {
    if (!ready) return;
    cancelAuto();
    const shownPc = Math.floor(Math.random() * 12);
    const isSame = Math.random() < 0.5;
    const playedPc = isSame ? shownPc : (shownPc + 1 + Math.floor(Math.random() * 11)) % 12;
    const oct = 3 + Math.floor(Math.random() * 2); // C3–B4 so register can't be gamed
    round = { shownPc, playedPc, isSame, oct, done: false };

    $("#yn-note").textContent = PITCH_NAMES[shownPc];
    setResult("", "");
    showNext(false);
    setAnswersDisabled(false);
    playPiano(playedPc, oct);
  }

  function answer(saidYes) {
    if (!round || round.done) return;
    round.done = true;
    setAnswersDisabled(true);
    const correct = saidYes === round.isSame;
    score.total++;
    if (correct) score.correct++;
    $("#yn-score").textContent = `${score.correct} / ${score.total}`;

    // Reveal: what actually played, and play the shown note's OG sample.
    const heard = PITCH_NAMES[round.playedPc];
    const verdict = correct ? "✅ Correct" : "❌ Wrong";
    setResult(
      `${verdict} — played note was <b>${heard}</b> (${round.isSame ? "match" : "different"})`,
      correct ? "correct" : "wrong"
    );
    playSample(round.shownPc);

    showNext(true);
    if (autoNext) { cancelAuto(); autoTimer = setTimeout(() => { autoTimer = null; newRound(); }, 1500); }
  }

  return {
    async enter() {
      render();
      ctx.setStatus("Loading Yes/No…");
      try {
        await Promise.all([ctx.ensurePiano(), ctx.ensureSampleBank()]);
        ready = true;
        score = { correct: 0, total: 0 };
        ctx.setStatus("Yes / No");
        newRound();
      } catch (err) {
        ctx.setStatus(err && err.message ? err.message : String(err), true);
      }
    },
    exit() { cancelAuto(); round = null; },
  };
}
