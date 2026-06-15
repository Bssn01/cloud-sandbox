# RUNBOOK — Build, test & review all phases on your machine

This is the operator guide to take the autonomous-agent stack from a clean
checkout to a **fully working, tested, and reviewed** system. The CI sandbox that
authored this repo **cannot** run the real stack (no Docker daemon, no
Claude/Codex subscriptions, no VPS, no Telegram), so the per-phase **Test** and
**Review** steps below are your completion gate — run them locally.

> **Read this first.** The compose image tags (`paperclip/paperclip`,
> `openclaw/openclaw`, `hindsight/hindsight`) and several SDK details are
> *researched, not verified*. Every place that needs confirming against upstream
> docs is marked **`VERIFY`**. Do the VERIFY steps in each phase before the Test.

---

## Prerequisites (once)

```bash
# Toolchain
docker --version && docker compose version   # Docker daemon must be RUNNING
node --version                                # v22+
git --version

# Repo
git clone <this-repo> && cd cloud-sandbox
git checkout claude/autonomous-agent-plan-s70fxe
cp .env.example .env                          # then fill in every blank
```

Fill `.env`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (both required — peers),
`OPENCLAW_ALLOWLIST` (your channel sender id), `TELEGRAM_BOT_TOKEN`,
`HERMES_REMOTE_*` (after Phase 3 VPS deploy).

**Global completion gate:** the goal is done only when **Phases 1–6 each pass
their Test + Review**. Track them here:

- [ ] Ph1 scaffold · [ ] Ph2 collaboration · [ ] Ph3 memory · [ ] Ph4 orchestration · [ ] Ph5 front door · [ ] Ph6 hardening

---

## Phase 1 — Scaffold & secrets

**Setup**
```bash
cp .env.example .env   # if not already
docker compose config --quiet && echo OK   # validates local compose
docker compose -f docker-compose.vps.yml config --quiet && echo OK
```

**VERIFY**
- Replace the three placeholder image tags in `docker-compose.yml` /
  `docker-compose.vps.yml` with the real published images+tags for OpenClaw,
  Paperclip, and your chosen Hermes provider.

**Test** (acceptance criteria in **bold**)
```bash
python3 -c "import yaml; yaml.safe_load(open('paperclip/config/org-chart.yaml'))" && echo PARSE_OK
scripts/up.sh
docker compose ps
```
- `docker compose config` exits 0 → **compose is valid**.
- `org-chart.yaml` parses → **PARSE_OK**.
- After `up`, every service shows **`healthy`** in `docker compose ps`.

**Review**
- Confirm no secrets are committed: `git status` shows `.env` untracked.
- Skim `org-chart.yaml`: providers `[claude, codex]`, `workflow.default`,
  governance `kill_switch` + `escalate_to_human` present.

**Rollback:** `scripts/down.sh` (add `--volumes` to wipe data).

---

## Phase 2 — Collaboration layer (Claude + Codex as peers)

Build both adapters as **active peers** and wire the **relay** and **council**
workflows with the cross-review invariant. Logic lives in
`paperclip/adapters/peer-config.ts` (`assignProviders`, `assertCrossReview`,
`shouldEscalate`) and `paperclip/config/org-chart.yaml` (`workflow:` block).

**Setup**
```bash
# Register both Paperclip adapters and confirm credentials are reachable.
# VERIFY: real Paperclip adapter-registration command + ServerAdapterModule path.
docker compose exec paperclip paperclip adapters add claude   # VERIFY syntax
docker compose exec paperclip paperclip adapters add codex    # VERIFY syntax
```

**Test**
```bash
# 1) Both harnesses healthy
docker compose exec paperclip paperclip adapters test claude   # VERIFY
docker compose exec paperclip paperclip adapters test codex    # VERIFY

# 2) Relay goal
docker compose exec paperclip paperclip goal create \
  --mode relay --text "Add a /version endpoint and a test for it"   # VERIFY

# 3) Council goal
docker compose exec paperclip paperclip goal create \
  --mode council --text "Propose the directory layout for a CLI tool"  # VERIFY
```
Acceptance criteria:
- `adapters test` → **passes for BOTH claude and codex**.
- Relay run shows the sequence **plan (A) → implement (B) → review (A)** in the
  Paperclip audit log, with **reviewer provider ≠ implementer provider**.
- Council run shows **both providers draft + reconcile**, then implement, then
  joint review.
- **Force a failure:** make the implementer produce a bug; confirm **one** capped
  revision (`PAPERCLIP_MAX_REVIEW_ROUNDS=1`) then an **escalation** event.
- **Force council disagreement:** confirm an escalation event (no auto-decision).

**Review**
- Read the audit log for one relay + one council goal; verify the invariant held
  and budgets were charged to the right roles.
- Code-review `peer-config.ts` against the audit reality (assignment + escalation).

**Rollback:** revert the adapter registration; goals are isolated per run.

---

## Phase 3 — Memory (local hot tier + shared VPS tier)

Deploy the shared provider to the VPS, then run the local `memory-mcp` gateway
and register it as an MCP server in both harnesses.

**Setup**
```bash
# Deploy shared memory to the VPS (Hindsight or RetainDB — pick in this phase).
scripts/deploy-vps.sh user@your-vps
# Point the local stack at it:
#   HERMES_REMOTE_ENDPOINT / HERMES_REMOTE_API_KEY / HERMES_SHARED_NAMESPACE in .env
docker compose up -d --build memory-mcp
```

