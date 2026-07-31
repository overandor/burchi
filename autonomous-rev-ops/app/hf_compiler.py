"""
Hugging Face Model Compiler — inspects HF repos and generates execution plans.

Flow:
  HF repo ID → inspect → execution plan → runtime selection → universal API

Supported format detection:
  - GGUF files → llama.cpp runtime
  - .safetensors → Transformers / vLLM
  - .onnx → ONNX Runtime
  - diffusers (model_index.json) → diffusion runtime
  - sentence-transformers → embedding runtime
  - custom architecture → isolated Python runtime
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from typing import Optional
from urllib.parse import quote

import httpx

HF_API_BASE = "https://huggingface.co/api"
HF_RAW_BASE = "https://huggingface.co"
HF_RESOLVE_BASE = "https://huggingface.co/{repo}/resolve/main/{filename}"


# ─── Data structures ──────────────────────────────────────────────────────

@dataclass
class ModelFileInfo:
    filename: str
    format: str  # gguf, safetensors, onnx, pytorch, diffusers, tokenizer, config, other
    size_bytes: Optional[int] = None


@dataclass
class ExecutionPlan:
    runtime: str  # llama_cpp, transformers, vllm, onnxruntime, diffusers, sentence_transformers, custom
    runtime_description: str
    api_style: str  # chat, completions, embeddings, images, generic
    target_endpoint: str  # /v1/chat/completions, /v1/embeddings, etc.
    estimated_vram_mb: Optional[int] = None
    estimated_ram_mb: Optional[int] = None
    requires_gpu: bool = False
    notes: list[str] = None
    missing_requirements: list[str] = None


@dataclass
class ModelInspection:
    repo_id: str
    author: str
    model_name: str
    pipeline_tag: Optional[str]
    library_name: Optional[str]
    tags: list[str]
    # Architecture
    architectures: list[str]
    model_type: Optional[str]
    vocab_size: Optional[int]
    hidden_size: Optional[int]
    num_hidden_layers: Optional[int]
    torch_dtype: Optional[str]
    # Files
    files: list[dict]
    formats_detected: list[str]
    total_size_bytes: Optional[int]
    # Quantization
    quantization: Optional[str]
    # Execution
    execution_plan: dict
    # Status
    gated: bool
    private: bool
    downloads: int
    likes: int
    error: Optional[str] = None


# ─── Inspector ────────────────────────────────────────────────────────────

FORMAT_MAP = {
    ".gguf": "gguf",
    ".safetensors": "safetensors",
    ".onnx": "onnx",
    ".ot": "pytorch",
    ".bin": "pytorch",
    ".pt": "pytorch",
    ".pth": "pytorch",
    ".ckpt": "pytorch",
    ".model_index.json": "diffusers",
    ".json": "config",
    ".txt": "tokenizer",
    ".model": "tokenizer",
    ".spiece": "tokenizer",
    ".tiktoken": "tokenizer",
    ".png": "other",
    ".jpg": "other",
    ".md": "other",
    ".gitattributes": "other",
}


def detect_format(filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".model_index.json") or lower == "model_index.json":
        return "diffusers"
    if lower.endswith(".gguf"):
        return "gguf"
    if lower.endswith(".safetensors"):
        return "safetensors"
    if lower.endswith(".onnx"):
        return "onnx"
    for ext, fmt in FORMAT_MAP.items():
        if lower.endswith(ext):
            return fmt
    return "other"


async def fetch_repo_info(repo_id: str) -> dict:
    """Fetch model metadata from HF API."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{HF_API_BASE}/models/{quote(repo_id, safe='/')}")
        resp.raise_for_status()
        return resp.json()


async def fetch_config_json(repo_id: str) -> dict:
    """Fetch config.json for a model repo."""
    url = f"{HF_RAW_BASE}/{quote(repo_id, safe='/')}/raw/main/config.json"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json()


async def fetch_model_file_info(repo_id: str, filename: str) -> dict:
    """Fetch metadata for a specific file (size, etc)."""
    url = f"{HF_API_BASE}/models/{quote(repo_id, safe='/')}"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.head(
            f"{HF_RAW_BASE}/{quote(repo_id, safe='/')}/resolve/main/{filename}"
        )
        size = resp.headers.get("X-Linked-Size") or resp.headers.get("content-length")
        return {"filename": filename, "size": int(size) if size else None}


