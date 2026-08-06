import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "1.0.0";
const FILE = path.join(process.cwd(), "data", "pepi-spinor.json");
const MAX_BYTES = 2_000_000;
const now = () => new Date().toISOString();
const uid = (p: string) => `${p}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const stable = (v: any): string => v && typeof v === "object"
  ? Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
  : JSON.stringify(v);
const hash = (v: any) => createHash("sha256").update(stable(v)).digest("hex");
const text = (v: any, n = 100_000) => String(v ?? "").replace(/\0/g, "").replace(/\r\n/g, "\n").trim().slice(0, n);
const uniq = (a: string[]) => [...new Set(a.map(v => v.trim()).filter(Boolean))];
const n = (v: any, lo = 0, hi = 1e9) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : null;

type RecordState = "compiled" | "blocked" | "approved" | "outcome_recorded";
type RecordItem = {
  id: string; state: RecordState; createdAt: string; updatedAt: string;
  evidenceEnvelope: any; roleOperatingContract: any; authority: any; taskIR: any;
  compliance: any; capabilityGraph: any[]; executionDAG: any[]; artifacts: any[];
  experimentTwin: any; valueAttribution: any; commitGate: any; receipt: any;
  forwardStateSha256: string; versions: any[]; outcome?: any; reversePass?: any;
};

declare global { var __pepiRecords: RecordItem[] | undefined; }

async function load(): Promise<RecordItem[]> {
  if (globalThis.__pepiRecords) return globalThis.__pepiRecords;
  try { globalThis.__pepiRecords = JSON.parse(await fs.readFile(FILE, "utf8")); }
  catch { globalThis.__pepiRecords = []; }
  return Array.isArray(globalThis.__pepiRecords) ? globalThis.__pepiRecords : [];
}
async function save(rows: RecordItem[]) {
  globalThis.__pepiRecords = rows.slice(-2000);
  try { await fs.mkdir(path.dirname(FILE), { recursive: true }); await fs.writeFile(FILE, JSON.stringify(globalThis.__pepiRecords, null, 2)); }
  catch { /* read-only serverless filesystem: process cache remains explicit, not durable */ }
}

function normalizeEmail(raw: any) {
  if (!raw || typeof raw !== "object") throw new Error("email is required");
  const email = {
    id: text(raw.id, 500) || uid("email"), threadId: text(raw.threadId, 500) || null,
    from: text(raw.from, 320).toLowerCase(), to: (raw.to ?? []).map((x: any) => text(x, 320).toLowerCase()).slice(0, 100),
    subject: text(raw.subject, 998), body: text(raw.body ?? raw.text, 500_000), receivedAt: text(raw.receivedAt, 50) || now(),
    attachments: (raw.attachments ?? []).slice(0, 10).map((a: any) => ({
      name: text(a.name, 255) || "attachment", contentType: text(a.contentType, 120) || "application/octet-stream",
      contentText: text(a.contentText, 1_000_000), sizeBytes: n(a.sizeBytes, 0, 1e9),
    })),
  };
  if (!email.from.includes("@")) throw new Error("email.from must be valid");
  if (!email.subject && !email.body) throw new Error("email needs subject or body");
  return email;
}

function authority(email: any, a: any = {}) {
  const domain = email.from.split("@").pop();
  const allow = (process.env.SPINOR_AUTHORIZED_DOMAINS ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  const status = allow.includes(domain) ? "verified" : a.asserted === true ? "asserted_unverified" : "unverified";
  return { status, requester: text(a.requesterId, 300) || email.from, senderDomain: domain,
    evidence: [allow.includes(domain) ? `allowlisted domain ${domain}` : "domain not allowlisted", a.asserted ? text(a.evidence, 1000) || "caller assertion" : "no assertion"],
    allowedEffects: uniq((a.allowedEffects ?? []).map((x: any) => text(x, 200))) };
}

const clinical = ["off-label", "off label", "prescribe", "increase dose", "decrease dose", "diagnose", "patient-level", "patient level", "clinical claim"];
const sensitive = ["social security", "ssn", "medical record number", "mrn", "protected health information", "patient name"];
const effects: [string, string][] = [["send", "send external message"], ["reply", "send external message"], ["schedule", "calendar commitment"], ["book", "calendar commitment"], ["submit", "external submission"], ["pay", "financial transaction"], ["purchase", "financial transaction"], ["delete", "destructive change"], ["update crm", "enterprise record mutation"]];
function compliance(email: any, auth: any) {
  const h = `${email.subject}\n${email.body}`.toLowerCase();
  const c = clinical.filter(x => h.includes(x)), s = sensitive.filter(x => h.includes(x));
  const external = uniq(effects.filter(([x]) => h.includes(x)).map(([, y]) => y));
  const state = c.length ? "blocked" : auth.status !== "verified" || s.length || external.length ? "review_required" : "read_only_executable";
  return { state, matchedRiskTerms: uniq([...c, ...s]), externalEffects: external, llmAllowed: !c.length && !s.length,
    reasons: c.length ? ["clinical truth, prescribing pressure, or patient-level manipulation risk"] : [state === "read_only_executable" ? "reversible local work only" : "authority, sensitivity, or side-effect review required"] };
}

function taskIR(email: any, gate: any) {
  const h = `${email.subject}\n${email.body}`;
  const patterns: [RegExp, string][] = [[/analy[sz]e|review|audit/i,"analyze evidence"],[/extract|parse/i,"extract data"],[/clean|normalize|deduplicate/i,"normalize records"],[/validate|verify|enrich/i,"validate records"],[/route|map/i,"optimize route"],[/draft|write|prepare/i,"draft artifact"],[/send|reply|submit/i,"commit delivery"]];
  const actions = uniq(patterns.filter(([r]) => r.test(h)).map(([, a]) => a));
  if (!actions.length) actions.push("clarify and compile work");
  const bullets = email.body.split("\n").map((x: string) => x.trim()).filter((x: string) => /^[-*•]|^\d+[.)]/.test(x)).map((x: string) => x.replace(/^[-*•\s]+|^\d+[.)]\s*/, "")).slice(0,20);
  const deadline = h.match(/\b(?:deadline\s*[:\-]|by)\s*([^\n,;]+)/i)?.[1]?.trim() ?? null;
  return { id: uid("task"), intent: email.subject || email.body.split("\n")[0], requestedActions: actions,
    deliverables: uniq([...bullets, ...email.attachments.map((a: any) => `processed ${a.name}`), "execution receipt with provenance"]), deadline,
    constraints: ["preserve source unchanged", "never infer authority", "human approval before external effects", "no causal claims from estimates"],
    unknowns: uniq([authUnknown(gate), !deadline ? "deadline not detected" : "", email.attachments.some((a: any) => !a.contentText) ? "some attachment bytes unavailable" : ""]),
    irreversibleEffects: gate.externalEffects, confidence: Math.min(.95, .45 + actions.length * .08) };
}
const authUnknown = (g: any) => g.state === "read_only_executable" ? "" : "authority or compliance scope needs review";

function parseCsv(src: string) {
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i=0;i<src.length;i++) { const ch=src[i]; if(q){ if(ch==='"'&&src[i+1]==='"'){cell+='"';i++;} else if(ch==='"')q=false; else cell+=ch; }
    else if(ch==='"')q=true; else if(ch===','){row.push(cell);cell="";} else if(ch==='\n'){row.push(cell);out.push(row);row=[];cell="";} else if(ch!=='\r')cell+=ch; }
  row.push(cell); if(row.some(Boolean)) out.push(row); return out;
}
const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replaceAll('"','""')}"` : v;
function csvArtifacts(a: any) {
  if (!a.contentText || !(/\.csv$/i.test(a.name) || /text\/csv/i.test(a.contentType))) return [];
  const rows=parseCsv(a.contentText); if(!rows.length) return [];
  const width=Math.max(...rows.map(r=>r.length)), header=rows[0].map((v,i)=>text(v,500)||`column_${i+1}`); while(header.length<width)header.push(`column_${header.length+1}`);
  const seen=new Set<string>(), clean=[header], errors:string[]=[];
  rows.slice(1).forEach((r,ix)=>{ while(r.length<width)r.push(""); const x=r.slice(0,width).map(v=>text(v,10000)), k=hash(x.map(v=>v.toLowerCase()));
    if(seen.has(k)){errors.push(`row ${ix+2}: duplicate removed`);return;} seen.add(k); const miss=x.map((v,i)=>v?"":header[i]).filter(Boolean); if(miss.length)errors.push(`row ${ix+2}: missing ${miss.join(", ")}`); clean.push(x); });
  const csv=clean.map(r=>r.map(esc).join(",")).join("\n"), report=[`source: ${a.name}`,`input rows: ${rows.length-1}`,`output rows: ${clean.length-1}`,`exceptions: ${errors.length}`,...errors].join("\n");
  return [{type:"normalized_csv",name:a.name.replace(/\.csv$/i,"")+".normalized.csv",content:csv,sha256:hash(csv)},{type:"exception_report",name:a.name.replace(/\.csv$/i,"")+".exceptions.txt",content:report,sha256:hash(report)}];
}

