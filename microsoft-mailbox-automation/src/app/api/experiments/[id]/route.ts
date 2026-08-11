import { NextRequest, NextResponse } from "next/server";
import { getExperiment } from "@/lib/experiment/governed-store";

export const dynamic = "force-dynamic";

interface Props {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Props) {
  const exp = getExperiment(decodeURIComponent(params.id));
  if (!exp) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }
  return NextResponse.json({ experiment: exp });
}
