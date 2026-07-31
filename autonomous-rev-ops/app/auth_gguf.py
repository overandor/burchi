"""Auth — API key + session token middleware for the backend."""

from __future__ import annotations

from fastapi import Request, HTTPException, Security
from fastapi.security import APIKeyHeader, HTTPBearer

from app import store_gguf as store

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)

# Routes that don't require auth
PUBLIC_ROUTES = {"/", "/docs", "/openapi.json", "/redoc", "/api/health", "/dashboard",
                 "/api/auth/register", "/api/auth/login"}

# Routes that require only read access
READ_ROUTES = {"/api/models", "/api/nodes", "/api/status", "/api/analytics", "/api/peers"}


async def verify_request(
    request: Request,
    api_key: str = Security(api_key_header),
    bearer = Security(bearer_scheme),
) -> dict:
    """Verify API key or Bearer session token. Public routes are exempt."""
    path = request.url.path

    # Allow public routes
    if path in PUBLIC_ROUTES or path.startswith("/docs") or path.startswith("/openapi"):
        return {"scopes": ["read", "write", "admin"], "name": "public", "user_id": None}

    # Try Bearer token first (user sessions)
    if bearer and bearer.credentials:
        session = store.validate_session(bearer.credentials)
        if session:
            user = session["user"]
            scopes = ["read", "write", "inference"]
            if user.get("role") == "admin":
                scopes.append("admin")
            return {
                "scopes": scopes,
                "name": user["username"],
                "user_id": user["id"],
                "session_token": bearer.credentials,
            }
        # Invalid bearer token — fall through to API key check

    # Try X-API-Key
    if api_key:
        key_info = store.validate_api_key(api_key)
        if not key_info:
            raise HTTPException(status_code=401, detail="Invalid API key.")
        # Check scopes for write operations
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if "write" not in key_info["scopes"] and "admin" not in key_info["scopes"]:
                raise HTTPException(status_code=403, detail="Write access required.")
        return key_info

    # No auth provided
    import os
    if os.environ.get("REQUIRE_AUTH", "false").lower() != "true":
        return {"scopes": ["read", "write", "admin"], "name": "dev", "user_id": None}

    # Allow read-only routes without key
    for route in READ_ROUTES:
        if path.startswith(route) and request.method == "GET":
            return {"scopes": ["read"], "name": "anonymous", "user_id": None}

    raise HTTPException(status_code=401, detail="Authentication required. Use X-API-Key header or Bearer token.")


# Backward compat alias
async def verify_api_key(
    request: Request,
    api_key: str = Security(api_key_header),
    bearer = Security(bearer_scheme),
) -> dict:
    return await verify_request(request, api_key, bearer)


def require_scope(scope: str):
    """Dependency to require a specific scope."""
    async def checker(request: Request, api_key: str = Security(api_key_header), bearer = Security(bearer_scheme)):
        key_info = await verify_request(request, api_key, bearer)
        if scope not in key_info.get("scopes", []) and "admin" not in key_info.get("scopes", []):
            raise HTTPException(status_code=403, detail=f"Scope '{scope}' required.")
        return key_info
    return checker


async def get_current_user(request: Request, api_key: str = Security(api_key_header), bearer = Security(bearer_scheme)) -> dict:
    """Dependency that requires a valid Bearer session and returns the user."""
    key_info = await verify_request(request, api_key, bearer)
    if not key_info.get("user_id"):
        raise HTTPException(status_code=401, detail="Valid session token required.")
    return key_info
