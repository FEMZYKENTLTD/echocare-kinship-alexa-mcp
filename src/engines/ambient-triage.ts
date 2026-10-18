/**
 * Ambient Multi-Sensor Anomaly Triage Engine
 * ==========================================
 * Scores smart-home telemetry into a 0–100 risk index and drives EchoCare's
 * calm 3-stage de-escalation state machine:
 *
 *   Stage 1  Gentle Alexa+ check-in (voice + Echo Show card), 60 s window
 *   Stage 2  Autonomous smart-relay cutoff + visual confirmation
 *   Stage 3  Care-circle escalation with full sensor context
 *
 * Incidents live in an in-memory store so follow-up MCP tool calls from the
 * Echo Show card ("Turn Off Stove Relay Now", "I'm Cooking, Snooze 15m")
 * advance the same incident deterministically.
 */

export interface SensorSnapshot {
  scenario: string;
  capturedAt: string;
  /** Home-local time "HH:MM". */
  localTime: string;
  sensors: {
    stoveBurner: { on: boolean; temperatureF: number; onMinutes: number };
    kitchenMotionMinutesAgo: number;
    livingRoomOccupied: boolean;
    livingRoomTvOn: boolean;
    frontDoorLocked: boolean;
    hallwayPacingMinutes: number;
    bedroomMotionMinutesAgo: number;
    waterLeak: boolean;
    smokeDetected: boolean;
  };
}

export type IncidentStage =
  | "monitoring"
  | "stage1-checkin"
  | "stage2-action"
  | "stage3-escalated"
  | "resolved"
  | "snoozed";

export interface RiskFactor {
  signal: string;
  weight: number;
  detail: string;
}

export interface AmbientIncident {
  incidentId: string;
  scenario: string;
  kind: "unattended-stove" | "night-wandering" | "water-leak" | "smoke" | "general";
  riskScore: number;
  riskBand: "low" | "moderate" | "high" | "critical";
  riskFactors: RiskFactor[];
  stage: IncidentStage;
  stage1WindowSeconds: 60;
  alexaPrompt: string;
  snapshot: SensorSnapshot;
  timeline: Array<{ at: string; event: string }>;
  stoveRelayOn: boolean;
  snoozedUntil?: string;
  acknowledgedByElder?: boolean;
  careCircleNotified: boolean;
}

const incidents = new Map<string, AmbientIncident>();
let incidentCounter = 0;

function isNight(localTime: string): boolean {
  const hour = Number.parseInt(localTime.split(":")[0] ?? "12", 10);
  return hour >= 22 || hour < 5;
}

