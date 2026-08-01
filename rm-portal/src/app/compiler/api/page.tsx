"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Boxes,
  Cpu,
  FileJson,
  Image as ImageIcon,
  MessageSquare,
  Search,
  Terminal,
  Zap,
} from "lucide-react"
import { PageHeader } from "@/components/ui-helpers"

interface EndpointDoc {
  method: string
  path: string
  title: string
  description: string
  icon: React.ElementType
  color: string
  schema: Record<string, { type: string; required?: boolean; description: string }>
  example: Record<string, unknown>
}

const V1_ENDPOINTS: EndpointDoc[] = [
  {
    method: "POST",
    path: "/v1/chat/completions",
    title: "Chat Completions",
    description: "OpenAI-compatible chat completions endpoint. Sends a conversation and receives a generated response.",
    icon: MessageSquare,
    color: "text-blue-400",
    schema: {
      model: { type: "string", required: true, description: "HF repo ID or compiled model name" },
      messages: {
        type: "array",
        required: true,
        description: "Array of { role, content } message objects",
      },
      max_tokens: { type: "integer", description: "Maximum tokens to generate (default: 128)" },
    },
    example: {
      model: "TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is the meaning of life?" },
      ],
      max_tokens: 128,
    },
  },
  {
    method: "POST",
    path: "/v1/completions",
    title: "Completions",
    description: "OpenAI-compatible text completions endpoint. Generates text from a single prompt.",
    icon: Terminal,
    color: "text-emerald-400",
    schema: {
      model: { type: "string", required: true, description: "HF repo ID or compiled model name" },
      prompt: { type: "string", required: true, description: "The prompt to complete" },
      max_tokens: { type: "integer", description: "Maximum tokens to generate (default: 128)" },
    },
    example: {
      model: "microsoft/phi-2",
      prompt: "The future of AI is",
      max_tokens: 64,
    },
  },
  {
    method: "POST",
    path: "/v1/embeddings",
    title: "Embeddings",
    description: "OpenAI-compatible embeddings endpoint. Generates vector embeddings for the input text.",
    icon: Cpu,
    color: "text-purple-400",
    schema: {
      model: { type: "string", required: true, description: "HF repo ID or compiled model name" },
      input: { type: "string", required: true, description: "Text to embed" },
    },
    example: {
      model: "sentence-transformers/all-MiniLM-L6-v2",
      input: "The quick brown fox jumps over the lazy dog.",
    },
  },
  {
    method: "POST",
    path: "/v1/images/generations",
    title: "Image Generations",
    description: "OpenAI-compatible image generation endpoint. Generates images from a text prompt using diffusion models.",
    icon: ImageIcon,
    color: "text-pink-400",
    schema: {
      model: { type: "string", required: true, description: "HF repo ID or compiled model name" },
      prompt: { type: "string", required: true, description: "Text description of the image to generate" },
      size: { type: "string", description: "Image size: 256x256, 512x512, or 1024x1024 (default: 1024x1024)" },
    },
    example: {
      model: "stable-diffusion-v1-5/stable-diffusion-v1-5",
      prompt: "A serene mountain landscape at sunset, oil painting",
      size: "1024x1024",
    },
  },
  {
    method: "POST",
    path: "/v1/inference",
    title: "Generic Inference",
    description: "Universal inference endpoint for any model type. Supports task-specific inference for models that don't fit the standard OpenAI patterns.",
    icon: Zap,
    color: "text-amber-400",
    schema: {
      model: { type: "string", required: true, description: "HF repo ID or compiled model name" },
      input: { type: "string", required: true, description: "Input data for the model" },
      task: { type: "string", description: "Inference task type (default: auto)" },
    },
    example: {
      model: "bert-base-uncased",
      input: "The capital of France is Paris.",
      task: "auto",
    },
  },
]

