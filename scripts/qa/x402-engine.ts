// The payment ladder in-process, with every channel offline: nobody is contacted.
// Inkbox keys are replaced with fake ones before anything loads, so any send would fail auth even on a configured laptop.
// Run: npx tsx scripts/qa/x402-engine.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
process.env.MILO_DB = join(mkdtempSync(join(tmpdir(), "milo-qa-")), "milo.db");
process.env.INKBOX_API_KEY = "qa-offline";
process.env.OPENAI_API_KEY = "";
process.env.MILO_FIRST_CONTACT = "ben"; // pin defaults so local .env choices don't change the test
process.env.MILO_PAYMENT_APPROVER = "ben";
const idsPath = join(ROOT, "config/identities.local.json");
if (existsSync(idsPath)) {
  const ids = JSON.parse(readFileSync(idsPath, "utf8"));
  for (const h of [ids.milo?.handle, ids.coder?.handle, ...Object.values(ids.owners ?? {}).map((o: any) => o.handle)].filter(Boolean)) {
    process.env["INKBOX_KEY_" + h.toUpperCase().replace(/-/g, "_")] = "qa-offline";
  }
}

const { endpointKey, formatPrice } = await import("../../packages/shared/src/index.ts");
const { newRequest, run, reportPayment } = await import("../../apps/milo/src/engine.ts");
const { saveApproval, listPayments } = await import("../../apps/milo/src/payments.ts");
const { changeRole } = await import("../../apps/milo/src/roles.ts");
const { get } = await import("../../apps/milo/src/store.ts");
console.log = () => {}; // quiet the engine's log lines
console.warn = () => {};

let pass = 0;
const t = async (name: string, fn: () => unknown) => { try { await fn(); pass++; process.stdout.write(`✓ ${name}\n`); } catch (e) { process.stdout.write(`✗ ${name} ${(e as Error).message}\n`); process.exitCode = 1; } };

const url = "http://localhost:8787/x402/demo/weather?city=sf";
const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ask = (amount = "10000") => ({ endpoint: endpointKey("GET", url), url, amount, asset, network: "eip155:84532", payTo: "0x000000000000000000000000000000000000dEaD", price: formatPrice(amount, asset, "eip155:84532") });
const pay = (amount?: string) => newRequest({ question: "Can Claude Code pay?", requester: "QA", payment: ask(amount) });

await t("new endpoint: goes to the payment approver (ben), no standing approval", async () => {
  const r = pay();
  const d = await run(r);
  assert.equal(d.outcome, "no_answer");
  const saved = get(r.id)!;
  assert.equal(saved.target, "ben");
  assert.deepEqual(saved.options, ["approve once", "always approve", "deny"]);
  assert.ok(saved.log.some((l) => /no approval on file/.test(l.text)));
});

saveApproval({ ...ask(), approvedBy: "Ben", at: new Date().toISOString(), requestId: "earlier" });
let paidId = "";
await t("always-approved endpoint: approved without asking", async () => {
  const r = pay();
  paidId = r.id;
  const d = await run(r);
  assert.equal(d.outcome, "approved");
  assert.equal(d.scope, "always");
  assert.equal(d.source.channel, "memory");
  assert.equal(d.decidedBy, "Ben");
});
await t("receipt: logged and worded for Slack", async () => {
  const text = await reportPayment({ requestId: paidId, endpoint: ask().endpoint, status: "paid", transaction: "0x" + "b".repeat(64) });
  assert.match(text, /paid \$0\.01 USDC \(testnet\).*ben's standing approval.*\$0\.01 of \$5\.00 today.*sepolia\.basescan\.org/);
  assert.equal(listPayments()[0].auto, true);
});
await t("receipt for an unknown request is ignored", async () => {
  assert.match(await reportPayment({ requestId: "nope", endpoint: "x", status: "paid" }), /No approved payment/);
});
await t("higher price: asks again and says why", async () => {
  const r = pay("20000");
  const d = await run(r);
  assert.equal(d.outcome, "no_answer");
  assert.match(get(r.id)!.payNote ?? "", /price went up/);
});

await changeRole("payment_approver", "Philip", "Ben", "the phone");
await t("after a change, payments go to the new approver", async () => {
  const r = pay("20000");
  await run(r);
  assert.equal(get(r.id)!.target, "philip");
});
await t("other questions still go to the first contact", async () => {
  const r = newRequest({ question: "Can I rename the readme?", requester: "QA" });
  await run(r);
  assert.equal(get(r.id)!.target, "ben");
});
process.stdout.write(`\n${pass} passed\n`);
process.exit();
