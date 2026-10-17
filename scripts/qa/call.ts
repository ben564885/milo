import { agentClient, loadIdentities } from "../../packages/shared/src/index.ts";
const { milo } = loadIdentities();
const id = await agentClient(milo.handle).getIdentity(milo.handle);
const cid = process.argv[2];
for (const t of await id.listTranscripts(cid) as any[]) console.log(`[${t.party}] ${t.text}`, t.speaker ?? t.participant ?? "");
const r: any = await id.listToolInvocations(cid, { limit: 50, offset: 0 } as any);
for (const i of r.items) console.log("TOOL", i.toolName, i.status, JSON.stringify(i.resultSummary ?? i.summary ?? i).slice(0, 300));
