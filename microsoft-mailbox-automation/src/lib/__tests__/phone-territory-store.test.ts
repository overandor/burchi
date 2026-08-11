import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.EMAIL_CRED_KEY = "a".repeat(64);

import {
  createPhoneRecord,
  getPhoneRecords,
  deletePhoneRecord,
  addPhoneEvent,
  getPhoneEvents,
  getPhoneEventSummary,
  createTerritoryAccount,
  getTerritoryAccounts,
  updateTerritoryAccount,
  deleteTerritoryAccount,
  createFieldRoute,
  getFieldRoutes,
  updateFieldRouteStatus,
} from "@/lib/phone/server-store";
import { ensureDefaultOrg, DEFAULT_ORG_ID, createUser, getUser } from "@/lib/db";

describe("phone-territory-store", () => {
  const orgId = DEFAULT_ORG_ID;
  const userId = "test-user-phone-001";

  beforeEach(() => {
    ensureDefaultOrg();
    if (!getUser(userId)) {
      createUser(userId, orgId, `${userId}@test.local`, `Test ${userId}`, "field_rep", null);
    }
  });

  // ─── Phone Records ───────────────────────────────────────────────

  it("creates and retrieves a phone record", () => {
    const record = createPhoneRecord(orgId, userId, "+15551234567", "Test Phone 1");
    assert.ok(record.id);
    assert.equal(record.phoneNumber, "+15551234567");
    assert.equal(record.label, "Test Phone 1");

    const records = getPhoneRecords(orgId, userId);
    assert.ok(records.some((r) => r.id === record.id));
  });

  it("validates phone number format", () => {
    assert.throws(() => createPhoneRecord(orgId, userId, "abc", "Bad"), /7-15 digits/);
    assert.throws(() => createPhoneRecord(orgId, userId, "123", "Too Short"), /7-15 digits/);
  });

  it("deletes a phone record", () => {
    const record = createPhoneRecord(orgId, userId, "+15559876543", "To Delete");
    const ok = deletePhoneRecord(orgId, userId, record.id);
    assert.equal(ok, true);
    const records = getPhoneRecords(orgId, userId);
    assert.ok(!records.some((r) => r.id === record.id));
  });

  it("adds events to a phone record", () => {
    const record = createPhoneRecord(orgId, userId, "+15551112222", "Event Test");
    const event = addPhoneEvent(orgId, userId, record.id, {
      type: "call",
      direction: "outbound",
      durationSec: 120,
      notes: "Test call",
    });
    assert.equal(event.type, "call");
    assert.equal(event.direction, "outbound");
    assert.equal(event.durationSec, 120);

    const events = getPhoneEvents(orgId, userId, record.id);
    assert.ok(events.some((e) => e.id === event.id));
  });

  it("validates event type and direction", () => {
    const record = createPhoneRecord(orgId, userId, "+15553334444", "Validation Test");
    assert.throws(
      () => addPhoneEvent(orgId, userId, record.id, { type: "invalid", direction: "inbound" }),
      /Invalid event type/,
    );
    assert.throws(
      () => addPhoneEvent(orgId, userId, record.id, { type: "call", direction: "sideways" }),
      /Invalid direction/,
    );
  });

  it("computes phone event summary", () => {
    const uniquePhone = `+1555${Date.now().toString().slice(-6)}`;
    const record = createPhoneRecord(orgId, userId, uniquePhone, "Summary Test");
    addPhoneEvent(orgId, userId, record.id, { type: "call", direction: "outbound", durationSec: 60 });
    addPhoneEvent(orgId, userId, record.id, { type: "call", direction: "inbound", durationSec: 30 });
    addPhoneEvent(orgId, userId, record.id, { type: "sms", direction: "inbound" });

    const summary = getPhoneEventSummary(orgId, userId, record.id);
    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.totalCalls, 2);
    assert.equal(summary.totalSms, 1);
    assert.equal(summary.totalDurationSec, 90);
  });

  // ─── Territory Accounts ──────────────────────────────────────────

  it("creates and retrieves a territory account", () => {
    const account = createTerritoryAccount(orgId, userId, {
      accountName: "Hospital A",
      hcpName: "Dr. Smith",
      specialty: "Oncology",
      territory: "North Bay",
      funnelState: "consideration",
      autonomyClass: 2,
      barriers: ["formulary_access", "time_constraints"],
    });
    assert.ok(account.id);
    assert.equal(account.accountName, "Hospital A");
    assert.equal(account.hcpName, "Dr. Smith");
    assert.equal(account.funnelState, "consideration");
    assert.deepEqual(account.barriers, ["formulary_access", "time_constraints"]);

    const accounts = getTerritoryAccounts(orgId, userId);
    assert.ok(accounts.some((a) => a.id === account.id));
  });

  it("updates a territory account", () => {
    const account = createTerritoryAccount(orgId, userId, {
      accountName: "Hospital B",
      funnelState: "awareness",
    });
    const updated = updateTerritoryAccount(orgId, userId, account.id, {
      funnelState: "interest",
      autonomyClass: 3,
      priorityScore: 75.5,
    });
    if (!updated) throw new Error("updateTerritoryAccount returned null");
    assert.equal(updated.funnelState, "interest");
    assert.equal(updated.autonomyClass, 3);
    assert.equal(updated.priorityScore, 75.5);
  });

  it("deletes a territory account", () => {
    const account = createTerritoryAccount(orgId, userId, {
      accountName: "Hospital C",
    });
    const ok = deleteTerritoryAccount(orgId, userId, account.id);
    assert.equal(ok, true);
    const accounts = getTerritoryAccounts(orgId, userId);
    assert.ok(!accounts.some((a) => a.id === account.id));
  });

  it("validates account name", () => {
    assert.throws(() => createTerritoryAccount(orgId, userId, { accountName: "" }), /accountName is required/);
    assert.throws(() => createTerritoryAccount(orgId, userId, { accountName: "x" }), /accountName is required/);
  });

  // ─── Field Routes ────────────────────────────────────────────────

  it("creates and retrieves a field route", () => {
    const route = createFieldRoute(orgId, userId, {
      date: "2026-08-06",
      stops: [
        { accountId: "acc1", order: 1, plannedTime: "09:00" },
        { accountId: "acc2", order: 2, plannedTime: "10:30" },
      ],
    });
    assert.ok(route.id);
    assert.equal(route.date, "2026-08-06");
    assert.equal(route.stops.length, 2);
    assert.equal(route.status, "planned");

    const routes = getFieldRoutes(orgId, userId);
    assert.ok(routes.some((r) => r.id === route.id));
  });

  it("filters routes by date", () => {
    createFieldRoute(orgId, userId, { date: "2026-08-06" });
    createFieldRoute(orgId, userId, { date: "2026-08-07" });

    const aug6 = getFieldRoutes(orgId, userId, "2026-08-06");
    assert.ok(aug6.every((r) => r.date === "2026-08-06"));
  });

  it("updates route status", () => {
    const route = createFieldRoute(orgId, userId, { date: "2026-08-06" });
    const updated = updateFieldRouteStatus(orgId, userId, route.id, "active");
    if (!updated) throw new Error("updateFieldRouteStatus returned null");
    assert.equal(updated.status, "active");
  });

  it("validates route status", () => {
    const route = createFieldRoute(orgId, userId, { date: "2026-08-06" });
    assert.throws(
      () => updateFieldRouteStatus(orgId, userId, route.id, "invalid"),
      /Invalid status/,
    );
  });
});
