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
