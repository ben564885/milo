// Offline checks for x402 payments: helpers, standing approvals, and a real x402 round trip against the demo endpoint.
// No humans are contacted. Run: npx tsx scripts/qa/x402.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.MILO_DB = join(mkdtempSync(join(tmpdir(), "milo-qa-")), "milo.db"); // never touch the real data/milo.db
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { wrapFetchWithPayment, decodePaymentResponseHeader, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { endpointKey, endpointName, formatPrice, heuristicRoleChange, paymentScope, txLink, usdValue } from "../../packages/shared/src/index.ts";
// Imported after MILO_DB is set, so they open the temp database.
const { checkApproval, recordPayment, revokeApproval, saveApproval, spentToday } = await import("../../apps/milo/src/payments.ts");
const { changeRole, getRole } = await import("../../apps/milo/src/roles.ts");
const { mountX402Demo } = await import("../../apps/milo/src/x402-demo.ts");

let pass = 0;
const t = async (name: string, fn: () => unknown) => { try { await fn(); pass++; console.log("✓", name); } catch (e) { console.log("✗", name, (e as Error).message); process.exitCode = 1; } };

await t("endpointKey drops query and trailing slash", () => assert.equal(endpointKey("get", "https://api.example.com/weather/?city=sf"), "GET https://api.example.com/weather"));
await t("endpointKey keeps method apart", () => assert.notEqual(endpointKey("GET", "https://a.com/x"), endpointKey("POST", "https://a.com/x")));
await t("endpointName has no dots", () => assert.equal(endpointName("https://api.example.com/v1/weather?x=1"), "the weather api on example"));
await t("formatPrice USDC testnet", () => assert.equal(formatPrice("10000", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "eip155:84532"), "$0.01 USDC (testnet)"));
await t("formatPrice USDC mainnet", () => assert.equal(formatPrice("1500000", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "eip155:8453"), "$1.50 USDC"));
await t("usdValue: unknown token is undefined", () => assert.equal(usdValue("10000", "0xabc", "eip155:84532"), undefined));
await t("usdValue: 1.5 USDC", () => assert.equal(usdValue("1500000", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "eip155:8453"), 1.5));
await t("scope: always approve", () => assert.equal(paymentScope({ outcome: "approved", choice: "always approve", answer: "" }), "always"));
await t("scope: approve once", () => assert.equal(paymentScope({ outcome: "approved", choice: "approve once", answer: "" }), "once"));
await t("scope: plain yes is once", () => assert.equal(paymentScope({ outcome: "approved", answer: "yes go ahead" }), "once"));
await t("scope: deny choice", () => assert.equal(paymentScope({ outcome: "approved", choice: "deny", answer: "" }), "deny"));
await t("scope: blocked", () => assert.equal(paymentScope({ outcome: "blocked", answer: "no" }), "deny"));

const base = { endpoint: "GET https://qa.invalid/weather", url: "https://qa.invalid/weather", amount: "10000", price: "$0.01 USDC", asset: "0xA", network: "eip155:84532", payTo: "0xB" };
saveApproval({ ...base, approvedBy: "QA", at: new Date().toISOString(), requestId: "qa" });
await t("approval covers same terms", () => assert.equal(checkApproval(base)?.covered, true));
await t("approval covers a lower price", () => assert.equal(checkApproval({ ...base, amount: "5000" })?.covered, true));
await t("approval does not cover a higher price", () => assert.equal(checkApproval({ ...base, amount: "20000" })?.covered, false));
await t("approval does not cover a new recipient", () => assert.equal(checkApproval({ ...base, payTo: "0xC" })?.covered, false));
await t("approval does not cover another network", () => assert.equal(checkApproval({ ...base, network: "eip155:8453" })?.covered, false));
await t("no approval for another endpoint", () => assert.equal(checkApproval({ ...base, endpoint: "POST https://qa.invalid/weather" }), undefined));
await t("txLink: sepolia explorer", () => assert.equal(txLink("eip155:84532", "0x" + "a".repeat(64)), `https://sepolia.basescan.org/tx/0x${"a".repeat(64)}`));
await t("txLink: demo tx has no link", () => assert.equal(txLink("eip155:84532", "0xdemo"), undefined));

// Daily budget ($5 by default) on standing approvals.
const usdc = { ...base, endpoint: "GET https://qa.invalid/budget", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "1000000", price: "$1.00 USDC" };
const approvedAt = new Date(Date.now() - 1000).toISOString();
saveApproval({ ...usdc, approvedBy: "QA", at: approvedAt, requestId: "qa" });
for (let i = 0; i < 4; i++) recordPayment({ ...usdc, status: "paid", auto: true, at: new Date().toISOString() });
recordPayment({ ...usdc, status: "failed", auto: true, at: new Date().toISOString() });
recordPayment({ ...usdc, status: "paid", auto: false, at: new Date().toISOString() });
await t("budget: counts only paid auto payments", () => assert.equal(spentToday({ ...usdc, at: approvedAt, requestId: "qa" }), 4_000_000n));
await t("budget: $4 spent + $1 fits in $5", () => assert.equal(checkApproval(usdc)?.covered, true));
recordPayment({ ...usdc, status: "paid", auto: true, at: new Date().toISOString() });
await t("budget: $5 spent + $1 asks again", () => { const c = checkApproval(usdc); assert.equal(c?.covered, false); assert.match((c as any).changed, /budget/); });
saveApproval({ ...usdc, approvedBy: "QA", at: new Date(Date.now() + 1000).toISOString(), requestId: "qa2" });
await t("budget: a fresh always-approve starts a fresh budget", () => assert.equal(checkApproval(usdc)?.covered, true));

// Who Milo asks.
await t("roles: both default to ben", () => { assert.equal(getRole("first_contact").handle, "ben"); assert.equal(getRole("payment_approver").handle, "ben"); });
await t("roles: anyone can change the payment approver", async () => { const r = await changeRole("payment_approver", "Philip", "Ben", "the phone"); assert.equal(r.ok, true); assert.equal(getRole("payment_approver").handle, "philip"); assert.equal(getRole("first_contact").handle, "ben"); });
await t("roles: change first contact", async () => { await changeRole("first_contact", "daniel", "Philip", "slack"); assert.equal(getRole("first_contact").handle, "daniel"); assert.equal(getRole("first_contact").changedBy, "Philip"); });
await t("roles: unknown person is refused", async () => { const r = await changeRole("first_contact", "Zed", "Ben", "slack"); assert.equal(r.ok, false); assert.equal(getRole("first_contact").handle, "daniel"); });
const team = ["Ben", "Daniel", "Philip"];
await t("role text: payments from now on", () => assert.deepEqual(heuristicRoleChange("from now on philip approves payments", team), { role: "payment_approver", person: "Philip" }));
await t("role text: make X the first contact", () => assert.deepEqual(heuristicRoleChange("milo, make daniel the first contact", team), { role: "first_contact", person: "Daniel" }));
await t("role text: 'ask philip' is not a change", () => assert.equal(heuristicRoleChange("not sure, ask philip", team), undefined));
await t("role text: a payment answer is not a change", () => assert.equal(heuristicRoleChange("always approve", team), undefined));

await t("revoke removes it", () => { assert.equal(revokeApproval(base.endpoint), true); assert.equal(checkApproval(base), undefined); });

// Real x402 v2 round trip: 402 → hook → signed payment header → 200 with receipt.
const app = new Hono();
mountX402Demo(app);
const server = serve({ fetch: app.fetch, port: 0 });
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${(server.address() as any).port}/x402/demo/weather?city=sf`;
const wallet = privateKeyToAccount(generatePrivateKey());
const payWith = (approve: boolean, seen: any[]) => wrapFetchWithPayment(fetch, new x402Client()
  .register("eip155:*", new ExactEvmScheme(wallet))
  .onBeforePaymentCreation(async (ctx) => { seen.push(ctx); return approve ? undefined : { abort: true, reason: "denied" }; }));

await t("approved: pays and gets data", async () => {
  const seen: any[] = [];
  const res = await payWith(true, seen)(url);
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].selectedRequirements.amount, "10000");
  const receipt: any = decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!);
  assert.equal(receipt.success, true);
  assert.equal((await res.json()).paidBy?.toLowerCase(), wallet.address.toLowerCase());
});
await t("denied: never sends a payment", async () => {
  const seen: any[] = [];
  await assert.rejects(payWith(false, seen)(url), /aborted: denied/);
  assert.equal(seen.length, 1);
});
await t("over the spend cap: refused even if approved", async () => {
  const pay = wrapFetchWithPayment(fetch, new x402Client().register("eip155:*", new ExactEvmScheme(wallet)).setSpendControls({ maxAmountPerPayment: "$1" }).onBeforePaymentCreation(async () => undefined));
  await assert.rejects(pay(url.replace("city=sf", "price=5000000")));
});
server.close();
console.log(`\n${pass} passed`);
