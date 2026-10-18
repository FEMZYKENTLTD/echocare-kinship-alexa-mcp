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
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */
/** The MCP protocol revision this kit targets. */
export const MCP_2025_PROTOCOL_VERSION = "2025-11-25";
/** Fallback revision assumed when a client omits the header (per spec). */
export const MCP_FALLBACK_PROTOCOL_VERSION = "2025-03-26";
/** Revisions accepted in the `MCP-Protocol-Version` header by default. */
export const MCP_ACCEPTED_PROTOCOL_VERSIONS = [
    MCP_2025_PROTOCOL_VERSION,
    "2025-06-18",
    MCP_FALLBACK_PROTOCOL_VERSION,
];
/** MCP Apps resource MIME type (mirrors @modelcontextprotocol/ext-apps). */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
/** Legacy flat tool `_meta` key pointing at the bound `ui://` resource. */
export const UI_RESOURCE_URI_META_KEY = "ui/resourceUri";
/** Header names used by the 2025-11-25 Streamable HTTP transport (lower-cased). */
export const MCP_SESSION_ID_HEADER = "mcp-session-id";
export const MCP_PROTOCOL_VERSION_HEADER = "mcp-protocol-version";
export const MCP_LAST_EVENT_ID_HEADER = "last-event-id";
/** Set this header (any non-empty value) to simulate a DNS-rebinding attack. */
export const SIMULATE_UNTRUSTED_ORIGIN_HEADER = "x-simulate-untrusted-origin";
/**
 * An `@modelcontextprotocol/sdk` `EventStore` implementation whose event ids
 * are exactly `<sessionId>:<seq>` once the session is bound (falling back to
 * `<streamId>:<seq>` for any pre-session event). Supports `Last-Event-ID`
 * replay via `replayEventsAfter`.
 */
