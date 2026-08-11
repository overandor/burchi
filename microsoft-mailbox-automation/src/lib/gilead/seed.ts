// @ts-nocheck
/**
 * Gilead Sciences demo seed data — Evidence-Governed Implementation Science Network.
 *
 * SPINOR-Gilead is NOT a sales targeting or next-best-action system.
 * It is a compliance-native implementation-science operating system that
 * discovers, falsifies, replicates, and automates approved operational
 * methods while preserving medical truth, functional boundaries, safety
 * escalation, customer burden, and health-equity constraints.
 *
 * The seed data below implements the initial wedge:
 *   Verified Account Readiness and Stalled-Workflow Resolution
 *
 * Therapeutic areas: HIV, Oncology, Liver Disease, Inflammation
 * Products: Biktarvy, Descovy, Trodelvy, Yescarta, Livdelzi
 * Focus: operational barriers, pathway readiness, implementation friction
 */

import {
  HypothesisAnatomy,
  PriorArtRecord,
  PhysicianModel,
  HypothesisAssignment,
} from "@/types";
import {
  saveHypotheses,
  loadHypotheses,
  savePriorArt,
  loadPriorArt,
  savePhysicians,
  loadPhysicians,
  saveHypothesisAssignments,
  loadHypothesisAssignments,
} from "@/lib/config";

const now = () => new Date().toISOString();

// ─── Gilead Implementation-Science Hypotheses ─────────────────────
//
// These hypotheses test OPERATIONAL methods — not medical truth,
// prescribing behavior, or clinical messaging. They focus on:
//   - identifying the true workflow owner
//   - resolving administrative barriers
//   - reducing customer burden
//   - improving handoff quality
//   - detecting implementation friction
//   - preparing sites for readiness
//
// The reward signal is implementation readiness, NOT prescription
// or sales outcomes.

