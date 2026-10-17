import type { Decision } from "./types.ts";

/** The choices a person gets for a payment question. */
export const PAY_OPTIONS = ["approve once", "always approve", "deny"];

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
  const shown = n >= 0.01 ? n.toFixed(2) : n.toPrecision(2);
  return `$${shown} USDC${network === "eip155:84532" ? " (testnet)" : ""}`;
}

/** Read the person's pick for a payment question. Plain "yes" approves this call only; only an explicit "always" covers future calls. */
export function paymentScope(d: Pick<Decision, "outcome" | "choice" | "answer">): "once" | "always" | "deny" {
  if (d.outcome !== "approved") return "deny";
  const t = `${d.choice ?? ""} ${d.choice ? "" : d.answer}`.toLowerCase();
  if (/\b(deny|denied|no|don'?t|block)\b/.test(d.choice ?? "")) return "deny";
  return /\b(always|every ?time|future|from now on|all)\b/.test(t) ? "always" : "once";
}
