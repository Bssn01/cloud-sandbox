# Build Plan: Full Autonomous Agent (Self-Hosted)

## Context

This document plans a **self-hosted, always-on autonomous agent** that runs on the user's own machine, composed from four existing open projects — each filling exactly one layer:

| Layer | Tool | Role |
|-------|------|------|
| Communication / front door | **OpenClaw** | Messaging channels (Telegram/WhatsApp/Slack/Discord/Signal/…) → Gateway control plane |
| Orchestration (top-level brain) | **Paperclip** | Decomposes goals, "hires" specialized sub-agents, org chart + budgets + governance |
| Harness / execution | **Claude Code** (primary) + **OpenAI Codex** (secondary) | The agents that actually *do* the work |
| Memory | **Hermes** (Nous Research) | Persistent + shared memory across agents/sessions |

These tools **overlap** (each ships its own agent loop), so the design deliberately uses only one layer from each and disables the others' redundant loops.

**Decisions driving this plan:**
- **Topology:** Paperclip is the top-level orchestrator. OpenClaw is a channel front-door that feeds goals into Paperclip; Claude Code/Codex are hired harnesses; Hermes is shared memory.
- **Model routing:** Claude Code is the default harness; Codex/OpenAI is fallback + second-opinion + specific roles.
- **Packaging:** Docker Compose stack, local-first.
- **Memory:** Hybrid — local hot tier on the machine + a **shared cloud tier self-hosted on a small VPS** so memory is reachable across agents and devices.

**Intended outcome:** send a goal from a chat app → Paperclip plans and dispatches Claude/Codex sub-agents → they share memory via Hermes → results stream back to the same chat thread, running 24/7.

---

## Target architecture

```
        ┌──────────── User's chat apps (Telegram / WhatsApp / Slack …) ────────────┐
        │                                                                          │
        ▼                                                                          ▲
 ┌─────────────────┐   goal/task        ┌──────────────────────┐   result         │
 │ OpenClaw Gateway│ ─────────────────▶ │  Paperclip orchestr.  │ ─────────────────┘
 │  (channels)     │ ◀───────────────── │  (CEO/org chart/budget)│
 └─────────────────┘   status/replies   └───────────┬───────────┘
        LOCAL MACHINE                                │ hires sub-agents (ServerAdapterModule)
                                          ┌──────────┴───────────┐
                                          ▼                      ▼
                                 ┌──────────────┐       ┌──────────────┐
                                 │ Claude Code  │       │ OpenAI Codex │   (harnesses)
                                 │  (primary)   │       │ (secondary)  │
                                 └──────┬───────┘       └──────┬───────┘
                                        │ memory tools (MCP)   │
                                        ▼                      ▼
                                 ┌───────────────────────────────────┐
                                 │   Memory MCP gateway (local)        │  hot tier: Hermes built-in SQLite/FTS
                                 └──────────────────┬─────────────────┘
                                                    │ shared external provider
                                                    ▼
                                 ┌───────────────────────────────────┐
                                 │   VPS: self-hosted Hermes memory    │  shared/cloud tier (Hindsight/RetainDB)
                                 │   backend (knowledge graph/vectors) │
                                 └───────────────────────────────────┘
```

### Why each integration point works
- **OpenClaw → Paperclip:** OpenClaw's Plugin SDK (`register(api)`) exposes `api.registerChannel`, `api.registerTool`, and lifecycle hooks (`message_received`, `before_tool_call`, `gateway_start`). We do **not** let OpenClaw run its own LLM agent loop; instead a thin plugin forwards inbound messages to Paperclip's API and posts results back to the originating channel/session.
- **Paperclip → harnesses:** Paperclip is runtime-agnostic and ships adapters implementing `ServerAdapterModule` (`execute`, `testEnvironment`, `listSkills`, `syncSkills`, `sessionCodec`) for Claude Code, Codex, OpenClaw bots, etc. Roles are configured to use the Claude adapter by default and Codex as fallback.
- **Harnesses → Hermes:** Both Claude Code and Codex support MCP. Shared memory is exposed as a **memory MCP server** (recall/prefetch/write tools) backed by Hermes, so every sub-agent reads/writes the same store without embedding Hermes' agent loop. Hermes' `MemoryProvider` ABC (`initialize`, `prefetch`, `sync_turn`, `handle_tool_call`, `get_tool_schemas`) is the contract the cloud tier implements.

---

## Memory design (hybrid local + cloud, shared)

Hermes keeps its built-in memory always-on and allows exactly **one** external provider at a time — which maps cleanly onto two tiers:

