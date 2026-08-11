/**
 * Agent Tool Registry
 *
 * Defines every API endpoint the voice agent can call as a "tool".
 * The agent receives this list as function definitions and can invoke
 * any combination of them to fulfill a user's request.
 *
 * Tools map 1:1 to the app's own API routes — the agent can do
 * anything the user can do through the UI.
 */

export interface ToolDef {
  name: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  /** Query parameter names (for GET) */
  queryParams?: string[];
  /** Body parameter names (for POST/PATCH/PUT) */
  bodyParams?: string[];
  /** Example body for the LLM to understand the shape */
  bodyExample?: Record<string, unknown>;
  /** Category for grouping in the prompt */
  category: string;
}

export const AGENT_TOOLS: ToolDef[] = [
  // ─── Navigation ──────────────────────────────────────────────
  {
    name: "navigate",
    description: "Navigate to a page in the application",
    method: "GET",
    path: "/navigate",
    queryParams: ["route"],
    category: "navigation",
  },

  // ─── Experiments & Outcomes ──────────────────────────────────
  {
    name: "list_assignments",
    description: "List hypothesis assignments for an employee. Returns active experiments the employee is running.",
    method: "GET",
    path: "/api/golden/assignments",
    queryParams: ["employeeId", "active"],
    category: "experiments",
  },
  {
    name: "list_hypotheses",
    description: "List all research hypotheses in the system with their anatomy (intervention, control, population, outcome).",
    method: "GET",
    path: "/api/golden/hypotheses",
    category: "experiments",
  },
  {
    name: "accept_assignment",
    description: "Accept a hypothesis assignment / mission. The employee agrees to run the experiment.",
    method: "PATCH",
    path: "/api/golden/assignments",
    bodyParams: ["action", "assignmentId"],
    bodyExample: { action: "accept", assignmentId: "asg_gilead_001" },
    category: "experiments",
  },
  {
    name: "reject_assignment",
    description: "Reject a hypothesis assignment with an optional note.",
    method: "PATCH",
    path: "/api/golden/assignments",
    bodyParams: ["action", "assignmentId", "note"],
    bodyExample: { action: "reject", assignmentId: "asg_gilead_001", note: "Not feasible this quarter" },
    category: "experiments",
  },
  {
    name: "record_outcome",
    description: "Record an experiment outcome. Runs attribution analysis and generates derivative hypotheses. Requires a description of what happened.",
    method: "POST",
    path: "/api/golden/outcomes",
    bodyParams: ["assignmentId", "successKind", "outcomeDescription", "metrics", "falsified", "falsificationEvidence", "useLLM"],
    bodyExample: {
      assignmentId: "asg_gilead_001",
      successKind: "performance",
      outcomeDescription: "Barrier resolved within 48h",
      metrics: [{ metric: "resolution_time", value: 36, unit: "hours", baseline: 120, higherIsBetter: false }],
      falsified: false,
      useLLM: true,
    },
    category: "experiments",
  },
  {
    name: "list_outcomes",
    description: "List recorded experiment outcomes, optionally filtered by employee or assignment.",
    method: "GET",
    path: "/api/golden/outcomes",
    queryParams: ["employeeId", "assignmentId"],
    category: "experiments",
  },
  {
    name: "generate_protocol",
    description: "Generate an experiment protocol using the LLM for a given hypothesis.",
    method: "POST",
    path: "/api/llm/infer",
    bodyParams: ["messages"],
    bodyExample: { messages: [{ role: "system", content: "Generate experiment protocol" }, { role: "user", content: "Hypothesis details" }] },
    category: "experiments",
  },

  // ─── Golden Nodes ────────────────────────────────────────────
  {
    name: "list_golden_nodes",
    description: "List all Golden Nodes — validated discoveries that have passed the admissibility gauntlet.",
    method: "GET",
    path: "/api/golden/golden-nodes",
    category: "golden",
  },
  {
    name: "assess_admissibility",
    description: "Run the admissibility assessment on all SPIN records. Returns which evidence tiers each record passes.",
    method: "GET",
    path: "/api/spinor/admissibility",
    category: "golden",
  },
  {
    name: "golden_overview",
    description: "Get the full Golden Engine overview — hypotheses, assignments, outcomes, attributions, derivatives, golden nodes.",
    method: "GET",
    path: "/api/golden",
    category: "golden",
  },

  // ─── Email / Mailbox ─────────────────────────────────────────
  {
    name: "gmail_config",
    description: "Check if Gmail OAuth is configured on the server.",
    method: "GET",
    path: "/api/gmail/config",
    category: "email",
  },
  {
    name: "gmail_search",
    description: "Search the connected Gmail mailbox for messages matching a query.",
    method: "POST",
    path: "/api/gmail/search",
    bodyParams: ["query", "maxResults"],
    bodyExample: { query: "from:gilead.com subject:barrier", maxResults: 10 },
    category: "email",
  },
  {
    name: "gmail_sync",
    description: "Sync Gmail messages into the local database for analysis.",
    method: "POST",
    path: "/api/gmail/sync",
    bodyParams: ["maxResults"],
    bodyExample: { maxResults: 50 },
    category: "email",
  },
  {
    name: "gmail_triage",
    description: "Run AI triage on the inbox — categorize emails by priority and action needed.",
    method: "POST",
    path: "/api/gmail/triage",
    category: "email",
  },
  {
    name: "gmail_followups",
    description: "Detect emails that need follow-up based on sent history and response patterns.",
    method: "POST",
    path: "/api/gmail/followups",
    category: "email",
  },
  {
    name: "microsoft_sync",
    description: "Sync Microsoft 365 / Outlook messages into the local database.",
    method: "POST",
    path: "/api/microsoft/sync",
    category: "email",
  },
  {
    name: "mailbox_status",
    description: "Get the current mailbox sync status — last sync, message count, processing state.",
    method: "GET",
    path: "/api/mailbox/status",
    category: "email",
  },
  {
    name: "email_credentials",
    description: "List connected email accounts (Gmail/Microsoft). Shows which mailboxes are linked.",
    method: "GET",
    path: "/api/email-credentials",
    category: "email",
  },
  {
    name: "connect_email",
    description: "Save email provider credentials (Gmail or Microsoft OAuth tokens) to the server-side store.",
    method: "POST",
    path: "/api/email-credentials",
    bodyParams: ["provider", "email", "refreshToken", "accessToken", "accessTokenExpiresAt"],
    bodyExample: { provider: "gmail", email: "user@gmail.com", refreshToken: "...", accessToken: "...", accessTokenExpiresAt: "2026-08-07T12:00:00Z" },
    category: "email",
  },

  // ─── Email Lab / Experiments ─────────────────────────────────
  {
    name: "email_engine_status",
    description: "Get the email experiment engine status — signals, hypotheses, experiments, outcomes.",
    method: "GET",
    path: "/api/spinor/email-engine",
    category: "email-lab",
  },
  {
    name: "run_email_experiment",
    description: "Create and send an email experiment. The engine generates a hypothesis-based email variant and sends it to the target.",
    method: "POST",
    path: "/api/spinor/email-engine",
    bodyParams: ["signal", "hypothesisId", "employeeId", "action"],
    bodyExample: { action: "send_experiment", signal: { to: "physician@example.com", subject: "Barrier resolution" }, hypothesisId: "hyp_001", employeeId: "gilead-rep-001" },
    category: "email-lab",
  },

  // ─── Competitive Intelligence ────────────────────────────────
  {
    name: "competitive_actions",
    description: "List competitive actions — what competitors are doing in the field.",
    method: "GET",
    path: "/api/competitive/actions",
    category: "competitive",
  },
  {
    name: "competitive_plan",
    description: "Get the competitive action plan — recommended counter-moves.",
    method: "GET",
    path: "/api/competitive/plan",
    category: "competitive",
  },
  {
    name: "competitive_score",
    description: "Get the competitive score — how the organization ranks vs competitors.",
    method: "GET",
    path: "/api/competitive/score",
    category: "competitive",
  },
  {
    name: "competitive_trajectory",
    description: "Get the competitive trajectory — trend over time.",
    method: "GET",
    path: "/api/competitive/trajectory",
    category: "competitive",
  },

  // ─── Frontrunner ─────────────────────────────────────────────
  {
    name: "frontrunner_opportunities",
    description: "List frontrunner opportunities — accounts ready for breakthrough action.",
    method: "GET",
    path: "/api/frontrunner/opportunities",
    category: "frontrunner",
  },
  {
    name: "frontrunner_workflows",
    description: "List active frontrunner workflows — breakthrough sequences in progress.",
    method: "GET",
    path: "/api/frontrunner/workflows",
    category: "frontrunner",
  },
  {
    name: "frontrunner_genomes",
    description: "List activity genomes — patterns of successful field actions.",
    method: "GET",
    path: "/api/frontrunner/genomes",
    category: "frontrunner",
  },

  // ─── SPIN Lifecycle ──────────────────────────────────────────
  {
    name: "spin_dashboard",
    description: "Get the SPIN dashboard — all SPIN records with their lifecycle state.",
    method: "GET",
    path: "/api/spin/dashboard",
    category: "spin",
  },
  {
    name: "spin_list",
    description: "List all SPIN records.",
    method: "GET",
    path: "/api/spin/spins",
    category: "spin",
  },
  {
    name: "spin_advance",
    description: "Advance a SPIN record to the next lifecycle state.",
    method: "POST",
    path: "/api/spin/advance",
    bodyParams: ["spinId"],
    bodyExample: { spinId: "SPIN-XYZ" },
    category: "spin",
  },

  // ─── SPINOR-RL ───────────────────────────────────────────────
  {
    name: "spinor_rl_state",
    description: "Get the current SPINOR-RL state — reinforcement learning trajectory and mission status.",
    method: "GET",
    path: "/api/spinor-rl/state",
    category: "spinor-rl",
  },
  {
    name: "spinor_rl_mission",
    description: "Get the current SPINOR-RL mission — what the agent is optimizing for.",
    method: "GET",
    path: "/api/spinor-rl/mission",
    category: "spinor-rl",
  },
  {
    name: "spinor_rl_trajectory",
    description: "Get the SPINOR-RL trajectory — reward history and learning curve.",
    method: "GET",
    path: "/api/spinor-rl/trajectory",
    category: "spinor-rl",
  },

  // ─── Strategies ──────────────────────────────────────────────
  {
    name: "list_strategies",
    description: "List all strategy genomes — evolved field strategies with their performance.",
    method: "GET",
    path: "/api/strategies",
    category: "strategies",
  },
  {
    name: "strategy_portfolio",
    description: "Get the strategy portfolio — which strategies are assigned to which employees.",
    method: "GET",
    path: "/api/strategies/portfolio",
    category: "strategies",
  },
  {
    name: "strategy_marketplace",
    description: "Get the strategy marketplace — available strategies for adoption.",
    method: "GET",
    path: "/api/strategies/marketplace",
    category: "strategies",
  },

  // ─── Phone / Territory ───────────────────────────────────────
  {
    name: "phone_records",
    description: "List phone call records — telemetry from field calls.",
    method: "GET",
    path: "/api/phones/records",
    category: "field",
  },
  {
    name: "territory_accounts",
    description: "List territory accounts — physician accounts with priority scoring.",
    method: "GET",
    path: "/api/territory/accounts",
    category: "field",
  },
  {
    name: "territory_routes",
    description: "List field routes — optimized call sequences for field reps.",
    method: "GET",
    path: "/api/territory/routes",
    category: "field",
  },

  // ─── CRM Sync ────────────────────────────────────────────────
  {
    name: "crm_status",
    description: "Get CRM sync status — pending syncs to Veeva/Salesforce.",
    method: "GET",
    path: "/api/crm",
    category: "crm",
  },
  {
    name: "crm_sync",
    description: "Enqueue or process CRM sync operations for experiments and outcomes.",
    method: "POST",
    path: "/api/crm",
    bodyParams: ["action", "entityType", "entityId"],
    bodyExample: { action: "enqueue", entityType: "experiment", entityId: "exp_001" },
    category: "crm",
  },

  // ─── Commitments ─────────────────────────────────────────────
  {
    name: "list_commitments",
    description: "List commitment contracts — promises made to accounts with tracking.",
    method: "GET",
    path: "/api/commitments",
    category: "commitments",
  },
  {
    name: "detect_commitments",
    description: "Scan emails for commitment signals — detect promises made in correspondence.",
    method: "POST",
    path: "/api/commitments/detect",
    category: "commitments",
  },
  {
    name: "execute_commitment",
    description: "Execute a commitment action — fulfill a promise made to an account.",
    method: "POST",
    path: "/api/commitments/execute",
    bodyParams: ["commitmentId"],
    bodyExample: { commitmentId: "cmt_001" },
    category: "commitments",
  },

  // ─── Voice / Diary ───────────────────────────────────────────
  {
    name: "voice_diary",
    description: "Get the voice diary — recorded voice sessions and their extracted insights.",
    method: "GET",
    path: "/api/voice/diary",
    category: "voice",
  },
  {
    name: "voice_capabilities",
    description: "Get available voice capabilities — what the voice layer can do.",
    method: "GET",
    path: "/api/voice/capabilities",
    category: "voice",
  },
  {
    name: "voice_sessions",
    description: "List voice sessions — active and completed recording sessions.",
    method: "GET",
    path: "/api/voice/sessions",
    category: "voice",
  },

  // ─── Telemetry & System ──────────────────────────────────────
  {
    name: "telemetry",
    description: "Get system telemetry — metrics, events, and operational data.",
    method: "GET",
    path: "/api/telemetry",
    category: "system",
  },
  {
    name: "system_audit",
    description: "Get the system audit log — who did what and when.",
    method: "GET",
    path: "/api/system/audit",
    category: "system",
  },
  {
    name: "health",
    description: "Check system health — all subsystems status.",
    method: "GET",
    path: "/api/health",
    category: "system",
  },
  {
    name: "llm_fallback_status",
    description: "Check the LLM fallback chain status — which providers are available.",
    method: "GET",
    path: "/api/llm/fallback-status",
    category: "system",
  },

  // ─── Workteleport ────────────────────────────────────────────
  {
    name: "workteleport_taxonomy",
    description: "Get the workteleport taxonomy — skill and venture classification.",
    method: "GET",
    path: "/api/workteleport/taxonomy",
    category: "workteleport",
  },
  {
    name: "workteleport_skills",
    description: "List workteleport skills — available capabilities for deployment.",
    method: "GET",
    path: "/api/workteleport/skills",
    category: "workteleport",
  },

  // ─── Self-Redeployment ──────────────────────────────────────
  {
    name: "redeploy_app",
    description: "Trigger a Vercel redeployment of this application. Use when the user asks to redeploy, rebuild, or push changes live.",
    method: "POST",
    path: "/api/system/redeploy",
    bodyParams: ["target", "ref"],
    bodyExample: { target: "production", ref: "main" },
    category: "system",
  },
  {
    name: "deployment_status",
    description: "Check the status of a Vercel deployment by its ID. Returns whether the deployment is ready, building, or errored.",
    method: "GET",
    path: "/api/system/redeploy",
    queryParams: ["deploymentId"],
    category: "system",
  },

  // ─── Inbox Intelligence ─────────────────────────────────────
  {
    name: "inbox_attachments",
    description: "Get all attachments across all emails, or a specific email's attachment detail. Pass emailId and attachmentIndex for specific attachment data.",
    method: "GET",
    path: "/api/inbox/attachments",
    queryParams: ["emailId", "attachmentIndex"],
    category: "email",
  },
  {
    name: "inbox_analyze",
    description: "Run LLM-powered analysis on the inbox to surface research signals, commitments, and hypothesis-relevant evidence.",
    method: "POST",
    path: "/api/llm/infer",
    bodyParams: ["messages", "temperature", "max_tokens"],
    bodyExample: { messages: [{ role: "system", content: "Analyze inbox" }, { role: "user", content: "Surface signals" }], temperature: 0.4, max_tokens: 2048 },
    category: "email",
  },

  // ─── KOL Intelligence ───────────────────────────────────────
  {
    name: "kol_profiles",
    description: "List KOL (Key Opinion Leader) profiles with influence scores, sentiment, and engagement data.",
    method: "GET",
    path: "/api/kol/profiles",
    queryParams: ["orgId"],
    category: "kol",
  },

  // ─── Sheets / Export ─────────────────────────────────────────
  {
    name: "sheets_export",
    description: "Export data to a spreadsheet format — experiments, outcomes, or telemetry.",
    method: "GET",
    path: "/api/sheets/export",
    queryParams: ["type"],
    category: "export",
  },
];

/**
 * Build the tool definitions for the LLM prompt.
 * Returns a compact string listing all tools with their parameters.
 */
export function buildToolPrompt(): string {
  const categories = [...new Set(AGENT_TOOLS.map((t) => t.category))];
  const lines: string[] = [];

  for (const cat of categories) {
    lines.push(`\n### ${cat.toUpperCase()}`);
    const tools = AGENT_TOOLS.filter((t) => t.category === cat);
    for (const tool of tools) {
      const params = [
        ...(tool.queryParams || []).map((p) => `${p}?`),
        ...(tool.bodyParams || []).map((p) => p),
      ].join(", ");
      lines.push(`- ${tool.name} (${tool.method} ${tool.path}): ${tool.description}${params ? ` [params: ${params}]` : ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Find a tool by name.
 */
export function findTool(name: string): ToolDef | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}
