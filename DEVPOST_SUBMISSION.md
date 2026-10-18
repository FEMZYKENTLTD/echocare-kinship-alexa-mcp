# 📋 Devpost Submission — EchoCare Kinship (copy-paste ready)

*Hackathon: **Build, Ship, Shape: Amazon Developer Hackathon** · Deadline: October 23, 2026*
*Primary repo: https://github.com/FEMZYKENTLTD/echocare-kinship-alexa-mcp*
*Open-source contribution: https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit*
*GitHub username: **FEMZYKENTLTD***

---

## Project Title

**EchoCare Kinship — Proactive Aging-in-Place, Cognitive Biomarker & Medication Guardian for Alexa+**

## Tagline (elevator pitch)

An Alexa+ guardian that turns everyday conversation into early cognitive-drift screening, blocks lethal medication combinations before they're swallowed, calmly defuses home emergencies, and keeps the whole family peacefully in the loop — powered by a self-hosted MCP 2025-11-25 server, MCP Apps, an Agent Skill, and AWS Bedrock agents.

## Primary Track & Mini-Challenges Entered

- ✅ **Primary Track: Alexa+ Track** (self-hosted MCP Server on specification `2025-11-25` over Streamable HTTP + Agent Skill + MCP Apps + simulated Alexa+ Echo Show 15 web app)
- ✅ **Mini-Challenge 1: Open Source Mini-Challenge** — companion repo [`alexa-mcp-2025-kit`](https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit)
- ✅ **Mini-Challenge 2: AWS Builder Mini-Challenge** — `@aws-sdk/client-bedrock-runtime` (Converse) + Strands-style multi-agent orchestration executed at runtime in `src/agent/aws-bedrock-strands.ts`, with a zero-key deterministic simulation fallback

---

## Full Project Description

### 💡 Inspiration

Across Nigeria — and the whole world — adult children move to Lagos, Abuja, London, Houston for work, while their parents insist on aging in the family home. The three things that most often end that independence are silent: **undetected cognitive decline**, **preventable adverse drug events** (an elder on a blood thinner casually taking Advil for knee pain can bleed internally), and **unattended-cooking fires / night wandering**. Existing "elder tech" is either stigmatizing wearables or dumb timers. We asked: what if the Echo Show already sitting in Mama's kitchen could *listen with love, think like a geriatric clinician, and only bother the family when it truly matters* — all through the open MCP standard Alexa+ now speaks?

### 🫶 What it does

**EchoCare Kinship** follows **Mama Adebayo, 74**, living independently in Lagos, through one day guarded by four MCP tools, each bound to an interactive `ui://` MCP App card on her Echo Show 15:

1. **🧠 Morning Memory & Cognitive Check-In** (`analyze_cognitive_checkin` → `ui://echocare/memory-lane`)
   Alexa+ invites a reminiscence ("Tell me about a celebration day…"). Her story runs through a real **Linguistic & Cognitive Biomarker Engine**: MATTR lexical diversity, pronoun-to-noun drift ratio (the *"that thing over there"* anomia signal), word-finding pause latency, idea density, and a temporal/autobiographical orientation index — compared against her **personal 7-day baseline** with z-score early-drift alerting. It feels like family conversation; it is silently longitudinal screening.

2. **💊 Medication Safety Guardian** (`verify_medication_safety` → `ui://echocare/med-guardian`)
   *"Alexa, my knee hurts — can I take two Advil with my morning pills?"* The **Geriatric Pharmacology & AGS Beers Criteria Engine** checks her real schedule (Apixaban 5 mg, Lisinopril 10 mg, Metformin 500 mg, Donepezil 5 mg) and **BLOCKS** the dose: Ibuprofen+Apixaban **CRITICAL ≈3.2× major GI-bleed risk**, +Lisinopril **SEVERE** renal strain, +Donepezil **MODERATE** — with mechanisms, Beers citations, anticholinergic-burden accounting, a safe alternative (Acetaminophen/warm compress), and 1-tap "Alert Daughter & Pharmacist". A prevented adverse drug event, logged.

