/**
 * MCP App views (`ui://echocare/*`) — self-contained interactive HTML cards.
 *
 * Each view speaks the MCP Apps bridge protocol over postMessage:
 *   app → host : `ui/initialize`, `tools/call`, `ui/notifications/size-changed`
 *   host → app : initialize result, `ui/notifications/tool-input`,
 *                `ui/notifications/tool-result`
 * so the exact same HTML renders in our Echo Show 15 simulator AND in any
 * spec-compliant MCP Apps host (Claude, ChatGPT, VS Code, …).
 */

const SHARED_CSS = `
:root{
  --bg:var(--color-background-primary,#0b1226);
  --bg2:var(--color-background-secondary,#141d3d);
  --card:#17224a;
  --ink:var(--color-text-primary,#f4f7ff);
  --muted:var(--color-text-secondary,#a9b6dd);
  --cyan:#31c4f3; --indigo:#4f6df5; --green:#2ecc71; --amber:#ffb020; --red:#ff5252;
  --radius:16px;
  font-family:var(--font-sans,"Amazon Ember","Segoe UI",system-ui,sans-serif);
}
*{box-sizing:border-box}
body{margin:0;background:linear-gradient(150deg,var(--bg),#0a0f22 70%);color:var(--ink);font-size:17px;line-height:1.45;padding:18px}
h1{font-size:24px;margin:0 0 2px}
h2{font-size:19px;margin:14px 0 8px}
.sub{color:var(--muted);font-size:14.5px;margin-bottom:12px}
.card{background:linear-gradient(160deg,var(--card),#101a3f);border:1px solid rgba(49,196,243,.22);border-radius:var(--radius);padding:14px 16px;margin:10px 0}
.row{display:flex;gap:10px;flex-wrap:wrap}
.chip{background:rgba(49,196,243,.12);border:1px solid rgba(49,196,243,.35);color:#bfeaff;border-radius:999px;padding:4px 11px;font-size:13.5px}
.bar{height:11px;border-radius:99px;background:rgba(255,255,255,.10);overflow:hidden;margin:5px 0 3px}
.bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--indigo),var(--cyan));transition:width .8s ease}
.bar.warn>i{background:linear-gradient(90deg,#c77700,var(--amber))}
.bar.bad>i{background:linear-gradient(90deg,#c0392b,var(--red))}
.metric{display:flex;justify-content:space-between;font-size:14.5px}
.metric b{font-size:15.5px}
.big{font-size:44px;font-weight:800;line-height:1}
button{cursor:pointer;border:0;border-radius:12px;padding:12px 16px;font-size:16px;font-weight:700;color:#04121f;background:linear-gradient(90deg,var(--cyan),#7fe0ff);}
button:hover{filter:brightness(1.1)}
button.secondary{background:transparent;color:#bfeaff;border:1.5px solid rgba(49,196,243,.55)}
button.danger{background:linear-gradient(90deg,#ff6b6b,#ffb199);color:#2a0603}
button[disabled]{opacity:.45;cursor:not-allowed}
.btnrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.banner{border-radius:14px;padding:13px 15px;font-weight:700;border:1.5px solid}
.banner.red{background:rgba(255,82,82,.14);border-color:var(--red);color:#ffd7d7}
.banner.amber{background:rgba(255,176,32,.13);border-color:var(--amber);color:#ffe9bd}
.banner.green{background:rgba(46,204,113,.13);border-color:var(--green);color:#d2ffe4}
.muted{color:var(--muted)} .small{font-size:13.5px}
.quote{font-style:italic;background:rgba(255,255,255,.05);border-left:4px solid var(--cyan);padding:10px 14px;border-radius:8px}
ul{margin:6px 0 6px 18px;padding:0} li{margin:4px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.center{text-align:center}
.wait{padding:34px 10px;text-align:center;color:var(--muted)}
.pulse{display:inline-block;width:12px;height:12px;border-radius:99px;background:var(--cyan);animation:pl 1.1s infinite alternate}
@keyframes pl{from{transform:scale(.7);opacity:.5}to{transform:scale(1.25);opacity:1}}
svg text{fill:var(--muted);font-size:10px}
`;

