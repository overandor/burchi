/**
 * Phone Telemetry Engine — per-phone-number telemetry with image support
 * and LLM governance. Generates summaries, computes metrics, and builds
 * prompts for LLM analysis of phone activity + uploaded images.
 */

import { nanoid } from "nanoid";
import {
  PhoneRecord,
  PhoneTelemetryEvent,
  PhoneImage,
  PhoneTelemetrySummary,
  PhoneLLMAnalysis,
  PhoneLLMInsight,
} from "@/types";

// ─── CRUD helpers (localStorage-backed, works on serverless) ───────

const STORAGE_KEY = "phone-telemetry-records";

export function loadPhoneRecords(): PhoneRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("[phone-telemetry] error:", e);
    return [];
  }
}

export function savePhoneRecords(records: PhoneRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.error("Failed to save phone records:", e);
  }
}

export function createPhoneRecord(phoneNumber: string, label: string): PhoneRecord {
  if (!phoneNumber || !/^[+\d][\d\s\-().]{6,14}[\d\s\-().]$/.test(phoneNumber.trim())) {
    throw new Error("Invalid phone number: must be 7-15 digits allowing + and separators");
  }
  return {
    id: nanoid(12),
    phoneNumber,
    label: label || phoneNumber,
    createdAt: new Date().toISOString(),
    events: [],
    images: [],
  };
}

export function upsertPhoneRecord(record: PhoneRecord): PhoneRecord[] {
  const records = loadPhoneRecords();
  const idx = records.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    records[idx] = record;
  } else {
    records.push(record);
  }
  savePhoneRecords(records);
  return records;
}

export function deletePhoneRecord(id: string): PhoneRecord[] {
  const records = loadPhoneRecords().filter((r) => r.id !== id);
  savePhoneRecords(records);
  return records;
}

export function addPhoneEvent(
  phoneId: string,
  event: Omit<PhoneTelemetryEvent, "id" | "timestamp">
): PhoneRecord | null {
  if (event.durationSec !== undefined && event.durationSec < 0) {
    throw new Error("Invalid event: durationSec must be >= 0");
  }
  const records = loadPhoneRecords();
  const record = records.find((r) => r.id === phoneId);
  if (!record) return null;
  record.events.push({
    ...event,
    id: nanoid(12),
    timestamp: new Date().toISOString(),
  });
  savePhoneRecords(records);
  return record;
}

export function addPhoneImage(
  phoneId: string,
  image: Omit<PhoneImage, "id" | "timestamp">
): PhoneRecord | null {
  if (!image || typeof image.filename !== "string" || typeof image.contentType !== "string" || typeof image.sizeBytes !== "number" || image.sizeBytes < 0) {
    throw new Error("Invalid image: must have filename (string), contentType (string), and sizeBytes (number >= 0)");
  }
  const records = loadPhoneRecords();
  const record = records.find((r) => r.id === phoneId);
  if (!record) return null;
  record.images.push({
    ...image,
    id: nanoid(12),
    timestamp: new Date().toISOString(),
  });
  savePhoneRecords(records);
  return record;
}

export function removePhoneImage(phoneId: string, imageId: string): PhoneRecord | null {
  const records = loadPhoneRecords();
  const record = records.find((r) => r.id === phoneId);
  if (!record) return null;
  record.images = record.images.filter((img) => img.id !== imageId);
  savePhoneRecords(records);
  return record;
}

// ─── Telemetry summary ─────────────────────────────────────────────

export function generatePhoneSummary(record: PhoneRecord): PhoneTelemetrySummary {
  const events = record.events;
  const totalEvents = events.length;
  const totalImages = record.images.length;

  const eventsByType: Record<string, number> = {};
  let inboundCount = 0;
  let outboundCount = 0;
  let totalDurationSec = 0;
  let totalCalls = 0;
  let totalSms = 0;

  for (const e of events) {
    eventsByType[e.type] = (eventsByType[e.type] || 0) + 1;
    if (e.direction === "inbound") inboundCount++;
    else outboundCount++;
    if (e.type === "call") {
      totalCalls++;
      totalDurationSec += e.durationSec || 0;
    }
    if (e.type === "sms" || e.type === "mms") totalSms++;
  }

  const topEventType = Object.entries(eventsByType).sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0] || "none";

  const lastActivity = events.length > 0
    ? events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].timestamp
    : null;

  const riskScore = computeRiskScore(record);

  const timelineMap = new Map<string, number>();
  for (const e of events) {
    const date = e.timestamp.split("T")[0];
    timelineMap.set(date, (timelineMap.get(date) || 0) + 1);
  }
  const eventsTimeline = Array.from(timelineMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    phoneNumber: record.phoneNumber,
    label: record.label,
    totalEvents,
    totalImages,
    totalCalls,
    totalSms,
    totalDurationSec,
    lastActivity,
    riskScore,
    topEventType,
    inboundCount,
    outboundCount,
    eventsByType,
    eventsTimeline,
  };
}