def estimate_model_size(config: dict, files: list[dict]) -> Optional[int]:
    """Estimate total model size from files or config."""
    total = 0
    for f in files:
        if f.get("size"):
            total += f["size"]
    if total > 0:
        return total
    # Estimate from config
    if config.get("num_hidden_layers") and config.get("hidden_size"):
        layers = config["num_hidden_layers"]
        hidden = config["hidden_size"]
        vocab = config.get("vocab_size", 32000)
        # Rough: 2 * params * bytes_per_param
        params = 2 * layers * hidden * hidden + vocab * hidden
        dtype = config.get("torch_dtype", "float32")
        bytes_per = {"float32": 4, "float16": 2, "bfloat16": 2, "int8": 1, "int4": 0.5}
        b = bytes_per.get(dtype, 4)
        return int(params * b)
    return None


def estimate_vram(total_size_bytes: int, runtime: str) -> int:
    """Estimate VRAM needed based on model size and runtime."""
    size_mb = total_size_bytes / (1024 * 1024)
    if runtime == "llama_cpp":
        # llama.cpp adds ~20% overhead for KV cache
        return int(size_mb * 1.2)
    if runtime == "vllm":
        # vLLM needs more headroom for paged attention
        return int(size_mb * 1.5)
    if runtime == "transformers":
        # Transformers needs model + activations
        return int(size_mb * 1.8)
    if runtime == "diffusers":
        return int(size_mb * 1.3)
    return int(size_mb * 1.5)


