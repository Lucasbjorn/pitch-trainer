// Guess Who — daily puzzle library. Each puzzle plays a full track (a file YOU
// provide — drop it in the clips/ folder and commit) and asks the player to
// name the tune + who's playing each instrument. Nothing here is fetched from
// YouTube/Spotify; use recordings you own.
//
// Puzzle shape:
//   src    = audio path/URL ("clips/love-supreme.mp3")
//   tune   = { answer, accept } — the tune name field
//   fields = [{ label, answer, accept }] — one text box per instrument
//   reveal = full personnel line shown at the end
// Matching is fuzzy: case/punctuation ignored, surnames accepted, small typos ok.
//
// Puzzles rotate daily starting at START_DATE (index = days since, mod length).

export const START_DATE = "2026-07-20";

export const PUZZLES = [
  {
    src: "clips/love-supreme.mp3",
    tune: { answer: "A Love Supreme", accept: ["a love supreme", "love supreme", "acknowledgement", "a love supreme part 1", "part 1 acknowledgement"] },
    fields: [
      { label: "Tenor saxophone", answer: "John Coltrane", accept: ["john coltrane", "coltrane", "trane"] },
      { label: "Piano", answer: "McCoy Tyner", accept: ["mccoy tyner", "tyner", "mcoy tyner", "mccoy"] },
      { label: "Double bass", answer: "Jimmy Garrison", accept: ["jimmy garrison", "garrison"] },
      { label: "Drums", answer: "Elvin Jones", accept: ["elvin jones", "elvin", "jones"] },
    ],
    reveal: "John Coltrane — tenor sax & vocals · McCoy Tyner — piano · Jimmy Garrison — double bass · Elvin Jones — drums & percussion",
  },
];

// Legacy Heardle-style clip list (unused by the current game; kept for reference).
export const CLIPS = [];
