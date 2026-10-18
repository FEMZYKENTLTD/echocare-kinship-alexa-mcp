# 🫶 EchoCare Kinship — Alexa+ MCP 2025-11-25 Guardian

**Proactive Aging-in-Place, Cognitive Biomarker & Medication Guardian for Alexa+**

> *Mama Adebayo, 74, lives independently in Lagos. EchoCare Kinship turns her Echo Show 15 into a warm companion that quietly screens her speech for early cognitive drift, blocks dangerous medication combinations before she swallows them, calmly resolves home-safety anomalies, and keeps her family in the loop — all over a self-hosted **MCP `2025-11-25` Streamable HTTP** server with interactive **MCP Apps (`ui://`)**, an **Agent Skill (`SKILL.md`)**, and an **AWS Bedrock + Strands-style multi-agent pipeline**.*

Built for the **"Build, Ship, Shape: Amazon Developer Hackathon"** —
🎯 **Alexa+ Track** · 🧰 **Open Source Mini-Challenge** ([`alexa-mcp-2025-kit`](https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit)) · ☁️ **AWS Builder Mini-Challenge**

---

## ⚡ 1-Command Quickstart (zero keys, zero build step)

```bash
npm install && npm start
```

Then open **http://localhost:3000** — the simulated **Alexa+ Echo Show 15** with a live **Judge & Protocol Inspector**. Press **▶ Auto-Play 90s Hackathon Demo** and watch the whole story, or tap any of the 4 scenario pills.

```bash
npm test        # 25 automated tests: engines, kit, live wire, 8/8 audit
npm run build   # optional: compile kit + app to dist/ (npm run start:built)
```

