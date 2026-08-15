/**
 * Pharma Intelligence Engine
 *
 * Six capabilities no competitor has:
 * 1. Scientific Claim Extraction (PICO framework from emails)
 * 2. Adversarial Self-Testing (generate counterargument, score both)
 * 3. Mechanism Isolation (decompose which message component drives effect)
 * 4. Falsification Pre-Registration (lock hypothesis before outreach)
 * 5. COM-B Behavioral Diagnostics (Capability/Opportunity/Motivation barriers)
 * 6. Claim Resonance Prediction (which claims resonate with which HCP specialty)
 *
 * Powered by the Ollama LLM endpoint (llama3.2:1b on prism-ollama.fly.dev).
 * Falls back to heuristic analysis if LLM is unavailable.
 */

// ─── Types ─────────────────────────────────────────────────────────────

export interface PICOClaim {
  population: string;
  intervention: string;
  comparator: string;
  outcome: string;
  claimText: string;
  evidenceLevel: "systematic-review" | "rct" | "observational" | "mechanistic" | "anecdotal" | "none";
  confidence: number; // 0-1
}

export interface AdversarialResult {
  originalMessage: string;
  counterargument: string;
  originalScore: number;   // 0-100 persuasiveness
  counterScore: number;    // 0-100 persuasiveness
  winner: "original" | "counter" | "tie";
  vulnerabilities: string[];  // weaknesses in the original message
  rebuttal: string;           // how the original message could defend itself
}

export interface MechanismIsolation {
  components: {
    component: "subject" | "sender" | "timing" | "scientific-claim" | "cta" | "social-proof" | "format";
    contribution: number;     // estimated % of effect
    reasoning: string;
    confidence: number;
  }[];
  dominantMechanism: string;
  isolationMethod: string;
}

export interface Preregistration {
  hypothesisId: string;
  hypothesis: string;
  nullHypothesis: string;
  falsificationCondition: string;  // what result would falsify this
  primaryMetric: string;
  minimumEffectSize: number;
  sampleSize: number;
  analysisPlan: string;
  registeredAt: string;
  locked: boolean;  // once locked, cannot be changed
}

export interface ComBDiagnosis {
  capabilityBarriers: string[];   // does HCP know how / have skills?
  opportunityBarriers: string[]; // does HCP have access / time / resources?
  motivationBarriers: string[];  // does HCP want to / believe in it?
  dominantBarrier: "capability" | "opportunity" | "motivation";
  interventionType: string;      // what type of intervention would address the barrier
  behaviorChangeTechniques: string[];  // COM-B technique catalogue
}

export interface ClaimResonance {
  claim: string;
  specialty: string;
  resonanceScore: number;        // 0-100, how well this claim resonates
  reasoning: string;
  alternativeClaims: string[];   // claims that might resonate better
  evidenceBase: string;          // what evidence supports this claim
}

export interface PharmacovigilanceScan {
  adverseEvents: { term: string; meddraLikely: string; seriousness: "serious" | "non-serious" | "unknown"; causality: string }[];
  offLabelMentions: { term: string; context: string; riskLevel: "high" | "medium" | "low" }[];
  mandatoryReportTrigger: boolean;
  reportDeadline: string;        // "24h", "7d", "15d", "none"
  restrictedTerms: string[];
  fairBalanceStatus: "balanced" | "risk-missing" | "benefit-only" | "over-claimed";
}

export interface PharmaAnalysis {
  picoClaims: PICOClaim[];
  adversarial: AdversarialResult | null;
  mechanism: MechanismIsolation | null;
  preregistration: Preregistration | null;
  combDiagnosis: ComBDiagnosis | null;
  claimResonance: ClaimResonance[];
  pharmacovigilance: PharmacovigilanceScan;
  // Enhanced value scoring (replaces the regex-based one)
  pharmaValueScore: number;      // 0-100
  pharmaValueTags: string[];
  scientificComplexity: number;  // 0-100
  hcpRelevance: number;          // 0-100
  regulatoryRisk: number;        // 0-100
}

// ─── LLM Helper ────────────────────────────────────────────────────────

const OLLAMA_ENDPOINT = process.env.LLM_ENDPOINT || "https://prism-ollama.fly.dev/api/chat";
const OLLAMA_MODEL = process.env.LLM_MODEL || "llama3.2:1b";

async function llmChat(
  systemPrompt: string,
  userPrompt: string,
  maxRetries = 2,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(OLLAMA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
          options: { temperature: 0.3, top_p: 0.9 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.message?.content || data?.response || "";
      if (content.trim().length > 0) return content.trim();
    } catch {
      // retry
    }
  }
  return null;
}

function tryParseJSON(text: string): any | null {
  // Extract JSON from LLM output (handles ```json blocks and raw JSON)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    try { return JSON.parse(text); } catch { return null; }
  }
  try { return JSON.parse(jsonMatch[0]); } catch {
    // Try cleaning up common issues
    const cleaned = jsonMatch[0]
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try { return JSON.parse(cleaned); } catch { return null; }
  }
}

// ─── 1. Scientific Claim Extraction (PICO) ─────────────────────────────

export async function extractPICOClauses(
  subject: string,
  body: string,
): Promise<PICOClaim[]> {
  const text = `${subject}\n\n${body}`.slice(0, 3000);
  const system = `You are a biomedical NLP system. Extract scientific claims using the PICO framework (Population, Intervention, Comparator, Outcome). Return JSON array of claims. Each claim: {population, intervention, comparator, outcome, claimText, evidenceLevel, confidence}. evidenceLevel: "systematic-review"|"rct"|"observational"|"mechanistic"|"anecdotal"|"none". confidence: 0-1. Return ONLY JSON.`;
  const user = `Extract PICO claims from this email:\n\n${text}`;

  const result = await llmChat(system, user);
  if (!result) return heuristicPICO(subject, body);

  const parsed = tryParseJSON(result);
  if (Array.isArray(parsed)) return parsed.slice(0, 5);
  if (parsed && Array.isArray(parsed.claims)) return parsed.claims.slice(0, 5);
  return heuristicPICO(subject, body);
}

