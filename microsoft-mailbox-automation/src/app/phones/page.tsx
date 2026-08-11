"use client";

import { nanoid } from "nanoid";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  PhoneRecord,
  PhoneTelemetryEvent,
  PhoneImage,
  PhoneLLMAnalysis,
  PhoneTelemetrySummary,
} from "@/types";
import {
  loadPhoneRecords,
  savePhoneRecords,
  createPhoneRecord,
  generatePhoneSummary,
  formatDuration,
  formatBytes,
} from "@/lib/phone-telemetry";

const EVENT_TYPES = ["call", "sms", "mms", "data", "status", "alert", "custom"] as const;
const DIRECTIONS = ["inbound", "outbound"] as const;

const RISK_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#10b981",
};

const INSIGHT_ICONS: Record<string, string> = {
  opportunity: "🎯",
  risk: "⚠️",
  efficiency: "⚡",
  anomaly: "🔍",
};

export default function PhonesPage() {
  const [records, setRecords] = useState<PhoneRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState({ number: "", label: "" });
  const [newEvent, setNewEvent] = useState({
    type: "call" as PhoneTelemetryEvent["type"],
    direction: "inbound" as PhoneTelemetryEvent["direction"],
    durationSec: "",
    notes: "",
  });
  const [imageCaption, setImageCaption] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loaded = loadPhoneRecords();
    setRecords(loaded);
    if (loaded.length > 0 && !selectedId) {
      setSelectedId(loaded[0].id);
    }
  }, []);

  const selected = records.find((r) => r.id === selectedId) || null;
  const summary: PhoneTelemetrySummary | null = selected ? generatePhoneSummary(selected) : null;

  const persistRecords = (updated: PhoneRecord[]) => {
    setRecords(updated);
    savePhoneRecords(updated);
  };

  const handleAddPhone = () => {
    if (!newPhone.number.trim()) return;
    const cleaned = newPhone.number.trim().replace(/[+\s-]/g, "");
    if (!/^\d{7,15}$/.test(cleaned)) {
      setError("Phone number must be 7-15 digits (allowing +, spaces, and dashes).");
      return;
    }
    setError(null);
    const record = createPhoneRecord(newPhone.number.trim(), newPhone.label.trim());
    const updated = [...records, record];
    persistRecords(updated);
    setSelectedId(record.id);
    setNewPhone({ number: "", label: "" });
  };

  const handleDeletePhone = (id: string) => {
    const updated = records.filter((r) => r.id !== id);
    persistRecords(updated);
    if (selectedId === id) setSelectedId(updated[0]?.id || null);
  };

  const handleAddEvent = () => {
    if (!selected) return;
    if (newEvent.durationSec) {
      const dur = parseInt(newEvent.durationSec);
      if (isNaN(dur) || dur < 0) {
        setError("Duration must be a non-negative number.");
        return;
      }
    }
    setError(null);
    const event: PhoneTelemetryEvent = {
      id: nanoid(8),
      timestamp: new Date().toISOString(),
      type: newEvent.type,
      direction: newEvent.direction,
      durationSec: newEvent.durationSec ? parseInt(newEvent.durationSec) : undefined,
      metadata: {},
      notes: newEvent.notes || undefined,
    };
    const updated = records.map((r) =>
      r.id === selected.id ? { ...r, events: [...r.events, event] } : r
    );
    persistRecords(updated);
    setNewEvent({ type: "call", direction: "inbound", durationSec: "", notes: "" });
  };

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || !selected) return;
    setUploading(true);
    setError(null);
    try {
      const newImages: PhoneImage[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          setError(`File "${file.name}" is not an image. Only image files are allowed.`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          setError(`File "${file.name}" exceeds 10MB limit.`);
          continue;
        }
        const dataUrl = await fileToDataUrl(file);
        const image: PhoneImage = {
          id: nanoid(8),
          timestamp: new Date().toISOString(),
          filename: file.name,
          contentType: file.type,
          dataUrl,
          sizeBytes: file.size,
          caption: imageCaption || undefined,
        };
        newImages.push(image);
      }
      const updated = records.map((r) =>
        r.id === selected.id ? { ...r, images: [...r.images, ...newImages] } : r
      );
      persistRecords(updated);
      setImageCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      setError(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = (imageId: string) => {
    if (!selected) return;
    const updated = records.map((r) =>
      r.id === selected.id ? { ...r, images: r.images.filter((img) => img.id !== imageId) } : r
    );
    persistRecords(updated);
  };

  const handleLLMAnalysis = async () => {
    if (!selected) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/phones/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: selected }),
      });
      const data = await res.json();
      if (data.error) {
        setError(`LLM analysis failed: ${data.error}`);
      } else if (data.analysis) {
        const updated = records.map((r) =>
          r.id === selected.id ? { ...r, llmAnalysis: data.analysis as PhoneLLMAnalysis } : r
        );
        persistRecords(updated);
      }
    } catch (e: any) {
      setError(`LLM analysis failed: ${e.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Phone Telemetry</h1>
        <p className="mt-1 text-sm text-slate-500">
          Per-phone-number telemetry with image upload and LLM governance
        </p>
      </div>

      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Left: Phone list */}
        <div className="col-span-12 md:col-span-4 lg:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-900">Phone Numbers</h2>

            {/* Add new phone */}
            <div className="mb-4 space-y-2">
              <input
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={newPhone.number}
                onChange={(e) => setNewPhone({ ...newPhone, number: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <input
                type="text"
                placeholder="Label (optional)"
                value={newPhone.label}
                onChange={(e) => setNewPhone({ ...newPhone, label: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <button
                onClick={handleAddPhone}
                disabled={!newPhone.number.trim()}
                className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-40"
              >
                Add Phone
              </button>
            </div>

            {/* Phone list */}
            <div className="space-y-1">
              {records.length === 0 && (
                <p className="py-4 text-center text-xs text-slate-400">
                  No phone numbers yet. Add one above.
                </p>
              )}
              {records.map((r) => {
                const s = generatePhoneSummary(r);
                const isActive = r.id === selectedId;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`cursor-pointer rounded-lg border p-3 transition-all ${
                      isActive
                        ? "border-indigo-300 bg-indigo-50/50"
                        : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {r.label || r.phoneNumber}
                        </div>
                        <div className="truncate text-xs text-slate-400">{r.phoneNumber}</div>
                      </div>
                      <div className="ml-2 flex flex-shrink-0 items-center gap-1.5">
                        {s.riskScore > 50 && (
                          <span className="h-2 w-2 rounded-full bg-red-400" title="High risk" />
                        )}
                        {s.riskScore > 20 && s.riskScore <= 50 && (
                          <span className="h-2 w-2 rounded-full bg-amber-400" title="Medium risk" />
                        )}
                        {s.totalImages > 0 && (
                          <span className="text-xs text-slate-400" title="Images">
                            📷{s.totalImages}
                          </span>
                        )}
                        <span className="text-xs text-slate-400" title="Events">
                          {s.totalEvents}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Selected phone detail */}
        <div className="col-span-12 md:col-span-8 lg:col-span-9">
          {!selected || !summary ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <svg className="h-7 w-7 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-slate-900">Select a phone number</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Add a phone number to start tracking telemetry, images, and LLM governance.
                </p>
              </div>
            </div>
          ) : (
          <div className="space-y-6">
            {/* Phone header + metrics */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{selected.label}</h2>
                  <p className="text-sm text-slate-500">{selected.phoneNumber}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Created {new Date(selected.createdAt).toLocaleDateString()}
                    {summary.lastActivity && ` · Last activity ${new Date(summary.lastActivity).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <RiskGauge score={summary.riskScore} />
                  <button
                    onClick={() => handleDeletePhone(selected.id)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Metric cards */}
              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard label="Total Events" value={summary.totalEvents.toString()} />
                <MetricCard label="Total Calls" value={summary.totalCalls.toString()} sub={formatDuration(summary.totalDurationSec)} />
                <MetricCard label="SMS / MMS" value={summary.totalSms.toString()} />
                <MetricCard label="Images" value={summary.totalImages.toString()} />
                <MetricCard label="Inbound" value={summary.inboundCount.toString()} />
                <MetricCard label="Outbound" value={summary.outboundCount.toString()} />
                <MetricCard label="Top Type" value={summary.topEventType} />
                <MetricCard label="Risk Score" value={`${summary.riskScore}/100`} />
              </div>
            </div>

            {/* Add event */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Log Telemetry Event</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <select
                  value={newEvent.type}
                  onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value as PhoneTelemetryEvent["type"] })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <select
                  value={newEvent.direction}
                  onChange={(e) => setNewEvent({ ...newEvent, direction: e.target.value as PhoneTelemetryEvent["direction"] })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                >
                  {DIRECTIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Duration (sec)"
                  value={newEvent.durationSec}
                  onChange={(e) => setNewEvent({ ...newEvent, durationSec: e.target.value })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
                <input
                  type="text"
                  placeholder="Notes"
                  value={newEvent.notes}
                  onChange={(e) => setNewEvent({ ...newEvent, notes: e.target.value })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
              </div>
              <button
                onClick={handleAddEvent}
                className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Add Event
              </button>
            </div>

            {/* Image upload + gallery */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Images</h3>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Caption (optional)"
                    value={imageCaption}
                    onChange={(e) => setImageCaption(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleImageUpload(e.target.files)}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Upload Images"}
                </button>
              </div>

              {selected.images.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">No images uploaded yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {selected.images.map((img) => (
                    <div key={img.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
                      <img
                        src={img.dataUrl}
                        alt={img.caption || img.filename}
                        className="h-32 w-full object-cover"
                      />
                      <div className="p-2">
                        <div className="truncate text-xs font-medium text-slate-700">{img.filename}</div>
                        <div className="text-[10px] text-slate-400">
                          {formatBytes(img.sizeBytes)} · {new Date(img.timestamp).toLocaleDateString()}
                        </div>
                        {img.caption && (
                          <div className="mt-1 truncate text-[10px] text-slate-500">"{img.caption}"</div>
                        )}
                        {img.aiDescription && (
                          <div className="mt-1 truncate text-[10px] text-indigo-500" title={img.aiDescription}>
                            AI: {img.aiDescription}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveImage(img.id)}
                        className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* LLM Governance */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">LLM Governance</h3>
                  <p className="text-xs text-slate-500">AI analysis of telemetry events and images</p>
                </div>
                <button
                  onClick={handleLLMAnalysis}
                  disabled={analyzing}
                  className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:shadow-md disabled:opacity-50"
                >
                  {analyzing ? "Analyzing..." : "Run LLM Analysis"}
                </button>
              </div>

              {!selected.llmAnalysis ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  No LLM analysis yet. Click "Run LLM Analysis" to generate insights, risk assessment, and recommendations.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Summary</div>
                    <p className="text-sm text-slate-700">{selected.llmAnalysis.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>Model: {selected.llmAnalysis.model}</span>
                      <span>·</span>
                      <span>Events: {selected.llmAnalysis.eventCount}</span>
                      <span>·</span>
                      <span>Images: {selected.llmAnalysis.imageCount}</span>
                      <span>·</span>
                      <span>Analyzed: {new Date(selected.llmAnalysis.analyzedAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Risk score */}
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-medium text-slate-600">Risk Score:</div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-32 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${selected.llmAnalysis.riskScore}%`,
                            backgroundColor:
                              selected.llmAnalysis.riskScore > 50 ? "#ef4444" :
                              selected.llmAnalysis.riskScore > 20 ? "#f59e0b" : "#10b981",
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold text-slate-900">{selected.llmAnalysis.riskScore}/100</span>
                    </div>
                  </div>

                  {/* Insights */}
                  {selected.llmAnalysis.insights.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Insights</div>
                      <div className="space-y-2">
                        {selected.llmAnalysis.insights.map((ins, i) => (
                          <div key={i} className="rounded-lg border border-slate-100 p-3">
                            <div className="mb-1 flex items-center gap-2">
                              <span>{INSIGHT_ICONS[ins.type] || "📌"}</span>
                              <span className="text-sm font-medium text-slate-900">{ins.title}</span>
                              <span
                                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${RISK_COLORS[ins.severity]}15`,
                                  color: RISK_COLORS[ins.severity],
                                }}
                              >
                                {ins.severity}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-500">
                                {ins.type}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600">{ins.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendations */}
                  {selected.llmAnalysis.recommendations.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Recommendations</div>
                      <ul className="space-y-1.5">
                        {selected.llmAnalysis.recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-600">
                              {i + 1}
                            </span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Event log */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Event Log</h3>
              {selected.events.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No events logged yet.</p>
              ) : (
                <div className="max-h-96 space-y-1 overflow-y-auto">
                  {selected.events
                    .slice()
                    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                    .map((e) => (
                      <div key={e.id} className="flex items-center gap-3 border-b border-slate-50 py-2 last:border-0">
                        <span
                          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            e.direction === "inbound" ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"
                          }`}
                        >
                          {e.direction === "inbound" ? "↓" : "↑"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900">
                            <span className="capitalize">{e.type}</span>
                            {e.durationSec && <span className="ml-2 text-xs text-slate-400">{formatDuration(e.durationSec)}</span>}
                          </div>
                          {e.notes && <div className="truncate text-xs text-slate-500">{e.notes}</div>}
                        </div>
                        <div className="flex-shrink-0 text-xs text-slate-400">
                          {new Date(e.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function RiskGauge({ score }: { score: number }) {
  const color = score > 50 ? "#ef4444" : score > 20 ? "#f59e0b" : "#10b981";
  const label = score > 50 ? "High" : score > 20 ? "Medium" : "Low";
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-16 w-16">
        <svg className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r="28" fill="none" stroke="#e2e8f0" strokeWidth="6" />
          <circle
            cx="32" cy="32" r="28" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${(score / 100) * 175.93} 175.93`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-[10px] font-medium" style={{ color }}>{label} Risk</span>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
