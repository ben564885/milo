#!/usr/bin/env -S npx tsx
/**
 * Milo MCP server: lets a coding agent (Claude Code) ask a human.
 * Sends an A2A task from the coder identity to Milo and waits for the decision.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { wrapFetchWithPayment, decodePaymentResponseHeader, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentClient, endpointKey, endpointName, formatPrice, loadIdentities, usdValue, loadPeople, type PaymentAsk } from "@milo/shared";

const ids = loadIdentities();
const WAIT_MS = Number(process.env.MILO_MCP_WAIT_MS ?? 4 * 60_000);

// ---------- the caller's repo ----------
const CALLER = process.env.MILO_CALLER_CWD ?? process.cwd();
function gitRoot(): string {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: CALLER, encoding: "utf8" }).trim(); } catch { return CALLER; }
}
function gitBranch(root: string): string | undefined {
  try { return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return undefined; }
}

/** Owner of a file from the caller repo's CODEOWNERS (last matching rule wins, like GitHub). */
function codeOwner(root: string, file?: string): string | undefined {
  if (!file) return undefined;
  const path = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"].map((p) => join(root, p)).find(existsSync);
  if (!path) return undefined;
  const rel = relative(root, resolve(root, file)).replace(/\\/g, "/");
  let owner: string | undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [pattern, first] = line.trim().split(/\s+/);
    if (!pattern || pattern.startsWith("#") || !first) continue;
    const p = pattern.replace(/^\//, "");
    const hit = p === "*" || rel === p || rel.endsWith("/" + p) || (p.endsWith("/") && (rel.startsWith(p) || rel.includes("/" + p))) || (p.startsWith("*.") && rel.endsWith(p.slice(1)));
    if (hit) owner = first.replace(/^@/, "");
  }
  return owner;
}

/** Map a CODEOWNERS handle (GitHub user or team) to a person in Milo's people.yaml. */
function toPerson(handle?: string): string | undefined {
  if (!handle) return undefined;
  const h = handle.toLowerCase().split("/").pop()!;
  const people = loadPeople();
  for (const p of Object.values(people)) {
    const gh = ((p as any).github ?? "").toLowerCase();
    if (h === p.handle || (gh && h === gh) || h.includes(p.name.toLowerCase())) return p.handle;
  }
  return undefined;
}

async function a2a() {
  const coder = await agentClient(ids.coder.handle).getIdentity(ids.coder.handle);
  const client = await coder.a2aClient();
  const target = await client.fetchCard(`https://inkbox.ai/a2a/${ids.milo.handle}/card`);
  return { client, target };
}

function summarize(task: any) {
  const state = String(task.status?.state ?? "").replace("TASK_STATE_", "").toLowerCase();
  const agentMsgs = (task.history ?? []).filter((h: any) => /AGENT/.test(h.role));
  const progress = agentMsgs.map((m: any) => m.parts?.find((p: any) => p.text)?.text).filter(Boolean);
  const data = [...agentMsgs].reverse().map((m: any) => m.parts?.find((p: any) => p.data)?.data).find(Boolean);
  return { state, progress, decision: data };
}

async function waitFor(taskId: string, ms: number) {
  const { client, target } = await a2a();
  const deadline = Date.now() + ms;
  let task: any;
  do {
    task = await client.getTask(target, taskId);
    if (/COMPLETED|FAILED|CANCELED|REJECTED/.test(task.status?.state)) break;
    await new Promise((r) => setTimeout(r, 1500));
  } while (Date.now() < deadline);
  return summarize(task);
}

function render(taskId: string, s: ReturnType<typeof summarize>) {
  const done = s.state === "completed";
  const lines = [
    done ? "A human decision is ready." : `Still waiting for a human (state: ${s.state}). Call check_human_answer with task_id "${taskId}" to keep waiting. Do not make the change until you have a decision.`,
    s.decision ? `Decision: ${JSON.stringify(s.decision)}` : "",
    s.progress.length ? `What Milo did:\n- ${s.progress.join("\n- ")}` : "",
    `task_id: ${taskId}`,
  ];
  return { content: [{ type: "text" as const, text: lines.filter(Boolean).join("\n\n") }] };
}