export const GILEAD_HYPOTHESES: HypothesisAnatomy[] = [
  {
    id: "hyp_gilead_stalled_workflow",
    priorArtId: "pa_gilead_barrier_resolution",
    priorArtStatus: "transfer_candidate",
    createdAt: now(),
    origin: "research",
    kind: "fit",
    researchRisk: "low",
    claim: "Among verified accounts that have received appropriate approved information but remain operationally stalled, identifying the responsible workflow owner and resolving one documented administrative barrier within 48 hours will reduce time to implementation readiness compared with the standard follow-up sequence, without increasing customer burden, complaints, or compliance incidents.",
    sourceDomains: ["Implementation science", "Workflow ownership theory", "Barrier resolution literature"],
    targetCondition: "Verified accounts with approved information delivered but operationally stalled for >30 days",
    intervention: "Field rep identifies the true workflow owner (not necessarily the prescriber), classifies the administrative barrier using the Barrier Genome, and resolves one documented barrier within 48 hours.",
    control: "Standard follow-up sequence at regular cadence without barrier classification or owner identification",
    primaryOutcome: "Time to implementation readiness (days from stalled state to active workflow)",
    secondaryOutcomes: ["Customer burden score (0-10, lower is better)", "Compliance incidents (count, target: zero increase)", "Barrier resolution rate", "Account readiness composite score"],
    knownConfounders: ["Staff turnover at account", "Formulary changes", "Competitor activity", "Seasonal staffing patterns", "Insurance prior-authorization policy changes"],
    complianceBoundary: "No clinical claims beyond approved labeling. No prescribing influence. Barrier resolution is limited to administrative/operational actions. All external communication uses MLR-approved materials only. Safety signals routed to pharmacovigilance immediately.",
    expectedValue: "40% reduction in time-to-readiness for stalled accounts, without increased customer burden or compliance incidents",
    primaryUncertainty: "Whether 48-hour resolution is the critical window or whether simply identifying the correct workflow owner is the active mechanism",
    novelComponent: "Barrier Genome classification + workflow-owner identification + time-boxed resolution as a combined operational intervention",
    fixedConstraints: ["FDA-approved labeling", "MLR-approved content only", "No prescribing influence", "AE reporting per pharmacovigilance protocols", "Privacy restrictions per HIPAA/GDPR"],
    modifiableDimensions: ["timing", "stakeholder", "followup_interval"],
    targetEngagementModes: ["human_guided", "hybrid"],
  },
  {
    id: "hyp_gilead_referral_leakage",
    priorArtId: "pa_gilead_referral_pathway",
    priorArtStatus: "novel_permutation",
    createdAt: now(),
    origin: "research",
    kind: "discovery",
    researchRisk: "moderate",
    claim: "Implementing a structured referral-pathway handoff protocol at HIV care sites — where the referring provider, receiving specialist, and patient-support coordinator each confirm receipt within 24 hours — will reduce referral leakage (patients lost between referral and first appointment) by 30% compared to standard unstructured referral processes.",
    sourceDomains: ["Referral pathway optimization", "Care coordination literature", "Implementation science"],
    targetCondition: "HIV care sites with observed referral leakage (>15% of referred patients not reaching first appointment)",
    intervention: "Structured three-party handoff protocol: referring provider confirms referral sent, receiving specialist confirms receipt and schedules, patient-support coordinator confirms patient contacted. All within 24 hours.",
    control: "Standard unstructured referral process without confirmation loop",
    primaryOutcome: "Referral leakage rate (percentage of referred patients who do not reach first appointment within 30 days)",
    secondaryOutcomes: ["Time from referral to first appointment", "Patient-reported satisfaction with handoff", "Number of handoff confirmations completed", "No-show rate at first appointment"],
    knownConfounders: ["Patient mobility", "Insurance changes", "Specialist availability", "Transportation barriers", "Site staffing capacity"],
    complianceBoundary: "No clinical claims. No prescribing influence. Protocol is purely operational (scheduling, confirmation, coordination). Patient data handled per HIPAA. No off-label discussions.",
    expectedValue: "30% reduction in referral leakage, improving access to care without increasing customer burden",
    primaryUncertainty: "Whether the 24-hour confirmation window is the active component or whether simply having a named coordinator is sufficient",
    novelComponent: "Three-party structured handoff with time-boxed confirmation as an operational intervention",
    fixedConstraints: ["HIPAA compliance", "No clinical claims", "No prescribing influence", "MLR-approved materials only"],
    modifiableDimensions: ["timing", "stakeholder", "followup_interval", "content_sequence"],
    targetEngagementModes: ["system_oriented", "human_guided"],
  },
  {
    id: "hyp_gilead_site_readiness",
    priorArtId: "pa_gilead_access_pathway",
    priorArtStatus: "transfer_candidate",
    createdAt: now(),
    origin: "research",
    kind: "reliable",
    researchRisk: "low",
    claim: "Conducting a structured site-readiness assessment — covering administrative readiness, staffing capacity, diagnostic capability, and data readiness — at least 60 days before a planned Trodelvy program launch at community oncology centers will reduce implementation delays by 50% compared to centers that receive standard pre-launch communication only.",
    sourceDomains: ["Site readiness assessment", "Implementation preparation", "Community oncology infrastructure"],
    targetCondition: "Community oncology centers preparing to launch Trodelvy programs",
    intervention: "Field rep conducts structured readiness assessment across 10 dimensions (administrative, staffing, diagnostic, referral, data, supply, training, access, workflow, customer burden) 60 days before launch, with gap-closure plan delivered to site within 7 days.",
    control: "Standard pre-launch communication packet without structured assessment or gap-closure plan",
    primaryOutcome: "Implementation delay (days between planned launch date and first patient ready for treatment)",
    secondaryOutcomes: ["Number of readiness gaps identified and closed pre-launch", "Staff training completion rate", "Customer burden score at launch", "Time to first patient treatment-ready state"],
    knownConfounders: ["Center prior ADC experience", "Staffing changes between assessment and launch", "Insurance authorization timelines", "Competitor program launches"],
    complianceBoundary: "On-label Trodelvy indications only. No off-label sequencing recommendations. Assessment covers operational readiness only — no clinical claims. Safety reporting per AE protocols.",
    expectedValue: "50% reduction in implementation delays, enabling faster patient access without increasing site burden",
    primaryUncertainty: "Whether 60 days is the optimal assessment window or whether earlier assessment (90 days) allows more gap closure",
    novelComponent: "Multi-dimensional structured readiness assessment with time-boxed gap-closure plan as a pre-launch operational intervention",
    fixedConstraints: ["FDA-approved Trodelvy labeling", "AE reporting requirements", "REMS program compliance", "No off-label claims"],
    modifiableDimensions: ["timing", "stakeholder", "followup_interval"],
    targetEngagementModes: ["system_oriented", "human_guided"],
  },
  {
    id: "hyp_gilead_prior_auth_barrier",
    priorArtId: "pa_gilead_access_barrier",
    priorArtStatus: "novel_permutation",
    createdAt: now(),
    origin: "research",
    kind: "discovery",
    researchRisk: "moderate",
    claim: "Providing field-rep-supported prior-authorization preparation kits — including required documentation checklists, insurance-specific requirements, and submission tracking — to PBC treatment sites will reduce prior-authorization denial rates for Livdelzi by 40% compared to sites using standard physician-office-submitted prior-authorization without structured support.",
    sourceDomains: ["Prior authorization optimization", "Access barrier resolution", "Rare disease access pathways"],
    targetCondition: "Sites diagnosing PBC patients where prior-authorization delays >14 days have been observed",
    intervention: "Field rep delivers structured prior-authorization preparation kit with insurance-specific documentation checklists, submission tracking template, and escalation contact list. Rep does not submit on behalf of physician but ensures office staff are trained on the kit.",
    control: "Standard physician-office-submitted prior-authorization without structured kit or tracking",
    primaryOutcome: "Prior-authorization denial rate (percentage of initial submissions denied)",
    secondaryOutcomes: ["Time from prescription to PA submission", "Time from PA submission to approval", "Number of appeals required", "Customer burden score for office staff"],
    knownConfounders: ["Insurance plan mix", "Patient cost-sharing changes", "Specialty pharmacy capacity", "Diagnostic coding accuracy", "Payer policy changes"],
    complianceBoundary: "On-label Livdelzi indications (PBC). No off-label claims. Rep does not submit PA on behalf of physician — kit is a preparation tool only. No prescribing influence. Patient support program enrollment is voluntary.",
    expectedValue: "40% reduction in PA denial rates, reducing time-to-access for PBC patients without increasing compliance risk",
    primaryUncertainty: "Whether the documentation checklist or the submission tracking is the active component in reducing denials",
    novelComponent: "Structured PA preparation kit with insurance-specific requirements and submission tracking as an access-barrier intervention",
    fixedConstraints: ["FDA-approved Livdelzi labeling", "No rep-submitted PA", "No prescribing influence", "HIPAA compliance"],
    modifiableDimensions: ["timing", "stakeholder", "content_sequence", "followup_interval"],
    targetEngagementModes: ["system_oriented", "human_guided"],
  },
  {
    id: "hyp_gilead_cross_franchise_mechanism",
    priorArtId: "pa_gilead_mechanism_transfer",
    priorArtStatus: "novel_permutation",
    createdAt: now(),
    origin: "research",
    kind: "discovery",
    researchRisk: "high",
    claim: "An operational mechanism proven to reduce referral leakage in HIV care sites — the three-party structured handoff with time-boxed confirmation — will produce a comparable reduction in referral leakage when adapted for oncology centers initiating CAR-T evaluation pathways, while all medical content, role permissions, and compliance boundaries remain therapeutic-area-specific.",
    sourceDomains: ["Cross-franchise mechanism transfer", "Implementation science generalizability", "Care coordination"],
    targetCondition: "Authorized Treatment Centers for Yescarta with observed referral leakage between community oncology referral and ATC evaluation (>20%)",
    intervention: "Adapt the three-party structured handoff protocol from HIV to oncology: community oncologist confirms referral sent, ATC coordinator confirms receipt and schedules evaluation, patient navigator confirms patient contacted. All within 24 hours. Medical content and role permissions remain CAR-T-specific.",
    control: "Standard unstructured CAR-T referral process without confirmation loop",
    primaryOutcome: "Referral leakage rate between community oncology referral and ATC evaluation completion",
    secondaryOutcomes: ["Time from referral to ATC evaluation", "Patient-reported satisfaction with handoff", "Number of handoff confirmations completed", "Time to apheresis decision"],
    knownConfounders: ["CAR-T eligibility complexity vs HIV referral simplicity", "ATC capacity constraints", "Patient clinical urgency variability", "Insurance authorization for CAR-T", "Manufacturing slot availability"],
    complianceBoundary: "On-label Yescarta indications (LBCL, FL). No off-label claims. REMS program compliance. Protocol transfers OPERATIONAL MECHANISM only — all medical content, role permissions, and compliance boundaries remain therapeutic-area-specific. No cross-franchise clinical content sharing.",
    expectedValue: "25% reduction in CAR-T referral leakage, demonstrating that operational mechanisms transfer across therapeutic areas without contaminating clinical boundaries",
    primaryUncertainty: "Whether the operational mechanism (structured handoff) is truly therapeutic-area-independent or whether CAR-T referral complexity makes the protocol less effective",
    novelComponent: "Cross-franchise transfer of an operational mechanism (not clinical content) with explicit boundary preservation",
    fixedConstraints: ["REMS program requirements", "FDA-approved Yescarta labeling", "No cross-franchise clinical content", "Therapeutic-area-specific role permissions", "Manufacturing slot allocation rules"],
    modifiableDimensions: ["timing", "stakeholder", "followup_interval"],
    targetEngagementModes: ["human_guided", "hybrid"],
  },
];

