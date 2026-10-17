import { extractDecision } from "../../packages/shared/src/index.ts";
const q = "Can I change the refund logic in billing.ts to call the legacy v1 charge endpoint?";
const cases: [string, string][] = [["yeah thats fine","approved"],["sure go for it","approved"],["ok","approved"],["nah","blocked"],["no don't touch it","blocked"],["no, use the v2 endpoint","redirect"],["ask philip","no_answer"],["not sure, philip owns that","no_answer"],["lol what","no_answer"]];
let bad = 0;
for (const [t, want] of cases) { const got = (await extractDecision(q, t, ["Ben", "Philip", "Daniel"])).outcome; if (got !== want) bad++; console.log(got === want ? "✓" : "✗", t, "→", got); }
console.log(bad ? `${bad} wrong` : "all correct");
