/**
 * alexa-mcp-2025-kit
 * ===================
 * Open-source toolkit for building Alexa+ MCP servers on the
 * Model Context Protocol **2025-11-25** Streamable HTTP specification.
 *
 * GitHub: https://github.com/FEMZYKENTLTD/alexa-mcp-2025-kit
 *
 * What is in the box:
 *  - `MCP_2025_PROTOCOL_VERSION` — the pinned protocol version constant.
 *  - `createStreamableHttp2025Guard(options)` — Express-compatible middleware +
 *    session registry + SSE event store enforcing MCP 2025-11-25 Streamable
 *    HTTP rules (Origin validation, MCP-Protocol-Version validation,
 *    cryptographically secure MCP-Session-Id lifecycle, sequential SSE event
 *    IDs `<sessionId>:<seq>` with `Last-Event-ID` replay).
 *  - `defineAlexaMcpAppTool(definition)` — binds an MCP tool to an interactive
 *    MCP App view served from a `ui://` resource (`text/html;profile=mcp-app`).
 *  - `loadAgentSkillManifest(filePath)` — loads & parses an Agent Skill
 *    `SKILL.md` manifest (YAML frontmatter + markdown instructions) at runtime.
 *  - `runMcp2025ComplianceAudit(targetUrl)` — an 8-point live protocol audit
 *    executed against a running `/mcp` endpoint.
 *
 * This file is the synced local workspace copy that ships inside
 * `echocare-kinship-alexa-mcp` so `npm install && npm start` works with zero
 * registry dependency. The canonical open-source repository is linked above.
 */
/** The MCP protocol revision this kit targets. */
export declare const MCP_2025_PROTOCOL_VERSION = "2025-11-25";
/** Fallback revision assumed when a client omits the header (per spec). */
export declare const MCP_FALLBACK_PROTOCOL_VERSION = "2025-03-26";
/** Revisions accepted in the `MCP-Protocol-Version` header by default. */
export declare const MCP_ACCEPTED_PROTOCOL_VERSIONS: readonly ["2025-11-25", "2025-06-18", "2025-03-26"];
/** MCP Apps resource MIME type (mirrors @modelcontextprotocol/ext-apps). */
export declare const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
/** Legacy flat tool `_meta` key pointing at the bound `ui://` resource. */
export declare const UI_RESOURCE_URI_META_KEY = "ui/resourceUri";
/** Header names used by the 2025-11-25 Streamable HTTP transport (lower-cased). */
export declare const MCP_SESSION_ID_HEADER = "mcp-session-id";
export declare const MCP_PROTOCOL_VERSION_HEADER = "mcp-protocol-version";
export declare const MCP_LAST_EVENT_ID_HEADER = "last-event-id";
/** Set this header (any non-empty value) to simulate a DNS-rebinding attack. */
export declare const SIMULATE_UNTRUSTED_ORIGIN_HEADER = "x-simulate-untrusted-origin";
export interface HttpRequestLike {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    url?: string;
}
export interface HttpResponseLike {
    status(code: number): HttpResponseLike;
    json(payload: unknown): unknown;
    setHeader?(name: string, value: string): void;
}
export type NextFunctionLike = (err?: unknown) => void;
export type GuardMiddleware = (req: HttpRequestLike, res: HttpResponseLike, next: NextFunctionLike) => void;
export interface RecordedSseEvent {
    eventId: string;
    streamId: string;
    sessionId?: string;
    seq: number;
    storedAt: string;
    message: unknown;
}
/**
 * An `@modelcontextprotocol/sdk` `EventStore` implementation whose event ids
 * are exactly `<sessionId>:<seq>` once the session is bound (falling back to
 * `<streamId>:<seq>` for any pre-session event). Supports `Last-Event-ID`
 * replay via `replayEventsAfter`.
 */