function value(x: any = {}) {
  const b=n(x.humanMinutesBaseline), w=n(x.humanMinutesWithSystem), hourly=n(x.fullyLoadedHourlyCostUsd), rev=n(x.revenueOpportunityUsd), conf=n(x.revenueConfidence,0,1);
  const time=b!==null&&w!==null&&hourly!==null?Math.max(0,b-w)*hourly/60:null, expected=rev!==null&&conf!==null?rev*conf:null;
  const used:any={}; [["humanMinutesBaseline",b],["humanMinutesWithSystem",w],["fullyLoadedHourlyCostUsd",hourly],["revenueOpportunityUsd",rev],["revenueConfidence",conf]].forEach(([k,v])=>{if(v!==null)used[k as string]=v;});
  return { status:Object.keys(used).length?"assumption_based":"not_estimated", timeValueUsd:time===null?null:+time.toFixed(2), expectedRevenueUsd:expected===null?null:+expected.toFixed(2),
    totalEstimatedValueUsd:Object.keys(used).length?+((time??0)+(expected??0)).toFixed(2):null, assumptionsUsed:used, warning:"Estimate only; not causal attribution or realized profit." };
}

function version(r: RecordItem) { return { at:now(), state:r.state, sha256:hash({state:r.state,evidence:r.evidenceEnvelope.immutableSha256,task:r.taskIR,gate:r.commitGate,outcome:r.outcome??null}) }; }

