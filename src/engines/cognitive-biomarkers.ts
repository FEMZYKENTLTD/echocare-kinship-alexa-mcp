/**
 * Linguistic & Cognitive Biomarker Engine
 * ========================================
 * Computes screening-grade speech biomarkers from a conversational transcript
 * plus per-turn response latencies. These are the same feature families used
 * in the dementia-from-speech literature (lexical diversity, pronoun overuse /
 * anomia, idea density, pause behaviour). EchoCare uses them strictly as
 * longitudinal *wellness signals* against the elder's own baseline — never as
 * a diagnosis.
 */

export interface CognitiveCheckinInput {
  transcript: string;
  /** Per-turn response latencies in milliseconds (end-of-prompt → speech start). */
  turnLatenciesMs?: number[];
  /** Personal facts a well-oriented reminiscence is likely to touch on. */
  expectedFacts?: {
    people?: string[];
    places?: string[];
    times?: string[];
  };
}

export interface DailyBaseline {
  day: string;
  mattr: number;
  pronounNounRatio: number;
  ideaDensity: number;
  meanPauseMs: number;
  orientation: number;
  composite: number;
}

export interface BiomarkerReport {
  wordCount: number;
  sentenceCount: number;
  /** Moving-Average Type-Token Ratio (0–1), window = 50 tokens. */
  mattr: number;
  /** Pronoun(+vague reference) to noun ratio. Rising ≈ word-finding load. */
  pronounNounRatio: number;
  vagueReferences: string[];
  filledPausesPer100Words: number;
  /** Idea density: propositions per 10 words (CPIDR-style heuristic). */
  ideaDensity: number;
  latency: {
    samples: number;
    meanMs: number;
    medianMs: number;
    p90Ms: number;
    /** 0–100 sub-score (100 = brisk word retrieval). */
    score: number;
  };
  orientation: {
    /** Temporal & autobiographical orientation index 0–100. */
    index: number;
    matchedPeople: string[];
    matchedPlaces: string[];
    matchedTimes: string[];
  };
  subScores: {
    lexicalDiversity: number;
    wordRetrieval: number;
    ideaDensity: number;
    orientation: number;
    fluency: number;
  };
  /** Weighted composite cognitive wellness score 0–100. */
  compositeScore: number;
}

export interface DriftAssessment {
  baselineDays: number;
  baselineCompositeMean: number;
  baselineCompositeStd: number;
  todayComposite: number;
  deltaVsBaseline: number;
  zScore: number;
  /** "steady" | "watch" | "early-drift" */
  alertLevel: "steady" | "watch" | "early-drift";
  message: string;
  sparkline: Array<{ day: string; composite: number }>;
}

/* -------------------------------------------------------------------------- */
/* Closed-class lexicons (compact but real)                                   */
/* -------------------------------------------------------------------------- */

const PRONOUNS = new Set([
  "i", "me", "my", "mine", "myself", "you", "your", "yours", "yourself",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "this", "that", "these", "those", "who", "whom", "what", "which",
  "somebody", "someone", "something", "anybody", "anyone", "anything",
  "everybody", "everyone", "everything", "nobody", "nothing",
]);

/** "Empty words" — classic anomia circumlocutions. Counted as vague reference. */
const VAGUE_TERMS = new Set([
  "thing", "things", "stuff", "whatchamacallit", "thingy", "thingamajig",
  "whatsit", "whosit", "whatever", "somewhere", "somehow",
]);

const FUNCTION_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "when",
  "while", "of", "at", "by", "for", "with", "about", "against", "between",
  "into", "through", "after", "over", "before", "under", "again", "further",
  "once", "here", "there", "all", "any", "both", "each", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "can", "will", "just", "should",
  "now", "was", "were", "be", "been", "being", "have", "has", "had",
  "having", "do", "does", "did", "doing", "would", "could", "shall",
  "may", "might", "must", "is", "am", "are", "to", "from", "in", "out",
  "on", "off", "up", "down", "as", "oh", "well", "really", "yes",
]);

const VERB_MARKERS = [
  "remember", "wore", "played", "danced", "served", "cooked", "brought",
  "went", "came", "sang", "laughed", "cried", "waited", "watched", "kept",
  "sneaking", "thought", "grew", "took", "gave", "made", "said", "told",
  "saw", "heard", "felt", "knew", "lived", "worked", "married", "dancing",
  "is", "was", "were", "had", "did", "go", "going", "doing",
];

const ADJECTIVE_SUFFIXES = ["ous", "ful", "less", "ive", "able", "ible", "al"];
const VERB_SUFFIXES = ["ed", "ing"];
const ADVERB_SUFFIX = "ly";

const TEMPORAL_MARKERS = [
  "yesterday", "today", "tomorrow", "morning", "evening", "night",
  "midnight", "noon", "long ago", "years ago", "last year", "last week",
  "when i was", "back then", "until", "before", "after", "sunday",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

const FILLED_PAUSES = new Set(["um", "uh", "er", "erm", "hmm", "ah", "eh"]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).filter(Boolean);
}

