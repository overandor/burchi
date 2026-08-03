import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${request.nextUrl.origin}/?gmail_error=${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${request.nextUrl.origin}/?gmail_error=no_code`);
  }

  // Redirect to client-side page that will exchange the code using localStorage credentials
  return NextResponse.redirect(`${request.nextUrl.origin}/gmail/connect?code=${encodeURIComponent(code)}`);
}
