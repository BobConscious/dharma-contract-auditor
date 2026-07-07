# AGENTS.md — runbook for coding agents

You are an AI coding agent asked to spin up this repo. Follow these steps
exactly. `README.md` is the human overview; this file is the setup source of truth.

## What this is

A self-contained web tool that audits a contract through two lenses — legal-logical
consistency and Right Livelihood ethics — grounded in the Dharma AI RAG corpus.
A plain Node HTTP server (`server/index.ts`) serves one HTML page
(`public/index.html`, CSS inline) and exposes `POST /api/audit`, which calls the
Dharma RAG API + Google Gemini server-side and returns a typed audit whose
ethical citations are verified against retrieved source text. **No framework,
no build step** — do not add Next.js, Vite, webpack, or a bundler.

## Prerequisites

- Node.js >= 18 (needs global `fetch` and `AbortController`). Check `node -v`.
- Three API credentials (below). If the human hasn't provided them, ask — the
  server starts without them but cannot run an audit.
- Dharma AI credentials come from Dharma AI HQ: sign in at
  https://hq.dharma-ai.io, then open Portal -> Developer Suite -> Developer API.
  The direct route is `/dev/developer-api?orgId=<your_org_id>`. Token creation
  requires an organization owner/admin role.

## Setup

```bash
npm install
cp .env.example .env
```

Then set three secrets in `.env` (never hard-code them, never put them in
`public/`):

```
DHARMA_ORG_ID=org_...
DHARMA_DEV_TOKEN=dharma_org_...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

## Start

```bash
npm start          # http://localhost:3000  (or PORT=4000 npm start)
```

On boot the server prints `✓ Keys detected` or `⚠ Keys missing`.

## Verify (before reporting success)

```bash
npm run typecheck    # must exit 0

curl -s http://localhost:3000/ | grep -q "Contract Auditor" && echo OK

# validation → HTTP 400 invalid_request
curl -s -X POST http://localhost:3000/api/audit -H "Content-Type: application/json" -d '{"contractText":"too short"}'

# real audit (needs valid keys) → HTTP 200 with an "audit" object
curl -s -X POST http://localhost:3000/api/audit -H "Content-Type: application/json" \
  -d '{"contractText":"7.1 The Company may terminate at any time without notice or severance. 7.3 For five years the Contractor shall not compete anywhere in the world.","contractType":"employment","perspective":"neutral"}'
```

Success looks like `{"audit":{...},"provenance":[...],"warnings":[...],"disclaimer":"...","credits":{...}}`.

## Request contract for `POST /api/audit`

Body (validated by `src/lib/schema.ts` → `ContractAuditRequestSchema`):

```jsonc
{
  "contractText": "string (required, >= 50 chars)",
  "contractType": "employment | vendor / services | lease | NDA | partnership | sales / purchase | other",
  "perspective": "reviewing party | counterparty | neutral",
  "focus": "string (optional)"
}
```

Responses: `200` `{ audit, provenance, warnings, disclaimer, credits }` · `400`
`invalid_request` · `402` `token_pool_empty` (**do not retry** — pool empty) ·
`500` `server_misconfigured` · `502` upstream/generation failure.

## Where things live

| Path | Purpose |
|---|---|
| `server/index.ts` | HTTP server; serves the page, handles `/api/audit`; only place secrets are read |
| `public/index.html` | entire UI: inline CSS + JS renderer for the audit JSON |
| `src/lib/schema.ts` | Zod schema = request contract + model output contract |
| `src/lib/contractAuditor.ts` | retrieve → rerank → `generateObject` → verify grounding |
| `src/lib/dharmaClient.ts` | typed Dharma RAG client (retry, 402-halt, 202 poll) |
| `src/lib/grounding.ts` | verifies quoted principles against retrieved text |
| `docs/IMPLEMENTATION-NOTES.md` | design notes for structured output, retrieval, safety, and failure handling |

## Guardrails — do not violate

- Secrets are read only in `server/index.ts`. Never send the org token or Gemini
  key to the browser or embed them in `public/`.
- On `402 token_pool_empty`, halt. Do not retry.
- Do not remove the not-legal-advice disclaimer or present output as legal advice.
- Do not loosen grounding to make more citations show as "verified".
- Keep it build-free: no framework, no bundler.

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `⚠ Keys missing` | `.env` absent/incomplete | create `.env`, add the 3 keys |
| `command not found: tsx` | deps not installed | `npm install` |
| 400 `invalid_request` | contract text < 50 chars | paste more text |
| 502 with a network message | can't reach the Dharma API | check token + connectivity |
| ethical issues show `unverified` | model quoted a principle not in the retrieved text | expected behavior — the guard is working; broaden the query or corpus |
