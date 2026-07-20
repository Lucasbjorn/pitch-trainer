// Pitches — the friends-facing daily music mini-game app (iPhone-first, NYT-mini
// vibe). Bottom tab bar, Google sign-in onboarding, streaks, leaderboard, feed,
// DMs, and profile. "Lucas's Lab" (password-gated) reveals the dev trainers.

import {
  socialConfigured, getSession, signInGoogle, signOut, getProfile, saveProfile, submitScore, leaderboard,
  fetchComments, addComment, subscribeChanges,
} from "./social.js";
import { DAILY_RUNNERS } from "./dailygames.js";

const DAYMS = 86400000;
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yesterdayStr() { return todayStr(new Date(Date.now() - DAYMS)); }

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
  // GAME CATALOG
  // =========================================================================
  const DAILIES = [
    { id: "leap", title: "Compound Leap", sub: "Notes octaves apart", icon: "🪃", color: "#7bd88f", show: true },
    { id: "guesswho", title: "Guess Who", sub: "Name that jazz tune", icon: "🎧", color: "#f2994a", show: true },
    { id: "jnd", title: "JND", sub: "Smallest gap you can hear", icon: "📏", color: "#22c55e", show: true },
    { id: "quarter", title: "Quarter-tones", sub: "Practice microtonal intervals", icon: "🎛️", color: "#10b981", show: true, micro: "micro" },
    // Hidden for now — code kept, flip `show: true` to bring back.
    { id: "interval", title: "Interval Ear", sub: "Name the interval between two notes", icon: "🎼", color: "#f2c94c", show: false },
    { id: "prog", title: "Chord Progression", sub: "Name the diatonic changes", icon: "🎹", color: "#f79f5b", show: false },
    { id: "mistuned", title: "Spot the Sour Note", sub: "Which note is out of tune?", icon: "🍋", color: "#eb5757", show: false },
  ];
  function gameMeta(id) { return DAILIES.find((x) => x.id === id) || { title: id }; }
  function playableGames() { return DAILIES.filter((g) => g.show); }
  function scoredGames() { return DAILIES.filter((g) => g.show && !g.micro); }

  // =========================================================================
  // STREAKS  (a "day" counts once you finish any game that day)
  // =========================================================================
  function loadStreak() { try { return JSON.parse(localStorage.getItem("pt.streak")) || { count: 0, last: null }; } catch (_) { return { count: 0, last: null }; } }
  function currentStreak() {
    const s = loadStreak();
    if (s.last === todayStr() || s.last === yesterdayStr()) return s.count;
    return 0;
  }
  function bumpStreak() {
    const s = loadStreak();
    const t = todayStr();
    if (s.last === t) return s.count;               // already counted today
    s.count = (s.last === yesterdayStr() ? s.count : 0) + 1;
    s.last = t;
    try { localStorage.setItem("pt.streak", JSON.stringify(s)); } catch (_) {}
    return s.count;
  }

  // Guest profile (for players who skip Google sign-in) — stored locally.
  function loadGuest() { try { return JSON.parse(localStorage.getItem("pt.guest")) || null; } catch (_) { return null; } }
  function saveGuest(o) { try { localStorage.setItem("pt.guest", JSON.stringify(o)); } catch (_) {} }
  function myName() { if (me && me.profile && me.profile.username) return me.profile.username; const g = loadGuest(); return g ? g.username : null; }
  function myAvatar() { if (me && me.profile && me.profile.avatar_url) return me.profile.avatar_url; const g = loadGuest(); return g ? g.avatar : null; }
  // Downscale a picked image to a small square data URL so it fits localStorage.
  function fileToAvatar(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const S = 220, c = document.createElement("canvas"); c.width = c.height = S;
          const ctx2 = c.getContext("2d");
          const scale = Math.max(S / img.width, S / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx2.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          resolve(c.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => resolve(null);
        img.src = reader.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // Temp gate so friends don't wander into the dev trainers.
  const LAB_PW = "temp";
  function tryLab() {
    if (localStorage.getItem("pt.lab.ok") === "1") return ctx.goLucas();
    const p = window.prompt("Lab password:");
    if (p == null) return;
    if (p === LAB_PW) { localStorage.setItem("pt.lab.ok", "1"); ctx.goLucas(); }
    else window.alert("Nope.");
  }

  // =========================================================================
  // BOTTOM TAB BAR
  // =========================================================================
  const TABS = [
    { k: "home", ic: "🏠", label: "Play" },
    { k: "board", ic: "🏆", label: "Board" },
    { k: "me", ic: "👤", label: "Me" },
  ];
  let tabbar = null;
  function ensureTabbar() {
    if (tabbar) return tabbar;
    tabbar = document.createElement("div");
    tabbar.id = "tabbar";
    document.body.appendChild(tabbar);
    return tabbar;
  }
  function onTab(k) {
    if (k === "home") return ctx.goHome();
    if (k === "board") return ctx.goDaily("board");
    if (k === "me") return ctx.goDaily("profile");
  }
  // active = tab key to highlight, "" = show with none active, null = hide the bar.
  function setTabs(active) {
    if (active === null) { document.body.classList.remove("show-tabs"); return; }
    const bar = ensureTabbar();
    bar.innerHTML = TABS.map((t) => {
      const pic = t.k === "me" && myAvatar();
      const inner = pic ? `<img class="tab-pic" src="${pic}">` : `<span class="tab-ic">${t.ic}</span>`;
      return `<button class="tab-btn ${t.k === active ? "active" : ""}" data-tab="${t.k}"><span class="tab-badge">${inner}</span><span>${t.label}</span></button>`;
    }).join("");
    bar.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => onTab(b.dataset.tab)));
    document.body.classList.add("show-tabs");
  }

  // =========================================================================
  // HOME
  // =========================================================================
  async function renderHome() {
    const d = new Date();
    const dateStr = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const cards = playableGames().map((game) => {
      const isDaily = !game.micro;
      const rec = isDaily ? loadDaily(game.id) : {};
      const played = isDaily && rec.date === todayStr();
      let tag;
      if (!isDaily) tag = `<span class="hub-tag play">Play</span>`;
      else if (played) tag = `<span class="hub-tag done">✓ ${rec.label || "done"}</span>`;
      else tag = `<span class="hub-tag play">Play</span>`;
      const attr = game.micro ? `data-micro="${game.micro}"` : `data-daily="${game.id}"`;
      return `
        <button class="hub-card" ${attr}>
          <div class="hub-icon" style="background:${game.color}">${game.icon}</div>
          <div class="hub-card-body">
            <div class="hub-card-title">${game.title}</div>
            <div class="hub-card-sub">${game.sub}</div>
          </div>
          ${tag}
        </button>`;
    }).join("");

    await loadMe();
    const streakN = currentStreak();
    const streakHtml = streakN > 0
      ? `<div style="text-align:center;margin-top:0.7rem"><span class="hub-streak">🔥 ${streakN} day streak</span></div>` : "";
    const signedOut = socialConfigured() && (!me || !me.session);
    const signinStrip = signedOut ? `
      <div class="signin-strip">
        <div class="ss-txt"><b>Sign in to compete</b><span>Save scores &amp; climb the leaderboard.</span></div>
        <button id="home-signin">Sign in</button>
      </div>` : "";

    home.innerHTML = `
      <div class="hub">
        <div class="hub-head">
          <div class="hub-date">${dateStr}</div>
          <h1 class="hub-title">Pitches</h1>
          ${streakHtml}
        </div>
        ${signinStrip}
        <div class="hub-section-label">Today's puzzles</div>
        <div class="hub-cards">${cards}</div>
        <div class="hub-section-label" style="margin-top:1.6rem">Need help focusing?</div>
        <div class="hub-cards">
          <button class="hub-card" data-practice>
            <div class="hub-icon" style="background:#a78bfa">🧘</div>
            <div class="hub-card-body">
              <div class="hub-card-title">Practice</div>
              <div class="hub-card-sub">A calm, timed routine to lock in</div>
            </div>
            <span class="hub-tag play">Open</span>
          </button>
        </div>
        <button class="hub-lab" data-lab>🔒 Lucas's Lab</button>
        <div class="hub-foot">One attempt per game, per day. Build your streak. 🎧</div>
      </div>`;

    home.querySelectorAll("[data-daily]").forEach((b) => b.addEventListener("click", () => ctx.goDaily(b.dataset.daily)));
    home.querySelectorAll("[data-micro]").forEach((b) => b.addEventListener("click", () => ctx.goMicrotone(b.dataset.micro)));
    home.querySelector("[data-lab]").addEventListener("click", tryLab);
    const pb = home.querySelector("[data-practice]");
    if (pb && ctx.goPractice) pb.addEventListener("click", () => ctx.goPractice());
    const si = home.querySelector("#home-signin");
    if (si) si.addEventListener("click", () => signInGoogle());

    setTabs("home");
    // Force profile completion once signed in.
    if (me && me.session && (!me.profile || !me.profile.avatar_url)) openProfile();
    maybeOnboard();
  }

  // =========================================================================
  // ONBOARDING — welcome + Google sign-in
  // =========================================================================
  function maybeOnboard() {
    if (localStorage.getItem("pt.welcome") === "1") return;
    if (me && me.session) { localStorage.setItem("pt.welcome", "1"); return; }
    const canGoogle = socialConfigured();
    document.body.insertAdjacentHTML("beforeend", `
      <div class="onboard" id="onboard">
        <div class="onboard-card">
          <div class="onboard-logo">🎧</div>
          <h1 class="onboard-title">welcome bitches to<br><span class="brand">Pitches</span></h1>
          <div class="onboard-tag">the daily music mini game app. mike lowkey girthy.</div>
          <div class="onboard-rules">
            <div class="onboard-rule"><span class="r-ic">🎯</span><div>You get <b>one attempt</b> per game, per day. Make it count.</div></div>
            <div class="onboard-rule"><span class="r-ic">🔥</span><div>Play every day to build a <b>streak</b>.</div></div>
            <div class="onboard-rule"><span class="r-ic">🏆</span><div>Your scores land on the <b>leaderboard</b> against your friends.</div></div>
          </div>
          ${canGoogle
            ? `<button class="google-btn" id="ob-google"><span class="g-badge">G</span> Sign in with Google</button>
               <button class="onboard-skip" id="ob-skip">just let me play →</button>`
            : `<button class="google-btn" id="ob-skip">Let's play</button>`}
        </div>
      </div>`);
    const g = document.getElementById("ob-google");
    if (g) g.addEventListener("click", () => signInGoogle());
    document.getElementById("ob-skip").addEventListener("click", () => {
      // Even guests need a name + photo before playing.
      if (loadGuest()) { localStorage.setItem("pt.welcome", "1"); const o = document.getElementById("onboard"); if (o) o.remove(); return; }
      openGuestSetup(() => {
        localStorage.setItem("pt.welcome", "1");
        const o = document.getElementById("onboard"); if (o) o.remove();
        renderHome();
      });
    });
  }

  // Required guest profile: username + photo, saved locally. No skipping past it.
  function openGuestSetup(onDone) {
    const cur = loadGuest() || {};
    document.body.insertAdjacentHTML("beforeend", `
      <div class="modal" id="guest-modal" style="z-index:95">
        <div class="modal-card">
          <div class="modal-title">Pick a name &amp; photo</div>
          <p class="welcome-p" style="margin:-0.4rem 0 1rem">Playing as a guest — you still need these so friends know who you are.</p>
          <label class="modal-avatar" id="guest-pic">
            ${cur.avatar ? `<img src="${cur.avatar}">` : `<span>＋ photo</span>`}
            <input type="file" id="guest-file" accept="image/*" hidden>
          </label>
          <input class="modal-input" id="guest-name" placeholder="username" value="${cur.username || ""}" maxlength="20">
          <div class="modal-err" id="guest-err"></div>
          <button class="dg-cta" id="guest-save">Start playing</button>
          <div class="modal-actions"><button class="ghost" id="guest-google">actually, sign in with Google</button></div>
        </div>
      </div>`);
    let avatar = cur.avatar || null;
    const modal = document.getElementById("guest-modal");
    document.getElementById("guest-file").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      document.getElementById("guest-pic").innerHTML = `<span>…</span>`;
      avatar = await fileToAvatar(f);
      if (avatar) document.getElementById("guest-pic").innerHTML = `<img src="${avatar}">`;
    });
    document.getElementById("guest-save").addEventListener("click", () => {
      const name = document.getElementById("guest-name").value.trim();
      const err = document.getElementById("guest-err");
      if (!name) { err.textContent = "Pick a username."; return; }
      if (!avatar) { err.textContent = "Add a profile photo."; return; }
      saveGuest({ username: name, avatar });
      modal.remove();
      if (onDone) onDone();
    });
    document.getElementById("guest-google").addEventListener("click", () => signInGoogle());
  }

  // =========================================================================
  // ADD TO HOME SCREEN — shown after the first finished game
  // =========================================================================
  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  function maybeA2HS() {
    if (isStandalone()) return;
    if (localStorage.getItem("pt.a2hs") === "1") return;
    localStorage.setItem("pt.a2hs", "1");
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const shareIcon = `<svg class="a2hs-ic" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>`;
    const plusIcon = `<svg class="a2hs-ic" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;
    const phone = `<svg class="a2hs-phone" viewBox="0 0 120 120"><rect x="30" y="8" width="60" height="104" rx="12" fill="#eef4ef" stroke="#16a34a" stroke-width="2"/><rect x="40" y="22" width="40" height="40" rx="9" fill="#16a34a"/><text x="60" y="49" font-size="22" text-anchor="middle" fill="#fff">🎧</text><rect x="40" y="70" width="40" height="7" rx="3" fill="#c7d3ca"/><rect x="40" y="82" width="26" height="6" rx="3" fill="#dce7df"/><circle cx="60" cy="104" r="4" fill="#c7d3ca"/></svg>`;
    const steps = ios
      ? `<div class="a2hs-step"><span class="a2hs-num">1</span><div class="a2hs-txt">Tap the <b>Share</b> button at the bottom of Safari</div>${shareIcon}</div>
         <div class="a2hs-step"><span class="a2hs-num">2</span><div class="a2hs-txt">Scroll down and tap <b>Add to Home Screen</b></div>${plusIcon}</div>
         <div class="a2hs-step"><span class="a2hs-num">3</span><div class="a2hs-txt">Tap <b>Add</b> — Pitches now opens like a real app 🎉</div></div>`
      : `<div class="a2hs-step"><span class="a2hs-num">1</span><div class="a2hs-txt">Open the browser <b>⋮ menu</b> (top right)</div></div>
         <div class="a2hs-step"><span class="a2hs-num">2</span><div class="a2hs-txt">Tap <b>Install app</b> / <b>Add to Home screen</b></div>${plusIcon}</div>
         <div class="a2hs-step"><span class="a2hs-num">3</span><div class="a2hs-txt">Confirm — Pitches now opens like a real app 🎉</div></div>`;
    document.body.insertAdjacentHTML("beforeend", `
      <div class="sheet-scrim" id="a2hs">
        <div class="sheet">
          <div class="sheet-grip"></div>
          ${phone}
          <div class="sheet-title">Add Pitches to your phone</div>
          <div class="sheet-sub">Nice — first game down! Install it so it's one tap away every day.</div>
          <div class="a2hs-steps">${steps}</div>
          <button class="sheet-close" id="a2hs-close">Got it</button>
        </div>
      </div>`);
    document.getElementById("a2hs-close").addEventListener("click", () => {
      const s = document.getElementById("a2hs"); if (s) s.remove();
    });
    document.getElementById("a2hs").addEventListener("click", (e) => {
      if (e.target.id === "a2hs") e.currentTarget.remove();
    });
  }

  // =========================================================================
  // ACCOUNT
  // =========================================================================
  let me = null; // { session, profile }
  async function loadMe() {
    if (!socialConfigured()) { me = { session: null, profile: null }; return me; }
    const session = await getSession();
    if (!session) { me = { session: null, profile: null }; return me; }
    const profile = await getProfile(session.user.id);
    me = { session, profile };
    return me;
  }
  function myRecentScores() {
    const rows = scoredGames().map((d) => ({ d, rec: loadDaily(d.id) })).filter((x) => x.rec.date === todayStr());
    if (!rows.length) return `<div class="hist-empty" style="text-align:center;padding:0.6rem">No games played today yet.</div>`;
    return rows.map((x) => `<div class="hist-row"><span>${x.d.icon} ${x.d.title}</span><span>${x.rec.label}</span></div>`).join("");
  }
  function openProfile() {
    const cur = (me && me.profile) || {};
    document.body.insertAdjacentHTML("beforeend", `
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
      if (!me || !me.session) { err.textContent = "Sign in first."; return; }
      err.textContent = "Saving…";
      const res = await saveProfile(me.session.user.id, name, file);
      if (res.error) { err.textContent = res.error; return; }
      modal.remove(); await loadMe(); setTabs("me"); if (document.body.classList.contains("view-daily")) renderProfile();
    });
    document.getElementById("prof-close").addEventListener("click", () => modal.remove());
  }

  // Profile page (the "Me" tab)
  async function renderProfile() {
    stopRT();
    await loadMe();
    setTabs("me");
    if (!socialConfigured() || !me || !me.session) {
      const guest = loadGuest();
      const streakN = currentStreak();
      const av = guest && guest.avatar;
      daily.innerHTML = `
        <div class="prof">
          <div class="prof-head">
            ${av ? `<img class="prof-avatar" src="${av}">` : `<div class="prof-avatar ph">👤</div>`}
            <div class="prof-name">${guest ? esc(guest.username) : "Not signed in"}</div>
            <div class="prof-sub">${guest ? "playing as guest · scores stay on this device" : "Add a name &amp; photo to start."}</div>
          </div>
          ${guest ? `<div class="prof-stats">
            <div class="prof-stat"><div class="ps-big streak">${streakN}</div><div class="ps-lbl">Streak</div></div>
            <div class="prof-stat"><div class="ps-big">${scoredGames().filter((x) => loadDaily(x.id).date === todayStr()).length}/${scoredGames().length}</div><div class="ps-lbl">Today</div></div>
            <div class="prof-stat"><div class="ps-big">${loadStreak().count || 0}</div><div class="ps-lbl">Best run</div></div>
          </div>` : ""}
          <div class="signin-strip"><div class="ss-txt"><b>Join the leaderboard</b><span>Sign in to compete with friends.</span></div><button id="p-signin2">Sign in</button></div>
          ${guest ? `<button class="prof-edit-btn" id="p-guest-edit">✏️ Edit guest profile</button>` : `<button class="google-btn" id="p-guest-new">Add name &amp; photo</button>`}
        </div>`;
      const s2 = daily.querySelector("#p-signin2"); if (s2) s2.addEventListener("click", () => signInGoogle());
      const ge = daily.querySelector("#p-guest-edit"); if (ge) ge.addEventListener("click", () => openGuestSetup(() => renderProfile()));
      const gn = daily.querySelector("#p-guest-new"); if (gn) gn.addEventListener("click", () => openGuestSetup(() => renderProfile()));
      return;
    }
    const p = me.profile || {};
    const streakN = currentStreak();
    const playedToday = scoredGames().filter((g) => loadDaily(g.id).date === todayStr()).length;
    daily.innerHTML = `
      <div class="prof">
        <div class="prof-head">
          ${p.avatar_url ? `<img class="prof-avatar" src="${p.avatar_url}">` : `<div class="prof-avatar ph">👤</div>`}
          <div class="prof-name">${esc(p.username || "player")}</div>
          <div class="prof-sub">${esc((me.session.user && me.session.user.email) || "")}</div>
        </div>
        <div class="prof-stats">
          <div class="prof-stat"><div class="ps-big streak">${streakN}</div><div class="ps-lbl">Streak</div></div>
          <div class="prof-stat"><div class="ps-big">${playedToday}/${scoredGames().length}</div><div class="ps-lbl">Today</div></div>
          <div class="prof-stat"><div class="ps-big">${loadStreak().count || 0}</div><div class="ps-lbl">Best run</div></div>
        </div>
        <div class="panel">
          <div class="panel-title">Today's scores</div>
          ${myRecentScores()}
        </div>
        <button class="prof-edit-btn" id="p-edit" style="margin-bottom:0.7rem">✏️ Edit profile</button>
        <button class="prof-edit-btn" id="p-signout">Sign out</button>
      </div>`;
    daily.querySelector("#p-edit").addEventListener("click", openProfile);
    daily.querySelector("#p-signout").addEventListener("click", async () => { await signOut(); await loadMe(); renderProfile(); });
  }

  // =========================================================================
  // DAILY GAME dispatch
  // =========================================================================
  let jnd = null;
  const JND_START = 100;
  const JND_LIVES = 2;
  function fracLabel(cents) { const n = Math.round(100 / cents); return `1/${n} tone`; }

  async function startDaily(id) {
    try { await Tone.start(); } catch (_) {}
    if (id === "feed" || id === "dms" || id === "board") return renderBoard();
    if (id === "profile") return renderProfile();
    const rec = loadDaily(id);
    if (rec.date === todayStr()) return renderDailyDone(id, rec, false);
    setTabs(null); // hide tabs during a live attempt so you can't fat-finger away
    if (id === "jnd") { jnd = { lives: JND_LIVES, delta: JND_START, best: null, done: false }; return jndNext(); }
    if (DAILY_RUNNERS[id]) { try { await ctx.ensurePiano(); } catch (_) {} DAILY_RUNNERS[id](gameCtx(id)); }
  }
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
    bumpStreak();
    submitScore(id, rec.date, rec.score, rec.label).catch(() => {});
    renderDailyDone(id, rec, true);
    maybeA2HS();
  }
  function jndPlay() {
    const bf = midiFreq(52 + Math.floor(Math.random() * 17));
    tone(bf, 0); tone(bf, 0.55); tone(bf, 1.1);
    tone(centsFreq(bf, jnd.dir * jnd.delta), 1.85, 0.6);
  }
  function jndNext() { jnd.dir = Math.random() < 0.5 ? 1 : -1; renderDailyPlay(); jndPlay(); }
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
    if (correct) { jnd.best = jnd.best == null ? jnd.delta : Math.min(jnd.best, jnd.delta); jnd.delta = jnd.delta / 2; }
    else { jnd.lives -= 1; jnd.delta = Math.min(JND_START, jnd.delta * 2); }
    if (jnd.lives <= 0) return jndEnd();
    jndNext();
  }
  function jndEnd() {
    jnd.done = true;
    if (jnd.best == null) return finishDaily("jnd", JND_START * 2, "> 1 tone");
    finishDaily("jnd", jnd.best, fracLabel(jnd.best));
  }
  function renderDailyDone(id, rec, justFinished) {
    setTabs("");
    const meta = gameMeta(id);
    const streakN = currentStreak();
    daily.innerHTML = `
      <div class="dg dg-result">
        <button class="dg-x" data-home>✕</button>
        <div class="dg-emoji">${justFinished ? "🎉" : "✅"}</div>
        <div class="dg-name">${meta.title}</div>
        <div class="dg-score">${rec.label}</div>
        <div class="dg-score-sub">${justFinished ? "your score today" : "you've already played today"}</div>
        ${justFinished && streakN > 1 ? `<div style="margin-top:0.8rem"><span class="hub-streak">🔥 ${streakN} day streak</span></div>` : ""}
        <div class="dg-q">${justFinished ? "Nice. Come back tomorrow for a new one." : "Come back tomorrow for a new puzzle."}</div>
        ${socialConfigured() ? `<button class="dg-cta" data-lb>See leaderboard</button>` : ""}
        <button class="${socialConfigured() ? "ghost" : "dg-cta"}" data-home>Back to games</button>
      </div>`;
    daily.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", () => ctx.goHome()));
    const lb = daily.querySelector("[data-lb]");
    if (lb) lb.addEventListener("click", () => { boardGame = id; renderBoard(); });
  }
  function lbRow(r, i) {
    const p = r.profiles || {};
    const mine = me && me.session && r.user_id === me.session.user.id;
    return `<div class="lb-row ${mine ? "me" : ""}">
      <span class="lb-rank">${i + 1}</span>
      ${p.avatar_url ? `<img class="lb-pic" src="${p.avatar_url}">` : `<span class="lb-pic ph"></span>`}
      <span class="lb-name">${esc(p.username || "player")}</span>
      <span class="lb-score">${esc(r.label || String(r.score))}</span>
    </div>`;
  }

  // =========================================================================
  // SOCIAL: feed + comments + DMs + leaderboard (all under one Social tab)
  // =========================================================================
  let rtChannel = null;
  function stopRT() { if (rtChannel) { try { rtChannel.unsubscribe(); } catch (_) {} rtChannel = null; } }
  function ago(t) {
    const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }
  function esc(s) { return (s || "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }
  // =========================================================================
  // BOARD — Overall + per-game leaderboards + a daily comment thread.
  // (Feed + DMs removed for simplicity; social.js keeps the API if we return.)
  // =========================================================================
  let boardGame = "overall";
  async function renderBoard() {
    setTabs("board");
    stopRT();
    const games = scoredGames();
    if (boardGame !== "overall" && !games.find((g) => g.id === boardGame)) boardGame = "overall";
    const tabs = [`<button class="board-tab ${boardGame === "overall" ? "active" : ""}" data-g="overall">⭐ Overall</button>`]
      .concat(games.map((g) => `<button class="board-tab ${g.id === boardGame ? "active" : ""}" data-g="${g.id}">${g.icon} ${g.title}</button>`)).join("");
    const dateNice = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    daily.innerHTML = `
      <div class="soc">
        <div class="soc-title-row"><div class="soc-title">🏆 Leaderboard</div></div>
        <div class="board-tabs">${tabs}</div>
        <div class="board-sub">${dateNice}</div>
        <div class="lb" id="board-lb">loading…</div>
        <div class="board-cmts" id="board-cmts"></div>
      </div>`;
    daily.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => { boardGame = b.dataset.g; renderBoard(); }));
    await loadMe();
    const el = daily.querySelector("#board-lb");
    if (!me || !me.session) {
      el.innerHTML = `<div class="lb-empty">Sign in to see the board.</div>
        <button class="google-btn" id="bd-signin"><span class="g-badge">G</span> Sign in with Google</button>`;
      el.querySelector("#bd-signin").addEventListener("click", () => signInGoogle());
      return;
    }
    if (boardGame === "overall") await renderOverall(el); else await renderGameBoard(el, boardGame);
    renderBoardComments();
    stopRT(); rtChannel = await subscribeChanges(() => { if (boardGame) refreshBoardLive(); });
  }
  async function refreshBoardLive() {
    const el = daily.querySelector("#board-lb"); if (!el) return;
    if (boardGame === "overall") await renderOverall(el); else await renderGameBoard(el, boardGame);
    loadBoardComments();
  }
  async function renderGameBoard(el, gameId) {
    const rows = await leaderboard(gameId, todayStr());
    if (!rows.length) { el.innerHTML = `<div class="lb-empty">No scores yet today — play and be first!</div>`; return; }
    el.innerHTML = rows.map((r, i) => lbRow(r, i)).join("");
  }
  // Overall = average rank across today's games (lower is better). Playing more
  // games never hurts you vs someone with the same avg; ties break on games played.
  async function renderOverall(el) {
    const games = scoredGames();
    const boards = await Promise.all(games.map((g) => leaderboard(g.id, todayStr())));
    const players = new Map(); // uid -> { profile, ranks: [], uid }
    boards.forEach((rows) => rows.forEach((r, i) => {
      if (!players.has(r.user_id)) players.set(r.user_id, { uid: r.user_id, profile: r.profiles || {}, ranks: [] });
      players.get(r.user_id).ranks.push(i + 1);
    }));
    const list = [...players.values()].map((p) => ({
      ...p,
      avg: p.ranks.reduce((a, b) => a + b, 0) / p.ranks.length,
      n: p.ranks.length,
    })).sort((a, b) => a.avg - b.avg || b.n - a.n);
    if (!list.length) { el.innerHTML = `<div class="lb-empty">No scores yet today — play and be first!</div>`; return; }
    el.innerHTML = list.map((p, i) => {
      const mine = me && me.session && p.uid === me.session.user.id;
      return `<div class="lb-row ${mine ? "me" : ""}">
        <span class="lb-rank">${i + 1}</span>
        ${p.profile.avatar_url ? `<img class="lb-pic" src="${p.profile.avatar_url}">` : `<span class="lb-pic ph"></span>`}
        <span class="lb-name">${esc(p.profile.username || "player")}</span>
        <span class="lb-score">avg #${p.avg.toFixed(1)} · ${p.n}/${scoredGames().length}</span>
      </div>`;
    }).join("");
  }
  // Daily comment thread per board tab (target: "board", "<tab>:<date>").
  function boardThreadId() { return `${boardGame}:${todayStr()}`; }
  function renderBoardComments() {
    const box = daily.querySelector("#board-cmts"); if (!box) return;
    if (!me || !me.session) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <div class="panel-title" style="margin:1.1rem 0 0.5rem">💬 Trash talk</div>
      <div id="bc-list" class="bc-list">loading…</div>
      <div class="cmt-add"><input id="bc-input" placeholder="Say something…" maxlength="200"><button id="bc-send">Send</button></div>`;
    daily.querySelector("#bc-send").addEventListener("click", sendBoardComment);
    daily.querySelector("#bc-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendBoardComment(); });
    loadBoardComments();
  }
  async function sendBoardComment() {
    const inp = daily.querySelector("#bc-input"); if (!inp) return;
    const v = inp.value.trim(); if (!v) return; inp.value = "";
    await addComment("board", boardThreadId(), v);
    loadBoardComments();
  }
  async function loadBoardComments() {
    const el = daily.querySelector("#bc-list"); if (!el) return;
    const cs = await fetchComments("board", boardThreadId());
    el.innerHTML = cs.length
      ? cs.map((c) => `<div class="cmt"><b>${esc((c.profiles || {}).username || "player")}</b> ${esc(c.body)} <span class="feed-ago">${ago(c.created_at)}</span></div>`).join("")
      : `<div class="lb-empty" style="padding:0.6rem">No comments yet — start the trash talk.</div>`;
  }

  function requireSignIn(what) {
    daily.innerHTML = `
      <div class="dg dg-result">
        <div class="dg-emoji">🔒</div>
        <div class="dg-q">Sign in to use ${what}.</div>
        <button class="google-btn" id="rs-signin"><span class="g-badge">G</span> Sign in with Google</button>
      </div>`;
    const b = daily.querySelector("#rs-signin"); if (b) b.addEventListener("click", () => signInGoogle());
  }

  return { renderHome, startDaily };
}
