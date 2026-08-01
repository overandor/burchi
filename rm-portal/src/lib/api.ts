/**
 * API client for the Autonomous Revenue Operations backend.
 *
 * Falls back to mock data when the backend is unreachable, so the UI
 * always renders something useful during development or demos.
 */

import {
  telemetryRibbon as mockRibbon,
  aiOperator as mockOperator,
  bioVariants as mockVariants,
  visitors as mockVisitors,
  funnelStages as mockFunnel,
  receipts as mockReceipts,
  telemetryEvents as mockEvents,
  automationHealth as mockHealth,
} from "./mock-data"

// Use relative URLs so requests go through the Next.js API proxy route.
// This works both locally and when deployed (the proxy forwards to the backend).
// Set NEXT_PUBLIC_API_URL to bypass the proxy and hit the backend directly.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || ""

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function postAPI<T>(path: string, body?: unknown): Promise<T | null> {
  return fetchAPI<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function patchAPI<T>(path: string, body: unknown): Promise<T | null> {
  return fetchAPI<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

// ─── Types ───────────────────────────────────────────────────────

export interface OverviewData {
  mode: string
  current_bio: string
  current_strategy: string
  confidence: number
  reward_history: { timestamp: string; reward: number }[]
  next_experiment: string
  next_scheduled: string
  funnel: FunnelStage[]
  ribbon: TelemetryMetric[]
  live_events: LiveEvent[]
  recent_decisions: Decision[]
  high_intent_visitors: Visitor[]
  telemetry_stats: { total_events: number; by_type: Record<string, number>; by_semantic: Record<string, number> }
  experiments: Experiment[]
  kpi: KpiSnapshot
  capabilities: Record<string, boolean>
}

export interface TelemetryMetric {
  label: string
  value: number | null
  observation: string
  trend?: string
  change_pct?: number
}

export interface FunnelStage {
  stage: string
  count: number | null
  conversion_rate: number | null
  observation: string
}

export interface LiveEvent {
  id: string
  event_type: string
  message: string
  severity: string
  timestamp: string
}

export interface Decision {
  id: string
  experiment_id?: string
  variant_id?: string
  action_type: string
  rationale: string
  confidence: number
  mode: string
  status: string
  created_at: string
}

export interface Visitor {
  id?: string
  username: string
  visit_count: number
  first_seen?: string
  last_seen: string
  last_online: string
  location: string | null
  ip?: string
  messaged: boolean
  messaged_count: number
  last_message?: string
  engagement_score: number
  lifecycle_stage?: string
  inferred_intent?: string
  converted?: boolean
  next_action: string
  is_repeat: boolean
}

export interface Experiment {
  id: string
  name: string
  type: string
  status: string
  winner_id: string
  reward_metric: string
  confidence: number
  observations: number
  created_at: string
  ended_at?: string
  variants: Variant[]
}

export interface Variant {
  id: string
  experiment_id: string
  label: string
  content: string
  reward: number
  impressions: number
  clicks: number
  contacts: number
  conversions: number
  status: string
  url: string
  created_at: string
}

export interface ContentItem {
  id: string
  type: string
  title: string
  body: string
  status: string
  experiment_id: string
  performance_score: number
  metadata: Record<string, unknown>
  created_at: string
}

export interface Receipt {
  id: string
  decision_id: string
  timestamp: string
  action: string
  status: string
  observation: string
  detail: Record<string, unknown>
  input_observation: string
  source: string
  model: string
  decision: string
  result: string
  reward: number
}

export interface KpiSnapshot {
  id?: string
  date: string
  impressions: number
  visitors: number
  repeat_visitors: number
  clicks: number
  contacts: number
  bookings: number
  revenue: number
  ctr: number
  conversion_rate: number
  created_at: string
}

export interface ActionItem {
  id: string
  action_type: string
  target: string
  payload: Record<string, unknown>
  mode: string
  status: string
  scheduled_at: string
  executed_at: string
  result: string
  created_at: string
}

export interface TelemetryEvent {
  id: string
  timestamp: string
  event_type: string
  source: string
  observation: string
  detail: string
  visitor_id?: string
  value?: number
}

export interface AIStatus {
  mode: string
  current_experiment: string
  current_bio: string
  confidence: number
  strategy: string
  observations: number
  active_variants: number
  leader_reward: number
}

// ─── API Functions ───────────────────────────────────────────────

export const api = {
  // Overview
  getOverview: () => fetchAPI<OverviewData>("/api/overview"),

  // Telemetry
  getTelemetry: (limit = 50) => fetchAPI<TelemetryEvent[]>(`/api/telemetry?limit=${limit}`),
  getTelemetryStats: () => fetchAPI<{ total_events: number; by_type: Record<string, number>; by_semantic: Record<string, number> }>("/api/telemetry/stats"),
  logTelemetry: (event_type: string, visitor_id = "", value = 0, metadata: Record<string, unknown> = {}) =>
    postAPI("/api/telemetry", { event_type, visitor_id, value, metadata }),

  // Visitors
  getVisitors: (limit = 50) => fetchAPI<Visitor[]>(`/api/visitors?limit=${limit}`),
  getHighIntentVisitors: (limit = 20) => fetchAPI<Visitor[]>(`/api/visitors/high-intent?limit=${limit}`),
  getVisitor: (id: string) => fetchAPI<Visitor & { telemetry: TelemetryEvent[] }>(`/api/visitors/${id}`),
  upsertVisitor: (visitor_id: string, ip = "", geo = "") => postAPI("/api/visitors", { visitor_id, ip, geo }),
  updateVisitor: (visitor_id: string, data: Partial<Visitor>) => patchAPI(`/api/visitors/${visitor_id}`, data),

  // Experiments
  getExperiments: (limit = 20) => fetchAPI<Experiment[]>(`/api/experiments?limit=${limit}`),
  getExperiment: (id: string) => fetchAPI<Experiment>(`/api/experiments/${id}`),
  createExperiment: (name: string, type = "bio", variants: Record<string, unknown>[] = []) =>
    postAPI("/api/experiments", { name, type, variants }),
  updateVariant: (eid: string, vid: string, data: Partial<Variant>) =>
    patchAPI(`/api/experiments/${eid}/variants/${vid}`, data),
  completeExperiment: (eid: string, winner_id: string, confidence: number) =>
    postAPI(`/api/experiments/${eid}/complete`, { winner_id, confidence }),

  // Content
  getContent: (type = "", limit = 50) => fetchAPI<ContentItem[]>(`/api/content?type=${type}&limit=${limit}`),
  createContent: (type: string, title: string, body: string, metadata: Record<string, unknown> = {}) =>
    postAPI("/api/content", { type, title, body, metadata }),

  // Decisions
  getDecisions: (limit = 30) => fetchAPI<Decision[]>(`/api/decisions?limit=${limit}`),
  createDecision: (data: Partial<Decision>) => postAPI("/api/decisions", data),
  approveDecision: (id: string) => postAPI(`/api/decisions/${id}/approve`),

  // Receipts
  getReceipts: (limit = 30) => fetchAPI<Receipt[]>(`/api/receipts?limit=${limit}`),

  // KPIs
  getKpis: (limit = 30) => fetchAPI<KpiSnapshot[]>(`/api/kpis?limit=${limit}`),
  getLatestKpi: () => fetchAPI<KpiSnapshot>("/api/kpis/latest"),
  saveKpi: (data: Partial<KpiSnapshot>) => postAPI("/api/kpis", data),

  // Actions
  getActions: (limit = 30) => fetchAPI<ActionItem[]>(`/api/actions?limit=${limit}`),
  createAction: (data: Partial<ActionItem>) => postAPI("/api/actions", data),
  executeAction: (id: string, result = "") => postAPI(`/api/actions/${id}/execute?result=${encodeURIComponent(result)}`),

  // Control
  getControlState: () => fetchAPI<Record<string, string>>("/api/control"),
  setControlState: (key: string, value: string) => postAPI(`/api/control/${key}`, { value }),

  // Events
  getEvents: (limit = 50) => fetchAPI<LiveEvent[]>(`/api/events?limit=${limit}`),
  logEvent: (event_type: string, message: string, severity = "info") =>
    postAPI("/api/events", { event_type, message, severity }),

  // AI
  aiDecide: (experiment_id = "") => postAPI("/api/ai/decide", { experiment_id }),
  aiGenerate: (content_type: string, topic = "", count = 1) =>
    postAPI("/api/ai/generate", { content_type, topic, count }),
  getAIStatus: () => fetchAPI<AIStatus>("/api/ai/status"),

  // Health
  getHealth: () => fetchAPI<{ status: string; mode: string; timestamp: string }>("/api/health"),

  // Seed
  seed: () => postAPI("/api/seed"),

  // ─── hfdashboard endpoints (RentMasseur Unified Dashboard) ──────
  hfOverview: () => fetchAPI<any>("/api/hf/overview"),
  hfCompetitors: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/competitors?limit=${limit}&offset=${offset}`),
  hfVisitors: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/visitors?limit=${limit}&offset=${offset}`),
  hfReviews: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/reviews?limit=${limit}&offset=${offset}`),
  hfBios: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/bios?limit=${limit}&offset=${offset}`),
  hfBlogs: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/blogs?limit=${limit}&offset=${offset}`),
  hfInterviews: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/interviews?limit=${limit}&offset=${offset}`),
  hfABTests: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/abtests?limit=${limit}&offset=${offset}`),
  hfStrategies: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/strategies?limit=${limit}&offset=${offset}`),
  hfClients: (limit = 50, offset = 0) => fetchAPI<any[]>(`/api/hf/clients?limit=${limit}&offset=${offset}`),
  hfKPIs: (limit = 200, offset = 0) => fetchAPI<any[]>(`/api/hf/kpis?limit=${limit}&offset=${offset}`),
  hfProfileStats: (limit = 100, offset = 0) => fetchAPI<any[]>(`/api/hf/profile-stats?limit=${limit}&offset=${offset}`),
  hfProfileSnapshot: () => fetchAPI<any>("/api/hf/profile-snapshot"),
  hfCounts: () => fetchAPI<Record<string, number>>("/api/hf/counts"),

  // ─── Torrent GGUF endpoints (P2P model distribution + inference) ─
  ggufModels: () => fetchAPI<any[]>("/api/models"),
  ggufModel: (id: string) => fetchAPI<any>(`/api/models/${id}`),
  ggufNodes: () => fetchAPI<any[]>("/api/nodes"),
  ggufAnalytics: () => fetchAPI<any>("/api/analytics"),
  ggufInferenceLogs: () => fetchAPI<any[]>("/api/inference/logs"),
  ggufRunInference: (prompt: string, model_id = "qwen2-0.5b-q3k", max_tokens = 128) =>
    postAPI("/api/inference", { prompt, model_id, max_tokens }),
  ggufTrackerHealth: () => fetchAPI<any>("/api/tracker/health"),
  ggufPeers: () => fetchAPI<any[]>("/api/tracker/peers"),
  ggufSwarmHealth: () => fetchAPI<any>("/api/p2p/swarm/health"),
  ggufSwarmTopology: () => fetchAPI<any>("/api/p2p/swarm/topology"),
  ggufCompetitiveStats: () => fetchAPI<any>("/api/competitive/stats"),
  ggufCompetitiveRaces: () => fetchAPI<any[]>("/api/competitive/races"),
  ggufRunRace: (prompt: string, model_id = "qwen2-0.5b-q3k", num_workers = 2) =>
    postAPI("/api/competitive/race", { prompt, model_id, num_workers }),

  // ─── HF Model Compiler endpoints ─────────────────────────────────
  compilerInspect: (repoId: string) => postAPI<any>("/api/compiler/inspect", { repo_id: repoId }),
  compilerInspectGet: (repoId: string) => fetchAPI<any>(`/api/compiler/inspect/${repoId}`),
  compilerCompile: (repoId: string) => postAPI<any>("/api/compiler/compile", { repo_id: repoId }),
  compilerModels: () => fetchAPI<any>("/api/compiler/models"),

  // ─── Universal /v1/* API (OpenAI-compatible) ─────────────────────
  v1ChatCompletions: (model: string, messages: { role: string; content: string }[], maxTokens = 128) =>
    postAPI<any>("/v1/chat/completions", { model, messages, max_tokens: maxTokens }),
  v1Completions: (model: string, prompt: string, maxTokens = 128) =>
    postAPI<any>("/v1/completions", { model, prompt, max_tokens: maxTokens }),
  v1Embeddings: (model: string, input: string) =>
    postAPI<any>("/v1/embeddings", { model, input }),
  v1Images: (model: string, prompt: string, size = "1024x1024") =>
    postAPI<any>("/v1/images/generations", { model, prompt, size }),
  v1Inference: (model: string, input: string, task = "auto") =>
    postAPI<any>("/v1/inference", { model, input, task }),

  // ─── Auto-Ingest Pipeline ────────────────────────────────────────
  autoIngest: () => postAPI<any>("/api/auto/ingest"),
  autoTick: () => postAPI<any>("/api/auto/tick"),
  autoStatus: () => fetchAPI<any>("/api/auto/status"),

  // ─── Consent → RevOps Bridge ─────────────────────────────────────
  consentBridgeSyncContact: (contact: {
    contact_id: string; email: string; name?: string;
    consent_source: string; consent_scope: string; consented_at?: string;
    metadata?: Record<string, unknown>;
  }) => postAPI<any>("/api/consent-bridge/sync-contact", contact),

  consentBridgeRewardSignal: (signal: {
    experiment_id: string; variant_id?: string; contact_id?: string;
    reward_metric: string; reward_value: number; evidence?: Record<string, unknown>;
  }) => postAPI<any>("/api/consent-bridge/reward-signal", signal),

  consentBridgeAutoFollowup: (inquiry: {
    contact_id: string; contact_email?: string; contact_name?: string;
    inquiry_text: string; consent_scope?: string; consented_at?: string;
  }) => postAPI<any>("/api/consent-bridge/auto-followup", inquiry),

  consentBridgeStatus: () => fetchAPI<any>("/api/consent-bridge/status"),

  // ─── Market Intelligence Auto-Ingest ────────────────────────────
  marketIntelScrape: (limit = 20) => postAPI<any>(`/api/market-intel/scrape?limit=${limit}`),
  marketIntelChanges: () => fetchAPI<any>("/api/market-intel/changes"),
  marketIntelPricing: () => fetchAPI<any>("/api/market-intel/pricing"),
  marketIntelPipeline: () => postAPI<any>("/api/market-intel/pipeline"),
  marketIntelStatus: () => fetchAPI<any>("/api/market-intel/status"),

  // ─── Multi-Tenant Architecture ──────────────────────────────────
  listTenants: () => fetchAPI<any[]>("/api/tenants"),
  createTenant: (name: string, slug: string, plan = "free") =>
    postAPI<any>("/api/tenants", { name, slug, plan }),
  getTenant: (tid: string) => fetchAPI<any>(`/api/tenants/${tid}`),
  updateTenant: (tid: string, data: Record<string, unknown>) =>
    fetchAPI<any>(`/api/tenants/${tid}`, { method: "PATCH", body: JSON.stringify(data) }),
  getTenantUsage: (tid: string) => fetchAPI<any>(`/api/tenants/${tid}/usage`),
  getTenantUsageHistory: (tid: string, limit = 100) =>
    fetchAPI<any[]>(`/api/tenants/${tid}/usage/history?limit=${limit}`),
  createApiKey: (tid: string, label: string, scopes: string[] = ["read", "write"]) =>
    postAPI<any>(`/api/tenants/${tid}/api-keys`, { tenant_id: tid, label, scopes }),
  listApiKeys: (tid: string) => fetchAPI<any[]>(`/api/tenants/${tid}/api-keys`),
  billingOverview: () => fetchAPI<any>("/api/billing/overview"),

  // ─── Inference Marketplace ──────────────────────────────────────
  marketplaceRegister: (data: {
    node_id: string; name: string; inference_url: string;
    models?: string[]; region?: string; capabilities?: Record<string, unknown>;
    pricing_per_1k_tokens?: number;
  }) => postAPI<any>("/api/marketplace/register", data),
  marketplaceOverview: () => fetchAPI<any>("/api/marketplace/overview"),
  marketplaceReputation: (nodeId: string) => fetchAPI<any>(`/api/marketplace/nodes/${nodeId}/reputation`),
  marketplaceLeaderboard: () => fetchAPI<any[]>("/api/marketplace/reputation/leaderboard"),
  marketplaceCredits: (nodeId: string) => fetchAPI<any[]>(`/api/marketplace/nodes/${nodeId}/credits`),
  marketplaceSelectNode: (modelId = "", region = "") =>
    postAPI<any>(`/api/marketplace/select-node?model_id=${modelId}&region=${region}`),
  marketplaceStatus: () => fetchAPI<any>("/api/marketplace/status"),

  // ─── Real-Time Visitor Intent Scoring ───────────────────────────
  intentIngestEvent: (event: {
    visitor_id: string; event_type: string; event_data?: Record<string, unknown>;
    ip?: string; geo?: string;
  }) => postAPI<any>("/api/intent/ingest-event", event),
  intentScoreVisitor: (visitorId: string) => fetchAPI<any>(`/api/intent/score/${visitorId}`),
  intentScoreAll: () => fetchAPI<any>("/api/intent/score-all"),
  intentStatus: () => fetchAPI<any>("/api/intent/status"),

  // ─── Fine-Tuning Pipeline ───────────────────────────────────────
  finetuneCreateDataset: (data: { name: string; content_type?: string; description?: string; limit?: number }) =>
    postAPI<any>("/api/finetune/datasets", data),
  finetuneListDatasets: () => fetchAPI<any[]>("/api/finetune/datasets"),
  finetuneGetDataset: (did: string) => fetchAPI<any>(`/api/finetune/datasets/${did}`),
  finetuneCreateJob: (data: {
    dataset_id: string; base_model?: string; output_model_name?: string;
    epochs?: number; learning_rate?: number; batch_size?: number;
  }) => postAPI<any>("/api/finetune/jobs", data),
  finetuneListJobs: () => fetchAPI<any[]>("/api/finetune/jobs"),
  finetuneGetJob: (jid: string) => fetchAPI<any>(`/api/finetune/jobs/${jid}`),
  finetuneTrain: (jid: string) => postAPI<any>(`/api/finetune/jobs/${jid}/train`),
  finetuneCreateABTest: (data: { name: string; base_model?: string; finetuned_model?: string; prompt: string }) =>
    postAPI<any>("/api/finetune/ab-tests", data),
  finetuneListABTests: () => fetchAPI<any[]>("/api/finetune/ab-tests"),
  finetuneStatus: () => fetchAPI<any>("/api/finetune/status"),

  // ─── Autonomous Decision Loop ───────────────────────────────────
  autonomousCycle: () => postAPI<any>("/api/autonomous/cycle"),
  autonomousStatus: () => fetchAPI<any>("/api/autonomous/status"),
  autonomousBudget: (total = 1000) => fetchAPI<any>(`/api/autonomous/budget?total=${total}`),
  autonomousEnable: () => postAPI<any>("/api/autonomous/enable"),
  autonomousDisable: () => postAPI<any>("/api/autonomous/disable"),

  // ─── Cross-Platform Ingestion ───────────────────────────────────
  ingestionAddSource: (data: { source_type: string; source_name: string; credentials?: Record<string, unknown> }) =>
    postAPI<any>("/api/ingestion/sources", data),
  ingestionListSources: () => fetchAPI<any[]>("/api/ingestion/sources"),
  ingestionIngest: (sourceId: string) => postAPI<any>(`/api/ingestion/ingest/${sourceId}`),
  ingestionIngestAll: () => postAPI<any>("/api/ingestion/ingest-all"),
  ingestionAttribution: () => fetchAPI<any>("/api/ingestion/attribution"),

  // ─── Deployment Pipeline ────────────────────────────────────────
  deployModel: (data: {
    model_id: string; model_name?: string; runtime?: string; provider?: string;
    auto_scale?: boolean; min_replicas?: number; max_replicas?: number;
  }) => postAPI<any>("/api/deploy", data),
  listDeployments: () => fetchAPI<any[]>("/api/deployments"),
  getDeployment: (did: string) => fetchAPI<any>(`/api/deployments/${did}`),
  rollbackDeployment: (did: string) => postAPI<any>(`/api/deployments/${did}/rollback`),
  scaleDeployment: (did: string, replicas: number) => postAPI<any>(`/api/deployments/${did}/scale?replicas=${replicas}`),

  // ─── CRM Integration ────────────────────────────────────────────
  crmAddConnection: (data: { crm_type: string; name: string; api_key?: string; api_url?: string }) =>
    postAPI<any>("/api/crm/connections", data),
  crmListConnections: () => fetchAPI<any[]>("/api/crm/connections"),
  crmSync: (connectionId: string) => postAPI<any>(`/api/crm/sync/${connectionId}`),
  crmSyncAll: () => postAPI<any>("/api/crm/sync-all"),
  crmSyncLog: (connectionId: string) => fetchAPI<any[]>(`/api/crm/sync-log/${connectionId}`),
}

// ─── Hooks (lightweight polling) ─────────────────────────────────

import { useEffect, useState, useCallback } from "react"

export function useApi<T>(fetcher: () => Promise<T | null>, deps: unknown[] = [], intervalMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      const result = await fetcher()
      setData(result)
      setError(result === null ? "Backend unreachable" : null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    refetch()
    if (intervalMs > 0) {
      const id = setInterval(refetch, intervalMs)
      return () => clearInterval(id)
    }
  }, [refetch, intervalMs])

  return { data, loading, error, refetch }
}

// ─── Fallback helpers ────────────────────────────────────────────

export function getRibbonFallback() { return mockRibbon }
export function getOperatorFallback() { return mockOperator }
export function getVariantsFallback() { return mockVariants }
export function getVisitorsFallback() { return mockVisitors }
export function getFunnelFallback() { return mockFunnel }
export function getReceiptsFallback() { return mockReceipts }
export function getEventsFallback() { return mockEvents }
export function getHealthFallback() { return mockHealth }
