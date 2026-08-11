/**
 * NoSQL Email Store — "Email as Store of Value"
 *
 * Uses Upstash Redis (REST API, serverless-friendly) as the primary store.
 * Falls back to an in-memory Map when KV env vars are not configured,
 * so the app always works — even without a database connection.
 *
 * Email documents are stored as JSON with full-text search, tagging,
 * valuation, and analytics built in.
 */

import { Redis } from "@upstash/redis";

export interface EmailDoc {
  id: string;
  subject: string;
  from: string;
  fromAddress: string;
  to: string[];
  date: string;
  bodyPreview: string;
  body?: string | null;
  isRead: boolean;
  category: string;
  hasAttachments: boolean;
  attachmentCount: number;
  importance: string;
  // Value metadata
  valueScore: number;       // 0-100, computed from content analysis
  valueTags: string[];      // e.g. ["invoice", "action-required", "relationship"]
  sentiment: "positive" | "neutral" | "negative" | "urgent";
  extractedEntities: { type: string; value: string }[];
  // Sync metadata
  source: string;
  syncedAt: string;
  orgId: string;
}

// ─── Redis client (lazy init) ─────────────────────────────────────────

let redis: Redis | null = null;
let redisAvailable: boolean | null = null;

function getRedis(): Redis | null {
  if (redis !== null) return redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      redis = new Redis({ url, token });
      return redis;
    } catch {
      return null;
    }
  }
  return null;
}

// ─── In-memory fallback ───────────────────────────────────────────────

const memStore = new Map<string, EmailDoc>();
const memIndex = new Map<string, Set<string>>(); // orgId → Set of email IDs

// ─── Key helpers ──────────────────────────────────────────────────────

const KEY_PREFIX = "spinor:emails";
const key = (orgId: string, emailId: string) => `${KEY_PREFIX}:${orgId}:${emailId}`;
const indexKey = (orgId: string) => `${KEY_PREFIX}:index:${orgId}`;
const statsKey = (orgId: string) => `${KEY_PREFIX}:stats:${orgId}`;

// ─── Value scoring ────────────────────────────────────────────────────

function computeValueScore(email: Partial<EmailDoc>): { score: number; tags: string[]; sentiment: EmailDoc["sentiment"]; entities: { type: string; value: string }[] } {
  const text = `${email.subject || ""} ${email.bodyPreview || ""} ${email.body || ""}`.toLowerCase();
  let score = 30; // base
  const tags: string[] = [];
  const entities: { type: string; value: string }[] = [];

  // Financial value
  const dollarMatches = text.match(/\$[\d,]+\.?\d*/g) || [];
  if (dollarMatches.length > 0) {
    const maxAmount = Math.max(...dollarMatches.map(d => parseFloat(d.replace(/[$,]/g, ""))));
    if (maxAmount > 10000) { score += 30; tags.push("high-value"); }
    else if (maxAmount > 1000) { score += 20; tags.push("financial"); }
    else { score += 10; tags.push("transactional"); }
    dollarMatches.forEach(d => entities.push({ type: "money", value: d }));
  }

  // Action items
  if (/\b(urgent|asap|immediately|deadline|due by|action required|please review|approval needed)\b/.test(text)) {
    score += 15; tags.push("action-required"); 
  }
  if (/\b(invoice|payment|contract|proposal|quote|estimate|budget)\b/.test(text)) {
    score += 10; tags.push("business-critical");
  }
  if (/\b(meeting|schedule|calendar|appointment|call)\b/.test(text)) {
    score += 5; tags.push("scheduling");
  }
  if (/\b(introduction|referral|connection|networking)\b/.test(text)) {
    score += 8; tags.push("relationship");
  }
  if (/\b(resume|application|interview|offer|hire)\b/.test(text)) {
    score += 8; tags.push("talent");
  }
  if (/\b(report|analysis|data|metrics|kpi|results)\b/.test(text)) {
    score += 5; tags.push("intelligence");
  }

  // Sentiment
  let sentiment: EmailDoc["sentiment"] = "neutral";
  if (/\b(urgent|asap|critical|overdue|failed|error|problem|issue|complaint)\b/.test(text)) {
    sentiment = "urgent";
  } else if (/\b(thank|appreciate|great|excellent|congratulations|pleased|happy)\b/.test(text)) {
    sentiment = "positive";
  } else if (/\b(sorry|unfortunately|regret|decline|rejected|concern|disappointed)\b/.test(text)) {
    sentiment = "negative";
  }

  // Dates
  const dateMatches = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2})\b/gi) || [];
  dateMatches.forEach(d => entities.push({ type: "date", value: d }));

  // Emails
  const emailMatches = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
  emailMatches.forEach(e => entities.push({ type: "email", value: e }));

  // Cap score
  score = Math.min(100, score);
  if (tags.length === 0) tags.push("general");

  return { score, tags, sentiment, entities };
}

// ─── Public API ───────────────────────────────────────────────────────

export function isNoSqlConnected(): boolean {
  if (redisAvailable !== null) return redisAvailable;
  redisAvailable = getRedis() !== null;
  return redisAvailable;
}

