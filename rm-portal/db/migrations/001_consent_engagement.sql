-- Consent-Based Engagement Platform Schema
-- Governing rule: CONSENTED INPUT → ELIGIBILITY CHECK → MESSAGE GENERATION → APPROVAL/POLICY CHECK → SEND → MEASURE → AUDIT
-- Rejects: SCRAPED/INFERRED CONTACT → COLD MESSAGE → CONVERSION OPTIMIZATION

-- ─── Contacts: opted-in individuals only ────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Consent records: provenance for every contact ──────────────────────
CREATE TABLE IF NOT EXISTS consent_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  consent_source    TEXT NOT NULL CHECK (
    consent_source IN ('csv_import','crm_sync','signup_webhook','double_opt_in','manual_import')
  ),
  consented_at      TIMESTAMPTZ NOT NULL,
  consent_scope     TEXT NOT NULL CHECK (
    consent_scope IN ('marketing','support','transactional','follow_up','reminders','all')
  ),
  revocation_status TEXT NOT NULL DEFAULT 'active' CHECK (
    revocation_status IN ('active','revoked')
  ),
  revoked_at        TIMESTAMPTZ,
  revocation_reason TEXT,
  evidence          JSONB NOT NULL DEFAULT '{}',
  -- evidence must contain enough to verify opt-in: source URL, form ID, CRM ref, IP, timestamp, etc.
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_contact ON consent_records(contact_id);
CREATE INDEX IF NOT EXISTS idx_consent_status ON consent_records(revocation_status);

-- ─── Suppression list: unsubscribe/bounce/complaint across all channels ──
CREATE TABLE IF NOT EXISTS suppression_list (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (
    reason IN ('unsubscribe','bounce','complaint','manual','expired_consent')
  ),
  channel     TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','push')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes       TEXT,
  UNIQUE(email, reason, channel)
);

CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email);

-- ─── Import batches: track every bulk import ─────────────────────────────
CREATE TABLE IF NOT EXISTS import_batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source         TEXT NOT NULL CHECK (source IN ('csv','json','crm_sync','webhook')),
  filename       TEXT,
  total_rows     INTEGER NOT NULL DEFAULT 0,
  accepted_rows  INTEGER NOT NULL DEFAULT 0,
  rejected_rows  INTEGER NOT NULL DEFAULT 0,
  rejection_log  JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Experiments: A/B tests on consenting audiences only ────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','completed','stopped')),
  reward_metric  TEXT NOT NULL CHECK (
    reward_metric IN ('response_helpfulness','customer_satisfaction','booking_completion','retention','reduced_support_time','response_rate')
  ),
  audience_filter JSONB NOT NULL DEFAULT '{}',
  -- filter must only select contacts with active consent for the experiment's scope
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS experiment_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  content         TEXT NOT NULL,
  impressions     INTEGER NOT NULL DEFAULT 0,
  responses       INTEGER NOT NULL DEFAULT 0,
  reward_sum      DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variants_experiment ON experiment_variants(experiment_id);

-- ─── Messages: drafts, approvals, sent ──────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  subject       TEXT,
  body          TEXT NOT NULL,
  message_type  TEXT NOT NULL CHECK (
    message_type IN ('reply','follow_up','reminder','support','newsletter','transactional')
  ),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft','pending_approval','approved','rejected','sent','failed','suppressed')
  ),
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  rejected_reason TEXT,
  sent_at       TIMESTAMPTZ,
  provider_id   TEXT,
  experiment_id UUID REFERENCES experiments(id),
  variant_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);

-- ─── Eligibility decisions: why each recipient was eligible ─────────────
CREATE TABLE IF NOT EXISTS eligibility_decisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message_id          UUID REFERENCES messages(id) ON DELETE SET NULL,
  eligible            BOOLEAN NOT NULL,
  consent_record_id   UUID REFERENCES consent_records(id),
  suppression_checked BOOLEAN NOT NULL DEFAULT true,
  suppression_match   BOOLEAN NOT NULL DEFAULT false,
  reason              TEXT NOT NULL,
  checked_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eligibility_contact ON eligibility_decisions(contact_id);

-- ─── Outcomes: measurement of legitimate results ────────────────────────
CREATE TABLE IF NOT EXISTS outcomes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message_id    UUID REFERENCES messages(id) ON DELETE SET NULL,
  outcome_type  TEXT NOT NULL CHECK (
    outcome_type IN ('response','helpfulness','csat','booking_completion','retention','support_time','response_rate')
  ),
  value         DOUBLE PRECISION NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outcomes_contact ON outcomes(contact_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_type ON outcomes(outcome_type);

-- ─── Audit trail: immutable, append-only ────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_trail (
  id          BIGSERIAL PRIMARY KEY,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  actor       TEXT NOT NULL DEFAULT 'system',
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent UPDATE and DELETE on audit_trail
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail is immutable: % operation not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_audit ON audit_trail;
CREATE TRIGGER no_update_audit BEFORE UPDATE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

DROP TRIGGER IF EXISTS no_delete_audit ON audit_trail;
CREATE TRIGGER no_delete_audit BEFORE DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_trail(action);

-- ─── updated_at trigger for contacts and messages ───────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_updated ON contacts;
CREATE TRIGGER contacts_updated BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS messages_updated ON messages;
CREATE TRIGGER messages_updated BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
