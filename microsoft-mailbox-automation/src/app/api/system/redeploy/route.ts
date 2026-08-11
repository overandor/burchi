import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/system/redeploy
 * Triggers a Vercel redeployment of the current application.
 * Requires VERCEL_TOKEN and VERCEL_PROJECT_ID environment variables.
 */
export async function POST(request: NextRequest) {
  try {
    const token = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;

    if (!token) {
      return NextResponse.json({
        success: false,
        error: "VERCEL_TOKEN is not configured. Set it in your environment variables to enable self-redeployment.",
      }, { status: 400 });
    }

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: "VERCEL_PROJECT_ID is not configured. Set it in your environment variables.",
      }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const target = body.target || "production";
    const gitSource = body.gitSource || null;

    const deployBody: Record<string, unknown> = {
      name: projectId,
      target,
      project: projectId,
    };

    if (gitSource) {
      deployBody.gitSource = gitSource;
    } else {
      deployBody.gitSource = {
        type: "github",
        ref: body.ref || "main",
        repo: body.repo || process.env.VERCEL_GIT_REPO || "",
      };
    }

    const res = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(deployBody),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Vercel API error: ${data.error?.message || res.statusText}`,
        details: data,
      }, { status: res.status });
    }

    return NextResponse.json({
      success: true,
      deploymentId: data.id,
      url: data.url ? `https://${data.url}` : null,
      state: data.state,
      target: data.target,
      created: data.created,
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e.message,
    }, { status: 500 });
  }
}

/**
 * GET /api/system/redeploy
 * Check deployment status by deployment ID.
 */
export async function GET(request: NextRequest) {
  try {
    const token = process.env.VERCEL_TOKEN;
    const { searchParams } = new URL(request.url);
    const deploymentId = searchParams.get("deploymentId");

    if (!token) {
      return NextResponse.json({ error: "VERCEL_TOKEN not configured" }, { status: 400 });
    }

    if (!deploymentId) {
      return NextResponse.json({ error: "deploymentId query parameter required" }, { status: 400 });
    }

    const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || res.statusText }, { status: res.status });
    }

    return NextResponse.json({
      deploymentId: data.id,
      state: data.state,
      url: data.url ? `https://${data.url}` : null,
      ready: data.readyState === "READY",
      error: data.errorMessage || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