3. **🔥 Ambient Home-Safety Triage** (`triage_ambient_anomaly` → `ui://echocare/safety-shield`)
   Burner at 375°F for 28 minutes, zero kitchen motion, TV on in the living room → weighted risk score 65/100 and a **3-stage calm de-escalation state machine**: (1) non-startling Alexa+ check-in with a 60-second window, (2) autonomous smart-relay cutoff with re-scored risk ~0, (3) care-circle escalation only if unacknowledged. A night-wandering scenario (02:40 pacing + unlocked door) ships built-in too.

4. **👨‍👩‍👧 Family Care Circle Digest** (`dispatch_care_circle_digest` → `ui://echocare/care-circle`)
   A **Strands-style 4-agent pipeline** (CognitiveAnalyst → MedicationGuardian → SafetyTriageOfficer → DigestComposer) on **AWS Bedrock Runtime** synthesizes the day into a Peace-of-Mind scored digest for daughter **Tolu**, son **Kunle**, and **Dr. Okafor** — including the prevented interaction and the resolved stove incident, with a full agent reasoning trace and a clinical-summary export.

All of this is served by **one self-hosted MCP `2025-11-25` Streamable HTTP server** (`/mcp` POST·GET·DELETE) with cryptographic sessions, `MCP-Protocol-Version` enforcement, Origin/DNS-rebinding protection, and SSE resumability (`<sessionId>:<seq>` event ids + `Last-Event-ID` replay) — proven live by an **8-point compliance audit** in the Judge Inspector tab, powered by our own open-source toolkit.

### 🛠️ How we built it

TypeScript end-to-end. `@modelcontextprotocol/sdk` (`McpServer` + `StreamableHTTPServerTransport`) for the protocol core; `@modelcontextprotocol/ext-apps` `registerAppTool`/`registerAppResource` for the `ui://` MCP Apps; our own open-source **`alexa-mcp-2025-kit`** (vendored at `packages/` via `file:` so `npm install && npm start` is bulletproof) for the 2025-11-25 guard (Origin/version/session/SSE-store), the tool binder, the `SKILL.md` loader (with a dependency-free YAML-subset parser), and the compliance audit. Three deterministic domain engines (biomarkers/medications/triage) sit under the tools; **Amazon Bedrock** (`BedrockRuntimeClient` + `ConverseCommand`) composes the digest narrative when AWS keys are present, with an honest, zero-key deterministic simulation otherwise. The Echo Show 15 simulator is a *real* browser MCP client (fetch + SSE parsing) and a spec-faithful MCP Apps host (postMessage bridge: `ui/initialize`, `ui/notifications/tool-result`, proxied `tools/call`) — the exact `ui://` HTML also renders in Claude/ChatGPT-class hosts. 25 automated tests (node:test) cover engines, kit, the live wire, and the audit (8/8).

### 🧗 Challenges we ran into

- **SDK generational split:** `@modelcontextprotocol/ext-apps@2.x` targets the new split SDK packages (`@modelcontextprotocol/server`) and zod v4, while the Alexa+ track centers `@modelcontextprotocol/sdk` 1.x — we root-caused peer conflicts and pinned the compatible `ext-apps@1.7.5` line (documented in the friction log).
- **SSE resumability semantics:** making event ids literally `<sessionId>:<seq>` required binding the SDK `EventStore` to the session inside the `sessionIdGenerator` callback — a subtle ordering trick now baked into the open-source kit.
- **MCP Apps handshake ordering:** hosts must queue `tool-result` until the iframe finishes `ui/initialize`; our Echo Show host implements that queue (and logs the whole bridge for judges).
- **Clinical realism on a demo budget:** tuning MATTR windows, pronoun-drift ratios and z-score floors so a *bright* day reads ~90/100, a *watch* day ~75, and a word-finding sample trips early-drift without cartoonish numbers — including catching our own case-sensitivity bug (`Lisinopril` vs `Lisinopril`) that briefly hid a SEVERE interaction. Our tests now regression-guard it.

### 🏆 Accomplishments we're proud of

- A **complete** Alexa+ MCP 2025-11-25 surface in one repo: stateful Streamable HTTP, Agent Skill, MCP Apps, prompts, resources (the SKILL.md is itself an MCP resource!), and a dual-screen judge experience with a one-click **90-second auto-demo**.
- **Real algorithms, not mock data:** sliding-window MATTR, Beers-criteria rule engine with ACB scoring, weighted sensor risk + state machine, z-score drift detection.
- **8/8 live compliance** against our own audit — including SSE replay and 404-after-DELETE — executed from the UI in front of judges.
- Two repositories that make each other stronger: the product proves the toolkit; the toolkit audits the product.