export async function storeEmail(email: Omit<EmailDoc, "valueScore" | "valueTags" | "sentiment" | "extractedEntities" | "syncedAt">): Promise<EmailDoc> {
  const { score, tags, sentiment, entities } = computeValueScore(email);
  const doc: EmailDoc = {
    ...email,
    valueScore: score,
    valueTags: tags,
    sentiment,
    extractedEntities: entities,
    syncedAt: new Date().toISOString(),
  };

  const r = getRedis();
  if (r) {
    await r.sadd(indexKey(doc.orgId), doc.id);
    await r.set(key(doc.orgId, doc.id), JSON.stringify(doc));
  } else {
    memStore.set(key(doc.orgId, doc.id), doc);
    if (!memIndex.has(doc.orgId)) memIndex.set(doc.orgId, new Set());
    memIndex.get(doc.orgId)!.add(doc.id);
  }

  return doc;
}

export async function storeEmailBatch(emails: Omit<EmailDoc, "valueScore" | "valueTags" | "sentiment" | "extractedEntities" | "syncedAt">[]): Promise<{ stored: number; docs: EmailDoc[] }> {
  const docs: EmailDoc[] = [];
  for (const email of emails) {
    const doc = await storeEmail(email);
    docs.push(doc);
  }
  return { stored: docs.length, docs };
}

export async function getEmails(orgId: string, opts?: {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  category?: string;
  minScore?: number;
  source?: string;
  search?: string;
}): Promise<{ emails: EmailDoc[]; total: number }> {
  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;
  const r = getRedis();

  let ids: string[] = [];
  if (r) {
    ids = await r.smembers(indexKey(orgId));
  } else {
    ids = Array.from(memIndex.get(orgId) || []);
  }

  // Fetch all docs
  let docs: EmailDoc[] = [];
  if (r) {
    const pipeline = r.pipeline();
    for (const id of ids) pipeline.get(key(orgId, id));
    const results = await pipeline.exec();
    docs = results
      .map((r: any) => (typeof r === "string" ? JSON.parse(r) : r))
      .filter(Boolean) as EmailDoc[];
  } else {
    docs = ids.map(id => memStore.get(key(orgId, id))).filter(Boolean) as EmailDoc[];
  }

  // Apply filters
  if (opts?.unreadOnly) docs = docs.filter(d => !d.isRead);
  if (opts?.category) docs = docs.filter(d => d.category === opts!.category);
  if (opts?.source) docs = docs.filter(d => d.source === opts!.source);
  if (opts?.minScore) docs = docs.filter(d => d.valueScore >= opts!.minScore!);
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    docs = docs.filter(d =>
      d.subject.toLowerCase().includes(q) ||
      d.from.toLowerCase().includes(q) ||
      d.bodyPreview.toLowerCase().includes(q) ||
      d.valueTags.some(t => t.includes(q))
    );
  }

  // Sort by date desc
  docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const total = docs.length;
  const paged = docs.slice(offset, offset + limit);

  return { emails: paged, total };
}

export async function getEmail(orgId: string, emailId: string): Promise<EmailDoc | null> {
  const r = getRedis();
  if (r) {
    const raw = await r.get<string>(key(orgId, emailId));
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }
  return memStore.get(key(orgId, emailId)) || null;
}

export async function markRead(orgId: string, emailId: string, isRead: boolean = true): Promise<void> {
  const doc = await getEmail(orgId, emailId);
  if (!doc) return;
  doc.isRead = isRead;
  const r = getRedis();
  if (r) {
    await r.set(key(orgId, emailId), JSON.stringify(doc));
  } else {
    memStore.set(key(orgId, emailId), doc);
  }
}

export async function deleteEmail(orgId: string, emailId: string): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.srem(indexKey(orgId), emailId);
    await r.del(key(orgId, emailId));
  } else {
    memStore.delete(key(orgId, emailId));
    memIndex.get(orgId)?.delete(emailId);
  }
}

export async function getEmailStats(orgId: string): Promise<{
  total: number;
  unread: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  avgValueScore: number;
  highValue: number;
  bySentiment: Record<string, number>;
  topTags: { tag: string; count: number }[];
  byDate: { date: string; count: number }[];
}> {
  const { emails } = await getEmails(orgId, { limit: 10000 });
  const total = emails.length;
  const unread = emails.filter(e => !e.isRead).length;

  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const dateCounts: Record<string, number> = {};

  let scoreSum = 0;
  let highValue = 0;

  for (const e of emails) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    bySource[e.source] = (bySource[e.source] || 0) + 1;
    bySentiment[e.sentiment] = (bySentiment[e.sentiment] || 0) + 1;
    scoreSum += e.valueScore;
    if (e.valueScore >= 70) highValue++;
    for (const t of e.valueTags) tagCounts[t] = (tagCounts[t] || 0) + 1;
    const day = e.date.split("T")[0];
    dateCounts[day] = (dateCounts[day] || 0) + 1;
  }

  const topTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const byDate = Object.entries(dateCounts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  return {
    total,
    unread,
    byCategory,
    bySource,
    avgValueScore: total > 0 ? Math.round(scoreSum / total) : 0,
    highValue,
    bySentiment,
    topTags,
    byDate,
  };
}

export async function searchEmails(orgId: string, query: string, limit: number = 20): Promise<EmailDoc[]> {
  const { emails } = await getEmails(orgId, { search: query, limit });
  return emails;
}

export async function getHighValueEmails(orgId: string, limit: number = 10): Promise<EmailDoc[]> {
  const { emails } = await getEmails(orgId, { minScore: 70, limit });
  return emails;
}