def generate_execution_plan(
    formats: list[str],
    config: dict,
    pipeline_tag: Optional[str],
    library_name: Optional[str],
    total_size: Optional[int],
) -> ExecutionPlan:
    """Generate an execution plan based on detected formats and metadata."""

    notes = []
    missing = []

    # ─── GGUF → llama.cpp ─────────────────────────────────────────────
    if "gguf" in formats:
        size_mb = (total_size or 0) / (1024 * 1024)
        vram = estimate_vram(total_size or 0, "llama_cpp") if total_size else None
        return ExecutionPlan(
            runtime="llama_cpp",
            runtime_description="llama.cpp — C/C++ inference engine for GGUF format. Supports CPU, GPU (CUDA/Metal), and quantized models.",
            api_style="chat",
            target_endpoint="/v1/chat/completions",
            estimated_vram_mb=vram,
            estimated_ram_mb=int(size_mb * 1.3) if total_size else None,
            requires_gpu=size_mb > 4000 if total_size else False,
            notes=["GGUF format detected — llama.cpp is the optimal runtime",
                   "Supports CPU-only inference for small models",
                   "Quantization already applied in GGUF file"],
            missing_requirements=[],
        )

    # ─── Diffusers → diffusion runtime ────────────────────────────────
    if "diffusers" in formats or library_name == "diffusers" or pipeline_tag == "text-to-image":
        vram = estimate_vram(total_size or 0, "diffusers") if total_size else None
        return ExecutionPlan(
            runtime="diffusers",
            runtime_description="Diffusers — Hugging Face diffusion library for image generation (Stable Diffusion, FLUX, etc).",
            api_style="images",
            target_endpoint="/v1/images/generations",
            estimated_vram_mb=vram,
            estimated_ram_mb=vram,
            requires_gpu=True,
            notes=["Diffusers model detected — requires GPU for reasonable inference speed",
                   "Exposes /v1/images/generations endpoint"],
            missing_requirements=["GPU with >= 8GB VRAM recommended"] if not total_size else [],
        )

    # ─── Sentence Transformers → embedding runtime ────────────────────
    if library_name == "sentence-transformers" or pipeline_tag == "sentence-similarity" or "sentence-similarity" in (config.get("tags") or []):
        return ExecutionPlan(
            runtime="sentence_transformers",
            runtime_description="Sentence Transformers — embedding generation for semantic search, clustering, and similarity.",
            api_style="embeddings",
            target_endpoint="/v1/embeddings",
            estimated_vram_mb=512,
            estimated_ram_mb=1024,
            requires_gpu=False,
            notes=["Sentence transformer detected — lightweight, CPU-capable",
                   "Exposes /v1/embeddings endpoint"],
            missing_requirements=[],
        )

    # ─── ONNX → ONNX Runtime ──────────────────────────────────────────
    if "onnx" in formats:
        return ExecutionPlan(
            runtime="onnxruntime",
            runtime_description="ONNX Runtime — cross-platform accelerator for ONNX models. Supports CPU, GPU, and various execution providers.",
            api_style="chat" if pipeline_tag == "text-generation" else "generic",
            target_endpoint="/v1/chat/completions" if pipeline_tag == "text-generation" else "/v1/inference",
            estimated_vram_mb=estimate_vram(total_size or 0, "onnxruntime") if total_size else None,
            estimated_ram_mb=int((total_size or 0) / (1024 * 1024) * 1.2) if total_size else None,
            requires_gpu=False,
            notes=["ONNX format detected — ONNX Runtime provides optimized cross-platform inference",
                   "Supports CPU execution providers"],
            missing_requirements=[],
        )

    # ─── Safetensors → Transformers or vLLM ───────────────────────────
    if "safetensors" in formats:
        size_mb = (total_size or 0) / (1024 * 1024)
        arch = config.get("architectures", [])
        model_type = config.get("model_type", "")

        # vLLM for large text generation models
        if pipeline_tag == "text-generation" and size_mb > 1000:
            vram = estimate_vram(total_size or 0, "vllm") if total_size else None
            return ExecutionPlan(
                runtime="vllm",
                runtime_description="vLLM — high-throughput LLM inference engine with paged attention. Best for production text generation.",
                api_style="chat",
                target_endpoint="/v1/chat/completions",
                estimated_vram_mb=vram,
                estimated_ram_mb=int(size_mb * 1.2) if total_size else None,
                requires_gpu=True,
                notes=["Safetensors + text-generation detected — vLLM for high-throughput serving",
                       "OpenAI-compatible /v1/chat/completions endpoint"],
                missing_requirements=["GPU with >= 16GB VRAM recommended for models > 7B params"],
            )

        # Transformers for smaller models
        vram = estimate_vram(total_size or 0, "transformers") if total_size else None
        return ExecutionPlan(
            runtime="transformers",
            runtime_description="Hugging Face Transformers — general-purpose inference for safetensors models. Works on CPU and GPU.",
            api_style="chat" if pipeline_tag == "text-generation" else "generic",
            target_endpoint="/v1/chat/completions" if pipeline_tag == "text-generation" else "/v1/inference",
            estimated_vram_mb=vram,
            estimated_ram_mb=int(size_mb * 1.5) if total_size else None,
            requires_gpu=size_mb > 2000 if total_size else False,
            notes=["Safetensors format detected — Transformers runtime",
                   "Falls back to CPU for small models"],
            missing_requirements=[],
        )

    # ─── PyTorch .bin/.pt → Transformers ──────────────────────────────
    if "pytorch" in formats:
        return ExecutionPlan(
            runtime="transformers",
            runtime_description="Hugging Face Transformers — general-purpose inference for PyTorch models.",
            api_style="chat" if pipeline_tag == "text-generation" else "generic",
            target_endpoint="/v1/chat/completions" if pipeline_tag == "text-generation" else "/v1/inference",
            estimated_vram_mb=estimate_vram(total_size or 0, "transformers") if total_size else None,
            estimated_ram_mb=int((total_size or 0) / (1024 * 1024) * 1.5) if total_size else None,
            requires_gpu=True,
            notes=["PyTorch checkpoint detected — Transformers runtime"],
            missing_requirements=["GPU recommended for PyTorch models"],
        )

    # ─── Unknown / custom ──────────────────────────────────────────────
    return ExecutionPlan(
        runtime="custom",
        runtime_description="Custom runtime — isolated Python/container execution for non-standard architectures.",
        api_style="generic",
        target_endpoint="/v1/inference",
        estimated_vram_mb=None,
        estimated_ram_mb=None,
        requires_gpu=False,
        notes=["No standard format detected — will attempt custom execution"],
        missing_requirements=["May require custom dependencies or CUDA kernels"],
    )


