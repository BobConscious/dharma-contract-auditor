# Implementation Notes

This project is a hardened implementation of a contract-audit workflow using
Dharma AI retrieval plus structured model output.

## Structured output

The audit is generated with `generateObject` and a Zod schema instead of parsing
free-form prose. This keeps logical issues, ethical issues, revisions, risk
register entries, citations, and recommendations as typed fields that can be
validated before they reach the UI.

## Contract-aware retrieval

The retriever sends multiple queries: one for the general Right Livelihood lens,
one tuned to the selected contract type, and an optional focus query. Results are
deduplicated and can be reranked before the model sees them.

## Citation grounding

Ethical findings cite retrieved source IDs. When a finding includes a quoted
principle, the server compares that quote against the retrieved source text and
labels the citation as `verified`, `partial`, or `unverified`. Unverified quotes
produce warnings instead of being silently accepted.

## Legal-adjacent safety

The output is framed as information for human review, not legal advice. The
server attaches the fixed disclaimer from `src/lib/schema.ts` to every result so
the model cannot remove or rewrite it.

## Failure handling

The Dharma API client handles timeout, retry/backoff for transient failures,
the documented async poll loop, usage accounting, and `402 token_pool_empty` as a
hard stop. If no ethics sources are retrieved, the audit can still run, but it
returns an explicit warning that ethical findings are not grounded in retrieved
sources.