export declare class Mcp2025EventStore {
    private seq;
    private sessionId;
    private readonly events;
    private readonly maxEvents;
    onEventRecorded: ((event: RecordedSseEvent) => void) | undefined;
    constructor(maxEvents?: number);
    /** Bind this store to the cryptographically secure session id. */
    bindSession(sessionId: string): void;
    get boundSessionId(): string | undefined;
    storeEvent(streamId: string, message: unknown): Promise<string>;
    getStreamIdForEventId(eventId: string): Promise<string | undefined>;
    replayEventsAfter(lastEventId: string, { send, }: {
        send: (eventId: string, message: unknown) => Promise<void>;
    }): Promise<string>;
    /** Snapshot of recorded events (oldest → newest). */
    snapshot(): RecordedSseEvent[];
}
export interface SessionRecord {
    sessionId: string;
    createdAt: string;
    lastSeenAt: string;
    protocolVersion?: string;
    clientName?: string;
    eventStore?: Mcp2025EventStore;
}
export interface StreamableHttp2025GuardOptions {
    /** Accepted values for the MCP-Protocol-Version header. */
    acceptedProtocolVersions?: string[];
    /** Extra allowed Origin values (exact string or RegExp). */
    allowedOrigins?: Array<string | RegExp>;
    /** Extra allowed Origin host suffixes, e.g. ".mycloud.dev". */
    allowedOriginSuffixes?: string[];
    /** Return 404 for session ids not in the registry (default true). */
    requireKnownSession?: boolean;
    /** Max SSE events retained per session store (default 1000). */
    maxEventsPerSession?: number;
    /** Called whenever the guard rejects a request (for logging/telemetry). */
    onReject?: (info: {
        status: number;
        reason: string;
        method?: string;
    }) => void;
}
export interface StreamableHttp2025Guard {
    readonly protocolVersion: typeof MCP_2025_PROTOCOL_VERSION;
    readonly acceptedProtocolVersions: string[];
    /** Express-compatible middleware enforcing the 2025-11-25 rules. */
    middleware: GuardMiddleware;
    /** Cryptographically secure session id (UUID v4 from node:crypto). */
    generateSessionId: () => string;
    /** Create a per-session SDK-compatible event store wired into the guard. */
    createEventStore: () => Mcp2025EventStore;
    registerSession: (sessionId: string, meta?: {
        protocolVersion?: string;
        clientName?: string;
        eventStore?: Mcp2025EventStore;
    }) => SessionRecord;
    closeSession: (sessionId: string) => void;
    isSessionActive: (sessionId: string) => boolean;
    getSession: (sessionId: string) => SessionRecord | undefined;
    listSessions: () => SessionRecord[];
    /** All SSE events recorded across every session store (oldest → newest). */
    recordedEvents: (sessionId?: string) => RecordedSseEvent[];
    clearRecordedEvents: () => void;
}
export declare function createStreamableHttp2025Guard(options?: StreamableHttp2025GuardOptions): StreamableHttp2025Guard;
export interface AlexaMcpAppToolDefinition<TArgs = never, TResult = unknown> {
    name: string;
    title: string;
    description: string;
    /** Zod raw shape (or JSON-Schema-like object) — passed through untouched. */
    inputSchema?: Record<string, unknown>;
    /** The interactive view this tool renders, e.g. "ui://echocare/memory-lane". */
    resourceUri: string;
    viewTitle?: string;
    viewDescription?: string;
    annotations?: Record<string, unknown>;
    handler: (args: TArgs, extra: unknown) => Promise<TResult> | TResult;
}
export interface AlexaMcpAppToolRegistration<TArgs = never, TResult = unknown> {
    name: string;
    /** Ready for `registerAppTool(server, name, toolConfig, handler)`. */
    toolConfig: {
        title: string;
        description: string;
        inputSchema?: Record<string, unknown>;
        annotations?: Record<string, unknown>;
        _meta: {
            ui: {
                resourceUri: string;
            };
            [UI_RESOURCE_URI_META_KEY]: string;
        };
    };
    /** Ready for `registerAppResource(server, name, uri, config, reader)`. */
    resource: {
        name: string;
        uri: string;
        config: {
            mimeType: typeof MCP_APP_MIME_TYPE;
            description: string;
            _meta: {
                ui: {
                    prefersBorder: boolean;
                };
            };
        };
    };
    handler: AlexaMcpAppToolDefinition<TArgs, TResult>["handler"];
}
/**
 * Bind an MCP tool to an interactive MCP App view. Produces the exact
 * `_meta.ui.resourceUri` (+ legacy flat key) shape consumed by
 * `@modelcontextprotocol/ext-apps` `registerAppTool`, plus the matching
 * `ui://` resource registration (MIME `text/html;profile=mcp-app`).
 */
