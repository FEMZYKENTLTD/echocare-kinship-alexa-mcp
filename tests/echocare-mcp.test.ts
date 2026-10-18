/**
 * EchoCare Kinship — automated test suite.
 * Verifies the MCP 2025-11-25 Streamable HTTP server, all 4 domain tools,
 * the ui:// MCP App resources, the SKILL.md loader, the kit guard, and the
 * 8-point live compliance audit. Run: `npm test` (Node built-in test runner).
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  MCP_2025_PROTOCOL_VERSION,
  createStreamableHttp2025Guard,
  defineAlexaMcpAppTool,
  loadAgentSkillManifest,
  parseSimpleYaml,
  postMcpJsonRpc,
  runMcp2025ComplianceAudit,
} from "alexa-mcp-2025-kit";

import { startEchoCareServer, type RunningServer } from "../src/server/index.js";
import { resetDayState } from "../src/server/state.js";
import {
  analyzeTranscript,
  assessDrift,
  computeMATTR,
  tokenize,
} from "../src/engines/cognitive-biomarkers.js";
import { assessMedication, findDrug } from "../src/engines/medication-guardian.js";
import {
  applyTriageAction,
  evaluateSnapshot,
  resetIncidents,
} from "../src/engines/ambient-triage.js";
import {
  ACTIVE_MEDICATIONS,
  COGNITIVE_BASELINE_7DAY,
  DEMO_LATENCIES_BRIGHT_MS,
  DEMO_LATENCIES_DRIFT_MS,
  DEMO_NIGHT_SNAPSHOT,
  DEMO_STOVE_SNAPSHOT,
  DEMO_TRANSCRIPT_BRIGHT,
  DEMO_TRANSCRIPT_DRIFT,
  ELDER,
} from "../src/data/elder-profile.js";

/* -------------------------------------------------------------------------- */
/* Engine unit tests                                                          */
/* -------------------------------------------------------------------------- */

describe("Linguistic & Cognitive Biomarker Engine", () => {
  test("MATTR is higher for lexically diverse text and bounded in [0,1]", () => {
    const diverse = computeMATTR(tokenize("the quick brown fox jumps over a lazy dog near rivers ".repeat(8)));
    const repetitive = computeMATTR(tokenize("thing thing thing the the the ".repeat(20)));
    assert.ok(diverse > repetitive, `${diverse} > ${repetitive}`);
    assert.ok(diverse >= 0 && diverse <= 1 && repetitive >= 0 && repetitive <= 1);
  });

  test("bright reminiscence scores steady; word-finding sample triggers early-drift", () => {
    const facts = {
      people: [...ELDER.knownFacts.children, ELDER.knownFacts.lateHusband],
      places: [ELDER.knownFacts.hometown],
    };
    const bright = analyzeTranscript({
      transcript: DEMO_TRANSCRIPT_BRIGHT,
      turnLatenciesMs: DEMO_LATENCIES_BRIGHT_MS,
      expectedFacts: facts,
    });
    const drift = analyzeTranscript({
      transcript: DEMO_TRANSCRIPT_DRIFT,
      turnLatenciesMs: DEMO_LATENCIES_DRIFT_MS,
      expectedFacts: facts,
    });
    assert.ok(bright.compositeScore > drift.compositeScore + 15);
    assert.ok(drift.pronounNounRatio > bright.pronounNounRatio * 2, "pronoun drift ratio rises");
    assert.ok(drift.vagueReferences.includes("thing"));
    assert.ok(bright.orientation.matchedPeople.includes("Tolu"));
    assert.equal(assessDrift(bright, COGNITIVE_BASELINE_7DAY).alertLevel, "steady");
    assert.equal(assessDrift(drift, COGNITIVE_BASELINE_7DAY).alertLevel, "early-drift");
  });
});

