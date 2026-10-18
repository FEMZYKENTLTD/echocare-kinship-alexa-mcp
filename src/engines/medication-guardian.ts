/**
 * Geriatric Pharmacology & Beers Criteria Interaction Engine
 * ===========================================================
 * A deterministic rules engine over a curated drug knowledge base. It checks a
 * requested (often over-the-counter) medicine against the elder's active
 * prescription schedule and returns BLOCK / CAUTION / APPROVE with the
 * mechanism, modeled relative risk, AGS Beers Criteria flags, anticholinergic
 * burden (ACB) accounting, and physician-preferred alternatives.
 *
 * Educational simulation of well-documented geriatric interactions — not a
 * substitute for a pharmacist or physician.
 */

export interface ActiveMedication {
  drug: string;
  brand?: string;
  dose: string;
  schedule: string;
  purpose: string;
}

export type Severity = "CRITICAL" | "SEVERE" | "MODERATE" | "LOW";
export type Verdict = "BLOCK" | "CAUTION" | "APPROVE";

export interface InteractionFinding {
  pair: [string, string];
  severity: Severity;
  severityScore: number; // 0–10
  mechanism: string;
  clinicalEffect: string;
  relativeRisk?: string;
  beersCriteria?: string;
  recommendation: string;
}

export interface MedicationAssessment {
  requestedMedication: string;
  requestedClass: string;
  requestedDoseText?: string;
  verdict: Verdict;
  headline: string;
  plainLanguageExplanation: string;
  interactions: InteractionFinding[];
  beersFlags: string[];
  anticholinergicBurden: {
    current: number;
    withRequested: number;
    /** ACB ≥ 3 is the clinically significant threshold. */
    threshold: 3;
    exceedsThreshold: boolean;
  };
  safeAlternatives: Array<{ option: string; rationale: string }>;
  confirmationBlocked: boolean;
}

interface DrugFact {
  canonical: string;
  aliases: string[];
  /** Pharmacologic class tags the rules engine reasons over. */
  classes: string[];
  acb: number; // Anticholinergic Cognitive Burden 0–3
  blurb: string;
}

export const DRUG_KNOWLEDGE: DrugFact[] = [
  { canonical: "Apixaban", aliases: ["apixaban", "eliquis"], classes: ["anticoagulant", "doac"], acb: 0, blurb: "Direct factor Xa inhibitor for stroke prevention in atrial fibrillation." },
  { canonical: "Warfarin", aliases: ["warfarin", "coumadin"], classes: ["anticoagulant"], acb: 0, blurb: "Vitamin K antagonist anticoagulant." },
  { canonical: "Lisinopril", aliases: ["lisinopril", "zestril", "prinivil"], classes: ["ace-inhibitor"], acb: 0, blurb: "ACE inhibitor for blood pressure and renal protection." },
  { canonical: "Metformin", aliases: ["metformin", "glucophage"], classes: ["antidiabetic"], acb: 0, blurb: "First-line biguanide for type 2 diabetes." },
  { canonical: "Donepezil", aliases: ["donepezil", "aricept"], classes: ["cholinesterase-inhibitor"], acb: 0, blurb: "Cholinesterase inhibitor supporting memory in early cognitive decline." },
  { canonical: "Ibuprofen", aliases: ["ibuprofen", "advil", "motrin", "nurofen"], classes: ["nsaid"], acb: 0, blurb: "NSAID pain reliever — impairs platelet function and gastric protection." },
  { canonical: "Naproxen", aliases: ["naproxen", "aleve"], classes: ["nsaid"], acb: 0, blurb: "Long-acting NSAID pain reliever." },
  { canonical: "Diclofenac", aliases: ["diclofenac", "voltaren"], classes: ["nsaid"], acb: 0, blurb: "NSAID used orally and topically (topical systemic exposure is far lower)." },
  { canonical: "Aspirin", aliases: ["aspirin", "asa"], classes: ["nsaid", "antiplatelet"], acb: 0, blurb: "Antiplatelet/NSAID; adds bleeding risk with anticoagulants." },
  { canonical: "Acetaminophen", aliases: ["acetaminophen", "paracetamol", "tylenol", "panadol"], classes: ["analgesic"], acb: 0, blurb: "Non-NSAID analgesic; preferred first-line for osteoarthritis pain in older adults (≤3 g/day in elders)." },
  { canonical: "Clopidogrel", aliases: ["clopidogrel", "plavix"], classes: ["antiplatelet"], acb: 0, blurb: "P2Y12 antiplatelet agent." },
  { canonical: "Tramadol", aliases: ["tramadol", "ultram"], classes: ["opioid-analgesic", "serotonergic"], acb: 1, blurb: "Atypical opioid; Beers-listed for falls, SIADH and delirium risk." },
  { canonical: "Diphenhydramine", aliases: ["diphenhydramine", "benadryl"], classes: ["antihistamine", "anticholinergic"], acb: 3, blurb: "Strongly anticholinergic sedating antihistamine — directly opposes donepezil." },
  { canonical: "Oxybutynin", aliases: ["oxybutynin", "ditropan"], classes: ["anticholinergic"], acb: 3, blurb: "Bladder anticholinergic with high cognitive burden." },
  { canonical: "Hydroxyzine", aliases: ["hydroxyzine", "atarax"], classes: ["antihistamine", "anticholinergic"], acb: 3, blurb: "Sedating anticholinergic anxiolytic." },
  { canonical: "Amitriptyline", aliases: ["amitriptyline", "elavil"], classes: ["tricyclic", "anticholinergic"], acb: 3, blurb: "Tricyclic antidepressant with strong anticholinergic and sedating effects." },
  { canonical: "Omeprazole", aliases: ["omeprazole", "prilosec"], classes: ["ppi"], acb: 0, blurb: "Proton-pump inhibitor for reflux/gastroprotection." },
  { canonical: "Vitamin D3", aliases: ["vitamin d", "vitamin d3", "cholecalciferol"], classes: ["supplement"], acb: 0, blurb: "Bone-health supplement." },
  { canonical: "Ginkgo Biloba", aliases: ["ginkgo", "ginkgo biloba"], classes: ["herbal", "antiplatelet"], acb: 0, blurb: "Herbal supplement with antiplatelet activity." },
];

