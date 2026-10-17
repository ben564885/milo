import { extractDecision, noteAnswers } from "../../packages/shared/src/index.ts";
console.log(await extractDecision("Can I change billing.ts so refunds call the legacy v1 endpoint?",
  "Milo: Hi Ben...\nHuman (Ben): Daniel owns that, get him on.\nHuman (Daniel): No, don't touch it. Use the v2 refunds endpoint instead.", ["Ben", "Daniel", "Philip"]));
console.log(await noteAnswers("Can I edit billing.ts refund logic?", "[milo-decision]\nFile: src/billing/billing.ts\nOutcome: redirect\nAnswer: Don't change it; use v2."));
