import { test } from "node:test";
import assert from "node:assert/strict";

import { getDemoDataPolicy } from "../spinor/demo-policy";

test("production defaults to real empty state", () => {
  const policy = getDemoDataPolicy({ NODE_ENV: "production" });
  assert.equal(policy.enabled, false);
  assert.equal(policy.source, "NODE_ENV_DEFAULT");
});

test("development defaults to demo fixtures", () => {
  const policy = getDemoDataPolicy({ NODE_ENV: "development" });
  assert.equal(policy.enabled, true);
});

test("SPINOR_DEMO_MODE explicitly enables fixtures in production", () => {
  const policy = getDemoDataPolicy({
    NODE_ENV: "production",
    SPINOR_DEMO_MODE: "true",
  });
  assert.equal(policy.enabled, true);
  assert.equal(policy.source, "SPINOR_DEMO_MODE");
});

test("SPINOR_DEMO_MODE overrides legacy NEXT_PUBLIC_DEMO", () => {
  const policy = getDemoDataPolicy({
    NODE_ENV: "production",
    SPINOR_DEMO_MODE: "false",
    NEXT_PUBLIC_DEMO: "true",
  });
  assert.equal(policy.enabled, false);
  assert.equal(policy.source, "SPINOR_DEMO_MODE");
});

test("common boolean flag variants are accepted", () => {
  for (const value of ["1", "TRUE", "yes", "On"]) {
    assert.equal(
      getDemoDataPolicy({ NODE_ENV: "production", SPINOR_DEMO_MODE: value }).enabled,
      true,
    );
  }
});
