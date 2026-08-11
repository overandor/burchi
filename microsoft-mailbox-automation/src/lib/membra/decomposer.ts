/**
 * Membra Decomposer — Phase 2
 *
 * Builds a dependency graph from a scan result, detects duplicates,
 * separates shared frames from proprietary payloads, and detects cycles.
 */

import { nanoid } from "nanoid";
import type {
  ScanResult,
  ScannedFile,
  ArtifactGraph,
  GraphNode,
  GraphEdge,
  FrameDefinition,
  PayloadDefinition,
  ComponentRole,
  FileClass,
} from "@/types";

// ─── Classification heuristics ─────────────────────────────────────

const FRAME_CLASSES: FileClass[] = [
  "configuration",
  "documentation",
  "license_file",
];

const PAYLOAD_CLASSES: FileClass[] = [
  "model_weights",
  "model_config",
  "prompt_template",
  "dataset",
];

const SECRET_CLASSES: FileClass[] = ["secret"];

function classifyRole(file: ScannedFile, isDuplicate: boolean): ComponentRole {
  if (SECRET_CLASSES.includes(file.fileClass)) return "secret_external";
  if (file.secretFindings.length > 0) return "secret_external";
  if (isDuplicate) return "frame";
  if (FRAME_CLASSES.includes(file.fileClass)) return "frame";
  if (PAYLOAD_CLASSES.includes(file.fileClass)) return "proprietary_payload";
  if (file.fileClass === "python_source" || file.fileClass === "wasm_binary") {
    return "execution_only";
  }
  if (file.fileClass === "asset") return "optional_asset";
  return "execution_only";
}

// ─── Graph construction ────────────────────────────────────────────

export function buildArtifactGraph(scan: ScanResult): ArtifactGraph {
  const graphId = `graph_${nanoid(12)}`;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const duplicateHashes = new Set(scan.duplicateClusters.map(c => c.contentHash));
  const hashToCanonical = new Map<string, string>();
  const pathToNodeId = new Map<string, string>();

  for (const file of scan.files) {
    const isDuplicate = duplicateHashes.has(file.contentHash);
    const role = classifyRole(file, isDuplicate);

    let canonicalId: string | null = null;
    if (isDuplicate) {
      const existing = hashToCanonical.get(file.contentHash);
      if (existing) {
        canonicalId = existing;
      }
    }

    const nodeId = `node_${nanoid(10)}`;
    const node: GraphNode = {
      ggfuId: `ggfu:sha256:${file.contentHash}`,
      name: file.relativePath,
      role,
      fileClass: file.fileClass,
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
      isDuplicate,
      canonicalId,
    };

    nodes.push(node);
    pathToNodeId.set(file.relativePath, nodeId);

    if (!hashToCanonical.has(file.contentHash)) {
      hashToCanonical.set(file.contentHash, nodeId);
    }
  }

  for (const file of scan.files) {
    const fromId = pathToNodeId.get(file.relativePath)!;
    for (const dep of file.detectedDependencies) {
      const matchingFiles = scan.files.filter(f => {
        const basename = f.relativePath.replace(/\.py$/, "").replace(/\//g, ".");
        return basename === dep || basename.endsWith("." + dep) || f.relativePath.includes(dep.replace(/\./g, "/"));
      });
      for (const matchFile of matchingFiles) {
        const toId = pathToNodeId.get(matchFile.relativePath)!;
        if (fromId !== toId) {
          edges.push({ fromId, toId, edgeType: "imports", required: true });
        }
      }
    }
  }

  for (const cluster of scan.duplicateClusters) {
    const canonical = hashToCanonical.get(cluster.contentHash);
    if (!canonical) continue;
    for (const filePath of cluster.files) {
      const nodeId = pathToNodeId.get(filePath);
      if (nodeId && nodeId !== canonical) {
        edges.push({ fromId: canonical, toId: nodeId, edgeType: "contains", required: false });
      }
    }
  }

  const frames = extractFrames(nodes);
  const payloads = extractPayloads(nodes, edges, frames);
  const cycles = detectCycles(nodes, edges);

  const unresolvedRisks: string[] = [];
  for (const file of scan.files) {
    if (file.secretFindings.length > 0) {
      unresolvedRisks.push(`Secret detected in ${file.relativePath}: ${file.secretFindings.length} finding(s)`);
    }
  }
  if (cycles.length > 0) {
    unresolvedRisks.push(`${cycles.length} cycle(s) detected in dependency graph`);
  }

  return { graphId, scanId: scan.scanId, nodes, edges, frames, payloads, cycles, unresolvedRisks, createdAt: new Date().toISOString() };
}

function extractFrames(nodes: GraphNode[]): FrameDefinition[] {
  const frameNodes = nodes.filter(n => n.role === "frame");
  const frames: FrameDefinition[] = [];
  const hashToNodes = new Map<string, GraphNode[]>();
  for (const node of frameNodes) {
    const existing = hashToNodes.get(node.contentHash);
    if (existing) existing.push(node);
    else hashToNodes.set(node.contentHash, [node]);
  }
  for (const [hash, nodeList] of hashToNodes) {
    frames.push({
      frameId: `frame_${nanoid(10)}`,
      name: nodeList[0].name,
      componentIds: nodeList.map(n => n.ggfuId),
      contentHash: hash,
      reuseCount: nodeList.length,
    });
  }
  return frames;
}

function extractPayloads(nodes: GraphNode[], edges: GraphEdge[], frames: FrameDefinition[]): PayloadDefinition[] {
  const payloadNodes = nodes.filter(n => n.role === "proprietary_payload");
  const payloads: PayloadDefinition[] = [];
  for (const node of payloadNodes) {
    const frameDep = edges.find(e => e.toId === node.ggfuId && e.edgeType === "depends_on");
    const frameId = frameDep ? frames.find(f => f.componentIds.includes(frameDep.fromId))?.frameId ?? null : null;
    payloads.push({
      payloadId: `payload_${nanoid(10)}`,
      name: node.name,
      componentIds: [node.ggfuId],
      contentHash: node.contentHash,
      frameId,
      isEncrypted: false,
    });
  }
  return payloads;
}

function detectCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.ggfuId, []);
  for (const edge of edges) {
    if (edge.required) adjacency.get(edge.fromId)?.push(edge.toId);
  }
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string) {
    if (recursionStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      if (cycleStart >= 0) cycles.push([...path.slice(cycleStart), nodeId]);
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) dfs(neighbor);
    path.pop();
    recursionStack.delete(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.ggfuId)) dfs(node.ggfuId);
  }
  return cycles;
}
