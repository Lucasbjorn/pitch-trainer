// Supabase social layer — auth (Google), profiles (with avatar), daily scores
// and leaderboard. Loads the Supabase client from esm.sh on demand. Everything
// degrades gracefully: with no config, socialConfigured() is false and callers
// simply skip the social UI.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

let sb = null;
export function socialConfigured() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }

async function client() {
  if (sb) return sb;
  if (!socialConfigured()) return null;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  return sb;
}

export async function getSession() {
  const c = await client(); if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session || null;
}
export async function signInGoogle() {
  const c = await client(); if (!c) return;
  await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin } });
}
export async function signOut() { const c = await client(); if (c) await c.auth.signOut(); }

export async function getProfile(uid) {
  const c = await client(); if (!c) return null;
  const { data } = await c.from("profiles").select("*").eq("id", uid).maybeSingle();
  return data || null;
}
export async function saveProfile(uid, username, avatarFile) {
  const c = await client(); if (!c) return { error: "not configured" };
  let avatar_url = null;
  if (avatarFile) {
    const path = `${uid}.png`;
    const up = await c.storage.from("avatars").upload(path, avatarFile, { upsert: true, contentType: avatarFile.type || "image/png" });
    if (up.error) return { error: up.error.message };
    avatar_url = c.storage.from("avatars").getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`;
  }
  const row = { id: uid, username };
  if (avatar_url) row.avatar_url = avatar_url;
  const { error } = await c.from("profiles").upsert(row);
  return { error: error ? error.message : null, avatar_url };
}

export async function submitScore(gameId, date, score, label) {
  const c = await client(); if (!c) return;
  const s = await getSession(); if (!s) return;
  await c.from("scores").upsert(
    { user_id: s.user.id, game_id: gameId, date, score, label },
    { onConflict: "user_id,game_id,date" }
  );
}
export async function leaderboard(gameId, date) {
  const c = await client(); if (!c) return [];
  const { data } = await c.from("scores")
    .select("score,label,user_id,profiles(username,avatar_url)")
    .eq("game_id", gameId).eq("date", date)
    .order("score", { ascending: true }).limit(50);
  return data || [];
}
export async function myId() { const s = await getSession(); return s ? s.user.id : null; }

// ---- feed + posts + comments ----
export async function listProfiles() {
  const c = await client(); if (!c) return [];
  const { data } = await c.from("profiles").select("id,username,avatar_url").order("username");
  return data || [];
}
export async function createPost(body) {
  const c = await client(); if (!c) return; const s = await getSession(); if (!s) return;
  await c.from("posts").insert({ user_id: s.user.id, body });
}
export async function fetchFeed(limit = 40) {
  const c = await client(); if (!c) return [];
  const [posts, scores] = await Promise.all([
    c.from("posts").select("id,body,created_at,user_id,profiles(username,avatar_url)").order("created_at", { ascending: false }).limit(limit),
    c.from("scores").select("game_id,date,score,label,created_at,user_id,profiles(username,avatar_url)").order("created_at", { ascending: false }).limit(limit),
  ]);
  const items = [];
  (posts.data || []).forEach((p) => items.push({ kind: "post", id: p.id, t: p.created_at, user: p.profiles, body: p.body }));
  (scores.data || []).forEach((s) => items.push({ kind: "score", id: `${s.game_id}:${s.date}:${s.user_id}`, t: s.created_at, user: s.profiles, game_id: s.game_id, label: s.label, date: s.date }));
  items.sort((a, b) => new Date(b.t) - new Date(a.t));
  return items.slice(0, limit);
}
export async function fetchComments(targetType, targetId) {
  const c = await client(); if (!c) return [];
  const { data } = await c.from("comments").select("id,body,created_at,profiles(username,avatar_url)").eq("target_type", targetType).eq("target_id", targetId).order("created_at");
  return data || [];
}
export async function addComment(targetType, targetId, body) {
  const c = await client(); if (!c) return; const s = await getSession(); if (!s) return;
  await c.from("comments").insert({ user_id: s.user.id, target_type: targetType, target_id: targetId, body });
}

// ---- direct messages ----
export async function listThreads() {
  const c = await client(); if (!c) return []; const s = await getSession(); if (!s) return [];
  const { data } = await c.from("messages").select("sender,recipient,body,created_at,sp:profiles!messages_sender_fkey(username,avatar_url),rp:profiles!messages_recipient_fkey(username,avatar_url)").or(`sender.eq.${s.user.id},recipient.eq.${s.user.id}`).order("created_at", { ascending: false });
  const seen = new Map();
  (data || []).forEach((m) => {
    const mine = m.sender === s.user.id;
    const otherId = mine ? m.recipient : m.sender;
    const otherProfile = mine ? m.rp : m.sp;
    if (!seen.has(otherId)) seen.set(otherId, { otherId, profile: otherProfile, body: m.body, t: m.created_at });
  });
  return [...seen.values()];
}
export async function fetchThread(otherId) {
  const c = await client(); if (!c) return []; const s = await getSession(); if (!s) return [];
  const { data } = await c.from("messages").select("sender,recipient,body,created_at")
    .or(`and(sender.eq.${s.user.id},recipient.eq.${otherId}),and(sender.eq.${otherId},recipient.eq.${s.user.id})`)
    .order("created_at");
  return data || [];
}
export async function sendMessage(recipient, body) {
  const c = await client(); if (!c) return; const s = await getSession(); if (!s) return;
  await c.from("messages").insert({ sender: s.user.id, recipient, body });
}

// ---- realtime ----
export async function subscribeChanges(cb) {
  const c = await client(); if (!c) return null;
  return c.channel("rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, cb)
    .subscribe();
}