interface Rule {
  id: string;
  /** Class tags that must be present on each side (order-insensitive). */
  a: string[];
  b: string[];
  severity: Severity;
  severityScore: number;
  mechanism: string;
  clinicalEffect: string;
  relativeRisk?: string;
  beersCriteria?: string;
  recommendation: string;
}

const RULES: Rule[] = [
  {
    id: "doac+nsaid-bleed",
    a: ["anticoagulant"],
    b: ["nsaid"],
    severity: "CRITICAL",
    severityScore: 9.4,
    mechanism:
      "NSAIDs inhibit COX-1 platelet aggregation and strip gastroprotective prostaglandins while the anticoagulant blocks clot formation — a dual hit on haemostasis and gastric mucosa.",
    clinicalEffect:
      "Markedly increased risk of gastrointestinal and internal bleeding, including haemorrhagic stroke.",
    relativeRisk: "≈3.2× increased major GI bleeding risk vs anticoagulant alone (modeled from DOAC cohort data)",
    beersCriteria:
      "AGS Beers Criteria 2023: avoid NSAIDs with oral anticoagulants in adults ≥75 or with bleeding risk unless gastroprotection is provided.",
    recommendation:
      "Do NOT combine. Use Acetaminophen (max 3 g/day in older adults) or topical Diclofenac gel / warm compress for joint pain.",
  },
  {
    id: "ace+nsaid-renal",
    a: ["ace-inhibitor"],
    b: ["nsaid"],
    severity: "SEVERE",
    severityScore: 7.2,
    mechanism:
      "NSAID prostaglandin blockade constricts the afferent arteriole while the ACE inhibitor dilates the efferent — glomerular pressure collapses, especially with any dehydration.",
    clinicalEffect:
      "Acute kidney injury, hyperkalaemia, sodium/fluid retention and loss of blood-pressure control.",
    relativeRisk: "≈1.8× acute kidney injury risk in the first 30 days of combined use (modeled)",
    beersCriteria:
      "AGS Beers Criteria 2023: avoid NSAIDs in stage ≥3 chronic kidney disease; monitor renal function when combined with ACE inhibitors.",
    recommendation:
      "Avoid oral NSAIDs. Prefer Acetaminophen, topical agents, heat therapy and rest.",
  },
  {
    id: "anticoagulant+antiplatelet",
    a: ["anticoagulant"],
    b: ["antiplatelet"],
    severity: "SEVERE",
    severityScore: 7.8,
    mechanism:
      "Dual pathway haemostasis blockade (clotting cascade + platelet aggregation) without a cardiology-directed indication.",
    clinicalEffect: "Increased major and clinically relevant non-major bleeding.",
    recommendation:
      "Only combine antiplatelet + anticoagulant when a cardiologist has explicitly prescribed dual therapy.",
  },
  {
    id: "chei+anticholinergic",
    a: ["cholinesterase-inhibitor"],
    b: ["anticholinergic"],
    severity: "SEVERE",
    severityScore: 7.5,
    mechanism:
      "Direct pharmacodynamic opposition: the anticholinergic blocks the very acetylcholine signalling the cholinesterase inhibitor is prescribed to preserve.",
    clinicalEffect:
      "Cancels the memory benefit of Donepezil; accelerates confusion, delirium and functional decline.",
    beersCriteria:
      "AGS Beers Criteria 2023: avoid strong anticholinergics in dementia/cognitive impairment.",
    recommendation:
      "Avoid. For allergies use a non-sedating antihistamine (e.g., Cetirizine); for sleep, non-drug sleep hygiene first.",
  },
  {
    id: "chei+nsaid-gi",
    a: ["cholinesterase-inhibitor"],
    b: ["nsaid"],
    severity: "MODERATE",
    severityScore: 5.1,
    mechanism:
      "Cholinesterase inhibitors increase gastric acid secretion; NSAIDs erode the mucosal barrier — combined ulcerogenic pressure.",
    clinicalEffect: "Increased peptic ulcer and GI bleeding risk.",
    recommendation: "If an NSAID were ever unavoidable, add a PPI — but prefer non-NSAID analgesia.",
  },
  {
    id: "tramadol-falls",
    a: ["opioid-analgesic"],
    b: ["cholinesterase-inhibitor"],
    severity: "MODERATE",
    severityScore: 5.6,
    mechanism:
      "Tramadol's serotonergic/noradrenergic effects plus sedation raise falls and delirium risk in cognitively vulnerable elders.",
    clinicalEffect: "Falls, fracture risk, hyponatraemia (SIADH), confusion.",
    beersCriteria: "AGS Beers Criteria 2023: avoid Tramadol in older adults where possible (falls/SIADH).",
    recommendation: "Prefer Acetaminophen and physical measures for musculoskeletal pain.",
  },
];

