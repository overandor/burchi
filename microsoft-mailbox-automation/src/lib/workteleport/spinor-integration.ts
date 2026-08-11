/**
 * SPINOR-RL ↔ WORKTELEPORT Integration
 *
 * Wires the SPINOR-RL mission system to the new WORKTELEPORT-RL architecture:
 * - Daily missions now include experiment twin candidates
 * - Skill genome triggers suggest automation opportunities
 * - Venture capsule candidates are surfaced from validated workflows
 * - Dissected hypotheses feed into the mission allocation engine
 */

import { getDb, DEFAULT_ORG_ID } from "@/lib/db";
import { listWorkflows, countWorkflows } from "@/lib/workteleport/workflow-runtime";
import { listSkills, getMaturityDistribution, findMatchingSkill } from "@/lib/workteleport/skill-genome";
import { listTwins, proposeTwinCandidates, countTwins } from "@/lib/workteleport/experiment-twin";
import { listVentures, countVentures } from "@/lib/workteleport/venture-capsule";
import { listDissectedHypotheses, countDissectedHypotheses } from "@/lib/workteleport/dissect";
import { listTaskIRs, countTaskIRs } from "@/lib/workteleport/compiler";
import { listCommitRecords, countCommitRecords } from "@/lib/workteleport/commit-gate";
import { countContinuity } from "@/lib/workteleport/continuity";
import { countCapabilities, seedDefaultCapabilities } from "@/lib/workteleport/capability-graph";
import { getCoinedTerms, ACTION_REWARDS } from "@/lib/workteleport/taxonomy";

export interface WorkteleportDashboard {
  counts: {
    evidence: number;
    tasks: number;
    workflows: number;
    commits: number;
    skills: number;
    twins: number;
    ventures: number;
    hypotheses: number;
    capabilities: number;
    continuity: number;
  };
  skillDistribution: Record<string, number>;
  recentWorkflows: any[];
  recentTwins: any[];
  ventureCandidates: any[];
  automationOpportunities: any[];
  coinedTermsCount: number;
  gameActionRewards: Record<string, number>;
}

/**
 * Get a dashboard view of the WORKTELEPORT system for SPINOR-RL integration.
 */
export function getWorkteleportDashboard(orgId: string = DEFAULT_ORG_ID): WorkteleportDashboard {
  // Ensure capabilities exist
  if (countCapabilities(orgId) === 0) {
    seedDefaultCapabilities(orgId);
  }

  const recentWorkflows = listWorkflows(orgId, undefined, undefined).slice(0, 5);
  const recentTwins = listTwins(orgId).slice(0, 5);
  const ventures = listVentures(orgId);
  const skills = listSkills(orgId);

  // Identify automation opportunities (skills that could progress to deterministic)
  const automationOpportunities = skills
    .filter((s) => s.maturity === "model_assisted" || s.maturity === "workflow_assisted")
    .filter((s) => s.usageCount >= 3)
    .map((s) => ({
      skillId: s.id,
      name: s.name,
      currentMaturity: s.maturity,
      usageCount: s.usageCount,
      suggestion: s.maturity === "model_assisted"
        ? "Ready for workflow_assisted — create a standard workflow template"
        : "Ready for deterministic — consider full automation with human checkpoint only for exceptions",
    }));

  // Identify venture capsule candidates (validated workflows with replication evidence)
  const ventureCandidates = ventures
    .filter((v) => v.status === "identified" || v.status === "validated")
    .slice(0, 5);

  return {
    counts: {
      evidence: 0, // populated by caller if needed
      tasks: countTaskIRs(orgId),
      workflows: countWorkflows(orgId),
      commits: countCommitRecords(orgId),
      skills: skills.length,
      twins: countTwins(orgId),
      ventures: countVentures(orgId),
      hypotheses: countDissectedHypotheses(orgId),
      capabilities: countCapabilities(orgId),
      continuity: countContinuity(orgId),
    },
    skillDistribution: getMaturityDistribution(orgId),
    recentWorkflows,
    recentTwins,
    ventureCandidates,
    automationOpportunities,
    coinedTermsCount: getCoinedTerms().length,
    gameActionRewards: ACTION_REWARDS,
  };
}

