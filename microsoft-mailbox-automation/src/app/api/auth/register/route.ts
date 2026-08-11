import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      orgSlug,
      orgName,
      email,
      password,
      name,
      role,
      therapeuticArea,
      setupToken,
    } = body;

    if (!orgSlug || !email || !password || !name) {
      return NextResponse.json(
        { error: "orgSlug, email, password, and name are required" },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    const result = registerUser({
      orgSlug,
      orgName,
      email,
      password,
      name,
      role,
      therapeuticArea,
      setupToken,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Registration failed" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: result.user!.id,
        email: result.user!.email,
        name: result.user!.name,
        role: result.user!.role,
        orgId: result.user!.org_id,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Internal error" },
      { status: 500 },
    );
  }
}
