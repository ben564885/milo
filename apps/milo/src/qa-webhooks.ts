// QA: simulated webhook payloads must reach the right request as signals.
import assert from "node:assert/strict";
process.env.INKBOX_WEBHOOK_SECRET = ""; // empty = skip signature check in this test
const { handleWebhook } = await import("./webhooks.ts");
const { waitFor } = await import("./signals.ts");
const { save } = await import("./store.ts");
let pass = 0; const ok = (n: string) => { pass++; console.log("✓", n); };
const base = { question: "q", context: "", urgency: "normal", requester: "qa", step: "imessage", status: "running", log: [], createdAt: new Date().toISOString() } as any;
const r = { ...base, id: "qa-1", imessageId: "im-1", imessageConversationId: "conv-1", slack: { connectionId: "c", channel: "C1", threadTs: "111.222" }, callId: "call-1", target: "ben" };
save(r);
const post = (o: any) => handleWebhook(JSON.stringify({ id: "evt_" + Math.random(), ...o }), {});

await post({ event_type: "imessage.reaction_received", data: { reaction: { target_message_id: "im-1", conversation_id: "conv-1", reaction: "like", custom_emoji: null, remote_number: "+15555550101" } } });
let s: any = await waitFor("qa-1", 100); assert.equal(s?.kind, "imessage_tapback"); assert.equal(s.reaction, "like"); ok("tapback → signal");

await post({ event_type: "imessage.received", data: { message: { conversation_id: "conv-1", content: "no, ask Philip", remote_number: "+15555550101" } } });
s = await waitFor("qa-1", 100); assert.equal(s?.kind, "imessage_reply"); assert.equal(s.text, "no, ask Philip"); ok("imessage reply → signal");

await post({ event_type: "slack.thread_reply_received", data: { thread_ts: "111.222", actor_id: "U1", actor_profile: { is_bot: false }, event: { text: "<@UBOT> yes go ahead" } } });
s = await waitFor("qa-1", 100); assert.equal(s?.kind, "slack_reply"); assert.equal(s.text, "yes go ahead"); ok("slack thread reply → signal (mention stripped)");

await post({ event_type: "slack.thread_reply_received", data: { thread_ts: "111.222", actor_profile: { is_bot: true }, event: { text: "bot echo" } } });
s = await waitFor("qa-1", 100); assert.equal(s, undefined); ok("bot slack message ignored");

await post({ event_type: "slack.thread_reply_received", data: { thread_ts: "999.000", event: { text: "other thread" } } });
s = await waitFor("qa-1", 100); assert.equal(s, undefined); ok("other thread ignored");

await post({ event_type: "call.ended", data: { call: { id: "call-1", hangup_reason: "completed" }, outcome: "completed", transcript: { entries: [{ party: "remote", text: "Don't change it, use v2." }] }, post_call_action_items: [{ action: "DECISION: blocked", details: "Daniel" }] } });
s = await waitFor("qa-1", 100); assert.equal(s?.kind, "call_ended"); assert.match(s.transcript, /use v2/); assert.equal(s.actionItems.length, 1); ok("call.ended → transcript + action items");

const dup = { id: "evt_dup", event_type: "imessage.reaction_received", data: { reaction: { target_message_id: "im-1", reaction: "dislike" } } };
await handleWebhook(JSON.stringify(dup), {}); await handleWebhook(JSON.stringify(dup), {});
await waitFor("qa-1", 100); s = await waitFor("qa-1", 100); assert.equal(s, undefined); ok("duplicate event id delivered once");

save({ ...r, status: "done" });
console.log(`\n${pass} passed`);
