# paperclip-bridge (Phase 5)

OpenClaw plugin that turns the Gateway into a pure front door for Paperclip.

- Registers via the OpenClaw Plugin SDK `register(api)`.
- On `message_received`: authorize sender against `OPENCLAW_ALLOWLIST`, then
  create a Paperclip goal (POST to `PAPERCLIP_PORT`) keyed by the channel session.
- Streams Paperclip status/results back to the originating channel/session.
- Uses the `before_tool_call` hook to enforce tool/permission policy.
- **Disables OpenClaw's own LLM agent loop** — Paperclip is the only brain.

> Built in Phase 5. Entry point `index.ts` + manifest added then.
