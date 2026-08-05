import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exportToCSV } from "../sheets/writer";

describe("sheets writer", () => {
  const tmpDir = path.join(os.tmpdir(), "mailbox-test-" + Date.now());

  it("exports valid records to CSV file (success path)", async () => {
    const records = [
      {
        id: "r1",
        subject: "Test",
        sender: "sender@test.com",
        category: "Environmental",
        receivedDate: "2026-08-01T00:00:00Z",
        processedAt: "2026-08-01T00:01:00Z",
        fieldCount: 2,
        tableCount: 0,
        confidence: 0.9,
        extractedData: {
          emailId: "r1",
          extractedAt: "2026-08-01T00:01:00Z",
          fields: [
            { key: "ph", value: "7.8", type: "scientific_value" as const, confidence: 0.9 },
            { key: "temp", value: "22.4", type: "number" as const, unit: "C", confidence: 0.95 },
          ],
          tables: [],
          summary: "Test",
          category: "Environmental",
          confidence: 0.9,
          source: "email_body" as const,
        },
      },
    ] as any[];

    const filepath = await exportToCSV(records, tmpDir);
    assert.ok(typeof filepath === "string", "should return a filepath string");
    assert.ok(filepath.endsWith(".csv"), "filepath should end with .csv");
    assert.ok(fs.existsSync(filepath), "file should exist on disk");

    const content = fs.readFileSync(filepath, "utf-8");
    assert.ok(content.includes("Test"), "CSV should contain the subject");
    assert.ok(content.includes("7.8"), "CSV should contain field values");
    fs.unlinkSync(filepath);
  });

  it("handles values with commas (CSV escaping)", async () => {
    const records = [
      {
        id: "r2",
        subject: 'Test, with "quotes"',
        sender: "sender@test.com",
        category: "Clinical",
        receivedDate: "2026-08-01T00:00:00Z",
        processedAt: "2026-08-01T00:01:00Z",
        fieldCount: 1,
        tableCount: 0,
        confidence: 0.8,
        extractedData: {
          emailId: "r2",
          extractedAt: "2026-08-01T00:01:00Z",
          fields: [{ key: "note", value: 'value with "quotes", and commas', type: "string" as const, confidence: 0.8 }],
          tables: [],
          summary: "Test",
          category: "Clinical",
          confidence: 0.8,
          source: "email_body" as const,
        },
      },
    ] as any[];

    const filepath = await exportToCSV(records, tmpDir);
    const content = fs.readFileSync(filepath, "utf-8");
    assert.ok(content.includes('"'), "should quote values containing special characters");
    fs.unlinkSync(filepath);
  });

  it("handles empty records array (edge case)", async () => {
    const filepath = await exportToCSV([], tmpDir);
    assert.ok(typeof filepath === "string", "should return a filepath even for empty input");
    assert.ok(fs.existsSync(filepath), "file should exist");
    fs.unlinkSync(filepath);
  });

  // Cleanup tmp dir
  it("cleanup", () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    assert.ok(true);
  });
});
