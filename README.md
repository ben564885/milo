# Milo 🦉 — the human response layer for agents

When an agent is blocked on a human decision, Milo gets the answer. It checks recorded decisions, asks the owner's agent over A2A, then escalates through Slack, iMessage and a Voice AI phone call (adding the code owner as a guest), and returns a structured decision. Every answer is saved to Inkbox Notes and contact memory, so the next time nobody needs to be interrupted.

Built on [Inkbox](https://inkbox.ai): identities, A2A, Slack, iMessage (tapbacks), Voice AI (calls + add guest), webhooks, tunnels, Notes, contact memory.

## Configuration

Secrets and personal data are never committed:

| File | What | In git? |
|---|---|---|
| `.env` | your keys (copy `.env.example`) | no |
| `.env.local` | agent keys and webhook secret, written by the setup scripts | no |
| `config/people.local.yaml` | real names, phones, Slack IDs, interrupt budget (copy `config/people.yaml`) | no |
| `config/identities.local.json` | Inkbox identity and Slack IDs, written by `scripts/setup.ts` | no |
| `data/` | local database, logs, call recordings | no |

The Inkbox tunnel makes the server public, but only `/hooks/inkbox` (signed webhooks) and `/ws/call` (call audio) answer from outside. The status page and API work only on localhost.

## Run

```bash
pnpm install
# .env: INKBOX_API_KEY=...   (optional) ANTHROPIC_API_KEY=...
pnpm tsx scripts/setup.ts       # identities, agent keys (.env.local), A2A, contacts
pnpm tsx scripts/provision.ts   # phone number + iMessage line for Milo
pnpm tsx scripts/configure.ts   # Voice AI voice/instructions, signing key, webhooks
pnpm tsx scripts/slack.ts       # Slack connection status / install link
pnpm tsx scripts/slack.ts milo-demo   # pick the Slack channel

pnpm milo     # server + status page on http://localhost:8787 + tunnel
pnpm owners   # owner agents (milo-ben, milo-daniel, ...)
```

Claude Code picks up the `ask_human` tool from `.mcp.json`. Or call HTTP directly:

```bash
curl -X POST 'localhost:8787/api/ask?wait=60000' -H 'content-type: application/json' \
  -d '{"question":"Can I change billing.ts so refunds call the legacy v1 endpoint?","file":"src/billing/billing.ts","urgency":"normal"}'
curl -X POST localhost:8787/api/reset   # clear demo decisions
```

## The ladder

| Step | Channel | Inkbox feature |
|---|---|---|
| 0 | Recorded decisions | Notes, contact memory |
| 1 | Owner's agent | A2A (`input_required` → escalate) |
| 2 | Slack thread + live status card | Slack messages + webhooks |
| 3 | iMessage with 👍 / 👎 | Dedicated iMessage line, tapback webhooks |
| 4 | Phone call, owner added as guest | Voice AI outbound call, add guest, `call.ended` |

The interrupt budget in `config/people.yaml` sets how high Milo may go for each person (max step, minimum urgency for calls, quiet hours).

## Paying x402 endpoints (`paid_fetch`)

Agents call paid HTTP APIs through the `paid_fetch` MCP tool instead of `curl`. When an endpoint answers `402 Payment Required` (x402), Milo asks a person before any money moves, using the same ladder (Slack → iMessage → call). The choices are **approve once**, **always approve** (this endpoint, from now on), or **deny**.

- An endpoint is the method + origin + path, without the query string: `GET https://api.example.com/weather` covers `?city=sf` and `?city=nyc`.
- An "always approve" is saved locally (`payment_approvals` in `data/milo.db`) with the exact terms the person saw: price, token, network and recipient. Later calls are paid without asking only if the price is the same or lower and nothing else changed. Otherwise Milo asks again and says what changed.
- "approve once" and a plain "yes" pay that one call only. Payment decisions are never saved as Notes, so a one-time OK can't be reused by fuzzy matching. The owner's agent is skipped: a person always decides spending.
- iMessage: 👍 = approve once, ❤️ = always approve, 👎 = deny.
- Hard limits that no approval overrides: USDC only, at most `MILO_PAY_MAX_USD` (default $1) per call. Calls over the limit are refused without asking anyone.
- Wallet: `X402_PRIVATE_KEY` (use a Base Sepolia testnet key for demos). Without one, a throwaway unfunded wallet is used. That works with the local demo endpoint; real sellers will reject it.

```bash
curl localhost:8787/x402/demo/weather                       # local 402 endpoint ($0.01 testnet USDC; ?price=<atomic> to change; does not verify or settle)
curl localhost:8787/api/payments/approvals                  # standing approvals
curl -X DELETE 'localhost:8787/api/payments/approvals?endpoint=GET%20http://localhost:8787/x402/demo/weather'   # revoke one
```

Ask Claude Code: *"Use paid_fetch to get the weather from http://localhost:8787/x402/demo/weather"*. The first call asks a human. After "always approve", the next call pays without asking and posts an fyi in Slack.

## QA

```bash
pnpm tsx scripts/qa/unit.ts                              # owners, budget, heuristics, text cleanup
pnpm tsx scripts/qa/x402.ts                              # x402: helpers, standing approvals, real 402 round trip (offline)
(cd apps/milo && pnpm exec tsx src/qa-webhooks.ts)       # simulated webhooks → signals
pnpm tsx scripts/qa/owner.ts                             # owner agent over A2A
pnpm tsx scripts/qa/seed.ts                              # seed a decision (Act 2 without a call)
(cd packages/mcp && pnpm exec tsx src/qa-client.ts '{"question":"...","file":"src/billing/billing.ts","urgency":"normal"}')  # full flow via MCP
pnpm tsx scripts/qa/deliveries.ts                        # Inkbox webhook delivery history
```
