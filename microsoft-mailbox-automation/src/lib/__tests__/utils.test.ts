import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeJson } from "../utils";

describe("safeJson", () => {
  it("parses valid JSON", () => {
    assert.deepEqual(safeJson('{"a":1}'), { a: 1 });
  });

  it("parses valid JSON array", () => {
    assert.deepEqual(safeJson('[1,2,3]'), [1, 2, 3]);
  });

  it("returns null for HTML response", () => {
    assert.equal(safeJson("<html><body>error</body></html>"), null);
  });

  it("returns null for doctype response", () => {
    assert.equal(safeJson("<!DOCTYPE html><html>"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(safeJson(""), null);
  });

  it("returns null for null input", () => {
    assert.equal(safeJson(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(safeJson(undefined), null);
  });

  it("returns null for whitespace-only string", () => {
    assert.equal(safeJson("   \n\t  "), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(safeJson("{not json}"), null);
  });

  it("trims whitespace before parsing", () => {
    assert.deepEqual(safeJson('  {"ok":true}  '), { ok: true });
  });

  it("handles JSON starting with whitespace then HTML", () => {
    assert.equal(safeJson("  <html>"), null);
  });
});
