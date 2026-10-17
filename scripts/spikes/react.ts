import { agentClient, loadIdentities } from "../../packages/shared/src/index.ts";
const { milo } = loadIdentities();
const id: any = await agentClient(milo.handle).getIdentity(milo.handle);
const msgs: any[] = await id.listIMessages({ limit: 10 });
const out = msgs.find((m) => m.direction === "outbound" && m.content && m.content !== "yo" && m.remoteNumber === "+15555550101");
const inb = msgs.find((m) => m.direction === "inbound");
console.log("outbound:", out?.id, out?.content?.slice(0, 50));
try { const r = await id.sendIMessageReaction({ messageId: out.id, reaction: "like" }); console.log("react outbound OK", r.id); }
catch (e: any) { console.log("react outbound FAIL", e.statusCode, JSON.stringify(e.detail)); }
console.log("inbound:", inb?.id, inb?.content?.slice(0, 40));
