"""Chat-style dashboard HTML for the Autonomous Revenue Operations Platform."""

DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autonomous RevOps — AI Operator</title>
<style>
:root{--bg:#06080d;--bg2:#0a0e16;--sidebar:#080b12;--card:rgba(255,255,255,.025);--border:rgba(255,255,255,.06);--border2:rgba(255,255,255,.1);--text:#e8edf5;--muted:#6b7894;--dim:#3a4458;--green:#3ad29f;--red:#f56565;--yellow:#ecc94b;--orange:#ff7a18;--cyan:#00d4ff;--purple:#a78bfa;--pink:#ec4899}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font-family:'SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;overflow:hidden}
.mono{font-family:'SF Mono','Fira Code',monospace;font-size:.78rem}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}

/* Layout */
.app{display:flex;height:100vh}
.sidebar{width:260px;min-width:260px;background:var(--sidebar);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative}
.aurora{position:absolute;top:-30%;left:-10%;width:120%;height:100%;background:radial-gradient(ellipse at 30% 20%,rgba(255,122,24,.05),transparent 50%),radial-gradient(ellipse at 70% 80%,rgba(0,212,255,.04),transparent 50%);pointer-events:none;z-index:0}

/* Sidebar */
.sb-header{padding:1rem;border-bottom:1px solid var(--border)}
.sb-logo{display:flex;align-items:center;gap:.6rem}
.sb-logo .icon{width:30px;height:30px;border-radius:8px;background:conic-gradient(from 0deg,var(--orange),var(--pink),var(--purple),var(--cyan),var(--orange));display:flex;align-items:center;justify-content:center;animation:spin 8s linear infinite}
.sb-logo .icon span{width:24px;height:24px;border-radius:6px;background:var(--sidebar);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.75rem;color:var(--orange)}
@keyframes spin{to{transform:rotate(360deg)}}
.sb-logo h1{font-size:.85rem;font-weight:700}
.sb-logo p{font-size:.62rem;color:var(--muted)}
.sb-new{margin:.7rem .8rem;padding:.5rem;border-radius:8px;background:rgba(255,122,24,.08);border:1px solid rgba(255,122,24,.2);color:var(--orange);font-size:.75rem;font-weight:600;cursor:pointer;text-align:center;transition:all .15s}
.sb-new:hover{background:rgba(255,122,24,.15)}
.sb-search{padding:.5rem .8rem}
.sb-search input{width:100%;padding:.4rem .6rem;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid var(--border);color:var(--text);font-size:.72rem;outline:none}
.sb-search input:focus{border-color:rgba(255,122,24,.3)}
.sb-list{flex:1;overflow-y:auto;padding:.3rem}
.sb-section{font-size:.6rem;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;padding:.5rem .8rem .2rem;font-weight:600}
.sb-item{padding:.5rem .8rem;border-radius:6px;cursor:pointer;transition:all .1s;display:flex;align-items:center;gap:.5rem}
.sb-item:hover{background:rgba(255,255,255,.03)}
.sb-item.active{background:rgba(255,122,24,.08)}
.sb-item .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.sb-item .label{font-size:.73rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.sb-item .time{font-size:.6rem;color:var(--dim)}
.sb-footer{padding:.6rem .8rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.mode-badge{padding:.2rem .5rem;border-radius:5px;font-size:.62rem;font-weight:700;letter-spacing:.04em}
.mode-OBSERVE{background:rgba(0,212,255,.12);color:var(--cyan);border:1px solid rgba(0,212,255,.2)}
.mode-APPROVAL{background:rgba(236,201,75,.12);color:var(--yellow);border:1px solid rgba(236,201,75,.2)}
.mode-AUTO{background:rgba(58,210,159,.12);color:var(--green);border:1px solid rgba(58,210,159,.2)}
.mode-PAUSED{background:rgba(245,101,101,.12);color:var(--red);border:1px solid rgba(245,101,101,.2)}
.mode-EMERGENCY_STOP{background:rgba(245,101,101,.2);color:var(--red);border:1px solid var(--red);animation:pr 1s infinite}
@keyframes pr{50%{opacity:.5}}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite}
@keyframes pulse{50%{opacity:.3}}

/* Chat header */
.chat-header{padding:.7rem 1.2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:rgba(6,8,13,.8);backdrop-filter:blur(10px);z-index:10;position:relative}
.chat-header .title{font-size:.85rem;font-weight:600}
.chat-header .sub{font-size:.65rem;color:var(--muted)}
.chat-header .right{display:flex;align-items:center;gap:.6rem}
.chat-header .stat{font-size:.65rem;color:var(--muted)}
.chat-header .stat b{color:var(--text);font-weight:600}

/* Messages */
.messages{flex:1;overflow-y:auto;padding:1.2rem;position:relative;z-index:1}
.msg{max-width:740px;margin:0 auto 1rem;display:flex;gap:.7rem}
.msg.ai .avatar{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--orange),var(--pink));display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:#fff;flex-shrink:0}
.msg.user .avatar{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:.7rem;color:var(--muted);flex-shrink:0}
.msg .content{flex:1;min-width:0}
.msg .name{font-size:.7rem;color:var(--muted);margin-bottom:.2rem}
.msg .bubble{padding:.7rem .9rem;border-radius:10px;font-size:.82rem;line-height:1.5}
.msg.ai .bubble{background:rgba(255,255,255,.03);border:1px solid var(--border)}
.msg.user .bubble{background:rgba(255,122,24,.06);border:1px solid rgba(255,122,24,.12)}
.msg .time{font-size:.6rem;color:var(--dim);margin-top:.3rem}