// ─── Implementation-Science Prior Art Records ──────────────────────

export const GILEAD_PRIOR_ART: PriorArtRecord[] = [
  {
    id: "pa_gilead_barrier_resolution",
    hypothesisClaim: "Identifying workflow owner and resolving one administrative barrier within 48 hours reduces time-to-readiness for stalled accounts",
    testedInMarket: false,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Implementation science literature shows that barrier identification + owner assignment is a critical mechanism in healthcare implementation. FOCUS program data at Gilead demonstrates that structured barrier resolution accelerates screening-to-linkage cycles. Similar patterns in chronic care management show time-boxed resolution reduces stalled-workflow duration.",
    sourceDomains: ["Implementation science", "FOCUS program methodology", "Healthcare workflow optimization", "Barrier resolution literature"],
    responsibleComponent: "field_rep",
    requiredConditions: ["Verified account identity and location", "Barrier Genome classification system", "Approved operational intervention list", "Workflow-owner identification protocol"],
    risksAndConfounders: ["Staff turnover eliminating the identified workflow owner", "Multiple concurrent barriers masking the effect of resolving one", "Account-specific factors unrelated to the resolved barrier", "Seasonal staffing patterns"],
    genuinelyUnknown: ["Whether 48-hour resolution is the critical window or whether identification alone is sufficient", "Which barrier families respond best to time-boxed resolution", "Whether the effect persists after the rep withdraws active support"],
    status: "transfer_candidate",
    evidenceState: "supported",
    researchConfidence: 0.72,
    researchedAt: now(),
  },
  {
    id: "pa_gilead_referral_pathway",
    hypothesisClaim: "Three-party structured handoff with 24-hour confirmation reduces referral leakage",
    testedInMarket: false,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Care coordination literature consistently shows that structured handoffs with confirmation loops reduce information loss. HIV care cascade studies show referral leakage rates of 15-30% without structured protocols. Implementation science frameworks (CFIR, RE-AIM) support multi-party confirmation as an implementation facilitator.",
    sourceDomains: ["Care coordination research", "HIV care cascade literature", "Implementation science frameworks (CFIR, RE-AIM)", "Referral pathway optimization"],
    responsibleComponent: "field_rep",
    requiredConditions: ["Referring provider engagement", "Receiving specialist confirmation capability", "Patient-support coordinator availability", "24-hour confirmation tracking system"],
    risksAndConfounders: ["Provider availability for confirmation", "Patient contact information accuracy", "Specialist scheduling capacity", "Transportation and social determinants"],
    genuinelyUnknown: ["Whether 24-hour window is optimal or whether 48-hour would be equally effective", "Whether the confirmation mechanism or the named coordinator is the active component", "Whether effect differs by site size or patient volume"],
    status: "novel_permutation",
    evidenceState: "untested",
    researchConfidence: 0.68,
    researchedAt: now(),
  },
  {
    id: "pa_gilead_access_pathway",
    hypothesisClaim: "Structured site-readiness assessment 60 days before launch reduces implementation delays",
    testedInMarket: true,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Site readiness assessment is standard practice in clinical trial initiation and shows consistent delay reduction. Implementation science literature supports pre-launch assessment as an implementation facilitator. Gilead's FOCUS program uses structured site assessments before launching screening programs with demonstrated success.",
    sourceDomains: ["Site readiness assessment literature", "Clinical trial start-up optimization", "FOCUS program methodology", "Implementation preparation research"],
    responsibleComponent: "field_rep",
    requiredConditions: ["Structured readiness assessment tool", "Site access for assessment visit", "Gap-closure plan template", "Site willingness to participate"],
    risksAndConfounders: ["Assessment accuracy (self-report vs observation)", "Gap closure dependent on site resources", "Staffing changes between assessment and launch", "Competing priorities at site"],
    genuinelyUnknown: ["Optimal assessment window (60 vs 90 days)", "Which readiness dimensions are most predictive of delay", "Whether gap-closure plans are followed without rep follow-up"],
    status: "transfer_candidate",
    evidenceState: "supported",
    researchConfidence: 0.75,
    researchedAt: now(),
  },
  {
    id: "pa_gilead_access_barrier",
    hypothesisClaim: "Structured prior-authorization preparation kits reduce PA denial rates",
    testedInMarket: false,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Prior-authorization optimization literature shows structured documentation and insurance-specific checklists reduce denial rates. Patient access programs in rare disease demonstrate that preparation kits improve first-pass approval rates. Specialty pharmacy coordination data supports the pattern.",
    sourceDomains: ["Prior authorization optimization", "Rare disease access pathways", "Patient access program data", "Insurance documentation research"],
    responsibleComponent: "field_rep",
    requiredConditions: ["Insurance plan-specific PA requirements", "Documentation checklist template", "Submission tracking system", "Office staff training capacity"],
    risksAndConfounders: ["Payer policy changes between kit delivery and submission", "Office staff turnover", "Patient insurance changes", "Diagnostic coding accuracy variability"],
    genuinelyUnknown: ["Whether the checklist or the tracking is the active component", "Whether effect persists after rep stops active kit delivery", "Whether effect varies by payer type"],
    status: "novel_permutation",
    evidenceState: "untested",
    researchConfidence: 0.65,
    researchedAt: now(),
  },
  {
    id: "pa_gilead_mechanism_transfer",
    hypothesisClaim: "Operational mechanisms (structured handoffs) transfer across therapeutic areas without contaminating clinical boundaries",
    testedInMarket: false,
    testedInAdjacentIndustries: true,
    adjacentSupportSummary: "Implementation science literature explicitly studies mechanism transfer across contexts. CFIR framework identifies 'design quality and packaging' as a transferable construct. However, most evidence is within-disease transfer; cross-therapeutic-area transfer of operational mechanisms is less studied. The FOCUS program's expansion across disease areas provides partial support.",
    sourceDomains: ["Implementation science generalizability", "CFIR framework transferability", "FOCUS program cross-disease expansion", "Mechanism transfer literature"],
    responsibleComponent: "field_rep",
    requiredConditions: ["Proven operational mechanism in source therapeutic area", "Explicit boundary preservation protocol", "Therapeutic-area-specific compliance validation", "Independent replication in target area"],
    risksAndConfounders: ["CAR-T referral complexity vs HIV referral simplicity", "Different stakeholder structures across therapeutic areas", "Different regulatory requirements (REMS vs standard)", "Patient population differences"],
    genuinelyUnknown: ["Whether operational mechanisms are truly therapeutic-area-independent", "How much adaptation is needed before a mechanism is no longer 'the same'", "Whether cross-franchise transfer creates implicit clinical content contamination"],
    status: "novel_permutation",
    evidenceState: "untested",
    researchConfidence: 0.6,
    researchedAt: now(),
  },
];

