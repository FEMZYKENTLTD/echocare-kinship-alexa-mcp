/**
 * EchoCare Kinship — unified server
 * =================================
 * One process on 0.0.0.0:3000 serving:
 *   • POST/GET/DELETE /mcp — MCP 2025-11-25 Streamable HTTP server (SDK
 *     McpServer + StreamableHTTPServerTransport) behind the
 *     alexa-mcp-2025-kit 2025 guard (Origin, protocol-version, sessions, SSE).
 *   • 4 MCP App tools (`ui://echocare/*`) via @modelcontextprotocol/ext-apps.
 *   • The Alexa+ Echo Show 15 simulator web app (public/).
 *   • /api/* — skill manifest, day state, and the 1-click compliance audit.
 *
 * Runtime technology hooks (imported AND executed here):
 *   @modelcontextprotocol/sdk · @modelcontextprotocol/ext-apps ·
 *   @aws-sdk/client-bedrock-runtime (via src/agent/aws-bedrock-strands.ts) ·
 *   alexa-mcp-2025-kit (guard, skill loader, audit, tool binder).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Server as HttpServer } from "node:http";

import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  MCP_2025_PROTOCOL_VERSION,
  createStreamableHttp2025Guard,
  loadAgentSkillManifest,
  runMcp2025ComplianceAudit,
  type AgentSkillManifest,
  type StreamableHttp2025Guard,
} from "alexa-mcp-2025-kit";

import { registerEchoCarePrompts, registerEchoCareTools } from "./tools/index.js";
import { adherencePct, dayState } from "./state.js";
import { bedrockRuntimeInfo } from "../agent/aws-bedrock-strands.js";
import {
  ACTIVE_MEDICATIONS,
  CARE_CIRCLE,
  COGNITIVE_BASELINE_7DAY,
  ELDER,
} from "../data/elder-profile.js";
import { listIncidents } from "../engines/ambient-triage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SKILL_PATH = join(REPO_ROOT, "skills", "echocare-kinship", "SKILL.md");
const PUBLIC_DIR = join(REPO_ROOT, "public");

export const SERVER_INFO = {
  name: "echocare-kinship-alexa-mcp",
  version: "1.0.0",
  title: "EchoCare Kinship — Alexa+ Aging-in-Place Guardian",
};

function buildMcpServer(skill: AgentSkillManifest): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { logging: {} },
  });
  registerEchoCareTools(server);
  registerEchoCarePrompts(server);

  // The Agent Skill itself is readable over MCP — hosts can fetch the exact
  // SKILL.md that `loadAgentSkillManifest` parsed at boot.
  server.registerResource(
    "EchoCare Kinship Agent Skill (SKILL.md)",
    "skill://echocare-kinship/SKILL.md",
    {
      mimeType: "text/markdown",
      description: `Agent Skill "${skill.name}" v${skill.version ?? "1.0.0"} — tool-selection instructions and safety guardrails.`,
    },
    async () => ({
      contents: [
        {
          uri: "skill://echocare-kinship/SKILL.md",
          mimeType: "text/markdown",
          text: skill.rawMarkdown,
        },
      ],
    }),
  );

  return server;
}

export interface EchoCareApp {
  app: Express;
  guard: StreamableHttp2025Guard;
  skill: AgentSkillManifest;
}

export async function createEchoCareApp(): Promise<EchoCareApp> {
  // Runtime hook: load & validate the Agent Skill manifest at boot.
  const skill = await loadAgentSkillManifest(SKILL_PATH);

  const guard = createStreamableHttp2025Guard({
    onReject: ({ status, reason, method }) =>
      console.warn(`[kit guard] ${method} /mcp → HTTP ${status}: ${reason}`),
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: true,
      credentials: false,
      allowedHeaders: [
        "Content-Type",
        "Accept",
        "MCP-Session-Id",
        "MCP-Protocol-Version",
        "Last-Event-ID",
        "X-Simulate-Untrusted-Origin",
      ],
      exposedHeaders: ["MCP-Session-Id", "MCP-Protocol-Version"],
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  /* ------------------------------------------------------------------ */
  /* /mcp — MCP 2025-11-25 Streamable HTTP (POST · GET · DELETE)        */
  /* ------------------------------------------------------------------ */
  app.all("/mcp", guard.middleware as never, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res, req.body);
          return;
        }
        if (!sessionId && isInitializeRequest(req.body)) {
          const eventStore = guard.createEventStore();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => {
              const id = guard.generateSessionId();
              eventStore.bindSession(id); // → SSE ids are `<sessionId>:<seq>`
              return id;
            },
            eventStore,
            onsessioninitialized: (newSessionId) => {
              transports.set(newSessionId, transport);
              guard.registerSession(newSessionId, {
                protocolVersion: MCP_2025_PROTOCOL_VERSION,
                eventStore,
              });
              console.log(`[mcp] session initialized ${newSessionId} (protocol ${MCP_2025_PROTOCOL_VERSION})`);
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              transports.delete(sid);
              guard.closeSession(sid);
              console.log(`[mcp] session closed ${sid}`);
            }
          };
          const server = buildMcpServer(skill);
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        }
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Bad Request: expected an initialize request or a valid MCP-Session-Id header.",
          },
          id: null,
        });
        return;
      }

      // GET (standalone SSE stream / Last-Event-ID replay) & DELETE (terminate)
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res);
        return;
      }
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Not Found: unknown or terminated MCP session." },
        id: null,
      });
    } catch (err) {
      console.error("[mcp] handler error", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* REST surface for the Echo Show simulator + Judge Inspector          */
  /* ------------------------------------------------------------------ */
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      server: SERVER_INFO,
      mcpProtocolVersion: MCP_2025_PROTOCOL_VERSION,
      kit: "https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit",
      skill: { name: skill.name, version: skill.version, loadedAt: skill.loadedAt },
      bedrock: bedrockRuntimeInfo(),
      activeSessions: guard.listSessions().length,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/api/skill", (_req, res) => {
    res.json({
      name: skill.name,
      description: skill.description,
      version: skill.version,
      license: skill.license,
      frontmatter: skill.frontmatter,
      instructions: skill.instructions,
      rawMarkdown: skill.rawMarkdown,
      sourcePath: "skills/echocare-kinship/SKILL.md",
      loadedAt: skill.loadedAt,
    });
  });

  app.get("/api/state", (_req, res) => {
    res.json({
      elder: ELDER,
      careCircle: CARE_CIRCLE,
      activeMedications: ACTIVE_MEDICATIONS,
      cognitiveBaseline: COGNITIVE_BASELINE_7DAY,
      day: {
        adherence: {
          confirmed: dayState.dosesConfirmed,
          scheduled: dayState.dosesScheduled,
          pct: adherencePct(),
        },
        doseLog: dayState.doseLog,
        preventedInteractions: dayState.preventedInteractions,
        resolvedAnomalies: dayState.resolvedAnomalies,
        openIncidentIds: [...dayState.openIncidentIds],
        incidents: listIncidents(),
        savedMemories: dayState.savedMemories,
        lastBiomarkers: dayState.lastBiomarkers ?? null,
        lastDrift: dayState.lastDrift ?? null,
        lastMedAssessment: dayState.lastMedAssessment ?? null,
        digestSentTo: dayState.digestSentTo,
        hydration: { glasses: dayState.hydrationGlasses, goal: dayState.hydrationGoal },
        sleepHours: dayState.sleepHours,
        stepsEstimate: dayState.stepsEstimate,
      },
      bedrock: {
        ...bedrockRuntimeInfo(),
        lastTrace: dayState.lastDigest?.trace ?? [],
        lastDigestAt: dayState.lastDigest?.generatedAt ?? null,
      },
      sessions: guard.listSessions().map(({ eventStore: _es, ...rest }) => rest),
      recordedSseEvents: guard.recordedEvents().length,
    });
  });

  // 1-click MCP 2025-11-25 compliance audit (runs the kit against ourselves).
  app.post("/api/audit", async (req, res) => {
    const localPort = req.socket.localPort ?? 3000;
    const target = `http://127.0.0.1:${localPort}/mcp`;
    try {
      const report = await runMcp2025ComplianceAudit(target);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err), target });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Static web app (public/)                                            */
  /* ------------------------------------------------------------------ */
  if (existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: 0 }));
  }
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/mcp") return next();
    const indexFile = join(PUBLIC_DIR, "index.html");
    if (existsSync(indexFile)) return res.sendFile(indexFile);
    return next();
  });

  return { app, guard, skill };
}

