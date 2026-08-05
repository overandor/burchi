import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import { detectCommitments } from "../commitment/detector";
import {
  upsertCommitmentByEmailId,
  listCommitments,
  loadMetrics,
  recordAcceptanceOutcome,
} from "../commitment/store";
import { executeCommitment } from "../commitment/executor";
import { CommitmentContract, ProcessedEmailRecord } from "@/types";

const dataDir = path.join(process.cwd(), "data");
const commitmentsFile = path.join(dataDir, "commitments.json");
const metricsFile = path.join(dataDir, "commitment-metrics.json");

let commitmentsBackup: string | null = null;
let metricsBackup: string | null = null;
let commitmentsExisted = false;
let metricsExisted = false;

before(() => {
  commitmentsExisted = fs.existsSync(commitmentsFile);
  metricsExisted = fs.existsSync(metricsFile);
  if (commitmentsExisted) {
    commitmentsBackup = fs.readFileSync(commitmentsFile, "utf-8");
  }
  if (metricsExisted) {
    metricsBackup = fs.readFileSync(metricsFile, "utf-8");
  }
});

after(() => {
  try {
    if (commitmentsExisted) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(commitmentsFile, commitmentsBackup ?? "", "utf-8");
    } else if (fs.existsSync(commitmentsFile)) {
      fs.unlinkSync(commitmentsFile);
    }
  } catch {
    // ignore
  }

  try {
    if (metricsExisted) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(metricsFile, metricsBackup ?? "", "utf-8");
    } else if (fs.existsSync(metricsFile)) {
      fs.unlinkSync(metricsFile);
    }
  } catch {
    // ignore
  }
});

test("detectCommitments extracts a commitment contract", () => {
  const emailId = `test-email-${Date.now()}`;

  const record: ProcessedEmailRecord = {
    id: "rec-1",
    emailId,
    subject: "Need territory report by Friday",
    sender: "Sarah Martinez, Regional Manager",
    senderEmail: "sarah.martinez@example.com",
    receivedDate: new Date().toISOString(),
    processedAt: new Date().toISOString(),
    category: "report",
    confidence: 0.9,
    fieldCount: 0,
    tableCount: 0,
    extractedData: {
      emailId,
      extractedAt: new Date().toISOString(),
      fields: [],
      tables: [],
      summary: "Please prepare the territory analysis report by Friday.",
      category: "report",
      confidence: 0.9,
      source: "email_body",
    },
  };

  const commitments = detectCommitments([record]);
  assert.equal(commitments.length, 1);
  assert.equal(commitments[0].emailId, emailId);
  assert.equal(commitments[0].requesterEmail, "sarah.martinez@example.com");
});

test("upsertCommitmentByEmailId is idempotent", () => {
  const emailId = `test-email-${Date.now()}-idempotent`;

  const contract: CommitmentContract = {
    id: "",
    emailId,
    emailSubject: "Test subject",
    requester: "Requester",
    requesterEmail: "req@example.com",
    recipientRole: "field_representative",
    authorityVerified: true,
    requestedOutcome: "Prepare territory report",
    deadline: new Date().toISOString(),
    mandatoryOutputs: ["Written report"],
    inferredOutputs: [],
    permittedTools: ["internal_report_writer"],
    externalSendAllowed: false,
    autonomyClass: 1,
    completionProbability: 0.9,
    dependencies: [],
    assumptions: [],
    status: "detected",
    auditEvents: [],
    detectedAt: new Date().toISOString(),
  };

  const first = upsertCommitmentByEmailId(contract);
  const second = upsertCommitmentByEmailId(contract);

  assert.equal(first.id, second.id);

  const all = listCommitments().filter((c) => c.emailId === emailId);
  assert.equal(all.length, 1);
});

test("executeCommitment completes class-1 work and stages class-2 work", () => {
  const emailId = `test-email-${Date.now()}-exec`;
  const metrics = loadMetrics();

  const base: CommitmentContract = {
    id: "",
    emailId,
    emailSubject: "Execution request",
    requester: "Requester",
    requesterEmail: "req@example.com",
    recipientRole: "field_representative",
    authorityVerified: true,
    requestedOutcome: "Prepare territory report",
    deadline: new Date().toISOString(),
    mandatoryOutputs: ["Written report"],
    inferredOutputs: ["Executive summary"],
    permittedTools: ["internal_report_writer"],
    externalSendAllowed: false,
    autonomyClass: 1,
    completionProbability: 0.9,
    dependencies: [],
    assumptions: [],
    status: "detected",
    auditEvents: [],
    detectedAt: new Date().toISOString(),
  };

  const done = executeCommitment(base, metrics);
  assert.equal(done.contract.status, "completed");
  assert.ok((done.contract.deliverables?.length ?? 0) >= 2);
  assert.ok(done.contract.confidenceBreakdown);
  assert.ok(done.contract.completionProbability >= 0 && done.contract.completionProbability <= 1);

  const staged = executeCommitment({ ...base, autonomyClass: 2 }, metrics);
  assert.equal(staged.contract.status, "awaiting_approval");
});

test("recordAcceptanceOutcome updates acceptance metric", () => {
  const before = loadMetrics();
  const after = recordAcceptanceOutcome({ acceptedWithoutRevision: true });
  assert.equal(after.acceptedWithoutRevision.total, before.acceptedWithoutRevision.total + 1);
  assert.equal(after.acceptedWithoutRevision.success, before.acceptedWithoutRevision.success + 1);
});