export function heuristicPICO(subject: string, body: string): PICOClaim[] {
  const text = `${subject} ${body}`;
  const lower = text.toLowerCase();
  const claims: PICOClaim[] = [];

  // Detect drug names by suffix patterns and common brand names
  const drugSuffixes = text.match(/\b([A-Z][a-z]+(?:mab|nib|pril|sartan|statin|parib|ciclib|vir|sertib|tinib))\b/g) || [];
  const brandNames = text.match(/\b(Biktarvy|Descovy|Truvada|Genvoya|Symtuza|Juluca|Dovato|Atripla|Complera|Odefsey|Stribild|Keytruda|Opdivo|Yervoy|Tecentriq|Imfinzi|Libtayo|Eliquis|Xarelto|Pradaxa|Savaysa|Farxiga|Jardiance|Invokana|Steglatro|Ozempic|Wegovy|Rybelsus|Trulicity|Victoza|Byetta|Januvia|Trajenta|Nesina|Steglujan|Segluromet|Qtern|Steglatro)\b/gi) || [];
  const drugs = [...new Set([...drugSuffixes, ...brandNames])];

  // Detect outcome terms
  const outcomePatterns: { regex: RegExp; label: string }[] = [
    { regex: /\boverall survival\b/gi, label: "overall survival" },
    { regex: /\bprogression[- ]free survival\b/gi, label: "progression-free survival" },
    { regex: /\b(?:objective )?response rate\b/gi, label: "response rate" },
    { regex: /\bcomplete remission\b/gi, label: "complete remission" },
    { regex: /\bmortality\b/gi, label: "mortality" },
    { regex: /\bmorbidity\b/gi, label: "morbidity" },
    { regex: /\badherence\b/gi, label: "adherence" },
    { regex: /\bquality of life\b/gi, label: "quality of life" },
    { regex: /\bviral suppression\b/gi, label: "viral suppression" },
    { regex: /\bHbA1c\b/gi, label: "HbA1c reduction" },
    { regex: /\bweight (loss|reduction)\b/gi, label: "weight reduction" },
    { regex: /\bformulary (approval|access|coverage)\b/gi, label: "formulary approval" },
    { regex: /\bcardiovascular (events|outcome|mortality)\b/gi, label: "cardiovascular events" },
  ];
  const outcomes: string[] = [];
  for (const { regex, label } of outcomePatterns) {
    if (regex.test(text)) outcomes.push(label);
  }

  // Detect population terms
  const popPatterns: { regex: RegExp; label: string }[] = [
    { regex: /\btreatment[- ]naive\b/gi, label: "treatment-naive patients" },
    { regex: /\btreatment[- ]experienced\b/gi, label: "treatment-experienced patients" },
    { regex: /\bpediatric\b/gi, label: "pediatric patients" },
    { regex: /\belderly|geriatric\b/gi, label: "elderly patients" },
    { regex: /\bHIV[- ]positive\b/gi, label: "HIV-positive patients" },
    { regex: /\boncology|cancer\b/gi, label: "oncology patients" },
    { regex: /\bchronic kidney\b/gi, label: "chronic kidney disease patients" },
    { regex: /\btype 2 diabetes\b/gi, label: "type 2 diabetes patients" },
  ];
  let population = "patients (inferred)";
  for (const { regex, label } of popPatterns) {
    if (regex.test(text)) { population = label; break; }
  }

  // Detect evidence level
  let evidenceLevel: PICOClaim["evidenceLevel"] = "anecdotal";
  if (/systematic review|meta[- ]analysis/i.test(text)) evidenceLevel = "systematic-review";
  else if (/\bRCT\b|randomized controlled trial|randomised/i.test(text)) evidenceLevel = "rct";
  else if (/observational|cohort study|retrospective/i.test(text)) evidenceLevel = "observational";
  else if (/mechanism|pathway|in vitro|animal model/i.test(text)) evidenceLevel = "mechanistic";

  // Detect comparator
  let comparator = "standard of care (inferred)";
  const compMatch = text.match(/\b(?:vs\.?|versus|compared to|compared with)\s+([A-Z][a-z]+)/g);
  if (compMatch) comparator = compMatch[0].replace(/^(?:vs\.?|versus|compared to|compared with)\s+/i, "");

  // Build claims from drug-outcome pairs
  if (drugs.length > 0 && outcomes.length > 0) {
    for (const drug of drugs.slice(0, 3)) {
      for (const outcome of outcomes.slice(0, 2)) {
        const verb = /mortality|morbidity/.test(outcome) ? "reduces" : /adherence|quality of life/.test(outcome) ? "improves" : "improves";
        claims.push({
          population,
          intervention: drug,
          comparator,
          outcome,
          claimText: `${drug} ${verb} ${outcome} in ${population}`,
          evidenceLevel,
          confidence: evidenceLevel === "rct" ? 0.7 : evidenceLevel === "observational" ? 0.5 : 0.3,
        });
      }
    }
  }

  // Also detect generic claim sentences ("X improves/reduces/increases Y")
  const claimSentences = text.match(/[^.!?]*(?:improves|reduces|increases|decreases|enhances|prevents|lowers|raises)[^.!?]*[.!?]/gi) || [];
  for (const sentence of claimSentences.slice(0, 3)) {
    if (claims.length >= 5) break;
    const existing = claims.some(c => sentence.toLowerCase().includes(c.intervention.toLowerCase()));
    if (!existing) {
      claims.push({
        population,
        intervention: drugs[0] || "the intervention",
        comparator,
        outcome: outcomes[0] || "the measured outcome",
        claimText: sentence.trim(),
        evidenceLevel,
        confidence: 0.3,
      });
    }
  }

  return claims.slice(0, 5);
}

