# Paperclip adapters (Phase 2)

Harness wiring for Paperclip's `ServerAdapterModule` interface
(`execute`, `testEnvironment`, `listSkills`, `syncSkills`, `sessionCodec`).

- **claude** — primary harness (Claude Code). Default for all roles.
- **codex** — secondary harness (OpenAI Codex). Fallback / reviewer role.

Most adapters ship with Paperclip; this directory holds local overrides and the
config that pins Claude as primary and Codex as fallback. Each harness reads the
shared memory tools from the local `memory-mcp` server (registered as an MCP
server inside the harness).

> Verified/configured in Phase 2.