/* -------------------------------------------------------------------------- */
/* Natural-language front end                                                 */
/* -------------------------------------------------------------------------- */

const DOSE_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, extra: 1, double: 2,
};

export function findDrug(text: string): DrugFact | undefined {
  const lower = ` ${text.toLowerCase()} `;
  let best: DrugFact | undefined;
  let bestLen = 0;
  for (const drug of DRUG_KNOWLEDGE) {
    for (const alias of drug.aliases) {
      const aliasLower = alias.toLowerCase();
      if (lower.includes(aliasLower) && aliasLower.length > bestLen) {
        best = drug;
        bestLen = aliasLower.length;
      }
    }
  }
  return best;
}

export function parseRequestedDose(text: string, drugName: string): string | undefined {
  const lower = text.toLowerCase();
  const mgMatch = /(\d{2,4})\s*(mg|milligrams?)/.exec(lower);
  const countMatch = /\b(one|two|three|four|extra|double|\d+)\b\s*(tablets?|pills?|capsules?)?/.exec(lower);
  const count = countMatch
    ? (DOSE_WORDS[countMatch[1]] ?? Number.parseInt(countMatch[1], 10) ?? 1)
    : 1;
  if (mgMatch) return `${mgMatch[1]} mg ${drugName}`;
  return `${count} × tablet(s) of ${drugName}`;
}

/* -------------------------------------------------------------------------- */
/* Assessment                                                                 */
/* -------------------------------------------------------------------------- */

