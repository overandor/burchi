import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { ensureStrategiesSeeded } from "@/lib/strategy/library";
import { getStrategyPerformance } from "@/lib/strategy/attribution";
import { loadStrategyAssignments } from "@/lib/config";
import { StrategyMarketplaceEntry, RoleType } from "@/types";

export async function GET(_req: NextRequest) {
  try {
    const strategies = ensureStrategiesSeeded().filter((s) => !s.deprecated);
    const assignments = loadStrategyAssignments();

    const entries: StrategyMarketplaceEntry[] = [];

    for (const strategy of strategies) {
      const perf = getStrategyPerformance(strategy.id);
      const strategyAssignments = assignments.filter((a) => a.strategyId === strategy.id);
      const contributorAssignment = strategyAssignments.find((a) => a.employeeId === strategy.originEmployeeId) || strategyAssignments[0];

      entries.push({
        strategyId: strategy.id,
        strategy,
        contributorEmployeeId: strategy.originEmployeeId || contributorAssignment?.employeeId || "system",
        contributorRole: (contributorAssignment?.employeeRole || "field_representative") as RoleType,
        adoptionCount: perf?.adoptionCount || strategyAssignments.length,
        successRate: perf?.successRate || 0,
        averageContribution: perf?.averageContribution || 0,
        evidenceLevel: strategy.evidenceLevel,
        tags: [strategy.domain, strategy.strategyClass],
        featured: strategy.evidenceLevel === "experimentally_supported" && (perf?.successRate || 0) > 0.7,
        listedAt: strategy.createdAt,
      });
    }

    // Sort by success rate * average contribution (impact score)
    entries.sort((a, b) => (b.successRate * b.averageContribution) - (a.successRate * a.averageContribution));

    return NextResponse.json({ marketplace: entries, count: entries.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
