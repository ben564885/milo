import { agentClient, loadIdentities } from "@milo/shared";
import { newRequest, run } from "./engine.ts";

const handled = new Set<string>();

function parseAsk(text: string) {
  try {
    const j = JSON.parse(text);
    if (j && typeof j.question === "string") return j;
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