export function assessMedication(
  question: string,
  active: ActiveMedication[],
  elderAge = 74,
): MedicationAssessment {
  const requested = findDrug(question);
  const activeFacts = active
    .map((m) => findDrug(`${m.drug} ${m.brand ?? ""}`))
    .filter((d): d is DrugFact => !!d);

  if (!requested) {
    return {
      requestedMedication: "Unspecified medicine",
      requestedClass: "unknown",
      verdict: "CAUTION",
      headline: "I couldn't identify that medicine — let's check with the pharmacist first.",
      plainLanguageExplanation:
        "EchoCare only confirms medicines it can positively identify against Mama Adebayo's prescription list. Please read the name on the packet, or tap “Alert Daughter & Pharmacist”.",
      interactions: [],
      beersFlags: [],
      anticholinergicBurden: {
        current: activeFacts.reduce((s, d) => s + d.acb, 0),
        withRequested: activeFacts.reduce((s, d) => s + d.acb, 0),
        threshold: 3,
        exceedsThreshold: false,
      },
      safeAlternatives: [
        { option: "Pharmacist identification", rationale: "A 1-tap alert sends the question to Pharm. Eze with the full prescription list." },
      ],
      confirmationBlocked: true,
    };
  }

  const interactions: InteractionFinding[] = [];
  for (const rule of RULES) {
    for (const scheduled of activeFacts) {
      const requestedHitsA = rule.a.some((c) => requested.classes.includes(c));
      const scheduledHitsB = rule.b.some((c) => scheduled.classes.includes(c));
      const requestedHitsB = rule.b.some((c) => requested.classes.includes(c));
      const scheduledHitsA = rule.a.some((c) => scheduled.classes.includes(c));
      if ((requestedHitsA && scheduledHitsB) || (requestedHitsB && scheduledHitsA)) {
        const already = interactions.some(
          (i) => i.pair.includes(requested.canonical) && i.pair.includes(scheduled.canonical) && i.mechanism === rule.mechanism,
        );
        if (!already) {
          interactions.push({
            pair: [requested.canonical, scheduled.canonical],
            severity: rule.severity,
            severityScore: rule.severityScore,
            mechanism: rule.mechanism,
            clinicalEffect: rule.clinicalEffect,
            relativeRisk: rule.relativeRisk,
            beersCriteria: rule.beersCriteria,
            recommendation: rule.recommendation,
          });
        }
      }
    }
  }
  interactions.sort((x, y) => y.severityScore - x.severityScore);

  const beersFlags = [
    ...new Set(
      interactions.flatMap((i) => (i.beersCriteria ? [i.beersCriteria] : [])),
    ),
  ];
  if (requested.classes.includes("nsaid") && elderAge >= 70) {
    beersFlags.push(
      "AGS Beers Criteria 2023: chronic NSAID use in adults ≥70 increases GI bleed, renal and cardiovascular risk — Acetaminophen is first-line for osteoarthritis pain.",
    );
  }

  const currentAcb = activeFacts.reduce((s, d) => s + d.acb, 0);
  const withRequestedAcb = currentAcb + requested.acb;

  const worst = interactions[0];
  let verdict: Verdict = "APPROVE";
  if (worst && (worst.severity === "CRITICAL" || worst.severity === "SEVERE")) verdict = "BLOCK";
  else if (worst || withRequestedAcb >= 3) verdict = "CAUTION";
  if (withRequestedAcb >= 3 && requested.acb >= 2) verdict = "BLOCK";

  const doseText = parseRequestedDose(question, requested.canonical);
  const safeAlternatives = buildAlternatives(requested, verdict);

  const headline =
    verdict === "BLOCK"
      ? `STOP — please don't take the ${requested.canonical}, Mama Adebayo.`
      : verdict === "CAUTION"
        ? `Let's be careful with the ${requested.canonical}.`
        : `${requested.canonical} is compatible with your morning medicines.`;

  const plain =
    verdict === "BLOCK" && worst
      ? `${requested.canonical} clashes with your ${worst.pair[1]}. ${worst.clinicalEffect} ${worst.relativeRisk ? `Estimated risk: ${worst.relativeRisk}. ` : ""}I've paused this dose and can suggest a safer option for the pain instead.`
      : verdict === "CAUTION"
        ? `${requested.canonical} needs care alongside your current prescriptions${worst ? ` (${worst.pair[1]}): ${worst.clinicalEffect}` : ""}. Best to confirm with Pharm. Eze first.`
        : `Good news: no significant interaction was found between ${requested.canonical} and ${activeFacts.map((d) => d.canonical).join(", ")}. You may take it as directed on the packet.`;

  return {
    requestedMedication: requested.canonical,
    requestedClass: requested.classes.join(" / "),
    requestedDoseText: doseText,
    verdict,
    headline,
    plainLanguageExplanation: plain,
    interactions,
    beersFlags: [...new Set(beersFlags)],
    anticholinergicBurden: {
      current: currentAcb,
      withRequested: withRequestedAcb,
      threshold: 3,
      exceedsThreshold: withRequestedAcb >= 3,
    },
    safeAlternatives,
    confirmationBlocked: verdict !== "APPROVE",
  };
}

function buildAlternatives(
  requested: DrugFact,
  verdict: Verdict,
): MedicationAssessment["safeAlternatives"] {
  if (requested.classes.includes("nsaid")) {
    return [
      {
        option: "Acetaminophen 500 mg (max 3 g/day)",
        rationale: "First-line for knee osteoarthritis in older adults; no antiplatelet or renal prostaglandin effect, so it is safe with Apixaban and Lisinopril.",
      },
      {
        option: "Warm compress + gentle knee elevation",
        rationale: "Physical measures ease osteoarthritic stiffness with zero drug-interaction risk.",
      },
      {
        option: "Topical Diclofenac gel (pharmacist-confirmed)",
        rationale: "Systemic absorption is ~6% of oral dosing — far lower bleeding/renal exposure than oral Ibuprofen.",
      },
    ];
  }
  if (requested.classes.includes("anticholinergic")) {
    return [
      { option: "Cetirizine 10 mg (non-sedating antihistamine)", rationale: "Minimal anticholinergic burden; does not oppose Donepezil." },
      { option: "Non-drug sleep routine", rationale: "Warm drink, dim lights, and the evening radio drama avoid delirium risk entirely." },
    ];
  }
  if (verdict === "APPROVE") {
    return [
      { option: "Proceed as directed on the packet", rationale: "No significant interaction detected against the active schedule." },
    ];
  }
  return [
    { option: "Confirm with Pharm. Eze (1-tap alert)", rationale: "Sends the exact question plus the full prescription list to the pharmacist." },
  ];
}
