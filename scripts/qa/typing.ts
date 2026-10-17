import { randomUUID } from "node:crypto";
import { adminClient, loadIdentities } from "../../packages/shared/src/index.ts";
const s = loadIdentities().slack!;
const k: any = adminClient().slack;
const caps: any = await k.capabilities(s.connectionId);
console.log("native_processing:", caps.nativeProcessingStatus ?? caps.native_processing_status, "task streaming:", caps.nativeTaskStreaming);
let op: any = await k.setProcessingStatus(s.connectionId, s.channelId, process.argv[2], process.argv[3] ?? "processing", { idempotencyKey: `typing:${randomUUID()}` });
for (let i = 0; i < 10 && op.status === "in_progress"; i++) { await new Promise((r) => setTimeout(r, 400)); op = await k.getOperation(s.connectionId, op.id); }
console.log("op:", op.status, op.errorCode ?? op.error ?? "");
