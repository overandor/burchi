import { NextRequest, NextResponse } from "next/server";
import { getRequestOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const origin = getRequestOrigin(request);

  if (error) {
    return NextResponse.redirect(`${origin}/?gmail_error=${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?gmail_error=no_code`);
  }

  // Redirect to client-side page that will exchange the code using localStorage credentials
  return NextResponse.redirect(`${origin}/gmail/connect?code=${encodeURIComponent(code)}`);
}
