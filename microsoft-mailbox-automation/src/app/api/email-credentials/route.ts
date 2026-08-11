import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  saveCredential,
  getCredentialsForUser,
  deleteCredential,
  toSafeView,
  type EmailProvider,
} from "@/lib/auth/credential-store";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * GET /api/email-credentials
 *   List the current user's stored email credentials (safe view — no tokens).
 */
export async function GET() {
  try {
    const ctx = await getAuthContext();
    const creds = getCredentialsForUser(ctx.orgId, ctx.user.id);
    return NextResponse.json({ credentials: creds.map(toSafeView) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/email-credentials
 *   Save or update a stored email credential.
 *
 * Body:
 *   provider: "gmail" | "microsoft"
 *   email: string (mailbox address)
 *   refreshToken: string
 *   accessToken?: string
 *   accessTokenExpiresAt?: string (ISO)
 *   metadata?: Record<string, any>
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await request.json().catch(() => ({}));

    const provider = body.provider as EmailProvider;
    const email = body.email as string;
    const refreshToken = body.refreshToken as string;

    if (!provider || !["gmail", "microsoft"].includes(provider)) {
      return NextResponse.json({ error: "provider must be 'gmail' or 'microsoft'" }, { status: 400 });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    if (!refreshToken || refreshToken.length < 10) {
      return NextResponse.json({ error: "refreshToken is required" }, { status: 400 });
    }

    const cred = saveCredential({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      provider,
      email,
      refreshToken,
      accessToken: body.accessToken || undefined,
      accessTokenExpiresAt: body.accessTokenExpiresAt || undefined,
      metadata: body.metadata || {},
    });

    return NextResponse.json({ credential: toSafeView(cred) });
  } catch (e: any) {
    console.error("[email-credentials] save error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/email-credentials?id=<credId>
 *   Remove a stored credential.
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }
    const ok = deleteCredential(ctx.orgId, ctx.user.id, id);
    if (!ok) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