function bridgeJs(appName: string): string {
  return `
<script>
(function(){
  var rpcId = 100; var pending = {};
  function send(msg){ window.parent.postMessage(msg, "*"); }
  function notifySize(){ try{ send({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}}); }catch(e){} }
  window.__echocare = {
    onToolResult: null,
    toolInput: null,
    notifySize: notifySize,
    callTool: function(name, args){
      return new Promise(function(resolve, reject){
        var id = ++rpcId; pending[id] = {resolve:resolve, reject:reject};
        send({jsonrpc:"2.0", id:id, method:"tools/call", params:{name:name, arguments:args||{}}});
      });
    }
  };
  window.addEventListener("message", function(ev){
    var msg = ev.data; if(!msg || msg.jsonrpc !== "2.0") return;
    if(msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)){
      if(msg.id === 1){ send({jsonrpc:"2.0", method:"ui/notifications/initialized"}); return; }
      var p = pending[msg.id];
      if(p){ delete pending[msg.id]; if(msg.error) p.reject(msg.error); else p.resolve(msg.result); }
      return;
    }
    if(msg.method === "ui/notifications/tool-input"){ window.__echocare.toolInput = msg.params && msg.params.arguments; }
    if(msg.method === "ui/notifications/tool-result" && window.__echocare.onToolResult){ window.__echocare.onToolResult(msg.params); notifySize(); }
  });
  send({jsonrpc:"2.0", id:1, method:"ui/initialize", params:{appInfo:{name:"${appName}",version:"1.0.0"}, appCapabilities:{}, protocolVersion:"2026-01-26"}});
})();
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function busy(btn, promise){ if(!btn) return promise; var old = btn.innerHTML; btn.disabled = true; btn.innerHTML = "Working…"; return promise.then(function(r){ btn.disabled=false; btn.innerHTML=old; return r; }, function(e){ btn.disabled=false; btn.innerHTML=old; throw e; }); }
</script>`;
}

