# ChatSync

Unified dashboard for syncing, linking, and sharing context across **Windsurf**, **Devin**, **Claude**, and **Acodex** conversations.

## Features

- **Unified Dashboard** — Browse all conversations from all four AI tools in one place
- **Two-Way Sync** — Link conversations across sources and keep them synchronized
- **Shared Context Layer** — A shared knowledge base that all AI assistants can read from and write to
- **Export & Merge** — Export individual conversations or all data as JSON or Markdown
- **Full-Text Search** — Search across all conversations from all sources

## Architecture

```
ChatSync/
├── backend/
│   ├── main.py              # FastAPI server (port 8765)
│   ├── db.py                # SQLite database layer
│   ├── models.py            # Unified data models
│   ├── sync_engine.py       # Multi-source sync + linking engine
│   ├── context_store.py     # Shared context layer
│   └── adapters/
│       ├── base.py           # Abstract adapter interface
│       ├── windsurf_adapter.py  # Reads Windsurf/Devin NDJSON event logs
│       ├── claude_adapter.py    # Reads Claude JSON exports
│       └── acodex_adapter.py    # Reads Acodex JSON conversations
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main dashboard UI
│   │   ├── lib/api.ts       # API client
│   │   └── main.tsx         # React entry point
│   └── package.json
└── data/                    # SQLite DB + shared context file (auto-created)
```

## Quick Start

### 1. Backend

```bash
cd /Users/alep/CascadeProjects/ChatSync
pip install -r requirements.txt
cd backend
python main.py
```

Backend runs on `http://localhost:8765`.

### 2. Frontend

```bash
cd /Users/alep/CascadeProjects/ChatSync/frontend
npm install
npm run dev
```

Frontend dev server runs on `http://localhost:5174` (proxies API to backend).

### 3. Production build

```bash
cd frontend
npm run build
```

The built frontend is served directly by the FastAPI backend at `http://localhost:8765`.

## How It Works

### Data Sources

- **Windsurf/Devin**: Reads NDJSON event logs from `~/Library/Application Support/Devin/User/acp-events/` and session metadata from `state.vscdb`. Automatically classifies sessions as `windsurf`, `devin`, or `acodex` based on the session key prefix (`devin-cloud` → Devin, `codex-acp` → Acodex, others → Windsurf).
- **Claude**: Reads JSON export files from `~/.claude/exports/`. Place your cla.ai conversation exports there.
- **Acodex**: Reads JSON conversation files from `~/.acodex/conversations/`.

### Sync

Click **Sync Now** in the dashboard to pull all conversations from all adapters into the unified SQLite database. The sync engine:
1. Fetches conversations from each adapter
2. Upserts them into the database (deduplication by source + source_id)
3. Auto-detects linked conversations by normalized title similarity across sources

### Linking

Manually link conversations from different sources in the **Sync & Link** tab. Linked conversations share context and are marked with a link icon.

### Shared Context

