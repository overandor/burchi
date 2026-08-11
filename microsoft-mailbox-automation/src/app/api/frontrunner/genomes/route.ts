import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  getProductGenomes,
  getProductGenome,
  generateProductGenome,
  generateVariants,
  compileWorkflowGenome,
} from "@/lib/frontrunner";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "list";

    if (action === "list") {
      const genomes = getProductGenomes(ctx.orgId, 50);
      return NextResponse.json({ genomes, count: genomes.length });
    }

    if (action === "get") {
      const id = searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const genome = getProductGenome(ctx.orgId, id);
      if (!genome) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(genome);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await req.json();
    const { action } = body;

    if (action === "generate") {
      const { opportunityId, branchType } = body;
      if (!opportunityId || typeof opportunityId !== "string") {
        return NextResponse.json({ error: "opportunityId required" }, { status: 400 });
      }
      const genome = await generateProductGenome(
        ctx.orgId,
        ctx.user.id,
        opportunityId,
        branchType || "primary",
      );
      return NextResponse.json(genome);
    }

    if (action === "generate_variants") {
      const { genomeId, variantTypes } = body;
      if (!genomeId || typeof genomeId !== "string") {
        return NextResponse.json({ error: "genomeId required" }, { status: 400 });
      }
      const variants = await generateVariants(
        ctx.orgId,
        ctx.user.id,
        genomeId,
        Array.isArray(variantTypes) ? variantTypes : ["low_cost", "high_upside", "wildcard"],
      );
      return NextResponse.json({ variants, count: variants.length });
    }

    if (action === "compile_workflow") {
      const { genomeId } = body;
      if (!genomeId || typeof genomeId !== "string") {
        return NextResponse.json({ error: "genomeId required" }, { status: 400 });
      }
      const workflow = await compileWorkflowGenome(ctx.orgId, ctx.user.id, genomeId);
      return NextResponse.json(workflow);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
