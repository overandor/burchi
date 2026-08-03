# Microsoft Mailbox Automation

A non-local demo-ready Next.js app for analyzing Gmail / Microsoft 365 mailboxes, extracting structured scientific data, and exporting it to spreadsheets.

## Deploy to Vercel (one-click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyour-org%2Fmicrosoft-mailbox-automation&env=OPENAI_API_KEY,NEXT_PUBLIC_DEMO,NEXT_PUBLIC_OAUTH_REDIRECT_BASE&project-name=mailbox-automation&repository-name=mailbox-automation)

## Environment variables

Copy `.env.example` and fill in:

```bash
# For a public demo with no real mailbox, set NEXT_PUBLIC_DEMO=true
# and optionally OPENAI_API_KEY for live LLM.
NEXT_PUBLIC_DEMO=true
OPENAI_API_KEY=sk-...

# For live Microsoft 365 sync
AZURE_CLIENT_ID=
AZURE_TENANT_ID=common
AZURE_CLIENT_SECRET=
MAILBOX_EMAIL=

# For live Gmail sync
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=

# Public URL of the deployed app
NEXT_PUBLIC_OAUTH_REDIRECT_BASE=https://your-project.vercel.app
```

## What works without any local setup

- **Public demo mode** — pre-generated sample emails with analyses, mindmaps, and execution plans.
- **LLM inference** — if `OPENAI_API_KEY` is set, uses OpenAI's remote API (`gpt-4o-mini`).
- **Gmail / Microsoft 365** — requires OAuth credentials, but auth flow runs through serverless API routes.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Notes

- `next.config.js` uses `output: 'standalone'` for non-Vercel Docker/Node hosts.
- Server-side config is env-first; file-based config falls back silently on serverless.
- Filesystem exports are optional; the app uses in-memory records on serverless and `localStorage` as a client-side cache.