### 📚 What we learned

MCP Apps completely changes what a "tool" can be on Alexa+: the tool *is* the interface, and high-contrast, elder-first `ui://` cards with real `tools/call` buttons collapse the distance between voice and action. We also learned that the 2025-11-25 HTTP transport's session/Origin/resumability rules are a genuinely well-designed security posture — once you implement them, DNS-rebinding and session-hijack classes mostly evaporate. And on the care side: the winning UX is *calm* — de-escalation beats alarms.

### 🔭 What's next for EchoCare Kinship

Real Echo Show deployment via Alexa+ developer preview; on-device audio features (prosody, speech-rate) alongside transcript biomarkers; pharmacy/EHR-grade interaction data via FHIR; Ring/Bee integrations for richer ambient telemetry; multi-elder care-circle tenancy; and a clinician-in-the-loop review queue for drift alerts. The kit gets published to npm so every Alexa+ builder inherits the guard + audit.

---

## ✅ Required Product Feedback

### 1) Alexa+ MCP `2025-11-25` Streamable HTTP

**What we used it for:** The entire runtime backbone of EchoCare Kinship — a stateful self-hosted MCP server (`/mcp` POST·GET·DELETE) that Alexa+ (simulated Echo Show 15) talks to for all four guardian tools, with session lifecycle, protocol-version negotiation, Origin validation, and SSE resumability.

**What worked well:** The 2025-11-25 revision's explicit security posture is excellent: mandatory `MCP-Protocol-Version` header validation, `Origin` checking with 403 semantics, and cryptographic `MCP-Session-Id` lifecycle (including clean `DELETE` → 404 behavior) gave us a crisp contract to implement and — just as importantly — to *test*. SSE event-id resumability with `Last-Event-ID` worked exactly as specified once wired through the SDK's `EventStore`, and our audit replays missed events reliably.

**What needs work:** (a) The fallback rule ("absent version header ⇒ assume 2025-03-26") creates ambiguity for servers that want to be strict from the *first* non-initialize request — we had to design our own guard policy. (b) The spec's session-termination story for crashed clients (no DELETE) leaves servers guessing about TTLs. (c) Discoverability of the *exact* header set Alexa+ sends in production (vs. generic MCP clients) would benefit from one canonical conformance page.

**How onboarding/documentation felt:** The MCP spec site is strong, and the TypeScript SDK's `StreamableHTTPServerTransport` maps cleanly onto it. The main gaps were example-level: a per-session `McpServer` + `EventStore` production example (not just stateless demos) would have saved hours. The `X-Simulate-…`-style test hooks we invented for our own audit suggest an official conformance test-suite would be beloved.

**Would we build with it again?** Absolutely — it's the right abstraction for Alexa+ skills that need real backends. We already factored our learnings into the open-source `alexa-mcp-2025-kit` so our next project starts at the finish line.

### 2) MCP Apps (`@modelcontextprotocol/ext-apps` & `ui://` resources) & Agent Skills (`SKILL.md`)

**What we used it for:** Each EchoCare tool renders an interactive elder-first card (Memory Lane, Medication Guardian, Safety Shield, Care Circle) served as a `ui://echocare/*` resource with `text/html;profile=mcp-app`, bound via `_meta.ui.resourceUri`. Our Echo Show simulator is a spec-faithful Apps *host* (postMessage bridge, `ui/initialize`, tool-input/result notifications, proxied `tools/call`). The Agent Skill at `skills/echocare-kinship/SKILL.md` governs tool selection, tone, and safety guardrails, and is loaded at boot and re-served over MCP.

**What worked well:** The `_meta.ui.resourceUri` binding + `registerAppTool`/`registerAppResource` helpers made tool→view wiring almost trivial, and the bridge protocol is small enough to implement a credible host in an afternoon. `SKILL.md`'s frontmatter+markdown format is a delight — our non-engineer caregivers could read and critique the skill. Serving the skill back over `resources/read` made host-side inspection natural.

