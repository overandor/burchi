import * as fs from "fs";
import * as path from "path";
import { kvLoad, kvSave, ensureDefaultOrg, migrateFromJsonFiles, DEFAULT_ORG_ID } from "@/lib/db";
import {
  AppConfig,
  CommitmentContract,
  CommitmentMetrics,
  ProcessedEmailRecord,
  SyncStatus,
  StrategyGenome,
  StrategyAssignment,
  AttributionResult,
  StrategyOutcomeEvent,
  StrategyEvolutionProposal,
  HypothesisAnatomy,
  PriorArtRecord,
  HypothesisAssignment,
  HypothesisOutcome,
  HypothesisAttribution,
  HypothesisDerivative,
  GoldenNode,
  AttributionLedgerEntry,
  DiscoveryOpportunityLedger,
  ResearchReliability,
  ProcessDefinition,
  ResearchCompetitionEntry,
  SpinorParticipantProfile,
  SpinorOrganism,
  MissionCard,
  PhysicianModel,
  PalindromeUpdate,
  RLAgentState,
  RLReward,
  EmailSignal,
  StagnationFlag,
  SproutNode,
  DiffusionState,
  AntiGamingCheck,
  AppIdentity,
  MaterialEvent,
  CapabilityGrant,
  DifferentiationResult,
  LineageRecord,
  PriorArtSearch,
  IPEvidencePackage,
  MarketTestResult,
  AppEvaluationResult,
  MerkleRoot,
  GGFUManifest,
  RegistryEntry,
  ContinuityEvent,
  ContinuityMerkleRoot,
  ExecutionReceipt,
  EvidencePacket,
  AppraisalReport,
  CASEntry,
} from "@/types";

const DEFAULT_CONFIG: AppConfig = {
  graph: {
    clientId: "",
    clientSecret: "",
    tenantId: "",
    mailbox: "",
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as "openai" | "anthropic" | "azure" | "ollama") || "ollama",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.LLM_MODEL || "llama3.2:1b",
    // Defaults to Prism Ollama on Fly.dev. Override with LLM_ENDPOINT/LLM_MODEL env vars.
    endpoint: process.env.LLM_ENDPOINT || "https://prism-ollama.fly.dev/api/generate",
    endpoints: process.env.LLM_ENDPOINTS
      ? JSON.parse(process.env.LLM_ENDPOINTS)
      : [],
    maxTotalTokens: parseInt(process.env.LLM_MAX_TOKENS || "50000"),
  },
  processing: {
    autoProcess: false,
    pollInterval: 60,
    maxEmailsPerSync: 100,
    categories: [
      "Research Data",
      "Lab Results",
      "Experiment Report",
      "Field Study",
      "Clinical Trial",
      "Environmental Data",
      "Other",
    ],
    extractionPrompt: `You are a scientific data extraction assistant. Analyze the following email content and any attached data.
Extract all scientific data into structured fields and tables. For each field, identify:
- The field name/key
- The value
- The data type (string, number, date, boolean, scientific_value)
- The unit of measurement if applicable
- Your confidence level (0-1)

Also categorize the email into one of the provided categories.
Provide a brief summary of the scientific content.

Return your response as JSON with the following structure:
{
  "fields": [{ "key": "", "value": "", "type": "", "unit": "", "confidence": 0 }],
  "tables": [{ "name": "", "headers": [], "rows": [{}], "source": "" }],
  "summary": "",
  "category": "",
  "confidence": 0
}`,
  },
  export: {
    format: "excel",
    outputPath: "./exports",
  },
};

