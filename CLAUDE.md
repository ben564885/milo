# YC Hackathon: Make Something Agents Want

This directory holds our project for the YC "Make Something Agents Want" hackathon.

## Event

- **When:** Sat Oct 17, 2026, 9 AM → Sun Oct 18, 1:30 PM
- **Where:** 560 20th Street, San Francisco
- **Team:** Ben, Daniel Dorn, Philip Nisevich
- **Theme:** Agent experience (AX) over UX, headless MCPs over UIs, token spend over user time, docs written for agents.

## Framing (kickoff, Namil, YC visiting partner)

- Agents are becoming the main users of many internet products; incumbents still design for humans. Dev tools shifted first; search, e-commerce, checkout and computer use are next.
- Cited figures (unverified): 65% of internet traffic is bots, ~10,000 MCP servers, 70% of Supabase signups are agents, YC solo founders 3% → 20% of a batch in two years.
- Agents get stuck on signups, billing screens, rate limits, CAPTCHAs, payments (x402 / USDC) and human-only interfaces.
- Two starting points: remove something that blocks an agent, or rebuild a human tool for agents. Harder question: what does an agent need that a human never did?
- Advice: build one compelling thing. Target one or two prize tracks, not all of them.

## Schedule

| When | What |
|---|---|
| Sat 10:30 AM | Hacking begins |
| Sat 12:00 PM | Lunch, lightning talks 12:15 |
| Sat 5:00 PM | Dinner, lightning talks 6:00 |
| Sun 8:00 AM | Breakfast |
| **Sun 10:00 AM** | **Submissions due**, then live demos |
| Sun 11:00 AM | Judging complete |
| Sun 12:15 PM | Winners announced |
| Sun 1:00 PM | End |

## Submission

- One form, sent Sunday morning: GitHub link, video, prize tracks entered.
- Overall prize: a YC interview (applications due early November).
- No re-entry if you leave after midnight. Announcements in the Bookface hackathon channel.

## What we are building

**Milo** (owl mascot), a human response layer for agents. Plan: `PLAN.md` (written when the working name was Switchboard). Video plan: `VIDEO.md`. How to run: `README.md`.

