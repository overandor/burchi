import { NextRequest, NextResponse } from "next/server";
import { loginWithEmail, setSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orgSlug, email, password } = body;

    if (!orgSlug || !email || !password) {
      return NextResponse.json(
        { error: "orgSlug, email, and password are required" },
        { status: 400 },
      );
    }

    const result = loginWithEmail(orgSlug, email, password);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Login failed" },
        { status: 401 },
      );
    }

    setSessionCookie(result.token!);

    return NextResponse.json({
      success: true,
      redirect: "/today",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Internal error" },
      { status: 500 },
    );
  }
}