// ─── Gilead Account/Site Operational Twins ─────────────────────────
//
// These are NOT physician personality profiles or automation-stereotype
// labels. They are evolving operational twins of accounts/sites that
// track readiness dimensions, known barriers, and workflow ownership.
// The PhysicianModel type is reused but repurposed: the 'name' field
// now represents the account/site name, and the signals track
// operational readiness rather than physician personal preferences.
// Labels remain uncertain, limited, and revisable — they are NOT
// permanent classifications of people.

export const GILEAD_PHYSICIANS: PhysicianModel[] = [
  {
    physicianId: "phy_gilead_001",
    name: "Riverside HIV Clinic — Site #4127",
    currentState: "administrative_delegation_dominant",
    stateHistory: [
      { state: "human_relationship_dominant", observedAt: "2025-01-15T00:00:00Z", evidence: "All coordination handled by lead physician directly; no structured staff delegation" },
      { state: "administrative_delegation_dominant", observedAt: "2025-06-20T00:00:00Z", evidence: "Office manager now handles scheduling and prior-authorization; physician focuses on clinical decisions only" },
    ],
    interactionSignals: {
      digitalResponsiveness: 0.82,
      preferredChannel: "digital_portal",
      selfServiceCompletion: 0.78,
      staffDelegationPattern: "mixed",
      meetingPreference: "async",
      responseLatencyHours: 4,
      contentDepthPreference: "detailed",
      workflowComplexityTolerance: "high",
      priorAutomationAdoption: 0.75,
    },
    recommendedApproach: "Operational contact: office manager Maria Gonzalez. Site has strong digital infrastructure but referral leakage observed at 22%. Barrier: REFERRAL-LEAKAGE. Test structured three-party handoff protocol.",
    nextTestHypothesis: "Test whether three-party structured handoff with 24-hour confirmation reduces referral leakage at this site.",
    updatedAt: now(),
  },
  {
    physicianId: "phy_gilead_002",
    name: "Eastside Community Oncology Center",
    currentState: "time_compressed",
    stateHistory: [
      { state: "automation_resistant", observedAt: "2025-01-10T00:00:00Z", evidence: "Site had no digital infrastructure; all communication via fax and phone" },
      { state: "time_compressed", observedAt: "2025-08-01T00:00:00Z", evidence: "Staffing shortage reduced available time for new program onboarding; site is operationally stalled on Trodelvy launch preparation" },
    ],
    interactionSignals: {
      digitalResponsiveness: 0.35,
      preferredChannel: "in_person",
      selfServiceCompletion: 0.20,
      staffDelegationPattern: "staff",
      meetingPreference: "in_person",
      responseLatencyHours: 36,
      contentDepthPreference: "brief",
      workflowComplexityTolerance: "low",
      priorAutomationAdoption: 0.25,
    },
    recommendedApproach: "Operational contact: practice administrator Tom Becker. Site is stalled on Trodelvy launch — staffing capacity is the primary barrier, not clinical readiness. Barrier: SITE-STAFF-CAPACITY. Test structured readiness assessment with gap-closure plan.",
    nextTestHypothesis: "Test whether 60-day structured readiness assessment with gap-closure plan reduces implementation delays at this center.",
    updatedAt: now(),
  },
  {
    physicianId: "phy_gilead_003",
    name: "Mercy Health PBC Treatment Program",
    currentState: "evidence_intensive",
    stateHistory: [
      { state: "human_relationship_dominant", observedAt: "2025-01-20T00:00:00Z", evidence: "Lead physician handles all PA submissions personally; no structured process" },
      { state: "evidence_intensive", observedAt: "2025-07-15T00:00:00Z", evidence: "PA denial rate for Livdelzi at 45%; site requesting additional documentation support" },
    ],
    interactionSignals: {
      digitalResponsiveness: 0.57,
      preferredChannel: "in_person",
      selfServiceCompletion: 0.40,
      staffDelegationPattern: "physician",
      meetingPreference: "mixed",
      responseLatencyHours: 18,
      contentDepthPreference: "moderate",
      workflowComplexityTolerance: "medium",
      priorAutomationAdoption: 0.45,
    },
    recommendedApproach: "Operational contact: lead physician Dr. Sarah Williams (handles PA personally — workflow owner gap). Barrier: ACCESS-PRIOR-AUTH. PA denial rate 45%. Test structured PA preparation kit with insurance-specific checklists.",
    nextTestHypothesis: "Test whether structured PA preparation kit reduces PA denial rates for Livdelzi at this site.",
    updatedAt: now(),
  },
  {
    physicianId: "phy_gilead_004",
    name: "University Medical Center — CAR-T Program",
    currentState: "technically_sophisticated_conservative",
    stateHistory: [
      { state: "automation_proficient", observedAt: "2025-01-05T00:00:00Z", evidence: "Strong digital infrastructure for CAR-T patient management; uses Kite portal extensively" },
      { state: "technically_sophisticated_conservative", observedAt: "2025-06-10T00:00:00Z", evidence: "Referral leakage from community oncology to ATC at 28%; site conservative about accepting external referrals without full workup" },
    ],
    interactionSignals: {
      digitalResponsiveness: 0.71,
      preferredChannel: "digital_portal",
      selfServiceCompletion: 0.65,
      staffDelegationPattern: "physician",
      meetingPreference: "mixed",
      responseLatencyHours: 8,
      contentDepthPreference: "detailed",
      workflowComplexityTolerance: "high",
      priorAutomationAdoption: 0.80,
    },
    recommendedApproach: "Operational contact: ATC coordinator Jennifer Park. Site has strong internal processes but referral leakage from community oncology. Barrier: REFERRAL-LEAKAGE (cross-franchise). Test adapted three-party handoff from HIV to CAR-T pathway.",
    nextTestHypothesis: "Test whether cross-franchise transfer of three-party structured handoff reduces CAR-T referral leakage while preserving therapeutic-area boundaries.",
    updatedAt: now(),
  },
];

