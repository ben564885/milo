// Spike S5: coder -> hey-milo A2A task, milo replies progress then complete.
import { agentClient, loadIdentities } from "../../packages/shared/src/index.ts";
const ids = loadIdentities();
const coder = await agentClient(ids.coder.handle).getIdentity(ids.coder.handle);
const client = await coder.a2aClient();
const card = await agentClient(ids.coder.handle).a2a.organizationDirectory({ q: ids.milo.handle });
console.log("directory:", card.items.map((i: any) => [i.card?.name, i.cardUrl]));
const target = await client.fetchCard(card.items[0].cardUrl);
const sent = await client.send(target, { text: "spike: can I change billing.ts?" });
console.log("sent:", JSON.stringify(sent).slice(0, 300));
const taskId = (sent as any).task?.id ?? (sent as any).id;

const milo = await agentClient(ids.milo.handle).getIdentity(ids.milo.handle);
await new Promise((r) => setTimeout(r, 1500));
const inbox = await milo.a2aTasks({ limit: 5 });
console.log("milo inbox:", inbox.items.map((t: any) => [t.id, t.state, t.requesterHandle ?? t.caller?.handle]));
const mine = inbox.items.find((t: any) => t.id === taskId) ?? inbox.items[0];
await milo.a2aReply(mine.id, { intent: "progress", text: "Asking Daniel's agent..." });
await milo.a2aReply(mine.id, { intent: "complete", parts: [{ text: "Decision: blocked. Use v2." }, { data: { outcome: "blocked", instead: "use v2" } }] });
const final = await client.getTask(target, taskId);
console.log("final state:", final.status.state);
console.log("history:", JSON.stringify(final.history?.slice(-2)).slice(0, 600));