Node ≥ 20. No AWS keys needed — Bedrock runs in a seamless deterministic simulation until you set `AWS_ACCESS_KEY_ID` (see [Going live on AWS](#-going-live-on-aws-bedrock)).

---

## 🎬 What you'll see (the 4 profound tools)

Every tool is a real MCP tool on `/mcp` bound to an interactive `ui://` MCP App card rendered **inside the Echo Show frame**. Card buttons fire genuine follow-up `tools/call` requests through the MCP Apps `postMessage` bridge.

| # | MCP Tool | MCP App view | Engine | The moment that matters |
|---|----------|--------------|--------|--------------------------|
| 🧠 1 | `analyze_cognitive_checkin` | `ui://echocare/memory-lane` | **Linguistic & Cognitive Biomarker Engine** — MATTR lexical diversity, pronoun-to-noun drift (anomia signal), word-finding pause latency, idea density, orientation index, 7-day longitudinal z-score drift alert | A warm wedding-day reminiscence is scored against Mama Adebayo's *own* baseline; the "early-drift sample" shows vague *"that thing"* speech detected |
| 💊 2 | `verify_medication_safety` | `ui://echocare/med-guardian` | **Geriatric Pharmacology & AGS Beers Criteria Engine** — drug–drug interaction rules with mechanisms & modeled relative risk, anticholinergic burden (ACB) | *"Can I take two Advil?"* → **BLOCKED**: Ibuprofen+Apixaban **CRITICAL ≈3.2× GI-bleed**, +Lisinopril **SEVERE** renal, +Donepezil **MODERATE** — safe Acetaminophen offered & confirmable |
| 🔥 3 | `triage_ambient_anomaly` | `ui://echocare/safety-shield` | **Ambient Multi-Sensor Triage** — weighted risk model + **3-stage calm de-escalation state machine** | Stove 375°F × 28 min, no kitchen motion → gentle check-in (60 s window) → one tap cuts the smart relay → risk re-scored to ~0, no family alarm needed |
| 👨‍👩‍👧 4 | `dispatch_care_circle_digest` | `ui://echocare/care-circle` | **AWS Bedrock Runtime + Strands-style agents** — CognitiveAnalyst → MedicationGuardian → SafetyTriageOfficer → DigestComposer | The whole day becomes one Peace-of-Mind digest for Tolu, Kunle & Dr. Okafor, with a live agent reasoning trace |

Also exposed: **3 prompts** (`morning_checkin_coach`, `medication_safety_conversation`, `caregiver_handoff_brief`), and the **SKILL.md itself as an MCP resource** (`skill://echocare-kinship/SKILL.md`).

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Echo Show 15 Simulator (public/)  — a REAL browser MCP client + Apps host │
│  • Fetch/SSE JSON-RPC client   • MCP Apps postMessage bridge              │
│  • Judge Inspector: wire log · 1-click audit · SKILL.md/Bedrock trace     │
└───────────────▲───────────────────────────────────────────────────────────┘
                │  Streamable HTTP /mcp  (POST · GET SSE · DELETE)
                │  MCP-Protocol-Version: 2025-11-25 · MCP-Session-Id
┌───────────────┴───────────────────────────────────────────────────────────┐
│  alexa-mcp-2025-kit guard (packages/alexa-mcp-2025-kit — synced OSS copy) │
│  Origin 403 · Protocol-Version 400 · session registry · SSE event store   │
│  event ids "<sessionId>:<seq>" + Last-Event-ID replay                     │
├───────────────────────────────────────────────────────────────────────────┤
│  McpServer (@modelcontextprotocol/sdk)  +  ext-apps registerAppTool       │
│  ┌────────────────┬────────────────┬───────────────┬───────────────────┐  │
│  │ cognitive      │ medication     │ ambient       │ care-circle       │  │
│  │ biomarkers     │ guardian       │ triage        │ digest            │  │
│  │ (MATTR…)       │ (Beers, ACB)   │ (state mach.) │ (Strands agents)  │  │
│  └────────────────┴────────────────┴───────────────┴────────┬──────────┘  │
│                                        AWS Bedrock Runtime  │ Converse    │
│                                        (live w/ keys, else  │ API         │
│                                         deterministic sim)  │             │
├───────────────────────────────────────────────────────────────────────────┤
│  Agent Skill: skills/echocare-kinship/SKILL.md (loaded at boot by kit)    │
└───────────────────────────────────────────────────────────────────────────┘
```

**Runtime technology hooks (imported *and executed*, per hackathon rules):**
`@modelcontextprotocol/sdk` (McpServer + StreamableHTTPServerTransport) ·
`@modelcontextprotocol/ext-apps/server` (`registerAppTool`/`registerAppResource`, `RESOURCE_MIME_TYPE`) ·
`@aws-sdk/client-bedrock-runtime` (`BedrockRuntimeClient`, `ConverseCommand`) ·
`alexa-mcp-2025-kit` (`createStreamableHttp2025Guard`, `defineAlexaMcpAppTool`, `loadAgentSkillManifest`, `runMcp2025ComplianceAudit`).

---

## 🧰 Open Source Mini-Challenge — `alexa-mcp-2025-kit`

Our companion open-source toolkit is **[github.com/FEMZYKENTLTD/alexa-mcp-2025-kit](https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit)** — a reusable library for building Alexa+ MCP `2025-11-25` servers: the Streamable HTTP guard (Origin/protocol/session/SSE-resumability), the MCP-Apps tool binder, the `SKILL.md` manifest loader, and the 8-point live compliance audit.

**How this repo consumes it (synchronization rule):** to guarantee `npm install && npm start` works 100% autonomously, the kit is vendored as a synced local workspace module at [`packages/alexa-mcp-2025-kit`](packages/alexa-mcp-2025-kit) (pre-built `dist/` committed) and referenced from the root [`package.json`](package.json) as:

```json
"alexa-mcp-2025-kit": "file:./packages/alexa-mcp-2025-kit"
```

The **✅ 2025-11-25 Audit** tab in the UI runs the kit's `runMcp2025ComplianceAudit()` live against this server — the toolkit proving the product, in public, on stage.

---

## ☁️ AWS Builder Mini-Challenge — Bedrock + Strands

[`src/agent/aws-bedrock-strands.ts`](src/agent/aws-bedrock-strands.ts) implements a Strands-style agent graph (specialized agents, system prompts, shared session state, typed tools = our deterministic engines). The **DigestComposer** node calls **Amazon Bedrock** via `BedrockRuntimeClient` + `ConverseCommand`.

### Going live on AWS Bedrock

```bash
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1
# optional: export BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-5-20250929-v1:0
npm start   # digest now reports mode: aws-bedrock-live with token usage in the trace
```

With no keys (judges' default) the identical pipeline synthesizes deterministically and honestly reports `aws-bedrock-simulated` in `/health`, the UI badge, and every digest payload.

---

## 🔌 Connect your own MCP client

**MCP Inspector**

```bash
npx @modelcontextprotocol/inspector   # → Streamable HTTP → http://localhost:3000/mcp
```

**Raw wire (curl)** — full session lifecycle:

```bash
# 1) Initialize (note the MCP-Session-Id + SSE ids "<session>:1", ":2")
curl -i -X POST localhost:3000/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# 2) Call a tool with the session + protocol headers
curl -X POST localhost:3000/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'MCP-Session-Id: <SESSION>' -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"verify_medication_safety","arguments":{"question":"can I take two Advil with my morning pills?"}}}'