async def inspect_model(repo_id: str) -> ModelInspection:
    """
    Inspect a Hugging Face model repository and generate an execution plan.

    Returns a ModelInspection with all metadata + execution plan, or
    an error explaining what's missing.
    """
    repo_id = repo_id.strip().strip("/")

    # Handle full URLs
    if "huggingface.co/" in repo_id:
        repo_id = repo_id.split("huggingface.co/")[-1]
        if repo_id.startswith("models/"):
            repo_id = repo_id[7:]

    try:
        info = await fetch_repo_info(repo_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return ModelInspection(
                repo_id=repo_id, author="", model_name="",
                pipeline_tag=None, library_name=None, tags=[],
                architectures=[], model_type=None, vocab_size=None,
                hidden_size=None, num_hidden_layers=None, torch_dtype=None,
                files=[], formats_detected=[], total_size_bytes=None,
                quantization=None, execution_plan={},
                gated=False, private=False, downloads=0, likes=0,
                error=f"Repository '{repo_id}' not found on Hugging Face",
            )
        return ModelInspection(
            repo_id=repo_id, author="", model_name="",
            pipeline_tag=None, library_name=None, tags=[],
            architectures=[], model_type=None, vocab_size=None,
            hidden_size=None, num_hidden_layers=None, torch_dtype=None,
            files=[], formats_detected=[], total_size_bytes=None,
            quantization=None, execution_plan={},
            gated=False, private=False, downloads=0, likes=0,
            error=f"HF API error: {e.response.status_code}",
        )
    except Exception as e:
        return ModelInspection(
            repo_id=repo_id, author="", model_name="",
            pipeline_tag=None, library_name=None, tags=[],
            architectures=[], model_type=None, vocab_size=None,
            hidden_size=None, num_hidden_layers=None, torch_dtype=None,
            files=[], formats_detected=[], total_size_bytes=None,
            quantization=None, execution_plan={},
            gated=False, private=False, downloads=0, likes=0,
            error=f"Failed to fetch repo: {str(e)}",
        )

    # Parse siblings (files)
    siblings = info.get("siblings", [])
    files = []
    formats_detected = set()

    for sib in siblings:
        fname = sib["rfilename"]
        fmt = detect_format(fname)
        files.append({"filename": fname, "format": fmt, "size": sib.get("size")})
        if fmt in ("gguf", "safetensors", "onnx", "pytorch", "diffusers"):
            formats_detected.add(fmt)

    # Fetch config.json for architecture details
    config = {}
    try:
        config = await fetch_config_json(repo_id)
    except Exception:
        pass

    # Calculate total size
    total_size = estimate_model_size(config, files)

    # Detect quantization
    quantization = None
    if "gguf" in formats_detected:
        # Check GGUF filenames for quant level
        for f in files:
            if f["format"] == "gguf":
                fname = f["filename"].upper()
                for q in ["Q2_K", "Q3_K", "Q4_K", "Q4_0", "Q4_1", "Q5_K", "Q5_0", "Q5_1", "Q6_K", "Q8_0", "F16", "F32"]:
                    if q in fname:
                        quantization = q
                        break
                if quantization:
                    break
    elif config.get("quantization_config"):
        quantization = config["quantization_config"].get("quant_method", "unknown")

    # Generate execution plan
    plan = generate_execution_plan(
        list(formats_detected), config,
        info.get("pipeline_tag"),
        info.get("library_name"),
        total_size,
    )

    author, _, model_name = repo_id.partition("/")

    return ModelInspection(
        repo_id=repo_id,
        author=author,
        model_name=model_name,
        pipeline_tag=info.get("pipeline_tag"),
        library_name=info.get("library_name"),
        tags=info.get("tags", []),
        architectures=config.get("architectures", []),
        model_type=config.get("model_type"),
        vocab_size=config.get("vocab_size"),
        hidden_size=config.get("hidden_size"),
        num_hidden_layers=config.get("num_hidden_layers"),
        torch_dtype=config.get("torch_dtype"),
        files=files,
        formats_detected=sorted(formats_detected),
        total_size_bytes=total_size,
        quantization=quantization,
        execution_plan=asdict(plan),
        gated=info.get("gated", False),
        private=info.get("private", False),
        downloads=info.get("downloads", 0),
        likes=info.get("likes", 0),
    )


def inspection_to_dict(inspection: ModelInspection) -> dict:
    return asdict(inspection)
