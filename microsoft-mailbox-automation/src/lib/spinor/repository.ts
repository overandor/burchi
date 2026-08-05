import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashRecord } from "./core.mjs";

export interface SpinorEventInput {
  organizationId: string;
  type: string;
  actorId: string;
  subjectId?: string | null;
  payload: Record<string, unknown>;
  occurredAt?: string;
}

export interface StoredSpinorEvent extends SpinorEventInput {
  id: string;
  storedAt: string;
  previousHash: string | null;
  receiptHash: string;
}

export interface AppendReceipt {
  eventId: string;
  organizationId: string;
  receiptHash: string;
  provider: "remote" | "local-jsonl";
  storedAt: string;
}

export interface SpinorRepository {
  readonly provider: "remote" | "local-jsonl";
  append(event: SpinorEventInput): Promise<AppendReceipt>;
  list(organizationId: string, options?: { type?: string; limit?: number }): Promise<StoredSpinorEvent[]>;
}

function validateEvent(event: SpinorEventInput): void {
  if (!event.organizationId || !event.type || !event.actorId) {
    throw new Error("SPINOR events require organizationId, type, and actorId.");
  }
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error("SPINOR event payload must be an object.");
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

class RemoteSpinorRepository implements SpinorRepository {
  readonly provider = "remote" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async append(event: SpinorEventInput): Promise<AppendReceipt> {
    validateEvent(event);
    const response = await fetch(`${normalizeBaseUrl(this.baseUrl)}/events`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Remote SPINOR store rejected event (${response.status}): ${detail.slice(0, 500)}`);
    }
    const receipt = await response.json() as Partial<AppendReceipt>;
    if (!receipt.eventId || !receipt.receiptHash || !receipt.storedAt) {
      throw new Error("Remote SPINOR store returned an incomplete append receipt.");
    }
    return {
      eventId: receipt.eventId,
      organizationId: event.organizationId,
      receiptHash: receipt.receiptHash,
      provider: "remote",
      storedAt: receipt.storedAt,
    };
  }

  async list(organizationId: string, options: { type?: string; limit?: number } = {}): Promise<StoredSpinorEvent[]> {
    if (!organizationId) throw new Error("organizationId is required.");
    const query = new URLSearchParams({
      organizationId,
      limit: String(Math.min(Math.max(options.limit ?? 100, 1), 1000)),
    });
    if (options.type) query.set("type", options.type);

    const response = await fetch(`${normalizeBaseUrl(this.baseUrl)}/events?${query}`, {
      headers: this.headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Remote SPINOR store failed to list events (${response.status}): ${detail.slice(0, 500)}`);
    }
    const body = await response.json() as { events?: StoredSpinorEvent[] } | StoredSpinorEvent[];
    const events = Array.isArray(body) ? body : body.events;
    if (!Array.isArray(events)) throw new Error("Remote SPINOR store returned an invalid event list.");
    return events.filter((event) => event.organizationId === organizationId);
  }
}

class LocalJsonlSpinorRepository implements SpinorRepository {
  readonly provider = "local-jsonl" as const;
  private readonly filePath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.filePath = path.join(dataDirectory, "spinor-events.jsonl");
  }

  private async readAll(): Promise<StoredSpinorEvent[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StoredSpinorEvent);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async append(event: SpinorEventInput): Promise<AppendReceipt> {
    validateEvent(event);

    const operation = async (): Promise<AppendReceipt> => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const existing = await this.readAll();
      const previousHash = existing.length ? existing[existing.length - 1].receiptHash : null;
      const storedAt = new Date().toISOString();
      const unsigned = {
        ...event,
        id: randomUUID(),
        occurredAt: event.occurredAt ?? storedAt,
        storedAt,
        previousHash,
      };
      const stored: StoredSpinorEvent = {
        ...unsigned,
        receiptHash: hashRecord(unsigned),
      };
      await appendFile(this.filePath, `${JSON.stringify(stored)}\n`, { encoding: "utf8", flag: "a" });
      return {
        eventId: stored.id,
        organizationId: stored.organizationId,
        receiptHash: stored.receiptHash,
        provider: "local-jsonl",
        storedAt,
      };
    };

    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async list(organizationId: string, options: { type?: string; limit?: number } = {}): Promise<StoredSpinorEvent[]> {
    if (!organizationId) throw new Error("organizationId is required.");
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const events = await this.readAll();
    return events
      .filter((event) => event.organizationId === organizationId)
      .filter((event) => !options.type || event.type === options.type)
      .slice(-limit)
      .reverse();
  }
}

export function createSpinorRepository(): SpinorRepository {
  const remoteUrl = process.env.SPINOR_STORE_URL?.trim();
  if (remoteUrl) {
    return new RemoteSpinorRepository(remoteUrl, process.env.SPINOR_STORE_TOKEN?.trim());
  }

  const allowLocal = process.env.NODE_ENV !== "production" || process.env.SPINOR_ALLOW_LOCAL_STORE === "true";
  if (!allowLocal) {
    throw new Error(
      "SPINOR_STORE_URL is required in production. Set SPINOR_ALLOW_LOCAL_STORE=true only for an explicitly ephemeral environment.",
    );
  }

  return new LocalJsonlSpinorRepository(
    process.env.SPINOR_LOCAL_DATA_DIR?.trim() || path.join(process.cwd(), ".spinor-data"),
  );
}
