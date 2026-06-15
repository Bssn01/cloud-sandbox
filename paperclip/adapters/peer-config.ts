// ─────────────────────────────────────────────────────────────────────────────
// Paperclip peer-adapter configuration + role assignment.
//
// Claude Code and Codex are ACTIVE PEERS. This module encodes:
//   - the two collaboration workflows (relay, council)
//   - provider assignment to role slots, enforcing the cross-review invariant
//     (reviewer.provider != implementer.provider)
//   - the human-escalation conditions (no autonomous tiebreak)
//
// The actual `ServerAdapterModule` (execute/testEnvironment/listSkills/
// syncSkills/sessionCodec) for each provider ships with Paperclip; this file is
// the local override that pins both as peers and drives slot assignment.
// TODO (user's machine): wire `loadFromOrgChart` to the real Paperclip config
// loader and confirm the ServerAdapterModule import path.
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "claude" | "codex";
export type WorkflowMode = "relay" | "council";

export interface RoleAssignment {
  planner: Provider | Provider[]; // array in council (both deliberate)
  implementer: Provider;
  reviewer: Provider | Provider[]; // array in council (joint review)
}

export interface PeerConfig {
  providers: Provider[];
  defaultMode: WorkflowMode;
  maxReviewRounds: number;
}

export const DEFAULT_PEER_CONFIG: PeerConfig = {
  providers: ["claude", "codex"],
  defaultMode: (process.env.PAPERCLIP_WORKFLOW_MODE as WorkflowMode) || "council",
  maxReviewRounds: Number(process.env.PAPERCLIP_MAX_REVIEW_ROUNDS ?? "1"),
};

const other = (p: Provider): Provider => (p === "claude" ? "codex" : "claude");

/**
 * Assign providers to role slots for a task.
 *
 * Invariant: reviewer.provider !== implementer.provider (independent review).
 * `preferImplementer` lets the orchestrator rotate/load-balance who implements;
 * the reviewer is then forced to the other provider.
 */
export function assignProviders(
  mode: WorkflowMode,
  preferImplementer: Provider = "claude",
): RoleAssignment {
  const implementer = preferImplementer;
  const reviewer = other(implementer);

  if (mode === "relay") {
    // Relay: planner == reviewer (same provider plans then reviews); the other implements.
    return { planner: reviewer, implementer, reviewer };
  }
  // Council: both plan together and both review; one implements.
  return { planner: ["claude", "codex"], implementer, reviewer: ["claude", "codex"] };
}

/** Hard check used by the orchestrator before dispatching any task. */
export function assertCrossReview(a: RoleAssignment): void {
  // Works for relay (scalar reviewer) and council (array of joint reviewers):
  // require at least one reviewer that is NOT the implementer (independent review).
  const reviewers = Array.isArray(a.reviewer) ? a.reviewer : [a.reviewer];
  const hasIndependentReviewer = reviewers.some((r) => r !== a.implementer);
  if (!hasIndependentReviewer) {
    throw new Error(
      `cross-review invariant violated: no reviewer differs from implementer (${a.implementer})`,
    );
  }
}

export type EscalationReason = "council_no_consensus" | "review_failed_after_rounds";

/** Decide whether the task must pause and ask the human (via the OpenClaw bridge). */
export function shouldEscalate(input: {
  councilConsensus?: boolean;
  reviewPassed: boolean;
  reviewRoundsUsed: number;
  maxReviewRounds: number;
}): EscalationReason | null {
  if (input.councilConsensus === false) return "council_no_consensus";
  if (!input.reviewPassed && input.reviewRoundsUsed >= input.maxReviewRounds) {
    return "review_failed_after_rounds";
  }
  return null;
}
