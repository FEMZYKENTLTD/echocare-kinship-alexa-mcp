/**
 * Tool 1 — analyze_cognitive_checkin → ui://echocare/memory-lane
 * Warm reminiscence conversation + Linguistic & Cognitive Biomarker Engine.
 */
import { z } from "zod";
import {
  analyzeTranscript,
  assessDrift,
} from "../../engines/cognitive-biomarkers.js";
import {
  COGNITIVE_BASELINE_7DAY,
  DEMO_LATENCIES_BRIGHT_MS,
  DEMO_LATENCIES_DRIFT_MS,
  DEMO_TRANSCRIPT_BRIGHT,
  DEMO_TRANSCRIPT_DRIFT,
  ELDER,
} from "../../data/elder-profile.js";
import { dayState } from "../state.js";

export const DEFAULT_PROMPT =
  "Mama Adebayo, tell me about a celebration day that still makes you smile — who was there, and what do you remember most?";

export const cognitiveCheckinInputSchema = {
  action: z
    .enum(["analyze", "save_memory"])
    .default("analyze")
    .describe("analyze = run biomarker screening on a reminiscence; save_memory = store the memory card to the family album"),
  transcript: z
    .string()
    .optional()
    .describe("Verbatim elder transcript. Omit to use the built-in demo samples."),
  prompt: z
    .string()
    .optional()
    .describe("The reminiscence prompt Alexa+ asked."),
  sample: z
    .enum(["bright", "drift"])
    .optional()
    .describe("Which bundled demo transcript to analyze when none is supplied."),
  turnLatenciesMs: z
    .array(z.number())
    .optional()
    .describe("Per-turn response latencies in ms (word-finding pause signal)."),
};

export interface CognitiveCheckinArgs {
  action?: "analyze" | "save_memory";
  transcript?: string;
  prompt?: string;
  sample?: "bright" | "drift";
  turnLatenciesMs?: number[];
}

export function runCognitiveCheckin(args: CognitiveCheckinArgs = {}) {
  const sample = args.sample ?? "bright";
  const transcript =
    args.transcript ??
    (sample === "drift" ? DEMO_TRANSCRIPT_DRIFT : DEMO_TRANSCRIPT_BRIGHT);
  const prompt = args.prompt ?? dayState.lastPrompt ?? DEFAULT_PROMPT;
  const latencies =
    args.turnLatenciesMs ??
    (sample === "drift" ? DEMO_LATENCIES_DRIFT_MS : DEMO_LATENCIES_BRIGHT_MS);

  const report = analyzeTranscript({
    transcript,
    turnLatenciesMs: latencies,
    expectedFacts: {
      people: [
        ...ELDER.knownFacts.children,
        ...ELDER.knownFacts.grandchildren,
        ELDER.knownFacts.lateHusband,
      ],
      places: [ELDER.knownFacts.hometown, ELDER.knownFacts.market],
    },
  });
  const drift = assessDrift(report, COGNITIVE_BASELINE_7DAY);

  dayState.lastBiomarkers = report;
  dayState.lastDrift = drift;
  dayState.lastTranscript = transcript;
  dayState.lastPrompt = prompt;

  let savedToAlbum = false;
  if (args.action === "save_memory") {
    dayState.savedMemories.push({
      prompt,
      transcript,
      composite: report.compositeScore,
      savedAt: new Date().toISOString(),
    });
    savedToAlbum = true;
  }

  const alexaSays =
    args.action === "save_memory"
      ? "Beautiful — I've saved that story to your family album, Mama Adebayo. Tolu and Kunle will love hearing about the wedding day again."
      : drift.alertLevel === "steady"
        ? "What a beautiful story, Mama Adebayo — I can almost hear the music from that day. I've drawn your memory card on the screen. You remembered every detail so clearly this morning."
        : drift.alertLevel === "watch"
          ? "Thank you for sharing that with me, Mama Adebayo. Let's take the morning gently — would you like some water while we look at your memory card together?"
          : "Thank you, Mama Adebayo. Some days the words hide a little, and that's alright. Let's rest with some music — I'll stay right here with you.";

  const text =
    `Cognitive check-in complete. Composite wellness ${report.compositeScore}/100 ` +
    `(baseline ${drift.baselineCompositeMean}, Δ ${drift.deltaVsBaseline}, ${drift.alertLevel}). ` +
    `MATTR ${report.mattr}, pronoun→noun ratio ${report.pronounNounRatio}, idea density ${report.ideaDensity}, ` +
    `orientation ${report.orientation.index}, mean word-finding pause ${report.latency.meanMs} ms.` +
    (savedToAlbum ? " Memory saved to the family album." : "");

  return {
    text,
    structuredContent: {
      view: "ui://echocare/memory-lane",
      prompt,
      transcript,
      sample,
      report,
      drift,
      savedToAlbum,
      memoryCardsSaved: dayState.savedMemories.length,
      alexaSays,
      disclaimer:
        "Wellness screening signal vs. personal baseline — not a medical diagnosis.",
    },
  };
}
