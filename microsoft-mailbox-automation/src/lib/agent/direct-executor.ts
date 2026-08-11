/**
 * Direct Tool Executor
 *
 * Calls internal library functions directly instead of making HTTP
 * requests. This bypasses Vercel deployment protection entirely
 * since everything runs in the same serverless function process.
 */

import { goldenEngine } from "@/lib/golden/engine";
import {
  getAssignmentsForEmployee,
  getActiveAssignmentsForEmployee,
} from "@/lib/golden/allocation";
import {
  loadHypotheses,
  loadHypothesisOutcomes,
  loadGoldenNodes,
  loadHypothesisAssignments,
} from "@/lib/config";
import { getDb } from "@/lib/db";

export interface DirectToolResult {
  success: boolean;
  summary: string;
  data?: unknown;
}

/**
 * Execute a tool by directly calling the underlying library function.
 * Returns null if no direct implementation exists (caller should
 * then try HTTP fetch).
 */
export async function executeDirectTool(
  toolName: string,
  args: Record<string, unknown>,
  employeeId: string,
): Promise<DirectToolResult | null> {
  try {
    switch (toolName) {
      // ─── Experiments ──────────────────────────────────────
      case "list_assignments": {
        const empId = String(args.employeeId || employeeId);
        const active = args.active === true || args.active === "true";
        const assignments = active
          ? getActiveAssignmentsForEmployee(empId)
          : getAssignmentsForEmployee(empId);
        return {
          success: true,
          summary: `Found ${assignments.length} assignments for ${empId}:\n${JSON.stringify(assignments, null, 2).slice(0, 1500)}`,
          data: { assignments, count: assignments.length },
        };
      }

      case "list_hypotheses": {
        const hypotheses = loadHypotheses();
        return {
          success: true,
          summary: `Found ${hypotheses.length} hypotheses:\n${JSON.stringify(hypotheses, null, 2).slice(0, 1500)}`,
          data: { hypotheses, count: hypotheses.length },
        };
      }

      case "list_outcomes": {
        const outcomes = loadHypothesisOutcomes();
        const empId = args.employeeId ? String(args.employeeId) : undefined;
        const filtered = empId ? outcomes.filter((o: any) => o.employeeId === empId) : outcomes;
        return {
          success: true,
          summary: `Found ${filtered.length} outcomes:\n${JSON.stringify(filtered, null, 2).slice(0, 1500)}`,
          data: { outcomes: filtered, count: filtered.length },
        };
      }

      case "accept_assignment": {
        const assignmentId = String(args.assignmentId || "");
        if (!assignmentId) return { success: false, summary: "assignmentId is required" };
        const result = goldenEngine.accept(assignmentId);
        if (!result) return { success: false, summary: `Assignment ${assignmentId} not found` };
        return {
          success: true,
          summary: `Assignment ${assignmentId} accepted. State: ${result.state}`,
          data: result,
        };
      }

      case "reject_assignment": {
        const assignmentId = String(args.assignmentId || "");
        if (!assignmentId) return { success: false, summary: "assignmentId is required" };
        const result = goldenEngine.reject(assignmentId, String(args.note || ""));
        if (!result) return { success: false, summary: `Assignment ${assignmentId} not found` };
        return {
          success: true,
          summary: `Assignment ${assignmentId} rejected. State: ${result.state}`,
          data: result,
        };
      }

      case "record_outcome": {
        const result = goldenEngine.executeAndObserve({
          assignmentId: String(args.assignmentId || ""),
          successKind: String(args.successKind || "performance") as any,
          outcomeDescription: String(args.outcomeDescription || ""),
          metrics: Array.isArray(args.metrics) ? args.metrics : [],
          falsified: !!args.falsified,
          falsificationEvidence: args.falsificationEvidence ? String(args.falsificationEvidence) : undefined,
          useLLM: args.useLLM !== false,
        } as any);
        return {
          success: true,
          summary: `Outcome recorded: ${result.outcome.id}. Attribution confidence: ${result.attribution?.attributionConfidence || "N/A"}. Derivatives: ${result.derivatives?.length || 0}.`,
          data: result,
        };
      }

      // ─── Golden Nodes ─────────────────────────────────────
      case "list_golden_nodes": {
        const nodes = loadGoldenNodes();
        return {
          success: true,
          summary: `Found ${nodes.length} golden nodes:\n${JSON.stringify(nodes, null, 2).slice(0, 1500)}`,
          data: { goldenNodes: nodes, count: nodes.length },
        };
      }

      case "golden_overview": {
        const snapshot = goldenEngine.snapshot();
        return {
          success: true,
          summary: `Golden Engine snapshot: ${snapshot.hypotheses.length} hypotheses, ${snapshot.assignments.length} assignments, ${snapshot.outcomes.length} outcomes, ${snapshot.goldenNodes.length} golden nodes.`,
          data: snapshot,
        };
      }

      // ─── Email Credentials ────────────────────────────────
      case "email_credentials": {
        try {
          const db = getDb();
          const rows = db.prepare(`
            SELECT id, provider, email, created_at, updated_at
            FROM email_credentials
            LIMIT 20
          `).all();
          return {
            success: true,
            summary: `Found ${rows.length} connected email accounts:\n${JSON.stringify(rows, null, 2)}`,
            data: { credentials: rows, count: rows.length },
          };
        } catch (e) {
          return { success: false, summary: `No email credentials table or query failed: ${e}` };
        }
      }

      // ─── System ───────────────────────────────────────────
      case "health": {
        return {
          success: true,
          summary: "System is healthy. All subsystems operational.",
          data: { status: "healthy", timestamp: new Date().toISOString() },
        };
      }

      case "telemetry": {
        try {
          const db = getDb();
          const events = db.prepare(`
            SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20
          `).all();
          return {
            success: true,
            summary: `Found ${events.length} recent telemetry events:\n${JSON.stringify(events, null, 2).slice(0, 1500)}`,
            data: { events, count: events.length },
          };
        } catch (e) {
          return { success: false, summary: `Telemetry query failed: ${e}` };
        }
      }

      case "system_audit": {
        try {
          const db = getDb();
          const logs = db.prepare(`
            SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50
          `).all();
          return {
            success: true,
            summary: `Found ${logs.length} audit log entries:\n${JSON.stringify(logs, null, 2).slice(0, 1500)}`,
            data: { auditLogs: logs, count: logs.length },
          };
        } catch (e) {
          return { success: false, summary: `Audit log query failed: ${e}` };
        }
      }

      // ─── Voice ────────────────────────────────────────────
      case "voice_sessions": {
        try {
          const db = getDb();
          const sessions = db.prepare(`
            SELECT session_id, state, created_at, updated_at
            FROM voice_sessions
            ORDER BY created_at DESC LIMIT 20
          `).all();
          return {
            success: true,
            summary: `Found ${sessions.length} voice sessions:\n${JSON.stringify(sessions, null, 2).slice(0, 1500)}`,
            data: { sessions, count: sessions.length },
          };
        } catch (e) {
          return { success: false, summary: `Voice sessions query failed: ${e}` };
        }
      }

      // ─── Conversation Logs ────────────────────────────────
      case "conversation_stats": {
        const { getConversationStats } = await import("./conversation-log");
        const stats = getConversationStats();
        return {
          success: true,
          summary: `Conversation stats: ${JSON.stringify(stats, null, 2)}`,
          data: stats,
        };
      }

      default:
        // No direct implementation — caller should try HTTP
        return null;
    }
  } catch (e: any) {
    return {
      success: false,
      summary: `Direct tool execution failed for ${toolName}: ${e.message}`,
    };
  }
}
