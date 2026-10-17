/**
 * Personal agents for each human (milo-ben, milo-daniel, ...).
 * They answer A2A questions from recorded decisions. If they don't know,
 * they reply input_required so Milo escalates to the human.
 */
import { agentClient, loadIdentities, loadPeople } from "@milo/shared";
import { findDecision } from "../../milo/src/memory.ts";

const ids = loadIdentities();
const people = loadPeople();
const handled = new Set<string>();
const identities = new Map<string, any>();
const busy = new Set<string>();

async function tick(personHandle: string, agentHandle: string) {
  if (busy.has(agentHandle)) return;
  busy.add(agentHandle);
  try { await answer(personHandle, agentHandle); } finally { busy.delete(agentHandle); }
}

async function answer(personHandle: string, agentHandle: string) {
  let me = identities.get(agentHandle);
  if (!me) { me = await agentClient(agentHandle).getIdentity(agentHandle); identities.set(agentHandle, me); }
  const page = await me.a2aTasks({ state: "submitted", limit: 10 } as any);
  for (const t of page.items as any[]) {
    if (handled.has(t.id)) continue;
    handled.add(t.id);
    const full: any = await me.a2aTask(t.id);
    const text = full.messages?.[0]?.parts?.find((p: any) => p.text)?.text ?? "";
    let ask: { question: string; file?: string } = { question: text };
    try { ask = { ...ask, ...JSON.parse(text) }; } catch {}
    const name = people[personHandle]?.name ?? personHandle;
    const found = await findDecision(ask.question, ask.file);
    if (found) {
      const pick = (k: string) => new RegExp(`${k}: (.+)`).exec(found.body)?.[1];
      const data = { outcome: pick("Outcome"), answer: pick("Answer"), instead: pick("Instead"), decidedBy: pick("Decided by") ?? name, noteId: found.noteId };
      await me.a2aReply(t.id, { intent: "complete", parts: [{ text: `${name} already decided: ${data.answer}` }, { data }] });
      console.log(`[@${agentHandle}] answered ${t.id} from note ${found.noteId}`);
    } else {
      await me.a2aReply(t.id, { intent: "ask_caller", text: `I have no recorded decision from ${name} on this. Please ask ${name} directly.` });
      console.log(`[@${agentHandle}] doesn't know → input_required (${t.id})`);
    }
  }
}

console.log(`🤖 owner agents: ${Object.values(ids.owners).map((o) => "@" + o.handle).join(", ")}`);
setInterval(() => {
  for (const [person, rec] of Object.entries(ids.owners)) tick(person, rec.handle).catch((e) => console.warn(`[@${rec.handle}]`, e.message));
}, 1500);