function computeRiskScore(record: PhoneRecord): number {
  let score = 0;
  const events = record.events;

  // High volume of outbound calls at odd hours → higher risk
  const oddHourCalls = events.filter((e) => {
    const hour = new Date(e.timestamp).getHours();
    return e.type === "call" && (hour < 6 || hour > 22);
  }).length;
  score += Math.min(oddHourCalls * 5, 25);

  // Many short calls → potential spam/robocall pattern
  const shortCalls = events.filter(
    (e) => e.type === "call" && (e.durationSec || 0) < 10
  ).length;
  score += Math.min(shortCalls * 3, 15);

  // Unusual metadata keys → anomaly
  const metadataKeys = new Set<string>();
  for (const e of events) {
    for (const k of Object.keys(e.metadata || {})) metadataKeys.add(k);
  }
  score += Math.min(metadataKeys.size * 2, 20);

  // Images without captions → ungoverned data
  const uncaptionedImages = record.images.filter((img) => !img.caption).length;
  score += Math.min(uncaptionedImages * 2, 10);

  // Alerts
  const alerts = events.filter((e) => e.type === "alert").length;
  score += Math.min(alerts * 8, 30);

  return Math.min(score, 100);
}

// ─── LLM governance ────────────────────────────────────────────────

export function buildLLMPrompt(record: PhoneRecord): { system: string; user: string } {
  const summary = generatePhoneSummary(record);

  const system = `You are a phone telemetry governance AI. You analyze per-phone-number telemetry data — including call/SMS/MMS events, uploaded images, and metadata — to produce insights, risk assessments, and recommendations.

Your output must be valid JSON with this structure:
{
  "summary": "string — 2-3 sentence overview of this phone number's activity",
  "insights": [
    { "type": "opportunity|risk|efficiency|anomaly", "severity": "high|medium|low", "title": "string", "description": "string" }
  ],
  "riskScore": 0-100,
  "recommendations": ["string", ...]
}

Focus on:
- Communication patterns and anomalies
- Risk indicators (spam, fraud, unusual hours, high volume)
- Efficiency opportunities (automated triage, routing)
- Image content relevance to phone activity
- Actionable recommendations for the operator`;

  const eventLines = record.events.slice(-50).map((e) =>
    `  [${e.timestamp}] ${e.direction} ${e.type}${e.durationSec ? ` (${e.durationSec}s)` : ""} — ${JSON.stringify(e.metadata)}${e.notes ? ` | ${e.notes}` : ""}`
  );

  const imageLines = record.images.map((img) =>
    `  [${img.timestamp}] ${img.filename} (${img.contentType}, ${img.sizeBytes} bytes)${img.caption ? ` — "${img.caption}"` : ""}${img.aiDescription ? ` | AI: ${img.aiDescription}` : ""}`
  );

  const user = `PHONE NUMBER: ${record.phoneNumber}
LABEL: ${record.label}
CREATED: ${record.createdAt}

TELEMETRY SUMMARY:
  Total Events: ${summary.totalEvents}
  Total Images: ${summary.totalImages}
  Total Calls: ${summary.totalCalls} (${summary.totalDurationSec}s total duration)
  Total SMS/MMS: ${summary.totalSms}
  Inbound: ${summary.inboundCount} | Outbound: ${summary.outboundCount}
  Top Event Type: ${summary.topEventType}
  Risk Score (computed): ${summary.riskScore}/100
  Last Activity: ${summary.lastActivity || "none"}

EVENTS (last 50):
${eventLines.length > 0 ? eventLines.join("\n") : "  (none)"}

IMAGES:
${imageLines.length > 0 ? imageLines.join("\n") : "  (none)"}

Analyze this phone number's telemetry and provide governance output as JSON.`;

  return { system, user };
}

export function parseLLMResponse(content: string, model: string, record: PhoneRecord): PhoneLLMAnalysis {
  let parsed: any;
  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("[phone-telemetry] error:", e);
    parsed = {
      summary: content.slice(0, 500),
      insights: [],
      riskScore: record.llmAnalysis?.riskScore || 0,
      recommendations: [],
    };
  }

  const insights: PhoneLLMInsight[] = (parsed.insights || []).map((i: any) => ({
    type: i.type || "anomaly",
    severity: i.severity || "medium",
    title: i.title || "Untitled",
    description: i.description || "",
  }));

  return {
    analyzedAt: new Date().toISOString(),
    model,
    summary: parsed.summary || "",
    insights,
    riskScore: typeof parsed.riskScore === "number" ? parsed.riskScore : 0,
    recommendations: parsed.recommendations || [],
    imageCount: record.images.length,
    eventCount: record.events.length,
  };
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
