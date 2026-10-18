/* EchoCare Kinship — Echo Show 15 Simulator + Judge Inspector
 * A real browser MCP 2025-11-25 client over Streamable HTTP (fetch + SSE),
 * an MCP Apps host (postMessage bridge), and scripted demo orchestration.
 * All fetches use RELATIVE paths so the app works behind any preview host. */
(function () {
  "use strict";

  var PROTOCOL = "2025-11-25";
  var APPS_PROTOCOL = "2026-01-26";

  /* Demo content (mirrors the server's bundled samples; sent explicitly on the wire). */
  var PROMPT_MEMORY = "Mama Adebayo, tell me about a celebration day that still makes you smile — who was there, and what do you remember most?";
  var TRANSCRIPT_BRIGHT = "Oh, that wedding in Abeokuta! I remember it like yesterday, I truly do. Your father, Pa Adetola, wore his cream agbada with the gold embroidery, and Ebenezer Obey himself played until midnight. Tolu was only six then, dancing in her yellow lace dress near the drummers, and everybody kept laughing because Tolu would not sit down. We served jollof rice, moin moin and fried plantain to nearly three hundred guests under the mango tree, that same mango tree behind your grandfather's house. Even the rain waited until the very end. And Kunle, Kunle kept sneaking puff-puff from the kitchen tray when he thought nobody was watching him.";
  var LATENCIES_BRIGHT = [940, 1050, 1180, 990, 1120, 1010];
  var Q_ADVIL = "Alexa, my knee hurts — can I take two Advil (Ibuprofen) with my morning pills?";
  var Q_TYLENOL = "What about Tylenol (Acetaminophen) instead?";

  /* ---------------- DOM helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function truncate(value, depth) {
    if (typeof value === "string") return value.length > 520 ? value.slice(0, 520) + "… [" + value.length + " chars]" : value;
    if (Array.isArray(value)) return value.map(function (v) { return truncate(v, depth + 1); });
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = truncate(value[k], depth + 1); });
      return out;
    }
    return value;
  }
  function pretty(obj) {
    try { return JSON.stringify(truncate(obj, 0), null, 2); } catch (e) { return String(obj); }
  }

  /* ---------------- Wire inspector ---------------- */
  var wireLog = $("wireLog");
  function logWire(kind, title, opts) {
    opts = opts || {};
    var el = document.createElement("div");
    el.className = "wire-entry";
    var chips = {
      req: '<span class="wchip req">→ REQ</span>',
      res: '<span class="wchip res">← RES</span>',
      evt: '<span class="wchip evt">⚡ SSE</span>',
      err: '<span class="wchip err">✕ ERR</span>',
      bridge: '<span class="wchip bridge">⟷ APP</span>',
      info: '<span class="wchip evt">ℹ HOST</span>'
    };
    var html = '<div class="wire-top">' + (chips[kind] || chips.info) + "<b>" + esc(title) + "</b>";
    if (opts.eventId) html += '<span class="wchip evt">id: ' + esc(opts.eventId) + "</span>";
    if (opts.latencyMs != null) html += '<span class="wire-latency">' + opts.latencyMs + " ms</span>";
    html += "</div>";
    if (opts.headers) html += '<div class="wire-headers">' + Object.keys(opts.headers).map(function (k) { return esc(k) + ": " + esc(opts.headers[k]); }).join("<br/>") + "</div>";
    if (opts.body !== undefined) {
      html += "<details" + (opts.open ? " open" : "") + "><summary>JSON-RPC payload</summary><pre>" + esc(typeof opts.body === "string" ? opts.body : pretty(opts.body)) + "</pre></details>";
    }
    if (opts.note) html += '<div class="muted" style="font-family:var(--sans)">' + esc(opts.note) + "</div>";
    el.innerHTML = html;
    wireLog.prepend(el);
    while (wireLog.children.length > 140) wireLog.removeChild(wireLog.lastChild);
  }
  $("clearWire").addEventListener("click", function () { wireLog.innerHTML = ""; });

  /* ---------------- MCP client state ---------------- */
  var sessionId = null;
  var rpcSeq = 0;
  var lastEventId = null;
  var toolViews = {};        // tool name -> ui:// uri
  var streamAbort = null;    // standalone GET stream controller
  var streamGeneration = 0;

  function clientHeaders(extra) {
    var h = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
    if (sessionId) { h["MCP-Session-Id"] = sessionId; h["MCP-Protocol-Version"] = PROTOCOL; }
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function parseSseBlock(block) {
    var ev = { id: null, event: null, data: "" };
    var dataLines = [];
    block.split(/\r?\n/).forEach(function (line) {
      if (line.indexOf("id:") === 0) ev.id = line.slice(3).trim();
      else if (line.indexOf("event:") === 0) ev.event = line.slice(6).trim();
      else if (line.indexOf("data:") === 0) dataLines.push(line.slice(5).trim());
    });
    ev.data = dataLines.join("\n");
    return ev;
  }

  async function readStreamingBody(res, onEvent) {
    var ctype = res.headers.get("content-type") || "";
    if (ctype.indexOf("text/event-stream") === -1) {
      var text = await res.text();
      if (!text.trim()) return [];
      try { var j = JSON.parse(text); return Array.isArray(j) ? j : [j]; } catch (e) { return []; }
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var messages = [];
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i].trim()) continue;
        var ev = parseSseBlock(parts[i]);
        if (ev.id) lastEventId = ev.id;
        var parsed = null;
        if (ev.data) { try { parsed = JSON.parse(ev.data); } catch (e) { parsed = null; } }
        onEvent && onEvent(ev, parsed);
        if (parsed) messages.push(parsed);
      }
    }
    return messages;
  }

  async function mcpPost(body, label) {
    var isRequest = body.id !== undefined;
    var started = performance.now();
    var headers = clientHeaders();
    logWire("req", (isRequest ? "POST /mcp · " : "POST /mcp (notification) · ") + (label || body.method), {
      headers: headers, body: body
    });
    var res = await fetch("/mcp", { method: "POST", headers: headers, body: JSON.stringify(body) });
    var newSession = res.headers.get("mcp-session-id");
    if (newSession) sessionId = newSession;
    var sseCount = 0;
    var messages = await readStreamingBody(res, function (ev, parsed) {
      sseCount += 1;
      if (!ev.data) {
        logWire("evt", "SSE priming event", { eventId: ev.id, note: "Stream opened; server assigned this event id for resumability." });
      } else if (parsed && parsed.method) {
        logWire("evt", "SSE " + parsed.method, { eventId: ev.id, body: parsed });
      }
    });
    var latency = Math.round(performance.now() - started);
    var responseMsg = isRequest ? messages.filter(function (m) { return m.id === body.id; })[0] : null;
    if (res.status >= 400) {
      var errPayload = messages[0] || { httpStatus: res.status };
      logWire("err", "HTTP " + res.status + " · " + (label || body.method), { body: errPayload, latencyMs: latency });
      var err = new Error("MCP HTTP " + res.status + ": " + (errPayload.error && errPayload.error.message ? errPayload.error.message : JSON.stringify(errPayload)));
      err.status = res.status; err.payload = errPayload;
      throw err;
    }
    if (isRequest) {
      logWire("res", "HTTP " + res.status + " · " + (label || body.method) + (sseCount ? " · " + sseCount + " SSE events" : ""), {
        body: responseMsg || messages, latencyMs: latency
      });
    } else {
      logWire("res", "HTTP " + res.status + " · " + (label || body.method) + " accepted", { latencyMs: latency });
    }
    if (responseMsg && responseMsg.error) throw new Error(responseMsg.error.message || "JSON-RPC error");
    return responseMsg ? responseMsg.result : null;
  }

  function mcpRequest(method, params) {
    rpcSeq += 1;
    return mcpPost({ jsonrpc: "2.0", id: rpcSeq, method: method, params: params || {} }, method);
  }
  function mcpNotify(method, params) {
    return mcpPost({ jsonrpc: "2.0", method: method, params: params || {} }, method);
  }
  function callTool(name, args) {
    return mcpRequest("tools/call", { name: name, arguments: args || {} });
  }

  async function connectStandaloneStream() {
    streamGeneration += 1;
    var generation = streamGeneration;
    if (streamAbort) { try { streamAbort.abort(); } catch (e) {} }
    streamAbort = new AbortController();
    var headers = { "Accept": "text/event-stream" };
    if (sessionId) { headers["MCP-Session-Id"] = sessionId; headers["MCP-Protocol-Version"] = PROTOCOL; }
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;
    logWire("req", "GET /mcp · standalone SSE stream", { headers: headers, note: "Server→client notification channel; Last-Event-ID set → missed events replay." });
    try {
      var res = await fetch("/mcp", { method: "GET", headers: headers, signal: streamAbort.signal });
      if (!res.ok || !res.body) { logWire("err", "GET /mcp stream → HTTP " + res.status, {}); return; }
      logWire("res", "GET /mcp stream open (HTTP 200, text/event-stream)", {});
      await readStreamingBody(res, function (ev, parsed) {
        if (parsed && parsed.method) logWire("evt", "SSE (standalone) " + parsed.method, { eventId: ev.id, body: parsed });
        else if (ev.id) logWire("evt", "SSE (standalone) priming", { eventId: ev.id });
      });
      if (generation === streamGeneration && sessionId) {
        logWire("info", "Standalone stream closed — reconnecting with Last-Event-ID", { note: "Last-Event-ID: " + (lastEventId || "—") });
        setTimeout(connectStandaloneStream, 1500);
      }
    } catch (e) {
      if (generation === streamGeneration && sessionId && e.name !== "AbortError") {
        setTimeout(connectStandaloneStream, 2500);
      }
    }
  }

  function setConnected(live, text) {
    var badge = $("connBadge");
    badge.classList.toggle("live", !!live);
    $("connText").textContent = text;
    $("wireMeta").textContent = sessionId
      ? "MCP-Protocol-Version: " + PROTOCOL + " · Session " + sessionId.slice(0, 8) + "… · SSE ← " + (lastEventId || "—")
      : "No session yet — click any scenario after connecting.";
  }

  async function initializeMcp() {
    setConnected(false, "Initializing MCP " + PROTOCOL + "…");
    sessionId = null; lastEventId = null;
    var result = await mcpRequest("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: { roots: {}, sampling: {} },
      clientInfo: { name: "EchoCare Echo Show 15 Simulator (Alexa+ host)", version: "1.0.0" }
    });
    await mcpNotify("notifications/initialized", {});
    var toolsResult = await mcpRequest("tools/list", {});
    toolViews = {};
    (toolsResult.tools || []).forEach(function (t) {
      var meta = t._meta || {};
      var uri = (meta.ui && meta.ui.resourceUri) || meta["ui/resourceUri"];
      if (uri) toolViews[t.name] = uri;
    });
    setConnected(true, "MCP " + result.protocolVersion + " · session " + sessionId.slice(0, 8) + "… LIVE");
    logWire("info", "Host ready: " + Object.keys(toolViews).length + " tools bound to ui:// views", { body: toolViews });
    connectStandaloneStream();
    return result;
  }

  async function resetSession() {
    if (sessionId) {
      streamGeneration += 1;
      if (streamAbort) { try { streamAbort.abort(); } catch (e) {} }
      var old = sessionId;
      logWire("req", "DELETE /mcp · terminate session", { headers: { "MCP-Session-Id": old, "MCP-Protocol-Version": PROTOCOL } });
      try {
        var res = await fetch("/mcp", { method: "DELETE", headers: { "MCP-Session-Id": old, "MCP-Protocol-Version": PROTOCOL } });
        logWire("res", "DELETE /mcp → HTTP " + res.status + " (session terminated)", {});
      } catch (e) { logWire("err", "DELETE /mcp failed: " + e.message, {}); }
      sessionId = null;
    }
    await initializeMcp();
  }
  $("resetSessionBtn").addEventListener("click", function () { resetSession().catch(reportError); });

  /* ---------------- Echo Show UX: light bar, captions, TTS ---------------- */
  function setLight(state) {
    var bar = $("lightBar");
    bar.className = "light-bar " + state;
  }
  function showCaptions() { $("captions").hidden = false; }
  async function typeText(el, text, cpsMs) {
    el.textContent = "";
    var step = Math.max(1, Math.round(text.length / 220));
    for (var i = 0; i < text.length; i += step) {
      el.textContent += text.slice(i, i + step);
      await sleep(cpsMs || 9);
    }
  }
  async function sayAsUser(text, typed) {
    showCaptions();
    $("capUser").hidden = false;
    $("capAlexa").hidden = true;
    setLight("listening");
    if (typed) await typeText($("capUserText"), text, 8);
    else $("capUserText").textContent = text;
  }
  function ttsEnabled() { return $("ttsToggle").checked; }
  function speak(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!text) return resolve();
      if (ttsEnabled() && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
          var u = new SpeechSynthesisUtterance(text);
          u.rate = 1.04; u.pitch = 1.02; u.lang = "en-US";
          var voices = window.speechSynthesis.getVoices();
          var preferred = voices.filter(function (v) { return /^en[-_]/i.test(v.lang) && /female|samantha|zira|aria|jenny/i.test(v.name); })[0]
            || voices.filter(function (v) { return /^en[-_]/i.test(v.lang); })[0];
          if (preferred) u.voice = preferred;
          var done = false;
          var finish = function () { if (!done) { done = true; resolve(); } };
          u.onend = finish; u.onerror = finish;
          setTimeout(finish, Math.min(16000, 2500 + text.length * 75));
          window.speechSynthesis.speak(u);
          return;
        } catch (e) { /* fall through to timed resolve */ }
      }
      if (opts.awaitWhenMuted) {
        setTimeout(resolve, Math.min(2800, 700 + text.length * 9));
      } else resolve();
    });
  }
  async function sayAsAlexa(text, opts) {
    if (!text) return;
    showCaptions();
    $("capAlexa").hidden = false;
    $("capAlexaText").textContent = text;
    setLight("speaking");
    await speak(text, opts);
    setLight("idle");
  }
  function reportError(err) {
    console.error(err);
    logWire("err", "Host error: " + (err && err.message ? err.message : err), {});
    setLight("idle");
  }

  /* ---------------- MCP Apps host bridge ---------------- */
  var appFrame = $("appFrame");
  var homeScreen = $("homeScreen");
  var currentViewUri = null;
  var viewHtmlCache = {};
  var pendingAppResult = null; // {toolName, args, result}

  function postToApp(msg) {
    if (appFrame.contentWindow) appFrame.contentWindow.postMessage(msg, "*");
  }
  function deliverToApp(toolName, args, result) {
    postToApp({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: args || {} } });
    postToApp({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
    logWire("bridge", "host → app · ui/notifications/tool-result (" + toolName + ")", {
      body: { structuredContent: result.structuredContent }
    });
  }

  async function showToolResult(toolName, args, result) {
    var sc = result.structuredContent || {};
    var viewUri = sc.view || toolViews[toolName];
    if (!viewUri) return;
    homeScreen.hidden = true;
    appFrame.hidden = false;
    if (viewUri === currentViewUri) {
      deliverToApp(toolName, args, result);
      return;
    }
    currentViewUri = viewUri;
    pendingAppResult = { toolName: toolName, args: args, result: result };
    if (!viewHtmlCache[viewUri]) {
      var read = await mcpRequest("resources/read", { uri: viewUri });
      var content = (read.contents || [])[0] || {};
      viewHtmlCache[viewUri] = content.text || "";
    }
    appFrame.srcdoc = viewHtmlCache[viewUri];
    logWire("bridge", "host loaded MCP App view " + viewUri + " into Echo Show viewport", {});
  }

  function showHome() {
    currentViewUri = null;
    pendingAppResult = null;
    appFrame.hidden = true;
    appFrame.srcdoc = "";
    homeScreen.hidden = false;
    $("captions").hidden = true;
    setLight("idle");
  }
  $("homeBtn").addEventListener("click", showHome);

  window.addEventListener("message", async function (ev) {
    if (!appFrame.contentWindow || ev.source !== appFrame.contentWindow) return;
    var msg = ev.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    if (msg.method === "ui/initialize" && msg.id !== undefined) {
      logWire("bridge", "app → host · ui/initialize", { body: msg.params });
      postToApp({
        jsonrpc: "2.0", id: msg.id,
        result: {
          protocolVersion: APPS_PROTOCOL,
          hostInfo: { name: "Echo Show 15 Simulator (Alexa+)", version: "1.0.0" },
          hostCapabilities: { openLinks: {}, serverTools: {}, logging: {} },
          hostContext: {
            theme: "dark", platform: "web", locale: "en-NG", timeZone: "Africa/Lagos",
            displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"],
            deviceCapabilities: { touch: true, hover: true },
            safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 }
          }
        }
      });
      if (pendingAppResult) {
        var p = pendingAppResult; pendingAppResult = null;
        setTimeout(function () { deliverToApp(p.toolName, p.args, p.result); }, 60);
      }
      return;
    }

    if (msg.method === "tools/call" && msg.id !== undefined) {
      var name = msg.params && msg.params.name;
      var args = (msg.params && msg.params.arguments) || {};
      logWire("bridge", "app → host · tools/call " + name + " (card button)", { body: msg.params });
      try {
        setLight("thinking");
        var result = await callTool(name, args);
        postToApp({ jsonrpc: "2.0", id: msg.id, result: result });
        var sc = result.structuredContent || {};
        if (sc.alexaSays) { sayAsAlexa(sc.alexaSays, {}).catch(reportError); } else setLight("idle");
        if (name === "dispatch_care_circle_digest") refreshBedrockPanel(sc.digest);
        refreshHomeChips();
      } catch (e) {
        postToApp({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e && e.message || e) } });
        reportError(e);
      }
      return;
    }

    if (msg.method === "ui/open-link" && msg.id !== undefined) {
      if (msg.params && msg.params.url) window.open(msg.params.url, "_blank", "noopener");
      postToApp({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }
    if (msg.method === "ui/message" && msg.id !== undefined) {
      postToApp({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }
    if (msg.method) {
      logWire("bridge", "app → host · " + msg.method, { body: msg.params });
    }
  });

  /* ---------------- Tool orchestration (host-initiated) ---------------- */
  var lastTranscript = TRANSCRIPT_BRIGHT;

  async function callToolAndShow(name, args, opts) {
    opts = opts || {};
    setLight("thinking");
    var result = await callTool(name, args);
    await showToolResult(name, args, result);
    var sc = result.structuredContent || {};
    if (opts.speak !== false && sc.alexaSays) {
      await sayAsAlexa(sc.alexaSays, { awaitWhenMuted: !!opts.inDemo });
    } else setLight("idle");
    if (name === "dispatch_care_circle_digest") refreshBedrockPanel(sc.digest);
    refreshHomeChips();
    return result;
  }

  async function scenario1(opts) {
    opts = opts || {};
    await sayAsAlexa("Good morning, Mama Adebayo. " + PROMPT_MEMORY, { awaitWhenMuted: !!opts.inDemo });
    await sayAsUser(TRANSCRIPT_BRIGHT, true);
    lastTranscript = TRANSCRIPT_BRIGHT;
    return callToolAndShow("analyze_cognitive_checkin", {
      action: "analyze", prompt: PROMPT_MEMORY, transcript: TRANSCRIPT_BRIGHT, turnLatenciesMs: LATENCIES_BRIGHT
    }, opts);
  }
  async function scenario2(opts) {
    opts = opts || {};
    await sayAsUser(Q_ADVIL, true);
    return callToolAndShow("verify_medication_safety", { action: "assess", question: Q_ADVIL }, opts);
  }
  async function scenario3(opts) {
    opts = opts || {};
    logWire("info", "Smart-home telemetry anomaly injected → triage_ambient_anomaly (evaluate/stove)", {
      note: "Kitchen burner 375°F · 28 min · no kitchen motion · TV on in living room."
    });
    showCaptions(); $("capUser").hidden = false;
    $("capUserText").textContent = "🏠 Home sensors: stove burner on at 375°F for 28 min — no kitchen motion…";
    await sleep(opts.inDemo ? 900 : 350);
    return callToolAndShow("triage_ambient_anomaly", { action: "evaluate", scenario: "stove" }, opts);
  }
  async function scenario4(opts) {
    opts = opts || {};
    await sayAsUser("Alexa, how is Mama doing today? Send the family an update.", true);
    return callToolAndShow("dispatch_care_circle_digest", { action: "compose" }, opts);
  }

  var scenarioBusy = false;
  function setPillsBusy(busy) {
    document.querySelectorAll(".pill").forEach(function (p) { p.disabled = busy; });
  }
  document.querySelectorAll(".pill").forEach(function (pill) {
    pill.addEventListener("click", async function () {
      if (scenarioBusy || demoRunning) return;
      scenarioBusy = true; setPillsBusy(true);
      document.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("active"); });
      pill.classList.add("active");
      try {
        if (!sessionId) await initializeMcp();
        var n = pill.getAttribute("data-scenario");
        if (n === "1") await scenario1();
        else if (n === "2") await scenario2();
        else if (n === "3") await scenario3();
        else if (n === "4") await scenario4();
      } catch (e) { reportError(e); }
      scenarioBusy = false; setPillsBusy(false);
      setLight("idle");
    });
  });

  /* ---------------- Free-text / voice intent routing ---------------- */
  function routeUtterance(text) {
    var t = text.toLowerCase();
    if (/(advil|ibuprofen|tylenol|acetaminophen|paracetamol|aspirin|naproxen|aleve|motrin|benadryl|diphenhydramine|tramadol|pill|medicine|medication|dose|tablet|pharmac|take two|can i take)/.test(t))
      return { tool: "verify_medication_safety", args: { action: "assess", question: text }, why: "medication-safety intent" };
    if (/(stove|burner|smoke|fire|unlocked|pacing|wandering|leak|sensor|kitchen|door|night)/.test(t))
      return { tool: "triage_ambient_anomaly", args: { action: "evaluate", scenario: /(night|pacing|wandering|unlocked|2:40)/.test(t) ? "night" : "stove" }, why: "home-safety intent" };
    if (/(save).*(memory|story|album)/.test(t))
      return { tool: "analyze_cognitive_checkin", args: { action: "save_memory", transcript: lastTranscript }, why: "save-memory intent" };
    if (/(clinical|export|doctor|okafor)/.test(t))
      return { tool: "dispatch_care_circle_digest", args: { action: "export" }, why: "clinical-export intent" };
    if (/(digest|family|Tolu|Kunle|update|report|summary|how is|care circle)/.test(t))
      return { tool: "dispatch_care_circle_digest", args: { action: "compose" }, why: "caregiver-digest intent" };
    return { tool: "analyze_cognitive_checkin", args: { action: "analyze", prompt: PROMPT_MEMORY, transcript: text, turnLatenciesMs: [1100, 1250, 1080] }, why: "conversation → cognitive biomarkers" };
  }

  $("inputForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var text = $("textInput").value.trim();
    if (!text || scenarioBusy || demoRunning) return;
    $("textInput").value = "";
    scenarioBusy = true; setPillsBusy(true);
    try {
      if (!sessionId) await initializeMcp();
      await sayAsUser(text, false);
      if (routeUtterance(text).tool === "analyze_cognitive_checkin") lastTranscript = text;
      var route = routeUtterance(text);
      logWire("info", "Alexa+ NLU route → " + route.tool + " (" + route.why + ")", {});
      await callToolAndShow(route.tool, route.args, {});
    } catch (e) { reportError(e); }
    scenarioBusy = false; setPillsBusy(false);
  });

  /* Microphone (Web Speech API) */
  var recognition = null;
  $("micBtn").addEventListener("click", function () {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      logWire("err", "Web Speech API not available in this browser — type instead 🎙️", {});
      $("textInput").focus();
      return;
    }
    if (recognition) { recognition.stop(); recognition = null; $("micBtn").classList.remove("rec"); return; }
    recognition = new SR();
    recognition.lang = "en-US"; recognition.interimResults = false; recognition.maxAlternatives = 1;
    $("micBtn").classList.add("rec"); setLight("listening");
    recognition.onresult = function (e) {
      var said = e.results[0][0].transcript;
      $("textInput").value = said;
      $("inputForm").dispatchEvent(new Event("submit", { cancelable: true }));
    };
    recognition.onend = function () { recognition = null; $("micBtn").classList.remove("rec"); if (!scenarioBusy) setLight("idle"); };
    recognition.onerror = function () { recognition = null; $("micBtn").classList.remove("rec"); setLight("idle"); };
    recognition.start();
  });

  /* ---------------- Tabs ---------------- */
  function activateTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-tab") === name); });
    ["wire", "audit", "skill"].forEach(function (n) { $("panel-" + n).hidden = n !== name; });
  }
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () { activateTab(tab.getAttribute("data-tab")); });
  });

  /* ---------------- Compliance audit ---------------- */
  async function runAudit(quiet) {
    var btn = $("runAudit");
    btn.disabled = true; btn.textContent = "Running 8 live checks against /mcp…";
    try {
      var res = await fetch("/api/audit", { method: "POST" });
      var report = await res.json();
      if (!res.ok) throw new Error(report.error || "audit failed");
      var s = report.summary;
      var summary = $("auditSummary");
      summary.hidden = false;
      summary.innerHTML = (s.failed === 0 ? "🏆 " : "⚠️ ") + s.passed + "/" + s.total + " checks passed · protocol " + esc(report.protocolVersion) +
        " · " + report.durationMs + " ms · server <code>" + esc((report.serverInfo || {}).name || "") + "</code>" +
        '<div class="small muted" style="margin-top:4px">Session exercised &amp; terminated by the audit: <code>' + esc(report.sessionId || "") + "</code></div>";
      $("auditList").innerHTML = report.checks.map(function (c, i) {
        return '<div class="check ' + (c.passed ? "pass" : "fail") + '"><div class="check-top"><span>' + (c.passed ? "✅" : "❌") + "</span><span>" + (i + 1) + ". " + esc(c.name) + '</span><span class="lat">' + c.latencyMs + ' ms</span></div>' +
          '<div class="spec">' + esc(c.spec) + '</div><div class="detail">' + esc(c.detail) + "</div></div>";
      }).join("");
      if (!quiet) logWire("info", "Compliance audit: " + s.passed + "/" + s.total + " passed via alexa-mcp-2025-kit", {});
      return report;
    } finally {
      btn.disabled = false; btn.textContent = "▶ Run Live Compliance Audit";
    }
  }
  $("runAudit").addEventListener("click", function () { runAudit(false).catch(reportError); });

  /* ---------------- Skill & Bedrock panels ---------------- */
  function refreshBedrockPanel(digest) {
    if (!digest) return;
    $("bedrockCard").innerHTML =
      "<b>AWS Bedrock Runtime</b> · mode <code>" + esc(digest.mode) + "</code><br/>Model <code>" + esc(digest.bedrockModelId) + "</code> · Region <code>" + esc(digest.awsRegion) + "</code><br/>" +
      "Peace-of-Mind <b>" + digest.peaceOfMindScore + "/100 (" + esc(digest.peaceOfMindBand) + ")</b> · composed " + esc(digest.generatedAt) +
      (digest.mode === "aws-bedrock-simulated" ? '<br/><span class="muted small">Zero-key deterministic simulation — set <code>AWS_ACCESS_KEY_ID</code> + <code>AWS_REGION</code> and the same pipeline calls Bedrock Converse live.</span>' : "");
    $("traceList").innerHTML = digest.trace.map(function (t) {
      return '<div class="trace-item"><b>' + esc(t.agent) + "</b> · " + esc(t.action) + " · " + t.latencyMs + " ms · <code>" + esc(t.runtime) + "</code>" +
        (t.tokensIn ? " · tokens " + t.tokensIn + "→" + t.tokensOut : "") +
        '<div class="muted small">' + esc(t.detail) + "</div></div>";
    }).join("");
  }
  async function loadSkillPanel() {
    try {
      var [skillRes, stateRes, healthRes] = await Promise.all([fetch("/api/skill"), fetch("/api/state"), fetch("/health")]);
      var skill = await skillRes.json(); var state = await stateRes.json(); var health = await healthRes.json();
      var fm = skill.frontmatter || {};
      var toolNames = (fm.tools || []).map(function (t) { return t.name; });
      $("skillMeta").innerHTML =
        '<span class="hchip">name: <b>' + esc(skill.name) + "</b></span>" +
        '<span class="hchip">version: ' + esc(skill.version || "") + "</span>" +
        '<span class="hchip">tools: ' + esc(toolNames.join(" · ")) + "</span>" +
        '<span class="hchip">loaded ' + esc(skill.loadedAt) + "</span>";
      $("skillBody").textContent = skill.rawMarkdown;
      if (!state.bedrock.lastTrace || !state.bedrock.lastTrace.length) {
        $("bedrockCard").innerHTML =
          "<b>AWS Bedrock Runtime</b> · mode <code>" + esc(health.bedrock.mode) + "</code><br/>Model <code>" + esc(health.bedrock.modelId) + "</code> · Region <code>" + esc(health.bedrock.region) + "</code><br/>" +
          '<span class="muted small">Run Scenario 4 to execute the Strands agent graph (CognitiveAnalyst → MedicationGuardian → SafetyTriageOfficer → DigestComposer).</span>';
      } else if (state.bedrock.lastTrace.length) {
        // keep existing digest panel if already rendered from a tool result
        if ($("traceList").textContent.indexOf("No digest run") !== -1) {
          $("traceList").innerHTML = state.bedrock.lastTrace.map(function (t) {
            return '<div class="trace-item"><b>' + esc(t.agent) + "</b> · " + esc(t.action) + " · " + t.latencyMs + " ms · <code>" + esc(t.runtime) + '</code><div class="muted small">' + esc(t.detail) + "</div></div>";
          }).join("");
        }
      }
    } catch (e) { $("skillBody").textContent = "Failed to load: " + e.message; }
  }
  async function refreshHomeChips() {
    try {
      var res = await fetch("/api/state");
      var s = await res.json();
      var d = s.day;
      $("homeChips").innerHTML =
        '<span class="hchip">💊 ' + d.adherence.confirmed + "/" + d.adherence.scheduled + " doses · " + d.adherence.pct + "%</span>" +
        '<span class="hchip">💧 ' + d.hydration.glasses + "/" + d.hydration.goal + " glasses</span>" +
        '<span class="hchip">🧠 ' + (d.lastDrift ? "Composite " + d.lastDrift.todayComposite + " · " + d.lastDrift.alertLevel : "Baseline steady · 7 days") + "</span>" +
        (d.preventedInteractions.length ? '<span class="hchip">🛑 ' + d.preventedInteractions.length + " unsafe dose prevented</span>" : "") +
        (d.resolvedAnomalies.length ? '<span class="hchip">🛡️ ' + d.resolvedAnomalies.length + " anomaly resolved</span>" : "");
    } catch (e) { /* non-fatal */ }
  }

  /* ---------------- Clock ---------------- */
  function tickClock() {
    try {
      var now = new Date();
      var time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
      var date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
      $("clock").textContent = time + " WAT";
      $("homeTime").textContent = time;
      $("homeDate").textContent = date + " · Ibadan";
    } catch (e) {}
  }
  setInterval(tickClock, 1000); tickClock();

  /* ---------------- Auto-Play 90s Demo ---------------- */
  var demoRunning = false;
  var demoToken = 0;
  function setDemoProgress(pct, caption) {
    $("demoProgressFill").style.width = pct + "%";
    if (caption) $("demoCaption").textContent = caption;
  }
  function demoGuard(token) { if (token !== demoToken) throw new Error("demo-stopped"); }

  async function runAutoDemo() {
    demoRunning = true; demoToken += 1;
    var token = demoToken;
    var btn = $("demoBtn");
    btn.classList.add("running"); btn.textContent = "⏳ Demo playing…";
    $("demoProgress").hidden = false;
    setPillsBusy(true);
    var inDemo = { inDemo: true };
    try {
      if (!sessionId) await initializeMcp();
      activateTab("wire");

      setDemoProgress(4, "🎬 0:00 — One home in Lagos. Mama Adebayo, 74, lives independently. EchoCare watches quietly over MCP 2025-11-25.");
      showHome(); await sleep(1800); demoGuard(token);

      setDemoProgress(12, "🧠 Act 1 — A morning story doubles as cognitive-biomarker screening (MATTR · pronoun drift · idea density).");
      await scenario1(inDemo); demoGuard(token);

      setDemoProgress(30, "💾 She taps “Save” — the memory card joins the family album (tools/call over the MCP Apps bridge).");
      await callToolAndShow("analyze_cognitive_checkin", { action: "save_memory", transcript: lastTranscript }, inDemo); demoGuard(token);
      await sleep(600);

      setDemoProgress(42, "💊 Act 2 — “My knee hurts…” The Medication Guardian checks Advil against Apixaban + Lisinopril BEFORE confirmation.");
      await scenario2(inDemo); demoGuard(token);

      setDemoProgress(56, "✅ CRITICAL interaction blocked. Alexa+ offers the safe alternative — and confirms it instead.");
      await sayAsUser(Q_TYLENOL, true); demoGuard(token);
      await callToolAndShow("verify_medication_safety", { action: "assess", question: Q_TYLENOL }, inDemo); demoGuard(token);
      await callToolAndShow("verify_medication_safety", { action: "confirm_dose", question: Q_TYLENOL }, inDemo); demoGuard(token);

      setDemoProgress(68, "🔥 Act 3 — Sensors spot the unattended stove. Stage 1: a calm, non-startling check-in.");
      var triageResult = await scenario3(inDemo); demoGuard(token);
      var incidentId = triageResult.structuredContent.incident.incidentId;

      setDemoProgress(78, "🔌 She agrees — Stage 2: the smart relay cuts the burner. No alarms, no panic, family not disturbed.");
      await sleep(1400); demoGuard(token);
      await callToolAndShow("triage_ambient_anomaly", { action: "relay_off", incidentId: incidentId }, inDemo); demoGuard(token);

      setDemoProgress(86, "👨‍👩‍👧 Act 4 — Four AWS Bedrock/Strands agents synthesize the day into one Peace-of-Mind digest.");
      await scenario4(inDemo); demoGuard(token);
      await callToolAndShow("dispatch_care_circle_digest", { action: "send" }, inDemo); demoGuard(token);

      setDemoProgress(94, "✅ Finale — the open-source alexa-mcp-2025-kit audits this very server: 8 live MCP 2025-11-25 checks.");
      activateTab("audit");
      var report = await runAudit(true); demoGuard(token);
      setDemoProgress(100, "🏆 " + report.summary.passed + "/" + report.summary.total + " compliance checks passed. EchoCare Kinship — independence, with a guardian. ❤️");
      await sayAsAlexa("And that's EchoCare Kinship. Mama Adebayo stays independent — and her family sleeps easy.", { awaitWhenMuted: true });
      setTimeout(function () { activateTab("wire"); }, 3500);
    } catch (e) {
      if (e && e.message === "demo-stopped") {
        setDemoProgress(0, "⏹ Demo stopped. Tap any scenario pill to explore manually.");
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      } else reportError(e);
    } finally {
      demoRunning = false;
      btn.classList.remove("running"); btn.textContent = "▶ Auto-Play 90s Hackathon Demo";
      setPillsBusy(false);
      setLight("idle");
    }
  }
  $("demoBtn").addEventListener("click", function () { if (!demoRunning) runAutoDemo(); });
  $("demoStop").addEventListener("click", function () { demoToken += 1; });

  /* ---------------- Boot ---------------- */
  loadSkillPanel();
  refreshHomeChips();
  initializeMcp().catch(reportError);
})();