# 3) Terminate → subsequent calls return 404
curl -X DELETE localhost:3000/mcp -H 'MCP-Session-Id: <SESSION>' -H 'MCP-Protocol-Version: 2025-11-25'
```

Try the guardrails: `MCP-Protocol-Version: 1999-01-01` → **400**; header `X-Simulate-Untrusted-Origin: https://evil.example` → **403**; `GET /mcp` with `Last-Event-ID: <session>:2` → missed SSE events **replay**.

---

## 📂 Project structure

```
echocare-kinship-alexa-mcp/
├── skills/echocare-kinship/SKILL.md     # Agent Skill manifest (loaded at boot)
├── packages/alexa-mcp-2025-kit/         # synced OSS toolkit (github.com/FEMZYKENTLTD/alexa-mcp-2025-kit)
│   └── src/index.ts                     # guard · ui binder · skill loader · audit
├── src/
│   ├── server/
│   │   ├── index.ts                     # Express + /mcp Streamable HTTP + REST + static
│   │   ├── state.ts                     # longitudinal day-state shared by tools
│   │   └── tools/                       # 4 domain tools + ui:// views + prompts
│   ├── engines/                         # the real algorithms
│   │   ├── cognitive-biomarkers.ts      # MATTR, pronoun drift, idea density, z-drift
│   │   ├── medication-guardian.ts       # Beers-criteria DDI rules + ACB scoring
│   │   └── ambient-triage.ts            # risk model + 3-stage de-escalation machine
│   ├── agent/aws-bedrock-strands.ts     # BedrockRuntimeClient + Strands agent graph
│   └── data/elder-profile.ts            # Mama Adebayo profile, meds, baselines, sensors
├── public/                              # Echo Show 15 simulator + Judge Inspector
├── tests/echocare-mcp.test.ts           # 25 tests (node:test)
├── DEVPOST_SUBMISSION.md                # complete copy-paste Devpost answers
└── LICENSE                              # MIT
```

---

## 🛡️ Safety, privacy & honesty notes

- EchoCare produces **wellness screening signals against a personal baseline — never diagnoses**. The UI, SKILL.md guardrails, and every payload say so; blocked medications always route to a pharmacist/physician path.
- Family see trends and digests, not verbatim transcripts, unless the elder taps **Save to Family Album**.
- Demo data is deterministic and modeled (risk multipliers are labeled "modeled"). Swap in real device telemetry, pharmacy feeds, and FHIR export behind the same tool contracts.

---

## 👥 For hackathon judges (private-repo evaluation)

If this repository is private during judging, access has been granted to **`testing@devpost.com`** and to GitHub users **`chris-trag`**, **`knmeiss`**, **`giolaq`**, **`anishamalde`**, **`mosesroth`**, **`emersonsklar`** (Settings → Collaborators). To evaluate:

```bash
git clone https://github.com/FEMZYKENTLTD/echocare-kinship-alexa-mcp.git
cd echocare-kinship-alexa-mcp
npm install && npm test && npm start   # → http://localhost:3000, press ▶ Auto-Play
```

Submission answers, product feedback, friction log, feature requests, and the timed **2-minute demo voiceover script** are in [`DEVPOST_SUBMISSION.md`](DEVPOST_SUBMISSION.md).

## 📜 License

MIT © OLUFEMI BENUA KERIPE (FEMZYKENTLTD) — see [`LICENSE`](LICENSE).