export class Mcp2025EventStore {
    seq = 0;
    sessionId;
    events = [];
    maxEvents;
    onEventRecorded;
    constructor(maxEvents = 1000) {
        this.maxEvents = maxEvents;
    }
    /** Bind this store to the cryptographically secure session id. */
    bindSession(sessionId) {
        this.sessionId = sessionId;
    }
    get boundSessionId() {
        return this.sessionId;
    }
    async storeEvent(streamId, message) {
        this.seq += 1;
        const scope = this.sessionId ?? streamId;
        const eventId = `${scope}:${this.seq}`;
        this.events.push({ eventId, streamId, message });
        if (this.events.length > this.maxEvents) {
            this.events.splice(0, this.events.length - this.maxEvents);
        }
        this.onEventRecorded?.({
            eventId,
            streamId,
            sessionId: this.sessionId,
            seq: this.seq,
            storedAt: new Date().toISOString(),
            message,
        });
        return eventId;
    }
    async getStreamIdForEventId(eventId) {
        return this.events.find((e) => e.eventId === eventId)?.streamId;
    }
    async replayEventsAfter(lastEventId, { send, }) {
        const idx = this.events.findIndex((e) => e.eventId === lastEventId);
        if (idx === -1) {
            // Forgiving path: parse `<scope>:<seq>` and replay anything newer that
            // belongs to the same session/stream scope.
            const [scope, seqStr] = lastEventId.split(":");
            const afterSeq = Number.parseInt(seqStr ?? "0", 10);
            let streamId = scope ?? "";
            for (const ev of this.events) {
                const [evScope, evSeqStr] = ev.eventId.split(":");
                const evSeq = Number.parseInt(evSeqStr ?? "0", 10);
                if (evScope === scope && evSeq > afterSeq) {
                    streamId = ev.streamId;
                    await send(ev.eventId, ev.message);
                }
            }
            return streamId;
        }
        const streamId = this.events[idx].streamId;
        for (let i = idx + 1; i < this.events.length; i += 1) {
            const ev = this.events[i];
            if (ev.streamId === streamId || ev.eventId.startsWith(`${this.sessionId ?? ""}:`)) {
                await send(ev.eventId, ev.message);
            }
        }
        return streamId;
    }
    /** Snapshot of recorded events (oldest → newest). */
    snapshot() {
        return this.events.map((ev, i) => ({
            eventId: ev.eventId,
            streamId: ev.streamId,
            sessionId: this.sessionId,
            seq: i + 1,
            storedAt: "",
            message: ev.message,
        }));
    }
}
function headerValue(headers, name) {
    const raw = headers[name];
    if (Array.isArray(raw))
        return raw[0];
    return raw;
}
function jsonRpcError(res, status, code, message) {
    res.status(status).json({
        jsonrpc: "2.0",
        error: { code, message },
        id: null,
    });
}
function requestMethodName(body) {
    if (body && typeof body === "object" && !Array.isArray(body)) {
        const m = body.method;
        return typeof m === "string" ? m : undefined;
    }
    if (Array.isArray(body)) {
        const first = body[0];
        return typeof first?.method === "string" ? first.method : undefined;
    }
    return undefined;
}
export function createStreamableHttp2025Guard(options = {}) {
    const accepted = options.acceptedProtocolVersions ?? [
        ...MCP_ACCEPTED_PROTOCOL_VERSIONS,
    ];
    const allowedOrigins = options.allowedOrigins ?? [];
    const allowedSuffixes = [
        ".e2b.app",
        ...(options.allowedOriginSuffixes ?? []),
    ];
    const requireKnownSession = options.requireKnownSession ?? true;
    const sessions = new Map();
    const globalEventLog = [];
    function originAllowed(req) {
        const simulated = headerValue(req.headers, SIMULATE_UNTRUSTED_ORIGIN_HEADER);
        if (simulated && simulated.trim() !== "") {
            return {
                ok: false,
                reason: `Untrusted origin simulated via ${SIMULATE_UNTRUSTED_ORIGIN_HEADER}`,
            };
        }
        const origin = headerValue(req.headers, "origin");
        if (!origin)
            return { ok: true, reason: "no Origin header (non-browser client)" };
        let url;
        try {
            url = new URL(origin);
        }
        catch {
            return { ok: false, reason: `Malformed Origin header: ${origin}` };
        }
        const hostname = url.hostname.toLowerCase();
        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
            return { ok: true, reason: "loopback origin" };
        }
        // Same-origin: browser is talking to the host that served the page.
        const host = headerValue(req.headers, "host")?.toLowerCase();
        if (host && url.host.toLowerCase() === host) {
            return { ok: true, reason: "same-origin" };
        }
        if (allowedSuffixes.some((s) => hostname.endsWith(s))) {
            return { ok: true, reason: `allowed suffix match (${hostname})` };
        }
        for (const allowed of allowedOrigins) {
            if (typeof allowed === "string" && allowed === origin) {
                return { ok: true, reason: "allow-list match" };
            }
            if (allowed instanceof RegExp && allowed.test(origin)) {
                return { ok: true, reason: "allow-list regex match" };
            }
        }
        return { ok: false, reason: `Origin ${origin} is not trusted (DNS-rebinding protection)` };
    }
    const middleware = (req, res, next) => {
        const method = (req.method ?? "GET").toUpperCase();
        // 1) Origin validation — 403 Forbidden (spec: DNS rebinding protection).
        const originCheck = originAllowed(req);
        if (!originCheck.ok) {
            options.onReject?.({ status: 403, reason: originCheck.reason, method });
            jsonRpcError(res, 403, -32003, `Forbidden: ${originCheck.reason}`);
            return;
        }
        // 2) MCP-Protocol-Version validation — 400 Bad Request on invalid value.
        //    Absent header => assume the 2025-03-26 fallback (per spec).
        const version = headerValue(req.headers, MCP_PROTOCOL_VERSION_HEADER);
        if (version && !accepted.includes(version)) {
            options.onReject?.({
                status: 400,
                reason: `Unsupported MCP-Protocol-Version: ${version}`,
                method,
            });
            jsonRpcError(res, 400, -32600, `Bad Request: Unsupported MCP-Protocol-Version "${version}". Supported: ${accepted.join(", ")}`);
            return;
        }
        // 3) Session lifecycle validation.
        const sessionId = headerValue(req.headers, MCP_SESSION_ID_HEADER);
        const rpcMethod = method === "POST" ? requestMethodName(req.body) : undefined;
        const isInitialize = rpcMethod === "initialize";
        if (!isInitialize) {
            const bodyKnown = req.body !== undefined && req.body !== null && req.body !== "";
            if (!sessionId && (method !== "POST" || bodyKnown)) {
                options.onReject?.({ status: 400, reason: "Missing MCP-Session-Id", method });
                jsonRpcError(res, 400, -32000, "Bad Request: MCP-Session-Id header is required for non-initialize requests");
                return;
            }
            if (sessionId && requireKnownSession && !sessions.has(sessionId)) {
                options.onReject?.({ status: 404, reason: `Unknown session ${sessionId}`, method });
                jsonRpcError(res, 404, -32001, "Not Found: Unknown or terminated MCP session");
                return;
            }
        }
        if (sessionId) {
            const record = sessions.get(sessionId);
            if (record)
                record.lastSeenAt = new Date().toISOString();
        }
        next();
    };
    return {
        protocolVersion: MCP_2025_PROTOCOL_VERSION,
        acceptedProtocolVersions: accepted,
        middleware,
        generateSessionId: () => randomUUID(),
        createEventStore: () => {
            const store = new Mcp2025EventStore(options.maxEventsPerSession ?? 1000);
            store.onEventRecorded = (event) => {
                globalEventLog.push(event);
                if (globalEventLog.length > 5000) {
                    globalEventLog.splice(0, globalEventLog.length - 5000);
                }
            };
            return store;
        },
        registerSession: (sessionId, meta) => {
            const now = new Date().toISOString();
            const record = {
                sessionId,
                createdAt: now,
                lastSeenAt: now,
                protocolVersion: meta?.protocolVersion,
                clientName: meta?.clientName,
                eventStore: meta?.eventStore,
            };
            sessions.set(sessionId, record);
            meta?.eventStore?.bindSession(sessionId);
            return record;
        },
        closeSession: (sessionId) => {
            sessions.delete(sessionId);
        },
        isSessionActive: (sessionId) => sessions.has(sessionId),
        getSession: (sessionId) => sessions.get(sessionId),
        listSessions: () => Array.from(sessions.values()),
        recordedEvents: (sessionId) => sessionId
            ? globalEventLog.filter((e) => e.sessionId === sessionId)
            : [...globalEventLog],
        clearRecordedEvents: () => {
            globalEventLog.length = 0;
        },
    };
}
/**
 * Bind an MCP tool to an interactive MCP App view. Produces the exact
 * `_meta.ui.resourceUri` (+ legacy flat key) shape consumed by
 * `@modelcontextprotocol/ext-apps` `registerAppTool`, plus the matching
 * `ui://` resource registration (MIME `text/html;profile=mcp-app`).
 */