describe("Geriatric Medication Guardian Engine", () => {
  test("two Advil against the active schedule → BLOCK with 3 interactions incl. 3.2× GI-bleed", () => {
    const a = assessMedication(
      "Alexa, my knee hurts — can I take two Advil (Ibuprofen) with my morning pills?",
      ACTIVE_MEDICATIONS,
      74,
    );
    assert.equal(a.verdict, "BLOCK");
    assert.equal(a.requestedMedication, "Ibuprofen");
    assert.equal(a.confirmationBlocked, true);
    const pairs = a.interactions.map((i) => i.pair[1]);
    assert.ok(pairs.includes("Apixaban") && pairs.includes("Lisinopril") && pairs.includes("Donepezil"));
    const top = a.interactions[0];
    assert.equal(top.severity, "CRITICAL");
    assert.match(top.relativeRisk ?? "", /3\.2×/);
    assert.ok(a.beersFlags.length >= 2);
    assert.ok(a.safeAlternatives.some((s) => /Acetaminophen/.test(s.option)));
  });

  test("Acetaminophen is APPROVE; Benadryl is BLOCKED by anticholinergic opposition to Donepezil", () => {
    const ok = assessMedication("What about Tylenol instead?", ACTIVE_MEDICATIONS, 74);
    assert.equal(ok.verdict, "APPROVE");
    const bad = assessMedication("Can I take Benadryl to sleep?", ACTIVE_MEDICATIONS, 74);
    assert.equal(bad.verdict, "BLOCK");
    assert.equal(bad.anticholinergicBurden.withRequested, 3);
    assert.equal(bad.anticholinergicBurden.exceedsThreshold, true);
  });

  test("drug lookup is case-insensitive (Lisinopril regression)", () => {
    assert.equal(findDrug("Lisinopril")?.canonical, "Lisinopril");
    assert.equal(findDrug("ELIQUIS")?.canonical, "Apixaban");
  });
});

describe("Ambient Triage Engine", () => {
  test("stove + night snapshots score high; relay_off resolves and re-scores to ~0", () => {
    resetIncidents();
    const stove = evaluateSnapshot(structuredClone(DEMO_STOVE_SNAPSHOT));
    assert.equal(stove.kind, "unattended-stove");
    assert.ok(stove.riskScore >= 50, `risk ${stove.riskScore}`);
    assert.equal(stove.stage, "stage1-checkin");
    assert.match(stove.alexaPrompt, /28 minutes/);

    const resolved = applyTriageAction(stove.incidentId, "relay_off");
    assert.equal(resolved.incident.stage, "resolved");
    assert.equal(resolved.incident.stoveRelayOn, false);
    assert.ok(resolved.incident.riskScore <= 10);

    const night = evaluateSnapshot(structuredClone(DEMO_NIGHT_SNAPSHOT));
    assert.equal(night.kind, "night-wandering");
    assert.ok(night.riskScore >= 40);
    const escalated = applyTriageAction(night.incidentId, "escalate");
    assert.equal(escalated.incident.stage, "stage3-escalated");
    assert.equal(escalated.incident.careCircleNotified, true);
  });
});

/* -------------------------------------------------------------------------- */
/* Kit unit tests                                                             */
/* -------------------------------------------------------------------------- */

