// Offline checks: owners, budget, heuristics, text cleanup.
import assert from "node:assert/strict";
import { heuristicDecision, ownerOf, loadPeople } from "../../packages/shared/src/index.ts";
import { allowed } from "../../apps/milo/src/people.ts";

let pass = 0; const t = (name: string, fn: () => void) => { try { fn(); pass++; console.log("✓", name); } catch (e) { console.log("✗", name, (e as Error).message); process.exitCode = 1; } };

t("CODEOWNERS: billing → philip", () => assert.equal(ownerOf("src/billing/billing.ts"), "philip"));
t("CODEOWNERS: bare billing.ts → philip", () => assert.equal(ownerOf("billing.ts"), "philip"));
t("CODEOWNERS: auth → ben", () => assert.equal(ownerOf("src/auth/login.ts"), "ben"));
t("CODEOWNERS: other → ben (*)", () => assert.equal(ownerOf("README.md"), "ben"));
t("CODEOWNERS: none → undefined", () => assert.equal(ownerOf(undefined), undefined));

const people = loadPeople();
t("budget: ben call ok at normal", () => assert.equal(allowed("call", people.ben, "normal").ok, true));
t("budget: ben call ok at low (full flow)", () => assert.equal(allowed("call", people.ben, "low").ok, true));
t("budget: philip call ok at normal", () => assert.equal(allowed("call", people.philip, "normal").ok, true));
t("budget: philip call ok at low (full flow)", () => assert.equal(allowed("call", people.philip, "low").ok, true));
t("budget: no person → not ok", () => assert.equal(allowed("slack", undefined, "high").ok, false));

const names = ["Ben", "Daniel", "Philip"];
t("heuristic: don't + use → redirect", () => assert.equal(heuristicDecision("Don't change it. Use the v2 endpoint.", names).outcome, "redirect"));
t("heuristic: yes → approved", () => assert.equal(heuristicDecision("yes go ahead", names).outcome, "approved"));
t("heuristic: no → blocked", () => assert.equal(heuristicDecision("no", names).outcome, "blocked"));
t("heuristic: unclear → no_answer", () => assert.equal(heuristicDecision("let me think", names).outcome, "no_answer"));
t("heuristic: names decider", () => assert.equal(heuristicDecision("Daniel says no", names).decidedBy, "Daniel"));

const noLinks = (s: string) => s.replace(/`/g, "").replace(/\(?[\w./-]*?([\w-]+)\.[a-z]{1,5}\b\)?/gi, "the $1 file").replace(/https?:\S+/g, "");
t("noLinks: strips file", () => assert.ok(!/\.ts/.test(noLinks("change billing.ts now"))));
t("noLinks: strips path", () => assert.ok(!/src\//.test(noLinks("see src/billing/billing.ts"))));
t("noLinks: keeps plain text", () => assert.equal(noLinks("Can I ship it?"), "Can I ship it?"));
console.log(`\n${pass} passed`);
