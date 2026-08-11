/**
 * SQLite persistence layer for Advantage Foundry.
 *
 * Replaces the JSON file storage with a proper database that supports
 * transactions, concurrent access, multi-tenant isolation, and queries.
 * Uses better-sqlite3 (synchronous, native, fast).
 *
 * Schema:
 *   - organizations: multi-tenant root
 *   - users: org-scoped users with roles
 *   - sessions: auth sessions with expiry
 *   - kv_store: per-org key-value JSON store (backwards-compatible with
 *     the existing loadGoldenArray/saveGoldenArray interface)
 *
 * The database file lives at data/foundry.db (persistent on Fly.io volumes).
 * Falls back to tmpdir if the data directory is not writable.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings: string; // JSON
  created_at: string;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: string; // admin | director | field_rep | viewer
  therapeutic_area: string | null;
  password_hash?: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  org_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

// ─── Database initialization ──────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");

function resolveDbPath(): string {
  // Prefer persistent data directory (Fly.io volume mount)
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    // Test write permission
    const testFile = join(DATA_DIR, ".write-test");
    require("fs").writeFileSync(testFile, "1");
    require("fs").unlinkSync(testFile);
    return join(DATA_DIR, "foundry.db");
  } catch {
    // Fallback to tmpdir (serverless / read-only filesystem)
    return join(tmpdir(), "foundry.db");
  }
}

const DB_PATH = process.env.FOUNDRY_DB_PATH || resolveDbPath();

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");

  initSchema(_db);
  migrateSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,
      settings    TEXT DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email             TEXT NOT NULL,
      name              TEXT NOT NULL,
      role              TEXT NOT NULL DEFAULT 'field_rep',
      therapeutic_area  TEXT,
      password_hash     TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, email)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      token       TEXT UNIQUE NOT NULL,
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

    CREATE TABLE IF NOT EXISTS voice_sessions (
      session_id    TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state         TEXT NOT NULL,
      payload       TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_voice_sessions_state ON voice_sessions(state);
    CREATE INDEX IF NOT EXISTS idx_voice_sessions_expires ON voice_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS kv_store (
      org_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (org_id, key)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id     TEXT,
      action      TEXT NOT NULL,
      entity_type TEXT,
      entity_id   TEXT,
      detail      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

    -- Email provider OAuth tokens (server-side credential store)
    -- Stores encrypted refresh/access tokens so the server can send
    -- experiment emails independently of the browser session.
    CREATE TABLE IF NOT EXISTS email_credentials (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL,             -- 'gmail' | 'microsoft'
      email           TEXT NOT NULL,             -- mailbox address
      refresh_token   TEXT NOT NULL,             -- encrypted
      access_token    TEXT,                      -- encrypted (cached, may be empty)
      access_expires_at TEXT,                    -- ISO timestamp
      metadata        TEXT DEFAULT '{}',         -- JSON: clientId, tenantId, scopes, etc.
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, user_id, provider, email)
    );
    CREATE INDEX IF NOT EXISTS idx_email_creds_org ON email_credentials(org_id);
    CREATE INDEX IF NOT EXISTS idx_email_creds_user ON email_credentials(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_email_creds_provider ON email_credentials(org_id, provider);

    -- ════════════════════════════════════════════════════════════════
    -- PHONE TELEMETRY tables
    -- ════════════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS phone_records (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone_number  TEXT NOT NULL,
      label         TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, user_id, phone_number)
    );
    CREATE INDEX IF NOT EXISTS idx_phone_records_user ON phone_records(org_id, user_id);

    CREATE TABLE IF NOT EXISTS phone_events (
      id            TEXT PRIMARY KEY,
      phone_id      TEXT NOT NULL REFERENCES phone_records(id) ON DELETE CASCADE,
      timestamp     TEXT NOT NULL,
      type          TEXT NOT NULL,   -- call|sms|mms|data|status|alert|custom
      direction     TEXT NOT NULL,   -- inbound|outbound
      duration_sec  INTEGER,
      metadata      TEXT DEFAULT '{}',
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_phone_events_phone ON phone_events(phone_id);
    CREATE INDEX IF NOT EXISTS idx_phone_events_ts ON phone_events(timestamp);

    -- ════════════════════════════════════════════════════════════════
    -- TERRITORY tables
    -- ════════════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS territory_accounts (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_name  TEXT NOT NULL,
      hcp_name      TEXT,
      specialty     TEXT,
      territory     TEXT,
      funnel_state  TEXT NOT NULL DEFAULT 'awareness',
      autonomy_class INTEGER NOT NULL DEFAULT 1,
      last_visit    TEXT,
      last_interaction TEXT,
      barriers      TEXT DEFAULT '[]',     -- JSON array
      metadata      TEXT DEFAULT '{}',     -- JSON
      priority_score REAL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, user_id, account_name)
    );
    CREATE INDEX IF NOT EXISTS idx_territory_user ON territory_accounts(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_territory_funnel ON territory_accounts(funnel_state);

    CREATE TABLE IF NOT EXISTS field_routes (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date          TEXT NOT NULL,
      stops         TEXT NOT NULL DEFAULT '[]',  -- JSON array of {accountId, order, plannedTime}
      status        TEXT NOT NULL DEFAULT 'planned', -- planned|active|completed
      metadata      TEXT DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_field_routes_user ON field_routes(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_field_routes_date ON field_routes(date);

    -- ════════════════════════════════════════════════════════════════
    -- CRM SYNC tables
    -- ════════════════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS crm_sync_queue (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider      TEXT NOT NULL,             -- 'veeva' | 'salesforce'
      entity_type   TEXT NOT NULL,             -- 'experiment' | 'outcome' | etc.
      entity_id     TEXT NOT NULL,
      external_id   TEXT,                      -- CRM record ID after sync
      status        TEXT NOT NULL DEFAULT 'pending', -- pending|synced|failed|skipped
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      last_synced_at TEXT,
      payload       TEXT NOT NULL DEFAULT '{}',
      response      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, provider, entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_crm_sync_org ON crm_sync_queue(org_id);
    CREATE INDEX IF NOT EXISTS idx_crm_sync_status ON crm_sync_queue(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_crm_sync_entity ON crm_sync_queue(entity_type, entity_id);

    -- ════════════════════════════════════════════════════════════════
    -- WORKTELEPORT-RL tables
    -- ════════════════════════════════════════════════════════════════

    -- Evidence Envelopes: universal input layer
    CREATE TABLE IF NOT EXISTS evidence_envelopes (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source          TEXT NOT NULL,
      source_identifier TEXT NOT NULL,
      sender          TEXT NOT NULL,
      recipient       TEXT NOT NULL,
      received_at     TEXT NOT NULL,
      original_content TEXT NOT NULL,
      content_hash    TEXT NOT NULL,
      attachments     TEXT DEFAULT '[]',
      extracted_entities TEXT DEFAULT '[]',
      factual_claims  TEXT DEFAULT '[]',
      requested_work  TEXT,
      deadlines       TEXT DEFAULT '[]',
      confidentiality_class TEXT NOT NULL DEFAULT 'internal',
      permitted_uses  TEXT DEFAULT '[]',
      retention_rule  TEXT NOT NULL DEFAULT '30d',
      llm_interpretation TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_org ON evidence_envelopes(org_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_user ON evidence_envelopes(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence_envelopes(source, source_identifier);

    -- ClientContinuity records: identity, relationship, authority
    CREATE TABLE IF NOT EXISTS client_continuity (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      person_id       TEXT NOT NULL,
      person_name     TEXT NOT NULL,
      relationship    TEXT NOT NULL,
      authority_level TEXT NOT NULL DEFAULT 'none',
      communication_history TEXT DEFAULT '[]',
      active_commitments TEXT DEFAULT '[]',
      escalation_boundaries TEXT DEFAULT '[]',
      preferred_speaker TEXT NOT NULL DEFAULT 'human',
      last_interaction_at TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(org_id, person_id)
    );
    CREATE INDEX IF NOT EXISTS idx_continuity_org ON client_continuity(org_id);

    -- Task IRs: machine-readable task intermediate representation
    CREATE TABLE IF NOT EXISTS task_irs (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      evidence_envelope_id TEXT REFERENCES evidence_envelopes(id) ON DELETE CASCADE,
      parent_task_id  TEXT REFERENCES task_irs(id) ON DELETE CASCADE,
      objective       TEXT NOT NULL,
      task_type       TEXT NOT NULL,
      inputs          TEXT NOT NULL DEFAULT '[]',
      required_outputs TEXT NOT NULL DEFAULT '[]',
      constraints     TEXT NOT NULL DEFAULT '[]',
      dependencies    TEXT NOT NULL DEFAULT '[]',
      evidence_requirements TEXT NOT NULL DEFAULT '[]',
      permitted_tools TEXT NOT NULL DEFAULT '[]',
      approval_boundary TEXT NOT NULL DEFAULT '{}',
      failure_conditions TEXT NOT NULL DEFAULT '[]',
      completion_tests TEXT NOT NULL DEFAULT '[]',
      rollback_plan   TEXT NOT NULL DEFAULT '[]',
      status          TEXT NOT NULL DEFAULT 'drafted',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      authorized_at   TEXT,
      executed_at     TEXT,
      completed_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_taskir_org ON task_irs(org_id);
    CREATE INDEX IF NOT EXISTS idx_taskir_user ON task_irs(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_taskir_status ON task_irs(status);

    -- Capability declarations: constrained tool permissions
    CREATE TABLE IF NOT EXISTS capabilities (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      category        TEXT NOT NULL,
      description     TEXT NOT NULL,
      execution_method TEXT NOT NULL,
      can_read        TEXT DEFAULT '[]',
      can_create      TEXT DEFAULT '[]',
      can_modify      TEXT DEFAULT '[]',
      can_delete      TEXT DEFAULT '[]',
      permitted_roles TEXT DEFAULT '[]',
      permitted_users TEXT DEFAULT '[]',
      permitted_data_classes TEXT DEFAULT '[]',
      required_approvals TEXT DEFAULT '[]',
      reversible      INTEGER NOT NULL DEFAULT 1,
      validation_tests TEXT DEFAULT '[]',
      monetary_threshold REAL,
      segregation_conflicts TEXT DEFAULT '[]',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_capability_org ON capabilities(org_id);
    CREATE INDEX IF NOT EXISTS idx_capability_category ON capabilities(org_id, category);

    -- Workflows: durable execution runtime
    CREATE TABLE IF NOT EXISTS workflows (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_ir_id      TEXT NOT NULL REFERENCES task_irs(id) ON DELETE CASCADE,
      state           TEXT NOT NULL DEFAULT 'pending',
      steps           TEXT NOT NULL DEFAULT '[]',
      idempotency_key TEXT NOT NULL,
      checkpointed_state TEXT DEFAULT '{}',
      retry_count     INTEGER NOT NULL DEFAULT 0,
      max_retries     INTEGER NOT NULL DEFAULT 3,
      deadline        TEXT NOT NULL,
      failure_classification TEXT,
      started_at      TEXT,
      completed_at    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_org ON workflows(org_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_user ON workflows(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_state ON workflows(state);
    CREATE INDEX IF NOT EXISTS idx_workflow_idempotency ON workflows(idempotency_key);

    -- Commit records: pre-action verification gate
    CREATE TABLE IF NOT EXISTS commit_records (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      step_id         TEXT NOT NULL,
      authorization_valid INTEGER NOT NULL,
      target_unchanged INTEGER NOT NULL,
      data_unchanged  INTEGER NOT NULL,
      within_policy   INTEGER NOT NULL,
      human_approval_current INTEGER NOT NULL,
      output_validated INTEGER NOT NULL,
      action_type     TEXT NOT NULL,
      action_target   TEXT NOT NULL,
      action_payload  TEXT NOT NULL,
      committed       INTEGER NOT NULL,
      committed_at    TEXT NOT NULL,
      rollback_possible INTEGER NOT NULL,
      evidence_envelope_id TEXT,
      receipt_hash    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commit_org ON commit_records(org_id);
    CREATE INDEX IF NOT EXISTS idx_commit_workflow ON commit_records(workflow_id);

    -- Skill Genomes: reusable executable representations
    CREATE TABLE IF NOT EXISTS skill_genomes (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL,
      trigger         TEXT NOT NULL,
      input_schema    TEXT DEFAULT '{}',
      task_ir_template TEXT DEFAULT '{}',
      tool_requirements TEXT DEFAULT '[]',
      authorization_requirements TEXT DEFAULT '[]',
      execution_dag  TEXT DEFAULT '[]',
      validation_tests TEXT DEFAULT '[]',
      known_failure_modes TEXT DEFAULT '[]',
      human_checkpoints TEXT DEFAULT '[]',
      output_schema   TEXT DEFAULT '{}',
      performance_history TEXT DEFAULT '[]',
      experiment_history TEXT DEFAULT '[]',
      model_contribution TEXT DEFAULT '',
      human_contribution TEXT DEFAULT '',
      version         INTEGER NOT NULL DEFAULT 1,
      parent_skill_id TEXT REFERENCES skill_genomes(id) ON DELETE SET NULL,
      maturity        TEXT NOT NULL DEFAULT 'first_occurrence',
      usage_count     INTEGER NOT NULL DEFAULT 0,
      last_used_at    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skill_org ON skill_genomes(org_id);
    CREATE INDEX IF NOT EXISTS idx_skill_maturity ON skill_genomes(org_id, maturity);
    CREATE INDEX IF NOT EXISTS idx_skill_trigger ON skill_genomes(org_id, name);

    -- Experiment Twins: experimental counterparts to workflows
    CREATE TABLE IF NOT EXISTS experiment_twins (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      skill_genome_id TEXT REFERENCES skill_genomes(id) ON DELETE SET NULL,
      research_question TEXT NOT NULL,
      hypothesis      TEXT NOT NULL,
      permutation_type TEXT NOT NULL,
      permutation_description TEXT NOT NULL,
      control_workflow_id TEXT NOT NULL,
      experimental_workflow_id TEXT,
      success_metrics TEXT NOT NULL DEFAULT '[]',
      status          TEXT NOT NULL DEFAULT 'proposed',
      result          TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_twin_org ON experiment_twins(org_id);
    CREATE INDEX IF NOT EXISTS idx_twin_status ON experiment_twins(org_id, status);

    -- Venture Capsules: Golden Nodes → business channels
    CREATE TABLE IF NOT EXISTS venture_capsules (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      golden_node_id  TEXT,
      skill_genome_id TEXT REFERENCES skill_genomes(id) ON DELETE SET NULL,
      name            TEXT NOT NULL,
      problem_solved  TEXT NOT NULL,
      target_users    TEXT DEFAULT '[]',
      triggering_evidence TEXT DEFAULT '[]',
      validated_workflow_id TEXT,
      required_integrations TEXT DEFAULT '[]',
      compliance_requirements TEXT DEFAULT '[]',
      outcome_evidence TEXT DEFAULT '[]',
      replication_evidence TEXT DEFAULT '[]',
      unit_economics  TEXT DEFAULT '{}',
      market_alternatives TEXT DEFAULT '[]',
      deployment_package TEXT DEFAULT '{}',
      ownership_lineage TEXT DEFAULT '[]',
      commercialization_hypothesis TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'identified',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_venture_org ON venture_capsules(org_id);
    CREATE INDEX IF NOT EXISTS idx_venture_status ON venture_capsules(org_id, status);

    -- Palindrome chains: forward + reverse evidence
    CREATE TABLE IF NOT EXISTS palindrome_chains (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      stages          TEXT NOT NULL DEFAULT '[]',
      completed_forward INTEGER NOT NULL DEFAULT 0,
      completed_reverse INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_palindrome_org ON palindrome_chains(org_id);

    -- Dissected hypotheses: Dissect-Demoronify-Research-NoveltyMagnify
    CREATE TABLE IF NOT EXISTS dissected_hypotheses (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      original_claim  TEXT NOT NULL,
      population      TEXT,
      intervention    TEXT,
      comparison      TEXT,
      outcome         TEXT,
      timing          TEXT,
      mechanism       TEXT,
      risk            TEXT,
      demoronified_claim TEXT NOT NULL,
      research_status TEXT NOT NULL DEFAULT 'untested',
      research_summary TEXT DEFAULT '',
      novel_component TEXT,
      novelty_type    TEXT,
      experiment_design TEXT,
      replication_plan TEXT,
      capitalization_plan TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dissect_org ON dissected_hypotheses(org_id);

    -- Game action records
    CREATE TABLE IF NOT EXISTS game_actions (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action          TEXT NOT NULL,
      target_id       TEXT NOT NULL,
      target_type     TEXT NOT NULL,
      evidence_envelope_id TEXT,
      reward          REAL NOT NULL DEFAULT 0,
      notes           TEXT DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_game_org ON game_actions(org_id);
    CREATE INDEX IF NOT EXISTS idx_game_user ON game_actions(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_game_action ON game_actions(org_id, action);

    -- Voice diary entries (migrated from ephemeral JSON to persistent SQLite)
    CREATE TABLE IF NOT EXISTS diary_entries (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id      TEXT NOT NULL,
      segment_id      TEXT NOT NULL,
      date            TEXT NOT NULL,
      timestamp       TEXT NOT NULL,
      text            TEXT NOT NULL,
      entry_type      TEXT NOT NULL DEFAULT 'uncategorized',
      tags            TEXT DEFAULT '[]',
      pipeline_links  TEXT DEFAULT '[]',
      extracted_entities TEXT DEFAULT '{}',
      audio_url       TEXT,
      processed       INTEGER NOT NULL DEFAULT 0,
      processed_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_diary_org ON diary_entries(org_id);
    CREATE INDEX IF NOT EXISTS idx_diary_user ON diary_entries(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_diary_date ON diary_entries(org_id, user_id, date);
    CREATE INDEX IF NOT EXISTS idx_diary_unprocessed ON diary_entries(org_id, user_id, processed);

    -- ════════════════════════════════════════════════════════════════
    -- SPINOR FRONTRUNNER tables
    -- ════════════════════════════════════════════════════════════════

    -- Opportunity Almanac: time-sensitive market signals from real research
    CREATE TABLE IF NOT EXISTS almanac_opportunities (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL,
      category        TEXT NOT NULL,
      source_type     TEXT NOT NULL,
      source_urls     TEXT DEFAULT '[]',
      evidence        TEXT DEFAULT '[]',
      gap_description TEXT NOT NULL,
      target_users    TEXT DEFAULT '[]',
      market_signals  TEXT DEFAULT '[]',
      novelty_delta   TEXT,
      epoch           TEXT NOT NULL,
      score           REAL NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'discovered',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_almanac_org ON almanac_opportunities(org_id);
    CREATE INDEX IF NOT EXISTS idx_almanac_status ON almanac_opportunities(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_almanac_epoch ON almanac_opportunities(org_id, epoch);
    CREATE INDEX IF NOT EXISTS idx_almanac_score ON almanac_opportunities(org_id, score DESC);

    -- Prompt Encyclopedia: stable reusable knowledge
    CREATE TABLE IF NOT EXISTS encyclopedia_entries (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      entry_type      TEXT NOT NULL,
      title           TEXT NOT NULL,
      content         TEXT NOT NULL,
      tags            TEXT DEFAULT '[]',
      "references"    TEXT DEFAULT '[]',
      version         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_encyclopedia_org ON encyclopedia_entries(org_id);
    CREATE INDEX IF NOT EXISTS idx_encyclopedia_type ON encyclopedia_entries(org_id, entry_type);

    -- Product Genomes: complete versioned product definitions
    CREATE TABLE IF NOT EXISTS product_genomes (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      opportunity_id  TEXT REFERENCES almanac_opportunities(id) ON DELETE SET NULL,
      parent_genome_id TEXT REFERENCES product_genomes(id) ON DELETE SET NULL,
      name            TEXT NOT NULL,
      problem         TEXT NOT NULL,
      eligible_users  TEXT DEFAULT '[]',
      existing_alternatives TEXT DEFAULT '[]',
      unresolved_need TEXT NOT NULL,
      prior_art_boundary TEXT NOT NULL,
      novelty_delta   TEXT NOT NULL,
      required_functionality TEXT DEFAULT '[]',
      system_architecture TEXT DEFAULT '{}',
      data_model      TEXT DEFAULT '{}',
      external_integrations TEXT DEFAULT '[]',
      auth_permissions TEXT DEFAULT '{}',
      compliance_conditions TEXT DEFAULT '[]',
      failure_rollback TEXT DEFAULT '[]',
      testing_requirements TEXT DEFAULT '[]',
      deployment_target TEXT,
      pricing_hypothesis TEXT DEFAULT '{}',
      distribution_method TEXT,
      marketing_assets TEXT DEFAULT '{}',
      measurable_value TEXT,
      cost_avoided    TEXT,
      evidence_required TEXT DEFAULT '[]',
      completeness_score REAL NOT NULL DEFAULT 0,
      completeness_checks TEXT DEFAULT '{}',
      fitness_score   REAL NOT NULL DEFAULT 0,
      branch_type     TEXT NOT NULL DEFAULT 'primary',
      status          TEXT NOT NULL DEFAULT 'draft',
      version         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_genome_org ON product_genomes(org_id);
    CREATE INDEX IF NOT EXISTS idx_genome_user ON product_genomes(org_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_genome_status ON product_genomes(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_genome_fitness ON product_genomes(org_id, fitness_score DESC);
    CREATE INDEX IF NOT EXISTS idx_genome_opportunity ON product_genomes(opportunity_id);

    -- Workflow Genomes: Top 100 ranked reusable workflows
    CREATE TABLE IF NOT EXISTS workflow_genomes (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_genome_id TEXT REFERENCES product_genomes(id) ON DELETE SET NULL,
      parent_workflow_id TEXT REFERENCES workflow_genomes(id) ON DELETE SET NULL,
      name            TEXT NOT NULL,
      trigger         TEXT NOT NULL,
      required_context TEXT DEFAULT '[]',
      research_process TEXT DEFAULT '[]',
      reasoning_procedure TEXT DEFAULT '[]',
      tools_integrations TEXT DEFAULT '[]',
      execution_stages TEXT DEFAULT '[]',
      validation_criteria TEXT DEFAULT '[]',
      failure_conditions TEXT DEFAULT '[]',
      recovery_behavior TEXT DEFAULT '[]',
      human_approval_points TEXT DEFAULT '[]',
      expected_business_value TEXT,
      estimated_cost_avoided TEXT,
      expected_time_saved TEXT,
      reusable_outputs TEXT DEFAULT '[]',
      version         INTEGER NOT NULL DEFAULT 1,
      -- Fitness signals (evidence-based, not novelty-based)
      completion_rate REAL DEFAULT 0,
      output_quality  REAL DEFAULT 0,
      user_adoption   INTEGER DEFAULT 0,
      time_saved_hours REAL DEFAULT 0,
      revenue_generated REAL DEFAULT 0,
      cost_avoided_value REAL DEFAULT 0,
      reliability     REAL DEFAULT 0,
      reusability     REAL DEFAULT 0,
      compliance_burden REAL DEFAULT 0,
      distribution_potential REAL DEFAULT 0,
      user_retention  REAL DEFAULT 0,
      maintenance_cost REAL DEFAULT 0,
      evidence_strength REAL DEFAULT 0,
      defensibility   REAL DEFAULT 0,
      fitness_score   REAL NOT NULL DEFAULT 0,
      rank            INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'candidate',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_genome_org ON workflow_genomes(org_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_genome_status ON workflow_genomes(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_workflow_genome_rank ON workflow_genomes(org_id, rank);
    CREATE INDEX IF NOT EXISTS idx_workflow_genome_fitness ON workflow_genomes(org_id, fitness_score DESC);

    -- Choice Gravity: user answers that reweight the portfolio
    CREATE TABLE IF NOT EXISTS choice_gravity_answers (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id     TEXT NOT NULL,
      question_text   TEXT NOT NULL,
      answer          TEXT NOT NULL,
      weight_changes  TEXT DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gravity_org ON choice_gravity_answers(org_id);
    CREATE INDEX IF NOT EXISTS idx_gravity_user ON choice_gravity_answers(org_id, user_id);

    -- Epoch records: each evolutionary cycle
    CREATE TABLE IF NOT EXISTS frontrunner_epochs (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      epoch_number    INTEGER NOT NULL,
      opportunities_scanned INTEGER DEFAULT 0,
      candidates_generated INTEGER DEFAULT 0,
      variants_generated INTEGER DEFAULT 0,
      variants_eliminated INTEGER DEFAULT 0,
      winners_promoted INTEGER DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'running',
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_epoch_org ON frontrunner_epochs(org_id);
    CREATE INDEX IF NOT EXISTS idx_epoch_status ON frontrunner_epochs(org_id, status);

    -- ─── SPIN records (migrated from JSON file) ───────────────────
    CREATE TABLE IF NOT EXISTS spin_records (
      spin_id          TEXT PRIMARY KEY,
      hypothesis_id    TEXT,
      employee_owner   TEXT,
      state            TEXT NOT NULL DEFAULT 'draft',
      prior_art        TEXT DEFAULT '{}',
      contributions    TEXT DEFAULT '[]',
      modifications    TEXT DEFAULT '[]',
      experiment_ids   TEXT DEFAULT '[]',
      mission_ids      TEXT DEFAULT '[]',
      claim_ids        TEXT DEFAULT '[]',
      strategy_id      TEXT,
      golden_node_id   TEXT,
      replication_count INTEGER DEFAULT 0,
      replication_territories TEXT DEFAULT '[]',
      reverse_test     TEXT,
      automation_status TEXT DEFAULT '{}',
      evidence_tier    TEXT DEFAULT 'observation',
      snapshots        TEXT DEFAULT '[]',
      metadata         TEXT DEFAULT '{}',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spin_state ON spin_records(state);
    CREATE INDEX IF NOT EXISTS idx_spin_employee ON spin_records(employee_owner);
    CREATE INDEX IF NOT EXISTS idx_spin_hypothesis ON spin_records(hypothesis_id);

    CREATE TABLE IF NOT EXISTS spin_claims (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      spin_id          TEXT NOT NULL REFERENCES spin_records(spin_id) ON DELETE CASCADE,
      claim_id         TEXT NOT NULL,
      claim_data       TEXT NOT NULL,
      UNIQUE(spin_id, claim_id)
    );
    CREATE INDEX IF NOT EXISTS idx_spin_claims_spin ON spin_claims(spin_id);

    -- ─── Gauntlet runs (persisted, not ephemeral) ─────────────────
    CREATE TABLE IF NOT EXISTS gauntlet_runs (
      run_id           TEXT PRIMARY KEY,
      hypothesis_id    TEXT NOT NULL,
      spin_id          TEXT,
      org_id           TEXT NOT NULL DEFAULT 'foundry',
      stages           TEXT NOT NULL DEFAULT '[]',
      dissected_claim  TEXT,
      evidence_integrity TEXT,
      confounders      TEXT DEFAULT '[]',
      design           TEXT,
      causal_reveal    TEXT,
      current_stage    TEXT NOT NULL DEFAULT 'claim_dissection',
      complete         INTEGER NOT NULL DEFAULT 0,
      outcome_id       TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gauntlet_hypothesis ON gauntlet_runs(hypothesis_id);
    CREATE INDEX IF NOT EXISTS idx_gauntlet_outcome ON gauntlet_runs(outcome_id);
    CREATE INDEX IF NOT EXISTS idx_gauntlet_complete ON gauntlet_runs(complete);

    -- ─── LLM inference receipts (prompt/version provenance) ───────
    CREATE TABLE IF NOT EXISTS llm_receipts (
      id               TEXT PRIMARY KEY,
      org_id           TEXT NOT NULL DEFAULT 'foundry',
      user_id          TEXT,
      endpoint         TEXT,
      model            TEXT NOT NULL,
      prompt_hash      TEXT NOT NULL,
      prompt_summary   TEXT,
      messages_count   INTEGER NOT NULL DEFAULT 0,
      max_tokens       INTEGER,
      temperature      REAL,
      response_hash    TEXT,
      response_tokens  INTEGER,
      latency_ms       INTEGER,
      success          INTEGER NOT NULL DEFAULT 0,
      error_message    TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_llm_receipts_org ON llm_receipts(org_id);
    CREATE INDEX IF NOT EXISTS idx_llm_receipts_model ON llm_receipts(model);
    CREATE INDEX IF NOT EXISTS idx_llm_receipts_hash ON llm_receipts(prompt_hash);

    -- ─── Governed Experiments (durable, versioned execution layer) ──
    CREATE TABLE IF NOT EXISTS governed_experiments (
      id              TEXT PRIMARY KEY,
      org_id          TEXT NOT NULL DEFAULT 'foundry',
      hypothesis_id   TEXT,
      hypothesis_version INTEGER NOT NULL DEFAULT 1,
      spin_id         TEXT,
      spin_version    INTEGER,
      owner           TEXT NOT NULL,
      assigned_participant TEXT,
      experiment_state TEXT NOT NULL DEFAULT 'draft',
      compliance_state TEXT NOT NULL DEFAULT 'draft',
      evidence_class  TEXT NOT NULL DEFAULT 'internal_signal',
      observation_window_days INTEGER NOT NULL DEFAULT 14,
      parent_experiment_id TEXT,
      derivative_ids  TEXT DEFAULT '[]',
      replication_of_id TEXT,
      version         INTEGER NOT NULL DEFAULT 1,
      previous_version_id TEXT,
      experiment_data TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_approved_at TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_govexp_org ON governed_experiments(org_id);
    CREATE INDEX IF NOT EXISTS idx_govexp_state ON governed_experiments(experiment_state);
    CREATE INDEX IF NOT EXISTS idx_govexp_owner ON governed_experiments(owner);
    CREATE INDEX IF NOT EXISTS idx_govexp_parent ON governed_experiments(parent_experiment_id);

    CREATE TABLE IF NOT EXISTS governed_experiment_events (
      event_id        TEXT PRIMARY KEY,
      experiment_id   TEXT NOT NULL,
      org_id          TEXT NOT NULL DEFAULT 'foundry',
      actor           TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'api',
      previous_event_hash TEXT NOT NULL DEFAULT '',
      payload_hash    TEXT NOT NULL DEFAULT '',
      result          TEXT NOT NULL DEFAULT '',
      approval_state  TEXT NOT NULL DEFAULT '',
      timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_govevt_experiment ON governed_experiment_events(experiment_id);
    CREATE INDEX IF NOT EXISTS idx_govevt_org ON governed_experiment_events(org_id);
  `);
}

// ─── Organization CRUD ────────────────────────────────────────────────

export function createOrganization(
  id: string,
  name: string,
  slug: string,
  settings: Record<string, unknown> = {},
): Organization {
  const db = getDb();
  db.prepare(
    `INSERT INTO organizations (id, name, slug, settings) VALUES (?, ?, ?, ?)`,
  ).run(id, name, slug, JSON.stringify(settings));
  return getOrganization(id)!;
}

export function getOrganization(id: string): Organization | undefined {
  return getDb().prepare(`SELECT * FROM organizations WHERE id = ?`).get(id) as
    | Organization
    | undefined;
}

export function getOrganizationBySlug(slug: string): Organization | undefined {
  return getDb()
    .prepare(`SELECT * FROM organizations WHERE slug = ?`)
    .get(slug) as Organization | undefined;
}

export function listOrganizations(): Organization[] {
  return getDb()
    .prepare(`SELECT * FROM organizations ORDER BY created_at DESC`)
    .all() as Organization[];
}

// ─── User CRUD ────────────────────────────────────────────────────────

export function createUser(
  id: string,
  orgId: string,
  email: string,
  name: string,
  role: string = "field_rep",
  therapeuticArea: string | null = null,
): User {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, org_id, email, name, role, therapeutic_area)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, email, name, role, therapeuticArea);
  return getUser(id)!;
}

export function getUser(id: string): User | undefined {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
    | User
    | undefined;
}

export function getUserByEmail(orgId: string, email: string): User | undefined {
  return getDb()
    .prepare(`SELECT * FROM users WHERE org_id = ? AND email = ?`)
    .get(orgId, email) as User | undefined;
}

export function userExistsByEmail(orgId: string, email: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 FROM users WHERE org_id = ? AND email = ?`)
    .get(orgId, email) as { "1": number } | undefined;
  return !!row;
}

export function setUserPasswordHash(userId: string, hash: string): void {
  getDb()
    .prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
    .run(hash, userId);
}

export function listUsers(orgId: string): User[] {
  return getDb()
    .prepare(`SELECT * FROM users WHERE org_id = ? ORDER BY created_at`)
    .all(orgId) as User[];
}

// ─── Session CRUD ─────────────────────────────────────────────────────

export function createSession(
  id: string,
  userId: string,
  orgId: string,
  token: string,
  expiresAt: string,
): Session {
  const db = getDb();
  db.prepare(
    `INSERT INTO sessions (id, user_id, org_id, token, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, orgId, token, expiresAt);
  return getSessionByToken(token)!;
}

export function getSessionByToken(token: string): Session | undefined {
  const db = getDb();
  const session = db
    .prepare(`SELECT * FROM sessions WHERE token = ?`)
    .get(token) as Session | undefined;
  if (!session) return undefined;
  // Check expiry
  if (new Date(session.expires_at) < new Date()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(session.id);
    return undefined;
  }
  return session;
}

export function deleteSession(token: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function cleanExpiredSessions(): number {
  const result = getDb()
    .prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`)
    .run();
  return result.changes;
}

// ─── KV Store (backwards-compatible with loadGoldenArray/saveGoldenArray) ─

/**
 * Load a JSON array from the KV store for a given organization.
 * If orgId is not provided, uses the default org (backwards compatibility).
 */
