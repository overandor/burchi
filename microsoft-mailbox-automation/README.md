---
title: Mailbox Automation — Scientific Data Extraction
emoji: 📬
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
short_description: AI-powered mailbox analysis with scientific data extraction
startup_duration_timeout: 10m
---

# Mailbox Automation — Scientific Data Extraction

A production-ready Next.js app for analyzing Gmail / Microsoft 365 mailboxes, extracting structured scientific data, and exporting it to spreadsheets. Deployed on Hugging Face Spaces (Docker SDK), Netlify, and Vercel from a single codebase.

## Deploy

### Hugging Face Spaces (Docker SDK)

This Space runs the Next.js standalone build inside a Docker container on port 7860. The Dockerfile handles the full build — no manual build step needed.

```bash
# The Space auto-builds on push. To deploy manually:
hf spaces restart luguog/mailbox-automation
```

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start)

Uses `@netlify/plugin-nextjs` with serverless functions. Build command and publish dir are in `netlify.toml`.

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Foverandor%2Fburchi&env=NEXT_PUBLIC_DEMO,NEXT_PUBLIC_OAUTH_REDIRECT_BASE&project-name=mailbox-automation)

Uses native Next.js support. Configuration in `vercel.json`.

## Environment variables

All platforms support the same env vars. Set them in the platform dashboard (HF Spaces Settings → Variables and secrets, Netlify Site Settings → Environment, Vercel Project Settings → Environment Variables).

```bash
# For a public demo with no real mailbox, set NEXT_PUBLIC_DEMO=true
NEXT_PUBLIC_DEMO=true

# LLM provider (optional — app falls back to free LLM7 if not set)
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
LLM_ENDPOINT=https://api.openai.com/v1

# For live Microsoft 365 sync
AZURE_CLIENT_ID=
AZURE_TENANT_ID=common
AZURE_CLIENT_SECRET=
MAILBOX_EMAIL=

# For live Gmail sync
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=

# Public URL of the deployed app (for OAuth redirect URIs)
# HF Spaces:  https://luguog-mailbox-automation.hf.space
# Netlify:    https://your-site.netlify.app
# Vercel:     https://your-project.vercel.app
NEXT_PUBLIC_OAUTH_REDIRECT_BASE=https://luguog-mailbox-automation.hf.space
```

## What works without any credentials

- **Public demo mode** — pre-generated sample emails with analyses, mindmaps, and execution plans
- **LLM inference** — automatic fallback to free LLM7 API (no key needed) when the configured endpoint is unavailable
- **Dark mode** — toggle in the header
- **Health check** — `GET /api/health` returns system status

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Architecture

- **Framework**: Next.js 14 (App Router, standalone output)
- **Styling**: Tailwind CSS with dark mode support
- **Deployment**: Single codebase → HF Spaces (Docker), Netlify (serverless), Vercel (serverless)
- **LLM**: OpenAI-compatible endpoints with multi-provider fallback chain (configured → LLM7 → Pollinations)
- **Storage**: Client-side localStorage (serverless-friendly); filesystem on Docker
- **Tests**: Node built-in test runner (`npm test`)
- **Health**: `GET /api/health` checks config, telemetry, analysis, and utils modules

## Notes

- `next.config.js` uses `output: 'standalone'` for Docker/Node hosts (HF Spaces, Fly.io)
- On Netlify/Vercel, the Next.js plugin handles serverless adaptation automatically
- Server-side config is env-first; file-based config falls back safely on serverless
- The Dockerfile exposes port 7860 (HF Spaces default) and 3000 (generic Docker)