// ─── Gilead Implementation-Science Assignments ─────────────────────
//
// Each assignment is an implementation-science mission — NOT a sales
// or persuasion task. The allocation reason explains why this
// operational mission reached this field rep. Missions focus on
// barrier resolution, pathway readiness, and workflow ownership.

export const GILEAD_ASSIGNMENTS: HypothesisAssignment[] = [
  {
    id: "asg_gilead_001",
    hypothesisId: "hyp_gilead_stalled_workflow",
    employeeId: "gilead-rep-001",
    employeeRole: "field_representative",
    kind: "fit",
    state: "assigned",
    assignedAt: now(),
    eligibleAccountIds: ["phy_gilead_001"],
    evaluationPeriodDays: 60,
    allocationReason: "Account has approved information delivered but operationally stalled >30 days. Rep has existing relationship with office manager. Barrier Genome classification: REFERRAL-LEAKAGE.",
    innovationWindow: ["timing", "stakeholder", "followup_interval"],
    trialNumber: 1,
  },
  {
    id: "asg_gilead_002",
    hypothesisId: "hyp_gilead_referral_leakage",
    employeeId: "gilead-rep-001",
    employeeRole: "field_representative",
    kind: "discovery",
    state: "assigned",
    assignedAt: now(),
    eligibleAccountIds: ["phy_gilead_001"],
    evaluationPeriodDays: 90,
    allocationReason: "Site exhibits 22% referral leakage. Rep identified office manager as workflow owner. Tests three-party handoff protocol as operational intervention.",
    innovationWindow: ["timing", "stakeholder", "followup_interval"],
    trialNumber: 1,
  },
  {
    id: "asg_gilead_003",
    hypothesisId: "hyp_gilead_site_readiness",
    employeeId: "gilead-rep-002",
    employeeRole: "field_representative",
    kind: "reliable",
    state: "executing",
    assignedAt: now(),
    eligibleAccountIds: ["phy_gilead_002"],
    evaluationPeriodDays: 90,
    allocationReason: "Site is operationally stalled on Trodelvy launch. Staffing capacity is primary barrier. Rep conducting structured readiness assessment with gap-closure plan.",
    innovationWindow: ["timing", "stakeholder", "followup_interval"],
    trialNumber: 1,
  },
  {
    id: "asg_gilead_004",
    hypothesisId: "hyp_gilead_prior_auth_barrier",
    employeeId: "gilead-rep-002",
    employeeRole: "field_representative",
    kind: "fit",
    state: "assigned",
    assignedAt: now(),
    eligibleAccountIds: ["phy_gilead_003"],
    evaluationPeriodDays: 120,
    allocationReason: "PA denial rate at 45% for Livdelzi. Lead physician handling PA personally — workflow owner gap. Rep delivering structured PA preparation kit.",
    innovationWindow: ["timing", "stakeholder", "content_sequence", "followup_interval"],
    trialNumber: 1,
  },
  {
    id: "asg_gilead_005",
    hypothesisId: "hyp_gilead_cross_franchise_mechanism",
    employeeId: "gilead-rep-002",
    employeeRole: "field_representative",
    kind: "discovery",
    state: "assigned",
    assignedAt: now(),
    eligibleAccountIds: ["phy_gilead_004"],
    evaluationPeriodDays: 120,
    allocationReason: "CAR-T referral leakage at 28%. Tests cross-franchise transfer of three-party handoff from HIV to oncology. High research risk — mechanism transfer with explicit boundary preservation.",
    innovationWindow: ["timing", "stakeholder", "followup_interval"],
    trialNumber: 1,
  },
];

