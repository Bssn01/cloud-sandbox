# Paperclip adapters (Phase 2)

Harness wiring for Paperclip's `ServerAdapterModule` interface
(`execute`, `testEnvironment`, `listSkills`, `syncSkills`, `sessionCodec`).

- **claude** — Claude Code.
- **codex** — OpenAI Codex.

Both adapters are **active peers** — neither is primary or fallback. They run
simultaneously and collaborate via the workflow defined in
`../config/org-chart.yaml` (modes: `relay`, `council`).

## How providers map to role slots
Roles are provider-agnostic *slots* (`planner` / `implementer` / `reviewer`).
The orchestrator assigns a provider to each slot per task, subject to one hard
invariant:

> **`reviewer.provider != implementer.provider`** — review is always done by the
> *other* provider, so it is genuinely independent.

- **Relay:** provider A plans → provider B (≠ A) implements → provider A reviews.
- **Council:** Claude + Codex jointly plan (reconcile to consensus) → one
  implements → the other (or both) reviews.

Unresolved council disagreement, or a review still failing after
`workflow.max_review_rounds`, **escalates to the user** (no autonomous tiebreak).

Most adapters ship with Paperclip; this directory holds local overrides plus the
peer config above. Each harness reads the shared memory tools from the local
`memory-mcp` server (registered as an MCP server inside the harness).

> Verified/configured in Phase 2.
