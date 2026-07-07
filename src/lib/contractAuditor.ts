/**
 * ContractAuditor — retrieval-grounded contract audit pipeline.
 *
 * Design notes:
 *
 *  1. Structured output, not string-scraping. The model returns JSON through
 *     `generateObject` and a Zod schema.
 *
 *  2. Retrieval fits the contract. We retrieve for the ethics lens and the
 *     specific contract type, dedupe, and rerank.
 *
 *  3. Citations are verified. Ethical findings quote a principle by source id;
 *     the server checks each quote against the retrieved text and labels the
 *     citation verified / partial / unverified.
 *
 *  4. Findings are actionable: every issue carries a severity and a clause
 *     reference, plus an overall risk rating and a compact risk register — none
 *     of which the flat original arrays captured.
 *
 *  5. It degrades safely. If the ethics corpus returns nothing, we still run the
 *     (ungrounded) logical analysis and warn, rather than inventing scripture.
 *
 *  6. It is not legal advice, and says so (the server attaches a disclaimer).
 */

import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { DharmaDeveloperClient, type SearchResult } from "./dharmaClient";
import { verifyGrounding, type QuoteClaim } from "./grounding";
import {
  GeneratedContractAuditSchema,
  type ContractAudit,
  type ContractAuditRequest,
  type AuditResult,
  type RetrievalProvenance,
} from "./schema";

export interface ContractAuditorOptions {
  model?: string;
  useRerank?: boolean;
  maxSources?: number;
  perQueryTopK?: number;
  /** Contracts can be long; cap chars sent to the model. Default 45000. */
  maxContractChars?: number;
}

export class ContractAuditor {
  private readonly model: string;
  private readonly useRerank: boolean;
  private readonly maxSources: number;
  private readonly perQueryTopK: number;
  private readonly maxContractChars: number;

  constructor(private readonly client: DharmaDeveloperClient, opts: ContractAuditorOptions = {}) {
    this.model = opts.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    this.useRerank = opts.useRerank ?? true;
    this.maxSources = opts.maxSources ?? 8;
    this.perQueryTopK = opts.perQueryTopK ?? 4;
    this.maxContractChars = opts.maxContractChars ?? 45_000;
  }

  async audit(req: ContractAuditRequest): Promise<AuditResult> {
    const warnings: string[] = [];

    let contractText = req.contractText;
    if (contractText.length > this.maxContractChars) {
      contractText = contractText.slice(0, this.maxContractChars);
      warnings.push(
        `Contract was longer than ${this.maxContractChars} characters and was truncated for analysis — review the remainder separately.`,
      );
    }

    // 1. Retrieve the ethics lens, tuned to the contract type -----------------
    const retrieved = await this.retrieve(req, warnings);
    if (retrieved.size === 0) {
      warnings.push(
        "No ethical-framework sources were retrieved; ethical findings will be general reasoning, not scripturally grounded.",
      );
    }

    // 2. Order sources --------------------------------------------------------
    const ordered = await this.orderSources(req, retrieved, warnings);
    const kept = ordered.slice(0, this.maxSources);
    const sourceById = new Map(kept.map((s) => [s.sid, s.result] as const));

    // 3. Structured generation ------------------------------------------------
    const audit = await this.draft(req, contractText, kept);

    // 4. Verify grounding of ethical citations --------------------------------
    const citedIds = new Set<string>();
    for (const c of audit.citations) citedIds.add(c.id);
    for (const e of audit.ethicalIssues) e.sourceIds.forEach((id) => citedIds.add(id));
    for (const r of audit.suggestedRevisions) r.sourceIds.forEach((id) => citedIds.add(id));

    const quotes: QuoteClaim[] = audit.ethicalIssues
      .filter((e) => e.quotedPrinciple && e.sourceIds[0])
      .map((e) => ({ sourceId: e.sourceIds[0], quote: e.quotedPrinciple as string }));

    const grounding = verifyGrounding(sourceById, quotes, citedIds);
    warnings.push(...grounding.warnings);

    const verified: ContractAudit = {
      ...audit,
      citations: audit.citations.map((c) => ({
        ...c,
        groundingStatus: grounding.status[c.id] ?? "unverified",
      })),
    };

    const provenance: RetrievalProvenance[] = kept.map((s) => ({
      sourceId: s.sid,
      title: s.result.title,
      score: s.result.score,
      translationStatus: s.result.translationStatus,
      query: s.query,
    }));

    return {
      audit: verified,
      provenance,
      warnings,
      disclaimer: "", // set by the server so it's authoritative, not model-authored
      credits: { spent: this.client.creditsSpent, poolBalance: this.client.lastPoolBalance },
    };
  }

  // -- steps ---------------------------------------------------------------

