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
  {
    src: "clips/after-youve-gone.mp3",
    tune: { answer: "After You've Gone", accept: ["after you've gone", "after youve gone", "after you have gone"] },
    fields: [
      { label: "Piano", answer: "Emmet Cohen", accept: ["emmet cohen", "cohen", "emmett cohen", "emmet"] },
      { label: "Trumpet", answer: "Bruce Harris", accept: ["bruce harris", "harris", "bruce"] },
      { label: "Alto saxophone", answer: "Patrick Bartley", accept: ["patrick bartley", "bartley", "patrick"] },
      { label: "Bass", answer: "Russell Hall", accept: ["russell hall", "hall", "russell"] },
      { label: "Drums", answer: "Joe Saylor", accept: ["joe saylor", "saylor", "joe"] },
    ],
    reveal: "Emmet Cohen — piano · Bruce Harris — trumpet · Patrick Bartley — alto sax · Russell Hall — bass · Joe Saylor — drums",
  },
];

// Legacy Heardle-style clip list (unused by the current game; kept for reference).
export const CLIPS = [];
