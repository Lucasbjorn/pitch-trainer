// Guess Who — clip library. The game reads this list; drop in clips from any
// LEGAL source and it just works. Nothing here is fetched from YouTube/Spotify.
//
// Each clip:
//   { src, title, aliases }
//   src     = a playable audio URL (mp3/m4a/ogg). Options:
//             • a public-domain recording URL (early jazz is PD in the US)
//             • a file you own, uploaded to Supabase Storage (public bucket)
//             • a Spotify 30-second preview_url (from the Spotify API)
//   title   = the correct answer shown after a win
//   aliases = other accepted spellings (lowercased match, punctuation ignored)
//
// Example (replace with your own):
// { src: "https://YOUR-BUCKET.supabase.co/storage/v1/object/public/clips/song1.mp3",
//   title: "Autumn Leaves", aliases: ["autumn leaves", "les feuilles mortes"] },

export const CLIPS = [
];
