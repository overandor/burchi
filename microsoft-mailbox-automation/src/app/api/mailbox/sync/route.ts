import { NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { syncAndProcess } from "@/lib/pipeline";
import { validateConfig } from "@/lib/graph/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const config = loadConfig();
    const errors = validateConfig(config);

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Configuration incomplete", details: errors },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const userToken = request.headers.get("Authorization")?.replace("Bearer ", "") || undefined;
    const result = await syncAndProcess(config, {
      processAll: body.processAll || false,
      maxEmails: body.maxEmails,
      userToken,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