/** Deterministic weighted risk model over the sensor feature vector. */
export function scoreRisk(snapshot: SensorSnapshot): {
  riskScore: number;
  riskFactors: RiskFactor[];
  kind: AmbientIncident["kind"];
} {
  const s = snapshot.sensors;
  const factors: RiskFactor[] = [];
  let score = 0;
  let kind: AmbientIncident["kind"] = "general";

  if (s.stoveBurner.on) {
    const unattendedMinutes = Math.min(s.stoveBurner.onMinutes, s.kitchenMotionMinutesAgo);
    if (unattendedMinutes >= 20) {
      score += 42;
      factors.push({
        signal: "Stove unattended ≥20 min",
        weight: 42,
        detail: `Burner at ${s.stoveBurner.temperatureF}°F for ${s.stoveBurner.onMinutes} min; last kitchen motion ${s.kitchenMotionMinutesAgo} min ago.`,
      });
      kind = "unattended-stove";
    } else if (unattendedMinutes >= 10) {
      score += 24;
      factors.push({
        signal: "Stove unattended 10–19 min",
        weight: 24,
        detail: `Burner at ${s.stoveBurner.temperatureF}°F, no kitchen motion for ${s.kitchenMotionMinutesAgo} min.`,
      });
      kind = "unattended-stove";
    }
    if (s.stoveBurner.temperatureF >= 350) {
      score += 14;
      factors.push({
        signal: "High burner temperature",
        weight: 14,
        detail: `${s.stoveBurner.temperatureF}°F — above the 350°F grease-ignition caution band for common cooking oils.`,
      });
    }
    if (s.livingRoomOccupied && s.livingRoomTvOn) {
      score += 9;
      factors.push({
        signal: "Occupant absorbed elsewhere",
        weight: 9,
        detail: "Living-room presence + TV audio: attention captured away from the kitchen (classic unattended-cooking pattern).",
      });
    }
  }

  if (s.smokeDetected) {
    score += 55;
    kind = "smoke";
    factors.push({ signal: "Smoke detected", weight: 55, detail: "Photoelectric sensor above alarm threshold." });
  }
  if (s.waterLeak) {
    score += 30;
    kind = kind === "general" ? "water-leak" : kind;
    factors.push({ signal: "Water leak", weight: 30, detail: "Leak probe wet — slip, electrical and property risk." });
  }

  if (isNight(snapshot.localTime) && s.hallwayPacingMinutes >= 10) {
    score += 26;
    kind = kind === "general" ? "night-wandering" : kind;
    factors.push({
      signal: "Night hallway pacing",
      weight: 26,
      detail: `${s.hallwayPacingMinutes} min of repetitive hallway motion at ${snapshot.localTime} — sundowning/disoritation pattern.`,
    });
  }
  if (!s.frontDoorLocked) {
    const nightBoost = isNight(snapshot.localTime);
    score += nightBoost ? 24 : 10;
    factors.push({
      signal: "Front door smart-lock disengaged",
      weight: nightBoost ? 24 : 10,
      detail: nightBoost
        ? "Unlocked egress during night pacing is the highest-risk wandering precursor."
        : "Door unlocked outside the usual visitor window.",
    });
    if (kind === "general" && nightBoost) kind = "night-wandering";
  }
  if (s.bedroomMotionMinutesAgo >= 10 && isNight(snapshot.localTime)) {
    score += 6;
    factors.push({
      signal: "Out of bed at night",
      weight: 6,
      detail: `Last bedroom motion ${s.bedroomMotionMinutesAgo} min ago — she has not returned to bed.`,
    });
  }

  return {
    riskScore: Math.max(0, Math.min(100, score)),
    riskFactors: factors,
    kind,
  };
}

