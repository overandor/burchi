/**
 * Catch-all API proxy route.
 *
 * Forwards all /api/* requests to the backend (autonomous-rev-ops).
 * This makes the frontend work both locally and non-locally:
 *   - Locally: proxies to http://127.0.0.1:8002
 *   - Deployed: proxies to NEXT_PUBLIC_API_URL or BACKEND_URL
 *
 * The frontend client (src/lib/api.ts) uses relative URLs (/api/...)
 * so it hits this proxy regardless of deployment target.
 */

import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://autonomous-rev-ops.vercel.app"

async function proxy(request: NextRequest, path: string[]) {
  const search = request.nextUrl.search || ""
  const url = `${BACKEND_URL}/api/${path.join("/")}${search}`

  const init: RequestInit = {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
    },
  }

  // Forward body for non-GET requests
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const body = await request.text()
      if (body) init.body = body
    } catch {
      // no body
    }
  }

  try {
    const res = await fetch(url, init)
    const data = await res.text()
    return new NextResponse(data, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable", backend: BACKEND_URL },
      { status: 502 }
    )
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxy(request, path)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxy(request, path)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxy(request, path)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxy(request, path)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxy(request, path)
}