// ─── 2. Adversarial Self-Testing ───────────────────────────────────────

export async function generateAdversarialTest(
  message: string,
  hcpContext?: string,
): Promise<AdversarialResult> {
  const system = `You are an adversarial marketing analyst for pharmaceutical HCP outreach. Given a proposed outreach message, generate the STRONGEST possible counterargument that a skeptical HCP would make. Then score both on persuasiveness (0-100). Return JSON: {originalMessage, counterargument, originalScore, counterScore, winner, vulnerabilities[], rebuttal}. winner: "original"|"counter"|"tie". Return ONLY JSON.`;
  const user = `Proposed outreach:\n${message}\n\nHCP context: ${hcpContext || "general HCP"}`;

  const result = await llmChat(system, user);
  if (!result) return heuristicAdversarial(message);

  const parsed = tryParseJSON(result);
  if (parsed && parsed.counterargument) {
    return {
      originalMessage: message,
      counterargument: parsed.counterargument,
      originalScore: Number(parsed.originalScore) || 50,
      counterScore: Number(parsed.counterScore) || 50,
      winner: parsed.winner || "tie",
      vulnerabilities: parsed.vulnerabilities || [],
      rebuttal: parsed.rebuttal || "",
    };
  }
  return heuristicAdversarial(message);
}

export function heuristicAdversarial(message: string): AdversarialResult {
  const lower = message.toLowerCase();
  const vulnerabilities: string[] = [];
  const counterParts: string[] = [];

  // 1. Check for evidence citations
  const hasRCT = /\bRCT\b|randomized|randomised/.test(lower);
  const hasMeta = /meta[- ]analysis|systematic review/.test(lower);
  const hasData = /data|study|trial|evidence|results/.test(lower);
  const hasNumbers = /\d+%|\d+\.\d+|p\s*[<>=]\s*0\.\d+|CI\s*\d+/.test(message);

  if (!hasRCT && !hasMeta) {
    vulnerabilities.push("no randomized controlled trial or meta-analysis cited");
    counterParts.push("The claims lack support from randomized controlled trials or meta-analyses, which are the gold standard for evidence-based medicine.");
  }
  if (hasData && !hasNumbers) {
    vulnerabilities.push("quantitative data not provided");
    counterParts.push("No specific effect sizes, confidence intervals, or p-values are provided to quantify the magnitude of benefit.");
  }

  // 2. Check for population specificity
  const hasPopulation = /\b(treatment[- ]naive|treatment[- ]experienced|pediatric|elderly|HIV|oncology|diabetes|chronic kidney|pregnant)\b/i.test(message);
  if (!hasPopulation) {
    vulnerabilities.push("target population not specified");
    counterParts.push("The message does not specify which patient population would benefit, making it difficult to apply to specific HCP patient panels.");
  }

  // 3. Check for safety mentions
  const hasSafety = /safety|tolerability|adverse|side effect|well[- ]tolerated/.test(lower);
  if (!hasSafety) {
    vulnerabilities.push("safety profile not addressed");
    counterParts.push("The safety profile and potential adverse events are not discussed, which is critical for prescribing decisions.");
  }

  // 4. Check for comparator
  const hasComparator = /\b(vs\.?|versus|compared to|compared with|alternative to|better than|superior)\b/i.test(message);
  if (!hasComparator) {
    vulnerabilities.push("no comparator or alternative discussed");
    counterParts.push("Without comparing to existing standard of care or alternatives, the relative benefit cannot be assessed.");
  }

  // 5. Check for regulatory claims
  const hasRestricted = /\b(cure|miracle|breakthrough|guaranteed|100%|no side effects|safe for all)\b/i.test(message);
  if (hasRestricted) {
    vulnerabilities.push("restricted or non-compliant terminology used");
    counterParts.push("The message uses terms that may not comply with FDA advertising regulations and could undermine credibility with the HCP.");
  }

  // 6. Check for hedging / overstatement
  const hasOverstatement = /\b(always|never|all patients|guaranteed|proven|definitively)\b/i.test(message);
  if (hasOverstatement) {
    vulnerabilities.push("overstated certainty");
    counterParts.push("Absolute language like 'always' or 'proven' overstates the evidence and may trigger skepticism in experienced clinicians.");
  }

  // If no vulnerabilities found, the message is well-constructed
  if (vulnerabilities.length === 0) {
    vulnerabilities.push("limited personalization to HCP practice context");
    counterParts.push("While the evidence is sound, the message does not connect to the specific HCP's patient population or practice patterns.");
  }

  const counterargument = counterParts.join(" ");

  // Score: original starts at 70 and loses points per vulnerability; counter gains those points
  const originalScore = Math.max(20, 70 - vulnerabilities.length * 8);
  const counterScore = Math.min(80, 30 + vulnerabilities.length * 8);
  const winner: AdversarialResult["winner"] = originalScore >= counterScore ? "original" : counterScore > originalScore ? "counter" : "tie";

  // Build rebuttal addressing the top 2 vulnerabilities
  const rebuttalParts: string[] = [];
  if (vulnerabilities.includes("no randomized controlled trial or meta-analysis cited")) {
    rebuttalParts.push("Cite the specific RCT or meta-analysis with effect size and confidence interval.");
  }
  if (vulnerabilities.includes("target population not specified")) {
    rebuttalParts.push("Specify the patient population (e.g., treatment-naive adults with HIV-1).");
  }
  if (vulnerabilities.includes("safety profile not addressed")) {
    rebuttalParts.push("Include the most common adverse events and discontinuation rates from clinical trials.");
  }
  if (vulnerabilities.includes("no comparator or alternative discussed")) {
    rebuttalParts.push("Compare directly to the current standard of care with head-to-head data.");
  }
  if (vulnerabilities.includes("quantitative data not provided")) {
    rebuttalParts.push("Add specific numbers: response rates, p-values, NNT, or hazard ratios.");
  }
  if (rebuttalParts.length === 0) {
    rebuttalParts.push("Tailor the message to the HCP's specific patient panel and prescribing history.");
  }

  return {
    originalMessage: message,
    counterargument,
    originalScore,
    counterScore,
    winner,
    vulnerabilities,
    rebuttal: rebuttalParts.slice(0, 3).join(" "),
  };
}