export async function compilePepi(input: any): Promise<RecordItem> {
  const email=normalizeEmail(input.email), ev={id:uid("evidence"),sourceType:"email",sourceId:email.id,threadId:email.threadId,receivedAt:email.receivedAt,capturedAt:now(),immutableSha256:hash(email),snapshot:email};
  const auth=authority(email,input.authority), comp=compliance(email,auth), task=taskIR(email,comp);
  const artifacts=comp.state==="blocked"?[]:email.attachments.flatMap(csvArtifacts);
  const reply=`Request compiled: ${task.intent}\nActions: ${task.requestedActions.join(", ")}\nArtifacts staged: ${artifacts.length}\nNo external side effect performed.`;
  if(comp.state!=="blocked")artifacts.push({type:"reply_draft",name:"reply-draft.txt",content:reply,sha256:hash(reply)});
  const capabilities=[{id:"preserve",mode:"read",status:"available"},{id:"compile",mode:"transform",status:"available"},{id:"transform",mode:"transform",status:email.attachments.length?"available":"requires_input"},{id:"draft",mode:"draft",status:comp.state==="blocked"?"blocked":"available"},{id:"commit",mode:"commit",status:comp.state==="blocked"?"blocked":"requires_approval"}];
  const dag=[{id:"1",action:"preserve and hash source",dependsOn:[],reversible:true,status:"executed"},{id:"2",action:"compile Task IR",dependsOn:["1"],reversible:true,status:"executed"},{id:"3",action:"safe local transforms",dependsOn:["2"],reversible:true,status:artifacts.length>1?"executed":"planned"},{id:"4",action:"stage review artifacts",dependsOn:["2","3"],reversible:true,status:comp.state==="blocked"?"blocked":"staged"},{id:"5",action:"approved external commit",dependsOn:["4"],reversible:false,status:comp.state==="blocked"?"blocked":"staged"}];
  const twin={id:uid("twin"),status:comp.state==="blocked"?"ineligible":"shadow",hypothesis:`Compiled workflow reduces cycle time or revision burden for: ${task.intent}`,control:"current human workflow",intervention:"Task IR + safe transforms + human commit gate + receipt",primaryMetric:"accepted-without-revision rate and verified cycle time",promotionGate:"replicated improvement against scalar baseline"};
  const commit={state:comp.state==="blocked"?"blocked":"awaiting_human_approval",requiredScope:uniq([...comp.externalEffects,artifacts.length?"deliver staged artifacts":""])};
  const receipt={id:uid("receipt"),engine:"PEPI-SPINOR",engineVersion:VERSION,createdAt:now(),evidenceSha256:ev.immutableSha256,taskSha256:hash(task),planSha256:hash({capabilities,dag,commit,twin}),artifacts:artifacts.map((a:any)=>({name:a.name,sha256:a.sha256})),complianceState:comp.state,authorityStatus:auth.status,externalSideEffectsPerformed:false};
  const record:RecordItem={id:uid("pepi"),state:comp.state==="blocked"?"blocked":"compiled",createdAt:now(),updatedAt:now(),evidenceEnvelope:ev,roleOperatingContract:{actorId:text(input.roleContract?.actorId,300)||"human_reviewer",role:text(input.roleContract?.role,200)||"authorized workflow reviewer",permittedCapabilities:["read","transform","draft"],prohibitedCapabilities:["clinical truth","off-label promotion","patient manipulation","unapproved irreversible action"]},authority:auth,taskIR:task,compliance:comp,capabilityGraph:capabilities,executionDAG:dag,artifacts,experimentTwin:twin,valueAttribution:value(input.economicAssumptions),commitGate:commit,receipt,forwardStateSha256:hash({ev,task,comp,capabilities,dag,artifacts,twin}),versions:[]};
  record.versions.push(version(record)); const rows=await load(); rows.push(record); await save(rows); return record;
}

