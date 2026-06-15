# Autonomous Agent

A self-hosted, always-on autonomous agent composed from four open projects:

- **OpenClaw** — communication front door (chat channels → Gateway)
- **Paperclip** — top-level orchestrator (decomposes goals, hires sub-agents)
- **Claude Code** (primary) + **OpenAI Codex** (secondary) — execution harnesses
- **Hermes** — shared memory (local hot tier + self-hosted shared tier on a VPS)

See [`plan.md`](./plan.md) for the full architecture and build roadmap.

## Quick start (local stack)

```bash
cp .env.example .env      # fill in API keys, channel tokens, budgets
scripts/up.sh             # bring up the local stack
scripts/down.sh           # stop (add --volumes to wipe data)
```

## Shared memory on a VPS

```bash
scripts/deploy-vps.sh user@your-vps      # deploys docker-compose.vps.yml
# then set HERMES_REMOTE_ENDPOINT in .env to the VPS endpoint
```

## Layout

| Path | Purpose | Phase |
|------|---------|-------|
| `docker-compose.yml` | Local stack | 1 |
| `docker-compose.vps.yml` | Shared memory tier (VPS) | 1 / 3 |
| `paperclip/config/org-chart.yaml` | Roles, budgets, governance | 1 |
| `paperclip/adapters/` | Claude (primary) + Codex (secondary) wiring | 2 |
| `memory-mcp/` | MCP server exposing Hermes memory | 3 |
| `openclaw/plugins/paperclip-bridge/` | Channel ↔ Paperclip bridge | 5 |

## Status

Phase 1 (scaffold & secrets) complete. Image references in the compose files are
placeholders pinned to verify against each project's published images before the
first `up`.