const COMPILER_ENDPOINTS: EndpointDoc[] = [
  {
    method: "POST",
    path: "/api/compiler/inspect",
    title: "Inspect Model",
    description: "Inspects a Hugging Face repo without compiling. Returns metadata, architecture, detected formats, and an execution plan.",
    icon: Search,
    color: "text-blue-400",
    schema: {
      repo_id: { type: "string", required: true, description: "Hugging Face repo ID (e.g. microsoft/phi-2)" },
    },
    example: {
      repo_id: "TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF",
    },
  },
  {
    method: "POST",
    path: "/api/compiler/compile",
    title: "Compile Model",
    description: "Inspects and compiles a Hugging Face repo into a running inference endpoint. Returns the full inspection result plus endpoint info.",
    icon: Boxes,
    color: "text-emerald-400",
    schema: {
      repo_id: { type: "string", required: true, description: "Hugging Face repo ID (e.g. microsoft/phi-2)" },
    },
    example: {
      repo_id: "TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF",
    },
  },
  {
    method: "GET",
    path: "/api/compiler/models",
    title: "List Compiled Models",
    description: "Returns all models that have been compiled into inference endpoints.",
    icon: FileJson,
    color: "text-purple-400",
    schema: {},
    example: {},
  },
]

function methodBadgeClass(method: string): string {
  switch (method) {
    case "POST":
      return "border-amber-500/30 bg-amber-500/10 text-amber-400"
    case "GET":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    case "PATCH":
      return "border-blue-500/30 bg-blue-500/10 text-blue-400"
    default:
      return "border-border/80 bg-accent/30 text-foreground/80"
  }
}

function EndpointCard({ doc }: { doc: EndpointDoc }) {
  const Icon = doc.icon
  return (
    <Card className="border-border bg-card/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${doc.color}`} />
            <CardTitle className="text-base text-foreground">{doc.title}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={methodBadgeClass(doc.method)}>
              {doc.method}
            </Badge>
            <code className="text-xs text-muted-foreground">{doc.path}</code>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{doc.description}</p>

        {Object.keys(doc.schema).length > 0 && (
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Request Body</span>
            <div className="overflow-x-auto rounded-lg border border-border bg-sidebar">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-2 font-medium text-muted-foreground">Field</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(doc.schema).map(([field, info]) => (
                    <tr key={field} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2">
                        <code className="text-emerald-400">{field}</code>
                        {info.required && (
                          <span className="ml-1 text-[9px] text-red-400">*required</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{info.type}</td>
                      <td className="px-3 py-2 text-muted-foreground">{info.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Example Request</span>
          <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar p-3 text-xs text-emerald-400">
            {Object.keys(doc.example).length > 0
              ? JSON.stringify(doc.example, null, 2)
              : "// No request body required"}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

export default function CompilerApiReferencePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="API Reference"
        subtitle="Universal OpenAI-compatible /v1/* endpoints and HF Model Compiler endpoints"
      />

      {/* Universal v1 endpoints */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Universal Inference — /v1/*
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          All inference endpoints are OpenAI-compatible. Pass any compiled model name or HF repo ID as the{" "}
          <code className="text-emerald-400">model</code> field. The compiler automatically routes to the
          correct runtime (llama.cpp, vLLM, transformers, ONNX, diffusers, etc.).
        </p>
        <div className="space-y-4">
          {V1_ENDPOINTS.map((doc) => (
            <EndpointCard key={doc.path} doc={doc} />
          ))}
        </div>
      </div>

      {/* Compiler endpoints */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-blue-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Model Compiler — /api/compiler/*
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Use these endpoints to inspect Hugging Face repos and compile them into running inference
          endpoints.
        </p>
        <div className="space-y-4">
          {COMPILER_ENDPOINTS.map((doc) => (
            <EndpointCard key={doc.path} doc={doc} />
          ))}
        </div>
      </div>

      {/* Quick start */}
      <Card className="border-border bg-card/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <CardTitle className="text-base text-foreground">Quick Start</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              1. Compile a model
            </span>
            <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar p-3 text-xs text-emerald-400">
{`curl -X POST /api/compiler/compile \\
  -H "Content-Type: application/json" \\
  -d '{"repo_id": "TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF"}'`}
            </pre>
          </div>
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              2. Call the inference endpoint
            </span>
            <pre className="overflow-x-auto rounded-lg border border-border bg-sidebar p-3 text-xs text-emerald-400">
{`curl -X POST /v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "TheBloke/TinyLlama-1.1B-Chat-v0.3-GGUF",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 128
  }'`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
