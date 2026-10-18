/**
 * Tool 2 — verify_medication_safety → ui://echocare/med-guardian
 * Geriatric Pharmacology & Beers Criteria Interaction Engine.
 */
import { z } from "zod";
import { assessMedication } from "../../engines/medication-guardian.js";
import { ACTIVE_MEDICATIONS, ELDER } from "../../data/elder-profile.js";
import { adherencePct, dayState } from "../state.js";

export const DEFAULT_QUESTION =
  "Alexa, my knee hurts — can I take two Advil (Ibuprofen) with my morning pills?";

export const medicationSafetyInputSchema = {
  action: z
    .enum(["assess", "confirm_dose", "alert_contacts"])
    .default("assess")
    .describe("assess = interaction check; confirm_dose = log an approved dose; alert_contacts = notify daughter + pharmacist"),
  question: z
    .string()
    .optional()
    .describe("The elder's medication question in natural language, e.g. “can I take two Advil with my morning pills?”"),
};

export interface MedicationSafetyArgs {
  action?: "assess" | "confirm_dose" | "alert_contacts";
  question?: string;
}

export function runMedicationSafety(args: MedicationSafetyArgs = {}) {
  const question = args.question ?? DEFAULT_QUESTION;
  const assessment = assessMedication(question, ACTIVE_MEDICATIONS, ELDER.age);
  dayState.lastMedAssessment = assessment;

  let statusLine = "";
  let confirmationAllowed = assessment.verdict === "APPROVE";
  let alexaSays =
    assessment.verdict === "BLOCK"
      ? `${assessment.headline} ${assessment.plainLanguageExplanation} For the knee, let's use ${assessment.safeAlternatives[0]?.option ?? "a warm compress"} instead.`
      : assessment.verdict === "CAUTION"
        ? `${assessment.headline} ${assessment.plainLanguageExplanation}`
        : `${assessment.headline} ${assessment.plainLanguageExplanation}`;

  if (assessment.verdict === "BLOCK") {
    const top = assessment.interactions[0];
    if (top) {
      const dedupeKey = `${top.pair[0]}+${top.pair[1]}`;
      if (!dayState.preventedInteractions.some((p) => `${p.drug}+${p.interactsWith}` === dedupeKey)) {
        dayState.preventedInteractions.push({
          drug: top.pair[0],
          interactsWith: top.pair[1],
          severity: top.severity,
          at: new Date().toISOString(),
        });
      }
    }
    statusLine = "⛔ Confirmation blocked and the prevented interaction logged to today's safety record.";
  }

  if (args.action === "confirm_dose") {
    if (assessment.verdict === "APPROVE") {
      dayState.dosesConfirmed = Math.min(
        dayState.dosesScheduled,
        dayState.dosesConfirmed + 1,
      );
      const note = `${assessment.requestedMedication} taken as approved + scheduled dose confirmed (${dayState.dosesConfirmed}/${dayState.dosesScheduled})`;
      dayState.doseLog.push({ at: new Date().toISOString(), note });
      statusLine = `✅ Dose confirmed and logged. Adherence today: ${adherencePct()}% (${dayState.dosesConfirmed}/${dayState.dosesScheduled}).`;
      alexaSays = `Well done, Mama Adebayo. I've marked your dose as taken — ${dayState.dosesConfirmed} of ${dayState.dosesScheduled} for today. The ${assessment.requestedMedication} should ease that knee safely.`;
    } else {
      statusLine = `⛔ EchoCare refused to confirm ${assessment.requestedMedication} (${assessment.verdict}). Scheduled medicines are unaffected — choose a safer alternative or tap Alert.`;
      alexaSays = `I can't confirm the ${assessment.requestedMedication}, Mama Adebayo — it isn't safe with your ${assessment.interactions[0]?.pair[1] ?? "prescriptions"}. Your regular medicines are still fine to take.`;
      confirmationAllowed = false;
    }
  }

  if (args.action === "alert_contacts") {
    statusLine = `📤 Alert sent: Tolu (Alexa app + SMS) and Pharm. Eze received the ${assessment.requestedMedication} interaction report (${assessment.verdict}) with the full prescription list.`;
    alexaSays =
      "Done, Mama Adebayo. I've sent Tolu and Pharm. Eze the full details. They'll call you shortly — for now, let's rest that knee with a warm compress.";
  }

  const text =
    `Medication safety: ${assessment.verdict} for ${assessment.requestedMedication}` +
    (assessment.interactions[0]
      ? ` — ${assessment.interactions[0].severity} interaction with ${assessment.interactions[0].pair[1]} (${assessment.interactions[0].relativeRisk ?? assessment.interactions[0].clinicalEffect}).`
      : " — no significant interaction.") +
    (statusLine ? ` ${statusLine}` : "");

  return {
    text,
    structuredContent: {
      view: "ui://echocare/med-guardian",
      question,
      assessment,
      activeMedications: ACTIVE_MEDICATIONS,
      confirmationAllowed,
      statusLine,
      adherence: {
        confirmed: dayState.dosesConfirmed,
        scheduled: dayState.dosesScheduled,
        pct: adherencePct(),
      },
      preventedInteractions: dayState.preventedInteractions,
      alexaSays,
      disclaimer:
        "Educational interaction screening — confirm medication changes with a pharmacist or physician.",
    },
  };
}
