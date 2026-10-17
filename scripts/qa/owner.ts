// QA: ask Daniel's agent directly over A2A (it should answer from the seeded note).
import { agentClient, loadIdentities } from "../../packages/shared/src/index.ts";
const ids = loadIdentities();
const me = await agentClient(ids.coder.handle).getIdentity(ids.coder.handle);
const c = await me.a2aClient();
const t = await c.fetchCard(`https://inkbox.ai/a2a/${ids.owners.daniel.handle}/card`);
for (const q of [{ question: "Can I touch refunds in billing.ts?", file: "src/billing/billing.ts" }, { question: "Can I rename the login page title?", file: "src/auth/login.tsx" }]) {
  const s: any = await c.send(t, { text: JSON.stringify(q) });
  const done: any = await c.wait(t, s.task.id, { timeoutMs: 20000, intervalMs: 700 }).catch(async () => c.getTask(t, s.task.id));
  const last = [...(done.history ?? [])].reverse().find((h: any) => /AGENT/.test(h.role));
  console.log(q.file, "→", done.status.state, "|", last?.parts?.map((p: any) => p.text ?? JSON.stringify(p.data)).join(" | "));
}
