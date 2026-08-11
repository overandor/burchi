/**
 * Demo seed for workteleport tables.
 *
 * Seeds evidence_envelopes, skill_genomes, experiment_twins,
 * commit_records, venture_capsules, dissected_hypotheses, and
 * spinor_email_golden_nodes with realistic demo data so every
 * table has content on the live deployment.
 *
 * Each table is seeded independently — if a table already has data,
 * it is skipped. This allows partial re-seeds when new tables are added.
 */

import { getDb } from "@/lib/db";
import { createHash } from "crypto";
import { nanoid } from "nanoid";

export function seedWorkteleportDemoData(orgId: string = "foundry", userId: string = "demo-user"): {
  evidenceEnvelopes: number;
  skillGenomes: number;
  experimentTwins: number;
  commitRecords: number;
  ventureCapsules: number;
  dissectedHypotheses: number;
  emailGoldenNodes: number;
} {
  const db = getDb();
  const result = {
    evidenceEnvelopes: 0,
    skillGenomes: 0,
    experimentTwins: 0,
    commitRecords: 0,
    ventureCapsules: 0,
    dissectedHypotheses: 0,
    emailGoldenNodes: 0,
  };

  // ─── 1. Evidence Envelopes ─────────────────────────────────────
  const existingEvidence = (db.prepare(`SELECT COUNT(*) as c FROM evidence_envelopes WHERE org_id = ?`).get(orgId) as { c: number }).c;
  if (existingEvidence === 0) {
    const envelopes = [
      { source: "email", sourceIdentifier: "em_demo_001", sender: "dr.gilead@mailbox.local", recipient: "Office Manager",
        originalContent: "Subject: Biktarvy P&T cycle alignment\n\nDr. Chen, ahead of the Q4 P&T committee meeting, I've prepared the HEOR data pack summarizing real-world adherence outcomes for Biktarvy in your formulary review cycle.",
        confidentialityClass: "internal", permittedUses: '["task_execution","experimentation"]', retentionRule: "90d" },
      { source: "email", sourceIdentifier: "em_demo_002", sender: "oncology@communityclinic.com", recipient: "Field Rep",
        originalContent: "Subject: Trodelvy treatment-sequencing education\n\nWe just had our first Trodelvy prescription at the community oncology center. Can we schedule a treatment-sequencing education session within the next two weeks?",
        confidentialityClass: "internal", permittedUses: '["task_execution"]', retentionRule: "180d" },
      { source: "voice", sourceIdentifier: "voice_diary_001", sender: "emp-001", recipient: "SPINOR Pipeline",
        originalContent: "Field observation: Office managers route 72% of workflow requests without physician involvement when given a self-service path. This contradicts the physician-first assumption.",
        confidentialityClass: "internal", permittedUses: '["task_execution","experimentation","hypothesis_generation"]', retentionRule: "365d" },
    ];
    for (const env of envelopes) {
      const id = `ev_${nanoid(16)}`;
      const contentHash = createHash("sha256").update(env.originalContent).digest("hex");
      try {
        db.prepare(`INSERT OR REPLACE INTO evidence_envelopes (id, org_id, user_id, source, source_identifier, sender, recipient, received_at, original_content, content_hash, attachments, extracted_entities, factual_claims, requested_work, deadlines, confidentiality_class, permitted_uses, retention_rule, llm_interpretation) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, '[]', '[]', '[]', NULL, '[]', ?, ?, ?, NULL)`).run(id, orgId, userId, env.source, env.sourceIdentifier, env.sender, env.recipient, env.originalContent, contentHash, env.confidentialityClass, env.permittedUses, env.retentionRule);
        result.evidenceEnvelopes++;
      } catch (e: any) { console.error("[wt-seed] evidence envelope error:", e.message); }
    }
  }

  // ─── 2. Skill Genomes ──────────────────────────────────────────
  const existingSkills = (db.prepare(`SELECT COUNT(*) as c FROM skill_genomes WHERE org_id = ?`).get(orgId) as { c: number }).c;
  const skillIds: string[] = [];
  if (existingSkills === 0) {
    const skills = [
      { id: `sk_${nanoid(12)}`, name: "P&T Cycle-Aligned Outreach", description: "Time value proposition presentations to 60-90 days before P&T committee meetings with HEOR data pack",
        trigger: '{"type":"calendar_event","match":"p_and_t_meeting","leadDays":75}', inputSchema: '{"accountId":"string","heorPackId":"string"}', taskIRTemplate: '{"action":"schedule_outreach","timing":"pre_pt_meeting"}',
        toolRequirements: '["calendar","email_send","heor_lookup"]', authorizationRequirements: '["on_label_only"]',
        executionDag: '[{"step":"check_pt_calendar"},{"step":"prepare_heor_pack"},{"step":"schedule_outreach"},{"step":"send_with_compliance_check"}]',
        validationTests: '["heor_pack_is_peer_reviewed","timing_is_60_to_90_days_before"]', knownFailureModes: '["pt_meeting_date_changed","heor_pack_outdated"]',
        humanCheckpoints: '["heor_pack_approval"]', outputSchema: '{"outreachScheduled":true,"complianceVerified":true}', maturity: "validated", performanceHistory: '[]' },
      { id: `sk_${nanoid(12)}`, name: "Community Oncology Trodelvy Education", description: "Deploy field rep for in-person treatment-sequencing education within 14 days of first Trodelvy prescription",
        trigger: '{"type":"prescription_event","match":"trodelvy_first_prescription","maxDelayDays":14}', inputSchema: '{"accountId":"string","prescriptionId":"string"}', taskIRTemplate: '{"action":"schedule_education_visit","maxDelay":14}',
        toolRequirements: '["calendar","crm_lookup","safety_reporting"]', authorizationRequirements: '["on_label_only","safety_reporting_protocol"]',
        executionDag: '[{"step":"detect_first_prescription"},{"step":"schedule_education_visit"},{"step":"conduct_education"},{"step":"report_safety_if_needed"}]',
        validationTests: '["visit_within_14_days","on_label_sequencing_only"]', knownFailureModes: '["rep_unavailable","patient_discontinued"]',
        humanCheckpoints: '["education_content_approval"]', outputSchema: '{"educationCompleted":true,"safetyReportFiled":false}', maturity: "testing", performanceHistory: '[]' },
    ];
    for (const sk of skills) {
      skillIds.push(sk.id);
      try {
        db.prepare(`INSERT OR REPLACE INTO skill_genomes (id, org_id, name, description, trigger, input_schema, task_ir_template, tool_requirements, authorization_requirements, execution_dag, validation_tests, known_failure_modes, human_checkpoints, output_schema, maturity, performance_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(sk.id, orgId, sk.name, sk.description, sk.trigger, sk.inputSchema, sk.taskIRTemplate, sk.toolRequirements, sk.authorizationRequirements, sk.executionDag, sk.validationTests, sk.knownFailureModes, sk.humanCheckpoints, sk.outputSchema, sk.maturity, sk.performanceHistory);
        result.skillGenomes++;
      } catch (e: any) { console.error("[wt-seed] skill genome error:", e.message); }
    }
  } else {
    const rows = db.prepare(`SELECT id FROM skill_genomes WHERE org_id = ? LIMIT 2`).all(orgId) as { id: string }[];
    rows.forEach((r) => skillIds.push(r.id));
  }

  // ─── 3. Experiment Twins + Workflows ───────────────────────────
  const existingTwins = (db.prepare(`SELECT COUNT(*) as c FROM experiment_twins WHERE org_id = ?`).get(orgId) as { c: number }).c;
  if (existingTwins === 0) {
    const twinSpecs = [
      { workflowId: "wf_pt_outreach", skillGenomeId: skillIds[0] || null, researchQuestion: "Does 45-day pre-P&T timing outperform 75-day timing?", hypothesis: "Shorter lead time creates urgency and improves P&T review engagement", permutationType: "different_timing", permutationDescription: "Test 45-day lead time vs 75-day baseline", controlWorkflowId: "wf_pt_outreach_75day", experimentalWorkflowId: "wf_pt_outreach_45day", successMetrics: '["pt_review_engagement","heor_pack_download_rate"]', status: "executing" },
      { workflowId: "wf_trodelvy_education", skillGenomeId: skillIds[1] || null, researchQuestion: "Does virtual education match in-person education for Trodelvy sequencing?", hypothesis: "Virtual education via video call achieves equivalent comprehension to in-person", permutationType: "different_channel", permutationDescription: "Video call education vs in-person education", controlWorkflowId: "wf_trodelvy_inperson", experimentalWorkflowId: "wf_trodelvy_virtual", successMetrics: '["comprehension_score","safety_reporting_compliance"]', status: "proposed" },
    ];
    for (const tw of twinSpecs) {
      try {
        db.prepare(`INSERT OR IGNORE INTO task_irs (id, org_id, user_id, objective, task_type, inputs, required_outputs, constraints, dependencies, evidence_requirements, permitted_tools, approval_boundary, failure_conditions, completion_tests, rollback_plan, status, created_at) VALUES (?, ?, ?, ?, 'demo', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '[]', '[]', '[]', 'completed', datetime('now'))`).run(`taskir_${tw.workflowId}`, orgId, userId, `Demo task for ${tw.workflowId}`);
        db.prepare(`INSERT OR IGNORE INTO workflows (id, org_id, user_id, task_ir_id, state, steps, idempotency_key, checkpointed_state, retry_count, max_retries, deadline, created_at, updated_at) VALUES (?, ?, ?, ?, 'completed', '[]', ?, '{}', 0, 3, datetime('now','+30 days'), datetime('now'), datetime('now'))`).run(tw.workflowId, orgId, userId, `taskir_${tw.workflowId}`, `idem_${tw.workflowId}`);
        db.prepare(`INSERT OR REPLACE INTO experiment_twins (id, org_id, workflow_id, skill_genome_id, research_question, hypothesis, permutation_type, permutation_description, control_workflow_id, experimental_workflow_id, success_metrics, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(`tw_${nanoid(12)}`, orgId, tw.workflowId, tw.skillGenomeId, tw.researchQuestion, tw.hypothesis, tw.permutationType, tw.permutationDescription, tw.controlWorkflowId, tw.experimentalWorkflowId, tw.successMetrics, tw.status);
        result.experimentTwins++;
      } catch (e: any) { console.error("[wt-seed] twin error:", e.message); }
    }
  }

  // ─── 4. Commit Records ─────────────────────────────────────────
  const existingCommits = (db.prepare(`SELECT COUNT(*) as c FROM commit_records WHERE org_id = ?`).get(orgId) as { c: number }).c;
  if (existingCommits === 0) {
    const commits = [
      { workflowId: "wf_pt_outreach", stepId: "send_with_compliance_check", actionType: "email_send", actionTarget: "dr.chen@hospital.com", actionPayload: '{"subject":"Biktarvy HEOR Data Pack"}' },
      { workflowId: "wf_trodelvy_education", stepId: "schedule_education_visit", actionType: "calendar_create", actionTarget: "community-onc-center", actionPayload: '{"type":"education_visit","timing":"within_14_days"}' },
    ];
    for (const c of commits) {
      const id = `cm_${nanoid(12)}`;
      const receiptHash = createHash("sha256").update(`${c.workflowId}:${c.stepId}:${c.actionType}:${c.actionTarget}:${Date.now()}`).digest("hex");
      try {
        db.prepare(`INSERT OR REPLACE INTO commit_records (id, org_id, workflow_id, step_id, action_type, action_target, action_payload, authorization_valid, target_unchanged, data_unchanged, within_policy, human_approval_current, output_validated, committed, committed_at, rollback_possible, evidence_envelope_id, receipt_hash) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, datetime('now'), 1, NULL, ?)`).run(id, orgId, c.workflowId, c.stepId, c.actionType, c.actionTarget, c.actionPayload, receiptHash);
        result.commitRecords++;
      } catch (e: any) { console.error("[wt-seed] commit error:", e.message); }
    }
  }

  // ─── 5. Venture Capsules ───────────────────────────────────────
  const existingVentures = (db.prepare(`SELECT COUNT(*) as c FROM venture_capsules WHERE org_id = ?`).get(orgId) as { c: number }).c;
  if (existingVentures === 0) {
    const goldenNodeIds = ["gn_vrL_W1oZ", "gn_3jVwsyWg", "gn_jA1iqBzM"];
    const ventures = [
      { name: "Office-Manager-First Outreach Channel", problemSolved: "Workflow resolution bottleneck — physician-first outreach causes delays", commercializationHypothesis: "Package as training protocol for new field reps, reducing onboarding time by 40%" },
      { name: "Self-Service Workflow Product", problemSolved: "Digital accounts need configurable async follow-up but reps waste time on synchronous calls", commercializationHypothesis: "Productize as self-service portal module, sold as CRM add-on" },
      { name: "Human-Guided Account Adapter", problemSolved: "One-size-fits-all workflow degrades outcomes for human-guided accounts", commercializationHypothesis: "Adaptive workflow engine that detects interaction mode and adjusts" },
    ];
    for (let i = 0; i < ventures.length; i++) {
      try {
        db.prepare(`INSERT OR REPLACE INTO venture_capsules (id, org_id, golden_node_id, skill_genome_id, name, problem_solved, target_users, triggering_evidence, validated_workflow_id, required_integrations, compliance_requirements, outcome_evidence, replication_evidence, unit_economics, market_alternatives, deployment_package, ownership_lineage, commercialization_hypothesis, status, created_at) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', NULL, '[]', '[]', '[]', '[]', '{}', '[]', '{}', '[]', ?, 'identified', datetime('now'))`).run(`vc_${nanoid(12)}`, orgId, goldenNodeIds[i] || null, skillIds[i % skillIds.length] || null, ventures[i].name, ventures[i].problemSolved, ventures[i].commercializationHypothesis);
        result.ventureCapsules++;
      } catch (e: any) { console.error("[wt-seed] venture capsule error:", e.message); }
    }
  }

  // ─── 6. Dissected Hypotheses ───────────────────────────────────
  const existingDissected = (db.prepare(`SELECT COUNT(*) as c FROM dissected_hypotheses WHERE org_id = ?`).get(orgId) as { c: number }).c;
  if (existingDissected === 0) {
    const dissectSpecs = [
      { originalClaim: "Office-manager-first outreach improves workflow resolution for digitally responsive accounts.", population: "Digitally responsive accounts with office manager staff delegation", intervention: "Route initial outreach through office manager before physician", comparison: "Physician-first outreach", outcome: "Workflow resolution rate", timing: "fit", mechanism: "Office managers route requests without physician involvement", risk: "low", demoronifiedClaim: "Among digitally responsive accounts, routing initial outreach through the office manager before the physician increases workflow resolution rate compared to physician-first outreach.", researchStatus: "established", researchSummary: "13/18 workflow resolutions vs 7/18 with physician-first. Office managers routed 72% without physician involvement.", novelComponent: "Office-manager-first routing sequence", noveltyType: "recombinant" },
      { originalClaim: "Digitally engaged physicians may prefer configurable, asynchronous follow-up systems over repeated scheduled contact.", population: "Digitally engaged physicians", intervention: "Configurable async self-service workflow", comparison: "Standard representative-led follow-up", outcome: "Meaningful account progression", timing: "fit", mechanism: "Self-service reduces friction for digitally native users", risk: "low", demoronifiedClaim: "Among digitally engaged physicians, offering a configurable asynchronous self-service workflow path increases meaningful account progression compared to standard representative-led follow-up.", researchStatus: "plausible", researchSummary: "64% completion rate for self-service. 8 min avg vs 22 min rep visit equivalent.", novelComponent: "Configurable self-service pathway for approved workflows", noveltyType: "incremental" },
    ];
    for (const ds of dissectSpecs) {
      try {
        db.prepare(`INSERT OR REPLACE INTO dissected_hypotheses (id, org_id, original_claim, population, intervention, comparison, outcome, timing, mechanism, risk, demoronified_claim, research_status, research_summary, novel_component, novelty_type, experiment_design, replication_plan, capitalization_plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, datetime('now'))`).run(`dh_${nanoid(12)}`, orgId, ds.originalClaim, ds.population, ds.intervention, ds.comparison, ds.outcome, ds.timing, ds.mechanism, ds.risk, ds.demoronifiedClaim, ds.researchStatus, ds.researchSummary, ds.novelComponent, ds.noveltyType);
        result.dissectedHypotheses++;
      } catch (e: any) { console.error("[wt-seed] dissected hypothesis error:", e.message); }
    }
  }

  // ─── 7. Email Engine Golden Nodes ──────────────────────────────
  const existingEmailGN = (db.prepare(`SELECT COUNT(*) as c FROM spinor_email_golden_nodes`).get() as { c: number }).c;
  if (existingEmailGN === 0) {
    try {
      const exp = db.prepare(`SELECT * FROM spinor_email_experiments WHERE status = 'analyzed' LIMIT 1`).get() as any;
      if (exp) {
        db.prepare(`INSERT OR REPLACE INTO spinor_email_golden_nodes (id, experiment_id, population, method, result, failure_boundary, lift, replication_count, compliance_reliability, cost_per_use, promoted_at, status, reverse_tests, data) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0.9, 5.0, datetime('now'), 'active', '[]', '{}')`).run(`egn_${nanoid(12)}`, exp.id, exp.account_name || "demo accounts", "controlled email experiment", exp.outcome || "qualified_response", "Effect reverses for human-guided accounts", exp.causal_lift || 0.5);
        result.emailGoldenNodes++;
      }
    } catch (e: any) { console.error("[wt-seed] email golden node error:", e.message); }
  }

  return result;
}