// ─── 3. Mechanism Isolation ────────────────────────────────────────────

export async function isolateMechanisms(
  email: { subject: string; from: string; date: string; body: string },
  outcomeData?: { openRate?: number; clickRate?: number; responseRate?: number },
): Promise<MechanismIsolation> {
  const system = `You are a causal marketing analyst. Decompose which components of an email drove engagement. Estimate the % contribution of each component to the observed effect. Components: subject, sender, timing, scientific-claim, cta, social-proof, format. Return JSON: {components: [{component, contribution, reasoning, confidence}], dominantMechanism, isolationMethod}. Contributions should sum to ~100. Return ONLY JSON.`;
  const user = `Email:\nSubject: ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}\nBody: ${(email.body || "").slice(0, 1000)}\n\nOutcome: ${JSON.stringify(outcomeData || {})}`;

  const result = await llmChat(system, user);
  if (!result) return heuristicMechanism(email);

  const parsed = tryParseJSON(result);
  if (parsed && Array.isArray(parsed.components)) {
    return {
      components: parsed.components.map((c: any) => ({
        component: c.component,
        contribution: Number(c.contribution) || 0,
        reasoning: c.reasoning || "",
        confidence: Number(c.confidence) || 0.5,
      })),
      dominantMechanism: parsed.dominantMechanism || "unknown",
      isolationMethod: parsed.isolationMethod || "LLM-based decomposition",
    };
  }
  return heuristicMechanism(email);
}

