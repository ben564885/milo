import { randomUUID } from "node:crypto";
import { adminClient, loadIdentities } from "../../packages/shared/src/index.ts";
const s = loadIdentities().slack!;
let op: any = await (adminClient() as any).slack.deleteMessage(s.connectionId, s.channelId, process.argv[2], { idempotencyKey: `clear:${randomUUID()}` });
for (let i = 0; i < 10 && op.status === "in_progress"; i++) { await new Promise((r) => setTimeout(r, 500)); op = await (adminClient() as any).slack.getOperation(s.connectionId, op.id); }
console.log(op.status, op.errorCode ?? "");
