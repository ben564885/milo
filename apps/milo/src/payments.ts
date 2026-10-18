import { formatPrice, PAY_DAILY_USD, type PaymentAsk } from "@milo/shared";
import { db } from "./store.ts";

/** A standing "always approve" for one x402 endpoint, on the exact terms the person saw. */
export type Approval = PaymentAsk & { approvedBy?: string; at: string; requestId: string };

/** A payment the agent made (or tried to), reported back by the MCP with its receipt. */
export type Payment = PaymentAsk & { requestId?: string; status: "paid" | "failed"; httpStatus?: number; transaction?: string; payer?: string; auto: boolean; at: string };

db.exec("CREATE TABLE IF NOT EXISTS payment_approvals (endpoint TEXT PRIMARY KEY, json TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT, at TEXT, json TEXT)");
// One Slack message per endpoint per day for payments made on a standing approval. Milo edits it as the total grows.
db.exec("CREATE TABLE IF NOT EXISTS payment_digests (key TEXT PRIMARY KEY, ts TEXT)");

export function recordPayment(p: Payment) {
  db.prepare("INSERT INTO payments (endpoint, at, json) VALUES (?, ?, ?)").run(p.endpoint, p.at, JSON.stringify(p));
}

export function listPayments(limit = 50): Payment[] {
  return (db.prepare("SELECT json FROM payments ORDER BY id DESC LIMIT ?").all(limit) as { json: string }[]).map((r) => JSON.parse(r.json));
}

/**
 * What a standing approval has paid today, in atomic units. The day starts at local midnight,
 * or when the approval was last given if that is later (a fresh "always approve" starts a fresh budget).
 */
export function spentToday(a: Approval, now = new Date()): bigint {
  return autoPaidToday(a, now).reduce((sum, p) => sum + BigInt(p.amount), 0n);
}

/** Payments made today on a standing approval (see spentToday for when "today" starts). */
export function autoPaidToday(a: Approval, now = new Date()): Payment[] {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const since = new Date(Math.max(midnight.getTime(), new Date(a.at).getTime())).toISOString();
  const rows = db.prepare("SELECT json FROM payments WHERE endpoint = ? AND at >= ?").all(a.endpoint, since) as { json: string }[];
  return rows.map((r) => JSON.parse(r.json) as Payment).filter((p) => p.status === "paid" && p.auto);
}

/** The Slack message for today's payments to an endpoint, if Milo posted one. */
export function digestTs(key: string): string | undefined {
  return (db.prepare("SELECT ts FROM payment_digests WHERE key = ?").get(key) as { ts: string } | undefined)?.ts;
}

export function saveDigestTs(key: string, ts: string) {
  db.prepare("INSERT INTO payment_digests (key, ts) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ts = excluded.ts").run(key, ts);
}

/** "$0.03 of $5.00 today" for a standing approval. */
export function budgetLine(a: Approval): string {
  return `${formatPrice(spentToday(a).toString(), a.asset, a.network).replace(/ USDC.*/, "")} of $${PAY_DAILY_USD.toFixed(2)} today`;
}

export function listApprovals(): Approval[] {
  return (db.prepare("SELECT json FROM payment_approvals ORDER BY endpoint").all() as { json: string }[]).map((r) => JSON.parse(r.json));
}

export function saveApproval(a: Approval) {
  db.prepare("INSERT INTO payment_approvals (endpoint, json) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json").run(a.endpoint, JSON.stringify(a));
}

export function revokeApproval(endpoint: string): boolean {
  return Number(db.prepare("DELETE FROM payment_approvals WHERE endpoint = ?").run(endpoint).changes) > 0;
}

export function resetApprovals() { db.exec("DELETE FROM payment_approvals"); db.exec("DELETE FROM payments"); db.exec("DELETE FROM payment_digests"); }

/**
 * Does a standing approval cover this payment? It must be the same endpoint, network, token and recipient,
 * at no more than the approved price, within the daily budget. If the endpoint was approved on other terms, `changed` says what moved,
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
  // Standing approvals are USDC only (6 decimals), so the daily budget is in atomic USDC.
  const budget = BigInt(Math.round(PAY_DAILY_USD * 1e6));
  if (spentToday(a) + BigInt(p.amount) > budget) return { approval: a, covered: false, changed: `today's $${PAY_DAILY_USD.toFixed(2)} budget for this endpoint is used up (${budgetLine(a)})` };
  return { approval: a, covered: true };
}