export function heuristicMechanism(email: { subject: string; from: string; date: string; body: string }): MechanismIsolation {
  const subject = email.subject || "";
  const body = email.body || "";
  const from = email.from || "";
  const date = email.date || "";
  const text = `${subject} ${body}`.toLowerCase();

  // Analyze each component based on actual email content
  const components: MechanismIsolation["components"] = [];

  // Subject: longer and more specific subjects drive higher open rates
  const subjectLen = subject.length;
  const subjectHasNumber = /\d+%|\d+\.\d+|trial|study|phase/i.test(subject);
  const subjectHasDrug = /\b[A-Z][a-z]+(?:mab|nib|vir|pril|sartan)\b|Biktarvy|Descovy|Keytruda|Opdivo/i.test(subject);
  let subjectScore = 20;
  if (subjectLen > 30) subjectScore += 10;
  if (subjectLen > 60) subjectScore += 5;
  if (subjectHasNumber) subjectScore += 8;
  if (subjectHasDrug) subjectScore += 7;
  components.push({
    component: "subject",
    contribution: subjectScore,
    reasoning: `Subject is ${subjectLen} chars${subjectHasNumber ? ", contains quantitative data" : ""}${subjectHasDrug ? ", mentions specific drug" : ""}`,
    confidence: 0.6,
  });

  // Sender: known pharma domains score higher
  const senderDomain = from.match(/@([\w.]+)/)?.[1] || "";
  const isPharmaDomain = /pharma|medical|scientific|msd|gilead|pfizer|novartis|roche|merck|bms|astrazeneca/i.test(senderDomain);
  const isNamedRep = /\b(rep|representative|specialist|liaison)\b/i.test(from) && !from.includes("no-reply") && !from.includes("noreply");
  let senderScore = 10;
  if (isPharmaDomain) senderScore += 8;
  if (isNamedRep) senderScore += 10;
  if (from.includes("no-reply") || from.includes("noreply")) senderScore -= 5;
  components.push({
    component: "sender",
    contribution: Math.max(5, senderScore),
    reasoning: `Sender from ${senderDomain || "unknown domain"}${isNamedRep ? ", named representative" : ""}${from.includes("no-reply") ? ", no-reply address reduces trust" : ""}`,
    confidence: 0.5,
  });

  // Timing: analyze send day/time
  let timingScore = 10;
  let timingReason = "Send time not analyzed";
  if (date) {
    const d = new Date(date);
    const day = d.getDay();
    const hour = d.getHours();
    if (day >= 1 && day <= 5 && hour >= 7 && hour <= 11) {
      timingScore = 18;
      timingReason = "Sent on weekday morning (high engagement window)";
    } else if (day >= 1 && day <= 5 && hour >= 13 && hour <= 16) {
      timingScore = 14;
      timingReason = "Sent on weekday afternoon (moderate engagement)";
    } else if (day === 0 || day === 6) {
      timingScore = 5;
      timingReason = "Sent on weekend (low engagement)";
    } else {
      timingScore = 10;
      timingReason = "Sent outside optimal window";
    }
  }
  components.push({
    component: "timing",
    contribution: timingScore,
    reasoning: timingReason,
    confidence: 0.5,
  });

  // Scientific claim: detect data, trial references, outcomes
  const hasTrialRef = /\b(?:trial|study|phase [IIV]+|NCT\d+)\b/i.test(text);
  const hasOutcome = /\b(?:survival|response rate|remission|adherence|HbA1c|viral suppression|mortality)\b/i.test(text);
  const hasEffectSize = /\d+%|p\s*[<>=]|CI\s*\d+|hazard ratio|NNT/i.test(text);
  let sciScore = 10;
  if (hasTrialRef) sciScore += 8;
  if (hasOutcome) sciScore += 6;
  if (hasEffectSize) sciScore += 6;
  components.push({
    component: "scientific-claim",
    contribution: Math.min(30, sciScore),
    reasoning: `Contains ${hasTrialRef ? "trial reference" : "no trial reference"}${hasOutcome ? ", clinical outcome" : ""}${hasEffectSize ? ", quantitative effect size" : ""}`,
    confidence: 0.7,
  });

  // CTA: detect call-to-action
  const hasCTA = /\b(?:schedule|register|download|learn more|click here|reply|contact|visit|join|watch|request)\b/i.test(text);
  const ctaCount = (text.match(/\b(?:schedule|register|download|learn more|click here|reply|contact|visit|join|watch|request)\b/gi) || []).length;
  components.push({
    component: "cta",
    contribution: hasCTA ? Math.min(15, 8 + ctaCount * 2) : 5,
    reasoning: hasCTA ? `${ctaCount} call-to-action phrase(s) detected` : "No clear call-to-action detected",
    confidence: 0.6,
  });

  // Social proof: detect testimonials, guideline references, expert quotes
  const hasGuideline = /\b(?:guideline|NCCN|ADA|EASL|WHO|FDA[- ]approved|guideline[- ]recommended)\b/i.test(text);
  const hasExpert = /\b(?:Dr\.|Professor|expert|opinion leader|KOL|thought leader)\b/i.test(text);
  const hasPeer = /\b(?:colleagues|peers|other (physicians|HCPs|practices))\b/i.test(text);
  let socialScore = 5;
  if (hasGuideline) socialScore += 6;
  if (hasExpert) socialScore += 4;
  if (hasPeer) socialScore += 3;
  components.push({
    component: "social-proof",
    contribution: Math.min(15, socialScore),
    reasoning: `${hasGuideline ? "Guideline reference" : "No guideline reference"}${hasExpert ? ", expert mention" : ""}${hasPeer ? ", peer reference" : ""}`,
    confidence: 0.5,
  });

  // Format: detect structure (headers, bullet points, links, length)
  const hasBullets = /[\n\r]\s*[-•*]\s/.test(body);
  const hasHeaders = /[\n\r][A-Z][A-Za-z\s]+:[\n\r]/.test(body);
  const hasLink = /https?:\/\//.test(body);
  const bodyLen = body.length;
  let formatScore = 5;
  if (hasBullets) formatScore += 3;
  if (hasHeaders) formatScore += 2;
  if (hasLink) formatScore += 2;
  if (bodyLen > 200 && bodyLen < 1000) formatScore += 3;
  if (bodyLen > 2000) formatScore -= 2; // too long reduces engagement
  components.push({
    component: "format",
    contribution: Math.max(3, Math.min(12, formatScore)),
    reasoning: `Body is ${bodyLen} chars${hasBullets ? ", bulleted" : ""}${hasHeaders ? ", has headers" : ""}${hasLink ? ", contains links" : ""}`,
    confidence: 0.4,
  });

  // Normalize contributions to sum to 100
  const total = components.reduce((sum, c) => sum + c.contribution, 0);
  for (const c of components) c.contribution = Math.round((c.contribution / total) * 100);

  // Dominant mechanism = highest contribution
  const dominant = components.reduce((max, c) => (c.contribution > max.contribution ? c : max), components[0]);

  return {
    components,
    dominantMechanism: dominant.component,
    isolationMethod: "local content analysis (no LLM)",
  };
}

// ─── 4. Falsification Pre-Registration ─────────────────────────────────