const INSTRUCTIONS = `Milo gets real decisions from the humans on this team (over Slack, text, and a phone call) and remembers them.
Call ask_human BEFORE you:
- change code owned by someone else (see CODEOWNERS), especially billing, auth, payments, data migrations, or public APIs;
- do anything risky or hard to undo (deleting data, force-pushing, changing infra, spending money, contacting customers);
- pick between options when the requirement is ambiguous and a wrong guess would waste real work.
Ask one short, concrete question and pass the file path. For a choice (for example a color), pass the options and use the decision's choice field. Do not ask for things you can find out yourself.
While you wait, do not make the change. If ask_human returns "still waiting", call check_human_answer with the task_id.
Follow the decision exactly: approved = proceed; blocked = don't; redirect = do the "instead" action. Mention who decided in your reply.
To call an HTTP API that may charge you (HTTP 402 / x402), use paid_fetch instead of curl or fetch. It asks a human the first time you pay an endpoint (approve once, always approve, or deny) and pays only if approved. Never pay a 402 any other way.`;

const server = new McpServer({ name: "milo", version: "0.2.0" }, { instructions: INSTRUCTIONS });

server.registerTool(
  "ask_human",
  {
    title: "Ask a human (via Milo)",
    description:
      "Get a decision from the human who owns something before you act. Use it when a change touches code you don't own, needs approval, or is risky or ambiguous. Milo checks recorded decisions, asks the owner's agent, then escalates over Slack, iMessage and a phone call. Blocks until a human decides (up to ~7 minutes), then returns a structured decision: outcome (approved | blocked | redirect | no_answer), answer, instead, decidedBy.",
    inputSchema: {
      question: z.string().describe("A yes/no or short question for the human, e.g. 'Can I change billing.ts to call the legacy charge endpoint?'"),
      context: z.string().optional().describe("Why you need this, and a short diff or plan. Keep under 1,000 characters."),
      file: z.string().optional().describe("Repo-relative path of the file involved; used to find the owner from CODEOWNERS."),
      options: z.array(z.string()).optional().describe("For a choice question, the options to pick from, e.g. [\"red\", \"green\", \"blue\"]. The decision's choice field holds the pick."),
      ask: z.string().optional().describe("First name of the person to ask, if you already know who decides. Otherwise Milo uses CODEOWNERS."),
    },
  },
  async (args) => {
    const { client, target } = await a2a();
    const root = gitRoot();
    const repo = basename(root);
    const branch = gitBranch(root);
    const owner = (args.ask && toPerson(args.ask)) || toPerson(codeOwner(root, args.file));
    const context = [args.context, `repo: ${repo}${branch ? ` (branch ${branch})` : ""}`].filter(Boolean).join("\n");
    const sent: any = await client.send(target, { text: JSON.stringify({ question: args.question, options: args.options, context, file: args.file, owner, repo, requester: "Claude Code" }) });
    const taskId = sent.task?.id ?? sent.id;
    return render(taskId, await waitFor(taskId, WAIT_MS));
  },
);

server.registerTool(
  "check_human_answer",
  {
    title: "Check a pending human answer",
    description: "Keep waiting for a decision from an earlier ask_human call.",
    inputSchema: { task_id: z.string() },
  },
  async ({ task_id }) => render(task_id, await waitFor(task_id, WAIT_MS)),
);

// ---------- x402 payments ----------
// The wallet that pays. Without X402_PRIVATE_KEY, a throwaway unfunded wallet is used: fine for the local demo endpoint, real sellers will reject it.
const PAY_KEY = (process.env.X402_PRIVATE_KEY as `0x${string}` | undefined) || generatePrivateKey();
const wallet = privateKeyToAccount(PAY_KEY);
const PAY_MAX = process.env.MILO_PAY_MAX_USD ?? "1"; // hard cap per payment, in USD, even when a human approves
/** Payment questions still waiting on a person, so calling paid_fetch again keeps waiting instead of asking twice. */
const pendingPay = new Map<string, string>();

