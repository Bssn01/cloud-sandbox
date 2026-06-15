# memory-mcp (Phase 3)

Local MCP server that exposes Hermes memory to both harnesses (Claude Code,
Codex) as tools: `recall`, `prefetch`, `write`.

- **Hot tier:** Hermes built-in SQLite + FTS (mounted at `/root/.hermes`).
- **Shared tier:** one external provider self-hosted on the VPS, configured via
  `HERMES_MEMORY_PROVIDER` / `HERMES_REMOTE_ENDPOINT` / `HERMES_SHARED_NAMESPACE`.

Implements the Hermes `MemoryProvider` contract (`initialize`, `prefetch`,
`sync_turn`, `handle_tool_call`, `get_tool_schemas`) against the remote backend.

> Built in Phase 3. `docker-compose.yml` references this via `build: ./memory-mcp`.
> A `Dockerfile` and the server implementation are added in that phase.
