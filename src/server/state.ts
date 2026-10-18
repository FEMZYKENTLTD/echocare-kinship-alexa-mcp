/**
 * EchoCare day state — the small in-memory longitudinal record the four tools
 * build together (biomarkers → medication events → home anomalies → digest).
 */
import type { BiomarkerReport, DriftAssessment } from "../engines/cognitive-biomarkers.js";
import type { MedicationAssessment } from "../engines/medication-guardian.js";
import type { CareCircleDigest } from "../agent/aws-bedrock-strands.js";

export interface SavedMemory {
  prompt: string;
  transcript: string;
  composite: number;
  savedAt: string;
}

export interface DayState {
  lastBiomarkers?: BiomarkerReport;
  lastDrift?: DriftAssessment;
  lastTranscript?: string;
  lastPrompt?: string;
  savedMemories: SavedMemory[];
  lastMedAssessment?: MedicationAssessment;
  preventedInteractions: Array<{ drug: string; interactsWith: string; severity: string; at: string }>;
  dosesConfirmed: number;
  dosesScheduled: number;
  doseLog: Array<{ at: string; note: string }>;
  resolvedAnomalies: Array<{ scenario: string; resolution: string }>;
  openIncidentIds: Set<string>;
  lastDigest?: CareCircleDigest;
  digestSentTo: string[];
  hydrationGlasses: number;
  hydrationGoal: number;
  sleepHours: number;
  stepsEstimate: number;
}

export const dayState: DayState = freshDayState();

export function freshDayState(): DayState {
  return {
    savedMemories: [],
    preventedInteractions: [],
    dosesConfirmed: 4, // morning + midday doses already confirmed before the demo opens
    dosesScheduled: 6,
    doseLog: [
      { at: "2026-10-18T08:03:00+01:00", note: "08:00 Apixaban 5 mg + Lisinopril 10 mg confirmed by voice" },
      { at: "2026-10-18T08:04:00+01:00", note: "08:00 Metformin 500 mg with breakfast confirmed" },
    ],
    resolvedAnomalies: [],
    openIncidentIds: new Set<string>(),
    digestSentTo: [],
    hydrationGlasses: 5,
    hydrationGoal: 7,
    sleepHours: 6.8,
    stepsEstimate: 3412,
  };
}

/** Reset in place (keeps imported references valid) — used by tests. */
export function resetDayState(): void {
  Object.assign(dayState, freshDayState());
}

export function adherencePct(): number {
  return Math.round((dayState.dosesConfirmed / Math.max(1, dayState.dosesScheduled)) * 100);
}