**What needs work:** (a) Versioning pinball: `ext-apps@2.x` peer-requires the split SDK v2 packages + zod v4 while most examples still show SDK 1.x — installing "latest of everything" fails; we had to discover `ext-apps@1.7.5` is the SDK-1.x-compatible line. This needs a big compatibility matrix at the top of the README. (b) Bridge lifecycle edge cases (tool-result arriving before `ui/initialize` completes; size-changed storms) deserve explicit host guidance. (c) For `SKILL.md`, a tiny official validator/loader in the SDK would prevent every team hand-rolling YAML subsets like we did.

**How onboarding/documentation felt:** ext-apps' generated API docs are thorough once you find the right version; the spec/SEP-1865 narrative is clear. Agent Skills documentation (frontmatter fields, directory convention) was refreshingly concise — though a canonical "what do hosts *do* with each field" table would help.

**Would we build with it again?** Yes — MCP Apps are the single most demo-able, user-visible leap in this stack. For elder care specifically, big tappable cards with real tool actions are transformative. We'd start every future Alexa+ tool with its `ui://` view.

### 3) Amazon Devices Builder Tools MCP Server

**What we used it for:** We used the Builder Tools MCP Server as our orientation layer for the Alexa+ track requirements — validating how a self-hosted MCP server, Agent Skill, and MCP Apps fit the Alexa+ submission shape, and cross-checking the mandatory "required technology at runtime" expectation (imported *and called*, not just named) while structuring `src/server/index.ts`.

**What worked well:** Having an MCP server that answers *about building for the devices* inside the same tooling loop we were developing in (an agent querying it while writing code) is a genuinely good idea — requirements discovery happened in-context instead of across 12 doc tabs. The track-requirement answers were concrete enough to turn into a checklist (which became our README "runtime technology hooks" section and ultimately our test assertions).

**What needs work:** (a) Version pinning guidance: answers referenced "MCP" generically in places where `2025-11-25` specifics (protocol header fallback, session rules) matter — responses should carry spec-version stamps. (b) A machine-checkable "submission readiness" output (structured checklist a CI job could consume) would be far more powerful than prose alone. (c) Code samples for Streamable HTTP *stateful* servers would close the biggest example gap we hit.

**How onboarding/documentation felt:** Connecting an MCP client to it was the standard MCP flow — painless. Discoverability of *which* questions it answers best would improve with a tool-list-first quickstart ("ask me about: tracks, required tech, submission rules…").

**Would we build with it again?** Yes — as the first stop on any future Amazon Devices hackathon. We'd love a `--verify-my-repo` style tool that ingests a repository layout and returns per-rule pass/fail (our own 8-point audit is a step in that direction for the protocol layer).

### 4) AWS Bedrock Runtime (`@aws-sdk/client-bedrock-runtime`) & AWS Strands SDK

**What we used it for:** The Care Circle digest's intelligence: a Strands-style 4-agent graph (CognitiveAnalyst, MedicationGuardian, SafetyTriageOfficer, DigestComposer) where the composer calls Amazon Bedrock via `BedrockRuntimeClient` + `ConverseCommand` to narrate the day for the family. The pipeline is credential-aware: live Bedrock when `AWS_ACCESS_KEY_ID` exists, deterministic local synthesis (clearly badged) otherwise, so judges run with zero setup.

**What worked well:** The Converse API's uniform message shape across model families made the LLM node trivially swappable (our `BEDROCK_MODEL_ID` env). Constructing `BedrockRuntimeClient` without credentials (failing only at `send()`) let us keep one honest code path. The Strands pattern — small agents with system prompts + tools over shared state — mapped beautifully onto "deterministic clinical engines as tools, LLM as narrator," which is exactly the safety posture elder care needs: numbers from rules, words from the model.

**What needs work:** (a) First-call ergonomics for hackathon judges: model-access enablement per region + inference-profile ID formats (`global.…-v1:0`) are a maze on a deadline — a single "hackathon quickstart" page with copy-paste Converse snippets per model family would help enormously. (b) TypeScript Strands examples skew Python-first; more TS multi-agent samples would level the field. (c) A sanctioned "local simulation/stub" convention for Bedrock in demos (so zero-key judging is a first-class path) would remove the hand-rolled fallback we wrote.

**How onboarding/documentation felt:** `@aws-sdk/client-bedrock-runtime` types are excellent (the Converse command practically writes itself in an IDE). Strands' conceptual docs are clear; the friction is mostly account/region/model-access ceremony before the first token.

