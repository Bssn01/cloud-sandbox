// ─────────────────────────────────────────────────────────────────────────────
// OpenClaw plugin: paperclip-bridge
//
// Turns the OpenClaw Gateway into a pure FRONT DOOR for Paperclip:
//   - on message_received : authorize sender (allowlist), handle kill-switch,
//                           then create a Paperclip goal keyed by the session.
//   - relays Paperclip results AND escalation questions back to the channel.
//   - on before_tool_call : enforce governance (deny irreversible/outward-facing
//                           or over-budget actions unless confirmed).
//
// OpenClaw's OWN agent loop is not used — Paperclip is the only brain.
// TODO (user's machine): confirm SDK import path + result-callback mechanism
// (webhook vs poll) against the real OpenClaw plugin SDK.
// ─────────────────────────────────────────────────────────────────────────────

import {
  definePlugin,
  type OpenClawPluginApi,
  type InboundMessage,
  type ToolCall,
  type HookDecision,
} from "openclaw/plugin-sdk/plugin-entry";

const KILL_SWITCH_COMMANDS = ["/stop", "/pause", "/kill"];

function isAllowed(senderId: string, allowlistCsv: string | undefined): boolean {
  const allow = (allowlistCsv || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Empty allowlist = deny-all (fail closed) so only configured senders can issue goals.
  return allow.includes(senderId);
}

async function createPaperclipGoal(
  baseUrl: string,
  goal: { text: string; sessionKey: string; mode: string },
): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(goal),
  });
  if (!res.ok) throw new Error(`paperclip /goals failed: ${res.status}`);
  return (await res.json()) as { id: string };
}

export default definePlugin({
  name: "paperclip-bridge",
  register(api: OpenClawPluginApi) {
    const paperclipUrl = api.pluginConfig.PAPERCLIP_URL || "http://paperclip:7000";
    const mode = api.pluginConfig.PAPERCLIP_WORKFLOW_MODE || "council";
    const allowlist = api.pluginConfig.OPENCLAW_ALLOWLIST;

    api.lifecycle.on("gateway_start", () => {
      console.log(`[paperclip-bridge] ready → ${paperclipUrl} (mode=${mode})`);
    });

    api.lifecycle.on("message_received", async (msg: InboundMessage): Promise<HookDecision> => {
      if (!isAllowed(msg.senderId, allowlist)) {
        await api.sendToChannel(msg.sessionKey, "Not authorized to issue goals.");
        return { allow: false, reason: "sender not in allowlist" };
      }

      // Non-text messages (attachments, system events) have no body — ignore safely.
      const text = (msg.text ?? "").trim();
      if (!text) return { allow: false, reason: "empty/non-text message" };

      if (KILL_SWITCH_COMMANDS.includes(text.toLowerCase())) {
        await fetch(`${paperclipUrl}/kill-switch`, { method: "POST" }).catch(() => undefined);
        await api.sendToChannel(msg.sessionKey, "Kill-switch engaged: pausing all agents.");
        return { allow: false, reason: "kill-switch" };
      }

      try {
        const goal = await createPaperclipGoal(paperclipUrl, {
          text,
          sessionKey: msg.sessionKey,
          mode,
        });
        await api.sendToChannel(msg.sessionKey, `Goal accepted (${goal.id}). Working…`);
      } catch (err) {
        await api.sendToChannel(msg.sessionKey, `Could not start goal: ${String(err)}`);
      }
      // Consume the message: OpenClaw's own agent loop must not also handle it.
      return { allow: false, reason: "handled by paperclip-bridge" };
    });

    // Governance gate for tools the harnesses try to run via the Gateway.
    api.lifecycle.on("before_tool_call", (call: ToolCall): HookDecision => {
      const overBudget = (call.estimatedSpendUsd ?? 0) > 5;
      if (call.irreversible || call.outwardFacing || overBudget) {
        return { allow: false, reason: "requires human confirmation (governance)" };
      }
      return { allow: true };
    });

    // Paperclip posts results/escalations here; relay them to the right channel session.
    // TODO: confirm whether OpenClaw exposes registerRoute/HTTP; otherwise poll Paperclip.
    api.registerTool({
      name: "paperclip_callback",
      description: "Receive a Paperclip result or escalation and relay it to the channel",
      async run(args: Record<string, unknown>): Promise<string> {
        const sessionKey = String(args.sessionKey ?? "");
        const kind = String(args.kind ?? "result"); // "result" | "escalation"
        const text = String(args.text ?? "");
        const prefix = kind === "escalation" ? "❓ Needs your decision: " : "✅ ";
        await api.sendToChannel(sessionKey, prefix + text);
        return "relayed";
      },
    });
  },
});
