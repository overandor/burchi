"""Real YouTube Data API v3 client — multi-account upload, maintenance, analytics.

This is a thin wrapper over google-api-python-client. It requires real OAuth2
credentials at runtime. Without credentials it raises a clear RuntimeError —
no fake data, no mocks, no stubs (rule 4).

Credential setup per account:
  1. Create an OAuth2 client in Google Cloud Console (YouTube Data API v3 enabled).
  2. Download client_secrets.json.
  3. First run triggers the browser OAuth flow and caches a token.json next to it.
  4. Subsequent runs reuse the cached token (refreshes automatically).

Scopes:
  - youtube.upload           — upload videos
  - youtube                  — read/write video metadata
  - yt-analytics.readonly    — pull analytics (views, watch time, revenue)
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

# These imports are heavy; do them lazily inside functions so the module
# can be imported (and its warehouse layer tested) without the Google
# libraries installed.


SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]

# Chunk size for resumable uploads (10 MB).
UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024


class YouTubeClientError(RuntimeError):
    """Raised when the YouTube API client cannot be used (missing creds, etc)."""


def _import_google():
    """Lazily import Google API libraries. Raises YouTubeClientError if missing."""
    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload, MediaIoBaseUpload
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        return {
            "build": build,
            "MediaFileUpload": MediaFileUpload,
            "MediaIoBaseUpload": MediaIoBaseUpload,
            "Request": Request,
            "Credentials": Credentials,
            "InstalledAppFlow": InstalledAppFlow,
        }
    except ImportError as e:
        raise YouTubeClientError(
            f"Google API libraries not installed: {e}. "
            "Install with: pip install google-api-python-client google-auth-oauthlib"
        ) from e


def _get_credentials(credentials_path: str):
    """Load or refresh OAuth2 credentials for one account.

    Args:
        credentials_path: Path to client_secrets.json (OAuth client config).
                          A token.json is cached next to it after first auth.

    Raises:
        YouTubeClientError: If the secrets file doesn't exist or auth fails.
    """
    libs = _import_google()
    secrets = Path(credentials_path)
    if not secrets.exists():
        raise YouTubeClientError(
            f"YouTube client secrets not found at {credentials_path}. "
            "Download client_secrets.json from Google Cloud Console "
            "(YouTube Data API v3 must be enabled)."
        )

    token_path = secrets.parent / "token.json"
    creds = None

    # Try cached token first.
    if token_path.exists():
        try:
            creds = libs["Credentials"].from_authorized_user_file(str(token_path), SCOPES)
        except Exception:
            creds = None

    # Refresh if expired.
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(libs["Request"]())
            token_path.write_text(creds.to_json())
        except Exception as e:
            raise YouTubeClientError(f"Failed to refresh YouTube token: {e}") from e

    # If no valid creds, run the OAuth flow.
    if not creds or not creds.valid:
        try:
            flow = libs["InstalledAppFlow"].from_client_secrets_file(str(secrets), SCOPES)
            creds = flow.run_local_server(port=0)
            token_path.write_text(creds.to_json())
        except Exception as e:
            raise YouTubeClientError(f"YouTube OAuth flow failed: {e}") from e

    return creds


def _build_youtube(credentials_path: str):
    """Build an authenticated YouTube service object."""
    libs = _import_google()
    creds = _get_credentials(credentials_path)
    return libs["build"]("youtube", "v3", credentials=creds)


def _build_analytics(credentials_path: str):
    """Build an authenticated YouTube Analytics service object."""
    libs = _import_google()
    creds = _get_credentials(credentials_path)
    return libs["build"]("youtubeAnalytics", "v2", credentials=creds)


def get_channel_info(credentials_path: str) -> dict:
    """Fetch the authenticated channel's id and title.

    Returns:
        {"channel_id": str, "channel_title": str}

    Raises:
        YouTubeClientError: If the API call fails.
    """
    youtube = _build_youtube(credentials_path)
    try:
        resp = youtube.channels().list(part="snippet", mine=True).execute()
    except Exception as e:
        raise YouTubeClientError(f"Failed to fetch channel info: {e}") from e
    items = resp.get("items", [])
    if not items:
        raise YouTubeClientError("No YouTube channel found for these credentials.")
    return {
        "channel_id": items[0]["id"],
        "channel_title": items[0]["snippet"]["title"],
    }


def upload_video(
    credentials_path: str,
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    privacy: str = "private",
    category_id: str = "22",  # 22 = People & Blogs
    on_progress: Optional[callable] = None,
) -> dict:
    """Upload a video file to YouTube via resumable upload.

    Args:
        credentials_path: Path to client_secrets.json for the target account.
        file_path: Path to the MP4 file to upload.
        title: Video title.
        description: Video description.
        tags: List of tags.
        privacy: 'private', 'unlisted', or 'public'.
        category_id: YouTube category id (default 22 = People & Blogs).
        on_progress: Optional callback(progress: float) called during upload.

    Returns:
        {"video_id": str, "status": str}

    Raises:
        YouTubeClientError: If the upload fails.
    """
    libs = _import_google()
    if not Path(file_path).exists():
        raise YouTubeClientError(f"Video file not found: {file_path}")

    youtube = _build_youtube(credentials_path)

    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags[:500],
            "categoryId": category_id,
        },
        "status": {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": False,
        },
    }

    media = libs["MediaFileUpload"](
        file_path, mimetype="video/mp4",
        resumable=True, chunksize=UPLOAD_CHUNK_SIZE,
    )

    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status and on_progress:
            on_progress(status.progress() * 100)

    if "id" not in response:
        raise YouTubeClientError(f"YouTube upload failed: {response}")

    return {
        "video_id": response["id"],
        "status": response.get("status", {}).get("uploadStatus", "uploaded"),
    }


def upload_video_bytes(
    credentials_path: str,
    video_bytes: bytes,
    title: str,
    description: str,
    tags: list[str],
    privacy: str = "private",
    category_id: str = "22",
    on_progress: Optional[callable] = None,
) -> dict:
    """Upload video bytes (in-memory) to YouTube via resumable upload.

    Use this when the video is generated in-memory (e.g. by video_converter)
    and you don't want to write it to disk first.
    """
    import io
    libs = _import_google()
    youtube = _build_youtube(credentials_path)

    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags[:500],
            "categoryId": category_id,
        },
        "status": {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": False,
        },
    }

    media = libs["MediaIoBaseUpload"](
        io.BytesIO(video_bytes), mimetype="video/mp4",
        resumable=True, chunksize=UPLOAD_CHUNK_SIZE,
    )

    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status and on_progress:
            on_progress(status.progress() * 100)

    if "id" not in response:
        raise YouTubeClientError(f"YouTube upload failed: {response}")

    return {
        "video_id": response["id"],
        "status": response.get("status", {}).get("uploadStatus", "uploaded"),
    }


def get_video_status(credentials_path: str, video_id: str) -> dict:
    """Check a video's processing/upload status on YouTube.

    Returns:
        {"upload_status": str, "privacy_status": str, "processing_progress": float}
    """
    youtube = _build_youtube(credentials_path)
    try:
        resp = youtube.videos().list(
            part="status,processingDetails", id=video_id,
        ).execute()
    except Exception as e:
        raise YouTubeClientError(f"Failed to fetch video status: {e}") from e
    items = resp.get("items", [])
    if not items:
        raise YouTubeClientError(f"Video {video_id} not found on YouTube.")
    item = items[0]
    status = item.get("status", {})
    processing = item.get("processingDetails", {})
    return {
        "upload_status": status.get("uploadStatus", "unknown"),
        "privacy_status": status.get("privacyStatus", "unknown"),
        "processing_progress": float(processing.get("processingProgress", 0) or 0),
    }


def update_video_metadata(
    credentials_path: str,
    video_id: str,
    title: Optional[str] = None,
    description: Optional[str] = None,
    tags: Optional[list[str]] = None,
    privacy: Optional[str] = None,
) -> dict:
    """Update a video's metadata (title, description, tags, privacy)."""
    youtube = _build_youtube(credentials_path)

    # Fetch current snippet to preserve unchanged fields.
    resp = youtube.videos().list(part="snippet,status", id=video_id).execute()
    items = resp.get("items", [])
    if not items:
        raise YouTubeClientError(f"Video {video_id} not found on YouTube.")
    item = items[0]
    snippet = item["snippet"]
    status = item.get("status", {})

    if title is not None:
        snippet["title"] = title[:100]
    if description is not None:
        snippet["description"] = description[:5000]
    if tags is not None:
        snippet["tags"] = tags[:500]
    if privacy is not None:
        status["privacyStatus"] = privacy

    body = {"id": video_id, "snippet": snippet}
    if privacy is not None:
        body["status"] = status

    resp = youtube.videos().update(part="snippet,status", body=body).execute()
    return {"video_id": resp["id"], "updated": True}


