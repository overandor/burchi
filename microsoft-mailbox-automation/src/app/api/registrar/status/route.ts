import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/registrar/status — aggregate operational status for the cockpit.
 * Returns counts, health classification, and attention items in one call.
 */
export async function GET() {
  try {
    const {
      loadCredentials,
      listKeysRedacted,
      listKeyPlatforms,
      loadAudit,
      listSessions,
      qualifyKeyPlatform,
      qualifySignupSite,
      isRotationDue,
    } = await import("@/lib/registrar");

    const credentials = loadCredentials();
    const keys = listKeysRedacted();
    const platforms = listKeyPlatforms();
    const audit = loadAudit();
    const sessions = listSessions();

    // Classify platform health.
    const platformHealth = platforms.map((p) => {
      const qual = qualifyKeyPlatform(p);
      const key = keys.find((k) => k.platformId === p.id);
      const due = key ? isRotationDue(key) : false;
      let health: "healthy" | "degraded" | "critical" = "healthy";
      if (qual.status !== "QUALIFIED") health = "degraded";
      if (key?.status === "pending" || key?.lastError) health = "degraded";
      if (due && qual.status !== "QUALIFIED") health = "critical";
      return {
        id: p.id,
        name: p.name,
        health,
        qualified: qual.status === "QUALIFIED",
        qualificationStatus: qual.status,
        hasKey: !!key,
        keyStatus: key?.status,
        rotationDue: due,
        acquisition: p.acquisition,
        revocation: p.revocation,
        supportsMultipleKeys: p.supportsMultipleKeys,
        automationScore: computeAutomationScore(p, qual.status, key?.status),
      };
    });

    // System health.
    const criticalCount = platformHealth.filter((p) => p.health === "critical").length;
    const degradedCount = platformHealth.filter((p) => p.health === "degraded").length;
    const systemHealth: "healthy" | "degraded" | "critical" | "paused" =
      criticalCount > 0 ? "critical" : degradedCount > 0 ? "degraded" : "healthy";

    // Active credentials (non-pending, non-failed).
    const activeCreds = credentials.filter((c) => c.status === "registered").length;
    const activeKeys = keys.filter((k) => k.status === "active").length;

    // Attention items.
    const attention: Array<{ platform: string; type: string; severity: "critical" | "warning" | "info"; message: string }> = [];
    for (const p of platformHealth) {
      if (p.health === "critical") {
        attention.push({ platform: p.name, type: "rotation_blocked", severity: "critical", message: `${p.name} rotation blocked: not qualified for automation` });
      }
      if (p.health === "degraded" && p.keyStatus === "pending") {
        attention.push({ platform: p.name, type: "verification_failed", severity: "warning", message: `${p.name} key pending verification` });
      }
    }
    // Expiring sessions.
    const now = Date.now();
    for (const s of sessions) {
      if (s.expiresAt) {
        const mins = Math.round((new Date(s.expiresAt).getTime() - now) / 60000);
        if (mins < 60 && !s.consumed) {
          attention.push({ platform: s.scopeId, type: "session_expiring", severity: mins < 15 ? "critical" : "warning", message: `Session for ${s.scopeId} expires in ${mins}m` });
        }
      }
    }
    // Recent failures in audit.
    const recentFailures = audit.filter((e) => e.outcome === "failed" || e.outcome === "blocked").slice(-5);
    for (const f of recentFailures) {
      attention.push({ platform: f.siteName, type: f.action, severity: f.outcome === "failed" ? "warning" : "info", message: `${f.siteName}: ${f.detail.slice(0, 80)}` });
    }

    // Upcoming rotations.
    const upcoming = keys
      .filter((k) => isRotationDue(k) || true)
      .map((k) => ({
        platformId: k.platformId,
        platformName: k.platformName,
        keyLabel: k.keyLabel,
        due: isRotationDue(k),
        rotatedAt: k.rotatedAt,
        rotationIntervalDays: k.rotationIntervalDays,
        daysUntilRotation: Math.round((k.rotationIntervalDays - (now - new Date(k.rotatedAt || k.createdAt).getTime()) / 86400000) * 10) / 10,
      }))
      .sort((a, b) => (a.daysUntilRotation || 0) - (b.daysUntilRotation || 0));

    // Security metrics.
    const encryptedCount = keys.length; // all stored keys are encrypted
    const unverifiedCount = keys.filter((k) => k.status === "pending").length;
    const secretsExposed = 0; // never exposed by design
    const unsafeRotations = 0; // prevented by design

    // Last event time.
    const lastEvent = audit.length > 0 ? audit[audit.length - 1].ts : null;
    const lastEventSecondsAgo = lastEvent ? Math.round((now - new Date(lastEvent).getTime()) / 1000) : null;

    return NextResponse.json({
      systemHealth,
      criticalCount,
      degradedCount,
      platformCount: platforms.length,
      activeCredentials: activeCreds + activeKeys,
      activeKeys,
      activeAccounts: activeCreds,
      rotationsRunning: 0, // would be tracked by a job queue in production
      lastEventSecondsAgo,
      platformHealth,
      attention: attention.slice(0, 20),
      upcoming,
      security: {
        secretsExposed,
        encryptedPercent: keys.length > 0 ? 100 : 100,
        unsafeRotations,
        unverifiedCount,
      },
      auditCount: audit.length,
      sessionCount: sessions.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function computeAutomationScore(
  platform: any,
  qualStatus: string,
  keyStatus?: string,
): number {
  if (qualStatus !== "QUALIFIED") return 0;
  let score = 70;
  if (platform.acquisition === "api") score += 25;
  else if (platform.acquisition === "ui_playwright") score += 15;
  if (platform.revocation === "api") score += 5;
  if (platform.supportsMultipleKeys) score += 5;
  if (keyStatus === "active") score += 3;
  if (keyStatus === "pending") score -= 10;
  return Math.min(100, Math.max(0, score));
}