// ─── Seeding function ───────────────────────────────────────────────
/**
 * Seed Gilead-specific demo data into the database.
 * Merges with existing data — does not overwrite.
 */
export function seedGileadDemoData(): {
  hypotheses: number;
  priorArt: number;
  physicians: number;
  assignments: number;
} {
  const existingHyps = loadHypotheses();
  const newHyps = GILEAD_HYPOTHESES.filter(
    (h) => !existingHyps.some((e) => e.id === h.id),
  );
  if (newHyps.length > 0) {
    saveHypotheses([...existingHyps, ...newHyps]);
  }

  const existingPA = loadPriorArt();
  const newPA = GILEAD_PRIOR_ART.filter(
    (p) => !existingPA.some((e) => e.id === p.id),
  );
  if (newPA.length > 0) {
    savePriorArt([...existingPA, ...newPA]);
  }

  const existingPhys = loadPhysicians();
  const newPhys = GILEAD_PHYSICIANS.filter(
    (p) => !existingPhys.some((e) => e.physicianId === p.physicianId),
  );
  if (newPhys.length > 0) {
    savePhysicians([...existingPhys, ...newPhys]);
  }

  const existingAsg = loadHypothesisAssignments();
  const newAsg = GILEAD_ASSIGNMENTS.filter(
    (a) => !existingAsg.some((e) => e.id === a.id),
  );
  if (newAsg.length > 0) {
    saveHypothesisAssignments([...existingAsg, ...newAsg]);
  }

  return {
    hypotheses: newHyps.length,
    priorArt: newPA.length,
    physicians: newPhys.length,
    assignments: newAsg.length,
  };
}
