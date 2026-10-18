# 🧰 alexa-mcp-2025-kit

**Open-source toolkit for building Alexa+ MCP servers on the MCP `2025-11-25` Streamable HTTP specification.**

Canonical repository: **https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit**
(This directory is the synced local workspace copy shipped inside
[`echocare-kinship-alexa-mcp`](https://github.com/FEMZYKENTLTD/echocare-kinship-alexa-mcp)
so `npm install && npm start` works with zero registry dependency.)

## What's inside

| Export | Purpose |
|---|---|
| `MCP_2025_PROTOCOL_VERSION` | Pinned `"2025-11-25"` constant (+ accepted/fallback lists) |
| `createStreamableHttp2025Guard(options)` | Express-compatible guard: Origin validation (403), `MCP-Protocol-Version` validation (400), cryptographic session registry, `<sessionId>:<seq>` SSE event store with `Last-Event-ID` replay |
| `defineAlexaMcpAppTool(definition)` | Binds an MCP tool to an interactive `ui://` MCP App view (`_meta.ui.resourceUri`, `text/html;profile=mcp-app`) for `@modelcontextprotocol/ext-apps` |
| `loadAgentSkillManifest(filePath)` | Loads & parses Agent Skill `SKILL.md` files (dependency-free YAML frontmatter parser) |
| `runMcp2025ComplianceAudit(targetUrl)` | 8-point live protocol audit: handshake · session issuance · version guard · Origin guard · ui-binding · resource serving · SSE resumability · DELETE→404 |
| `postMcpJsonRpc` / `parseSseText` | Tiny JSON-RPC-over-Streamable-HTTP client helpers (JSON + SSE replies) for audits/tests |

## Quick taste

```ts
import {
  createStreamableHttp2025Guard,
  defineAlexaMcpAppTool,
  loadAgentSkillManifest,
  runMcp2025ComplianceAudit,
} from "alexa-mcp-2025-kit";

const guard = createStreamableHttp2025Guard();
app.all("/mcp", guard.middleware, mcpHandler); // Origin 403 · Version 400 · Sessions 404

const tool = defineAlexaMcpAppTool({
  name: "greet_elder",
  title: "Greeter",
  description: "…",
  resourceUri: "ui://demo/greeter",
  handler: async () => ({ /* CallToolResult */ }),
});
registerAppTool(server, tool.name, tool.toolConfig, tool.handler);

const skill = await loadAgentSkillManifest("skills/my-skill/SKILL.md");
const report = await runMcp2025ComplianceAudit("http://127.0.0.1:3000/mcp");
console.log(report.summary); // { total: 8, passed: 8, failed: 0 }
```

## License

MIT © OLUFEMI BENUA KERIPE (FEMZYKENTLTD)