The **Context** tab lets you add key-value knowledge entries that are shared across all AI tools. Context is stored in SQLite and also written to `data/shared_context.md` as a readable markdown file.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/conversations` | List conversations (filter by source) |
| GET | `/api/conversations/{id}` | Get single conversation with messages |
| DELETE | `/api/conversations/{id}` | Delete a conversation |
| GET | `/api/search?q=...` | Full-text search across all messages |
| POST | `/api/sync` | Trigger a full sync from all sources |
| GET | `/api/sync/status` | Get sync status and counts |
| POST | `/api/sync-groups` | Create a sync group (link conversations) |
| GET | `/api/sync-groups` | List sync groups |
| GET | `/api/context` | List context entries |
| POST | `/api/context` | Add/update a context entry |
| DELETE | `/api/context/{key}` | Delete a context entry |
| POST | `/api/export` | Export conversations (JSON or Markdown) |
| POST | `/api/live` | Stream a live chat transcript into the DB (idempotent upsert) |
| POST | `/api/heartbeat` | Post a chat heartbeat (session state for sibling coordination) |
| GET | `/api/heartbeats` | List all active sibling heartbeats (auto-prunes stale ones) |
| DELETE | `/api/heartbeat/{session_id}` | Remove a chat's heartbeat on clean exit |
| GET | `/api/crawl/seed` | Ranked keyword seeds derived from conversations (for external crawlers) |
| GET | `/api/crawl/processes` | Structured business-process seeds (category + keywords + description) |
| POST | `/api/pipeline/run` | Run the full analysis pipeline |
| GET | `/api/pipeline/recommendations` | List pipeline ledger entries |

## Heartbeat Protocol

Chats can't be merged, but they **can coordinate** through heartbeats. Each chat
posts a lightweight status snapshot every few minutes; sibling chats read the
list to stay in sync. Stale heartbeats are automatically garbage-collected.

### How to use

**Post your state** (every 2–5 minutes):
```bash
curl -X POST http://localhost:8765/api/heartbeat -H "Content-Type: application/json" -d '{
  "session_id": "cascade-abc123",
  "agent": "cascade",
  "active_task": "fix-tunnel-durability",
  "status": "running",
  "task_status": "IN_PROGRESS",
  "blockers": ["localtunnel URLs are ephemeral"],
  "next_action": "replace localtunnel with cloudflared named tunnel",
  "heartbeat_sequence": 42
}'
```

**Read sibling states** (to coordinate):
```bash
curl http://localhost:8765/api/heartbeats
```

**Clean exit** (remove your heartbeat):
```bash
curl -X DELETE http://localhost:8765/api/heartbeat/cascade-abc123
```

### Auto-GC

Heartbeats older than the TTL (default 600s / 10 min) are pruned on every read.
Override with `?ttl=300` for a shorter window. This ensures old/dead sessions
don't pollute the coordination view.

### Fields

| Field | Description |
|-------|-------------|
| `session_id` | Unique ID for this chat session |
| `agent` | Which tool: `cascade`, `windsurf`, `devin`, `claude`, etc. |
| `active_task` | What this chat is working on |
| `status` | `running`, `idle`, `blocked`, `done` |
| `task_status` | `IN_PROGRESS`, `BLOCKED`, `COMPLETE` |
| `blockers` | List of things preventing progress |
| `next_action` | What this chat plans to do next |
| `commit_sha` | Latest commit if applicable |
| `heartbeat_sequence` | Monotonic counter (increments each post) |
| `payload` | Arbitrary JSON for extra context |

## Live Session Ingest

`POST /api/live` lets an external agent (e.g. the current Devin session) push its
transcript into the unified DB as it grows. Each call upserts the full transcript
for a `conversation_id` — no duplicates. Pushed conversations are tagged
`source=live` and are also picked up by `SyncEngine.sync_all`.

```bash
curl -X POST http://localhost:8765/api/live -H "Content-Type: application/json" -d '{
  "conversation_id": "devin-session-123",
  "title": "Live session",
  "messages": [
    {"role": "user", "content": "I need to automate API discovery", "timestamp": 1700000000.0},
    {"role": "assistant", "content": "That is a new category of software.", "timestamp": 1700000001.0}
  ]
}'
```

## Crawler Seed API

Two read-only endpoints expose conversation-derived seeds so an external crawler
(e.g. SixBrowse) can drive discovery from ChatSync's data:

- `GET /api/crawl/seed?source=live&limit=50&since=7d` — ranked topical keywords with provenance and frequency score.
- `GET /api/crawl/processes?no_llm=true&since=7d` — structured business processes (category, keywords, description, evidence) produced by the deterministic disassembly pass.

## Deployment

### Docker (recommended)

```bash
docker compose up -d
```

This builds the frontend, bundles the backend, and exposes the full app on port 8765 with a persistent volume for the SQLite DB.

### Vercel (serverless)

The `api/index.py` entry point and `vercel.json` config are already set up. The Vercel deployment uses an ephemeral `/tmp/chatsync.db` — data does not persist across cold starts. For persistent storage, use the Docker deployment or point `CHATSYNC_DB_PATH` to a mounted volume.

### Netlify (proxy mode)

The `netlify/functions/api.mjs` function proxies `/api/*` requests to a running ChatSync backend. Set the `CHATSYNC_URL` environment variable to your backend URL (e.g. `https://your-tunnel.example.com`).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHATSYNC_DB_PATH` | `data/chatsync.db` | SQLite database path |
| `CHATSYNC_CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `CHATSYNC_LOG_LEVEL` | `INFO` | Log level (DEBUG, INFO, WARNING, ERROR) |
| `CHATSYNC_RATE_LIMIT` | `0` | Max requests/min per IP (0 = disabled) |
| `CHATSYNC_PORT` | `8765` | Server port |
| `OPENAI_API_KEY` | — | Optional, for LLM-powered pipeline steps |
| `BRAVE_SEARCH_API_KEY` | — | Optional, for prior-art web search |

See `.env.example` for a template.

## YouTube Upload + Maintenance ETL Pipeline

One-click from chat to YouTube, with a full ETL warehouse for provenance and analytics.

### Architecture

```
Conversation → YouTubeScript (title/desc/tags) → MP4 (TTS + slides) → YouTube upload → Warehouse
                                                                                    ↓
                                                                          Analytics ETL pull-back
```

Three warehouse tables track the full lifecycle:

| Table | Purpose |
|-------|---------|
| `youtube_accounts` | Multi-account OAuth credential registry + channel info |
| `youtube_videos` | Lineage: conversation → video record → YouTube video id (provenance) |
| `youtube_analytics` | ETL time-series: append-only analytics snapshots pulled from YouTube |

### Setup (one-time per account)

1. **Create OAuth credentials** in [Google Cloud Console](https://console.cloud.google.com/):
   - Enable **YouTube Data API v3** and **YouTube Analytics API**
   - Create an OAuth 2.0 Client ID (type: Desktop app)
   - Download `client_secrets.json`

2. **Register the account** in ChatSync:
   ```bash
   curl -X POST http://localhost:8765/api/youtube/accounts \
     -H "Content-Type: application/json" \
     -d '{"label": "main channel", "credentials_path": "/path/to/client_secrets.json"}'
   ```

3. **Verify the account** (triggers browser OAuth flow on first run):
   ```bash
   curl -X POST http://localhost:8765/api/youtube/accounts/{account_id}/verify
   ```

### One-click upload

```bash
curl -X POST http://localhost:8765/api/youtube/upload \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "conv-123",
    "account_id": "acct-456",
    "privacy": "private",
    "voice": "Alex"
  }'
```

This generates an MP4 from the conversation (TTS narration + text slides via ffmpeg),
uploads it to YouTube via the Data API, and records the full provenance lineage in the
warehouse. The video starts as `private` — flip to `public` after review.

### Maintenance job

Polls YouTube for processing status and transitions videos through the lifecycle:

```bash
curl -X POST http://localhost:8765/api/youtube/maintenance
```

Transitions: `pending → uploading → uploaded → processing → public/unlisted/private`

### ETL analytics pull

Pulls analytics (views, watch time, revenue, etc.) for all uploaded videos into the
warehouse as append-only time-series snapshots:

```bash
curl -X POST http://localhost:8765/api/youtube/etl?days_back=30
```

### Warehouse overview

```bash
curl http://localhost:8765/api/youtube/warehouse
```

Returns account count, videos by status, and total latest analytics.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/youtube/accounts` | Register a YouTube account (multi-account) |
| GET | `/api/youtube/accounts` | List all accounts |
| DELETE | `/api/youtube/accounts/{id}` | Remove an account |
| POST | `/api/youtube/accounts/{id}/verify` | Verify credentials + fetch channel info (OAuth flow) |
| POST | `/api/youtube/upload` | One-click: conversation → video → YouTube → warehouse |
| GET | `/api/youtube/videos` | List video records (filter by account/conversation/status) |
| GET | `/api/youtube/videos/{id}` | Get a video record with analytics history |
| GET | `/api/youtube/videos/{id}/analytics` | Get analytics time-series for a video |
| POST | `/api/youtube/maintenance` | Run maintenance: poll processing statuses |
| POST | `/api/youtube/etl` | Run ETL: pull analytics into warehouse |
| GET | `/api/youtube/warehouse` | Warehouse summary (accounts, videos, totals) |

### Requirements

- **ffmpeg** + **say** (macOS) — for video generation (same as `/api/video/convert`)
- **Google API credentials** — `client_secrets.json` per account
- No mocks or fake data — the YouTube client calls the real API or raises a clear error

## Testing

```bash
cd backend
python -m pytest tests/ -v
```

44 tests cover: health, conversations CRUD, search, context CRUD, sync status, export,
heartbeat protocol, live ingest, crawler seed endpoints, and the YouTube warehouse layer
(accounts, video lineage, analytics ETL, maintenance status transitions).
