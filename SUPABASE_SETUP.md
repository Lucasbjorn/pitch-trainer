# Supabase setup (accounts + leaderboard) — ~5 minutes

The app works fully without this. These steps turn on Google sign-in, profiles
(with a required pic), daily-score submission, and the friends leaderboard.

## 1. Create the project
1. Go to https://supabase.com → **New project** (free tier is fine). Pick a name/region.
2. When it's ready: **Settings → API**. Copy:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key (a long string — safe to expose publicly)

## 2. Add the keys to the app
Open `supabase-config.js` and paste them in:
```js
export const SUPABASE_URL = "https://abcd1234.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...the anon key...";
```
Commit + push (Vercel redeploys). The anon key is public-safe — Row-Level
Security (below) is what actually protects the data.

## 3. Create the tables
Supabase → **SQL Editor** → paste all of `db/schema.sql` → **Run**.

## 4. Turn on Google sign-in
1. Supabase → **Authentication → Providers → Google** → enable.
2. It shows a **redirect URL** like `https://<project>.supabase.co/auth/v1/callback`.
3. In **Google Cloud Console** → APIs & Services → Credentials → **Create OAuth client ID** (Web):
   - Authorized redirect URI = the Supabase callback URL from step 2.
   - Copy the **Client ID** + **Client secret** back into Supabase's Google provider.
4. Supabase → **Authentication → URL Configuration**: set **Site URL** to your Vercel URL
   (`https://pitch-trainer-rho.vercel.app`) and add it under **Redirect URLs**.

## 5. Done
Reload the site → a **Sign in** chip appears on the Home hub. Sign in with Google,
set a username + avatar, play the daily game, and your score posts to the
leaderboard your friends share.

*(Feed, comments, and DMs are the next pass — once this core is connected and we
can test against real data.)*
