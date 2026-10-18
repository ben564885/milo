// Set up the wallets for x402 payments. Keys go in .env.local (git-ignored).
// - Payer (X402_PRIVATE_KEY): the wallet Milo's agents pay with. It needs USDC only, no ETH: x402 payments are
//   signed USDC authorizations that the seller's facilitator submits.
// - Seller (X402_SELLER_KEY, with --seller): the wallet the demo website gets paid to. Only its address is used by the site.
// The network is the first of MILO_PAY_NETWORKS: Base Sepolia (testnet, default) or Base mainnet (eip155:8453, real USDC).
// Run: pnpm tsx scripts/wallet.ts            (payer: prints the address and USDC balance; creates a key if there is none)
//      pnpm tsx scripts/wallet.ts --seller   (same for the seller wallet)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { ROOT } from "../packages/shared/src/env.ts";
import { PAY_NETWORKS } from "../packages/shared/src/payments.ts";

const ENV_FILE = process.env.MILO_ENV_FILE ?? join(ROOT, ".env.local");
const seller = process.argv.includes("--seller");
const VAR = seller ? "X402_SELLER_KEY" : "X402_PRIVATE_KEY";
const mainnet = PAY_NETWORKS[0] === "eip155:8453";
const chain = mainnet ? base : baseSepolia;
const USDC = mainnet ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const label = mainnet ? "Base mainnet" : "Base Sepolia testnet";

let key = process.env[VAR] as `0x${string}` | undefined;
if (!key) {
  key = generatePrivateKey();
  const prefix = existsSync(ENV_FILE) && !readFileSync(ENV_FILE, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(ENV_FILE, `${prefix}# x402 ${seller ? "seller" : "payer"} wallet, written by scripts/wallet.ts\n${VAR}=${key}\n`);
  console.log(`Created a new ${seller ? "seller" : "payer"} wallet and saved its key to ${ENV_FILE} (git-ignored).`);
}
const address = privateKeyToAccount(key).address;
console.log(`${seller ? "Seller" : "Payer"} wallet: ${address}`);

const client = createPublicClient({ chain, transport: http() });
const balance = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }).catch(() => undefined);
console.log(balance === undefined ? `USDC balance: (couldn't reach ${label})` : `USDC balance: ${formatUnits(balance, 6)} (${label})`);
if (!balance && !seller) {
  console.log(mainnet
    ? "Send USDC on Base to the address above (about $1 is plenty; no ETH needed)."
    : "Get free testnet USDC at https://faucet.circle.com (pick Base Sepolia, paste the address above).");
}
console.log(`Explorer: https://${mainnet ? "" : "sepolia."}basescan.org/address/${address}`);