/**
 * Generate experiment twin candidates for active workflows.
 * This is called by the SPINOR-RL engine when generating daily missions.
 */
export function getExperimentTwinCandidates(orgId: string = DEFAULT_ORG_ID) {
  const activeWorkflows = listWorkflows(orgId, undefined, "executing");
  const candidates: {
    workflowId: string;
    twinCandidates: { permutationType: string; hypothesis: string; description: string }[];
  }[] = [];

  for (const wf of activeWorkflows) {
    const twinCandidates = proposeTwinCandidates(orgId, wf.id, wf.steps.length);
    candidates.push({ workflowId: wf.id, twinCandidates });
  }

  return candidates;
}

/**
 * Find skill genome matches for incoming content.
 * Used by the SPINOR-RL email sensing module to identify automation opportunities.
 */
export function findSkillMatches(
  orgId: string = DEFAULT_ORG_ID,
  contentType: string,
  content: string,
) {
  const match = findMatchingSkill(orgId, contentType, content);
  if (!match) return [];

  return [{
    skillId: match.id,
    name: match.name,
    maturity: match.maturity,
    usageCount: match.usageCount,
    canAutomate: match.maturity === "deterministic" || match.maturity === "workflow_assisted",
  }];
}

/**
 * Get mission suggestions that combine SPINOR-RL mission classes with
 * WORKTELEPORT system state.
 */
export function getWorkteleportMissionSuggestions(orgId: string = DEFAULT_ORG_ID) {
  const dashboard = getWorkteleportDashboard(orgId);
  const suggestions: {
    missionClass: string;
    title: string;
    description: string;
    targetType: string;
    targetId?: string;
    reward: number;
  }[] = [];

  // Suggest builder missions for automation opportunities
  for (const opp of dashboard.automationOpportunities) {
    suggestions.push({
      missionClass: "builder",
      title: `Automate: ${opp.name}`,
      description: opp.suggestion,
      targetType: "skill",
      targetId: opp.skillId,
      reward: ACTION_REWARDS.automate,
    });
  }

  // Suggest channel missions for venture candidates
  for (const venture of dashboard.ventureCandidates) {
    suggestions.push({
      missionClass: "channel",
      title: `Evaluate venture: ${venture.name}`,
      description: `Validate commercialization hypothesis: ${venture.commercializationHypothesis}`,
      targetType: "venture",
      targetId: venture.id,
      reward: ACTION_REWARDS.spin_out,
    });
  }

  // Suggest replication missions for recent completed workflows
  const completedWorkflows = listWorkflows(orgId, undefined, "completed").slice(0, 3);
  for (const wf of completedWorkflows) {
    suggestions.push({
      missionClass: "replication",
      title: `Replicate workflow ${wf.id.substring(0, 12)}`,
      description: "Test this workflow in a different context to validate reproducibility",
      targetType: "workflow",
      targetId: wf.id,
      reward: ACTION_REWARDS.replicate,
    });
  }

  // Suggest saboteur missions for deterministic skills (test if they still hold)
  const deterministicSkills = listSkills(orgId, "deterministic");
  for (const skill of deterministicSkills.slice(0, 2)) {
    suggestions.push({
      missionClass: "saboteur",
      title: `Challenge: ${skill.name}`,
      description: "Attempt to falsify this deterministic skill — has the context changed?",
      targetType: "skill",
      targetId: skill.id,
      reward: ACTION_REWARDS.challenge,
    });
  }

  // Suggest scout missions for untested hypotheses
  const hypotheses = listDissectedHypotheses(orgId)
    .filter((h) => h.researchStatus === "untested" || h.researchStatus === "plausible")
    .slice(0, 3);
  for (const h of hypotheses) {
    suggestions.push({
      missionClass: "scout",
      title: `Research: ${h.novelComponent}`,
      description: h.demoronifiedClaim,
      targetType: "hypothesis",
      targetId: h.id,
      reward: ACTION_REWARDS.plant,
    });
  }

  return suggestions;
}