function page(appName: string, title: string, bodyHtml: string, script: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>${SHARED_CSS}</style>
</head>
<body>
<div id="app">${bodyHtml}</div>
${bridgeJs(appName)}
<script>${script}</script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* ui://echocare/memory-lane                                                  */
/* -------------------------------------------------------------------------- */

export function memoryLaneHtml(): string {
  const body = `<div class="wait"><span class="pulse"></span><p>Alexa+ is listening to Mama Adebayo's story…</p></div>`;
  const script = `
var app = document.getElementById("app");
function bar(label, val, suffix, cls){
  return '<div style="flex:1 1 190px"><div class="metric"><span>'+esc(label)+'</span><b>'+val+(suffix||"")+'</b></div><div class="bar '+(cls||"")+'"><i style="width:'+Math.max(2,Math.min(100,val))+'%"></i></div></div>';
}
function sparkline(points){
  if(!points || !points.length) return "";
  var w=520,h=92,pad=14, vals=points.map(function(p){return p.composite;});
  var min=Math.min.apply(null,vals.concat([40])), max=Math.max.apply(null,vals.concat([95]));
  var stepX=(w-pad*2)/Math.max(1,points.length-1);
  var coords=points.map(function(p,i){ var x=pad+i*stepX; var y=h-12-((p.composite-min)/(max-min))*(h-30); return {x:x,y:y,p:p}; });
  var line=coords.map(function(c){return c.x.toFixed(1)+","+c.y.toFixed(1);}).join(" ");
  var dots=coords.map(function(c,i){ var today=i===coords.length-1; return '<circle cx="'+c.x+'" cy="'+c.y+'" r="'+(today?5:3.5)+'" fill="'+(today?"#ffb020":"#31c4f3")+'"/><text x="'+(c.x-10)+'" y="'+(h-1)+'">'+esc(c.p.day)+'</text><text x="'+(c.x-8)+'" y="'+(c.y-8)+'">'+c.p.composite+'</text>'; }).join("");
  return '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" role="img" aria-label="7 day cognitive trend"><polyline points="'+line+'" fill="none" stroke="#31c4f3" stroke-width="2.5"/>'+dots+'</svg>';
}
function render(d){
  var r = d.report, drift = d.drift;
  var driftCls = drift.alertLevel === "steady" ? "green" : (drift.alertLevel === "watch" ? "amber" : "red");
  var driftIcon = drift.alertLevel === "steady" ? "✅" : (drift.alertLevel === "watch" ? "👀" : "⚠️");
  app.innerHTML =
    '<h1>🧠 Memory Lane</h1><div class="sub">Morning reminiscence check-in · ui://echocare/memory-lane · MCP tool: analyze_cognitive_checkin</div>'
    + '<div class="card"><div class="muted small">Alexa+ asked:</div><div style="font-size:19px">“'+esc(d.prompt)+'”</div></div>'
    + '<div class="quote">“'+esc(d.transcript)+'”</div>'
    + '<div class="card"><div class="row" style="align-items:center"><div class="center" style="min-width:130px"><div class="big" style="color:#7fe0ff">'+r.compositeScore+'</div><div class="muted small">Cognitive Wellness<br/>(0–100)</div></div>'
    + '<div style="flex:2 1 320px;display:flex;gap:14px;flex-wrap:wrap">'
    + bar("Lexical diversity", r.subScores.lexicalDiversity)
    + bar("Word retrieval", r.subScores.wordRetrieval, "", r.subScores.wordRetrieval<55?"bad":(r.subScores.wordRetrieval<72?"warn":""))
    + bar("Idea density", r.subScores.ideaDensity)
    + bar("Orientation", r.subScores.orientation)
    + bar("Fluency", r.subScores.fluency)
    + '</div></div>'
    + '<div class="row" style="margin-top:10px">'
    + '<span class="chip">MATTR '+r.mattr+'</span>'
    + '<span class="chip">Pronoun→noun drift '+r.pronounNounRatio+'</span>'
    + '<span class="chip">Idea density '+r.ideaDensity+'/10 words</span>'
    + '<span class="chip">Mean word-finding pause '+r.latency.meanMs+' ms</span>'
    + '<span class="chip">Filled pauses '+r.filledPausesPer100Words+'/100w</span>'
    + (r.orientation.matchedPeople.length?'<span class="chip">Remembered: '+esc(r.orientation.matchedPeople.join(", "))+'</span>':"")
    + '</div></div>'
    + '<div class="card"><h2 style="margin-top:0">7-day personal baseline</h2>'+sparkline(drift.sparkline)
    + '<div class="banner '+driftCls+'">'+driftIcon+' '+esc(drift.message)+'</div></div>'
    + '<div class="btnrow"><button id="saveBtn">💾 Save Memory to Family Album</button>'
    + '<button class="secondary" id="driftBtn">▶ Demo: Early-Drift Sample</button></div>'
    + '<div id="saved" class="small muted" style="margin-top:8px">'+(d.savedToAlbum ? "Saved to the family album ✓ (with Mama Adebayo's tap-consent)" : "")+'</div>';
  document.getElementById("saveBtn").addEventListener("click", function(ev){
    busy(ev.target, window.__echocare.callTool("analyze_cognitive_checkin", {action:"save_memory", transcript:d.transcript, prompt:d.prompt}))
      .then(function(res){ render(res.structuredContent); });
  });
  document.getElementById("driftBtn").addEventListener("click", function(ev){
    busy(ev.target, window.__echocare.callTool("analyze_cognitive_checkin", {action:"analyze", sample:"drift"}))
      .then(function(res){ render(res.structuredContent); });
  });
  window.__echocare.notifySize();
}
window.__echocare.onToolResult = function(result){ if(result && result.structuredContent) render(result.structuredContent); };
`;
  return page("echocare-memory-lane", "EchoCare Memory Lane", body, script);
}

/* -------------------------------------------------------------------------- */
/* ui://echocare/med-guardian                                                 */
/* -------------------------------------------------------------------------- */

export function medGuardianHtml(): string {
  const body = `<div class="wait"><span class="pulse"></span><p>Checking Mama Adebayo's medicines for safety…</p></div>`;
  const script = `
var app = document.getElementById("app");
function sevChip(s){ var c = s==="CRITICAL"||s==="SEVERE" ? "#ff5252" : (s==="MODERATE" ? "#ffb020" : "#2ecc71"); return '<span class="chip" style="border-color:'+c+';color:'+c+'">'+s+'</span>'; }
function render(d){
  var a = d.assessment;
  var bannerCls = a.verdict==="BLOCK" ? "red" : (a.verdict==="CAUTION" ? "amber" : "green");
  var bannerIcon = a.verdict==="BLOCK" ? "🛑" : (a.verdict==="CAUTION" ? "⚠️" : "✅");
  var interactions = a.interactions.map(function(i){
    return '<div class="card" style="margin:8px 0"><div class="row" style="justify-content:space-between;align-items:center"><b>'+esc(i.pair[0])+' + '+esc(i.pair[1])+'</b>'+sevChip(i.severity)+'</div>'
      + '<div style="margin-top:6px">'+esc(i.clinicalEffect)+'</div>'
      + (i.relativeRisk ? '<div class="chip" style="margin:6px 6px 0 0">'+esc(i.relativeRisk)+'</div>' : "")
      + '<div class="small muted" style="margin-top:6px"><b>Mechanism:</b> '+esc(i.mechanism)+'</div>'
      + (i.beersCriteria ? '<div class="small" style="margin-top:4px">📋 '+esc(i.beersCriteria)+'</div>' : "")
      + '</div>';
  }).join("");
  var pills = d.activeMedications.map(function(m){
    return '<div class="card" style="margin:0"><div style="font-size:22px">💊 <b>'+esc(m.drug)+'</b></div><div>'+esc(m.dose)+' · '+esc(m.schedule)+'</div><div class="small muted">'+esc(m.purpose)+(m.brand?' · '+esc(m.brand):"")+'</div></div>';
  }).join("");
  var alts = a.safeAlternatives.map(function(s){ return '<li><b>'+esc(s.option)+'</b><br/><span class="small muted">'+esc(s.rationale)+'</span></li>'; }).join("");
  var acb = a.anticholinergicBurden;
  app.innerHTML =
    '<h1>💊 Medication Guardian</h1><div class="sub">Geriatric interaction & Beers-criteria check · ui://echocare/med-guardian</div>'
    + '<div class="quote">“'+esc(d.question)+'”</div>'
    + '<div class="banner '+bannerCls+'" style="margin-top:10px">'+bannerIcon+' '+esc(a.headline)+'<div style="font-weight:400;margin-top:5px">'+esc(a.plainLanguageExplanation)+'</div></div>'
    + (interactions ? '<h2>Interactions detected</h2>'+interactions : '<div class="card">No significant interactions found against the active schedule.</div>')
    + '<h2>Safer options</h2><div class="card"><ul>'+alts+'</ul>'
    + '<div class="small muted">Anticholinergic burden (ACB): now '+acb.current+' → with '+esc(a.requestedMedication)+' '+acb.withRequested+' (clinical threshold '+acb.threshold+')'+(acb.exceedsThreshold?' — EXCEEDED':'')+'</div></div>'
    + '<h2>Mama Adebayo\\'s morning pills</h2><div class="grid">'+pills+'</div>'
    + '<div class="btnrow"><button id="confirmBtn" '+(d.confirmationAllowed?"":"disabled")+'>✅ Confirm Morning Dose Taken</button>'
    + '<button class="danger" id="alertBtn">📞 Alert Daughter &amp; Pharmacist</button></div>'
    + '<div id="status" class="small" style="margin-top:8px">'+esc(d.statusLine||"")+'</div>';
  var cb = document.getElementById("confirmBtn");
  if(cb) cb.addEventListener("click", function(ev){
    busy(ev.target, window.__echocare.callTool("verify_medication_safety", {action:"confirm_dose", question:d.question}))
      .then(function(res){ render(res.structuredContent); });
  });
  document.getElementById("alertBtn").addEventListener("click", function(ev){
    busy(ev.target, window.__echocare.callTool("verify_medication_safety", {action:"alert_contacts", question:d.question}))
      .then(function(res){ render(res.structuredContent); });
  });
  window.__echocare.notifySize();
}
window.__echocare.onToolResult = function(result){ if(result && result.structuredContent) render(result.structuredContent); };
`;
  return page("echocare-med-guardian", "EchoCare Medication Guardian", body, script);
}

/* -------------------------------------------------------------------------- */
/* ui://echocare/safety-shield                                                */
/* -------------------------------------------------------------------------- */

export function safetyShieldHtml(): string {
  const body = `<div class="wait"><span class="pulse"></span><p>Reading home sensors…</p></div>`;
  const script = `
var app = document.getElementById("app");
var timer = null;
function cell(icon, label, value, danger){
  return '<div class="card" style="margin:0;'+(danger?'border-color:#ff5252':'')+'"><div style="font-size:21px">'+icon+' <b>'+esc(label)+'</b></div><div class="'+(danger?'':'muted')+'" style="'+(danger?'color:#ffb3b3':'')+'">'+esc(value)+'</div></div>';
}
function render(d){
  if(timer) { clearInterval(timer); timer = null; }
  var inc = d.incident, s = inc.snapshot.sensors;
  var stageLabel = inc.stage==="stage1-checkin" ? "Stage 1 · Gentle check-in" : inc.stage==="resolved" ? "Resolved ✓" : inc.stage==="snoozed" ? "Snoozed (cooking confirmed)" : inc.stage==="stage3-escalated" ? "Stage 3 · Family alerted" : "Monitoring";
  var riskCls = inc.riskScore>=75?"bad":(inc.riskScore>=50?"warn":"");
  var factors = inc.riskFactors.map(function(f){ return '<li><b>'+esc(f.signal)+'</b> (+'+f.weight+')<br/><span class="small muted">'+esc(f.detail)+'</span></li>'; }).join("");
  var timeline = inc.timeline.map(function(t){ return '<li class="small"><span class="muted">'+esc(String(t.at).slice(11,19))+'</span> '+esc(t.event)+'</li>'; }).join("");
  app.innerHTML =
    '<h1>🛡️ Safety Shield</h1><div class="sub">'+esc(inc.scenario)+' · '+esc(inc.incidentId)+' · ui://echocare/safety-shield</div>'
    + '<div class="card"><div class="metric"><span>Home risk score</span><b>'+inc.riskScore+'/100 · '+esc(inc.riskBand.toUpperCase())+'</b></div><div class="bar '+riskCls+'"><i style="width:'+inc.riskScore+'%"></i></div>'
    + '<div class="row" style="margin-top:8px"><span class="chip">'+esc(stageLabel)+'</span><span class="chip">Stove relay: '+(inc.stoveRelayOn?"ON":"OFF")+'</span>'+(inc.stage==="stage1-checkin"?'<span class="chip" id="countChip">Escalates in 60 s</span>':"")+'</div></div>'
    + '<div class="banner '+(inc.stage==="resolved"?"green":(inc.stage==="stage3-escalated"?"red":"amber"))+'">🗣️ “'+esc(d.alexaSays || inc.alexaPrompt)+'”</div>'
    + '<h2>Room &amp; sensor matrix</h2><div class="grid">'
    + cell("🍳","Kitchen stove", s.stoveBurner.on ? ("ON · "+s.stoveBurner.temperatureF+"°F · "+s.stoveBurner.onMinutes+" min") : "OFF · relay open", s.stoveBurner.on && s.stoveBurner.onMinutes>=20)
    + cell("👣","Kitchen motion", "None for "+s.kitchenMotionMinutesAgo+" min", s.kitchenMotionMinutesAgo>=20 && s.stoveBurner.on)
    + cell("🛋️","Living room", (s.livingRoomOccupied?"Occupied":"Empty")+(s.livingRoomTvOn?" · TV on":""), false)
    + cell("🔐","Front door", s.frontDoorLocked?"Locked ✓":"UNLOCKED", !s.frontDoorLocked)
    + cell("🚪","Hallway pacing", s.hallwayPacingMinutes+" min", s.hallwayPacingMinutes>=10)
    + cell("💧","Leak / smoke", (s.waterLeak?"LEAK":"Dry")+" · "+(s.smokeDetected?"SMOKE":"No smoke"), s.waterLeak||s.smokeDetected)
    + '</div>'
    + (factors ? '<div class="card"><b>Why EchoCare is concerned</b><ul>'+factors+'</ul></div>' : "")
    + '<div class="btnrow"><button class="danger" id="relayBtn">🔌 Turn Off Stove Relay Now</button><button id="snoozeBtn">👵 I\\'m Cooking — Snooze 15m</button><button class="secondary" id="okBtn">🙂 I\\'m Alright</button></div>'
    + '<div class="card"><b>Incident timeline</b><ul style="list-style:none;margin-left:2px">'+timeline+'</ul></div>';
  function act(action){ return function(ev){ busy(ev.target, window.__echocare.callTool("triage_ambient_anomaly", {action:action, incidentId:inc.incidentId})).then(function(res){ render(res.structuredContent); }); }; }
  document.getElementById("relayBtn").addEventListener("click", act("relay_off"));
  document.getElementById("snoozeBtn").addEventListener("click", act("snooze"));
  document.getElementById("okBtn").addEventListener("click", act("acknowledge"));
  if(inc.stage === "stage1-checkin"){
    var left = 60; var chip = document.getElementById("countChip");
    timer = setInterval(function(){
      left -= 1;
      if(chip) chip.textContent = "Escalates in " + left + " s";
      if(left <= 0){
        clearInterval(timer); timer = null;
        window.__echocare.callTool("triage_ambient_anomaly", {action:"escalate", incidentId:inc.incidentId}).then(function(res){ render(res.structuredContent); });
      }
    }, 1000);
  }
  window.__echocare.notifySize();
}
window.__echocare.onToolResult = function(result){ if(result && result.structuredContent) render(result.structuredContent); };
`;
  return page("echocare-safety-shield", "EchoCare Safety Shield", body, script);
}

/* -------------------------------------------------------------------------- */
/* ui://echocare/care-circle                                                 */
/* -------------------------------------------------------------------------- */

export function careCircleHtml(): string {
  const body = `<div class="wait"><span class="pulse"></span><p>AWS Bedrock agents are composing today's digest…</p></div>`;
  const script = `
var app = document.getElementById("app");
function donut(score){
  var r=44, c=2*Math.PI*r, filled=c*score/100;
  var col = score>=85?"#2ecc71":(score>=70?"#31c4f3":(score>=50?"#ffb020":"#ff5252"));
  return '<svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="'+r+'" stroke="rgba(255,255,255,.12)" stroke-width="11" fill="none"/><circle cx="60" cy="60" r="'+r+'" stroke="'+col+'" stroke-width="11" fill="none" stroke-linecap="round" stroke-dasharray="'+filled.toFixed(1)+' '+c.toFixed(1)+'" transform="rotate(-90 60 60)"/><text x="60" y="60" text-anchor="middle" style="font-size:26px;font-weight:800;fill:#fff">'+score+'</text><text x="60" y="80" text-anchor="middle">/ 100</text></svg>';
}
function render(d){
  var g = d.digest;
  var sections = g.sections.map(function(s){
    var col = s.status==="good" ? "#2ecc71" : (s.status==="watch" ? "#ffb020" : "#ff5252");
    return '<div class="card" style="margin:0;border-top:3.5px solid '+col+'"><b>'+esc(s.icon)+' '+esc(s.title)+'</b><div class="small" style="margin-top:5px">'+esc(s.body)+'</div></div>';
  }).join("");
  var circle = d.careCircle.map(function(p){
    var sent = d.sentTo.indexOf(p.id) >= 0;
    return '<div class="card" style="margin:0"><b>'+esc(p.name)+'</b><div class="small muted">'+esc(p.role)+'</div><div class="small">'+esc(p.channel)+'</div><div class="chip" style="margin-top:6px;'+(sent?'border-color:#2ecc71;color:#baffdc':'')+'">'+(sent?"Digest delivered ✓":"Awaiting send")+'</div></div>';
  }).join("");
  var trace = g.trace.map(function(t){ return '<li class="small"><b>'+esc(t.agent)+'</b> · '+esc(t.action)+' · '+t.latencyMs+' ms <span class="muted">('+esc(t.runtime)+')</span></li>'; }).join("");
  var actions = g.recommendedActions.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join("");
  var modeChip = g.mode==="aws-bedrock-live" ? "AWS Bedrock LIVE" : "AWS Bedrock (simulated · zero-key)";
  app.innerHTML =
    '<h1>👨‍👩‍👧 Family Care Circle</h1><div class="sub">AWS Bedrock + Strands multi-agent digest · ui://echocare/care-circle</div>'
    + '<div class="card"><div class="row" style="align-items:center"><div class="center">'+donut(g.peaceOfMindScore)+'<div class="small muted">Peace-of-Mind<br/>'+esc(g.peaceOfMindBand)+'</div></div>'
    + '<div style="flex:1"><div style="font-size:20px;font-weight:800">'+esc(g.headline)+'</div>'
    + '<div class="row" style="margin-top:8px"><span class="chip">🤖 '+modeChip+'</span><span class="chip">'+esc(g.bedrockModelId)+'</span><span class="chip">'+esc(g.awsRegion)+'</span></div>'
    + '<div style="margin-top:10px;white-space:pre-line">'+esc(g.narrative)+'</div></div></div></div>'
    + '<div class="grid">'+sections+'</div>'
    + '<div class="card"><b>Recommended family actions</b><ul>'+actions+'</ul></div>'
    + '<h2>Care circle delivery board</h2><div class="grid">'+circle+'</div>'
    + '<div class="card"><b>Strands agent reasoning trace</b><ul style="list-style:none;margin-left:2px">'+trace+'</ul></div>'
    + (d.clinicalExport ? '<div class="card"><b>Clinical summary export</b><pre class="small" style="white-space:pre-wrap;margin:8px 0 0">'+esc(d.clinicalExport)+'</pre></div>' : "")
    + '<div class="btnrow"><button id="sendBtn">📤 Send Digest to Care Circle</button><button class="secondary" id="exportBtn">🧾 Export Clinical Summary</button></div>'
    + '<div id="status" class="small" style="margin-top:8px">'+esc(d.statusLine||"")+'</div>';
  document.getElementById("sendBtn").addEventListener("click", function(ev){
    busy(ev.target, window.__echocare.callTool("dispatch_care_circle_digest", {action:"send"})).then(function(res){ render(res.structuredContent); });
  });
  document.getElementById("exportBtn").addEventListener("click", function(ev){
    busy(ev.target, window.__echocare.callTool("dispatch_care_circle_digest", {action:"export"})).then(function(res){ render(res.structuredContent); });
  });
  window.__echocare.notifySize();
}
window.__echocare.onToolResult = function(result){ if(result && result.structuredContent) render(result.structuredContent); };
`;
  return page("echocare-care-circle", "EchoCare Care Circle Digest", body, script);
}