async function approve(body:any) { const rows=await load(), r=rows.find(x=>x.id===text(body.recordId,200)); if(!r)throw new Error("record not found"); if(r.state==="blocked")throw new Error("blocked record cannot be approved");
  const by=text(body.approval?.approvedBy,300), scope=uniq((body.approval?.scope??[]).map((x:any)=>text(x,200))); if(!by||!scope.length)throw new Error("approval requires approvedBy and scope");
  r.commitGate={...r.commitGate,state:"approved",approvedBy:by,approvedAt:now(),approvalNote:text(body.approval?.note,2000)||undefined}; r.state="approved"; r.updatedAt=now(); r.versions.push(version(r)); await save(rows); return r; }

async function outcome(body:any) { const rows=await load(), r=rows.find(x=>x.id===text(body.recordId,200)); if(!r)throw new Error("record not found"); const o=body.outcome??{};
  r.outcome={acceptedWithoutRevision:o.acceptedWithoutRevision,actualMinutes:n(o.actualMinutes),errorsFound:n(o.errorsFound),revenueObservedUsd:n(o.revenueObservedUsd),controlObservations:n(o.controlObservations),interventionObservations:n(o.interventionObservations),notes:text(o.notes,10000)||undefined};
  const experimental=(r.outcome.controlObservations??0)>=3&&(r.outcome.interventionObservations??0)>=3;
  r.reversePass={createdAt:now(),preservedEvidenceSha256:r.evidenceEnvelope.immutableSha256,outcomeClass:o.acceptedWithoutRevision===true?"accepted":o.acceptedWithoutRevision===false?"revised":"unknown",causalStatus:experimental?"experiment_candidate":"not_established",learningClaims:[o.acceptedWithoutRevision===true?"accepted without revision":"acceptance not established","source hash preserved"],skillGenomeCandidate:{id:uid("skill"),status:o.acceptedWithoutRevision===true&&experimental?"candidate":"insufficient_evidence",triggerPattern:r.taskIR.intent,reusableSteps:r.executionDAG.filter(x=>x.status==="executed"||x.status==="staged").map(x=>x.action),requiredEvidence:"replicated improvement against scalar baseline"}};
  if(r.outcome.revenueObservedUsd!==null)r.valueAttribution={...r.valueAttribution,status:"observed_not_causal",warning:"Caller-supplied observed revenue; causal contribution is not established."};
  r.state="outcome_recorded";r.updatedAt=now();r.versions.push(version(r));await save(rows);return r; }

