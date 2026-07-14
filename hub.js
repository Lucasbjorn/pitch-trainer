// Home hub (NYT-mini style) + daily games. The clean iPhone-first landing;
// "Lucas's Lab" reveals the full trainer suite underneath.

import {
  socialConfigured, getSession, signInGoogle, signOut, getProfile, saveProfile, submitScore, leaderboard,
  myId, listProfiles, createPost, fetchFeed, fetchComments, addComment,
  listThreads, fetchThread, sendMessage, subscribeChanges,
} from "./social.js";
import { DAILY_RUNNERS } from "./dailygames.js";

const DAYMS = 86400000;
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function setupHub(ctx) {
  const { Tone } = ctx;
  const home = document.getElementById("home");
  const daily = document.getElementById("daily");

  let synth = null;
  function ensureSynth() {
    if (!synth) {
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.03, attackCurve: "sine", decay: 0.05, sustain: 0.9, release: 0.16, releaseCurve: "linear" },
      }).toDestination();
      synth.volume.value = -6;
    }
    return synth;
  }
  function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function centsFreq(f, c) { return f * Math.pow(2, c / 1200); }
  function tone(freq, at = 0, dur = 0.5) { try { ensureSynth().triggerAttackRelease(freq, dur, Tone.now() + at); } catch (_) {} }

  function loadDaily(id) { try { return JSON.parse(localStorage.getItem(`pt.daily.${id}`)) || {}; } catch (_) { return {}; } }
  function saveDaily(id, o) { try { localStorage.setItem(`pt.daily.${id}`, JSON.stringify(o)); } catch (_) {} }

  // =========================================================================
  // HOME
  // =========================================================================
  const DAILIES = [
    { id: "jnd", title: "Smallest Interval", sub: "How fine is your ear today?", icon: "📏", color: "#6c8cff", live: true },
    { id: "interval", title: "Interval Ear", sub: "Name the interval between two notes", icon: "🎼", color: "#f2c94c", live: true },
    { id: "prog", title: "Chord Progression", sub: "Name the diatonic changes", icon: "🎹", color: "#f79f5b", live: true },
    { id: "leap", title: "Compound Leap", sub: "Notes octaves apart", icon: "🪃", color: "#7bd88f", live: true },
    { id: "mistuned", title: "Spot the Sour Note", sub: "Which note is out of tune?", icon: "🍋", color: "#eb5757", live: true },
  ];
  function gameMeta(id) { return DAILIES.find((x) => x.id === id) || { title: id }; }

  function renderHome() {
    const d = new Date();
    const dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const cards = DAILIES.map((game) => {
      const rec = loadDaily(game.id);
      const played = rec.date === todayStr();
      let tag = "";
      if (!game.live) tag = `<span class="hub-tag soon">soon</span>`;
      else if (played) tag = `<span class="hub-tag done">✓ ${rec.label || "done"}</span>`;
      else tag = `<span class="hub-tag play">Play</span>`;
      return `
        <button class="hub-card ${game.live ? "" : "locked"}" data-daily="${game.id}" ${game.live ? "" : "disabled"}>
          <div class="hub-icon" style="background:${game.color}">${game.icon}</div>
          <div class="hub-card-body">
            <div class="hub-card-title">${game.title}</div>
            <div class="hub-card-sub">${game.sub}</div>
          </div>
          ${tag}
        </button>`;
    }).join("");

    home.innerHTML = `
      <div class="hub">
        ${socialConfigured() ? `<button class="hub-user" id="hub-user">…</button>` : ""}
        <div class="hub-head">
          <div class="hub-date">${dateStr}</div>
          <h1 class="hub-title">Ear Games</h1>
        </div>
        <div class="hub-section-label">Today's puzzles</div>
        <div class="hub-cards">${cards}</div>
        ${socialConfigured() ? `<div class="hub-nav"><button data-feed>🗞 Feed</button><button data-dms>✉️ Messages</button></div>` : ""}
        <button class="hub-lab" data-lab>🧪 Lucas's Lab — all the trainers ›</button>
        <div class="hub-foot">${socialConfigured() ? "One attempt per game per day." : "One attempt per game per day. Leaderboard coming soon."}</div>
      </div>`;

    home.querySelectorAll("[data-daily]").forEach((b) => b.addEventListener("click", () => ctx.goDaily(b.dataset.daily)));
    home.querySelector("[data-lab]").addEventListener("click", () => ctx.goLucas());
    const fb = home.querySelector("[data-feed]"); if (fb) fb.addEventListener("click", () => ctx.goDaily("feed"));
    const mb = home.querySelector("[data-dms]"); if (mb) mb.addEventListener("click", () => ctx.goDaily("dms"));
    refreshUser();
  }

  // ---- account chip + profile ----
  let me = null; // { session, profile }
  async function loadMe() {
    if (!socialConfigured()) return null;
    const session = await getSession();
    if (!session) { me = { session: null, profile: null }; return me; }
    const profile = await getProfile(session.user.id);
    me = { session, profile };
    return me;
  }
  async function refreshUser() {
    const el = document.getElementById("hub-user");
    if (!el) return;
    await loadMe();
    if (!me || !me.session) { el.textContent = "Sign in"; el.onclick = () => signInGoogle(); return; }
    if (!me.profile || !me.profile.avatar_url) { el.textContent = "Finish profile →"; el.onclick = openProfile; return; }
    el.innerHTML = `<img src="${me.profile.avatar_url}" alt=""><span>${me.profile.username}</span>`;
    el.onclick = openProfile;
  }
  function openProfile() {
    const cur = (me && me.profile) || {};
    home.insertAdjacentHTML("beforeend", `
      <div class="modal" id="prof-modal">
        <div class="modal-card">
          <div class="modal-title">Your profile</div>
          <label class="modal-avatar" id="prof-pic">
            ${cur.avatar_url ? `<img src="${cur.avatar_url}">` : `<span>＋ photo</span>`}
            <input type="file" id="prof-file" accept="image/*" hidden>
          </label>
          <input class="modal-input" id="prof-name" placeholder="username" value="${cur.username || ""}" maxlength="20">
          <div class="modal-err" id="prof-err"></div>
          <button class="dg-cta" id="prof-save">Save</button>
          <div class="modal-actions">
            ${me && me.session ? `<button class="ghost" id="prof-signout">sign out</button>` : ""}
            <button class="ghost" id="prof-close">close</button>
          </div>
        </div>
      </div>`);
    let file = null;
    const modal = document.getElementById("prof-modal");
    const pic = document.getElementById("prof-file");
    pic.addEventListener("change", (e) => {
      file = e.target.files[0];
      if (file) document.getElementById("prof-pic").innerHTML = `<img src="${URL.createObjectURL(file)}">`;
    });
    document.getElementById("prof-save").addEventListener("click", async () => {
      const name = document.getElementById("prof-name").value.trim();
      const err = document.getElementById("prof-err");
      if (!name) { err.textContent = "Pick a username."; return; }
      if (!cur.avatar_url && !file) { err.textContent = "A profile photo is required."; return; }
      err.textContent = "Saving…";
      const res = await saveProfile(me.session.user.id, name, file);
      if (res.error) { err.textContent = res.error; return; }
      modal.remove(); await refreshUser();
    });
    document.getElementById("prof-close").addEventListener("click", () => modal.remove());
    const so = document.getElementById("prof-signout");
    if (so) so.addEventListener("click", async () => { await signOut(); modal.remove(); await refreshUser(); });
  }

  // =========================================================================
  // DAILY GAME: Smallest Interval (adaptive JND, 2 lives, one attempt/day)
  // =========================================================================
  let jnd = null;
  const JND_START = 100;   // starting gap in cents (1 semitone — easy)
  const JND_LIVES = 2;

  function fracLabel(cents) {
    const n = Math.round(100 / cents);
    return `1/${n} tone`;
  }
  async function startDaily(id) {
    try { await Tone.start(); } catch (_) {}
    if (id === "feed") return renderFeed();
    if (id === "dms") return renderDMs();
    const rec = loadDaily(id);
    if (rec.date === todayStr()) return renderDailyDone(id, rec, false);
    if (id === "jnd") {
      jnd = { lives: JND_LIVES, delta: JND_START, best: null, done: false };
      return jndNext();
    }
    if (DAILY_RUNNERS[id]) { try { await ctx.ensurePiano(); } catch (_) {} DAILY_RUNNERS[id](gameCtx(id)); }
  }
  // Shared game ctx for the daily runners (dailygames.js).
  function pianoPlay(name, at = 0, dur = 0.6, vel = 0.8) {
    const p = ctx.getPiano && ctx.getPiano();
    if (p) { try { p.triggerAttackRelease(name, dur, Tone.now() + at, vel); } catch (_) {} }
  }
  function gameCtx(id) {
    return {
      el: daily,
      tone: (f, at, dur) => tone(f, at, dur),
      piano: (name, at, dur, vel) => pianoPlay(name, at, dur, vel),
      finish: (score, label) => finishDaily(id, score, label),
      quit: () => ctx.goHome(),
    };
  }
  function finishDaily(id, score, label) {
    const rec = { date: todayStr(), score: Math.round(score * 100) / 100, label };
    saveDaily(id, rec);
    submitScore(id, rec.date, rec.score, rec.label).catch(() => {});
    renderDailyDone(id, rec, true);
  }
  function jndPlay() {
    const bf = midiFreq(52 + Math.floor(Math.random() * 17)); // random ref each round
    tone(bf, 0); tone(bf, 0.55); tone(bf, 1.1);
    tone(centsFreq(bf, jnd.dir * jnd.delta), 1.85, 0.6);
  }
  function jndNext() {
    jnd.dir = Math.random() < 0.5 ? 1 : -1;
    renderDailyPlay();
    jndPlay();
  }
  function renderDailyPlay() {
    const hearts = "❤️".repeat(jnd.lives) + "🖤".repeat(JND_LIVES - jnd.lives);
    daily.innerHTML = `
      <div class="dg">
        <button class="dg-x" data-home>✕</button>
        <div class="dg-name">Smallest Interval</div>
        <div class="dg-lives">${hearts}</div>
        <div class="dg-gap">${fracLabel(jnd.delta)}<span>${jnd.delta.toFixed(1)}¢ apart</span></div>
        <div class="dg-q">Same note ×3, then the test. Higher or lower?</div>
        <div class="dg-ans">
          <button class="dg-btn" data-dir="up">Higher ⬆</button>
          <button class="dg-btn" data-dir="dn">Lower ⬇</button>
        </div>
        <button class="dg-replay" data-replay>replay ↺</button>
        ${jnd.best ? `<div class="dg-best">best so far · ${fracLabel(jnd.best)}</div>` : ""}
      </div>`;
    daily.querySelector("[data-home]").addEventListener("click", () => ctx.goHome());
    daily.querySelector("[data-replay]").addEventListener("click", jndPlay);
    daily.querySelectorAll("[data-dir]").forEach((b) => b.addEventListener("click", () => jndAnswer(b.dataset.dir === "up")));
  }
  function jndAnswer(higher) {
    if (!jnd || jnd.done) return;
    const correct = higher === (jnd.dir > 0);
    if (correct) {
      jnd.best = jnd.best == null ? jnd.delta : Math.min(jnd.best, jnd.delta);
      jnd.delta = jnd.delta / 2;         // smaller gap — harder
    } else {
      jnd.lives -= 1;
      jnd.delta = Math.min(JND_START, jnd.delta * 2); // bigger gap — easier
    }
    if (jnd.lives <= 0) return jndEnd();
    jndNext();
  }
  function jndEnd() {
    jnd.done = true;
    const scoreCents = jnd.best == null ? JND_START * 2 : jnd.best; // never got one → worst
    finishDaily("jnd", scoreCents, fracLabel(scoreCents));
  }
  function renderDailyDone(id, rec, justFinished) {
    const meta = gameMeta(id);
    daily.innerHTML = `
      <div class="dg dg-result">
        <button class="dg-x" data-home>✕</button>
        <div class="dg-emoji">${justFinished ? "🎉" : "✅"}</div>
        <div class="dg-name">${meta.title}</div>
        <div class="dg-score">${rec.label}</div>
        <div class="dg-score-sub">${justFinished ? "your score today" : "you've already played today"}</div>
        <div class="dg-q">${justFinished ? "Nice. Come back tomorrow for a new one." : "Come back tomorrow for a new puzzle."}</div>
        ${socialConfigured() ? `<button class="dg-cta" data-lb>See leaderboard</button>` : ""}
        <button class="${socialConfigured() ? "ghost" : "dg-cta"}" data-home>Back to games</button>
        ${socialConfigured() ? "" : `<div class="dg-best">Sign-in + friends leaderboard coming soon.</div>`}
      </div>`;
    daily.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => ctx.goHome()));
    const lb = daily.querySelector("[data-lb]");
    if (lb) lb.addEventListener("click", () => showLeaderboard(id, rec.date));
  }
  async function showLeaderboard(gameId, date) {
    daily.innerHTML = `
      <div class="dg dg-result">
        <button class="dg-x" data-home>✕</button>
        <div class="dg-name">Leaderboard · ${gameMeta(gameId).title}</div>
        <div class="dg-score-sub">${date} — top of the list wins</div>
        <div class="lb" id="lb">loading…</div>
        <button class="dg-cta" data-home>Back to games</button>
      </div>`;
    daily.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => ctx.goHome()));
    const me2 = await loadMe();
    if (!me2 || !me2.session) { document.getElementById("lb").innerHTML = `<div class="lb-empty">Sign in on the Home screen to appear here.</div>`; return; }
    const rows = await leaderboard(gameId, date);
    const el = document.getElementById("lb");
    if (!rows.length) { el.innerHTML = `<div class="lb-empty">No scores yet today — be the first!</div>`; return; }
    el.innerHTML = rows.map((r, i) => {
      const p = r.profiles || {};
      const mine = me2.session && r.user_id === me2.session.user.id;
      return `<div class="lb-row ${mine ? "me" : ""}">
        <span class="lb-rank">${i + 1}</span>
        ${p.avatar_url ? `<img class="lb-pic" src="${p.avatar_url}">` : `<span class="lb-pic ph"></span>`}
        <span class="lb-name">${p.username || "player"}</span>
        <span class="lb-score">${r.label || r.score}</span>
      </div>`;
    }).join("");
  }

  // =========================================================================
  // SOCIAL: feed + comments + DMs
  // =========================================================================
  let rtChannel = null;
  function stopRT() { if (rtChannel) { try { rtChannel.unsubscribe(); } catch (_) {} rtChannel = null; } }
  function backHome() { stopRT(); ctx.goHome(); }
  function ago(t) {
    const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }
  function esc(s) { return (s || "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }

  async function renderFeed() {
    const m = await loadMe();
    if (!m || !m.session) { requireSignIn("the feed"); return; }
    daily.innerHTML = `
      <div class="soc">
        <div class="soc-top"><button class="dg-x" data-home>‹</button><div class="soc-title">Feed</div><div style="width:32px"></div></div>
        <div class="soc-compose"><input id="feed-post" placeholder="Say something…" maxlength="240"><button id="feed-send">Post</button></div>
        <div class="soc-list" id="feed-list">loading…</div>
      </div>`;
    daily.querySelector("[data-home]").addEventListener("click", backHome);
    daily.querySelector("#feed-send").addEventListener("click", async () => {
      const inp = daily.querySelector("#feed-post"); const v = inp.value.trim();
      if (!v) return; inp.value = ""; await createPost(v); loadFeedList();
    });
    stopRT(); rtChannel = await subscribeChanges(() => loadFeedList());
    loadFeedList();
  }
  async function loadFeedList() {
    const el = daily.querySelector("#feed-list"); if (!el) return;
    const items = await fetchFeed(40);
    if (!items.length) { el.innerHTML = `<div class="lb-empty">No activity yet. Post something or play a game!</div>`; return; }
    el.innerHTML = items.map((it) => {
      const u = it.user || {};
      const line = it.kind === "score"
        ? `scored <b>${esc(it.label)}</b> on ${esc(gameMeta(it.game_id).title)}`
        : `${esc(it.body)}`;
      return `<div class="feed-item" data-tt="${it.kind}" data-ti="${it.id}">
        <div class="feed-head">
          ${u.avatar_url ? `<img class="lb-pic" src="${u.avatar_url}">` : `<span class="lb-pic ph"></span>`}
          <span class="feed-name">${esc(u.username || "player")}</span>
          <span class="feed-ago">${ago(it.t)}</span>
        </div>
        <div class="feed-body">${line}</div>
        <button class="feed-cmt" data-cmt>💬 comments</button>
        <div class="feed-comments" hidden></div>
      </div>`;
    }).join("");
    el.querySelectorAll(".feed-item").forEach((item) => {
      item.querySelector("[data-cmt]").addEventListener("click", () => toggleComments(item, item.dataset.tt, item.dataset.ti));
    });
  }
  async function toggleComments(item, tt, ti) {
    const box = item.querySelector(".feed-comments");
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = "loading…";
    const cs = await fetchComments(tt, ti);
    box.innerHTML = cs.map((c) => `<div class="cmt"><b>${esc((c.profiles || {}).username || "player")}</b> ${esc(c.body)}</div>`).join("")
      + `<div class="cmt-add"><input placeholder="comment…" maxlength="200"><button>send</button></div>`;
    const inp = box.querySelector("input"), btn = box.querySelector("button");
    btn.addEventListener("click", async () => { const v = inp.value.trim(); if (!v) return; inp.value = ""; await addComment(tt, ti, v); toggleComments(item, tt, ti); toggleComments(item, tt, ti); });
  }

  async function renderDMs() {
    const m = await loadMe();
    if (!m || !m.session) { requireSignIn("messages"); return; }
    daily.innerHTML = `
      <div class="soc">
        <div class="soc-top"><button class="dg-x" data-home>‹</button><div class="soc-title">Messages</div><button class="soc-new" id="dm-new">＋</button></div>
        <div class="soc-list" id="dm-list">loading…</div>
      </div>`;
    daily.querySelector("[data-home]").addEventListener("click", backHome);
    daily.querySelector("#dm-new").addEventListener("click", newDM);
    const threads = await listThreads();
    const el = daily.querySelector("#dm-list");
    el.innerHTML = threads.length ? threads.map((t) => `
      <button class="dm-thread" data-other="${t.otherId}">
        ${(t.profile || {}).avatar_url ? `<img class="lb-pic" src="${t.profile.avatar_url}">` : `<span class="lb-pic ph"></span>`}
        <span class="feed-name">${esc((t.profile || {}).username || "player")}</span>
        <span class="dm-last">${esc(t.body)}</span>
      </button>`).join("") : `<div class="lb-empty">No messages yet. Tap ＋ to start one.</div>`;
    el.querySelectorAll(".dm-thread").forEach((b) => b.addEventListener("click", () => renderThread(b.dataset.other)));
  }
  async function newDM() {
    const me2 = await myId();
    const people = (await listProfiles()).filter((p) => p.id !== me2);
    const el = daily.querySelector("#dm-list");
    el.innerHTML = people.length ? people.map((p) => `
      <button class="dm-thread" data-other="${p.id}">
        ${p.avatar_url ? `<img class="lb-pic" src="${p.avatar_url}">` : `<span class="lb-pic ph"></span>`}
        <span class="feed-name">${esc(p.username)}</span>
      </button>`).join("") : `<div class="lb-empty">No other players yet.</div>`;
    el.querySelectorAll(".dm-thread").forEach((b) => b.addEventListener("click", () => renderThread(b.dataset.other)));
  }
  async function renderThread(otherId) {
    daily.innerHTML = `
      <div class="soc">
        <div class="soc-top"><button class="dg-x" data-back>‹</button><div class="soc-title">Chat</div><div style="width:32px"></div></div>
        <div class="dm-msgs" id="dm-msgs">loading…</div>
        <div class="soc-compose"><input id="dm-input" placeholder="Message…" maxlength="500"><button id="dm-send">Send</button></div>
      </div>`;
    daily.querySelector("[data-back]").addEventListener("click", renderDMs);
    async function refresh() {
      const meId = await myId();
      const msgs = await fetchThread(otherId);
      const el = daily.querySelector("#dm-msgs"); if (!el) return;
      el.innerHTML = msgs.map((m) => `<div class="bubble ${m.sender === meId ? "mine" : ""}">${esc(m.body)}</div>`).join("");
      el.scrollTop = el.scrollHeight;
    }
    daily.querySelector("#dm-send").addEventListener("click", async () => {
      const inp = daily.querySelector("#dm-input"); const v = inp.value.trim(); if (!v) return; inp.value = "";
      await sendMessage(otherId, v); refresh();
    });
    stopRT(); rtChannel = await subscribeChanges(() => refresh());
    refresh();
  }
  function requireSignIn(what) {
    daily.innerHTML = `
      <div class="dg dg-result">
        <button class="dg-x" data-home>✕</button>
        <div class="dg-emoji">🔒</div>
        <div class="dg-q">Sign in on the Home screen to use ${what}.</div>
        <button class="dg-cta" data-home>Back</button>
      </div>`;
    daily.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => ctx.goHome()));
  }

  return { renderHome, startDaily };
}