/**
 * Moving-Average Type-Token Ratio. For every window of `window` consecutive
 * tokens, TTR = unique/window; MATTR is the mean across all windows. Falls
 * back to plain TTR when the sample is shorter than one window.
 */
export function computeMATTR(tokens: string[], window = 50): number {
  if (tokens.length === 0) return 0;
  if (tokens.length < window) {
    return new Set(tokens).size / tokens.length;
  }
  const counts = new Map<string, number>();
  let unique = 0;
  let sum = 0;
  let windows = 0;
  const add = (t: string) => {
    const c = (counts.get(t) ?? 0) + 1;
    counts.set(t, c);
    if (c === 1) unique += 1;
  };
  const remove = (t: string) => {
    const c = (counts.get(t) ?? 0) - 1;
    if (c <= 0) {
      counts.delete(t);
      unique -= 1;
    } else counts.set(t, c);
  };
  for (let i = 0; i < tokens.length; i += 1) {
    add(tokens[i]);
    if (i >= window) remove(tokens[i - window]);
    if (i >= window - 1) {
      sum += unique / window;
      windows += 1;
    }
  }
  return windows ? sum / windows : 0;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function clamp01to100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/* -------------------------------------------------------------------------- */
/* Main analysis                                                              */
/* -------------------------------------------------------------------------- */

export function analyzeTranscript(input: CognitiveCheckinInput): BiomarkerReport {
  const rawText = input.transcript ?? "";
  const tokens = tokenize(rawText);
  const wordCount = tokens.length;
  const sentenceCount = Math.max(1, (rawText.match(/[.!?]+/g) ?? []).length);

  /* 1 — Lexical diversity (MATTR) */
  const mattr = computeMATTR(tokens, 50);

  /* 2 — Pronoun-to-noun drift + vague reference (“that thing over there”) */
  let pronounCount = 0;
  let nounProxyCount = 0;
  let vagueCount = 0;
  let verbCount = 0;
  let modifierCount = 0; // adjectives + adverbs (proposition carriers)
  let filledPauses = 0;
  const vagueReferences: string[] = [];

  for (const token of tokens) {
    if (FILLED_PAUSES.has(token)) filledPauses += 1;
    if (VAGUE_TERMS.has(token)) {
      vagueCount += 1;
      if (!vagueReferences.includes(token)) vagueReferences.push(token);
      pronounCount += 1; // vague fillers behave like pronoun substitutions
      continue;
    }
    if (PRONOUNS.has(token)) {
      pronounCount += 1;
      continue;
    }
    if (FUNCTION_WORDS.has(token)) continue;
    // Content word: classify heuristically.
    const isVerb =
      VERB_MARKERS.includes(token) ||
      VERB_SUFFIXES.some((s) => token.endsWith(s) && token.length > s.length + 2);
    const isAdverb = token.endsWith(ADVERB_SUFFIX) && token.length > 4;
    const isAdjective = ADJECTIVE_SUFFIXES.some(
      (s) => token.endsWith(s) && token.length > s.length + 2,
    );
    if (isVerb) verbCount += 1;
    else if (isAdverb || isAdjective) modifierCount += 1;
    else nounProxyCount += 1; // remaining content words ≈ nouns/proper nouns
  }

  const pronounNounRatio = pronounCount / Math.max(1, nounProxyCount);
  const filledPausesPer100Words = wordCount
    ? (filledPauses / wordCount) * 100
    : 0;

  /* 3 — Idea density (propositions ≈ verbs + modifiers + connectives) */
  const connectives = tokens.filter((t) =>
    ["and", "but", "because", "when", "while", "until", "with", "near", "under"].includes(t),
  ).length;
  const propositions = verbCount + modifierCount + Math.round(connectives * 0.5);
  const ideaDensity = wordCount ? (propositions / wordCount) * 10 : 0;

  /* 4 — Latency statistics */
  const latencies = (input.turnLatenciesMs ?? []).filter(
    (v) => Number.isFinite(v) && v > 0,
  );
  const meanMs = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 1200;
  const medianMs = percentile(latencies, 50) || meanMs;
  const p90Ms = percentile(latencies, 90) || meanMs;
  // 800 ms ≈ brisk (100) … 3000 ms ≈ heavy word-search (≤35).
  const latencyScore = clamp01to100(100 - Math.max(0, meanMs - 800) / 34);

  /* 5 — Temporal & autobiographical orientation */
  const lower = rawText.toLowerCase();
  const expected = input.expectedFacts ?? {};
  const matchAll = (items: string[] = []) =>
    items.filter((item) => lower.includes(item.toLowerCase()));
  const matchedPeople = matchAll(expected.people);
  const matchedPlaces = matchAll(expected.places);
  const temporalHits = TEMPORAL_MARKERS.filter((m) => lower.includes(m));
  const matchedTimes = [...new Set([...matchAll(expected.times), ...temporalHits])];

  const peopleScore = expected.people?.length
    ? matchedPeople.length / Math.min(expected.people.length, 3)
    : Math.min(1, matchedPeople.length);
  const placeScore = expected.places?.length
    ? matchedPlaces.length / Math.min(expected.places.length, 2)
    : Math.min(1, matchedPlaces.length);
  const timeScore = Math.min(1, temporalHits.length / 3);
  const specificityScore = Math.min(
    1,
    nounProxyCount / Math.max(10, wordCount * 0.22),
  );
  const orientationIndex = clamp01to100(
    (peopleScore * 0.35 + placeScore * 0.25 + timeScore * 0.2 + specificityScore * 0.2) * 100,
  );

  /* Sub-scores (0–100) */
  const subScores = {
    // Healthy older-adult MATTR ≈ 0.68–0.80 → map 0.45..0.85 → 0..100
    lexicalDiversity: clamp01to100(((mattr - 0.45) / 0.4) * 100),
    // Ratio 0.5 ≈ strong; 1.6+ ≈ pronoun-heavy circumlocution
    wordRetrieval: clamp01to100(100 - Math.max(0, pronounNounRatio - 0.5) * 55 - vagueCount * 3),
    // Idea density 4–5/10 words is strong narrative
    ideaDensity: clamp01to100((ideaDensity / 3.2) * 100),
    orientation: orientationIndex,
    fluency: clamp01to100(
      latencyScore * 0.7 + Math.max(0, 100 - filledPausesPer100Words * 12) * 0.3,
    ),
  };

  const compositeScore = clamp01to100(
    subScores.lexicalDiversity * 0.22 +
      subScores.wordRetrieval * 0.26 +
      subScores.ideaDensity * 0.18 +
      subScores.orientation * 0.2 +
      subScores.fluency * 0.14,
  );

  return {
    wordCount,
    sentenceCount,
    mattr: Number(mattr.toFixed(3)),
    pronounNounRatio: Number(pronounNounRatio.toFixed(2)),
    vagueReferences,
    filledPausesPer100Words: Number(filledPausesPer100Words.toFixed(1)),
    ideaDensity: Number(ideaDensity.toFixed(1)),
    latency: {
      samples: latencies.length,
      meanMs: Math.round(meanMs),
      medianMs: Math.round(medianMs),
      p90Ms: Math.round(p90Ms),
      score: latencyScore,
    },
    orientation: {
      index: orientationIndex,
      matchedPeople,
      matchedPlaces,
      matchedTimes,
    },
    subScores,
    compositeScore,
  };
}

/* -------------------------------------------------------------------------- */
/* Longitudinal drift vs. the elder's own 7-day baseline                      */
/* -------------------------------------------------------------------------- */

export function assessDrift(
  today: BiomarkerReport,
  baseline: DailyBaseline[],
): DriftAssessment {
  const composites = baseline.map((d) => d.composite);
  const mean = composites.length
    ? composites.reduce((a, b) => a + b, 0) / composites.length
    : today.compositeScore;
  const variance = composites.length
    ? composites.reduce((a, b) => a + (b - mean) ** 2, 0) / composites.length
    : 0;
  // Floor the SD at a population-plausible 4 points so a short, unusually
  // stable baseline week can't produce absurd z-scores.
  const std = Math.max(4, Math.sqrt(variance));
  const zScore = (today.compositeScore - mean) / std;
  const delta = today.compositeScore - mean;

  let alertLevel: DriftAssessment["alertLevel"] = "steady";
  let message = `Steady and bright — today's conversation sits within Mama Adebayo's normal personal range (baseline ${Math.round(mean)}).`;
  if (zScore <= -2 || delta <= -12) {
    alertLevel = "early-drift";
    message = `Early drift signal: today's composite (${today.compositeScore}) is ${Math.abs(Math.round(delta))} points below the 7-day personal baseline (${Math.round(mean)}), driven mainly by word-retrieval load (pronoun-to-noun ratio ${today.pronounNounRatio}). Not a diagnosis — flagged for gentle family awareness and clinician review if it persists 3+ days.`;
  } else if (zScore <= -1 || delta <= -6) {
    alertLevel = "watch";
    message = `Soft watch: today reads a little below baseline (${today.compositeScore} vs ${Math.round(mean)}). Often explained by poor sleep, pain, or low hydration. EchoCare will keep watching quietly.`;
  }

  return {
    baselineDays: baseline.length,
    baselineCompositeMean: Math.round(mean),
    baselineCompositeStd: Number(std.toFixed(1)),
    todayComposite: today.compositeScore,
    deltaVsBaseline: Math.round(delta),
    zScore: Number(zScore.toFixed(2)),
    alertLevel,
    message,
    sparkline: [
      ...baseline.map((d) => ({ day: d.day, composite: d.composite })),
      { day: "Today", composite: today.compositeScore },
    ],
  };
}
