import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { verifyWebhook } from "@inkbox/sdk";
import { ROOT } from "@milo/shared";
import { personByPhone, personBySlack, resolvePeople } from "./people.ts";
import * as ch from "./channels.ts";
import { roleChangeFrom } from "./roles.ts";
import { emit } from "./signals.ts";
import { find } from "./store.ts";

const seen = new Set<string>();

/** Handle one Inkbox webhook delivery. Returns an HTTP status. */
export async function handleWebhook(raw: string, headers: Record<string, string>): Promise<number> {
  const secret = process.env.INKBOX_WEBHOOK_SECRET;
  if (secret && !verifyWebhook({ payload: Buffer.from(raw), headers, secret } as any)) return 403;
  const p = JSON.parse(raw);
  appendFileSync(join(ROOT, "data/webhooks.log"), raw + "\n");
  if (p.id && seen.has(p.id)) return 204;
  if (p.id) seen.add(p.id);
  const type: string = p.event_type ?? "";
  const data = p.data ?? {};
  const people = await resolvePeople();

  if (type.startsWith("slack.") && /received$/.test(type)) {
    if (data.actor_profile?.is_bot || data.actor_profile?.is_app_user) return 204;
    const thread = data.thread_ts;
    const r = find((r) => r.status === "running" && !!r.slack?.threadTs && r.slack.threadTs === thread);
    const raw = String((data.event as any)?.text ?? "");
    const text = raw.replace(/<@[A-Z0-9]+>/g, "").trim();
    const person = personBySlack(people, data.actor_id);
    const userName = person?.name ?? data.actor_profile?.profile?.display_name ?? data.actor_profile?.real_name ?? undefined;
    // Outside a question, a message to Milo can change who it asks ("milo, make philip the first contact").
    if (!r) {
      const toMilo = /\bmilo\b/i.test(raw) || [...raw.matchAll(/<@([A-Z0-9]+)>/g)].some((m) => !personBySlack(people, m[1]));
      if (toMilo) void roleChangeFrom(text, userName ?? "someone", "slack").catch((e) => console.warn("[roles]", e.message));
      return 204;
    }
    emit(r.id, { kind: "slack_reply", text, user: data.actor_id, userName });
    return 204;
  }

  if (type === "imessage.reaction_received" && data.reaction) {
    const x = data.reaction;
    const r = find((r) => r.status === "running" && r.imessageId === x.target_message_id)
      ?? find((r) => r.status === "running" && r.imessageConversationId === x.conversation_id);
    if (r) emit(r.id, { kind: "imessage_tapback", reaction: x.reaction, emoji: x.custom_emoji, from: x.remote_number });
    return 204;
  }

  if (type === "imessage.received" && data.message) {
    const m = data.message;
    const from = m.sender_number ?? m.remote_number;
    const person = personByPhone(people, from);
    const r = find((r) => r.status === "running" && r.imessageConversationId === m.conversation_id)
      ?? find((r) => r.status === "running" && !!person && r.target === person.handle && r.step === "imessage");
    if (r && m.content) emit(r.id, { kind: "imessage_reply", text: m.content, from });
    // A text to Milo outside a question can change who it asks.
    if (!r && m.content) {
      void roleChangeFrom(m.content, person?.name ?? "someone", "text")
        .then((res) => res && ch.imessageInConversation(m.conversation_id, res.text))
        .catch((e) => console.warn("[roles]", e.message));
    }
    return 204;
  }

  if (type === "call.ended") {
    const call = data.call ?? {};
    const r = find((r) => r.callId === call.id);
    if (!r) return 204;
    const entries = data.transcript?.entries ?? [];
    const transcript = entries.map((e: any) => ("marker" in e ? `[… ${e.omitted_turns} turns]` : `${e.party === "local" ? "Milo" : "Human"}: ${e.text}`)).join("\n");
    const actionItems = (data.post_call_action_items ?? []).map((a: any) => `${a.action}${a.details ? ` — ${a.details}` : ""}`);
    emit(r.id, { kind: "call_ended", callId: call.id, outcome: data.outcome, hangup: call.hangup_reason, transcript, actionItems });
    return 204;
  }
  return 204;
}
