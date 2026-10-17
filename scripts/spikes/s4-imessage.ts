import { agentClient, loadIdentities } from "../../packages/shared/src/index.ts";
const { milo } = loadIdentities();
const id = await agentClient(milo.handle).getIdentity(milo.handle);
const to = process.argv[2];
for (const text of process.argv.slice(3)) {
  try { const m = await id.sendIMessage({ to, text }); console.log("OK  ", JSON.stringify(text), m.id, m.status); }
  catch (e: any) { console.log("FAIL", JSON.stringify(text), e.detail?.error ?? e.message); }
}
