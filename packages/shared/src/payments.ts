import type { Decision } from "./types.ts";

/** The choices a person gets for a payment question. */
export const PAY_OPTIONS = ["approve once", "always approve", "deny"];

/** Daily budget for payments made on a standing approval, per endpoint, in USD. */
export const PAY_DAILY_USD = Number(process.env.MILO_PAY_DAILY_USD ?? 5);

/** Networks the wallet may pay on. Base Sepolia (testnet) only, unless MILO_PAY_NETWORKS says otherwise. */
export const PAY_NETWORKS = (process.env.MILO_PAY_NETWORKS ?? "eip155:84532").split(",").map((s) => s.trim()).filter(Boolean);

/** A block-explorer link for a settled payment. */
export function txLink(network: string, tx?: string): string | undefined {
  if (!tx || !/^0x[0-9a-f]{64}$/i.test(tx)) return undefined;
  const base = network === "eip155:8453" ? "https://basescan.org" : network === "eip155:84532" ? "https://sepolia.basescan.org" : undefined;
  return base && `${base}/tx/${tx}`;
}

/** What an approval is keyed on: method + origin + path. The query string is left out, so ?city=sf and ?city=nyc are one endpoint. */
export function endpointKey(method: string, url: string): string {
  const u = new URL(url);
  return `${method.toUpperCase()} ${u.origin}${u.pathname.replace(/\/+$/, "") || "/"}`;
}

/** A spoken-friendly name with no dots or slashes (iMessage blocks links in a first text), e.g. "the weather api on example". */
export function endpointName(url: string): string {
  const u = new URL(url);
  if (/^[\d.]+$|^\[/.test(u.hostname)) return "a local test api";
  const labels = u.hostname.split(".").filter((l) => !["www", "api"].includes(l));
  const site = labels.length > 1 ? labels.at(-2)! : labels[0] ?? u.hostname;
  const last = u.pathname.split("/").filter(Boolean).at(-1)?.replace(/[^\w-]/g, "");
  return last ? `the ${last} api on ${site}` : `the ${site} api`;
}

// USDC on the networks x402 facilitators support (6 decimals).
const USDC: Record<string, string> = {
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
};

/** The price in US dollars if the token is USDC on a known network, otherwise undefined. */
export function usdValue(amount: string, asset: string, network: string): number | undefined {
  return USDC[network] === asset.toLowerCase() ? Number(amount) / 1e6 : undefined;
}

/** "10000" of USDC → "$0.01 USDC". Unknown assets show the atomic amount. */
export function formatPrice(amount: string, asset: string, network: string): string {
  const n = usdValue(amount, asset, network);
  if (n === undefined) return `${amount} units of ${asset.slice(0, 10)}…`;
  const shown = n >= 0.01 || n === 0 ? n.toFixed(2) : n.toPrecision(2);
  return `$${shown} USDC${network === "eip155:84532" ? " (testnet)" : ""}`;
}

/** Read the person's pick for a payment question. Plain "yes" approves this call only; only an explicit "always" covers future calls. */
export function paymentScope(d: Pick<Decision, "outcome" | "choice" | "answer">): "once" | "always" | "deny" {
  if (d.outcome !== "approved") return "deny";
  const t = `${d.choice ?? ""} ${d.choice ? "" : d.answer}`.toLowerCase();
  if (/\b(deny|denied|no|don'?t|block)\b/.test(d.choice ?? "")) return "deny";
  return /\b(always|every ?time|future|from now on|all)\b/.test(t) ? "always" : "once";
}

/**
 * What the person actually said, as a payment answer.
 * "Always" needs an explicit always / every time / from now on; any approval needs a yes-word; mumbles count as nothing.
 * Used to check the model's reading of a reply or call, so spending authority is never guessed.
 */
export function heardScope(said: string): "always" | "once" | "deny" | undefined {
  const lines = said.split("\n").map((l) => l.replace(/^\s*(them|human)\s*:\s*/i, "").trim().toLowerCase()).filter(Boolean);
  const kind = (l: string) =>
    /\b(deny|denied|don'?t (approve|pay|do)|do not|not (approve|pay)|nope|no way|block|reject)\b/.test(l) || /^no\b/.test(l) ? "deny"
    : /\b(always|every ?time|from now on|all future|permanently)\b/.test(l) && !/\b(not|never|don'?t)\b/.test(l) ? "always"
    : /\b(once|one time|this time|just this|yes|yeah|yep|yup|sure|ok|okay|approved?|fine|go ahead|do it|sounds good)\b/.test(l) ? "once"
    : undefined;
  const kinds = lines.map(kind).filter(Boolean);
  // A "no" counts only as the latest clear answer; otherwise an explicit "always" anywhere wins over a later "ok, bye".
  if (kinds.at(-1) === "deny") return "deny";
  return kinds.includes("always") ? "always" : kinds.includes("once") ? "once" : undefined;
}