- Inkbox identities: `hey-milo` (Milo: one dedicated phone number and the dedicated iMessage line; see the Inkbox console), `hey-milo-coder` (Claude Code's A2A identity), `milo-ben` / `milo-daniel` / `milo-philip` (owner agents). IDs in `config/identities.local.json` (git-ignored; see `config/identities.example.json`); real contact details in `config/people.local.yaml` (git-ignored); keys in `.env` / `.env.local` (git-ignored; see `.env.example`).
- Code: `apps/milo` (server, engine, webhooks, status page on :8787, tunnel at https://hey-milo.inkboxwire.com), `apps/owner-agent`, `packages/mcp` (`ask_human` tool, wired in `.mcp.json`), `packages/shared`, `scripts/` (setup, provision, configure, slack).
- First iMessage to a new person cannot contain links or file names (Inkbox 422). Inkbox trims near-white avatar borders.

## Design changes to the Milo site go through Milo (demo flow)

The site in `apps/web` is live at https://milo-calls.vercel.app (Vercel project `milo-calls`). The team decides its look, not you.

When the user asks to change a color on the site, for example:
- "change the background color of the transcript website", or
- "change the color of the main call to action on our site",

do this:
1. Do not pick a color yourself, and do not ask the user in chat.
2. Call the `ask_human` tool (Milo MCP server) with:
   - `question`: short and specific, e.g. "What background color should the transcript page use?" or "What color should the main call-to-action button on the landing page be?"
   - `options`: `["red", "green", "blue"]`
   - `file`: `apps/web/t.html` for the transcript page, `apps/web/index.html` for the landing page button.
   - `context`: one sentence on the current color and what will change.
3. Wait for the decision. If the tool says "still waiting", call `check_human_answer` with the `task_id`. Change nothing while you wait.
4. Apply the chosen color (the decision's `choice` field). The options are only suggestions: if someone picked a different color (e.g. "white"), use that one. Keep it tasteful and readable: a soft tint for backgrounds (red `#fde8e6`, green `#e6f4ea`, blue `#e7effc`, white `#ffffff`), a solid color for buttons (red `#d6453d`, green `#2f9e5b`, blue `#2f6fdb`). For any other color, pick a similar soft tint or solid shade.
   - Transcript page background: `--bg` in `apps/web/t.html`. The page has a light palette (`:root`) and a dark palette (`@media (prefers-color-scheme:dark)`). Change `--bg` in both, so everyone sees the new color, and keep the text readable (in dark mode use a dark shade of the color). The default is peach `#fff7ef` (light) and `#1b130e` (dark).
   - Landing page button: `--cta` in the `:root` block of `apps/web/index.html`.
5. Redeploy: run `vercel deploy --prod --yes` in `apps/web`.
6. Reply with the new color, who decided it (the decision's `decidedBy`), and the live URL.

If the decision is blocked or there is no answer, do not change anything, and say so.

Milo itself (`pnpm milo` and `pnpm owners`) must run on this laptop for `ask_human` to work.

## Our target track: Inkbox

We are building for the **Inkbox** track. The agent must have a persistent identity and must use **multiple channels** (email, phone, iMessage, Slack, A2A) to talk with humans and other agents. Judge every scope decision against that.

### Inkbox platform notes

- Docs index for agents: https://inkbox.ai/docs/llms.txt (each page also has a `.md` version).
- An **identity** groups a mailbox, an optional phone number, a tunnel and vault access under one handle.
- Channels: email (threads, drafts, attachments, custom domains), phone (calls, SMS/MMS, transcripts), iMessage (groups, tapbacks, avatars), Slack (workspace connection, history search), A2A 1.0 (Agent Card, tasks, messages).
- **Inkbox Voice AI** is a hosted call agent: it places and answers calls with no server and returns a structured post-call package. The Media Stream WebSocket is for a custom voice pipeline.
- iMessage to a person needs that person to connect through the shared triage line first. Do this early for demo phones.
- Webhooks: signed HTTPS events for mail, phone, iMessage, A2A and Slack. **Tunnels** give a stable public URL to a local server.
- Also: contacts (with memory), contact rules, notes, vault.
- SDKs: `@inkbox/sdk` (TypeScript), `inkbox` (Python), Rust. CLI: `@inkbox/cli`. Remote MCP server available.
- **Startup plan ($200/mo):** 100 identities, 9 dedicated VoIP numbers, 1 dedicated iMessage number (agent can start chats, group chats of 2-8, no connect step), 300 SMS + **only 30 call minutes per number**. Buy a 250-minute pack ($7) before rehearsals.
- **Voice AI:** `place_call(mode="hosted_agent", reason=...)` (reason max 2,000 chars). No custom tools during the call. Results come in the `call.ended` webhook (transcript, `outcome`, `post_call_action_items`). Can add one guest (3-way call) or transfer, on dedicated lines only. Authority modes: `contact_scoped` or `yolo` (default).
- **Slack:** send/thread reply via `POST /slack/connections/{id}/messages` (needs `Idempotency-Key`). No presence data. No Block Kit buttons. Task cards (task streams) for live progress.
- **iMessage:** tapbacks from humans arrive as `imessage.reaction_received` (usable as one-tap approve/deny).
- **A2A:** task states `submitted`, `working`, `input_required`, `completed`, `failed`, `canceled`. Same-org identities can call each other with no rules. Webhooks `a2a.task.created`, `a2a.sent_task.updated`.
- **Contact memory:** `GET/POST /contacts/{id}/facts`, kinds `profile` / `preference` / `context`, 500 chars, 10 per kind.
- **Notes:** org-wide text (100k chars), full-text search, per-identity access.

## Prize tracks (event page is authoritative)

| Track | What they want | Prizes |
|---|---|---|
| **Inkbox** | Agents with persistent identity (email, phone, iMessage, Slack, A2A) talking to humans and each other. Use **multiple channels**. | $1,000 + $1,000 credits / $500 + $500 / $200 + $200 |
| **Primitive.dev** (Best Agent Communication Setup) | Agent identity; ask questions, receive replies, handle attachments, coordinate async. Email rebuilt for agents. | $3,000 / $2,000 / $1,000 cash |
| **Stripe** | Agent that safely takes part in the economy (buying, provisioning, managing spend) with clear user control over permissions and spend. | $3,000 / $2,000 / $1,000 Stripe credits + free Atlas |
| **Manufact** (Best MCP Server for Agents) | MCP server with agents as the main customer. Their framework: MCP-use (can return UI). | $2,000 + $6,000 credits / $700 + $3,000 / $300 + $300 |
| **Armature** (Best Agent Experience) | Agent-facing interface (MCP, CLI): discoverability, onboarding without a human. | $1,000 / $500 / $300 + equal credits |
| **InsForge** (Agent-Native Cloud) | Agent-native cloud; computer use on their agent machines (file systems, snapshots, terminals). | $1,000 / $500 / $300 gift card + equal credits |
| **Blaxel** (Something a Human Would Never Want) | Built for agents, not humans. Agent-first cloud, sandboxes resume in ~25 ms. | $1,000 gift card |

## Free resources

- **Inkbox:** 100 agent identities, a real phone/iMessage number, and the **$200/mo startup plan**
- **InsForge:** invite code `556677`. 4 vCPU / 8 GB default, up to 5 machines.
- **Blaxel:** $500 builder credits
- **Supabase:** $25 credits (ask Anirudh or Himesh)
- **Stripe:** $500 credits after the event, 20% off Atlas