export async function selfTest() { const old=process.env.SPINOR_AUTHORIZED_DOMAINS; process.env.SPINOR_AUTHORIZED_DOMAINS="example.com"; const tests:any[]=[]; const check=(name:string,ok:boolean)=>tests.push({name,passed:ok});
  try { const r=await compilePepi({email:{from:"manager@example.com",subject:"Normalize CSV and draft reply",body:"Clean and deduplicate. Do not send.",attachments:[{name:"p.csv",contentType:"text/csv",contentText:"Name,City\n Alice ,NYC\nAlice,NYC\nBob,"}]},economicAssumptions:{humanMinutesBaseline:60,humanMinutesWithSystem:15,fullyLoadedHourlyCostUsd:80}});
    check("authority",r.authority.status==="verified");check("csv",r.artifacts.some(x=>x.type==="normalized_csv"));check("no side effect",r.receipt.externalSideEffectsPerformed===false);check("value",r.valueAttribution.totalEstimatedValueUsd===60);const before=r.evidenceEnvelope.immutableSha256;const a=await approve({recordId:r.id,approval:{approvedBy:"reviewer@example.com",scope:["deliver staged artifacts"]}});check("immutable",a.evidenceEnvelope.immutableSha256===before);
    const b=await compilePepi({email:{from:"manager@example.com",subject:"Patient prescribing",body:"Diagnose and increase dose off-label."}});check("clinical block",b.state==="blocked"); }
  finally { if(old===undefined)delete process.env.SPINOR_AUTHORIZED_DOMAINS;else process.env.SPINOR_AUTHORIZED_DOMAINS=old; }
  return {passed:tests.filter(x=>x.passed).length,failed:tests.filter(x=>!x.passed).length,tests}; }

export async function GET(req:NextRequest){try{const q=new URL(req.url).searchParams;if(q.get("selfTest")==="1"){const s=await selfTest();return NextResponse.json({engine:"PEPI-SPINOR",version:VERSION,selfTest:s},{status:s.failed?500:200});}const rows=await load(),rid=text(q.get("id"),200);if(rid){const r=rows.find(x=>x.id===rid);return r?NextResponse.json({record:r}):NextResponse.json({error:"record not found"},{status:404});}return NextResponse.json({engine:"PEPI-SPINOR",version:VERSION,status:"ready",records:rows.slice(-50).map(r=>({id:r.id,state:r.state,intent:r.taskIR.intent,compliance:r.compliance.state,authority:r.authority.status,commitGate:r.commitGate.state})),persistence:"filesystem when writable; process cache otherwise"});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"unexpected error"},{status:500});}}
export async function POST(req:NextRequest){try{if(Number(req.headers.get("content-length")??0)>MAX_BYTES)return NextResponse.json({error:"request too large"},{status:413});const b=await req.json();if(b?.mode==="approve")return NextResponse.json({record:await approve(b)});if(b?.mode==="record-outcome")return NextResponse.json({record:await outcome(b)});return NextResponse.json({record:await compilePepi(b)},{status:201});}catch(e){const m=e instanceof Error?e.message:"unexpected error";return NextResponse.json({error:m},{status:/required|valid|not found|cannot/i.test(m)?400:500});}}