const CONFIG_FILE = "app-config.json";
const DATA_DIR = path.join(process.cwd(), "data");
const PROCESSED_FILE = `${DATA_DIR}/processed-emails.json`;
const STATUS_FILE = `${DATA_DIR}/sync-status.json`;
const COMMITMENTS_FILE = `${DATA_DIR}/commitments.json`;
const COMMITMENT_METRICS_FILE = `${DATA_DIR}/commitment-metrics.json`;
const STRATEGIES_FILE = `${DATA_DIR}/strategies.json`;
const STRATEGY_ASSIGNMENTS_FILE = `${DATA_DIR}/strategy-assignments.json`;
const STRATEGY_OUTCOMES_FILE = `${DATA_DIR}/strategy-outcomes.json`;
const STRATEGY_ATTRIBUTIONS_FILE = `${DATA_DIR}/strategy-attributions.json`;
const STRATEGY_EVOLUTION_FILE = `${DATA_DIR}/strategy-evolution.json`;

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadConfig(): AppConfig {
  // Start with env var defaults (works on Netlify/serverless)
  const envConfig: Partial<AppConfig> = {
    graph: {
      clientId:
        process.env.AZURE_AD_CLIENT_ID ||
        process.env.AZURE_CLIENT_ID ||
        process.env.MICROSOFT_CLIENT_ID ||
        "",
      clientSecret:
        process.env.AZURE_AD_CLIENT_SECRET ||
        process.env.AZURE_CLIENT_SECRET ||
        process.env.MICROSOFT_CLIENT_SECRET ||
        "",
      tenantId:
        process.env.AZURE_AD_TENANT_ID ||
        process.env.AZURE_TENANT_ID ||
        process.env.MICROSOFT_TENANT_ID ||
        "common",
      mailbox: process.env.MAILBOX_EMAIL || "",
    },
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const saved = JSON.parse(raw);
      if (
        typeof saved !== "object" ||
        saved === null ||
        Array.isArray(saved) ||
        !("graph" in saved) ||
        !("llm" in saved) ||
        !("processing" in saved) ||
        !("export" in saved)
      ) {
        console.error("[config] error: invalid config structure, returning default config");
        return { ...DEFAULT_CONFIG, ...envConfig };
      }
      return {
        ...DEFAULT_CONFIG,
        ...envConfig,
        ...saved,
        graph: {
          ...DEFAULT_CONFIG.graph,
          ...envConfig.graph,
          ...saved.graph,
        },
        llm: {
          ...DEFAULT_CONFIG.llm,
          ...saved.llm,
          endpoint: process.env.LLM_ENDPOINT || saved.llm?.endpoint || DEFAULT_CONFIG.llm.endpoint,
          model: process.env.LLM_MODEL || saved.llm?.model || DEFAULT_CONFIG.llm.model,
          provider: process.env.LLM_PROVIDER || saved.llm?.provider || DEFAULT_CONFIG.llm.provider,
        },
      };
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return { ...DEFAULT_CONFIG, ...envConfig };
}

export function saveConfig(config: AppConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadProcessedEmails(): ProcessedEmailRecord[] {
  return loadGoldenArray<ProcessedEmailRecord>("processedEmails");
}

export function saveProcessedEmails(records: ProcessedEmailRecord[]): void {
  saveGoldenArray("processedEmails", records);
}

export function loadSyncStatus(): SyncStatus {
  const arr = loadGoldenArray<SyncStatus>("syncStatus");
  if (arr.length > 0) return arr[0];
  return {
    lastSync: null,
    totalEmails: 0,
    processedEmails: 0,
    pendingEmails: 0,
    isSyncing: false,
    errors: [],
  };
}

export function saveSyncStatus(status: SyncStatus): void {
  saveGoldenArray("syncStatus", [status]);
}

export function loadCommitments(): CommitmentContract[] {
  return loadGoldenArray<CommitmentContract>("commitments");
}

export function saveCommitments(records: CommitmentContract[]): void {
  saveGoldenArray("commitments", records);
}

export function loadCommitmentMetrics(): CommitmentMetrics {
  const arr = loadGoldenArray<CommitmentMetrics>("commitmentMetrics");
  if (arr.length > 0) return arr[0];
  return {
    capability: { success: 0, total: 0 },
    inputsAvailable: { success: 0, total: 0 },
    toolCompletion: { success: 0, total: 0 },
    qualityApproval: { success: 0, total: 0 },
    acceptedWithoutRevision: { success: 0, total: 0 },
    durationsMs: [],
    modelVersion: "v1",
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function saveCommitmentMetrics(metrics: CommitmentMetrics): void {
  const toSave: CommitmentMetrics = {
    ...metrics,
    lastUpdatedAt: new Date().toISOString(),
  };
  saveGoldenArray("commitmentMetrics", [toSave]);
}

// ─── Strategy persistence (SQLite-backed) ───────────────────────────

export function loadStrategies(): StrategyGenome[] {
  return loadGoldenArray<StrategyGenome>("strategies");
}

export function saveStrategies(records: StrategyGenome[]): void {
  saveGoldenArray("strategies", records);
}

export function loadStrategyAssignments(): StrategyAssignment[] {
  return loadGoldenArray<StrategyAssignment>("strategyAssignments");
}

export function saveStrategyAssignments(records: StrategyAssignment[]): void {
  saveGoldenArray("strategyAssignments", records);
}

export function loadStrategyOutcomes(): StrategyOutcomeEvent[] {
  return loadGoldenArray<StrategyOutcomeEvent>("strategyOutcomes");
}

export function saveStrategyOutcomes(records: StrategyOutcomeEvent[]): void {
  saveGoldenArray("strategyOutcomes", records);
}

export function loadStrategyAttributions(): AttributionResult[] {
  return loadGoldenArray<AttributionResult>("strategyAttributions");
}

export function saveStrategyAttributions(records: AttributionResult[]): void {
  saveGoldenArray("strategyAttributions", records);
}

export function loadStrategyEvolution(): StrategyEvolutionProposal[] {
  return loadGoldenArray<StrategyEvolutionProposal>("strategyEvolution");
}

export function saveStrategyEvolution(records: StrategyEvolutionProposal[]): void {
  saveGoldenArray("strategyEvolution", records);
}

// ─── GOLDEN NODE persistence ───────────────────────────────────────
// SQLite-backed key-value store. Each collection is stored as a JSON
// array in the kv_store table, scoped to an organization.
// Falls back to the default org for backwards compatibility.

const GOLDEN_KEYS = {
  hypotheses: "hypotheses",
  priorArt: "priorArt",
  assignments: "assignments",
  outcomes: "outcomes",
  attributions: "attributions",
  derivatives: "derivatives",
  goldenNodes: "goldenNodes",
  attributionLedger: "attributionLedger",
  discoveryLedger: "discoveryLedger",
  researchReliability: "researchReliability",
  processes: "processes",
  competitions: "competitions",
  spinorProfiles: "spinorProfiles",
  spinorOrganisms: "spinorOrganisms",
  // SPINOR-RL
  missions: "missions",
  physicians: "physicians",
  palindromeUpdates: "palindromeUpdates",
  rlAgentStates: "rlAgentStates",
  rlRewards: "rlRewards",
  emailSignals: "emailSignals",
  stagnationFlags: "stagnationFlags",
  sproutTree: "sproutTree",
  diffusionStates: "diffusionStates",
  antiGamingChecks: "antiGamingChecks",
} as const;

// Backwards-compatible alias for code that references GOLDEN_FILES
const GOLDEN_FILES = GOLDEN_KEYS;

/**
 * In-memory cache for golden arrays. Provides a fast read path without
 * hitting SQLite on every call, and ensures writes within the same
 * process are visible to subsequent reads immediately.
 */
const goldenCache = new Map<string, unknown[]>();

/**
 * Ensure the default org exists and migrate any existing JSON files.
 * Called once on first database access.
 */
let _initialized = false;
function ensureDbInitialized(): void {
  if (_initialized) return;
  try {
    ensureDefaultOrg();
    migrateFromJsonFiles(DEFAULT_ORG_ID);
    _initialized = true;
    // Auto-seed demo data after DB is initialized
    try {
      const { ensureDemoDataSeeded } = require("@/lib/auto-seed");
      ensureDemoDataSeeded();
    } catch (e) {
      console.error("[config] auto-seed error:", e);
    }
  } catch (e) {
    console.error("[config] db init error:", e);
    _initialized = true; // Don't retry on every call
  }
}

export function loadGoldenArray<T>(key: string): T[] {
  ensureDbInitialized();
  if (goldenCache.has(key)) {
    // Return a deep copy to prevent callers from mutating the cache.
    // This matches the old JSON-file behavior where each read created
    // new object instances via JSON.parse.
    return JSON.parse(JSON.stringify(goldenCache.get(key))) as T[];
  }
  let result: T[] = [];
  try {
    result = kvLoad<T>(DEFAULT_ORG_ID, key);
  } catch (e) {
    console.error("[config] golden load error:", e);
  }
  goldenCache.set(key, result);
  return JSON.parse(JSON.stringify(result)) as T[];
}

export function saveGoldenArray<T>(key: string, records: T[]): void {
  ensureDbInitialized();
  // Always update the in-memory cache so subsequent reads see the write.
  goldenCache.set(key, records);
  try {
    kvSave(DEFAULT_ORG_ID, key, records);
  } catch (e) {
    // SQLite write failed — cache still has the data for this process
    console.error("[config] golden save error:", e);
  }
}

export const loadHypotheses = (): HypothesisAnatomy[] => loadGoldenArray<HypothesisAnatomy>(GOLDEN_FILES.hypotheses);
export const saveHypotheses = (r: HypothesisAnatomy[]) => saveGoldenArray(GOLDEN_FILES.hypotheses, r);
export const loadPriorArt = (): PriorArtRecord[] => loadGoldenArray<PriorArtRecord>(GOLDEN_FILES.priorArt);
export const savePriorArt = (r: PriorArtRecord[]) => saveGoldenArray(GOLDEN_FILES.priorArt, r);
export const loadHypothesisAssignments = (): HypothesisAssignment[] => loadGoldenArray<HypothesisAssignment>(GOLDEN_FILES.assignments);
export const saveHypothesisAssignments = (r: HypothesisAssignment[]) => saveGoldenArray(GOLDEN_FILES.assignments, r);
export const loadHypothesisOutcomes = (): HypothesisOutcome[] => loadGoldenArray<HypothesisOutcome>(GOLDEN_FILES.outcomes);
export const saveHypothesisOutcomes = (r: HypothesisOutcome[]) => saveGoldenArray(GOLDEN_FILES.outcomes, r);
export const loadHypothesisAttributions = (): HypothesisAttribution[] => loadGoldenArray<HypothesisAttribution>(GOLDEN_FILES.attributions);
export const saveHypothesisAttributions = (r: HypothesisAttribution[]) => saveGoldenArray(GOLDEN_FILES.attributions, r);
export const loadDerivatives = (): HypothesisDerivative[] => loadGoldenArray<HypothesisDerivative>(GOLDEN_FILES.derivatives);
export const saveDerivatives = (r: HypothesisDerivative[]) => saveGoldenArray(GOLDEN_FILES.derivatives, r);
export const loadGoldenNodes = (): GoldenNode[] => loadGoldenArray<GoldenNode>(GOLDEN_FILES.goldenNodes);
export const saveGoldenNodes = (r: GoldenNode[]) => saveGoldenArray(GOLDEN_FILES.goldenNodes, r);
export const loadAttributionLedger = (): AttributionLedgerEntry[] => loadGoldenArray<AttributionLedgerEntry>(GOLDEN_FILES.attributionLedger);
export const saveAttributionLedger = (r: AttributionLedgerEntry[]) => saveGoldenArray(GOLDEN_FILES.attributionLedger, r);
export const loadDiscoveryLedger = (): DiscoveryOpportunityLedger[] => loadGoldenArray<DiscoveryOpportunityLedger>(GOLDEN_FILES.discoveryLedger);
export const saveDiscoveryLedger = (r: DiscoveryOpportunityLedger[]) => saveGoldenArray(GOLDEN_FILES.discoveryLedger, r);
export const loadResearchReliability = (): ResearchReliability[] => loadGoldenArray<ResearchReliability>(GOLDEN_FILES.researchReliability);
export const saveResearchReliability = (r: ResearchReliability[]) => saveGoldenArray(GOLDEN_FILES.researchReliability, r);
export const loadProcesses = (): ProcessDefinition[] => loadGoldenArray<ProcessDefinition>(GOLDEN_FILES.processes);
export const saveProcesses = (r: ProcessDefinition[]) => saveGoldenArray(GOLDEN_FILES.processes, r);
export const loadCompetitions = (): ResearchCompetitionEntry[] => loadGoldenArray<ResearchCompetitionEntry>(GOLDEN_FILES.competitions);
export const saveCompetitions = (r: ResearchCompetitionEntry[]) => saveGoldenArray(GOLDEN_FILES.competitions, r);

// ─── SPINOR persistence ───────────────────────────────────────────
export const loadSpinorProfiles = (): SpinorParticipantProfile[] => loadGoldenArray<SpinorParticipantProfile>(GOLDEN_FILES.spinorProfiles);
export const saveSpinorProfiles = (r: SpinorParticipantProfile[]) => saveGoldenArray(GOLDEN_FILES.spinorProfiles, r);
export const loadSpinorOrganisms = (): SpinorOrganism[] => loadGoldenArray<SpinorOrganism>(GOLDEN_FILES.spinorOrganisms);
export const saveSpinorOrganisms = (r: SpinorOrganism[]) => saveGoldenArray(GOLDEN_FILES.spinorOrganisms, r);

// ─── SPINOR-RL persistence ──────────────────────────────────────────
export const loadMissions = (): MissionCard[] => loadGoldenArray<MissionCard>(GOLDEN_FILES.missions);
export const saveMissions = (r: MissionCard[]) => saveGoldenArray(GOLDEN_FILES.missions, r);
export const loadPhysicians = (): PhysicianModel[] => loadGoldenArray<PhysicianModel>(GOLDEN_FILES.physicians);
export const savePhysicians = (r: PhysicianModel[]) => saveGoldenArray(GOLDEN_FILES.physicians, r);
export const loadPalindromeUpdates = (): PalindromeUpdate[] => loadGoldenArray<PalindromeUpdate>(GOLDEN_FILES.palindromeUpdates);
export const savePalindromeUpdates = (r: PalindromeUpdate[]) => saveGoldenArray(GOLDEN_FILES.palindromeUpdates, r);
export const loadRLAgentStates = (): RLAgentState[] => loadGoldenArray<RLAgentState>(GOLDEN_FILES.rlAgentStates);
export const saveRLAgentStates = (r: RLAgentState[]) => saveGoldenArray(GOLDEN_FILES.rlAgentStates, r);
export const loadRLRewards = (): RLReward[] => loadGoldenArray<RLReward>(GOLDEN_FILES.rlRewards);
export const saveRLRewards = (r: RLReward[]) => saveGoldenArray(GOLDEN_FILES.rlRewards, r);
export const loadEmailSignals = (): EmailSignal[] => loadGoldenArray<EmailSignal>(GOLDEN_FILES.emailSignals);
export const saveEmailSignals = (r: EmailSignal[]) => saveGoldenArray(GOLDEN_FILES.emailSignals, r);
export const loadStagnationFlags = (): StagnationFlag[] => loadGoldenArray<StagnationFlag>(GOLDEN_FILES.stagnationFlags);
export const saveStagnationFlags = (r: StagnationFlag[]) => saveGoldenArray(GOLDEN_FILES.stagnationFlags, r);
export const loadSproutTree = (): SproutNode[] => loadGoldenArray<SproutNode>(GOLDEN_FILES.sproutTree);
export const saveSproutTree = (r: SproutNode[]) => saveGoldenArray(GOLDEN_FILES.sproutTree, r);
export const loadDiffusionStates = (): DiffusionState[] => loadGoldenArray<DiffusionState>(GOLDEN_FILES.diffusionStates);
export const saveDiffusionStates = (r: DiffusionState[]) => saveGoldenArray(GOLDEN_FILES.diffusionStates, r);
export const loadAntiGamingChecks = (): AntiGamingCheck[] => loadGoldenArray<AntiGamingCheck>(GOLDEN_KEYS.antiGamingChecks);
export const saveAntiGamingChecks = (r: AntiGamingCheck[]) => saveGoldenArray(GOLDEN_KEYS.antiGamingChecks, r);

// ─── CITY OF APPLICATIONS persistence ──────────────────────────────

export const loadCityApps = (): AppIdentity[] => loadGoldenArray<AppIdentity>("cityApps");
export const saveCityApps = (r: AppIdentity[]) => saveGoldenArray("cityApps", r);

export const loadCityEvents = (): MaterialEvent[] => loadGoldenArray<MaterialEvent>("cityEvents");
export const saveCityEvents = (r: MaterialEvent[]) => saveGoldenArray("cityEvents", r);

export const loadCityCapabilityGrants = (): CapabilityGrant[] => loadGoldenArray<CapabilityGrant>("cityCapabilityGrants");
export const saveCityCapabilityGrants = (r: CapabilityGrant[]) => saveGoldenArray("cityCapabilityGrants", r);

export const loadCityDifferentiationResults = (): DifferentiationResult[] => loadGoldenArray<DifferentiationResult>("cityDifferentiationResults");
export const saveCityDifferentiationResults = (r: DifferentiationResult[]) => saveGoldenArray("cityDifferentiationResults", r);

export const loadCityLineageRecords = (): LineageRecord[] => loadGoldenArray<LineageRecord>("cityLineageRecords");
export const saveCityLineageRecords = (r: LineageRecord[]) => saveGoldenArray("cityLineageRecords", r);

export const loadCityPriorArtSearches = (): PriorArtSearch[] => loadGoldenArray<PriorArtSearch>("cityPriorArtSearches");
export const saveCityPriorArtSearches = (r: PriorArtSearch[]) => saveGoldenArray("cityPriorArtSearches", r);

export const loadCityIPEvidencePackages = (): IPEvidencePackage[] => loadGoldenArray<IPEvidencePackage>("cityIPEvidencePackages");
export const saveCityIPEvidencePackages = (r: IPEvidencePackage[]) => saveGoldenArray("cityIPEvidencePackages", r);

export const loadCityMarketTestResults = (): MarketTestResult[] => loadGoldenArray<MarketTestResult>("cityMarketTestResults");
export const saveCityMarketTestResults = (r: MarketTestResult[]) => saveGoldenArray("cityMarketTestResults", r);

export const loadCityEvaluationResults = (): AppEvaluationResult[] => loadGoldenArray<AppEvaluationResult>("cityEvaluationResults");
export const saveCityEvaluationResults = (r: AppEvaluationResult[]) => saveGoldenArray("cityEvaluationResults", r);

export const loadCityMerkleRoots = (): MerkleRoot[] => loadGoldenArray<MerkleRoot>("cityMerkleRoots");
export const saveCityMerkleRoot = (r: MerkleRoot[]) => saveGoldenArray("cityMerkleRoots", r);

// ─── MEMBRA RUNTIME persistence ────────────────────────────────────

export const loadMembraManifests = (): GGFUManifest[] => loadGoldenArray<GGFUManifest>("membraManifests");
export const saveMembraManifests = (r: GGFUManifest[]) => saveGoldenArray("membraManifests", r);

export const loadMembraRegistry = (): RegistryEntry[] => loadGoldenArray<RegistryEntry>("membraRegistry");
export const saveMembraRegistry = (r: RegistryEntry[]) => saveGoldenArray("membraRegistry", r);

export const loadMembraEvents = (): ContinuityEvent[] => loadGoldenArray<ContinuityEvent>("membraEvents");
export const saveMembraEvents = (r: ContinuityEvent[]) => saveGoldenArray("membraEvents", r);

export const loadMembraMerkleRoots = (): ContinuityMerkleRoot[] => loadGoldenArray<ContinuityMerkleRoot>("membraMerkleRoots");
export const saveMembraMerkleRoots = (r: ContinuityMerkleRoot[]) => saveGoldenArray("membraMerkleRoots", r);

export const loadMembraReceipts = (): ExecutionReceipt[] => loadGoldenArray<ExecutionReceipt>("membraReceipts");
export const saveMembraReceipts = (r: ExecutionReceipt[]) => saveGoldenArray("membraReceipts", r);

export const loadMembraEvidencePackets = (): EvidencePacket[] => loadGoldenArray<EvidencePacket>("membraEvidencePackets");
export const saveMembraEvidencePackets = (r: EvidencePacket[]) => saveGoldenArray("membraEvidencePackets", r);

export const loadMembraAppraisals = (): AppraisalReport[] => loadGoldenArray<AppraisalReport>("membraAppraisals");
export const saveMembraAppraisals = (r: AppraisalReport[]) => saveGoldenArray("membraAppraisals", r);

export const loadMembraCASEntries = (): CASEntry[] => loadGoldenArray<CASEntry>("membraCASEntries");
export const saveMembraCASEntries = (r: CASEntry[]) => saveGoldenArray("membraCASEntries", r);
