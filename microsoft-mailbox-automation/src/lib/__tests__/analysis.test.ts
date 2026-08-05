import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateAnalysis } from "../analysis/generator";

describe("analysis generator", () => {
  it("returns valid analysis on normal input (success path)", () => {
    const analysis = generateAnalysis({
      id: "test-1",
      subject: "Test Subject",
      sender: "sender@test.com",
      receivedDate: new Date().toISOString(),
      body: "This is a test email about pH levels and temperature readings.",
      attachments: [],
    } as any);

    assert.ok(analysis, "analysis should be truthy");
    assert.ok(analysis.wikitree, "wikitree should exist");
    assert.ok(analysis.wikitree.root, "wikitree root should exist");
    assert.ok(analysis.mindmap, "mindmap should exist");
    assert.ok(analysis.mindmap.root, "mindmap root should exist");
    assert.ok(analysis.execution, "execution should exist");
    assert.ok(Array.isArray(analysis.execution.steps), "execution steps should be an array");
  });

  it("returns minimal valid analysis on empty input (edge case)", () => {
    const analysis = generateAnalysis({
      id: "test-2",
      subject: "",
      sender: "",
      receivedDate: new Date().toISOString(),
      body: "",
      attachments: [],
    } as any);

    assert.ok(analysis, "should return analysis even on empty input");
    assert.ok(analysis.wikitree?.root, "wikitree root should exist");
    assert.ok(analysis.mindmap?.root, "mindmap root should exist");
    assert.ok(analysis.execution, "execution should exist");
  });

  it("handles attachments with parsed data (success path)", () => {
    const analysis = generateAnalysis({
      id: "test-3",
      subject: "Lab Results",
      sender: "lab@test.com",
      receivedDate: new Date().toISOString(),
      body: "Spectroscopy results attached.",
      attachments: [
        {
          name: "data.csv",
          type: "csv",
          parsedData: {
            type: "csv",
            rows: [{ site: "S1", ph: 7.6 }],
            metadata: { rowCount: 1, headers: ["site", "ph"] },
          },
        },
      ],
    } as any);

    assert.ok(analysis, "should return analysis with attachments");
    assert.ok(analysis.wikitree?.root, "wikitree should exist");
  });
});