/* Inline cards in chat */
.icard{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:10px;padding:.8rem;margin:.6rem 0}
.icard h4{font-size:.72rem;font-weight:600;margin-bottom:.5rem;display:flex;align-items:center;justify-content:space-between}
.icard h4 .badge{font-size:.58rem;padding:.1rem .35rem;border-radius:4px;font-weight:600}
.istats{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:.5rem}
.istat{text-align:center}
.istat .v{font-size:1.1rem;font-weight:800;font-variant-numeric:tabular-nums}
.istat .l{font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.ifunnel{display:flex;flex-direction:column;gap:.25rem}
.ifstep{display:flex;justify-content:space-between;padding:.3rem .6rem;border-radius:6px;background:rgba(255,255,255,.02);position:relative;overflow:hidden}
.ifstep::before{content:'';position:absolute;left:0;top:0;bottom:0;width:var(--w,100%);background:linear-gradient(90deg,rgba(255,122,24,.1),transparent)}
.ifstep .fl{font-size:.68rem;color:var(--muted);position:relative}
.ifstep .fv{font-size:.78rem;font-weight:700;position:relative}
.ivariant{padding:.5rem;border-radius:6px;background:rgba(255,255,255,.02);border:1px solid var(--border);margin-bottom:.4rem}
.ivariant .vh{display:flex;justify-content:space-between;align-items:center}
.ivariant .vl{font-weight:600;font-size:.75rem}
.ivariant .vr{font-size:.75rem;font-weight:700}
.ivariant .vmeta{font-size:.6rem;color:var(--muted);margin-top:.15rem}
.ichain{display:flex;flex-direction:column;gap:.15rem}
.ic-step{display:flex;align-items:center;gap:.4rem;padding:.2rem .4rem;border-radius:5px;background:rgba(255,255,255,.02);font-size:.65rem}
.ic-step .lab{color:var(--muted);min-width:70px;font-size:.58rem;text-transform:uppercase}
.ic-arrow{color:var(--dim);font-size:.55rem;text-align:center;padding-left:70px}
.ievent{display:flex;gap:.4rem;padding:.2rem 0;font-size:.68rem;border-bottom:1px solid rgba(255,255,255,.02)}
.ievent .et{color:var(--cyan);font-family:'SF Mono',monospace;font-size:.6rem;white-space:nowrap}
.ievent .em{color:var(--text)}
.itable{width:100%;border-collapse:collapse;font-size:.68rem}
.itable th{text-align:left;padding:.25rem;color:var(--muted);font-weight:600;font-size:.58rem;text-transform:uppercase;border-bottom:1px solid var(--border)}
.itable td{padding:.25rem;border-bottom:1px solid rgba(255,255,255,.02)}
.tag{display:inline-block;padding:.08rem .3rem;border-radius:4px;font-size:.58rem;font-weight:600}
.tag-ok{background:rgba(58,210,159,.12);color:var(--green)}
.tag-warn{background:rgba(236,201,75,.12);color:var(--yellow)}
.tag-err{background:rgba(245,101,101,.12);color:var(--red)}
.tag-info{background:rgba(0,212,255,.12);color:var(--cyan)}
.tag-purple{background:rgba(167,139,250,.12);color:var(--purple)}

/* Input */
.input-area{padding:.8rem 1.2rem;border-top:1px solid var(--border);background:rgba(6,8,13,.8);backdrop-filter:blur(10px);position:relative;z-index:10}
.input-wrap{max-width:740px;margin:0 auto;display:flex;gap:.5rem;align-items:center}
.input-wrap input{flex:1;padding:.6rem .8rem;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid var(--border);color:var(--text);font-size:.8rem;outline:none}
.input-wrap input:focus{border-color:rgba(255,122,24,.3)}
.input-wrap button{padding:.6rem 1rem;border-radius:8px;background:linear-gradient(135deg,var(--orange),var(--pink));border:none;color:#fff;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .15s}
.input-wrap button:hover{opacity:.9;transform:translateY(-1px)}
.suggestions{max-width:740px;margin:0 auto .5rem;display:flex;gap:.3rem;flex-wrap:wrap}
.schip{padding:.2rem .5rem;border-radius:5px;background:rgba(255,255,255,.03);border:1px solid var(--border);font-size:.65rem;color:var(--muted);cursor:pointer;transition:all .1s}
.schip:hover{background:rgba(255,122,24,.06);border-color:rgba(255,122,24,.2);color:var(--orange)}

/* Typing indicator */
.typing{display:flex;gap:.2rem;padding:.3rem 0}
.typing span{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:tb 1.4s infinite}
.typing span:nth-child(2){animation-delay:.2s}
.typing span:nth-child(3){animation-delay:.4s}
@keyframes tb{0%,60%,100%{opacity:.3}30%{opacity:1}}

@media(max-width:768px){.sidebar{display:none}.messages{padding:.8rem}.input-area{padding:.6rem .8rem}}
</style></head><body>
<div class="app">
<!-- Sidebar -->
<div class="sidebar">
<div class="sb-header"><div class="sb-logo"><div class="icon"><span>A</span></div><div><h1>Autonomous RevOps</h1><p>AI Revenue Operator</p></div></div></div>
<div class="sb-new" onclick="newChat()">+ New Conversation</div>
<div class="sb-search"><input placeholder="Search conversations..." oninput="filterChats(this.value)"></div>
<div class="sb-list" id="sbList"></div>
<div class="sb-footer"><div style="display:flex;align-items:center;gap:.3rem"><span class="live-dot"></span><span style="font-size:.62rem;color:var(--muted)">Live</span></div><div id="modeBadge" class="mode-badge mode-AUTO">AUTO</div></div>
</div>
<!-- Main -->
<div class="main">
<div class="aurora"></div>
<div class="chat-header">
<div><div class="title" id="chatTitle">AI Operator — System Overview</div><div class="sub" id="chatSub">Autonomous revenue operations · Observe → Understand → Generate → Experiment → Act → Measure → Learn → Prove</div></div>
<div class="right" id="chatStats"></div>
</div>
<div class="messages" id="messages"></div>
<div class="input-area">
<div class="suggestions" id="suggestions"></div>
<div class="input-wrap"><input id="input" placeholder="Ask the AI operator anything..." onkeydown="if(event.key==='Enter')send()"><button onclick="send()">Send</button></div>
</div>
</div>
</div>
<script>
const API='';
let conversations=[],currentConv=null,msgIdx=0;

const CONV_TEMPLATES=[
{id:'overview',title:'System Overview',sub:'Full platform status',color:'var(--cyan)',msgs:[
{role:'ai',text:'Welcome to the Autonomous Revenue Operations Platform. I am your AI Operator. Here is the current system state:',cards:['kpi','funnel']},
{role:'ai',text:'The platform is running in **AUTO** mode. All 11 subsystems are operational. The closed loop is active: Observe → Understand → Generate → Experiment → Act → Measure → Learn → Prove → Repeat.',cards:['ai_status']},
{role:'ai',text:'Current experiment: **Bio Optimization Q3** — Bio B is the leader with +0.42 reward. 187 observations. 81% confidence. Next decision in 41 minutes.',cards:['arena']},
]},
{id:'exp',title:'Experiment Arena',sub:'A/B/C bio testing',color:'var(--green)',msgs:[
{role:'ai',text:'**Experiment: Bio Optimization Q3**\n\nThree variants are being tested. Here are the results so far:',cards:['arena']},
{role:'ai',text:'**Decision:** Continue Bio B for another measurement window.\n\n**Rationale:** Bio B outperforms Bio A on repeat-visitor conversion with 81% confidence across 187 observations. Bio A has been eliminated (reward -0.18). Bio C remains as a challenger.',cards:['decisions']},
{role:'user',text:'Why was Bio A eliminated?'},
{role:'ai',text:'Bio A received 420 impressions but only 12 clicks and 0 conversions. The reward calculator assigned -0.18 based on:\n\n- Low CTR (2.9% vs Bio B at 8.9%)\n- Zero conversions\n- Negative performance delta vs baseline\n\nThe Thompson Sampling bandit reduced Bio A\'s selection probability to near-zero. The receipt is available in the Evidence layer.',cards:['receipt']},
]},
{id:'visitors',title:'Visitor Intelligence',sub:'CRM & engagement',color:'var(--purple)',msgs:[
{role:'ai',text:'**Visitor Intelligence Report**\n\nI am tracking 7 unique visitors. Here are the high-intent prospects:',cards:['high_intent']},
{role:'ai',text:'**visitor_001** is your hottest prospect:\n- Engagement score: 0.85\n- 4 visits this week\n- Lifecycle stage: high_intent\n- Has not converted yet\n- Showing increasing engagement pattern\n\n**Recommendation:** Add to follow-up queue. Consider a personalized message.',cards:[]},
]},
{id:'content',title:'Content Factory',sub:'AI-generated content',color:'var(--orange)',msgs:[
{role:'ai',text:'**AI Content Factory**\n\nThe platform has generated 5 content items across multiple formats:',cards:['content']},
{role:'ai',text:'Each piece of content is **measured inventory** — not disposable text. The lifecycle is:\n\n**generated → deployed → attributed → evaluated → retained or killed**\n\nThe Bio B variant (leader) has been deployed and is being attributed against visitor telemetry.',cards:[]},
]},
{id:'evidence',title:'Evidence Chain',sub:'Receipts & provenance',color:'var(--yellow)',msgs:[
{role:'ai',text:'**Evidence & Provenance Layer**\n\nEvery autonomous decision leaves a complete evidence chain. Here are the latest receipts:',cards:['receipt']},
{role:'ai',text:'Click any decision to trace the full chain:\n\n**INPUT OBSERVATION** → **SOURCE** → **MODEL/ALGORITHM** → **DECISION** → **ACTION** → **RESULT** → **REWARD** → **RECEIPT**\n\nThis makes the AI inspectable. You can reconstruct exactly why the machine changed the profile at any point.',cards:['decisions']},
]},
{id:'control',title:'Control Plane',sub:'Operator modes',color:'var(--red)',msgs:[
{role:'ai',text:'**Autonomous Control Plane**\n\nCurrent mode: **AUTO** — approved actions execute autonomously.\n\nAvailable modes:',cards:['control']},
{role:'ai',text:'- **OBSERVE** — No mutations. Telemetry only.\n- **APPROVAL** — AI proposes, human approves.\n- **AUTO** — Approved classes execute autonomously.\n- **PAUSED** — Automation stops, telemetry active.\n- **EMERGENCY STOP** — All mutations immediately disabled.',cards:[]},
{role:'user',text:'Switch to APPROVAL mode'},
{role:'ai',text:'Control mode changed to **APPROVAL**. The AI will now propose actions for your approval before execution. All pending actions have been queued.',cards:[]},
]},
{id:'attribution',title:'Revenue Attribution',sub:'Funnel & KPIs',color:'var(--pink)',msgs:[
{role:'ai',text:'**Revenue Attribution Report**\n\nHere is the current funnel:',cards:['funnel']},
{role:'ai',text:'**KPI Summary:**\n- CTR: 5.91%\n- Conversion Rate: 1.46%\n- Revenue Today: $1,250\n- 5 bookings from 342 visitors\n\nThe AI-managed period (Bio B deployment) is outperforming the baseline by 34% on CTR.',cards:['kpi']},
]},
];

function renderSidebar(){
let html='<div class="sb-section">Conversations</div>';
conversations.forEach(c=>{
html+=`<div class="sb-item ${currentConv===c.id?'active':''}" onclick="selectConv('${c.id}')">
<span class="dot" style="background:${c.color}"></span>
<span class="label">${c.title}</span>
</div>`;
});
html+='<div class="sb-section">Quick Actions</div>';
['Telemetry Stream','Experiments','Visitors','Content','Evidence','Control'].forEach(s=>{
html+=`<div class="sb-item" onclick="quickNav('${s}')"><span class="dot" style="background:var(--dim)"></span><span class="label">${s}</span></div>`;
});
el('sbList').innerHTML=html;
}

function el(id){return document.getElementById(id)}
function fmt(n){return n?n.toLocaleString():'0'}
function money(n){return '$'+(n||0).toLocaleString()}

async function api(path){
try{return await fetch(API+path).then(r=>r.json())}catch(e){return null}
}

async function renderCard(type){
const d=await api('/api/overview');
if(!d)return '';
switch(type){
case 'kpi':const k=d.kpi_latest||{};
return `<div class="icard"><h4>KPI Snapshot <span class="badge tag-ok">Live</span></h4><div class="istats">
<div class="istat"><div class="v" style="color:var(--green)">${money(k.revenue)}</div><div class="l">Revenue</div></div>
<div class="istat"><div class="v" style="color:var(--cyan)">${fmt(k.visitors)}</div><div class="l">Visitors</div></div>
<div class="istat"><div class="v" style="color:var(--purple)">${fmt(k.repeat_visitors)}</div><div class="l">Repeat</div></div>
<div class="istat"><div class="v" style="color:var(--orange)">${fmt(k.clicks)}</div><div class="l">Clicks</div></div>
<div class="istat"><div class="v" style="color:var(--yellow)">${fmt(k.contacts)}</div><div class="l">Contacts</div></div>
<div class="istat"><div class="v" style="color:var(--green)">${(k.conversion_rate||0).toFixed(1)}%</div><div class="l">CVR</div></div>
</div></div>`;
case 'funnel':const kf=d.kpi_latest||{};const mx=kf.impressions||1;
const steps=[['Impressions',kf.impressions],['Visitors',kf.visitors],['Repeat',kf.repeat_visitors],['Clicks',kf.clicks],['Contacts',kf.contacts],['Bookings',kf.bookings],['Revenue',kf.revenue]];
return `<div class="icard"><h4>Revenue Funnel <span class="badge tag-info">Live</span></h4><div class="ifunnel">${steps.map(([l,v])=>`<div class="ifstep" style="--w:${Math.max((v/mx)*100,4)}%"><span class="fl">${l}</span><span class="fv">${l==='Revenue'?money(v):fmt(v)}</span></div>`).join('')}</div></div>`;
case 'arena':const exps=d.experiments||[];if(!exps.length)return '';
const e=exps[0];
return `<div class="icard"><h4>${e.name} <span class="badge tag-${e.status==='completed'?'ok':'info'}">${e.status}</span></h4>
${e.variants.map(v=>{const c=v.status==='leader'?'var(--green)':v.status==='eliminated'?'var(--red)':'var(--yellow)';const t=v.status==='leader'?'tag-ok':v.status==='eliminated'?'tag-err':'tag-warn';
return `<div class="ivariant"><div class="vh"><span class="vl">${v.label}</span><span class="vr" style="color:${c}">${v.reward>0?'+':''}${v.reward.toFixed(2)}</span></div><div class="vmeta">${v.impressions} imp · ${v.clicks} clicks · ${v.contacts} contacts · ${v.conversions} conv</div><div style="margin-top:.2rem"><span class="tag ${t}">${v.status}</span></div></div>`}).join('')}
<div style="font-size:.65rem;color:var(--muted);margin-top:.4rem">${e.observations||0} observations · ${Math.round((e.confidence||0)*100)}% confidence</div></div>`;
case 'decisions':const decs=d.decisions||[];
return `<div class="icard"><h4>Decision Ledger <span class="badge tag-purple">${decs.length}</span></h4><table class="itable"><tbody>${decs.map(dec=>`<tr><td><span class="tag tag-${dec.status==='approved'?'ok':'info'}">${dec.status}</span></td><td class="mono">${dec.action_type}</td><td style="color:var(--orange)">${Math.round((dec.confidence||0)*100)}%</td><td style="color:var(--muted);font-size:.62rem">${(dec.rationale||'').substring(0,60)}...</td></tr>`).join('')}</tbody></table></div>`;
case 'receipt':const rcpts=d.receipts||[];
return `<div class="icard"><h4>Evidence Chains <span class="badge tag-warn">${rcpts.length}</span></h4>${rcpts.slice(0,2).map(r=>{try{const j=JSON.parse(r.receipt_json||'{}');return `<div class="ichain" style="margin-bottom:.6rem">
<div class="ic-step"><span class="lab">Input</span>${j.input||r.input_observation||''}</div><div class="ic-arrow">↓</div>
<div class="ic-step"><span class="lab">Source</span>${j.source||r.source||''}</div><div class="ic-arrow">↓</div>
<div class="ic-step"><span class="lab">Model</span>${j.model||r.model||''}</div><div class="ic-arrow">↓</div>
<div class="ic-step"><span class="lab">Decision</span>${j.decision||r.decision||''}</div><div class="ic-arrow">↓</div>
<div class="ic-step"><span class="lab">Action</span>${j.action||r.action||''}</div><div class="ic-arrow">↓</div>
<div class="ic-step"><span class="lab">Result</span>${j.result||r.result||''}</div><div class="ic-arrow">↓</div>
<div class="ic-step"><span class="lab">Reward</span><span style="color:${(j.reward||r.reward||0)>0?'var(--green)':'var(--red)'}">${(j.reward||r.reward||0)>0?'+':''}${(j.reward||r.reward||0).toFixed(2)}</span></div>
</div>`}catch(e){return ''}}).join('')}</div>`;
case 'high_intent':const vis=d.high_intent||[];
return `<div class="icard"><h4>High-Intent Visitors <span class="badge tag-purple">${vis.length}</span></h4>${vis.map(v=>`<div class="ivariant"><div class="vh"><span class="vl mono">${v.visitor_id}</span><span class="vr" style="color:var(--orange)">${(v.engagement_score||0).toFixed(2)}</span></div><div class="vmeta">${v.visit_count} visits · ${v.lifecycle_stage} · ${v.geo||'unknown'}</div></div>`).join('')}</div>`;
case 'content':const items=d.content||[];
const types={bio:'tag-purple',blog:'tag-info',social:'tag-ok',seo:'tag-warn',email:'tag-err'};
return `<div class="icard"><h4>Content Factory <span class="badge tag-info">${items.length}</span></h4><table class="itable"><thead><tr><th>Type</th><th>Title</th><th>Status</th></tr></thead><tbody>${items.map(c=>`<tr><td><span class="tag ${types[c.type]||'tag-info'}">${c.type}</span></td><td>${c.title}</td><td><span class="tag tag-ok">${c.status}</span></td></tr>`).join('')}</tbody></table></div>`;
case 'ai_status':const ai=d.ai_status||{};
return `<div class="icard"><h4>AI Operator Status <span class="badge tag-ok">Active</span></h4><div class="istats">
<div class="istat"><div class="v" style="color:var(--green)">${ai.mode||'AUTO'}</div><div class="l">Mode</div></div>
<div class="istat"><div class="v" style="color:var(--orange)">${ai.total_decisions||0}</div><div class="l">Decisions</div></div>
<div class="istat"><div class="v" style="color:var(--cyan)">${ai.total_experiments||0}</div><div class="l">Experiments</div></div>
<div class="istat"><div class="v" style="color:var(--purple)">${ai.total_content||0}</div><div class="l">Content</div></div>
</div></div>`;
case 'control':const c=d.control||{};
return `<div class="icard"><h4>Control Plane <span class="badge tag-${c.mode==='EMERGENCY_STOP'?'err':'ok'}">${c.mode||'AUTO'}</span></h4><div class="istats">
<div class="istat"><div class="v" style="color:var(--orange)">${c.mode||'AUTO'}</div><div class="l">Mode</div></div>
<div class="istat"><div class="v" style="color:${c.emergency_stop?'var(--red)':'var(--green)'}">${c.emergency_stop?'STOP':'Clear'}</div><div class="l">Emergency</div></div>
<div class="istat"><div class="v" style="color:${c.scheduler_active?'var(--green)':'var(--red)'}">${c.scheduler_active?'On':'Off'}</div><div class="l">Scheduler</div></div>
</div></div>`;
default:return '';
}
}

function md(t){return t.replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>')}

async function renderMsg(m){
const av=m.role==='ai'?'AI':'U';
const nm=m.role==='ai'?'AI Operator':'You';
const now=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
let cards='';
if(m.cards){for(const c of m.cards){cards+=await renderCard(c)}}
return `<div class="msg ${m.role}"><div class="avatar">${av}</div><div class="content"><div class="name">${nm}</div><div class="bubble">${md(m.text)}${cards}</div><div class="time">${now}</div></div></div>`;
}

async function selectConv(id){
currentConv=id;
const conv=CONV_TEMPLATES.find(c=>c.id===id);
if(!conv)return;
el('chatTitle').textContent=conv.title;
el('chatSub').textContent=conv.sub;
el('messages').innerHTML='';
renderSidebar();
// Update mode badge
const ctrl=await api('/api/control');
const mb=el('modeBadge');
mb.textContent=ctrl.mode||'AUTO';
mb.className='mode-badge mode-'+(ctrl.mode||'AUTO');
// Update header stats
const ov=await api('/api/overview');
const k=ov.kpi_latest||{};
el('chatStats').innerHTML=`<span class="stat"><b style="color:var(--green)">${money(k.revenue)}</b> revenue</span><span class="stat"><b>${fmt(k.visitors)}</b> visitors</span><span class="stat"><b style="color:var(--orange)">${(k.conversion_rate||0).toFixed(1)}%</b> CVR</span>`;
// Render messages with typing effect
for(let i=0;i<conv.msgs.length;i++){
if(conv.msgs[i].role==='ai'&&i>0){
const t=document.createElement('div');t.className='msg ai';t.innerHTML='<div class="avatar">AI</div><div class="content"><div class="name">AI Operator</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>';
el('messages').appendChild(t);
el('messages').scrollTop=el('messages').scrollHeight;
await new Promise(r=>setTimeout(r,400));
t.remove();
}
const html=await renderMsg(conv.msgs[i]);
el('messages').insertAdjacentHTML('beforeend',html);
el('messages').scrollTop=el('messages').scrollHeight;
}
showSuggestions(id);
}

function showSuggestions(id){
const sugs={
overview:['Show experiment details','What is the AI confidence?','Show live events','Switch to APPROVAL mode'],
exp:['Why was Bio A eliminated?','Show the receipt for Bio B','What is the reward calculation?'],
visitors:['Who is the hottest prospect?','Show all visitors','What is the engagement scoring?'],
content:['Generate a new bio','Show SEO keywords','What content is performing best?'],
evidence:['Show the full receipt chain','What model made the decision?','Trace the last action'],
control:['Switch to APPROVAL mode','Emergency stop','What modes are available?'],
attribution:['Show KPI history','What is the CTR trend?','Compare AI vs baseline'],
};
const s=sugs[id]||[];
el('suggestions').innerHTML=s.map(t=>`<span class="schip" onclick="ask('${t.replace(/'/g,"\\'")}')">${t}</span>`).join('');
}

async function ask(text){
el('input').value=text;
await send();
}

async function send(){
const text=el('input').value.trim();
if(!text)return;
el('input').value='';
const now=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
el('messages').insertAdjacentHTML('beforeend',`<div class="msg user"><div class="avatar">U</div><div class="content"><div class="name">You</div><div class="bubble">${md(text)}</div><div class="time">${now}</div></div></div>`);
el('messages').scrollTop=el('messages').scrollHeight;
// Typing indicator
const t=document.createElement('div');t.className='msg ai';t.innerHTML='<div class="avatar">AI</div><div class="content"><div class="name">AI Operator</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>';
el('messages').appendChild(t);
el('messages').scrollTop=el('messages').scrollHeight;
await new Promise(r=>setTimeout(r,600));
t.remove();
// Generate response
const resp=await generateResponse(text);
const html=await renderMsg({role:'ai',text:resp.text,cards:resp.cards||[]});
el('messages').insertAdjacentHTML('beforeend',html);
el('messages').scrollTop=el('messages').scrollHeight;
}

async function generateResponse(text){
const tl=text.toLowerCase();
if(tl.includes('experiment')||tl.includes('bio')||tl.includes('variant')||tl.includes('arena')){
if(tl.includes('eliminat')||tl.includes('bio a'))return{text:'Bio A was eliminated because it received 420 impressions but only 12 clicks and 0 conversions. The reward calculator assigned -0.18 based on low CTR (2.9%), zero conversions, and negative performance delta. The Thompson Sampling bandit reduced its selection probability to near-zero.',cards:['arena','receipt']};
if(tl.includes('receipt')||tl.includes('evidence')||tl.includes('why'))return{text:'Here is the complete evidence chain for the Bio B continuation decision:',cards:['receipt']};
return{text:'The current experiment is **Bio Optimization Q3** with 3 variants. Bio B is leading at +0.42 reward with 81% confidence across 187 observations.',cards:['arena']};
}
if(tl.includes('visitor')||tl.includes('prospect')||tl.includes('crm')||tl.includes('intent')){
if(tl.includes('hottest')||tl.includes('best')||tl.includes('top'))return{text:'**visitor_001** is your hottest prospect with an engagement score of 0.85. They have visited 4 times this week and are in the high_intent lifecycle stage. They have not converted yet but show increasing engagement.',cards:['high_intent']};
return{text:'Here are the current visitors ranked by engagement score:',cards:['high_intent']};
}
if(tl.includes('content')||tl.includes('blog')||tl.includes('social')||tl.includes('seo')||tl.includes('email')){
return{text:'The AI Content Factory has produced 5 items across bio, blog, social, SEO, and email formats. Each piece is measured inventory — generated, deployed, attributed, and evaluated.',cards:['content']};
}
if(tl.includes('evidence')||tl.includes('receipt')||tl.includes('provenance')||tl.includes('trace')){
return{text:'Every autonomous decision leaves a complete evidence chain. Here are the latest receipts:',cards:['receipt','decisions']};
}
if(tl.includes('control')||tl.includes('mode')||tl.includes('approval')||tl.includes('emergency')||tl.includes('pause')||tl.includes('observe')){
if(tl.includes('approval')){await fetch(API+'/api/control/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'APPROVAL'})});return{text:'Control mode changed to **APPROVAL**. The AI will now propose actions for your approval before execution.',cards:['control']}}
if(tl.includes('emergency')){await fetch(API+'/api/control/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'EMERGENCY_STOP'})});return{text:'**EMERGENCY STOP ACTIVATED.** All mutations have been immediately disabled. Telemetry collection remains active.',cards:['control']}}
if(tl.includes('auto')){await fetch(API+'/api/control/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'AUTO'})});return{text:'Control mode changed to **AUTO**. Approved classes of actions will execute autonomously.',cards:['control']}}
return{text:'The control plane supports 5 operator modes: OBSERVE, APPROVAL, AUTO, PAUSED, and EMERGENCY STOP. Current mode is shown below.',cards:['control']};
}
if(tl.includes('kpi')||tl.includes('revenue')||tl.includes('funnel')||tl.includes('ctr')||tl.includes('conversion')||tl.includes('attribution')){
return{text:'Here is the current revenue funnel and KPI snapshot:',cards:['funnel','kpi']};
}
if(tl.includes('event')||tl.includes('live')||tl.includes('stream')||tl.includes('telemetry')){
const ev=await api('/api/events?limit=10');
return{text:'**Live Telemetry Stream:**',cards:[]};
}
if(tl.includes('confidence')||tl.includes('ai status')||tl.includes('system')){
return{text:'The AI Operator is active with 81% confidence on the current experiment. Here is the full status:',cards:['ai_status','arena']};
}
if(tl.includes('generate')){
return{text:'I can generate bios, blogs, social posts, SEO keywords, and email templates. What would you like me to create?',cards:[]};
}
if(tl.includes('hello')||tl.includes('hi ')||tl.includes('hey')){
return{text:'Hello. I am your Autonomous Revenue Operator. I am continuously observing your business, running experiments, and optimizing performance. What would you like to know?',cards:['kpi']};
}
return{text:'I can help with experiments, visitors, content, evidence chains, attribution, and control plane operations. Try asking about the current experiment, visitor intelligence, or the AI decision chain.',cards:[]};
}

function newChat(){
el('chatTitle').textContent='New Conversation';
el('chatSub').textContent='Start a new conversation with the AI Operator';
el('messages').innerHTML='';
el('suggestions').innerHTML='';
el('messages').insertAdjacentHTML('beforeend',`<div class="msg ai"><div class="avatar">AI</div><div class="content"><div class="name">AI Operator</div><div class="bubble">Hello. I am your Autonomous Revenue Operator. I can show you experiments, visitor intelligence, content, evidence chains, attribution data, and control the automation mode. What would you like to explore?</div></div></div>`);
}

function quickNav(s){
const map={'Telemetry Stream':'overview','Experiments':'exp','Visitors':'visitors','Content':'content','Evidence':'evidence','Control':'control'};
selectConv(map[s]||'overview');
}

function filterChats(q){
document.querySelectorAll('.sb-item .label').forEach(l=>{
const item=l.closest('.sb-item');
item.style.display=l.textContent.toLowerCase().includes(q.toLowerCase())?'':'none';
});
}

// Init
conversations=CONV_TEMPLATES;
selectConv('overview');
</script>
</body></html>"""
