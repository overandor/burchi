"""Auth router — user accounts, sessions, and API key management."""

from __future__ import annotations

import hashlib
import os

from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader, HTTPBearer

from app import store_gguf as store
from app.schemas_gguf import (
    APIKeyCreate, APIKeyResponse,
    UserRegister, UserLogin, UserResponse, LoginResponse, UserAPIKeyCreate,
)
from app.auth_gguf import require_scope, verify_request, get_current_user

router = APIRouter(tags=["auth"])

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)


def _hash_password(password: str) -> str:
    salt = os.environ.get("PASSWORD_SALT", "torrent_gguf_v1")
    return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()


def _verify_password(password: str, password_hash: str) -> bool:
    return _hash_password(password) == password_hash


def _user_response(user: dict) -> UserResponse:
    return UserResponse(
        id=user["id"],
        email=user["email"],
        username=user["username"],
        role=user["role"],
        created_at=user["created_at"],
        updated_at=user["updated_at"],
    )


# ─── User Account Endpoints ──────────────────────────────────────

@router.post("/api/auth/register", response_model=LoginResponse, status_code=201)
async def register(body: UserRegister):
    """Register a new user account and return a session token."""
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if "@" not in body.email:
        raise HTTPException(status_code=400, detail="Invalid email address.")

    existing = store.get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered.")

    password_hash = _hash_password(body.password)
    user = store.create_user(body.email, body.username, password_hash)
    session = store.create_session(user["id"])

    return LoginResponse(
        token=session["token"],
        user=_user_response(user),
        expires_at=session["expires_at"],
    )


@router.post("/api/auth/login", response_model=LoginResponse)
async def login(body: UserLogin):
    """Login with email/password and receive a session token."""
    user = store.get_user_by_email(body.email)
    if not user or not _verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    session = store.create_session(user["id"])
    return LoginResponse(
        token=session["token"],
        user=_user_response(user),
        expires_at=session["expires_at"],
    )


@router.post("/api/auth/logout", status_code=204)
async def logout(key_info: dict = Depends(get_current_user)):
    """Logout and revoke the current session."""
    token = key_info.get("session_token")
    if token:
        store.revoke_session(token)


@router.get("/api/auth/me", response_model=UserResponse)
async def me(key_info: dict = Depends(get_current_user)):
    """Get the current authenticated user's profile."""
    user = store.get_user_by_id(key_info["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return _user_response(user)


# ─── User-Scoped API Key Management ──────────────────────────────

@router.post("/api/auth/keys", response_model=APIKeyResponse, status_code=201)
async def create_user_api_key(body: UserAPIKeyCreate, key_info: dict = Depends(get_current_user)):
    """Create an API key tied to the authenticated user's account."""
    return store.create_api_key(body.name, body.scopes, user_id=key_info["user_id"])


@router.get("/api/auth/keys", response_model=list[APIKeyResponse])
async def list_user_api_keys(key_info: dict = Depends(get_current_user)):
    """List all API keys belonging to the authenticated user."""
    return store.list_api_keys_for_user(key_info["user_id"])


@router.delete("/api/auth/keys/{key}", status_code=204)
async def revoke_user_api_key(key: str, key_info: dict = Depends(get_current_user)):
    """Revoke an API key. Users can only revoke their own keys."""
    keys = store.list_api_keys_for_user(key_info["user_id"])
    if not any(k["key"] == key for k in keys):
        raise HTTPException(status_code=404, detail="API key not found or not owned by you.")
    store.revoke_api_key(key)


# ─── Admin API Key Management (existing, unchanged) ──────────────

@router.post("/api/keys", response_model=APIKeyResponse, status_code=201)
async def create_api_key(body: APIKeyCreate, key_info: dict = Depends(require_scope("admin"))):
    """Create a new API key. Requires admin scope."""
    return store.create_api_key(body.name, body.scopes)


@router.get("/api/keys", response_model=list[APIKeyResponse])
async def list_api_keys(key_info: dict = Depends(require_scope("admin"))):
    """List all API keys. Requires admin scope."""
    return store.list_api_keys()


@router.delete("/api/keys/{key}", status_code=204)
async def revoke_api_key(key: str, key_info: dict = Depends(require_scope("admin"))):
    """Revoke an API key. Requires admin scope."""
    if not store.revoke_api_key(key):
        raise HTTPException(status_code=404, detail="API key not found")
