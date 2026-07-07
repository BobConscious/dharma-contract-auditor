/**
 * Citation grounding.
 *
 * The original UC2 asserted ethical "violations" with cited sources but never
 * checked that the model's quoted principles actually came from those sources.
 * For an ethics auditor built on a scriptural corpus, an unverified citation is
 * a liability: it lends scriptural authority to text the corpus may not contain.
 *
 * Here "verified" means the quoted principle attached to a finding is present,
 * near-verbatim, in the retrieved source it is attributed to. A citation is:
 *   - verified   — a quoted principle was matched in the retrieved source;
 *   - partial    — cited as support but nothing was quoted (nothing to verify);
 *   - unverified — a quote was attributed to it but not found in its text, or the
 *                  id was never retrieved.
 */

import type { SearchResult } from "./dharmaClient";

export type GroundingStatus = "verified" | "partial" | "unverified";

/** A concrete quotation the model attributed to a source, to be checked. */
export interface QuoteClaim {
  sourceId: string;
  quote: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fraction of the quote's word-trigrams found in the source text. */
function trigramContainment(quote: string, source: string): number {
  const q = normalize(quote).split(" ").filter(Boolean);
  const s = normalize(source);
  if (q.length === 0) return 0;
  if (q.length < 3) return s.includes(q.join(" ")) ? 1 : 0;

  const sTokens = s.split(" ");
  const sTri = new Set<string>();
  for (let i = 0; i + 2 < sTokens.length; i++) sTri.add(`${sTokens[i]} ${sTokens[i + 1]} ${sTokens[i + 2]}`);

  let hits = 0;
  let total = 0;
  for (let i = 0; i + 2 < q.length; i++) {
    total++;
    if (sTri.has(`${q[i]} ${q[i + 1]} ${q[i + 2]}`)) hits++;
  }
  return total === 0 ? 0 : hits / total;
}

const VERIFY_THRESHOLD = 0.6;

export interface GroundingReport {
  status: Record<string, GroundingStatus>;
  warnings: string[];
}

export function verifyGrounding(
  retrieved: Map<string, SearchResult>,
  quotes: QuoteClaim[],
  citedSourceIds: Set<string>,
): GroundingReport {
  const status: Record<string, GroundingStatus> = {};
  const warnings: string[] = [];

  for (const id of citedSourceIds) {
    if (!retrieved.has(id)) {
      status[id] = "unverified";
      warnings.push(`Citation ${id} references a source that was never retrieved — treated as ungrounded.`);
    } else {
      status[id] = "partial";
    }
  }

  for (const c of quotes) {
    if (!c.quote || !c.quote.trim()) continue;
    const src = retrieved.get(c.sourceId);
    if (!src) {
      status[c.sourceId] = "unverified";
      warnings.push(`A quoted principle was attributed to ${c.sourceId}, which was not retrieved.`);
      continue;
    }
    const containment = trigramContainment(c.quote, src.content);
    if (containment >= VERIFY_THRESHOLD) {
      status[c.sourceId] = "verified";
    } else {
      status[c.sourceId] = "unverified";
      warnings.push(
        `A quoted principle attributed to "${src.title}" (${c.sourceId}) does not match the retrieved text ` +
          `(${Math.round(containment * 100)}% overlap) — likely paraphrased or fabricated.`,
      );
    }
  }

  return { status, warnings };
}
