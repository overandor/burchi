export interface DemoRuntimeEnv {
  NODE_ENV?: string;
  SPINOR_DEMO_MODE?: string;
  NEXT_PUBLIC_DEMO?: string;
}

export interface DemoDataPolicy {
  enabled: boolean;
  source: "SPINOR_DEMO_MODE" | "NEXT_PUBLIC_DEMO" | "NODE_ENV_DEFAULT";
  reason: string;
}

function parseBooleanFlag(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Demo records must be explicitly enabled in production.
 *
 * Development and test environments keep the existing convenient seed
 * behavior unless an explicit flag disables it. Production defaults to an
 * empty real-data state so fixtures cannot silently masquerade as evidence.
 */
export function getDemoDataPolicy(
  env: DemoRuntimeEnv = process.env,
): DemoDataPolicy {
  if (env.SPINOR_DEMO_MODE !== undefined) {
    const enabled = parseBooleanFlag(env.SPINOR_DEMO_MODE);
    return {
      enabled,
      source: "SPINOR_DEMO_MODE",
      reason: enabled
        ? "SPINOR_DEMO_MODE explicitly enables development fixtures."
        : "SPINOR_DEMO_MODE explicitly disables development fixtures.",
    };
  }

  if (env.NEXT_PUBLIC_DEMO !== undefined) {
    const enabled = parseBooleanFlag(env.NEXT_PUBLIC_DEMO);
    return {
      enabled,
      source: "NEXT_PUBLIC_DEMO",
      reason: enabled
        ? "NEXT_PUBLIC_DEMO explicitly enables development fixtures."
        : "NEXT_PUBLIC_DEMO explicitly disables development fixtures.",
    };
  }

  const enabled = env.NODE_ENV !== "production";
  return {
    enabled,
    source: "NODE_ENV_DEFAULT",
    reason: enabled
      ? "Non-production environments default to demo fixtures for local development."
      : "Production defaults to real empty states until evidence is connected.",
  };
}
