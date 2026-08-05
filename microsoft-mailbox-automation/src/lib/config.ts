import * as fs from "fs";
import * as path from "path";
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
} from "@/types";

const DEFAULT_CONFIG: AppConfig = {
  graph: {
    clientId: "",
    clientSecret: "",
    tenantId: "",
    mailbox: "",
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as "openai" | "anthropic" | "azure" | "ollama") || "openai",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.LLM_MODEL || "gpt-oss:20b",
    // gpt-oss:20b is a reasoning model — needs higher max_tokens so content
    // isn't consumed entirely by the reasoning trace.
    endpoint: process.env.LLM_ENDPOINT || "https://api.llm7.io/v1/chat/completions",
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
      clientId: process.env.AZURE_AD_CLIENT_ID || "",
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET || "",
      tenantId: process.env.AZURE_AD_TENANT_ID || "common",
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
  ensureDataDir();
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      const raw = fs.readFileSync(PROCESSED_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return [];
}

export function saveProcessedEmails(records: ProcessedEmailRecord[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadSyncStatus(): SyncStatus {
  ensureDataDir();
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const raw = fs.readFileSync(STATUS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
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
  ensureDataDir();
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadCommitments(): CommitmentContract[] {
  ensureDataDir();
  try {
    if (fs.existsSync(COMMITMENTS_FILE)) {
      const raw = fs.readFileSync(COMMITMENTS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return [];
}

export function saveCommitments(records: CommitmentContract[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(COMMITMENTS_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadCommitmentMetrics(): CommitmentMetrics {
  ensureDataDir();
  try {
    if (fs.existsSync(COMMITMENT_METRICS_FILE)) {
      const raw = fs.readFileSync(COMMITMENT_METRICS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as CommitmentMetrics;
      }
    }
  } catch (e) {
    console.error("[config] error:", e);
  }

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
  ensureDataDir();
  try {
    const toSave: CommitmentMetrics = {
      ...metrics,
      lastUpdatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(COMMITMENT_METRICS_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

// ─── Strategy persistence ──────────────────────────────────────────

export function loadStrategies(): StrategyGenome[] {
  ensureDataDir();
  try {
    if (fs.existsSync(STRATEGIES_FILE)) {
      const raw = fs.readFileSync(STRATEGIES_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return [];
}

export function saveStrategies(records: StrategyGenome[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadStrategyAssignments(): StrategyAssignment[] {
  ensureDataDir();
  try {
    if (fs.existsSync(STRATEGY_ASSIGNMENTS_FILE)) {
      const raw = fs.readFileSync(STRATEGY_ASSIGNMENTS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return [];
}

export function saveStrategyAssignments(records: StrategyAssignment[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STRATEGY_ASSIGNMENTS_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadStrategyOutcomes(): StrategyOutcomeEvent[] {
  ensureDataDir();
  try {
    if (fs.existsSync(STRATEGY_OUTCOMES_FILE)) {
      const raw = fs.readFileSync(STRATEGY_OUTCOMES_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return [];
}

export function saveStrategyOutcomes(records: StrategyOutcomeEvent[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STRATEGY_OUTCOMES_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadStrategyAttributions(): AttributionResult[] {
  ensureDataDir();
  try {
    if (fs.existsSync(STRATEGY_ATTRIBUTIONS_FILE)) {
      const raw = fs.readFileSync(STRATEGY_ATTRIBUTIONS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return [];
}

export function saveStrategyAttributions(records: AttributionResult[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STRATEGY_ATTRIBUTIONS_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

export function loadStrategyEvolution(): StrategyEvolutionProposal[] {
  ensureDataDir();
  try {
    if (fs.existsSync(STRATEGY_EVOLUTION_FILE)) {
      const raw = fs.readFileSync(STRATEGY_EVOLUTION_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("[config] error:", e);
  }
  return [];
}

export function saveStrategyEvolution(records: StrategyEvolutionProposal[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STRATEGY_EVOLUTION_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("[config] error:", e);
  }
}

// ─── GOLDEN NODE persistence ───────────────────────────────────────
// Generic load/save helpers for the hypothesis-to-business engine.
// Each collection is stored as a JSON array under data/golden-*.json.

const GOLDEN_FILES = {
  hypotheses: `${DATA_DIR}/golden-hypotheses.json`,
  priorArt: `${DATA_DIR}/golden-prior-art.json`,
  assignments: `${DATA_DIR}/golden-assignments.json`,
  outcomes: `${DATA_DIR}/golden-outcomes.json`,
  attributions: `${DATA_DIR}/golden-attributions.json`,
  derivatives: `${DATA_DIR}/golden-derivatives.json`,
  goldenNodes: `${DATA_DIR}/golden-nodes.json`,
  attributionLedger: `${DATA_DIR}/golden-attribution-ledger.json`,
  discoveryLedger: `${DATA_DIR}/golden-discovery-ledger.json`,
  researchReliability: `${DATA_DIR}/golden-research-reliability.json`,
  processes: `${DATA_DIR}/golden-processes.json`,
  competitions: `${DATA_DIR}/golden-competitions.json`,
  spinorProfiles: `${DATA_DIR}/spinor-profiles.json`,
  spinorOrganisms: `${DATA_DIR}/spinor-organisms.json`,
  // SPINOR-RL
  missions: `${DATA_DIR}/spinor-rl-missions.json`,
  physicians: `${DATA_DIR}/spinor-rl-physicians.json`,
  palindromeUpdates: `${DATA_DIR}/spinor-rl-palindrome.json`,
  rlAgentStates: `${DATA_DIR}/spinor-rl-agent-states.json`,
  rlRewards: `${DATA_DIR}/spinor-rl-rewards.json`,
  emailSignals: `${DATA_DIR}/spinor-rl-email-signals.json`,
  stagnationFlags: `${DATA_DIR}/spinor-rl-stagnation.json`,
  sproutTree: `${DATA_DIR}/spinor-rl-sprouts.json`,
  diffusionStates: `${DATA_DIR}/spinor-rl-diffusion.json`,
  antiGamingChecks: `${DATA_DIR}/spinor-rl-anti-gaming.json`,
} as const;

/**
 * In-memory cache for golden arrays. On serverless platforms (Vercel),
 * the filesystem is read-only, so writes to data/*.json fail silently.
 * This cache ensures that writes within the same process are visible to
 * subsequent reads, keeping the API consistent within a request lifecycle.
 * The cache is seeded from the deployed data files on first access.
 */
const goldenCache = new Map<string, unknown[]>();

function loadGoldenArray<T>(file: string): T[] {
  if (goldenCache.has(file)) {
    return goldenCache.get(file) as T[];
  }
  ensureDataDir();
  let result: T[] = [];
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) result = parsed as T[];
    }
  } catch (e) {
    console.error("[config] golden load error:", e);
  }
  goldenCache.set(file, result);
  return result;
}

function saveGoldenArray<T>(file: string, records: T[]): void {
  // Always update the in-memory cache so subsequent reads see the write.
  goldenCache.set(file, records);
  ensureDataDir();
  try {
    fs.writeFileSync(file, JSON.stringify(records, null, 2));
  } catch (e) {
    // Expected on read-only serverless filesystems — cache has the data.
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
export const loadAntiGamingChecks = (): AntiGamingCheck[] => loadGoldenArray<AntiGamingCheck>(GOLDEN_FILES.antiGamingChecks);
export const saveAntiGamingChecks = (r: AntiGamingCheck[]) => saveGoldenArray(GOLDEN_FILES.antiGamingChecks, r);
