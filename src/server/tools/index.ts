/**
 * EchoCare tool registry — binds the 4 domain tools to their MCP App views
 * using the open-source `alexa-mcp-2025-kit` binder + the official
 * `@modelcontextprotocol/ext-apps` registration helpers.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  MCP_APP_MIME_TYPE,
  defineAlexaMcpAppTool,
} from "alexa-mcp-2025-kit";

import { careCircleHtml, medGuardianHtml, memoryLaneHtml, safetyShieldHtml } from "./views.js";
import {
  cognitiveCheckinInputSchema,
  runCognitiveCheckin,
  type CognitiveCheckinArgs,
} from "./cognitive-checkin.js";
import {
  medicationSafetyInputSchema,
  runMedicationSafety,
  type MedicationSafetyArgs,
} from "./medication-safety.js";
import {
  ambientTriageInputSchema,
  runAmbientTriage,
  type AmbientTriageArgs,
} from "./ambient-triage-tool.js";
import {
  careCircleInputSchema,
  runCareCircleDigest,
  type CareCircleArgs,
} from "./care-circle-digest.js";

/**
 * Runtime proof the kit and ext-apps agree on the MCP Apps wire format.
 * (If a future SDK changes the profile string, boot fails loudly, not silently.)
 */
export function assertMcpAppsInterop(): void {
  if (RESOURCE_MIME_TYPE !== MCP_APP_MIME_TYPE) {
    throw new Error(
      `MCP Apps MIME mismatch: ext-apps=${RESOURCE_MIME_TYPE} vs alexa-mcp-2025-kit=${MCP_APP_MIME_TYPE}`,
    );
  }
}

interface ToolExtra {
  sendNotification?: (notification: {
    method: "notifications/message";
    params: { level: "info"; logger: string; data: Record<string, unknown> };
  }) => Promise<void>;
  sessionId?: string;
}

/**
 * Wrap a domain handler so each tools/call emits logging notifications before
 * and after execution. Besides observability this guarantees every POST SSE
 * stream carries multiple sequential events — exactly what Last-Event-ID
 * resumability needs (and what compliance check #7 proves live).
 */
function withToolTelemetry<TArgs>(
  toolName: string,
  fn: (args: TArgs) => Promise<{ text: string; structuredContent: Record<string, unknown> }> | { text: string; structuredContent: Record<string, unknown> },
) {
  return async (args: TArgs, extra: ToolExtra) => {
    const notify = async (phase: string, extraData: Record<string, unknown> = {}) => {
      try {
        await extra.sendNotification?.({
          method: "notifications/message",
          params: {
            level: "info",
            logger: "echocare-kinship",
            data: { tool: toolName, phase, ...extraData },
          },
        });
      } catch {
        /* logging must never fail a tool call */
      }
    };
    const t0 = performance.now();
    await notify("start");
    const out = await fn(args ?? ({} as TArgs));
    await notify("complete", { latencyMs: Math.round(performance.now() - t0) });
    return {
      content: [{ type: "text" as const, text: out.text }],
      structuredContent: out.structuredContent,
    };
  };
}

export const TOOL_NAMES = [
  "analyze_cognitive_checkin",
  "verify_medication_safety",
  "triage_ambient_anomaly",
  "dispatch_care_circle_digest",
] as const;

