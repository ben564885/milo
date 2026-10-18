import { agentClient, loadIdentities } from "@milo/shared";
import * as ch from "./channels.ts";
import { newRequest, reportPayment, run } from "./engine.ts";
import { changeRole, listRoles } from "./roles.ts";

const handled = new Set<string>();

export function parseAsk(text: string) {
  try {
    const j = JSON.parse(text);
    // A question, or a non-question message (payment receipt, role change) that must not become one.
    if (j && (typeof j.question === "string" || typeof j.kind === "string")) return j;
  } catch {}
  return { question: text };
}

/** Poll Milo's A2A inbox and start a request for each new task. */
export function startInbox() {
  const ids = loadIdentities();
  const inkbox = agentClient(ids.milo.handle);
  let busy = false;
  let milo: any;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      milo ??= await inkbox.getIdentity(ids.milo.handle);
      const page = await milo.a2aTasks({ state: "submitted", limit: 10 } as any);
      for (const t of page.items as any[]) {
        if (handled.has(t.id)) continue;
        handled.add(t.id);
        const full: any = await milo.a2aTask(t.id);
        const first = full.messages?.[0] ?? full.history?.[0];
        const textPart = first?.parts?.find((p: any) => p.text)?.text ?? "";
        const dataPart = first?.parts?.find((p: any) => p.data)?.data;
        const ask = { ...parseAsk(textPart), ...(dataPart ?? {}) };
        const requester = t.requesterHandle ?? t.caller?.handle ?? "an agent";
        // Not questions: a payment receipt, or a change to who Milo asks. Answer right away.
        if (ask.kind === "payment_receipt") {
          const text = await reportPayment(ask);
          await ch.a2aComplete(t.id, text, { ok: true });
          continue;
        }
        if (ask.kind === "set_role") {
          const res = ask.person ? await changeRole(ask.role, ask.person, ask.requester ?? `@${requester}`, ask.via ?? "a2a") : { ok: true, text: "No change." };
          await ch.a2aComplete(t.id, res.text, { ok: res.ok, roles: listRoles() });
          continue;
        }
        const req = newRequest({ ...ask, requester: ask.requester ?? `@${requester}`, a2aTaskId: t.id });
        console.log(`[inbox] task ${t.id} from @${requester} → request ${req.id}`);
        run(req).catch((e) => console.error("[inbox] run failed", e));
      }
    } catch (err) {
      console.warn("[inbox]", (err as Error).message);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 1500);
  void tick();
}