- **Hot/local tier:** Hermes **built-in SQLite + full-text search** on the local machine. Low-latency working/scratch memory per agent.
- **Shared/cloud tier:** **one self-hosted external provider on the VPS** (recommended: **Hindsight** — knowledge graph with cross-memory synthesis, self-hostable; **RetainDB** is the alternative for hybrid vector+BM25+rerank). Configured in each agent's `~/.hermes/config.yaml` via `memory.provider` pointing at the VPS endpoint, with a **shared namespace/session scope** so all Paperclip-hired sub-agents see the same org memory.

This gives the desired mix: local hot tier per agent, shared graph tier on the user's own VPS (private, cross-device, cross-agent).

---

## Packaging & repo layout (Docker Compose, local-first + VPS split)

```
cloud-sandbox/
├── plan.md                         # this document
├── docker-compose.yml              # LOCAL stack
├── docker-compose.vps.yml          # CLOUD stack (deployed to VPS)
├── .env.example                    # API keys, endpoints, channel tokens, budgets
├── openclaw/
│   └── plugins/paperclip-bridge/   # OpenClaw plugin: channel ↔ Paperclip
├── paperclip/
│   ├── config/org-chart.yaml       # roles, budgets, governance, default goals
│   └── adapters/                   # Claude (primary) + Codex (secondary) wiring
├── memory-mcp/                     # MCP server exposing Hermes memory as tools
└── scripts/
    ├── up.sh / down.sh
    └── deploy-vps.sh
```

- **Local stack** (`docker-compose.yml`): OpenClaw Gateway + channel adapters, Paperclip orchestrator + dashboard, Claude Code & Codex harness containers (mount local creds/subscriptions), memory-MCP gateway.
- **VPS stack** (`docker-compose.vps.yml`): self-hosted Hermes shared-memory backend + its datastore; optionally a mirror of the Paperclip control plane/dashboard for 24/7 reachability when the laptop is closed.

---

## Build phases

1. **Scaffold & secrets** — repo skeleton above, `.env.example`, `docker-compose.yml`, healthchecks. Define `org-chart.yaml` roles (CEO/orchestrator → Claude; Developer/Researcher → Claude; Reviewer/fallback → Codex) with per-role budgets.
2. **Harness layer first (smallest testable unit)** — stand up Claude Code + Codex as Paperclip adapters; verify `testEnvironment` + a trivial `execute` for each. Confirm Claude-primary / Codex-secondary routing.
3. **Memory** — deploy self-hosted Hermes provider to the VPS; build `memory-mcp` server (recall/prefetch/write) backed by it + local built-in tier; register it as an MCP server in both harnesses; verify a fact written by one sub-agent is recalled by another.
4. **Orchestration** — wire Paperclip goals → sub-agent decomposition → results, with budgets/governance/heartbeats. Test a multi-step goal that fans out to ≥2 sub-agents sharing memory.
5. **Communication front door** — build the OpenClaw `paperclip-bridge` plugin: `message_received` → create Paperclip goal; stream status/result back to the same channel session. Disable OpenClaw's own agent loop. Connect one channel first (Telegram).
6. **24/7 + safety hardening** — heartbeat monitoring, budget caps, channel allowlists, tool/permission policy via `before_tool_call`, restart policies, VPS reachability.

---

## Safety & governance (autonomous agent)
- **Channel allowlists** (OpenClaw per-channel sender authorization) so only the user can issue goals.
- **Per-role budgets + spend caps** in Paperclip; hard kill-switch / pause command.
- **Tool/permission gating** via OpenClaw `before_tool_call` hook and Claude Code permission settings; default-deny for destructive actions, human-in-the-loop confirmation for irreversible/outward-facing steps.
- **Secrets** only in `.env` / VPS secret store; never committed. Memory data stays on the user's own VPS.

---

## Verification (end-to-end)
- `docker compose config` validates both compose files; `scripts/up.sh` brings the local stack healthy (all healthchecks green).
- **Harness check:** Paperclip `testEnvironment` passes for Claude + Codex; a one-line `execute` returns output from each.
- **Memory check:** write a fact via sub-agent A's memory tool → confirm sub-agent B prefetches it (and it persists on the VPS across a restart).
- **Orchestration check:** submit a goal that requires 2+ sub-agents; confirm decomposition, shared-memory use, budget accounting, and a consolidated result.
- **End-to-end:** send a message from Telegram → goal runs → result returns in the same thread. Confirm budget cap + allowlist + kill-switch behave.

---

## Open assumptions (non-blocking)
- Exact self-hosted memory provider (Hindsight vs RetainDB) finalized in Phase 3 after a quick self-host smoke test.
- Whether the Paperclip control plane is mirrored to the VPS (true 24/7) or stays local — decided in Phase 6 based on VPS sizing.
