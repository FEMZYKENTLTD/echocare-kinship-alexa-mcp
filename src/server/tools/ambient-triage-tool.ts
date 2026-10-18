/**
 * Tool 3 — triage_ambient_anomaly → ui://echocare/safety-shield
 * Multi-sensor smart-home telemetry triage + 3-stage de-escalation machine.
 */
import { z } from "zod";
import {
  applyTriageAction,
  evaluateSnapshot,
  getIncident,
  type SensorSnapshot,
  type TriageAction,
} from "../../engines/ambient-triage.js";
import {
  DEMO_NIGHT_SNAPSHOT,
  DEMO_STOVE_SNAPSHOT,
} from "../../data/elder-profile.js";
import { dayState } from "../state.js";

export const ambientTriageInputSchema = {
  action: z
    .enum(["evaluate", "acknowledge", "relay_off", "snooze", "escalate", "resolve"])
    .default("evaluate")
    .describe("evaluate = score a sensor snapshot; the rest advance the de-escalation state machine"),
  incidentId: z
    .string()
    .optional()
    .describe("Incident id returned by a prior evaluate call (defaults to the latest open incident)."),
  scenario: z
    .enum(["stove", "night"])
    .optional()
    .describe("Which bundled demo snapshot to evaluate when no raw snapshot is supplied."),
  snoozeMinutes: z.number().optional().describe("Snooze window for the snooze action (default 15)."),
  snapshot: z
    .unknown()
    .optional()
    .describe("Optional raw SensorSnapshot JSON to evaluate instead of the demo snapshots."),
};

export interface AmbientTriageArgs {
  action?: TriageAction;
  incidentId?: string;
  scenario?: "stove" | "night";
  snoozeMinutes?: number;
  snapshot?: SensorSnapshot;
}

function latestOpenIncidentId(): string | undefined {
  return [...dayState.openIncidentIds].pop();
}

export interface AmbientTriageOutput {
  text: string;
  structuredContent: {
    view: string;
    incident: ReturnType<typeof evaluateSnapshot>;
    actionApplied: TriageAction;
    alexaSays: string;
  };
}

export function runAmbientTriage(args: AmbientTriageArgs = {}): AmbientTriageOutput {
  const action: TriageAction = args.action ?? "evaluate";

  if (action === "evaluate") {
    const snapshot =
      args.snapshot ??
      (args.scenario === "night" ? DEMO_NIGHT_SNAPSHOT : DEMO_STOVE_SNAPSHOT);
    const incident = evaluateSnapshot(structuredClone(snapshot));
    if (incident.riskScore >= 25) dayState.openIncidentIds.add(incident.incidentId);
    return {
      text:
        `Ambient triage: ${incident.scenario} scored ${incident.riskScore}/100 (${incident.riskBand}). ` +
        `Stage: ${incident.stage}. Alexa+ check-in: “${incident.alexaPrompt}”`,
      structuredContent: {
        view: "ui://echocare/safety-shield",
        incident,
        actionApplied: "evaluate" as TriageAction,
        alexaSays: incident.alexaPrompt,
      },
    };
  }

  const incidentId = args.incidentId ?? latestOpenIncidentId();
  if (!incidentId || !getIncident(incidentId)) {
    // Nothing to advance — evaluate a fresh demo incident so hosts still work.
    const fresh = runAmbientTriage({ action: "evaluate", scenario: args.scenario });
    return fresh;
  }

  const result = applyTriageAction(incidentId, action, {
    snoozeMinutes: args.snoozeMinutes,
  });

  if (action === "relay_off" || action === "resolve") {
    dayState.openIncidentIds.delete(incidentId);
    const resolution =
      action === "relay_off"
        ? "smart relay cut the burner in Stage 2 after Alexa+ check-in — no family alarm needed"
        : "marked resolved by the care circle";
    if (!dayState.resolvedAnomalies.some((r) => r.scenario === result.incident.scenario)) {
      dayState.resolvedAnomalies.push({ scenario: result.incident.scenario, resolution });
    }
  }

  return {
    text: `Triage ${action}: ${result.message}`,
    structuredContent: {
      view: "ui://echocare/safety-shield",
      incident: result.incident,
      actionApplied: result.actionApplied,
      alexaSays: result.alexaSays,
    },
  };
}
