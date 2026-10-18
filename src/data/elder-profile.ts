/**
 * Reference care profile: Mama Adebayo, 74 — living independently in Lagos.
 * All demo data is deterministic so judges see identical, reproducible runs.
 */
import type { DailyBaseline } from "../engines/cognitive-biomarkers.js";
import type { ActiveMedication } from "../engines/medication-guardian.js";
import type { SensorSnapshot } from "../engines/ambient-triage.js";

export const ELDER = {
  id: "mama-adebayo",
  name: "Mama Adebayo",
  honorific: "Mama Adebayo",
  age: 74,
  city: "Ibadan",
  livingSituation: "Independent, single-storey family home",
  conditions: [
    "Atrial fibrillation (anticoagulated)",
    "Hypertension",
    "Type 2 diabetes",
    "Early mild cognitive impairment — monitoring",
  ],
  knownFacts: {
    children: ["Tolu", "Kunle"],
    grandchildren: ["Seun", "Ada"],
    lateHusband: "Pa Adetola",
    hometown: "Abeokuta",
    favouriteSong: "Ebenezer Obey — Board Members",
    church: "St. Anne's Anglican, Molete",
    market: "Bodija Market",
  },
} as const;

export const CARE_CIRCLE = [
  { id: "tolu", name: "Tolu Adebayo", role: "Daughter · Primary caregiver", channel: "Alexa app + SMS" },
  { id: "kunle", name: "Kunle Adebayo", role: "Son · Abuja", channel: "Alexa app" },
  { id: "okafor", name: "Dr. Okafor", role: "Family physician", channel: "Clinical summary export" },
  { id: "pharm", name: "Pharm. Eze", role: "Community pharmacist", channel: "Pharmacy line" },
] as const;

/** Active prescription schedule (mirrors the engines' drug knowledge). */
export const ACTIVE_MEDICATIONS: ActiveMedication[] = [
  { drug: "Apixaban", brand: "Eliquis", dose: "5 mg", schedule: "08:00 & 20:00", purpose: "Stroke prevention (AFib)" },
  { drug: "Lisinopril", dose: "10 mg", schedule: "08:00", purpose: "Blood pressure" },
  { drug: "Metformin", dose: "500 mg", schedule: "08:00 & 18:00 with food", purpose: "Blood sugar" },
  { drug: "Donepezil", brand: "Aricept", dose: "5 mg", schedule: "21:00", purpose: "Memory support" },
];

/**
 * Mama Adebayo's personal 7-day cognitive baseline (Mon→Sun last week).
 * Today's demo check-in intentionally sits slightly below baseline on
 * pronoun-drift so the longitudinal early-drift alert is demonstrable
 * without being alarming.
 */
export const COGNITIVE_BASELINE_7DAY: DailyBaseline[] = [
  { day: "Mon", mattr: 0.83, pronounNounRatio: 0.4, ideaDensity: 2.2, meanPauseMs: 1180, orientation: 92, composite: 84 },
  { day: "Tue", mattr: 0.85, pronounNounRatio: 0.36, ideaDensity: 2.4, meanPauseMs: 1120, orientation: 94, composite: 86 },
  { day: "Wed", mattr: 0.82, pronounNounRatio: 0.42, ideaDensity: 2.1, meanPauseMs: 1210, orientation: 91, composite: 83 },
  { day: "Thu", mattr: 0.84, pronounNounRatio: 0.38, ideaDensity: 2.3, meanPauseMs: 1150, orientation: 93, composite: 85 },
  { day: "Fri", mattr: 0.86, pronounNounRatio: 0.34, ideaDensity: 2.5, meanPauseMs: 1080, orientation: 95, composite: 87 },
  { day: "Sat", mattr: 0.81, pronounNounRatio: 0.44, ideaDensity: 2.0, meanPauseMs: 1240, orientation: 90, composite: 82 },
  { day: "Sun", mattr: 0.84, pronounNounRatio: 0.39, ideaDensity: 2.2, meanPauseMs: 1170, orientation: 92, composite: 84 },
];

/** A bright, specific reminiscence (high noun density, rich orientation cues). */
export const DEMO_TRANSCRIPT_BRIGHT =
  "Oh, that wedding in Abeokuta! I remember it like yesterday, I truly do. Your father, Pa Adetola, wore his cream agbada with the gold embroidery, and Ebenezer Obey himself played until midnight. Tolu was only six then, dancing in her yellow lace dress near the drummers, and everybody kept laughing because Tolu would not sit down. We served jollof rice, moin moin and fried plantain to nearly three hundred guests under the mango tree, that same mango tree behind your grandfather's house. Even the rain waited until the very end. And Kunle — Kunle kept sneaking puff-puff from the kitchen tray when he thought nobody was watching him.";

/** A word-finding-difficulty variant ("that thing", "the woman", vague fillers). */
export const DEMO_TRANSCRIPT_DRIFT =
  "Well, we went to that place, you know, the one with the thing outside. She was wearing that... that thing on her head, the nice one. He brought the stuff for everybody and they were all doing that dancing thing. It was long ago, before those children grew. Tolu was there, small small. I think the woman from over there cooked the food, the one with the... you know who I mean. We ate under the tree. It was good, it was really good.";

export const DEMO_LATENCIES_BRIGHT_MS = [940, 1050, 1180, 990, 1120, 1010];
export const DEMO_LATENCIES_DRIFT_MS = [1420, 1680, 1900, 1550, 1980, 1720];

/** Sensor snapshot: unattended kitchen stove while TV is on in the living room. */
export const DEMO_STOVE_SNAPSHOT: SensorSnapshot = {
  scenario: "Unattended kitchen stove",
  capturedAt: "2026-10-18T12:41:00+01:00",
  localTime: "12:41",
  sensors: {
    stoveBurner: { on: true, temperatureF: 375, onMinutes: 28 },
    kitchenMotionMinutesAgo: 28,
    livingRoomOccupied: true,
    livingRoomTvOn: true,
    frontDoorLocked: true,
    hallwayPacingMinutes: 0,
    bedroomMotionMinutesAgo: 190,
    waterLeak: false,
    smokeDetected: false,
  },
};

/** Sensor snapshot: 02:40 night pacing with the front door disengaged. */
export const DEMO_NIGHT_SNAPSHOT: SensorSnapshot = {
  scenario: "Night wandering risk",
  capturedAt: "2026-10-18T02:40:00+01:00",
  localTime: "02:40",
  sensors: {
    stoveBurner: { on: false, temperatureF: 0, onMinutes: 0 },
    kitchenMotionMinutesAgo: 300,
    livingRoomOccupied: false,
    livingRoomTvOn: false,
    frontDoorLocked: false,
    hallwayPacingMinutes: 14,
    bedroomMotionMinutesAgo: 14,
    waterLeak: false,
    smokeDetected: false,
  },
};