export interface RunningServer {
  server: HttpServer;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startEchoCareServer(
  port = Number(process.env.PORT ?? 3000),
): Promise<RunningServer> {
  const { app, skill } = await createEchoCareApp();
  return new Promise((resolve) => {
    const server = app.listen(port, "0.0.0.0", () => {
      const actualPort = (server.address() as { port: number }).port;
      const bedrock = bedrockRuntimeInfo();
      console.log("");
      console.log("  🫶  EchoCare Kinship — Alexa+ MCP 2025-11-25 Guardian");
      console.log(`     Web app (Echo Show 15 simulator)  http://0.0.0.0:${actualPort}/`);
      console.log(`     MCP Streamable HTTP endpoint      http://0.0.0.0:${actualPort}/mcp  (POST · GET · DELETE)`);
      console.log(`     Protocol                          ${MCP_2025_PROTOCOL_VERSION}`);
      console.log(`     Agent Skill loaded                ${skill.name} v${skill.version ?? "1.0.0"} (skills/echocare-kinship/SKILL.md)`);
      console.log(`     AWS Bedrock                       ${bedrock.mode} · ${bedrock.modelId} · ${bedrock.region}`);
      console.log("     Open-source toolkit               https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit");
      console.log("");
      resolve({
        server,
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        close: () => new Promise((res2) => server.close(() => res2())),
      });
    });
  });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startEchoCareServer().catch((err) => {
    console.error("Failed to start EchoCare server", err);
    process.exit(1);
  });
}