export function registerEchoCareTools(server: McpServer): void {
  assertMcpAppsInterop();

  /* -- 1. Cognitive check-in → ui://echocare/memory-lane ------------------ */
  const cognitive = defineAlexaMcpAppTool<CognitiveCheckinArgs, unknown>({
    name: "analyze_cognitive_checkin",
    title: "Morning Memory & Cognitive Check-In",
    description:
      "Conduct a warm reminiscence check-in and run the Linguistic & Cognitive Biomarker Engine (MATTR lexical diversity, pronoun-to-noun drift, word-finding pause latency, idea density, temporal/autobiographical orientation) against the elder's 7-day personal baseline with early-drift alerting. Renders the Memory Lane card.",
    inputSchema: cognitiveCheckinInputSchema as Record<string, unknown>,
    resourceUri: "ui://echocare/memory-lane",
    viewTitle: "EchoCare Memory Lane",
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: withToolTelemetry("analyze_cognitive_checkin", runCognitiveCheckin) as never,
  });
  registerAppTool(server, cognitive.name, cognitive.toolConfig as never, cognitive.handler as never);
  registerAppResource(server, cognitive.resource.name, cognitive.resource.uri, cognitive.resource.config as never, async () => ({
    contents: [{ uri: cognitive.resource.uri, mimeType: RESOURCE_MIME_TYPE, text: memoryLaneHtml() }],
  }));

  /* -- 2. Medication guardian → ui://echocare/med-guardian ---------------- */
  const medication = defineAlexaMcpAppTool<MedicationSafetyArgs, unknown>({
    name: "verify_medication_safety",
    title: "Medication Safety Guardian",
    description:
      "Check a requested medicine (including OTC like Advil/Ibuprofen) against the elder's active prescriptions (Apixaban, Lisinopril, Metformin, Donepezil) using the Geriatric Pharmacology & AGS Beers Criteria engine. BLOCKS dangerous combinations (e.g., Apixaban + NSAID ≈3.2× GI-bleed risk), accounts anticholinergic burden, and recommends safe alternatives. Renders the Medication Guardian card.",
    inputSchema: medicationSafetyInputSchema as Record<string, unknown>,
    resourceUri: "ui://echocare/med-guardian",
    viewTitle: "EchoCare Medication Guardian",
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: withToolTelemetry("verify_medication_safety", runMedicationSafety) as never,
  });
  registerAppTool(server, medication.name, medication.toolConfig as never, medication.handler as never);
  registerAppResource(server, medication.resource.name, medication.resource.uri, medication.resource.config as never, async () => ({
    contents: [{ uri: medication.resource.uri, mimeType: RESOURCE_MIME_TYPE, text: medGuardianHtml() }],
  }));

  /* -- 3. Ambient triage → ui://echocare/safety-shield -------------------- */
  const triage = defineAlexaMcpAppTool<AmbientTriageArgs, unknown>({
    name: "triage_ambient_anomaly",
    title: "Ambient Home-Safety Triage",
    description:
      "Evaluate multi-sensor smart-home telemetry (stove burner, room motion, door lock, night pacing, leak/smoke) into a 0–100 risk score and drive the calm 3-stage de-escalation state machine: (1) gentle Alexa+ check-in with 60 s window, (2) autonomous smart-relay cutoff, (3) care-circle escalation. Renders the Safety Shield card.",
    inputSchema: ambientTriageInputSchema as Record<string, unknown>,
    resourceUri: "ui://echocare/safety-shield",
    viewTitle: "EchoCare Safety Shield",
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: withToolTelemetry("triage_ambient_anomaly", runAmbientTriage) as never,
  });
  registerAppTool(server, triage.name, triage.toolConfig as never, triage.handler as never);
  registerAppResource(server, triage.resource.name, triage.resource.uri, triage.resource.config as never, async () => ({
    contents: [{ uri: triage.resource.uri, mimeType: RESOURCE_MIME_TYPE, text: safetyShieldHtml() }],
  }));

  /* -- 4. Care-circle digest → ui://echocare/care-circle ------------------ */
  const digest = defineAlexaMcpAppTool<CareCircleArgs, unknown>({
    name: "dispatch_care_circle_digest",
    title: "Family Care Circle Digest (AWS Bedrock)",
    description:
      "Run the AWS Bedrock Runtime + Strands-style multi-agent pipeline (CognitiveAnalyst → MedicationGuardian → SafetyTriageOfficer → DigestComposer) over today's biomarkers, adherence (including prevented interactions), home-safety resolutions, hydration and sleep to compose the Family Care Circle handoff digest with a Peace-of-Mind score. Renders the Care Circle board.",
    inputSchema: careCircleInputSchema as Record<string, unknown>,
    resourceUri: "ui://echocare/care-circle",
    viewTitle: "EchoCare Family Care Circle",
    annotations: { readOnlyHint: false, openWorldHint: true },
    handler: withToolTelemetry("dispatch_care_circle_digest", runCareCircleDigest) as never,
  });
  registerAppTool(server, digest.name, digest.toolConfig as never, digest.handler as never);
  registerAppResource(server, digest.resource.name, digest.resource.uri, digest.resource.config as never, async () => ({
    contents: [{ uri: digest.resource.uri, mimeType: RESOURCE_MIME_TYPE, text: careCircleHtml() }],
  }));
}

/* -------------------------------------------------------------------------- */
/* Prompts                                                                    */
/* -------------------------------------------------------------------------- */

export function registerEchoCarePrompts(server: McpServer): void {
  server.registerPrompt(
    "morning_checkin_coach",
    {
      title: "Morning Check-In Coach",
      description: "Guide a warm reminiscence check-in that doubles as cognitive-biomarker screening.",
      argsSchema: {
        elderName: z.string().default("Mama Adebayo").describe("Care recipient's name/honorific"),
        theme: z.string().default("a celebration day").describe("Reminiscence theme, e.g. childhood home, wedding day, first job"),
      },
    },
    ({ elderName, theme }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are Alexa+ running the EchoCare Kinship skill. Greet ${elderName} warmly, then invite one reminiscence about ${theme}. Ask ONE open question, listen without interrupting, and celebrate every specific name, place and detail she recalls. When she finishes, call analyze_cognitive_checkin with the verbatim transcript and per-turn latencies. Never mention scores or testing — this must feel like family conversation, not assessment. If the drift level is "watch" or "early-drift", gently suggest water and rest and let the digest inform the family.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "medication_safety_conversation",
    {
      title: "Medication Safety Conversation",
      description: "Safely handle an elder's request for an extra or OTC medicine.",
      argsSchema: {
        requestedMedicine: z.string().describe("The medicine the elder asked about, e.g. two Advil (Ibuprofen)"),
      },
    },
    ({ requestedMedicine }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `The elder just asked whether she can take ${requestedMedicine}. BEFORE answering, call verify_medication_safety with her exact question. If the verdict is BLOCK: lead with a calm, clear "please don't take that one", give the plain-language reason in one sentence, offer the top safe alternative, and offer to alert her daughter and pharmacist via the card. If CAUTION: explain and suggest confirming with the pharmacist. If APPROVE: confirm and proceed to log the dose with action=confirm_dose. Never override a BLOCK.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "caregiver_handoff_brief",
    {
      title: "Caregiver Handoff Brief",
      description: "Prepare the end-of-day family handoff from today's EchoCare telemetry.",
      argsSchema: {
        audience: z
          .enum(["family", "clinician"])
          .default("family")
          .describe("family = warm digest; clinician = structured summary export"),
      },
    },
    ({ audience }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              audience === "clinician"
                ? "Call dispatch_care_circle_digest with action=export to generate the structured clinical handoff (biomarkers vs baseline, adherence log, prevented adverse drug events, resolved home anomalies). Present it verbatim; add no diagnoses."
                : "Call dispatch_care_circle_digest with action=compose to run the AWS Bedrock + Strands multi-agent pipeline, preview the digest with the Peace-of-Mind score, then ask permission and call action=send to deliver it to Tolu, Kunle and Dr. Okafor.",
          },
        },
      ],
    }),
  );
}