export declare function defineAlexaMcpAppTool<TArgs = never, TResult = unknown>(definition: AlexaMcpAppToolDefinition<TArgs, TResult>): AlexaMcpAppToolRegistration<TArgs, TResult>;
export interface AgentSkillManifest {
    name: string;
    description: string;
    version?: string;
    license?: string;
    /** Parsed YAML frontmatter (plain JSON-compatible values). */
    frontmatter: Record<string, unknown>;
    /** Raw frontmatter block text (without the --- fences). */
    rawFrontmatter: string;
    /** The markdown instruction body under the frontmatter. */
    instructions: string;
    /** Full raw SKILL.md contents. */
    rawMarkdown: string;
    sourcePath?: string;
    loadedAt: string;
}
type YamlValue = string | number | boolean | null | YamlValue[] | {
    [k: string]: YamlValue;
};
/**
 * Small, dependency-free YAML subset parser covering what SKILL.md
 * frontmatter needs: scalars, one-level+ nested maps, block lists,
 * inline lists, and `|`/`>` block scalars.
 */
export declare function parseSimpleYaml(text: string): Record<string, YamlValue>;
/** Parse SKILL.md markdown (frontmatter + body) into a manifest. */
export declare function parseAgentSkillManifest(markdown: string, sourcePath?: string): AgentSkillManifest;
/** Load and parse an Agent Skill manifest (`skills/<name>/SKILL.md`) at runtime. */
export declare function loadAgentSkillManifest(filePath: string): Promise<AgentSkillManifest>;
export interface SseEvent {
    id?: string;
    event?: string;
    data: string;
    parsed?: unknown;
}
export declare function parseSseText(text: string): SseEvent[];
export interface McpHttpResponse {
    status: number;
    headers: Headers;
    sessionId?: string;
    contentType: string;
    /** All JSON-RPC messages found (from a JSON body or SSE `data:` frames). */
    messages: Array<Record<string, unknown>>;
    sseEvents: SseEvent[];
    rawText: string;
    latencyMs: number;
}
/** Minimal JSON-RPC-over-Streamable-HTTP POST that understands JSON and SSE replies. */
export declare function postMcpJsonRpc(url: string, body: Record<string, unknown>, headers?: Record<string, string>, timeoutMs?: number): Promise<McpHttpResponse>;
export interface ComplianceCheck {
    id: string;
    name: string;
    spec: string;
    passed: boolean;
    detail: string;
    latencyMs: number;
}
export interface ComplianceAuditReport {
    targetUrl: string;
    protocolVersion: typeof MCP_2025_PROTOCOL_VERSION;
    startedAt: string;
    durationMs: number;
    summary: {
        total: number;
        passed: number;
        failed: number;
    };
    checks: ComplianceCheck[];
    serverInfo?: Record<string, unknown>;
    sessionId?: string;
}
export interface ComplianceAuditOptions {
    /** Per-request timeout (default 15000ms). */
    timeoutMs?: number;
    /** Client identity presented during initialize. */
    clientInfo?: {
        name: string;
        version: string;
    };
}
/**
 * Run an 8-point live MCP 2025-11-25 Streamable HTTP compliance audit against
 * a running server (e.g. `http://127.0.0.1:3000/mcp`):
 *
 *  1. Initialize handshake negotiates protocolVersion 2025-11-25.
 *  2. Cryptographically secure `MCP-Session-Id` is issued on initialize.
 *  3. Invalid `MCP-Protocol-Version` header is rejected with HTTP 400.
 *  4. Untrusted `Origin` is rejected with HTTP 403 (DNS-rebinding guard).
 *  5. `tools/list` returns tools bound to `ui://` MCP App views via `_meta`.
 *  6. `resources/list`/`resources/read` serve interactive `ui://` HTML apps.
 *  7. SSE events carry sequential `<sessionId>:<seq>` ids + Last-Event-ID replay.
 *  8. `DELETE /mcp` terminates the session; later calls return HTTP 404.
 */
export declare function runMcp2025ComplianceAudit(targetUrl: string, options?: ComplianceAuditOptions): Promise<ComplianceAuditReport>;
export {};
//# sourceMappingURL=index.d.ts.map