import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { AppConfig } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadConfig();
  const safeConfig = {
    ...config,
    graph: {
      ...config.graph,
      clientSecret: config.graph.clientSecret ? "***" : "",
    },
    llm: {
      ...config.llm,
      apiKey: config.llm.apiKey ? "***" : "",
    },
  };
  return NextResponse.json(safeConfig);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as Partial<AppConfig>;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a valid configuration object" }, { status: 400 });
    }

    const current = loadConfig();

    const updated: AppConfig = {
      graph: {
        clientId: body.graph?.clientId ?? current.graph.clientId,
        clientSecret: body.graph?.clientSecret && body.graph.clientSecret !== "***"
          ? body.graph.clientSecret
          : current.graph.clientSecret,
        tenantId: body.graph?.tenantId ?? current.graph.tenantId,
        mailbox: body.graph?.mailbox ?? current.graph.mailbox,
      },
      llm: {
        provider: body.llm?.provider ?? current.llm.provider,
        apiKey: body.llm?.apiKey && body.llm.apiKey !== "***"
          ? body.llm.apiKey
          : current.llm.apiKey,
        model: body.llm?.model ?? current.llm.model,
        endpoint: body.llm?.endpoint ?? current.llm.endpoint,
      },
      processing: {
        autoProcess: body.processing?.autoProcess ?? current.processing.autoProcess,
        pollInterval: body.processing?.pollInterval ?? current.processing.pollInterval,
        maxEmailsPerSync: body.processing?.maxEmailsPerSync ?? current.processing.maxEmailsPerSync,
        categories: body.processing?.categories ?? current.processing.categories,
        extractionPrompt: body.processing?.extractionPrompt ?? current.processing.extractionPrompt,
      },
      export: {
        format: body.export?.format ?? current.export.format,
        outputPath: body.export?.outputPath ?? current.export.outputPath,
      },
    };

    saveConfig(updated);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