describe("alexa-mcp-2025-kit", () => {
  test("protocol constant + session ids are UUIDs", () => {
    assert.equal(MCP_2025_PROTOCOL_VERSION, "2025-11-25");
    const guard = createStreamableHttp2025Guard();
    assert.match(guard.generateSessionId(), /^[0-9a-f-]{36}$/i);
  });

  test("event store ids are <sessionId>:<seq> and replay works", async () => {
    const guard = createStreamableHttp2025Guard();
    const store = guard.createEventStore();
    store.bindSession("sess-123");
    const id1 = await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "a" });
    const id2 = await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "b" });
    assert.equal(id1, "sess-123:1");
    assert.equal(id2, "sess-123:2");
    const replayed: string[] = [];
    await store.replayEventsAfter(id1, { send: async (eid) => { replayed.push(eid); } });
    assert.deepEqual(replayed, ["sess-123:2"]);
  });

  test("defineAlexaMcpAppTool binds ui:// _meta and rejects non-ui URIs", () => {
    const reg = defineAlexaMcpAppTool({
      name: "demo", title: "Demo", description: "d",
      resourceUri: "ui://echocare/demo", handler: () => ({}),
    });
    assert.equal(reg.toolConfig._meta.ui.resourceUri, "ui://echocare/demo");
    assert.equal(reg.toolConfig._meta["ui/resourceUri"], "ui://echocare/demo");
    assert.equal(reg.resource.config.mimeType, "text/html;profile=mcp-app");
    assert.throws(() =>
      defineAlexaMcpAppTool({ name: "x", title: "x", description: "x", resourceUri: "https://x", handler: () => ({}) }),
    );
  });

  test("SKILL.md loader parses frontmatter, tools and guardrails", async () => {
    const skill = await loadAgentSkillManifest(
      join(process.cwd(), "skills", "echocare-kinship", "SKILL.md"),
    );
    assert.equal(skill.name, "echocare-kinship");
    assert.ok(skill.description.length > 40);
    const tools = (skill.frontmatter.tools as Array<{ name: string }>).map((t) => t.name);
    assert.deepEqual(tools, [
      "analyze_cognitive_checkin",
      "verify_medication_safety",
      "triage_ambient_anomaly",
      "dispatch_care_circle_digest",
    ]);
    assert.ok(Array.isArray(skill.frontmatter.guardrails));
    assert.ok(skill.instructions.includes("EchoCare Kinship"));
  });

  test("parseSimpleYaml handles nested maps, lists and scalars", () => {
    const y = parseSimpleYaml("name: x\ncount: 3\nmeta:\n  a: 1\nitems:\n  - one\n  - two\n");
    assert.equal(y.name, "x");
    assert.equal(y.count, 3);
    assert.deepEqual(y.items, ["one", "two"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Live MCP server tests                                                      */
/* -------------------------------------------------------------------------- */

let running: RunningServer;
let base: string;
let mcpUrl: string;
let sessionId: string | undefined;
let rpcId = 0;

async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  rpcId += 1;
  const id = rpcId;
  const resp = await postMcpJsonRpc(
    mcpUrl,
    { jsonrpc: "2.0", id, method, params },
    {
      ...(sessionId
        ? { "mcp-session-id": sessionId, "mcp-protocol-version": MCP_2025_PROTOCOL_VERSION }
        : {}),
      ...headers,
    },
  );
  if (resp.sessionId) sessionId = resp.sessionId;
  const msg = resp.messages.find((m) => m.id === id) ?? resp.messages.at(-1);
  return { resp, result: msg?.result as never, error: msg?.error as never };
}

before(async () => {
  running = await startEchoCareServer(0);
  base = running.url;
  mcpUrl = `${base}/mcp`;
});

after(async () => {
  await running.close();
});

describe("MCP 2025-11-25 server (live wire)", () => {
  test("GET /health reports protocol + simulated Bedrock", async () => {
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { mcpProtocolVersion: string; bedrock: { mode: string } };
    assert.equal(body.mcpProtocolVersion, "2025-11-25");
    assert.ok(["aws-bedrock-live", "aws-bedrock-simulated"].includes(body.bedrock.mode));
  });

  test("initialize negotiates 2025-11-25 and issues a UUID session", async () => {
    const { resp, result } = await rpc("initialize", {
      protocolVersion: MCP_2025_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "echocare-tests", version: "1.0.0" },
    });
    assert.equal(resp.status, 200);
    assert.equal((result as { protocolVersion: string }).protocolVersion, "2025-11-25");
    assert.match(sessionId ?? "", /^[0-9a-f-]{36}$/i);
    await postMcpJsonRpc(mcpUrl, { jsonrpc: "2.0", method: "notifications/initialized" }, {
      "mcp-session-id": sessionId!, "mcp-protocol-version": MCP_2025_PROTOCOL_VERSION,
    });
  });

  test("guard: invalid MCP-Protocol-Version → 400; untrusted origin → 403; no session → 400", async () => {
    const badVer = await postMcpJsonRpc(mcpUrl, { jsonrpc: "2.0", id: 900, method: "tools/list", params: {} }, {
      "mcp-session-id": sessionId!, "mcp-protocol-version": "1999-01-01",
    });
    assert.equal(badVer.status, 400);

    const badOrigin = await postMcpJsonRpc(mcpUrl, { jsonrpc: "2.0", id: 901, method: "tools/list", params: {} }, {
      "mcp-session-id": sessionId!,
      "mcp-protocol-version": MCP_2025_PROTOCOL_VERSION,
      origin: "https://rebinding-attacker.example.com",
      "x-simulate-untrusted-origin": "https://rebinding-attacker.example.com",
    });
    assert.equal(badOrigin.status, 403);

    const noSession = await postMcpJsonRpc(mcpUrl, { jsonrpc: "2.0", id: 902, method: "tools/list", params: {} }, {});
    assert.equal(noSession.status, 400);
  });

  test("tools/list: exactly 4 tools, each bound to its ui:// view", async () => {
    const { result } = await rpc("tools/list");
    const tools = (result as { tools: Array<{ name: string; _meta?: { ui?: { resourceUri?: string } }; inputSchema: unknown }> }).tools;
    assert.equal(tools.length, 4);
    const map = Object.fromEntries(tools.map((t) => [t.name, t._meta?.ui?.resourceUri]));
    assert.deepEqual(map, {
      analyze_cognitive_checkin: "ui://echocare/memory-lane",
      verify_medication_safety: "ui://echocare/med-guardian",
      triage_ambient_anomaly: "ui://echocare/safety-shield",
      dispatch_care_circle_digest: "ui://echocare/care-circle",
    });
    for (const t of tools) assert.ok(t.inputSchema, `${t.name} has inputSchema`);
  });

  test("tool 1: analyze_cognitive_checkin returns biomarkers + drift; save_memory persists", async () => {
    resetDayState();
    const { result } = await rpc("tools/call", {
      name: "analyze_cognitive_checkin",
      arguments: { action: "analyze", sample: "bright" },
    });
    const sc = (result as { structuredContent: never }).structuredContent as {
      report: { compositeScore: number; mattr: number };
      drift: { alertLevel: string; sparkline: unknown[] };
    };
    assert.ok(sc.report.compositeScore >= 75);
    assert.ok(sc.report.mattr > 0.6);
    assert.equal(sc.drift.alertLevel, "steady");
    assert.equal(sc.drift.sparkline.length, 8); // 7 baseline days + today

    const saved = await rpc("tools/call", {
      name: "analyze_cognitive_checkin",
      arguments: { action: "save_memory", sample: "bright" },
    });
    assert.equal((saved.result as { structuredContent: { savedToAlbum: boolean } }).structuredContent.savedToAlbum, true);
  });

  test("tool 2: Advil blocked over the wire; Tylenol confirmed, adherence increments", async () => {
    resetDayState();
    const blocked = await rpc("tools/call", {
      name: "verify_medication_safety",
      arguments: { action: "assess", question: "can I take two Advil with my morning pills?" },
    });
    const bsc = (blocked.result as { structuredContent: never }).structuredContent as {
      assessment: { verdict: string }; confirmationAllowed: boolean;
    };
    assert.equal(bsc.assessment.verdict, "BLOCK");
    assert.equal(bsc.confirmationAllowed, false);

    const before = (bsc as unknown as { adherence: { confirmed: number } }).adherence.confirmed;
    const confirmed = await rpc("tools/call", {
      name: "verify_medication_safety",
      arguments: { action: "confirm_dose", question: "What about Tylenol instead?" },
    });
    const csc = (confirmed.result as { structuredContent: never }).structuredContent as {
      adherence: { confirmed: number }; statusLine: string;
    };
    assert.equal(csc.adherence.confirmed, before + 1);
    assert.match(csc.statusLine, /Dose confirmed/);
  });

  test("tool 3: stove evaluation → stage1-checkin; relay_off resolves", async () => {
    resetIncidents(); resetDayState();
    const ev = await rpc("tools/call", {
      name: "triage_ambient_anomaly",
      arguments: { action: "evaluate", scenario: "stove" },
    });
    const incident = (ev.result as { structuredContent: { incident: { incidentId: string; stage: string; riskScore: number } } }).structuredContent.incident;
    assert.equal(incident.stage, "stage1-checkin");
    assert.ok(incident.riskScore >= 50);

    const off = await rpc("tools/call", {
      name: "triage_ambient_anomaly",
      arguments: { action: "relay_off", incidentId: incident.incidentId },
    });
    const after = (off.result as { structuredContent: { incident: { stage: string; stoveRelayOn: boolean } } }).structuredContent.incident;
    assert.equal(after.stage, "resolved");
    assert.equal(after.stoveRelayOn, false);
  });

  test("tool 4: Bedrock/Strands digest has 4 agent trace steps + peace-of-mind score", async () => {
    const { result } = await rpc("tools/call", {
      name: "dispatch_care_circle_digest",
      arguments: { action: "compose" },
    });
    const sc = (result as { structuredContent: never }).structuredContent as {
      digest: {
        trace: Array<{ agent: string; runtime: string }>;
        peaceOfMindScore: number;
        narrative: string;
        mode: string;
      };
      careCircle: unknown[];
    };
    assert.equal(sc.digest.trace.length, 4);
    assert.deepEqual(sc.digest.trace.map((t) => t.agent), [
      "CognitiveAnalyst", "MedicationGuardian", "SafetyTriageOfficer", "DigestComposer",
    ]);
    assert.ok(sc.digest.trace[3].runtime.startsWith("aws-bedrock"));
    assert.ok(sc.digest.peaceOfMindScore >= 5 && sc.digest.peaceOfMindScore <= 99);
    assert.ok(sc.digest.narrative.includes("Mama Adebayo"));
    assert.equal(sc.careCircle.length, 4);
  });

  test("resources: 4 ui:// HTML apps (mcp-app mime, bridge inside) + skill resource", async () => {
    const list = await rpc("resources/list");
    const resources = (list.result as { resources: Array<{ uri: string; mimeType?: string }> }).resources;
    const ui = resources.filter((r) => r.uri.startsWith("ui://"));
    assert.equal(ui.length, 4);
    for (const r of ui) assert.equal(r.mimeType, "text/html;profile=mcp-app");

    const read = await rpc("resources/read", { uri: "ui://echocare/safety-shield" });
    const content = (read.result as { contents: Array<{ text: string; mimeType: string }> }).contents[0];
    assert.match(content.text, /<html/i);
    assert.match(content.text, /ui\/initialize/); // MCP Apps bridge baked in
    assert.match(content.text, /tools\/call/);

    const skill = await rpc("resources/read", { uri: "skill://echocare-kinship/SKILL.md" });
    const skillText = (skill.result as { contents: Array<{ text: string }> }).contents[0].text;
    assert.match(skillText, /name: echocare-kinship/);
  });

  test("prompts/list + prompts/get render Alexa+ coaching prompts", async () => {
    const list = await rpc("prompts/list");
    const prompts = (list.result as { prompts: Array<{ name: string }> }).prompts;
    assert.deepEqual(prompts.map((p) => p.name).sort(), [
      "caregiver_handoff_brief", "medication_safety_conversation", "morning_checkin_coach",
    ]);
    const got = await rpc("prompts/get", {
      name: "medication_safety_conversation",
      arguments: { requestedMedicine: "two Advil" },
    });
    const text = (got.result as { messages: Array<{ content: { text: string } }> }).messages[0].content.text;
    assert.match(text, /verify_medication_safety/);
    assert.match(text, /Never override a BLOCK/);
  });

  test("8-point compliance audit passes 8/8 against the live server", { timeout: 90_000 }, async () => {
    const report = await runMcp2025ComplianceAudit(mcpUrl);
    const failures = report.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`);
    assert.equal(report.summary.total, 8);
    assert.equal(report.summary.passed, 8, failures.join(" | "));
    assert.equal(report.protocolVersion, "2025-11-25");
  });

  test("DELETE /mcp terminates the session; reuse → 404", async () => {
    const del = await fetch(mcpUrl, {
      method: "DELETE",
      headers: { "mcp-session-id": sessionId!, "mcp-protocol-version": MCP_2025_PROTOCOL_VERSION },
    });
    assert.ok(del.status >= 200 && del.status < 300, `DELETE → ${del.status}`);
    await del.text();
    const after = await postMcpJsonRpc(mcpUrl, { jsonrpc: "2.0", id: 999, method: "tools/list", params: {} }, {
      "mcp-session-id": sessionId!, "mcp-protocol-version": MCP_2025_PROTOCOL_VERSION,
    });
    assert.equal(after.status, 404);
  });
});

describe("Web app + REST surface", () => {
  test("Echo Show simulator is served at / with app.js + styles.css", async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /EchoCare Kinship/);
    assert.match(html, /Auto-Play 90s Hackathon Demo/);
    assert.match(html, /alexa-mcp-2025-kit/);
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /MCP-Protocol-Version/);
    assert.ok(!/localhost:3000/.test(js), "browser code must use relative paths");
    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);
  });

  test("/api/skill + /api/state expose manifest and day telemetry", async () => {
    const skill = (await (await fetch(`${base}/api/skill`)).json()) as { name: string };
    assert.equal(skill.name, "echocare-kinship");
    const state = (await (await fetch(`${base}/api/state`)).json()) as {
      elder: { name: string }; activeMedications: unknown[];
    };
    assert.equal(state.elder.name, "Mama Adebayo");
    assert.equal(state.activeMedications.length, 4);
  });
});
