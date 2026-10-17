import { recordDecision } from "../../apps/milo/src/memory.ts";
const id = await recordDecision({ question: "Can I change billing.ts so refunds call the legacy v1 endpoint?", file: "src/billing/billing.ts", requester: "Claude Code",
  decision: { outcome: "redirect", answer: "Don't change billing.ts; use the v2 refunds endpoint.", instead: "Use the v2 refunds endpoint", decidedBy: "Daniel", source: { channel: "call", ref: "qa-seed" }, at: new Date().toISOString() } });
console.log("seeded note", id);
