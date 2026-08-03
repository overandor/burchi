export interface EmailMessage {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  receivedDate: string;
  bodyPreview: string;
  body: string;
  hasAttachments: boolean;
  attachments: EmailAttachment[];
  isRead: boolean;
  importance: string;
  categories: string[];
  processed: boolean;
  extractedData?: ExtractedData;
  threadId?: string;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  content?: Uint8Array;
  parsedData?: ParsedAttachmentData;
}

export interface ParsedAttachmentData {
  type: 'csv' | 'excel' | 'pdf' | 'text' | 'unknown';
  rows?: Record<string, unknown>[];
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedData {
  emailId: string;
  extractedAt: string;
  fields: ExtractedField[];
  tables: ExtractedTable[];
  summary: string;
  category: string;
  confidence: number;
  source: 'email_body' | 'attachment' | 'both';
}

export interface ExtractedField {
  key: string;
  value: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'scientific_value';
  unit?: string;
  confidence: number;
}

export interface ExtractedTable {
  name: string;
  headers: string[];
  rows: Record<string, string | number>[];
  source: string;
}

export interface AppConfig {
  graph: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    mailbox: string;
  };
  llm: {
    provider: 'openai' | 'anthropic' | 'azure' | 'ollama';
    apiKey: string;
    model: string;
    endpoint?: string;
    /** Pool of inference endpoints for rotation. If set, requests are
     *  distributed across these nodes to bypass per-node timeouts. */
    endpoints?: InferenceEndpoint[];
    /** Target token count for rotated generation (e.g. 50000). When set,
     *  the rotator chains requests until the target is reached. */
    maxTotalTokens?: number;
  };
  processing: {
    autoProcess: boolean;
    pollInterval: number;
    maxEmailsPerSync: number;
    categories: string[];
    extractionPrompt: string;
  };
  export: {
    format: 'excel' | 'csv';
    outputPath: string;
  };
}

export interface SyncStatus {
  lastSync: string | null;
  totalEmails: number;
  processedEmails: number;
  pendingEmails: number;
  isSyncing: boolean;
  errors: string[];
}

export interface ProcessedEmailRecord {
  id: string;
  emailId: string;
  subject: string;
  sender: string;
  receivedDate: string;
  processedAt: string;
  category: string;
  confidence: number;
  fieldCount: number;
  tableCount: number;
  extractedData: ExtractedData;
  analysis?: EmailAnalysis;
}

export interface EmailAnalysis {
  wikitree: WikiTree;
  mindmap: Mindmap;
  execution: ExecutionPlan;
}

export interface WikiTree {
  root: WikiTreeNode;
}

export interface WikiTreeNode {
  id: string;
  title: string;
  content: string;
  children: WikiTreeNode[];
  tags: string[];
  sources: string[];
}

export interface Mindmap {
  root: MindmapNode;
}

export interface MindmapNode {
  id: string;
  label: string;
  children: MindmapNode[];
  color?: string;
  icon?: string;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  summary: string;
  estimatedTime: string;
  dependencies: string[];
}

export interface ExecutionStep {
  id: string;
  order: number;
  action: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  inputs: string[];
  outputs: string[];
  dependencies: string[];
}

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  emailAddress: string;
}

export interface InferenceEndpoint {
  url: string;
  apiKey?: string;
  model?: string;
  /** Max tokens this node can generate per request (within its timeout) */
  maxTokensPerRequest?: number;
  /** Whether this node is currently available (set by health check) */
  healthy?: boolean;
  /** Last time this node was used (for round-robin) */
  lastUsed?: number;
  /** Number of requests sent to this node */
  requestCount?: number;
}

export interface RotationResult {
  content: string;
  totalTokens: number;
  rotations: number;
  nodesUsed: string[];
  chunks: { node: string; tokens: number; content: string }[];
  finishReason: string;
  elapsedMs: number;
}
