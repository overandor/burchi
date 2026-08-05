import { timingSafeEqual } from "node:crypto";

export class SpinorAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 503,
  ) {
    super(message);
    this.name = "SpinorAccessError";
  }
}

function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function suppliedToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return request.headers.get("x-spinor-token")?.trim() || null;
}

function allowedOrganizations(): Set<string> {
  return new Set(
    (process.env.SPINOR_ALLOWED_ORGANIZATIONS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/**
 * Temporary service-token boundary until authenticated organization membership
 * is wired to the application session. Production fails closed.
 */
export function authorizeSpinorRequest(request: Request, organizationId?: string): void {
  const expectedToken = process.env.SPINOR_API_TOKEN?.trim();
  const production = process.env.NODE_ENV === "production";

  if (!expectedToken) {
    if (production) {
      throw new SpinorAccessError("SPINOR_API_TOKEN is required in production.", 503);
    }
    return;
  }

  const actualToken = suppliedToken(request);
  if (!actualToken || !secureEquals(actualToken, expectedToken)) {
    throw new SpinorAccessError("Invalid or missing SPINOR API token.", 401);
  }

  if (!organizationId) return;

  const allowed = allowedOrganizations();
  if (production && allowed.size === 0) {
    throw new SpinorAccessError("SPINOR_ALLOWED_ORGANIZATIONS is required in production.", 503);
  }
  if (allowed.size > 0 && !allowed.has("*") && !allowed.has(organizationId)) {
    throw new SpinorAccessError("The token is not authorized for this organization.", 403);
  }
}
