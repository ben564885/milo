// Set up the wallet Milo's agents pay x402 endpoints with: a Base Sepolia (testnet) key in .env.local.
// Testnet USDC has no real value, so a demo can't lose money. The payer needs no ETH: x402 payments are
// signed USDC authorizations that the seller's facilitator submits.
// Run: pnpm tsx scripts/wallet.ts            (prints the address and USDC balance; creates a key if there is none)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ROOT } from "../packages/shared/src/env.ts";

const ENV_FILE = process.env.MILO_ENV_FILE ?? join(ROOT, ".env.local");
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC on Base Sepolia

let key = process.env.X402_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  key = generatePrivateKey();
  const prefix = existsSync(ENV_FILE) && !readFileSync(ENV_FILE, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(ENV_FILE, `${prefix}# x402 payer wallet (Base Sepolia testnet), written by scripts/wallet.ts\nX402_PRIVATE_KEY=${key}\n`);
  console.log(`Created a new testnet wallet and saved its key to ${ENV_FILE} (git-ignored).`);
}
const address = privateKeyToAccount(key).address;
console.log(`Wallet: ${address}`);

const chain = createPublicClient({ chain: baseSepolia, transport: http() });
const balance = await chain.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }).catch(() => undefined);
console.log(balance === undefined ? "USDC balance: (couldn't reach Base Sepolia)" : `USDC balance: ${formatUnits(balance, 6)} (Base Sepolia)`);
if (!balance) console.log("Get free testnet USDC at https://faucet.circle.com (pick Base Sepolia, paste the address above).");
console.log(`Explorer: https://sepolia.basescan.org/address/${address}`);
