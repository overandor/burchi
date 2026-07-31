"""Models router — CRUD for the model registry."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app import store_gguf as store
from app.schemas_gguf import ModelCreate, ModelUpdate, ModelResponse
from app.auth_gguf import verify_api_key

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=list[ModelResponse])
async def list_models(key_info: dict = Depends(verify_api_key)):
    """List all registered models."""
    return store.list_models()


@router.get("/{model_id}", response_model=ModelResponse)
async def get_model(model_id: str, key_info: dict = Depends(verify_api_key)):
    """Get a specific model by ID."""
    model = store.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.post("", response_model=ModelResponse, status_code=201)
async def create_model(body: ModelCreate, key_info: dict = Depends(verify_api_key)):
    """Register a new model in the registry."""
    # Check for duplicate name
    existing = store.get_model_by_name(body.name)
    if existing:
        raise HTTPException(status_code=409, detail=f"Model '{body.name}' already exists")
    model = store.create_model(body.model_dump())
    store.log_event("model_registered", model_id=model["id"])
    return model


@router.put("/{model_id}", response_model=ModelResponse)
async def update_model(model_id: str, body: ModelUpdate, key_info: dict = Depends(verify_api_key)):
    """Update a model's metadata."""
    model = store.update_model(model_id, body.model_dump(exclude_none=True))
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    store.log_event("model_updated", model_id=model_id)
    return model


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str, key_info: dict = Depends(verify_api_key)):
    """Delete a model from the registry."""
    if not store.delete_model(model_id):
        raise HTTPException(status_code=404, detail="Model not found")
    store.log_event("model_deleted", model_id=model_id)


@router.get("/{model_id}/manifest")
async def get_manifest(model_id: str, key_info: dict = Depends(verify_api_key)):
    """Get the distribution manifest for a model."""
    model = store.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return {
        "model_name": model["name"],
        "model_hash": model["merkle_root"],
        "model_size": model["model_size"],
        "architecture": model["architecture"],
        "quantization": model["quantization"],
        "parameter_count": model["parameter_count"],
        "chunk_count": model["chunk_count"],
        "chunk_size": model["chunk_size"],
        "chunks": model["chunks"],
        "tracker_url": model["tracker_url"],
    }
