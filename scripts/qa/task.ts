import { agentClient, loadIdentities } from "../../packages/shared/src/index.ts";
const ids = loadIdentities();
const me = await agentClient(ids.coder.handle).getIdentity(ids.coder.handle);
const t: any = await me.a2aSentTask(process.argv[2]);
console.log(t.state, t.createdAt, t.completedAt);