export function createPreregistration(params: {
  hypothesis: string;
  primaryMetric: string;
  minimumEffectSize: number;
  sampleSize: number;
}): Preregistration {
  const hypothesisId = `prereg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    hypothesisId,
    hypothesis: params.hypothesis,
    nullHypothesis: `No difference in ${params.primaryMetric} between intervention and control.`,
    falsificationCondition: `If the observed ${params.primaryMetric} improvement is less than ${params.minimumEffectSize} with sample size ${params.sampleSize}, the hypothesis is falsified.`,
    primaryMetric: params.primaryMetric,
    minimumEffectSize: params.minimumEffectSize,
    sampleSize: params.sampleSize,
    analysisPlan: `Compare ${params.primaryMetric} between intervention and control groups using two-proportion z-test. Significance threshold: p < 0.05. Effect size threshold: ${params.minimumEffectSize}.`,
    registeredAt: new Date().toISOString(),
    locked: true,
  };
}

export async function generateHypothesisFromEmail(
  subject: string,
  body: string,
): Promise<Preregistration> {
  const system = `You are a scientific hypothesis generator for HCP outreach experiments. Given an email, generate a falsifiable hypothesis about its effect. Return JSON: {hypothesis, primaryMetric, minimumEffectSize, sampleSize}. primaryMetric should be measurable (e.g., "response rate", "meeting acceptance rate"). minimumEffectSize is a percentage (e.g., 5 for 5%). sampleSize is minimum HCPs needed. Return ONLY JSON.`;
  const user = `Email subject: ${subject}\nBody: ${(body || "").slice(0, 1000)}`;

  const result = await llmChat(system, user);
  if (!result) return heuristicHypothesis(subject, body);

  const parsed = tryParseJSON(result);
  if (parsed && parsed.hypothesis) {
    return createPreregistration({
      hypothesis: parsed.hypothesis,
      primaryMetric: parsed.primaryMetric || "response rate",
      minimumEffectSize: Number(parsed.minimumEffectSize) || 5,
      sampleSize: Number(parsed.sampleSize) || 30,
    });
  }
  return heuristicHypothesis(subject, body);
}

export function heuristicHypothesis(subject: string, body: string): Preregistration {
  const text = `${subject} ${body}`.toLowerCase();

  // Detect the intervention type from email content
  let intervention = "this outreach email";
  if (/formulary|P&T|coverage|access/.test(text)) intervention = "formulary-cycle-aligned outreach";
  else if (/meeting|visit|appointment|schedule/.test(text)) intervention = "meeting-scheduling outreach";
  else if (/data|evidence|study|trial/.test(text)) intervention = "evidence-sharing outreach";
  else if (/sample|starter|trial pack/.test(text)) intervention = "sample-availability outreach";

  // Detect the target outcome
  let primaryMetric = "response rate";
  let minimumEffectSize = 5;
  if (/meeting|appointment|schedule/.test(text)) {
    primaryMetric = "meeting acceptance rate";
    minimumEffectSize = 10;
  } else if (/formulary|coverage|access/.test(text)) {
    primaryMetric = "formulary review initiation rate";
    minimumEffectSize = 15;
  } else if (/prescri|adopt|initiat/.test(text)) {
    primaryMetric = "prescribing initiation rate";
    minimumEffectSize = 8;
  } else if (/reply|respond|engage/.test(text)) {
    primaryMetric = "response rate";
    minimumEffectSize = 5;
  }

  // Detect population specificity for sample size
  let sampleSize = 30;
  if (/rare|specialty|oncology|pediatric/.test(text)) sampleSize = 15;
  else if (/primary care|large practice/.test(text)) sampleSize = 50;

  // Build hypothesis from detected content
  const hypothesis = `${intervention.charAt(0).toUpperCase() + intervention.slice(1)} increases ${primaryMetric} compared to standard outreach cadence.`;

  return createPreregistration({
    hypothesis,
    primaryMetric,
    minimumEffectSize,
    sampleSize,
  });
}

// ─── 5. COM-B Behavioral Diagnostics ───────────────────────────────────

export async function diagnoseComB(
  hcpContext: string,
  emailContent: string,
): Promise<ComBDiagnosis> {
  const system = `You are a behavioral scientist using the COM-B model (Capability, Opportunity, Motivation → Behavior). Analyze what barriers prevent an HCP from taking the desired action. Return JSON: {capabilityBarriers[], opportunityBarriers[], motivationBarriers[], dominantBarrier, interventionType, behaviorChangeTechniques[]}. dominantBarrier: "capability"|"opportunity"|"motivation". Return ONLY JSON.`;
  const user = `HCP context: ${hcpContext}\n\nEmail content: ${emailContent.slice(0, 1500)}`;

  const result = await llmChat(system, user);
  if (!result) return heuristicComB(hcpContext);

  const parsed = tryParseJSON(result);
  if (parsed && parsed.dominantBarrier) {
    return {
      capabilityBarriers: parsed.capabilityBarriers || [],
      opportunityBarriers: parsed.opportunityBarriers || [],
      motivationBarriers: parsed.motivationBarriers || [],
      dominantBarrier: parsed.dominantBarrier,
      interventionType: parsed.interventionType || "education",
      behaviorChangeTechniques: parsed.behaviorChangeTechniques || [],
    };
  }
  return heuristicComB(hcpContext);
}

function heuristicComB(hcpContext: string): ComBDiagnosis {
  const ctx = hcpContext.toLowerCase();
  const cap: string[] = [];
  const opp: string[] = [];
  const mot: string[] = [];
  if (/time|busy|schedule/.test(ctx)) opp.push("Time constraints in clinical practice");
  if (/access|formulary|coverage|cost/.test(ctx)) opp.push("Access/formulary limitations");
  if (/knowledge|unfamiliar|new/.test(ctx)) cap.push("Limited familiarity with new evidence");
  if (/skeptical|resistant|prefer/.test(ctx)) mot.push("Preference for current treatment approach");
  if (cap.length === 0 && opp.length === 0 && mot.length === 0) {
    mot.push("Insufficient motivation to change prescribing behavior");
  }
  const dominant = opp.length >= Math.max(cap.length, mot.length) ? "opportunity" : cap.length >= mot.length ? "capability" : "motivation";
  return {
    capabilityBarriers: cap,
    opportunityBarriers: opp,
    motivationBarriers: mot,
    dominantBarrier: dominant as any,
    interventionType: dominant === "capability" ? "education" : dominant === "opportunity" ? "environmental restructuring" : "persuasion",
    behaviorChangeTechniques: ["information about health consequences", "social comparison"],
  };
}

// ─── 6. Claim Resonance Prediction ─────────────────────────────────────

const SPECIALTY_CLAIM_AFFINITY: Record<string, string[]> = {
  oncology: ["overall survival", "progression-free survival", "tumor response", "biomarker", "combination therapy", "immunotherapy"],
  cardiology: ["mortality reduction", "cardiovascular events", "blood pressure", "lipid profile", "safety profile"],
  endocrinology: ["HbA1c reduction", "weight management", "cardiovascular outcome", "renal protection", "hypoglycemia risk"],
  neurology: ["cognitive function", "disability progression", "relapse rate", "quality of life", "safety"],
  psychiatry: ["symptom remission", "side effect profile", "functional improvement", "onset of action"],
  rheumatology: ["ACR response", "joint damage", "remission rate", "safety long-term", "comorbidity"],
  infectious_disease: ["viral suppression", "resistance profile", "cure rate", "safety", "drug interactions"],
  pediatrics: ["safety in children", "efficacy by age group", "dosing", "palatability", "adherence"],
  primary_care: ["guideline alignment", "safety profile", "cost-effectiveness", "patient adherence", "simplicity"],
};

export async function predictClaimResonance(
  claims: PICOClaim[],
  hcpSpecialty: string,
): Promise<ClaimResonance[]> {
  const specialtyKey = hcpSpecialty.toLowerCase().replace(/[^a-z]/g, "_");
  const affinityTerms = SPECIALTY_CLAIM_AFFINITY[specialtyKey] || SPECIALTY_CLAIM_AFFINITY.primary_care;

  const system = `You are a pharma marketing analyst. Given scientific claims and an HCP specialty, predict how well each claim resonates. Return JSON array: [{claim, specialty, resonanceScore, reasoning, alternativeClaims[], evidenceBase}]. resonanceScore: 0-100. Return ONLY JSON.`;
  const user = `HCP specialty: ${hcpSpecialty}\n\nClaims:\n${JSON.stringify(claims, null, 2)}`;

  const result = await llmChat(system, user);
  if (!result) {
    // Heuristic: match claim text against specialty affinity terms
    return claims.map(c => {
      const claimLower = c.claimText.toLowerCase();
      const matches = affinityTerms.filter(t => claimLower.includes(t));
      const score = 30 + (matches.length / Math.max(affinityTerms.length, 1)) * 50 + (c.confidence * 20);
      return {
        claim: c.claimText,
        specialty: hcpSpecialty,
        resonanceScore: Math.min(100, Math.round(score)),
        reasoning: `Heuristic match: ${matches.length} affinity terms found (${matches.join(", ") || "none"})`,
        alternativeClaims: affinityTerms.slice(0, 3).map(t => `Claim emphasizing ${t}`),
        evidenceBase: c.evidenceLevel,
      };
    });
  }

  const parsed = tryParseJSON(result);
  if (Array.isArray(parsed)) return parsed.slice(0, 5);
  if (parsed && Array.isArray(parsed.resonance)) return parsed.resonance.slice(0, 5);
  return claims.map(c => ({
    claim: c.claimText,
    specialty: hcpSpecialty,
    resonanceScore: 50,
    reasoning: "LLM analysis inconclusive",
    alternativeClaims: affinityTerms.slice(0, 3).map(t => `Claim emphasizing ${t}`),
    evidenceBase: c.evidenceLevel,
  }));
}

// ─── 7. Pharmacovigilance Scanner ──────────────────────────────────────

const RESTRICTED_TERMS = [
  "cure", "miracle", "breakthrough", "revolutionary", "game-changer",
  "guaranteed", "100%", "safe for all", "no side effects",
  "better than", "superior to", "best in class", "first in class",
];

const AE_INDICATORS = [
  "adverse event", "side effect", "patient experienced", "patient reported",
  "hospitalized", "death", "serious adverse", "anaphylaxis", "steven-johnson",
  "toxicity", "overdose", "hypersensitivity", "contraindicated",
];

export function scanPharmacovigilance(
  subject: string,
  body: string,
): PharmacovigilanceScan {
  const text = `${subject} ${body}`.toLowerCase();
  const adverseEvents: PharmacovigilanceScan["adverseEvents"] = [];
  const offLabelMentions: PharmacovigilanceScan["offLabelMentions"] = [];
  const restrictedTerms: string[] = [];

  // Detect adverse events
  for (const indicator of AE_INDICATORS) {
    if (text.includes(indicator)) {
      const context = text.slice(
        Math.max(0, text.indexOf(indicator) - 50),
        text.indexOf(indicator) + 100,
      );
      adverseEvents.push({
        term: indicator,
        meddraLikely: indicator.includes("death") ? "Death" : indicator.includes("hospital") ? "Hospitalisation" : "Adverse event (unspecified)",
        seriousness: indicator.includes("death") || indicator.includes("hospital") || indicator.includes("serious") ? "serious" : "unknown",
        causality: "unknown",
      });
    }
  }

  // Detect off-label mentions
  const offLabelPatterns = [
    /off-label/i, /unapproved use/i, /investigational use/i,
    /not (fda )?approved for/i, /expanded access/i,
  ];
  for (const pattern of offLabelPatterns) {
    const match = text.match(pattern);
    if (match) {
      offLabelMentions.push({
        term: match[0],
        context: text.slice(Math.max(0, text.indexOf(match[0]) - 30), text.indexOf(match[0]) + 80),
        riskLevel: "high",
      });
    }
  }

  // Detect restricted terms
  for (const term of RESTRICTED_TERMS) {
    if (text.includes(term)) restrictedTerms.push(term);
  }

  // Fair balance check
  const hasBenefit = /\b(effective|improved|reduced|benefit|efficacy|superior)\b/i.test(text);
  const hasRisk = /\b(risk|side effect|adverse|contraindication|warning|precaution)\b/i.test(text);
  let fairBalanceStatus: PharmacovigilanceScan["fairBalanceStatus"] = "balanced";
  if (hasBenefit && !hasRisk) fairBalanceStatus = "risk-missing";
  else if (restrictedTerms.length > 2) fairBalanceStatus = "over-claimed";
  else if (!hasBenefit && !hasRisk) fairBalanceStatus = "balanced";

  const mandatoryReportTrigger = adverseEvents.some(ae => ae.seriousness === "serious");
  let reportDeadline = "none";
  if (mandatoryReportTrigger) {
    if (adverseEvents.some(ae => ae.term.includes("death"))) reportDeadline = "24h";
    else if (adverseEvents.some(ae => ae.seriousness === "serious")) reportDeadline = "15d";
  }

  return {
    adverseEvents,
    offLabelMentions,
    mandatoryReportTrigger,
    reportDeadline,
    restrictedTerms,
    fairBalanceStatus,
  };
}

// ─── Full Analysis Pipeline ────────────────────────────────────────────

export async function analyzeEmailPharma(
  email: {
    subject: string;
    from: string;
    date: string;
    body: string;
    bodyPreview: string;
  },
  options?: {
    hcpSpecialty?: string;
    hcpContext?: string;
    runAdversarial?: boolean;
    runMechanism?: boolean;
    runPreregistration?: boolean;
    runComB?: boolean;
  },
): Promise<PharmaAnalysis> {
  const subject = email.subject || "";
  const body = email.body || email.bodyPreview || "";
  const hcpSpecialty = options?.hcpSpecialty || "primary_care";
  const hcpContext = options?.hcpContext || "";

  // Run independent analyses in parallel
  const [picoClaims, pharmacovigilance] = await Promise.all([
    extractPICOClauses(subject, body),
    Promise.resolve(scanPharmacovigilance(subject, body)),
  ]);

  // Run optional analyses
  const [claimResonance, adversarial, mechanism, combDiagnosis] = await Promise.all([
    predictClaimResonance(picoClaims, hcpSpecialty),
    options?.runAdversarial ? generateAdversarialTest(`${subject}\n\n${body.slice(0, 500)}`, hcpContext) : Promise.resolve(null),
    options?.runMechanism ? isolateMechanisms(email) : Promise.resolve(null),
    options?.runComB ? diagnoseComB(hcpContext, body) : Promise.resolve(null),
  ]);

  // Generate pre-registration
  const preregistration = options?.runPreregistration
    ? await generateHypothesisFromEmail(subject, body)
    : null;

  // Compute enhanced value score
  const pharmaValueScore = computePharmaValueScore(picoClaims, pharmacovigilance, claimResonance);
  const pharmaValueTags = computePharmaValueTags(picoClaims, pharmacovigilance, claimResonance);
  const scientificComplexity = Math.min(100, picoClaims.length * 20 + picoClaims.filter(c => c.confidence > 0.7).length * 15);
  const hcpRelevance = claimResonance.length > 0
    ? Math.round(claimResonance.reduce((sum, cr) => sum + cr.resonanceScore, 0) / claimResonance.length)
    : 30;
  const regulatoryRisk = Math.min(100,
    pharmacovigilance.restrictedTerms.length * 15 +
    pharmacovigilance.offLabelMentions.length * 25 +
    (pharmacovigilance.fairBalanceStatus === "risk-missing" ? 30 : 0) +
    (pharmacovigilance.fairBalanceStatus === "over-claimed" ? 40 : 0),
  );

  return {
    picoClaims,
    adversarial,
    mechanism,
    preregistration,
    combDiagnosis,
    claimResonance,
    pharmacovigilance,
    pharmaValueScore,
    pharmaValueTags,
    scientificComplexity,
    hcpRelevance,
    regulatoryRisk,
  };
}

function computePharmaValueScore(
  claims: PICOClaim[],
  pv: PharmacovigilanceScan,
  resonance: ClaimResonance[],
): number {
  let score = 25; // base
  // Scientific claims add value
  score += Math.min(30, claims.length * 10);
  // High-evidence claims add more
  score += claims.filter(c => c.evidenceLevel === "systematic-review" || c.evidenceLevel === "rct").length * 8;
  // Resonance with target specialty
  if (resonance.length > 0) {
    const avgResonance = resonance.reduce((s, r) => s + r.resonanceScore, 0) / resonance.length;
    score += Math.round(avgResonance * 0.2);
  }
  // Regulatory risk reduces value
  score -= pv.restrictedTerms.length * 3;
  score -= pv.offLabelMentions.length * 5;
  if (pv.fairBalanceStatus === "risk-missing") score -= 10;
  if (pv.fairBalanceStatus === "over-claimed") score -= 15;
  // Adverse events require handling but indicate engagement
  if (pv.adverseEvents.length > 0) score += 5;
  return Math.max(0, Math.min(100, score));
}

function computePharmaValueTags(
  claims: PICOClaim[],
  pv: PharmacovigilanceScan,
  resonance: ClaimResonance[],
): string[] {
  const tags: string[] = [];
  if (claims.length > 0) tags.push("scientific-claim");
  if (claims.some(c => c.evidenceLevel === "systematic-review" || c.evidenceLevel === "rct")) tags.push("high-evidence");
  if (claims.some(c => c.evidenceLevel === "anecdotal" || c.evidenceLevel === "none")) tags.push("low-evidence");
  if (resonance.some(r => r.resonanceScore > 70)) tags.push("high-resonance");
  if (resonance.some(r => r.resonanceScore < 30)) tags.push("low-resonance");
  if (pv.mandatoryReportTrigger) tags.push("pharmacovigilance-required");
  if (pv.offLabelMentions.length > 0) tags.push("off-label-risk");
  if (pv.restrictedTerms.length > 0) tags.push("compliance-flag");
  if (pv.fairBalanceStatus === "risk-missing") tags.push("fair-balance-issue");
  if (pv.fairBalanceStatus === "over-claimed") tags.push("over-claimed");
  if (tags.length === 0) tags.push("general");
  return tags;
}