**VERIFY**
- Confirm the remote provider's `/recall` and `/write` request/response shapes
  match `memory-mcp/src/server.ts` (`HermesRemoteTier`); adjust if different.
- Register `memory-mcp` as an MCP server inside Claude Code and Codex
  (their MCP config), exposing tools `recall` / `prefetch` / `write`.

**Test**
```bash
curl -fsS localhost:9100/healthz                      # {"status":"ok"}
curl -fsS localhost:9100/schemas                       # lists recall/prefetch/write
# Cross-agent recall: write via one sub-agent, recall via another.
curl -fsS -X POST localhost:9100/write   -d '{"content":"project codename is Falcon"}' -H content-type:application/json
curl -fsS -X POST localhost:9100/recall  -d '{"query":"codename"}' -H content-type:application/json
```
Acceptance criteria:
- `/healthz` → **ok**; `/schemas` → **3 tools**.
- Fact written by sub-agent A is **recalled by sub-agent B** in a fresh session.
- Fact **persists on the VPS across a restart** (`docker compose -f
  docker-compose.vps.yml restart`, then recall again).

**Review**
- Confirm writes land in **both** tiers (local fast recall + shared cross-agent).
- Confirm no PII leaves the machine beyond what you intend (data stays on *your* VPS).

**Rollback:** `HERMES_REMOTE_ENDPOINT=` (empty) falls back to local hot tier only.

---

## Phase 4 — Orchestration (goals → sub-agents → result)

**Setup** — Paperclip already running; ensure `org-chart.yaml` is loaded.

**Test**
```bash
docker compose exec paperclip paperclip goal create \
  --mode council \
  --text "Research X, then implement a script for it, then review it"   # VERIFY
docker compose exec paperclip paperclip goal status <id>                # VERIFY
```
Acceptance criteria:
- Goal **decomposes into ≥2 sub-agents** that **share memory** (a fact written by
  the researcher is used by the implementer).
- **Budget accounting** appears per role; the **global cap** is respected.
- A **single consolidated result** is produced.

**Review** — read the full audit trail end-to-end: decomposition → shared-memory
reads/writes → budgets → consolidation. Sanity-check totals vs `PAPERCLIP_GLOBAL_BUDGET_USD`.

---

## Phase 5 — Communication front door (OpenClaw → Paperclip)

Build & load the `paperclip-bridge` plugin
(`openclaw/plugins/paperclip-bridge/`), connect Telegram first.

**Setup**
```bash
( cd openclaw/plugins/paperclip-bridge && npm install && npm run build )
# Set TELEGRAM_BOT_TOKEN + OPENCLAW_ALLOWLIST in .env, then:
docker compose up -d openclaw
```

**VERIFY**
- Confirm the plugin entry/registration + result-callback mechanism (webhook vs
  poll) against the real OpenClaw SDK; adjust `src/index.ts` `paperclip_callback`.
- Confirm OpenClaw's own agent loop is **disabled** so only Paperclip responds.

**Test** (from your Telegram account)
- Send a goal from an **allowlisted** sender → **"Goal accepted… Working…"**, then
  a **result in the same thread**.
- Send from a **non-allowlisted** sender → **"Not authorized"**, no goal created.
- Trigger an escalation (reuse Phase 2's forced failure) → the **question arrives
  in the chat thread** prefixed `❓ Needs your decision:`; your reply unblocks it.
- Send `/stop` → **kill-switch** engages and agents pause.

**Review** — verify allowlist (fail-closed), kill-switch, and that escalations
round-trip through chat. Re-read `before_tool_call` gating in `src/index.ts`.

**Rollback:** `docker compose stop openclaw` (orchestration keeps running headless).

---

## Phase 6 — 24/7 + safety hardening

**Test / checks**
- **Dual-provider spend:** run a multi-step goal; confirm cost ≈ both providers
  active and the **review-round cap** stops runaway loops.
- **Budgets:** lower a role's `budget_usd`; confirm the role **halts at the cap**.
- **Restart policy:** `docker kill` a service; confirm it **comes back** (restart: unless-stopped).
- **VPS reachability:** stop the VPS memory; confirm graceful fallback to local
  hot tier (no crash) and recovery when it returns.
- **Governance:** attempt an irreversible/outward-facing action; confirm it
  **requires confirmation**.

**Review** — final safety pass: allowlist, kill-switch, budgets + caps,
escalation-to-human (no autonomous tiebreak), secrets handling, VPS data locality.

---

## Appendix — what was validated in the authoring sandbox

These ran green where the CI sandbox allowed (no daemon/subscriptions):

```bash
# TypeScript skeletons typecheck (root tsconfig + ambient stubs)
npm install -D typescript@5.6.3 --no-save && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
# org-chart.yaml parses; both compose files validate
python3 -c "import yaml; yaml.safe_load(open('paperclip/config/org-chart.yaml'))"
cp .env.example .env && docker compose config --quiet && docker compose -f docker-compose.vps.yml config --quiet && rm .env
```

Everything else (live relay/council, memory round-trip, Telegram, VPS, budgets)
is **your** machine's Test+Review gate above.
