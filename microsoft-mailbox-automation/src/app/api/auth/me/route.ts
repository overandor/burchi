import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  return NextResponse.json({
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      role: ctx.user.role,
      therapeuticArea: ctx.user.therapeutic_area,
    },
    orgId: ctx.orgId,
    isAuthenticated: ctx.isAuthenticated,
  });
}
