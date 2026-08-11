"use client";

import { AuditEntry, PIPELINE_STAGES, PipelineStage, smartStatus, secondsAgo } from "./types";
import { PipelineVisualization, NodeState } from "./PipelineVisualization";

interface Props {
  audit: AuditEntry[];
  platformHealth: any[];
}

export function Automation({ audit, platformHealth }: Props) {
  const recent = audit.slice(-20).reverse();
  const challenges = recent.filter((e) =>
    e.code === "INTERACTIVE_CHALLENGE_REQUIRED" ||
    e.code === "AUTOMATION_BLOCKED_BY_INTERACTIVE_CHALLENGE" ||
    e.action.includes("captcha")
  );
  const failures = recent.filter((e) => e.outcome === "failed" || (e.code && e.code !== "SUCCESS" && e.code !== "INFO"));
  const successes = recent.filter((e) => e.outcome === "success");

  // Current pipeline state from most recent events.
  const pipelineStates = derivePipelineStates(audit);

  return (
    <div className="view-enter space-y-4">
      <div>
        <h1 className="text-lg font-bold cockpit-text">Automation</h1>
        <p className="text-sm cockpit-text-dim">Live credential pipeline operations</p>
      </div>

      {/* Live Pipeline */}
      <div className="cockpit-panel rounded-xl p-6">
        <h2 className="mb-4 text-sm font-semibold cockpit-text-dim">PIPELINE STATE</h2>
        <PipelineVisualization states={pipelineStates} />
      </div>

      {/* Activity Stream */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-3 text-sm font-semibold cockpit-text-dim">LIVE AUTOMATION</h2>
        {recent.length === 0 ? (
          <EmptyState title="No automation activity" subtitle="Operations will stream here as they occur." />
        ) : (
          <div className="space-y-2">
            {recent.slice(0, 15).map((e) => (
              <ActivityCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>

      {/* Challenge Detection */}
      {challenges.length > 0 && (
        <div className="cockpit-panel rounded-xl p-5 border-[hsl(var(--cockpit-warning) / 0.3)]">
          <h2 className="mb-3 text-sm font-semibold text-[hsl(var(--cockpit-warning))]">INTERACTIVE CHALLENGES DETECTED</h2>
          <div className="space-y-3">
            {challenges.slice(0, 5).map((c) => (
              <ChallengeCard key={c.id} event={c} />
            ))}
          </div>
        </div>
      )}

      {/* Platform Automation Status */}
      <div className="cockpit-panel rounded-xl p-5">
        <h2 className="mb-3 text-sm font-semibold cockpit-text-dim">PLATFORM AUTOMATION STATUS</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {platformHealth.map((p) => (
            <div key={p.id} className="cockpit-elevated rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold cockpit-text">{p.name}</div>
                <div className="text-[10px] font-mono-tech cockpit-text-dim">
                  {p.acquisition.toUpperCase()} · {p.qualified ? "QUALIFIED" : "DISQUALIFIED"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold font-mono-tech ${
                  p.automationScore >= 80 ? "text-[hsl(var(--cockpit-healthy))]" :
                  p.automationScore >= 50 ? "text-[hsl(var(--cockpit-warning))]" :
                  "text-[hsl(var(--cockpit-text-dim))]"
                }`}>
                  {p.automationScore}%
                </span>
                <span className={`h-2 w-2 rounded-full ${
                  p.health === "healthy" ? "bg-[hsl(var(--cockpit-healthy))]" :
                  p.health === "degraded" ? "bg-[hsl(var(--cockpit-warning))]" :
                  "bg-[hsl(var(--cockpit-critical))]"
                }`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityCard({ event }: { event: AuditEntry }) {
  const smart = smartStatus(event.code);
  const isSuccess = event.outcome === "success";
  const isFailed = event.outcome === "failed";
  const isBlocked = event.outcome === "blocked";

  const chipClass = isSuccess ? "chip-healthy" : isFailed ? "chip-critical" : isBlocked ? "chip-warning" : "chip-neutral";

  return (
    <div className="cockpit-elevated card-lift rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold cockpit-text">{event.siteName}</span>
        <div className="flex items-center gap-2">
          {event.code && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono-tech ${chipClass}`}>{event.code}</span>
          )}
          <span className="text-[10px] font-mono-tech cockpit-text-dim">{secondsAgo(Math.round((Date.now() - new Date(event.ts).getTime()) / 1000))}</span>
        </div>
      </div>
      <p className="mt-1 text-xs cockpit-text-dim">{event.detail}</p>
      {event.code && event.code !== "INFO" && event.code !== "SUCCESS" && (
        <p className="mt-1 text-[10px] font-mono-tech text-[hsl(var(--cockpit-warning))]">{smart.human}</p>
      )}
    </div>
  );
}

function ChallengeCard({ event }: { event: AuditEntry }) {
  const smart = smartStatus(event.code);
  return (
    <div className="cockpit-elevated rounded-lg p-4 border-l-2 border-[hsl(var(--cockpit-warning) / 0.5)]">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold cockpit-text">{event.siteName}</span>
        <span className="chip-warning rounded px-1.5 py-0.5 text-[10px] font-mono-tech">CHALLENGE</span>
      </div>
      <p className="mt-2 text-sm cockpit-text">{smart.human}</p>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex gap-2">
          <span className="cockpit-text-dim shrink-0">Stage:</span>
          <span className="font-mono-tech text-[hsl(var(--cockpit-warning))]">{event.action.replace(/_/g, " ").toUpperCase()}</span>
        </div>
        <div className="flex gap-2">
          <span className="cockpit-text-dim shrink-0">System action:</span>
          <span className="text-[hsl(var(--cockpit-healthy))]">Flow terminated safely · no bypass attempted</span>
        </div>
      </div>
    </div>
  );
}

function derivePipelineStates(audit: AuditEntry[]): Partial<Record<PipelineStage, NodeState>> {
  const states: Partial<Record<PipelineStage, NodeState>> = {};
  const lastByAction: Record<string, AuditEntry> = {};
  for (const e of audit) lastByAction[e.action] = e;

  if (lastByAction["signup_start"] || lastByAction["key_rotation_start"]) states.AUTHENTICATE = "healthy";
  if (lastByAction["session_exported"] || lastByAction["session_handoff_consumed"]) states.SESSION = "healthy";
  if (lastByAction["key_acquisition_failed"]) states.ACQUIRE = "failed";
  else if (lastByAction["key_verified"]) states.ACQUIRE = "healthy";
  if (lastByAction["key_verified"]) {
    states.VERIFY = lastByAction["key_verified"].outcome === "success" ? "healthy" : "failed";
  }
  if (lastByAction["key_activated"]) states.ENCRYPT = "healthy";
  if (lastByAction["key_activated"]) states.ACTIVATE = "healthy";
  if (lastByAction["key_revocation"]) states.REVOKE = "healthy";
  if (lastByAction["key_rotation_complete"]) states.AUDIT = "healthy";
  return states;
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm font-semibold cockpit-text">{title}</p>
      <p className="mt-1 text-xs cockpit-text-dim">{subtitle}</p>
    </div>
  );
}
