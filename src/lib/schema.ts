/**
 * The contract-audit domain model.
 *
 * The reference UC2 returned three loose arrays — logicalIssues, ethicalViolations,
 * and suggestedRevisions — scraped out of the model's prose with `text.split(...)`.
 * This schema is written from what a contracts-and-ethics reviewer actually needs
 * on the page: findings with a severity, the clause they point at, an overall risk
 * read, concrete revisions, negotiation questions, and — because this is an ethics
 * lens grounded in a scriptural corpus — citations whose quoted principles can be
 * verified against the retrieved source text.
 *
 * Everything is a Zod schema so it doubles as the model's structured-output
 * contract (via the AI SDK's `generateObject`). That replaces the original's
 * brittle marker-splitting.
 *
 * NOTE: This tool produces information to inform a human's own judgement. It is
 * not legal advice. The server always attaches a disclaimer to the result.
 */

import { z } from "zod";

// -- request ----------------------------------------------------------------

export const CONTRACT_TYPES = [
  "employment",
  "vendor / services",
  "lease",
  "NDA",
  "partnership",
  "sales / purchase",
  "other",
] as const;

export const PERSPECTIVES = ["reviewing party", "counterparty", "neutral"] as const;

export const ContractAuditRequestSchema = z.object({
  contractText: z.string().min(50, "Paste the contract text (at least a clause or two)."),
  contractType: z.enum(CONTRACT_TYPES).default("other"),
  /** Whose interests to weigh when flagging imbalance. */
  perspective: z.enum(PERSPECTIVES).default("neutral"),
  /** Optional context: jurisdiction, industry, specific worries. Not used as legal advice. */
  focus: z.string().optional(),
});

export type ContractAuditRequest = z.infer<typeof ContractAuditRequestSchema>;

// -- building blocks --------------------------------------------------------

export const SEVERITY = ["low", "medium", "high", "critical"] as const;
const LOW_MED_HIGH = ["low", "medium", "high"] as const;

const LOGICAL_CATEGORIES = [
  "contradiction",
  "ambiguity",
  "unilateral_right",
  "hidden_liability",
  "missing_clause",
  "undefined_term",
  "circular_reference",
  "unenforceable_term",
] as const;

export const LogicalIssueSchema = z.object({
  title: z.string(),
  category: z.enum(LOGICAL_CATEGORIES),
  severity: z.enum(SEVERITY),
  clauseReference: z
    .string()
    .describe("A short quoted snippet or section label the issue points at, e.g. '§7.2' or a quoted phrase. Use 'n/a' if it's a missing clause."),
  explanation: z.string().describe("What the problem is and why it matters, in plain language."),
});

const ETHICAL_CATEGORIES = [
  "exploitation",
  "deception",
  "non_harming",
  "fair_dealing",
  "transparency",
  "power_imbalance",
  "right_livelihood",
] as const;

export const EthicalIssueSchema = z.object({
  title: z.string(),
  category: z.enum(ETHICAL_CATEGORIES),
  severity: z.enum(SEVERITY),
  clauseReference: z.string().describe("The clause/section this concerns, or 'n/a'."),
  principle: z.string().describe("The ethical principle at stake, in one line."),
  explanation: z.string(),
  sourceIds: z
    .array(z.string())
    .describe("IDs (e.g. 'S1') of retrieved sources grounding this. Empty if it is general fairness reasoning, not a scriptural claim."),
  quotedPrinciple: z
    .string()
    .nullable()
    .describe("A near-verbatim quotation from one of the cited sources supporting this, or null. Must appear in the source text — do not paraphrase into quotes."),
});

export const RevisionSchema = z.object({
  clauseReference: z.string(),
  original: z.string().describe("The problematic language, quoted from the contract."),
  proposed: z.string().describe("A concrete rewrite."),
  rationale: z.string(),
  sourceIds: z.array(z.string()).describe("Grounding source ids if the rationale is ethical; may be empty."),
});

export const RiskItemSchema = z.object({
  item: z.string(),
  likelihood: z.enum(LOW_MED_HIGH),
  impact: z.enum(LOW_MED_HIGH),
  mitigation: z.string(),
});

export const CitationSchema = z.object({
  id: z.string().describe("Stable source id, e.g. 'S1', matching the retrieved sources."),
  title: z.string(),
  reference: z.string(),
  translationStatus: z.string(),
  score: z.number(),
  /** Filled in by the server after generation — the model never sets this. */
  groundingStatus: z.enum(["verified", "partial", "unverified"]).default("unverified"),
});

// -- the audit --------------------------------------------------------------

export const OVERALL_RISK = ["low", "moderate", "elevated", "high"] as const;
export const RECOMMENDATIONS = [
  "proceed",
  "proceed_with_changes",
  "renegotiate",
  "do_not_sign",
] as const;

export const ContractAuditSchema = z.object({
  summary: z.string().describe("A 2–4 sentence plain-language read of the contract and its main concerns."),
  overallRiskRating: z.enum(OVERALL_RISK),
  recommendation: z.enum(RECOMMENDATIONS),
  recommendationRationale: z
    .string()
    .describe("Why, framed as information for the reader's own decision — not as a directive."),

  contractSnapshot: z.object({
    type: z.string(),
    parties: z.string().describe("Parties as best extracted, or 'unclear from text'."),
    termOrDuration: z.string().describe("The term/duration, or 'not specified'."),
    governingLaw: z.string().describe("Governing law if stated, or 'not specified'."),
  }),

  logicalIssues: z.array(LogicalIssueSchema),
  ethicalIssues: z.array(EthicalIssueSchema),
  suggestedRevisions: z.array(RevisionSchema),
  questionsForCounterparty: z.array(z.string()),
  riskRegister: z.array(RiskItemSchema),

  citations: z.array(CitationSchema),
});

export type ContractAudit = z.infer<typeof ContractAuditSchema>;

/** The model produces everything except citation grounding status (server-computed). */
export const GeneratedContractAuditSchema = ContractAuditSchema.extend({
  citations: z.array(CitationSchema.omit({ groundingStatus: true })),
});

// -- API response -----------------------------------------------------------

export interface RetrievalProvenance {
  sourceId: string;
  title: string;
  score: number;
  translationStatus: string;
  query: string;
}

export const NOT_LEGAL_ADVICE =
  "This analysis is generated by an AI system to help you spot issues and questions. " +
  "It is not legal advice and is not a substitute for review by a qualified attorney in the relevant jurisdiction.";

export interface AuditResult {
  audit: ContractAudit;
  provenance: RetrievalProvenance[];
  warnings: string[];
  disclaimer: string;
  credits: { spent: number; poolBalance: number | null };
}
