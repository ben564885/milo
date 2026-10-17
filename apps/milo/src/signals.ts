// In-process wake-ups: webhook handlers push signals; the engine waits on them.
// Signals that arrive while nothing waits are queued, so a late answer is never lost.
export type Signal =
  | { kind: "slack_reply"; text: string; user?: string; userName?: string }
  | { kind: "imessage_reply"; text: string; from?: string }
  | { kind: "imessage_tapback"; reaction: string; emoji?: string | null; from?: string }
  | { kind: "cancel" }
  | { kind: "call_ended"; callId: string; outcome?: string | null; hangup?: string | null; transcript: string; actionItems: string[] };

const waiters = new Map<string, (s: Signal) => void>();
const pending = new Map<string, Signal[]>();

export function emit(requestId: string, s: Signal) {
  const w = waiters.get(requestId);
  if (w) { waiters.delete(requestId); w(s); return; }
  pending.set(requestId, [...(pending.get(requestId) ?? []), s]);
}

export function waitFor(requestId: string, ms: number): Promise<Signal | undefined> {
  const queued = pending.get(requestId);
  if (queued?.length) {
    const s = queued.shift()!;
    if (!queued.length) pending.delete(requestId);
    return Promise.resolve(s);
  }
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiters.delete(requestId); resolve(undefined); }, Math.max(0, ms));
    waiters.set(requestId, (s) => { clearTimeout(t); resolve(s); });
  });
}

export function clear(requestId: string) { pending.delete(requestId); waiters.delete(requestId); }