**Would we build with it again?** Definitely. Bedrock + Strands is now our default for "agents that must not hallucinate the numbers": engines compute, agents explain. We'll ship the live-Bedrock path in production.

---

## 🧰 Open Source Mini-Challenge — Answers

- **Contribution URL:** https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit
- **Primary Repo URL:** https://github.com/FEMZYKENTLTD/echocare-kinship-alexa-mcp
- **GitHub Username:** `FEMZYKENTLTD`

**What we built, how it works, and why it matters:**

`alexa-mcp-2025-kit` is a zero-hard-dependency TypeScript toolkit that removes the four hardest, most error-prone parts of shipping an Alexa+ MCP `2025-11-25` server:

1. **`createStreamableHttp2025Guard()`** — Express-compatible middleware + session registry + SDK-compatible SSE `EventStore` enforcing the spec: `Origin` validation (403, DNS-rebinding protection incl. an `X-Simulate-Untrusted-Origin` test hook), `MCP-Protocol-Version` validation (400), cryptographically secure session ids, sequential `<sessionId>:<seq>` SSE event ids, and `Last-Event-ID` replay.
2. **`defineAlexaMcpAppTool()`** — one-call binding of an MCP tool to its interactive `ui://` MCP App view (`_meta.ui.resourceUri` + legacy key + `text/html;profile=mcp-app` resource config), shaped for `@modelcontextprotocol/ext-apps`.
3. **`loadAgentSkillManifest()`** — runtime `SKILL.md` loader with a dependency-free YAML-frontmatter parser (nested maps, lists, block scalars), so skills are data, not code.
4. **`runMcp2025ComplianceAudit()`** — an 8-point *live* protocol audit (handshake, session issuance, version guard, Origin guard, ui-binding, resource serving, SSE resumability, DELETE→404) returning a structured report any UI/CI can render.

**Why it matters:** the 2025-11-25 transport's security and resumability rules are where hackathon (and production) servers silently fail. The kit turns them into defaults plus a self-test. EchoCare Kinship consumes it as a synced workspace module (`packages/alexa-mcp-2025-kit`, `file:` dependency), and its own Judge Inspector runs the kit's audit against the product in real time — open source proving product quality, live on stage. Any Alexa+ team can now `npm i` the guardrails and spend their weekend on their actual idea.

---

## 🚀 3 Feature Requests

### 🔴 Critical — Official MCP 2025-11-25 Conformance Test Suite (Alexa+ profile)
A runnable, versioned test harness (like our 8-point audit, but canonical) that a server must pass to claim Alexa+ compatibility: handshake negotiation, header enforcement, Origin behavior, session lifecycle incl. crash/TTL cases, SSE replay, and MCP Apps host message flows. This would eliminate an entire class of "works in Inspector, fails on device" submissions and give judges an objective floor.

