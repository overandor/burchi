import * as fs from "fs";
import * as path from "path";
import { AppConfig, ProcessedEmailRecord, SyncStatus } from "@/types";

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
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    endpoint: process.env.LLM_ENDPOINT || "https://api.openai.com/v1",
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
const DATA_DIR = "data";
const PROCESSED_FILE = `${DATA_DIR}/processed-emails.json`;
const STATUS_FILE = `${DATA_DIR}/sync-status.json`;

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch {
    // Read-only filesystem (e.g. Netlify serverless) — safe to ignore
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
    console.error("Failed to load config:", e);
  }
  return { ...DEFAULT_CONFIG, ...envConfig };
}

export function saveConfig(config: AppConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Failed to save config:", e);
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
    console.error("Failed to load processed emails:", e);
  }
  return [];
}

export function saveProcessedEmails(records: ProcessedEmailRecord[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error("Failed to save processed emails:", e);
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
    console.error("Failed to load sync status:", e);
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
    console.error("Failed to save sync status:", e);
  }
}