export function kvLoad<T>(orgId: string, key: string): T[] {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM kv_store WHERE org_id = ? AND key = ?`)
    .get(orgId, key) as { value: string } | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Save a JSON array to the KV store for a given organization.
 */
export function kvSave<T>(orgId: string, key: string, records: T[]): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO kv_store (org_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(orgId, key, JSON.stringify(records));
}

// ─── Audit log ────────────────────────────────────────────────────────

export function auditLog(
  orgId: string,
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  detail?: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(orgId, userId, action, entityType || null, entityId || null, detail || null);
}

// ─── Health check ─────────────────────────────────────────────────────

export function dbHealth(): { ok: boolean; path: string; tables: number } {
  try {
    const db = getDb();
    const count = db
      .prepare(
        `SELECT count(*) as c FROM sqlite_master WHERE type='table'`,
      )
      .get() as { c: number };
    return { ok: true, path: DB_PATH, tables: count.c };
  } catch (e) {
    return { ok: false, path: DB_PATH, tables: 0 };
  }
}

// ─── Schema migrations ────────────────────────────────────────────────

function migrateSchema(db: Database.Database): void {
  // Add password_hash to users if missing (pre-2026 schemas)
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userColumns.some((c) => c.name === "password_hash")) {
    db.prepare("ALTER TABLE users ADD COLUMN password_hash TEXT").run();
  }

  // Add updated_at to workflows if missing
  const wfColumns = db.prepare("PRAGMA table_info(workflows)").all() as { name: string }[];
  if (wfColumns.length > 0 && !wfColumns.some((c) => c.name === "updated_at")) {
    db.prepare("ALTER TABLE workflows ADD COLUMN updated_at TEXT").run();
  }

  // Add updated_at to skill_genomes if missing
  const skillColumns = db.prepare("PRAGMA table_info(skill_genomes)").all() as { name: string }[];
  if (skillColumns.length > 0 && !skillColumns.some((c) => c.name === "updated_at")) {
    db.prepare("ALTER TABLE skill_genomes ADD COLUMN updated_at TEXT").run();
  }

  // Add updated_at to venture_capsules if missing
  const ventureColumns = db.prepare("PRAGMA table_info(venture_capsules)").all() as { name: string }[];
  if (ventureColumns.length > 0 && !ventureColumns.some((c) => c.name === "updated_at")) {
    db.prepare("ALTER TABLE venture_capsules ADD COLUMN updated_at TEXT").run();
  }

  // Add audio_url to diary_entries if missing
  const diaryColumns = db.prepare("PRAGMA table_info(diary_entries)").all() as { name: string }[];
  if (diaryColumns.length > 0 && !diaryColumns.some((c) => c.name === "audio_url")) {
    db.prepare("ALTER TABLE diary_entries ADD COLUMN audio_url TEXT").run();
  }
}

// ─── Default organization (backwards compatibility) ──────────────────

export const DEFAULT_ORG_ID = "foundry";
export const DEFAULT_ORG_SLUG = "foundry";

/**
 * Ensure the default organization exists. Called on startup.
 * All existing data (before multi-tenancy) belongs to this org.
 */
export function ensureDefaultOrg(): void {
  const db = getDb();
  const existing = getOrganization(DEFAULT_ORG_ID);
  if (!existing) {
    createOrganization(
      DEFAULT_ORG_ID,
      "Advantage Foundry",
      DEFAULT_ORG_SLUG,
      { tier: "enterprise", industry: "pharma" },
    );
  }
}

// ─── Migration from JSON files ────────────────────────────────────────

/**
 * Migrate existing JSON file data into SQLite.
 * Called once on startup if the database is fresh.
 */
export function migrateFromJsonFiles(orgId: string = DEFAULT_ORG_ID): {
  migrated: number;
  keys: string[];
} {
  const db = getDb();
  ensureDefaultOrg();

  // Check if already migrated
  const count = db
    .prepare(`SELECT count(*) as c FROM kv_store WHERE org_id = ?`)
    .get(orgId) as { c: number };
  if (count.c > 0) {
    return { migrated: 0, keys: [] };
  }

  const keys: string[] = [];
  let migrated = 0;

  // Map of JSON file paths to KV keys
  const fileMap: Record<string, string> = {
    "golden-hypotheses.json": "hypotheses",
    "golden-prior-art.json": "priorArt",
    "golden-assignments.json": "assignments",
    "golden-outcomes.json": "outcomes",
    "golden-attributions.json": "attributions",
    "golden-derivatives.json": "derivatives",
    "golden-nodes.json": "goldenNodes",
    "golden-attribution-ledger.json": "attributionLedger",
    "golden-discovery-ledger.json": "discoveryLedger",
    "golden-research-reliability.json": "researchReliability",
    "golden-processes.json": "processes",
    "golden-competitions.json": "competitions",
    "spinor-profiles.json": "spinorProfiles",
    "spinor-organisms.json": "spinorOrganisms",
    "spinor-rl-missions.json": "missions",
    "spinor-rl-physicians.json": "physicians",
    "spinor-rl-palindrome.json": "palindromeUpdates",
    "spinor-rl-agent-states.json": "rlAgentStates",
    "spinor-rl-rewards.json": "rlRewards",
    "spinor-rl-email-signals.json": "emailSignals",
    "spinor-rl-stagnation.json": "stagnationFlags",
    "spinor-rl-sprouts.json": "sproutTree",
    "spinor-rl-diffusion.json": "diffusionStates",
    "spinor-rl-anti-gaming.json": "antiGamingChecks",
    "strategies.json": "strategies",
    "strategy-assignments.json": "strategyAssignments",
    "strategy-outcomes.json": "strategyOutcomes",
    "strategy-attributions.json": "strategyAttributions",
    "strategy-evolution.json": "strategyEvolution",
    "commitments.json": "commitments",
    "commitment-metrics.json": "commitmentMetrics",
    "processed-emails.json": "processedEmails",
    "sync-status.json": "syncStatus",
    "voice-sessions.json": "voiceSessions",
    "competitive-engine.json": "competitiveEngine",
  };

  for (const [filename, kvKey] of Object.entries(fileMap)) {
    const filepath = join(DATA_DIR, filename);
    try {
      if (existsSync(filepath)) {
        const raw = require("fs").readFileSync(filepath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          kvSave(orgId, kvKey, parsed);
          migrated++;
          keys.push(kvKey);
        } else if (parsed && typeof parsed === "object") {
          // Single-object stores (sync-status, commitment-metrics) — wrap in array
          kvSave(orgId, kvKey, [parsed]);
          migrated++;
          keys.push(kvKey);
        }
      }
    } catch (e) {
      // File doesn't exist or is invalid — skip
    }
  }

  return { migrated, keys };
}

// ─── ClientContinuity CRUD ───────────────────────────────────────────

export interface ClientContinuity {
  id: string;
  org_id: string;
  person_id: string;
  person_name: string;
  relationship: string;
  authority_level: string;
  communication_history: string; // JSON
  active_commitments: string; // JSON
  escalation_boundaries: string; // JSON
  preferred_speaker: string;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listClientContinuityByOrg(orgId: string): ClientContinuity[] {
  return getDb()
    .prepare(`SELECT * FROM client_continuity WHERE org_id = ? ORDER BY last_interaction_at DESC`)
    .all(orgId) as ClientContinuity[];
}

export function upsertClientContinuity(
  orgId: string,
  personId: string,
  personName: string,
  relationship: string,
  authorityLevel: string,
  communicationHistory: any[] = [],
  activeCommitments: string[] = [],
  escalationBoundaries: string[] = [],
  preferredSpeaker: string = "human",
  lastInteractionAt: string | null = null,
): string {
  const db = getDb();
  const id = `cc_${orgId}_${personId}`;
  db.prepare(
    `INSERT INTO client_continuity
     (id, org_id, person_id, person_name, relationship, authority_level,
      communication_history, active_commitments, escalation_boundaries,
      preferred_speaker, last_interaction_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       person_name = excluded.person_name,
       relationship = excluded.relationship,
       authority_level = excluded.authority_level,
       communication_history = excluded.communication_history,
       active_commitments = excluded.active_commitments,
       escalation_boundaries = excluded.escalation_boundaries,
       preferred_speaker = excluded.preferred_speaker,
       last_interaction_at = excluded.last_interaction_at,
       updated_at = datetime('now')`,
  ).run(
    id, orgId, personId, personName, relationship, authorityLevel,
    JSON.stringify(communicationHistory), JSON.stringify(activeCommitments),
    JSON.stringify(escalationBoundaries), preferredSpeaker, lastInteractionAt,
  );
  return id;
}

// Re-export for testing
export { getDb, getDb as _getDb, DB_PATH, DB_PATH as _dbPath };