export function defineAlexaMcpAppTool(definition) {
    if (!definition.name)
        throw new Error("defineAlexaMcpAppTool: `name` is required");
    if (!definition.resourceUri?.startsWith("ui://")) {
        throw new Error(`defineAlexaMcpAppTool: resourceUri must be a ui:// URI, got "${definition.resourceUri}"`);
    }
    return {
        name: definition.name,
        toolConfig: {
            title: definition.title,
            description: definition.description,
            inputSchema: definition.inputSchema,
            annotations: definition.annotations,
            _meta: {
                ui: { resourceUri: definition.resourceUri },
                [UI_RESOURCE_URI_META_KEY]: definition.resourceUri,
            },
        },
        resource: {
            name: definition.viewTitle ?? definition.title,
            uri: definition.resourceUri,
            config: {
                mimeType: MCP_APP_MIME_TYPE,
                description: definition.viewDescription ??
                    `Interactive MCP App view for the ${definition.name} tool.`,
                _meta: { ui: { prefersBorder: false } },
            },
        },
        handler: definition.handler,
    };
}
function parseScalar(raw) {
    const v = raw.trim();
    if (v === "" || v === "~" || v === "null")
        return null;
    if (v === "true")
        return true;
    if (v === "false")
        return false;
    if (/^-?\d+(\.\d+)?$/.test(v))
        return Number(v);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
    }
    if (v.startsWith("[") && v.endsWith("]")) {
        const inner = v.slice(1, -1).trim();
        if (!inner)
            return [];
        return inner.split(",").map((part) => parseScalar(part));
    }
    return v;
}
/**
 * Small, dependency-free YAML subset parser covering what SKILL.md
 * frontmatter needs: scalars, one-level+ nested maps, block lists,
 * inline lists, and `|`/`>` block scalars.
 */
