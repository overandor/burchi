/**
 * Membra Scanner — Phase 1
 *
 * Scans a local directory or git repository, classifies files,
 * detects secrets, hashes content, inventories dependencies,
 * and detects duplicates.
 *
 * The scan is deterministic: the same input directory produces
 * the same output every time.
 */

import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";
import { sha256Hex } from "./crypto";
import type {
  ScannedFile,
  FileClass,
  ScanResult,
  SecretFinding,
  DuplicateCluster,
  DependencyInventory,
} from "@/types";

// ─── File classification ───────────────────────────────────────────

const EXTENSION_MAP: Record<string, FileClass> = {
  ".py": "python_source",
  ".pyw": "python_source",
  ".wasm": "wasm_binary",
  ".gguf": "model_weights",
  ".ggfu": "model_weights",
  ".bin": "model_weights",
  ".safetensors": "model_weights",
  ".pt": "model_weights",
  ".pth": "model_weights",
  ".json": "configuration",
  ".yaml": "configuration",
  ".yml": "configuration",
  ".toml": "configuration",
  ".env": "secret",
  ".pem": "secret",
  ".key": "secret",
  ".p12": "secret",
  ".pfx": "secret",
  ".md": "documentation",
  ".rst": "documentation",
  ".txt": "documentation",
  ".csv": "dataset",
  ".parquet": "dataset",
  ".tsv": "dataset",
  ".jsonl": "dataset",
  ".png": "asset",
  ".jpg": "asset",
  ".jpeg": "asset",
  ".gif": "asset",
  ".svg": "asset",
  ".ico": "asset",
  ".webp": "asset",
  ".wav": "asset",
  ".mp3": "asset",
  ".mp4": "asset",
  ".lock": "configuration",
  ".cfg": "configuration",
  ".ini": "configuration",
};