server.registerTool(
  "paid_fetch",
  {
    title: "Fetch a URL, paying via x402 with a human's OK",
    description:
      `Make an HTTP request to an API that may answer 402 Payment Required (x402). If it asks for payment, Milo asks a human first: approve once, always approve this endpoint, or deny. An endpoint (method + URL without the query string) that was "always approved" is paid without asking, as long as the price, token, network and recipient are no worse than what was approved. Pays in USDC from wallet ${wallet.address}, at most $${PAY_MAX} per call. Returns the HTTP status, the payment receipt, and the response body.`,
    inputSchema: {
      url: z.string().url().describe("Full URL to call."),
      method: z.string().optional().describe("HTTP method. Default GET."),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional().describe("Request body, e.g. a JSON string."),
      reason: z.string().describe("One sentence for the human: why you need this paid call."),
    },
  },
  async (args) => {
    const method = (args.method ?? "GET").toUpperCase();
    const endpoint = endpointKey(method, args.url);
    let decision: any;
    let ask: PaymentAsk | undefined;
    let stillWaiting: string | undefined;
    let refused: string | undefined;
    const client = new x402Client()
      .register("eip155:*", new ExactEvmScheme(wallet))
      .setSpendControls({ maxAmountPerPayment: `$${PAY_MAX}` })
      .onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements: req }) => {
        // The client may retry inside one call; the decision already made covers that retry.
        // Refuse what the wallet can't or mustn't pay before bothering a human.
        const usd = usdValue(req.amount, req.asset, req.network);
        if (usd === undefined) return { abort: true, reason: (refused = `it wants a token other than USDC (${req.asset} on ${req.network})`) };
        if (usd > Number(PAY_MAX)) return { abort: true, reason: (refused = `it costs $${usd}, over the $${PAY_MAX} per-call cap (MILO_PAY_MAX_USD)`) };
        if (decision) return decision.scope === "once" || decision.scope === "always" ? undefined : { abort: true, reason: "denied" };
        ask = {
          endpoint, url: args.url, amount: req.amount, asset: req.asset, network: req.network, payTo: req.payTo,
          price: formatPrice(req.amount, req.asset, req.network),
          description: paymentRequired.resource?.description || undefined,
        };
        const key = `${endpoint}|${req.amount}|${req.payTo}`;
        let taskId = pendingPay.get(key);
        if (!taskId) {
          const { client: a2aClient, target } = await a2a();
          const question = `Can Claude Code pay ${ask.price} to use ${endpointName(args.url)}?`;
          const context = [args.reason, ask.description && `What it sells: ${ask.description}`].filter(Boolean).join("\n");
          const sent: any = await a2aClient.send(target, { text: JSON.stringify({ question, context, payment: ask, repo: basename(gitRoot()), requester: "Claude Code" }) });
          taskId = (sent.task?.id ?? sent.id) as string;
          pendingPay.set(key, taskId);
        }
        const s = await waitFor(taskId, WAIT_MS);
        if (s.state !== "completed" && s.state !== "failed" && s.state !== "canceled") {
          stillWaiting = taskId;
          return { abort: true, reason: "still waiting for a human" };
        }
        pendingPay.delete(key);
        decision = { ...(s.decision ?? { outcome: "no_answer", answer: "No decision." }), progress: s.progress };
        if (decision.scope !== "once" && decision.scope !== "always") return { abort: true, reason: decision.answer ?? "not approved" };
      });

    const lines: string[] = [];
    let res: Response;
    try {
      res = await wrapFetchWithPayment(fetch, client)(args.url, { method, headers: args.headers, body: args.body });
    } catch (e) {
      const msg = (e as Error).message;
      if (/spendControls/.test(msg)) refused ??= `it costs more than the $${PAY_MAX} per-call cap (MILO_PAY_MAX_USD) or wants a token other than USDC`;
      if (refused) lines.push(`Not paid, and no human was asked: ${refused}.`);
      else if (stillWaiting) lines.push(`Still waiting for a human to approve paying ${ask?.price} for ${endpoint}. Call paid_fetch again with the same url and method to keep waiting. Do not pay any other way.`, `task_id: ${stillWaiting}`);
      else if (decision) lines.push(`Not paid. ${decision.outcome === "no_answer" ? "No human answered" : `${decision.decidedBy ?? "The human"} denied it`}: ${decision.answer}`, `Decision: ${JSON.stringify(decision)}`);
      else lines.push(`Payment failed before anyone was asked: ${msg}`);
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    }

    const receiptHeader = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    let receipt: unknown;
    try { receipt = receiptHeader ? decodePaymentResponseHeader(receiptHeader) : undefined; } catch { receipt = receiptHeader; }
    if (decision && ask) {
      const how = decision.scope === "always"
        ? (decision.source?.channel === "memory" ? `standing approval from ${decision.decidedBy ?? "a human"}` : `${decision.decidedBy ?? "a human"} approved this endpoint from now on`)
        : `${decision.decidedBy ?? "a human"} approved this one call`;
      lines.push(res.status === 402 ? `Payment of ${ask.price} was approved (${how}) but the seller still answered 402. ${PAY_KEY === process.env.X402_PRIVATE_KEY ? "Check the wallet balance." : "No X402_PRIVATE_KEY is set, so a throwaway unfunded wallet was used."}` : `Paid ${ask.price} for ${endpoint} (${how}).`);
      if (receipt) lines.push(`Receipt: ${JSON.stringify(receipt)}`);
    } else {
      lines.push("No payment was needed.");
    }
    const text = await res.text();
    lines.push(`HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`.trim(), text.length > 20_000 ? `${text.slice(0, 20_000)}\n…(truncated, ${text.length} chars)` : text);
    return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
  },
);

await server.connect(new StdioServerTransport());
console.error("milo mcp ready");