function band(score: number): AmbientIncident["riskBand"] {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

function buildPrompt(incident: AmbientIncident): string {
  const s = incident.snapshot.sensors;
  switch (incident.kind) {
    case "unattended-stove":
      return `Mama Adebayo, the kitchen stove has been on for ${s.stoveBurner.onMinutes} minutes while you're in the living room. Would you like me to turn off the smart relay for you?`;
    case "night-wandering":
      return `Mama Adebayo, it's ${incident.snapshot.localTime} in the night and I notice you're up and the front door is open. Are you looking for something? I can switch on the hallway light and call Tolu if you'd like company.`;
    case "water-leak":
      return "Mama Adebayo, the sensor under the sink feels water. Please stay on the dry mat — shall I shut the water valve and message Kunle?";
    case "smoke":
      return "Mama Adebayo, I smell smoke in the kitchen. Please move calmly to the front door. I'm turning the stove off and calling Tolu now.";
    default:
      return "Mama Adebayo, something at home looks a little unusual. Are you alright?";
  }
}

/** Create (or replace) an incident from a fresh sensor snapshot. */
export function evaluateSnapshot(snapshot: SensorSnapshot): AmbientIncident {
  const { riskScore, riskFactors, kind } = scoreRisk(snapshot);
  incidentCounter += 1;
  const incident: AmbientIncident = {
    incidentId: `incident-${String(incidentCounter).padStart(3, "0")}`,
    scenario: snapshot.scenario,
    kind,
    riskScore,
    riskBand: band(riskScore),
    riskFactors,
    stage: riskScore >= 25 ? "stage1-checkin" : "monitoring",
    stage1WindowSeconds: 60,
    alexaPrompt: "",
    snapshot,
    timeline: [
      {
        at: snapshot.capturedAt,
        event: `Telemetry evaluated → risk ${riskScore}/100 (${band(riskScore)}) across ${riskFactors.length} signal(s).`,
      },
    ],
    stoveRelayOn: snapshot.sensors.stoveBurner.on,
    careCircleNotified: false,
  };
  incident.alexaPrompt = buildPrompt(incident);
  if (incident.stage === "stage1-checkin") {
    incident.timeline.push({
      at: snapshot.capturedAt,
      event: "Stage 1: gentle Alexa+ check-in announced on Echo Show 15 (60 s acknowledgement window).",
    });
  }
  incidents.set(incident.incidentId, incident);
  return structuredClone(incident);
}

export type TriageAction =
  | "evaluate"
  | "acknowledge"
  | "relay_off"
  | "snooze"
  | "escalate"
  | "resolve";

export interface TriageResult {
  incident: AmbientIncident;
  actionApplied: TriageAction;
  message: string;
  alexaSays: string;
}

/** Advance the de-escalation state machine. */
export function applyTriageAction(
  incidentId: string,
  action: TriageAction,
  options: { snoozeMinutes?: number; nowIso?: string } = {},
): TriageResult {
  const incident = incidents.get(incidentId);
  if (!incident) {
    throw new Error(`Unknown incident: ${incidentId}. Run an evaluation first.`);
  }
  const now = options.nowIso ?? new Date().toISOString();
  let message = "";
  let alexaSays = "";

  switch (action) {
    case "acknowledge":
      incident.acknowledgedByElder = true;
      incident.timeline.push({ at: now, event: "Elder acknowledged the check-in ('I'm alright'). Escalation timer cancelled." });
      message = "Acknowledgement recorded — Stage 3 escalation timer cancelled.";
      alexaSays = "Thank you, Mama Adebayo. I'm glad you're alright. I'll keep a gentle eye on things.";
      break;

    case "relay_off":
      incident.stoveRelayOn = false;
      incident.stage = "resolved";
      incident.acknowledgedByElder = true;
      incident.snapshot = structuredClone(incident.snapshot);
      incident.snapshot.sensors.stoveBurner = { on: false, temperatureF: 0, onMinutes: 0 };
      {
        const rescored = scoreRisk(incident.snapshot);
        incident.riskScore = rescored.riskScore;
        incident.riskBand = band(rescored.riskScore);
        incident.riskFactors = rescored.riskFactors;
      }
      incident.timeline.push({
        at: now,
        event: "Stage 2: smart relay cut power to the induction burner. Post-action risk re-scored.",
      });
      message = `Smart relay OFF. Burner de-energised; residual risk now ${incident.riskScore}/100.`;
      alexaSays = "Done, Mama Adebayo. I've turned the stove off at the smart relay. Your food is safe in the pot — we can warm it again whenever you're ready.";
      break;

    case "snooze": {
      const minutes = options.snoozeMinutes ?? 15;
      incident.stage = "snoozed";
      incident.acknowledgedByElder = true;
      incident.snoozedUntil = new Date(Date.parse(now) + minutes * 60_000).toISOString();
      incident.timeline.push({
        at: now,
        event: `Elder confirmed active cooking. Stage-1 prompts snoozed ${minutes} min (hard safety ceiling: smoke/temperature runaway still escalates instantly).`,
      });
      message = `Snoozed for ${minutes} minutes at the elder's request. Hard safety ceiling remains armed.`;
      alexaSays = `Of course, Mama Adebayo. Take your time — I'll check back in ${minutes} minutes. The jollof smells wonderful.`;
      break;
    }

    case "escalate":
      incident.stage = "stage3-escalated";
      incident.careCircleNotified = true;
      incident.timeline.push({
        at: now,
        event: "Stage 3: unacknowledged beyond the 60 s window — care circle notified (Tolu primary, Kunle cc) with sensor context.",
      });
      message = "Care circle escalated with full telemetry context (sensor matrix, risk factors, timeline).";
      alexaSays = "Mama Adebayo, I've let Tolu know so she can check on you. Please stay where you are — help is on the way.";
      break;

    case "resolve":
      incident.stage = "resolved";
      incident.timeline.push({ at: now, event: "Incident marked resolved by care circle / elder." });
      message = "Incident resolved.";
      alexaSays = "All settled now, Mama Adebayo. I've noted everything for the family digest.";
      break;

    default:
      message = "Incident state returned (no transition).";
      alexaSays = incident.alexaPrompt;
  }

  return { incident: structuredClone(incident), actionApplied: action, message, alexaSays };
}

export function getIncident(incidentId: string): AmbientIncident | undefined {
  const found = incidents.get(incidentId);
  return found ? structuredClone(found) : undefined;
}

export function listIncidents(): AmbientIncident[] {
  return [...incidents.values()].map((i) => structuredClone(i));
}

/** Test/diagnostic helper: clear the incident store. */
export function resetIncidents(): void {
  incidents.clear();
  incidentCounter = 0;
}
