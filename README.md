<div align="center">

# § Dharma Contract Auditor

**Reviews a contract through two lenses at once — legal-logical consistency and Right Livelihood ethics — with citations that are actually verified.**

Built on the [Dharma AI](https://dharma-ai.io) organization-scoped RAG platform + Gemini.
An example implementation of a retrieval-grounded contract audit workflow.

**Clone it, add your keys, run one command.** No framework, no build step.

</div>

---

Paste a contract (or a few clauses), pick the type and whose side you're on, and
the tool retrieves ethical-framework passages from the Dharma corpus, analyzes
the document with Gemini as **structured JSON**, and **verifies every quoted
ethical principle against the retrieved source text** before rendering it.

It produces an audit you can act on:

- an **overall risk rating** and a recommendation (framed as information, not a directive);
- a **contract snapshot** — type, parties, term, governing law — extracted from the text;
- **logical issues** (contradictions, ambiguities, unilateral rights, hidden liabilities, missing clauses, undefined terms), each with a **severity** and the **clause** it points at;
- **ethical issues** through a Right Livelihood lens (exploitation, deception, power imbalance, transparency, non-harming), each grounded in a cited, verified source;
- **suggested revisions** shown as original → proposed with a rationale;
- **questions to put to the counterparty**;
- a compact **risk register**;
- a **sources panel** where each citation carries a `verified` / `partial` / `unverified` badge.

> **Not legal advice.** This is an AI aid for spotting issues and questions. It
> is not a substitute for review by a qualified attorney. The server attaches
> this disclaimer to every result.

## Run it (about two minutes)

```bash
git clone <your-fork-url> dharma-contract-auditor
cd dharma-contract-auditor
npm install
cp .env.example .env        # then paste in your three keys
npm start                   # → http://localhost:3000
```

## Get Dharma AI Credentials

Live contract audits require a Dharma AI HQ organization with Developer API access.

1. Sign in to Dharma AI HQ: https://hq.dharma-ai.io
2. Open **Portal -> Developer Suite -> Developer API**, or go directly to:
   https://hq.dharma-ai.io/dev/developer-api?orgId=<your_org_id>
3. You must be an organization owner/admin for that org.
4. Create a developer token with `rag:search`. Add `rag:rerank` if you want
   reranking enabled.
5. Copy the token immediately. It starts with `dharma_org_` and is shown only once.
6. Add `DHARMA_ORG_ID` and `DHARMA_DEV_TOKEN` to `.env`.

If you do not have Dharma AI HQ access or an org admin role, request access from
the Dharma AI team or your organization admin. The static preview at
`preview/contract-auditor.html` works without credentials.

| Variable | What |
|---|---|
| `DHARMA_ORG_ID` | Your org id, e.g. `org_12345` |
| `DHARMA_DEV_TOKEN` | Scoped developer token (`dharma_org_…`) with `rag:search` (+ `rag:rerank`) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key from Google AI Studio |

Optional: `PORT`, `DHARMA_API_BASE_URL`, `DHARMA_USE_RERANK=false`, `GEMINI_MODEL`.
There's a static, no-keys design preview at `preview/contract-auditor.html`.

## Why a plain Node server (not a framework)

So anyone can clone this, drop in keys, and it just works — no bundler, no
native binaries, no build cache to break. The app is a ~110-line Node HTTP
server that serves **one HTML file with its CSS inline** (styling can never
fail to load) and exposes a single JSON endpoint. Secrets are read only in
`server/index.ts` and never reach the browser.

## Architecture

```
Browser ──POST /api/audit──▶ Node server (server/index.ts — secrets live here)
                                  │
                                  ├─▶ DharmaDeveloperClient
                                  │     · multi-query rag/search  (40 cr each)
                                  │     · rag/rerank              (10 cr)
                                  │     · 402-halt · 202 poll · retry/backoff
                                  │
                                  ├─▶ Gemini via generateObject(ContractAuditSchema)
                                  │
                                  └─▶ grounding.ts  verify quoted principles → badges
```

```
public/index.html          the whole UI: inline CSS + a renderer for the audit JSON
server/index.ts            HTTP server; serves the page, runs /api/audit
src/lib/
  dharmaClient.ts          typed search + rerank client (timeout, retry, 402-halt, 202 poll, credits)
  schema.ts                Zod schema for request + the full ContractAudit (model output contract)
  grounding.ts             near-verbatim quote verification → verified/partial/unverified
  contractAuditor.ts       retrieve → rerank → generateObject → verify grounding
preview/contract-auditor.html  static design preview (sample clause, no keys)
docs/IMPLEMENTATION-NOTES.md    design notes for structured output, retrieval, safety, and failure handling
```

## Credit cost per audit

Roughly `40 × (2–4 queries) + 10 (rerank)` credits — about **90–170 credits**.
The exact spend and remaining pool balance come back with every audit.

## License

MIT — see [LICENSE](LICENSE). Not legal advice; not affiliated with any
monastic institution. Scriptural content is served from the Dharma AI corpus
under its own terms.