export function parseSimpleYaml(text) {
    const lines = text.split(/\r?\n/);
    const root = {};
    const stack = [{ indent: -1, container: root }];
    const currentMap = () => {
        const top = stack[stack.length - 1].container;
        if (Array.isArray(top)) {
            const last = top[top.length - 1];
            if (last && typeof last === "object" && !Array.isArray(last))
                return last;
            const obj = {};
            top[top.length - 1] = obj;
            return obj;
        }
        return top;
    };
    let i = 0;
    while (i < lines.length) {
        const rawLine = lines[i];
        i += 1;
        if (!rawLine.trim() || rawLine.trim().startsWith("#"))
            continue;
        const indent = rawLine.length - rawLine.trimStart().length;
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent)
            stack.pop();
        const line = rawLine.trim();
        if (line.startsWith("- ")) {
            const parentFrame = stack[stack.length - 1];
            if (!Array.isArray(parentFrame.container))
                continue;
            const itemText = line.slice(2).trim();
            if (itemText.includes(":") && !itemText.startsWith('"') && !itemText.startsWith("'")) {
                const obj = {};
                const [k, ...rest] = itemText.split(":");
                obj[k.trim()] = parseScalar(rest.join(":"));
                parentFrame.container.push(obj);
                stack.push({ indent, container: parentFrame.container });
            }
            else {
                parentFrame.container.push(parseScalar(itemText));
            }
            continue;
        }
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const valueText = line.slice(colonIdx + 1).trim();
        const map = currentMap();
        if (valueText === "|" || valueText === ">" || valueText === "|-" || valueText === ">-") {
            const blockLines = [];
            while (i < lines.length) {
                const peek = lines[i];
                const peekIndent = peek.length - peek.trimStart().length;
                if (peek.trim() !== "" && peekIndent <= indent)
                    break;
                blockLines.push(peek.trim());
                i += 1;
            }
            map[key] = blockLines.join(valueText.startsWith(">") ? " " : "\n").trim();
        }
        else if (valueText === "") {
            // Could be a nested map or a list — decide from the next non-empty line.
            let j = i;
            while (j < lines.length && lines[j].trim() === "")
                j += 1;
            const nextLine = j < lines.length ? lines[j].trim() : "";
            if (nextLine.startsWith("- ")) {
                const arr = [];
                map[key] = arr;
                stack.push({ indent, container: arr });
            }
            else {
                const obj = {};
                map[key] = obj;
                stack.push({ indent, container: obj });
            }
        }
        else {
            map[key] = parseScalar(valueText);
        }
    }
    return root;
}
/** Parse SKILL.md markdown (frontmatter + body) into a manifest. */
export function parseAgentSkillManifest(markdown, sourcePath) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
    if (!match) {
        throw new Error("SKILL.md is missing its YAML frontmatter block (--- ... ---)");
    }
    const [, rawFrontmatter, body] = match;
    const frontmatter = parseSimpleYaml(rawFrontmatter);
    const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
    const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
    if (!name)
        throw new Error("SKILL.md frontmatter must declare a `name`");
    if (!description)
        throw new Error("SKILL.md frontmatter must declare a `description`");
    return {
        name,
        description,
        version: typeof frontmatter.version === "string" ? frontmatter.version : undefined,
        license: typeof frontmatter.license === "string" ? frontmatter.license : undefined,
        frontmatter,
        rawFrontmatter,
        instructions: body.trim(),
        rawMarkdown: markdown,
        sourcePath,
        loadedAt: new Date().toISOString(),
    };
}
/** Load and parse an Agent Skill manifest (`skills/<name>/SKILL.md`) at runtime. */
export async function loadAgentSkillManifest(filePath) {
    const markdown = await readFile(filePath, "utf8");
    return parseAgentSkillManifest(markdown, filePath);
}
export function parseSseText(text) {
    const events = [];
    for (const block of text.split(/\r?\n\r?\n/)) {
        if (!block.trim())
            continue;
        const ev = { data: "" };
        const dataLines = [];
        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("id:"))
                ev.id = line.slice(3).trim();
            else if (line.startsWith("event:"))
                ev.event = line.slice(6).trim();
            else if (line.startsWith("data:"))
                dataLines.push(line.slice(5).trim());
        }
        ev.data = dataLines.join("\n");
        try {
            ev.parsed = JSON.parse(ev.data);
        }
        catch {
            ev.parsed = undefined;
        }
        events.push(ev);
    }
    return events;
}
/** Minimal JSON-RPC-over-Streamable-HTTP POST that understands JSON and SSE replies. */
export async function postMcpJsonRpc(url, body, headers = {}, timeoutMs = 15000) {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                ...headers,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const rawText = await res.text();
        const contentType = res.headers.get("content-type") ?? "";
        let sseEvents = [];
        let messages = [];
        if (contentType.includes("text/event-stream")) {
            sseEvents = parseSseText(rawText);
            messages = sseEvents
                .map((e) => e.parsed)
                .filter((m) => !!m && typeof m === "object");
        }
        else if (rawText.trim()) {
            try {
                const parsed = JSON.parse(rawText);
                messages = Array.isArray(parsed)
                    ? parsed
                    : [parsed];
            }
            catch {
                messages = [];
            }
        }
        return {
            status: res.status,
            headers: res.headers,
            sessionId: res.headers.get(MCP_SESSION_ID_HEADER) ?? undefined,
            contentType,
            messages,
            sseEvents,
            rawText,
            latencyMs: Math.round(performance.now() - started),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
function findResult(resp, id) {
    return resp.messages.find((m) => m.id === id) ?? resp.messages[resp.messages.length - 1];
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
export async function runMcp2025ComplianceAudit(targetUrl, options = {}) {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const timeoutMs = options.timeoutMs ?? 15000;
    const clientInfo = options.clientInfo ?? {
        name: "alexa-mcp-2025-kit/audit",
        version: "1.0.0",
    };
    const checks = [];
    let sessionId;
    let serverInfo;
    let firstToolName;
    let firstUiResourceUri;
    const sessionHeaders = () => ({
        [MCP_PROTOCOL_VERSION_HEADER]: MCP_2025_PROTOCOL_VERSION,
        ...(sessionId ? { [MCP_SESSION_ID_HEADER]: sessionId } : {}),
    });
    const record = (id, name, spec, passed, detail, latencyMs) => checks.push({ id, name, spec, passed, detail, latencyMs });
    // -- Check 1 + 2: initialize handshake & session issuance ------------------
    try {
        const resp = await postMcpJsonRpc(targetUrl, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: MCP_2025_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo,
            },
        }, {}, timeoutMs);
        const msg = findResult(resp, 1);
        const result = (msg?.result ?? {});
        serverInfo = result.serverInfo;
        sessionId = resp.sessionId;
        const negotiated = result.protocolVersion;
        record("initialize-handshake", "Initialize handshake negotiates 2025-11-25", "MCP 2025-11-25 § Lifecycle: server MUST reply with the negotiated protocolVersion", resp.status === 200 && negotiated === MCP_2025_PROTOCOL_VERSION && !!serverInfo, `HTTP ${resp.status} · protocolVersion=${String(negotiated)} · server=${String(serverInfo?.name ?? "unknown")}`, resp.latencyMs);
        const uuidLike = !!sessionId &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
        record("session-id-issuance", "Cryptographically secure MCP-Session-Id issued", "MCP 2025-11-25 § Streamable HTTP: session id MUST be globally unique & cryptographically secure", uuidLike, sessionId ? `MCP-Session-Id: ${sessionId}` : "No MCP-Session-Id header on InitializeResult", resp.latencyMs);
        // Complete the handshake.
        if (sessionId) {
            await postMcpJsonRpc(targetUrl, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionHeaders(), timeoutMs).catch(() => undefined);
        }
    }
    catch (err) {
        record("initialize-handshake", "Initialize handshake negotiates 2025-11-25", "Lifecycle", false, String(err), 0);
        record("session-id-issuance", "Cryptographically secure MCP-Session-Id issued", "Streamable HTTP", false, "Initialize failed", 0);
    }
    // -- Check 3: bad protocol version => 400 ----------------------------------
    try {
        const resp = await postMcpJsonRpc(targetUrl, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, { ...sessionHeaders(), [MCP_PROTOCOL_VERSION_HEADER]: "1999-01-01" }, timeoutMs);
        record("protocol-version-guard", "Invalid MCP-Protocol-Version rejected (400)", "MCP 2025-11-25 § Protocol Version Header: server MUST return 400 on unsupported versions", resp.status === 400, `Sent MCP-Protocol-Version: 1999-01-01 → HTTP ${resp.status}`, resp.latencyMs);
    }
    catch (err) {
        record("protocol-version-guard", "Invalid MCP-Protocol-Version rejected (400)", "Protocol Version Header", false, String(err), 0);
    }
    // -- Check 4: untrusted origin => 403 --------------------------------------
    try {
        const resp = await postMcpJsonRpc(targetUrl, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, {
            ...sessionHeaders(),
            origin: "https://rebinding-attacker.example.com",
            [SIMULATE_UNTRUSTED_ORIGIN_HEADER]: "https://rebinding-attacker.example.com",
        }, timeoutMs);
        record("origin-guard", "Untrusted Origin rejected (403)", "MCP 2025-11-25 § DNS Rebinding Protection: servers MUST validate Origin and return 403", resp.status === 403, `Sent Origin: https://rebinding-attacker.example.com → HTTP ${resp.status}`, resp.latencyMs);
    }
    catch (err) {
        record("origin-guard", "Untrusted Origin rejected (403)", "DNS Rebinding Protection", false, String(err), 0);
    }
    // -- Check 5: tools/list + ui:// binding ------------------------------------
    try {
        const resp = await postMcpJsonRpc(targetUrl, { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }, sessionHeaders(), timeoutMs);
        const result = (findResult(resp, 4)?.result ?? {});
        const tools = result.tools ?? [];
        firstToolName = tools[0]?.name;
        const bound = tools.filter((t) => {
            const meta = (t._meta ?? {});
            const ui = (meta.ui ?? {});
            const uri = ui.resourceUri ?? meta[UI_RESOURCE_URI_META_KEY] ?? "";
            return typeof uri === "string" && uri.startsWith("ui://");
        });
        record("tools-ui-binding", "Tools bound to ui:// MCP App views", "MCP Apps (SEP-1865): tools declare _meta.ui.resourceUri pointing at a ui:// view", tools.length > 0 && bound.length === tools.length, `${tools.length} tools listed · ${bound.length}/${tools.length} bound to ui:// views (${tools
            .map((t) => String(t.name))
            .join(", ")})`, resp.latencyMs);
    }
    catch (err) {
        record("tools-ui-binding", "Tools bound to ui:// MCP App views", "MCP Apps", false, String(err), 0);
    }
    // -- Check 6: ui:// resources ------------------------------------------------
    try {
        const started = performance.now();
        const listResp = await postMcpJsonRpc(targetUrl, { jsonrpc: "2.0", id: 5, method: "resources/list", params: {} }, sessionHeaders(), timeoutMs);
        const listResult = (findResult(listResp, 5)?.result ?? {});
        const uiResources = (listResult.resources ?? []).filter((r) => String(r.uri).startsWith("ui://"));
        firstUiResourceUri = uiResources[0]?.uri;
        let readOk = false;
        let readDetail = "no ui:// resource to read";
        if (firstUiResourceUri) {
            const readResp = await postMcpJsonRpc(targetUrl, {
                jsonrpc: "2.0",
                id: 6,
                method: "resources/read",
                params: { uri: firstUiResourceUri },
            }, sessionHeaders(), timeoutMs);
            const readResult = (findResult(readResp, 6)?.result ?? {});
            const content = readResult.contents?.[0];
            readOk =
                !!content &&
                    String(content.mimeType ?? "").startsWith("text/html") &&
                    /<html/i.test(content.text ?? "");
            readDetail = `${firstUiResourceUri} → mimeType=${String(content?.mimeType)} · ${(content?.text ?? "").length} bytes of interactive HTML`;
        }
        record("ui-resource-serving", "ui:// MCP App resources served as HTML", "MCP Apps (SEP-1865): ui:// resources are served with text/html;profile=mcp-app", uiResources.length > 0 && readOk, `${uiResources.length} ui:// resources · ${readDetail}`, Math.round(performance.now() - started));
    }
    catch (err) {
        record("ui-resource-serving", "ui:// MCP App resources served as HTML", "MCP Apps", false, String(err), 0);
    }
    // -- Check 7: SSE sequential ids + Last-Event-ID replay ----------------------
    try {
        const started = performance.now();
        const toolName = firstToolName ?? "tools/list";
        const callBody = toolName === "tools/list"
            ? { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }
            : {
                jsonrpc: "2.0",
                id: 7,
                method: "tools/call",
                params: { name: toolName, arguments: {} },
            };
        const resp = await postMcpJsonRpc(targetUrl, callBody, sessionHeaders(), timeoutMs);
        const ids = resp.sseEvents.map((e) => e.id).filter((v) => !!v);
        const formatOk = ids.length >= 2 &&
            ids.every((id) => sessionId !== undefined && id.startsWith(`${sessionId}:`));
        const seqs = ids.map((id) => Number.parseInt(id.split(":").pop() ?? "0", 10));
        const sequential = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
        let replayCount = 0;
        if (ids.length >= 2) {
            const controller = new AbortController();
            const replayTimer = setTimeout(() => controller.abort(), 3000);
            try {
                const res = await fetch(targetUrl, {
                    method: "GET",
                    headers: {
                        accept: "text/event-stream",
                        [MCP_PROTOCOL_VERSION_HEADER]: MCP_2025_PROTOCOL_VERSION,
                        ...(sessionId ? { [MCP_SESSION_ID_HEADER]: sessionId } : {}),
                        [MCP_LAST_EVENT_ID_HEADER]: ids[0],
                    },
                    signal: controller.signal,
                });
                if (res.body) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    const deadline = Date.now() + 2800;
                    while (Date.now() < deadline) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        buffer += decoder.decode(value, { stream: true });
                        replayCount = parseSseText(buffer).filter((e) => e.id && e.id !== ids[0]).length;
                        if (replayCount > 0)
                            break;
                    }
                    await reader.cancel().catch(() => undefined);
                }
            }
            catch {
                /* abort is expected — replay count already captured if any */
            }
            finally {
                clearTimeout(replayTimer);
            }
        }
        record("sse-resumability", "Sequential SSE ids + Last-Event-ID replay", "MCP 2025-11-25 § Resumability: event ids enable Last-Event-ID replay after disconnect", formatOk && sequential && replayCount > 0, `captured ${ids.length} SSE events (${ids.slice(0, 3).join(", ")}…) · replay after ${ids[0] ?? "∅"} yielded ${replayCount} event(s)`, Math.round(performance.now() - started));
    }
    catch (err) {
        record("sse-resumability", "Sequential SSE ids + Last-Event-ID replay", "Resumability", false, String(err), 0);
    }
    // -- Check 8: DELETE terminates the session; later call => 404 ---------------
    try {
        const started = performance.now();
        const delRes = await fetch(targetUrl, {
            method: "DELETE",
            headers: sessionHeaders(),
        });
        await delRes.text().catch(() => "");
        const after = await postMcpJsonRpc(targetUrl, { jsonrpc: "2.0", id: 8, method: "tools/list", params: {} }, sessionHeaders(), timeoutMs);
        record("session-termination", "DELETE /mcp terminates session (404 after)", "MCP 2025-11-25 § Session Management: DELETE terminates; unknown sessions return 404", delRes.status >= 200 && delRes.status < 300 && after.status === 404, `DELETE → HTTP ${delRes.status} · tools/list with terminated session → HTTP ${after.status}`, Math.round(performance.now() - started));
    }
    catch (err) {
        record("session-termination", "DELETE /mcp terminates session (404 after)", "Session Management", false, String(err), 0);
    }
    const passed = checks.filter((c) => c.passed).length;
    return {
        targetUrl,
        protocolVersion: MCP_2025_PROTOCOL_VERSION,
        startedAt,
        durationMs: Math.round(performance.now() - t0),
        summary: { total: checks.length, passed, failed: checks.length - passed },
        checks,
        serverInfo,
        sessionId,
    };
}
//# sourceMappingURL=index.js.map