### 🟠 Important — Version-compatibility matrix + meta-package for SDK/ext-apps
`ext-apps@2.x` vs `@modelcontextprotocol/sdk@1.x` vs the split v2 packages cost real hours (see Friction #1). Publish a compatibility matrix and a blessed meta-package (or `create-alexa-mcp-app` starter) pinning known-good combos per track, so "install latest" can never produce an unresolvable tree on day one of a hackathon.

### 🟡 Nice-to-have — First-class "zero-key demo mode" contracts across AWS AI services
A documented stub/simulation convention for Bedrock (and friends) — e.g., an official local endpoint or header-driven deterministic mode — so hackathon projects can be judged with `npm start` and zero cloud ceremony, while still demonstrating the real integration path. We hand-rolled this; everyone shouldn't have to.

---

## 🧾 Friction Log (5 entries)

### Friction 1 — ext-apps v2 vs. SDK v1 generational split breaks `npm install`
- **Task Attempted:** Install `@modelcontextprotocol/sdk` (latest 1.32.x) alongside `@modelcontextprotocol/ext-apps` (latest) for `ui://` views.
- **Steps Taken:** `npm i @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps`; inspected the ERESOLVE report; checked `npm view ... peerDependencies` for both majors.
- **Expected vs. Actual:** Expected a compatible install. Actual: `ext-apps@2.0.3` peer-requires `@modelcontextprotocol/server|client|core@^2.0.0` and `zod@^4.2.0` → unresolvable with SDK 1.x + zod 3.
- **Severity:** High (blocks project start; every Alexa+ team hitting "latest" hits this).
- **Workaround Used:** Pinned `@modelcontextprotocol/ext-apps@^1.7.5` (the SDK-1.x line, peers `sdk@^1.24.0`, `zod ^3.25 || ^4`) and verified `registerAppTool`/`RESOURCE_MIME_TYPE` APIs match our design; added a boot-time assert that kit and ext-apps agree on the MIME string.
- **Actionable Suggestion:** Put a compatibility matrix + "which major pairs with SDK 1.x vs split-v2" banner at the top of the ext-apps README and npm page; consider distinct package names for the v2 line to prevent accidental latest-tag upgrades.

### Friction 2 — Making SSE event ids literally `<sessionId>:<seq>` through the SDK EventStore
- **Task Attempted:** Implement spec resumability with audit-friendly sequential event ids keyed by session.
- **Steps Taken:** Read SDK `webStandardStreamableHttp` types/source; implemented `EventStore`; discovered `storeEvent(streamId, …)` receives a random per-stream UUID, not the session id; experimented with `onsessioninitialized` ordering.
- **Expected vs. Actual:** Expected the store to know its session. Actual: streams and sessions are deliberately decoupled; naive stores emit `<randomStream>:<seq>` ids, making cross-stream replay reasoning murky.
- **Severity:** Medium (resumability works either way, but ops/debuggability and our audit evidence suffer).
- **Workaround Used:** Per-session `EventStore` instances whose `sessionIdGenerator` callback calls `store.bindSession(id)` synchronously, so every emitted event id is `<sessionId>:<seq>` from the very first InitializeResult frame; forgiving replay parses `<scope>:<seq>` when an id predates binding.
- **Actionable Suggestion:** Ship (or document) a session-aware in-memory `EventStore` in the SDK proper — currently the only example lives in `examples/` and isn't importable from the package entry points.

### Friction 3 — MCP-Protocol-Version fallback ambiguity at the guard layer
- **Task Attempted:** Enforce `400` on invalid `MCP-Protocol-Version` while honoring the spec's "absent ⇒ assume 2025-03-26" rule and not breaking pre-initialize traffic.
- **Steps Taken:** Implemented header checks in middleware; tested with curl (missing header, bogus header, valid header) against initialize and post-initialize calls; reviewed how the SDK transport itself negotiates from the initialize *body*.
- **Expected vs. Actual:** Expected one crisp rule. Actual: two negotiation surfaces (body on initialize, header afterwards) plus a permissive fallback — strictness decisions (e.g., "initialize with a bogus header?") are underdetermined.
- **Severity:** Medium (interoperability edge; wrong choices either break clients or weaken the security story).
- **Workaround Used:** Our guard rejects *present-but-invalid* headers with 400 on every route, treats absent as the 2025-03-26 fallback, and lets the SDK negotiate the body version on initialize. The policy is documented and audit-tested.
- **Actionable Suggestion:** Add a short normative decision table to the spec (method × header-state → required server behavior), and state explicitly whether the header is meaningful *on* the initialize request itself.

### Friction 4 — MCP Apps host: tool-result can beat `ui/initialize`
- **Task Attempted:** Build the Echo Show host bridge: load `ui://` HTML into an iframe and deliver the just-executed tool's result.
- **Steps Taken:** Implemented postMessage handler; initially sent `tool-input`/`tool-result` immediately after setting `srcdoc`; observed lost messages when the app hadn't yet registered listeners; added init-gated queueing.
- **Expected vs. Actual:** Expected fire-and-forget delivery. Actual: messages posted before the iframe's bridge script runs are silently dropped — the app renders its "listening…" placeholder forever.
- **Severity:** Medium (every custom host will rediscover this; symptoms look like app bugs, not host bugs).
- **Workaround Used:** Queue `{toolInput, toolResult}` per view generation; flush only in response to the app's `ui/initialize` request; log all bridge traffic into our inspector so the ordering is visible.
- **Actionable Suggestion:** In ext-apps host guidance, state the invariant boldly ("MUST NOT send tool-result before responding to ui/initialize") and ship a minimal reference host (~50 lines) alongside the app-side `App` class.

### Friction 5 — Bedrock first-token ceremony (region + model access + inference profiles) on a hackathon clock
- **Task Attempted:** Wire `BedrockRuntimeClient` + `ConverseCommand` so judges *could* go live, without making judging depend on it.
- **Steps Taken:** Chose Converse for model-family uniformity; picked an inference-profile model id; built credential detection + graceful degradation; documented env vars.
- **Expected vs. Actual:** Expected "key + region + model name." Actual: per-region model-access enablement and profile-style ids (`global.…-v1:0`) are non-obvious failure points that only surface at `send()` time — the worst moment during a demo.
- **Severity:** Medium-High for hackathon contexts (any Bedrock-dependent demo is one console toggle away from failing on stage).
- **Workaround Used:** Zero-key deterministic simulation with honest mode badging everywhere (`/health`, UI, payloads); live path is identical code, one env var away; any Bedrock error also degrades to simulation instead of failing the tool call.
- **Actionable Suggestion:** A hackathon quickstart: pre-enabled model access in event accounts + copy-paste Converse snippets per family + a documented local stub pattern (see Feature Request 3).

---

## 🎙️ Demo Video Voiceover Script (2 min 15 s, timed to the ▶ Auto-Play 90s Demo)

*Recording notes: Start at http://localhost:3000 (or the Live Preview), toggle 🔊 Voice ON if you want Alexa+ to speak, press **▶ Auto-Play 90s Hackathon Demo**, and read the script over the automated run. Sections are timed to the on-screen demo captions.*

**[0:00–0:12 · Cold open — home screen]**
"In Lagos, Mama Adebayo is 74 — and determined to keep living in her own home. This is EchoCare Kinship: an Alexa+ guardian, running on a self-hosted MCP twenty-twenty-five-eleven-twenty-five server, that protects her independence… quietly."

**[0:12–0:35 · Act 1 — Memory Lane renders]**
"Every morning begins with a story, not a test. But underneath this warm conversation, our cognitive biomarker engine is measuring lexical diversity, word-finding pauses — even the subtle pronoun drift that precedes memory loss — against *her own* seven-day baseline. Ninety-one out of one hundred. Bright and steady. And with one tap, that story becomes a family treasure. *This* is screening with dignity."

**[0:35–1:05 · Act 2 — Medication Guardian blocks, then approves]**
"But at breakfast — danger. Her knee hurts, and she reaches for Advil. Before anything is confirmed, our geriatric pharmacology engine checks her actual prescriptions — and stops her. Ibuprofen with her blood thinner: a critical interaction, three-point-two times the bleeding risk. Alexa explains it gently, offers something safe… and only then confirms the dose. That's a hospital visit that never happens."

**[1:05–1:30 · Act 3 — Safety Shield + relay off]**
"Later, the sensors notice what she can't: a stove at three-hundred-seventy-five degrees, twenty-eight minutes, nobody in the kitchen. No blaring alarms — a calm check-in first. She agrees… the smart relay cuts the burner… risk back to zero. Her family never even had to worry."

**[1:30–1:52 · Act 4 — Bedrock Care Circle digest]**
"And at day's end, four AWS Bedrock agents — a Strands-style pipeline — turn all of it into one Peace-of-Mind digest for her daughter, her son, and her doctor. The story, the blocked pill, the stove — context, not alarms."

**[1:52–2:08 · Finale — audit tab, 8/8 green]**
"And because trust needs proof: our open-source alexa-mcp-twenty-twenty-five-kit just audited this very server, live — eight protocol checks, eight passes. Sessions, headers, resumable streaming — the full twenty-twenty-five spec."

**[2:08–2:15 · Close — home screen / logo]**
"EchoCare Kinship. Independence, with a guardian. Built for Alexa+, on MCP. Ẹ ṣé — thank you."

---

## 🔗 Links for judges

- **Live app:** `npm install && npm start` → http://localhost:3000 (press **▶ Auto-Play 90s Hackathon Demo**)
- **Tests:** `npm test` — 25 passing (engines · kit · live wire · 8/8 compliance audit)
- **Primary repo:** https://github.com/FEMZYKENTLTD/echocare-kinship-alexa-mcp
- **Open-source toolkit:** https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit
- **Private-repo collaborators invited:** `testing@devpost.com`, `chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, `emersonsklar`

*Wellness screening demonstration — not medical advice, diagnosis, or a substitute for professional care.*