const LICENSE_FILES = ["license", "license.md", "license.txt", "license.rst", "copying", "copying.txt"];
const TEST_PATTERNS = [/test[_-]/i, /[_-]test\./i, /\/tests?\//i, /\/__tests__\//i];
const SECRET_PATTERNS: { pattern: RegExp; severity: SecretFinding["severity"]; name: string }[] = [
  { pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}["']?/gi, severity: "critical", name: "api_key" },
  { pattern: /(?:secret|secret[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}["']?/gi, severity: "critical", name: "secret_key" },
  { pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?[^\s"']{8,}["']?/gi, severity: "high", name: "password" },
  { pattern: /(?:token|access[_-]?token)\s*[=:]\s*["']?[A-Za-z0-9_\-\.]{20,}["']?/gi, severity: "high", name: "token" },
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/g, severity: "critical", name: "private_key" },
  { pattern: /(?:aws[_-]?(?:access[_-]?key|secret))\s*[=:]\s*["']?[A-Za-z0-9/+=]{20,}["']?/gi, severity: "critical", name: "aws_credential" },
  { pattern: /(?:sk-|pk-)[A-Za-z0-9]{20,}/g, severity: "high", name: "openai_key" },
  { pattern: /gh[pousr]_[A-Za-z0-9]{36}/g, severity: "high", name: "github_token" },
  { pattern: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|redis|amqp):\/\/[^\s"']{10,}/gi, severity: "high", name: "connection_string" },
];

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache",
  ".tox", ".eggs", ".venv", "venv", "env", "dist", "build",
  ".next", ".cache", ".turbo", "coverage", ".coverage",
]);

const IGNORED_FILES = new Set([
  ".DS_Store", "Thumbs.db", ".gitignore", ".gitkeep",
]);

// ─── Helpers ───────────────────────────────────────────────────────

function isBinaryFile(filePath: string, stats: fs.Stats): boolean {
  if (stats.size === 0) return false;
  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = new Set([
    ".wasm", ".gguf", ".ggfu", ".bin", ".safetensors", ".pt", ".pth",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".wav", ".mp3", ".mp4",
    ".p12", ".pfx", ".parquet",
  ]);
  if (binaryExts.has(ext)) return true;
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    ".py": "python", ".pyw": "python",
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".rs": "rust", ".go": "go", ".java": "java",
    ".c": "c", ".cpp": "cpp", ".h": "c",
    ".rb": "ruby", ".php": "php", ".sh": "shell",
    ".sql": "sql", ".html": "html", ".css": "css",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml",
    ".toml": "toml", ".xml": "xml", ".md": "markdown",
  };
  return langMap[ext] ?? null;
}

function detectSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    for (const { pattern, severity, name } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const masked = match[0].slice(0, 6) + "..." + match[0].slice(-4);
        findings.push({
          line: lineNum + 1,
          column: match.index + 1,
          pattern: name,
          severity,
          maskedValue: masked,
        });
      }
    }
  }
  return findings;
}

function detectLicense(filePath: string, content: string): string | null {
  const basename = path.basename(filePath).toLowerCase();
  if (!LICENSE_FILES.includes(basename)) return null;
  const upper = content.toUpperCase();
  if (upper.includes("MIT LICENSE") || upper.includes("PERMISSION IS HEREBY GRANTED, FREE OF CHARGE")) return "MIT";
  if (upper.includes("APACHE LICENSE") && upper.includes("2.0")) return "Apache-2.0";
  if (upper.includes("GNU GENERAL PUBLIC LICENSE") && upper.includes("VERSION 3")) return "GPL-3.0";
  if (upper.includes("GNU GENERAL PUBLIC LICENSE") && upper.includes("VERSION 2")) return "GPL-2.0";
  if (upper.includes("BSD 3-CLAUSE") || upper.includes("NEITHER THE NAME")) return "BSD-3-Clause";
  if (upper.includes("BSD 2-CLAUSE") || upper.includes("REDISTRIBUTION AND USE")) return "BSD-2-Clause";
  if (upper.includes("ISC LICENSE") || upper.includes("PERMISSION TO USE, COPY, MODIFY")) return "ISC";
  if (upper.includes("MOZILLA PUBLIC LICENSE") && upper.includes("2.0")) return "MPL-2.0";
  return "custom";
}

function detectPythonImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /^\s*import\s+([A-Za-z0-9_\.]+)/gm,
    /^\s*from\s+([A-Za-z0-9_\.]+)\s+import/gm,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const pkg = match[1].split(".")[0];
      if (!imports.includes(pkg)) imports.push(pkg);
    }
  }
  return imports;
}

function classifyFile(filePath: string, relativePath: string, content: string | null, isBinary: boolean): FileClass {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (TEST_PATTERNS.some(p => p.test(relativePath))) {
    if (ext === ".py") return "python_test";
  }

  if (LICENSE_FILES.includes(basename)) return "license_file";

  // Check for .env files (path.extname returns "" for dotfiles).
  if (basename === ".env" || basename.startsWith(".env.")) return "secret";

  if (basename === "requirements.txt" || basename === "requirements-dev.txt" || basename === "pyproject.toml") {
    return "configuration";
  }

  if (ext === ".txt" || ext === ".md" || ext === ".j2" || ext === ".jinja" || ext === ".jinja2") {
    if (content && (content.includes("{{") || content.includes("{%") || content.includes("prompt"))) {
      return "prompt_template";
    }
  }

  if (basename === "membra-manifest.json" || basename === "ggfu-manifest.json") {
    return "manifest";
  }

  if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];
  if (isBinary) return "binary";
  return "unknown";
}

// ─── Scanner ───────────────────────────────────────────────────────

/** Scan a local directory and produce a deterministic inventory. */
export function scanDirectory(dirPath: string, options?: {
  detectSecrets?: boolean;
  analyzeLicenses?: boolean;
}): ScanResult {
  const detectSecretsFlag = options?.detectSecrets ?? true;
  const analyzeLicenses = options?.analyzeLicenses ?? true;
  const scanId = `scan_${nanoid(12)}`;
  const files: ScannedFile[] = [];
  const hashToFiles = new Map<string, string[]>();
  const depMap = new Map<string, DependencyInventory>();

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue;
        scanFile(fullPath, dirPath);
      }
    }
  }

  function scanFile(fullPath: string, rootDir: string) {
    const stats = fs.statSync(fullPath);
    if (stats.size > 100 * 1024 * 1024) return;

    const relativePath = path.relative(rootDir, fullPath);
    const isBinary = isBinaryFile(fullPath, stats);
    const ext = path.extname(fullPath).toLowerCase();

    let content: string | null = null;
    let contentHash: string;
    let secretFindings: SecretFinding[] = [];
    let detectedDeps: string[] = [];
    let detectedLicense: string | null = null;

    if (!isBinary) {
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        content = null;
      }
    }

    if (content !== null) {
      contentHash = sha256Hex(content);
      if (detectSecretsFlag) {
        secretFindings = detectSecrets(content);
      }
      if (ext === ".py") {
        detectedDeps = detectPythonImports(content);
      }
      if (analyzeLicenses) {
        detectedLicense = detectLicense(fullPath, content);
      }
    } else {
      try {
        const buf = fs.readFileSync(fullPath);
        contentHash = sha256Hex(buf.toString("utf8"));
      } catch {
        contentHash = sha256Hex(relativePath + ":" + stats.size);
      }
    }

    const fileClass = classifyFile(fullPath, relativePath, content, isBinary);

    const scanned: ScannedFile = {
      relativePath,
      absolutePath: fullPath,
      fileClass,
      sizeBytes: stats.size,
      contentHash,
      encoding: isBinary ? "binary" : "utf8",
      language: detectLanguage(fullPath),
      isBinary,
      detectedLicense,
      secretFindings,
      detectedDependencies: detectedDeps,
    };

    files.push(scanned);

    const existing = hashToFiles.get(contentHash);
    if (existing) {
      existing.push(relativePath);
    } else {
      hashToFiles.set(contentHash, [relativePath]);
    }

    for (const dep of detectedDeps) {
      const existingDep = depMap.get(dep);
      if (existingDep) {
        if (!existingDep.foundIn.includes(relativePath)) {
          existingDep.foundIn.push(relativePath);
        }
      } else {
        depMap.set(dep, {
          name: dep,
          version: null,
          type: "python_import",
          foundIn: [relativePath],
        });
      }
    }
  }

  walk(dirPath);

  const duplicateClusters: DuplicateCluster[] = [];
  for (const [hash, fileList] of hashToFiles) {
    if (fileList.length > 1) {
      const firstFile = files.find(f => f.relativePath === fileList[0]);
      duplicateClusters.push({
        contentHash: hash,
        files: fileList,
        sizeBytes: firstFile?.sizeBytes ?? 0,
      });
    }
  }

  const licenseSummary: Record<string, number> = {};
  for (const file of files) {
    if (file.detectedLicense) {
      licenseSummary[file.detectedLicense] = (licenseSummary[file.detectedLicense] ?? 0) + 1;
    }
  }

  const secretCount = files.reduce((sum, f) => sum + f.secretFindings.length, 0);
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  return {
    scanId,
    sourceUri: `file://${dirPath}`,
    sourceType: "local_dir",
    scannedAt: new Date().toISOString(),
    files,
    totalFiles: files.length,
    totalBytes,
    duplicateClusters,
    detectedDependencies: Array.from(depMap.values()),
    secretCount,
    licenseSummary,
    deterministic: true,
  };
}

/** Verify that two scans of the same directory produce identical results. */
export function verifyDeterminism(dirPath: string): {
  deterministic: boolean;
  firstScan: ScanResult;
  secondScan: ScanResult;
} {
  const firstScan = scanDirectory(dirPath);
  const secondScan = scanDirectory(dirPath);

  const same =
    firstScan.totalFiles === secondScan.totalFiles &&
    firstScan.totalBytes === secondScan.totalBytes &&
    firstScan.files.length === secondScan.files.length &&
    firstScan.files.every((f, i) =>
      f.relativePath === secondScan.files[i].relativePath &&
      f.contentHash === secondScan.files[i].contentHash &&
      f.sizeBytes === secondScan.files[i].sizeBytes
    );

  return { deterministic: same, firstScan, secondScan };
}