  private buildQueries(req: ContractAuditRequest): string[] {
    const q = [
      "Buddhist principles for Right Livelihood, honest trade, fair dealing, non-exploitation and non-harming in agreements",
      `Ethical obligations and fairness specific to ${req.contractType} agreements and the relationship between the parties`,
    ];
    if (req.focus && req.focus.trim()) q.push(`Ethical guidance relevant to: ${req.focus.trim()}`);
    return q.slice(0, 4);
  }

  private async retrieve(
    req: ContractAuditRequest,
    warnings: string[],
  ): Promise<Map<string, { result: SearchResult; query: string; sid: string }>> {
    const pool = new Map<string, { result: SearchResult; query: string; sid: string }>();
    let counter = 1;
    for (const query of this.buildQueries(req)) {
      let res;
      try {
        res = await this.client.search(query, { topK: this.perQueryTopK });
      } catch (err: unknown) {
        const e = err as { fatal?: boolean; message?: string };
        if (e.fatal) throw err;
        warnings.push(`A retrieval query failed and was skipped: ${e.message}`);
        continue;
      }
      for (const r of res.results) {
        if (!pool.has(r.id)) pool.set(r.id, { result: r, query, sid: `S${counter++}` });
      }
    }
    return pool;
  }

  private async orderSources(
    req: ContractAuditRequest,
    pool: Map<string, { result: SearchResult; query: string; sid: string }>,
    warnings: string[],
  ): Promise<Array<{ sid: string; result: SearchResult; query: string }>> {
    const entries = [...pool.values()];
    if (!this.useRerank || entries.length <= this.maxSources) {
      return entries.sort((a, b) => b.result.score - a.result.score);
    }
    try {
      const rr = await this.client.rerank(
        `Most relevant ethical principles for auditing a ${req.contractType} contract for fairness and non-exploitation`,
        entries.map((e) => ({ id: e.sid, text: `${e.result.title}: ${e.result.content}` })),
      );
      const order = new Map(rr.results.map((r, i) => [r.candidate.id, i]));
      return entries.sort((a, b) => (order.get(a.sid) ?? 999) - (order.get(b.sid) ?? 999));
    } catch (err: unknown) {
      const e = err as { fatal?: boolean; message?: string };
      if (e.fatal) throw err;
      warnings.push(`Rerank unavailable; using vector score ordering (${e.message}).`);
      return entries.sort((a, b) => b.result.score - a.result.score);
    }
  }

  private async draft(
    req: ContractAuditRequest,
    contractText: string,
    sources: Array<{ sid: string; result: SearchResult }>,
  ): Promise<ContractAudit> {
    const sourceBlock = sources.length
      ? sources
          .map((s) => `### ${s.sid} — ${s.result.title} (${s.result.translationStatus})\n${s.result.content}`)
          .join("\n\n")
      : "(no ethical-framework sources were retrieved; do not fabricate citations)";

    const system = [
      "You are a meticulous contract reviewer with two lenses: legal-logical consistency and Buddhist business ethics (Right Livelihood, non-exploitation, honesty, non-harming).",
      "You are careful and specific: every issue names the clause it concerns and a severity.",
      "For the ethical lens you cite ONLY the numbered sources provided, by id (e.g. 'S1'), and any quotedPrinciple must be copied near-verbatim from that source — never invent scripture.",
      "You are not a lawyer and you do not give legal advice or guarantees; you surface issues and questions for a human to weigh.",
      "Analyze only what the contract text supports; do not assume facts not present.",
    ].join(" ");

    const prompt = `Audit the following ${req.contractType} contract from the perspective of the ${req.perspective}.
${req.focus ? `The reviewer is particularly concerned with: ${req.focus}\n` : ""}
LOGICAL LENS: find contradictions, ambiguities, undefined terms, unilateral rights, hidden liabilities, missing protections, circular references, and potentially unenforceable terms. These do NOT get scriptural citations.

ETHICAL LENS (Right Livelihood): find exploitation, deception, unfair power imbalance, opacity, and non-harming concerns. Ground each in the retrieved sources where possible, citing by id and quoting a principle near-verbatim.

Also produce: an overall risk rating and a recommendation framed as information for the reader's own decision (not a directive), a snapshot (type, parties, term, governing law) extracted from the text, concrete suggested revisions (original → proposed → rationale), questions to ask the counterparty, and a compact risk register.

RETRIEVED ETHICAL SOURCES — cite ONLY these, by id:
${sourceBlock}

CONTRACT TEXT:
"""
${contractText}
"""`;

    const { object } = await generateObject({
      model: google(this.model),
      schema: GeneratedContractAuditSchema,
      system,
      prompt,
    });

    return {
      ...object,
      citations: object.citations.map((c) => ({ ...c, groundingStatus: "unverified" as const })),
    };
  }
}
