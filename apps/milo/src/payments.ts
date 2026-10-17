import type { PaymentAsk } from "@milo/shared";
import { db } from "./store.ts";

/** A standing "always approve" for one x402 endpoint, on the exact terms the person saw. */
export type Approval = PaymentAsk & { approvedBy?: string; at: string; requestId: string };

db.exec("CREATE TABLE IF NOT EXISTS payment_approvals (endpoint TEXT PRIMARY KEY, json TEXT)");

export function listApprovals(): Approval[] {
  return (db.prepare("SELECT json FROM payment_approvals ORDER BY endpoint").all() as { json: string }[]).map((r) => JSON.parse(r.json));
}

export function saveApproval(a: Approval) {
  db.prepare("INSERT INTO payment_approvals (endpoint, json) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json").run(a.endpoint, JSON.stringify(a));
}

export function revokeApproval(endpoint: string): boolean {
  return Number(db.prepare("DELETE FROM payment_approvals WHERE endpoint = ?").run(endpoint).changes) > 0;
}

export function resetApprovals() { db.exec("DELETE FROM payment_approvals"); }

/**
 * Does a standing approval cover this payment? It must be the same endpoint, network, token and recipient,
 * at no more than the approved price. If the endpoint was approved on other terms, `changed` says what moved,
 * so the person is asked again.
 */
export function checkApproval(p: PaymentAsk): { approval: Approval; covered: true } | { approval: Approval; covered: false; changed: string } | undefined {
  const row = db.prepare("SELECT json FROM payment_approvals WHERE endpoint = ?").get(p.endpoint) as { json: string } | undefined;
  if (!row) return undefined;
  const a: Approval = JSON.parse(row.json);
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  if (!same(a.network, p.network)) return { approval: a, covered: false, changed: `network changed from ${a.network} to ${p.network}` };
  if (!same(a.asset, p.asset)) return { approval: a, covered: false, changed: "it wants a different token" };
  if (!same(a.payTo, p.payTo)) return { approval: a, covered: false, changed: `the money now goes to ${p.payTo} instead of ${a.payTo}` };
  if (BigInt(p.amount) > BigInt(a.amount)) return { approval: a, covered: false, changed: `the price went up from ${a.price} to ${p.price}` };
  return { approval: a, covered: true };
}
