import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateTelemetry } from "../telemetry/engine";

describe("telemetry engine", () => {
  it("returns valid report on empty input (success path)", () => {
    const report = generateTelemetry([], "test@mailbox.local");
    assert.ok(report, "report should be truthy");
    assert.ok(Array.isArray(report.aggregateMetrics), "aggregateMetrics should be an array");
    assert.ok(Array.isArray(report.revenueByCategory), "revenueByCategory should be an array");
    assert.ok(Array.isArray(report.topInsights), "topInsights should be an array");
    assert.ok(Array.isArray(report.efficiencyGains), "efficiencyGains should be an array");
    assert.ok(Array.isArray(report.users), "users should be an array");
  });

  it("does not crash on malformed records (failure path)", () => {
    const malformed = [
      null,
      undefined,
      {},
      { id: "x" },
      { extractedData: null },
      { extractedData: { fields: "not-an-array" } },
    ] as any[];
    const report = generateTelemetry(malformed, "test@mailbox.local");
    assert.ok(report, "should return a report even on malformed input");
    assert.ok(Array.isArray(report.aggregateMetrics), "aggregateMetrics should still be an array");
  });

  it("computes metrics from valid records", () => {
    const records = [
      {
        id: "r1",
        subject: "Test",
        sender: "sender@test.com",
        category: "Environmental Data",
        extractedData: {
          fields: [
            { key: "ph", value: "7.8", type: "scientific_value", confidence: 0.9 },
            { key: "temperature", value: "22.4", type: "number", unit: "C", confidence: 0.95 },
          ],
          tables: [{ name: "data", headers: ["a"], rows: [{ a: 1 }], source: "attachment" }],
          summary: "Test summary",
          confidence: 0.9,
        },
      },
    ] as any[];
    const report = generateTelemetry(records, "test@mailbox.local");
    assert.ok(report.aggregateMetrics.length > 0, "should have aggregate metrics");
    assert.ok(report.users.length > 0, "should have user data");
  });
});