def delete_video(credentials_path: str, video_id: str) -> bool:
    """Delete a video from YouTube."""
    youtube = _build_youtube(credentials_path)
    try:
        youtube.videos().delete(id=video_id).execute()
        return True
    except Exception as e:
        raise YouTubeClientError(f"Failed to delete video {video_id}: {e}") from e


def fetch_analytics(
    credentials_path: str,
    video_id: str,
    start_date: str,
    end_date: str,
) -> dict:
    """Pull analytics for a video from the YouTube Reporting API.

    Args:
        credentials_path: Path to client_secrets.json.
        video_id: YouTube video id.
        start_date: ISO date string "YYYY-MM-DD".
        end_date: ISO date string "YYYY-MM-DD".

    Returns:
        Dict with views, likes, comments, shares, estimated_minutes_watched,
        average_view_duration, etc. Also includes raw_json (full API response).
    """
    analytics = _build_analytics(credentials_path)

    # YouTube Analytics requires the video id prefixed with 'video=='.
    filters = f"video=={video_id}"

    try:
        resp = analytics.reports().query(
            ids="channel==MINE",
            startDate=start_date,
            endDate=end_date,
            metrics=(
                "views,likes,comments,shares,subscribersGained,subscribersLost,"
                "estimatedMinutesWatched,averageViewDuration,averageViewPercentage,"
                "impressions,impressionClickThroughRate,"
                "estimatedRevenue,estimatedAdRevenue"
            ),
            filters=filters,
        ).execute()
    except Exception as e:
        raise YouTubeClientError(f"Failed to fetch analytics: {e}") from e

    # Parse the column headers + first row into a flat dict.
    columns = [c["name"] for c in resp.get("columnHeaders", [])]
    rows = resp.get("rows", [])
    raw = dict(zip(columns, rows[0])) if rows else {}

    return {
        "views": int(raw.get("views", 0)),
        "likes": int(raw.get("likes", 0)),
        "comments": int(raw.get("comments", 0)),
        "shares": int(raw.get("shares", 0)),
        "subscribers_gained": int(raw.get("subscribersGained", 0)),
        "subscribers_lost": int(raw.get("subscribersLost", 0)),
        "estimated_minutes_watched": float(raw.get("estimatedMinutesWatched", 0)),
        "average_view_duration": float(raw.get("averageViewDuration", 0)),
        "average_view_percentage": float(raw.get("averageViewPercentage", 0)),
        "impressions": int(raw.get("impressions", 0)),
        "impressions_ctr": float(raw.get("impressionClickThroughRate", 0)),
        "revenue": float(raw.get("estimatedRevenue", 0)),
        "rpm": float(raw.get("estimatedAdRevenue", 0)),
        "raw_json": resp,
    }
