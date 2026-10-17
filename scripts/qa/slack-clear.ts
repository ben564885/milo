import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { adminClient, loadIdentities } from "../../packages/shared/src/index.ts";
const s = loadIdentities().slack!;
const inkbox: any = adminClient();
const msgs = JSON.parse(readFileSync("data/slack-msgs.json", "utf8")).filter((m: any) => m.user === (process.argv[2] ?? process.env.MILO_SLACK_BOT_USER));
let ok = 0, fail = 0;
for (const m of msgs) {
  try {
    let op = await inkbox.slack.deleteMessage(s.connectionId, s.channelId, m.ts, { idempotencyKey: `clear:${m.ts}:${randomUUID().slice(0, 8)}` });
    for (let i = 0; i < 10 && op.status === "in_progress"; i++) { await new Promise((r) => setTimeout(r, 400)); op = await inkbox.slack.getOperation(s.connectionId, op.id); }
    if (op.status === "succeeded" || op.status === "completed" || op.status === "done") ok++; else { fail++; console.log("status", op.status, m.ts, JSON.stringify(op.error ?? op.errorCode ?? "")); }
  } catch (e: any) { fail++; console.log("fail", m.ts, e.statusCode, JSON.stringify(e.detail ?? e.message).slice(0, 160)); }
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`deleted ${ok}, failed ${fail}`);
