# Build Plan: Human Response Layer for Agents

Working name: **Switchboard**. (Change it any time.)

One sentence: when an agent is blocked on a human decision, Switchboard gets that decision for it. It asks the owner's agent first, then escalates through Slack, iMessage and a phone call, and it remembers every answer so the next ask needs fewer interruptions.

Target track: **Inkbox**. Deadline: **Sun Oct 18, 10:00 AM** (submit by 9:30).

---

## 1. The demo we are building toward

### Act 1: the agent needs a human (~2 min)

| # | What happens | Inkbox feature |
|---|---|---|
| 1 | Claude Code wants to change `billing.ts`. It calls the MCP tool `ask_human`. | (ours) |
| 2 | Switchboard searches Notes and contact memory. Nothing. It finds the owner (Daniel) in `CODEOWNERS`. | Notes, Contact memory |
| 3 | Switchboard sends an A2A task to Daniel's agent. It replies `input_required`. | A2A |
| 4 | A Slack task card starts in the team thread and shows each step live. | Slack messages, task cards |
| 5 | Ben does not reply on Slack in 20 s. Switchboard sends an iMessage with 👍 / 👎. No reaction. | Slack webhooks, dedicated iMessage, tapbacks |
| 6 | Ben's phone rings. Voice AI explains the change. | Voice AI outbound call |
| 7 | Ben: "Daniel owns that, get him on." Voice AI adds Daniel (three-way call). | Voice AI add guest |
| 8 | Daniel: "Don't change it. Use the v2 endpoint." Call ends. | Voice AI |
| 9 | `call.ended` webhook. Switchboard extracts the decision. It writes a Note and contact memories. | Webhooks, Notes, Contact memory |
| 10 | Task card completes. Summary in the thread. `ask_human` returns the decision. Claude Code changes its plan. | Slack, (ours) |

### Act 2: the agent remembers (~30 s)

| # | What happens |
|---|---|
| 11 | Claude Code wants to change `billing.ts` again (refund logic). Calls `ask_human`. |
| 12 | Switchboard finds Daniel's decision. Daniel's agent answers over A2A with `completed`. **No human is contacted.** |
| 13 | One line in Slack: "Used Daniel's decision from 2:14 PM (link). Reply if this changed." Claude Code continues. |

Pitch line: *"In Act 1 the agent needed four channels and two humans to get one answer. In Act 2 it needed none."*

---

## 2. Architecture

```
 Claude Code ──stdio──► ask-human MCP ──A2A task──► Switchboard identity
                         (packages/mcp)              │
                         waits on task state         ▼
                                              Switchboard server (apps/switchboard)
                                              ├─ escalation engine (state machine + timers)
                                              ├─ webhook receiver  ◄── Inkbox webhooks
                                              │     (a2a, slack, imessage, phone call.ended)
                                              ├─ ladder steps:
                                              │    0 Notes + memory lookup
                                              │    1 A2A → owner's agent
                                              │    2 Slack thread + task card
                                              │    3 iMessage with tapback
                                              │    4 Voice AI call (+ add guest)
                                              └─ decision writer (Note, memories, Slack, A2A reply)

 Owner agents (apps/owner-agent): one process, one Inkbox identity per human
   (ben-agent, daniel-agent). Receives A2A tasks. Searches Notes. Answers
   `completed` if a decision exists, else `input_required`.
```

### Why the MCP tool talks A2A to Switchboard

It makes the coding agent a real A2A caller with its own Inkbox identity (`claude-coder`). The A2A task state is the progress channel: `working` while escalating, `completed` with the decision. That is one more real A2A use, not a demo trick.

If the A2A client path is slow to get working, the fallback is plain HTTP: `POST /requests` and `GET /requests/:id` on the Switchboard server.

### Stack

- **TypeScript, Node 24**, pnpm workspace.
- **Hono** for the HTTP server (webhooks + fallback API).
- **`@inkbox/sdk`** (need ≥ 0.7.19 for Voice AI connection history; ≥ 0.7.3 for companion APIs).
- **`@modelcontextprotocol/sdk`** for the stdio MCP server.
- **Anthropic SDK** (`claude-sonnet-5-5`) for three jobs only: write the Voice AI `reason`, extract the structured decision from the call package, and judge if a Note answers a question.
- **SQLite** (`better-sqlite3`) for request state, so a restart does not lose a request mid-escalation.
- **Inkbox tunnel** for the public webhook URL (no deploy needed for the demo).

### Repo layout

```
apps/switchboard/      server, escalation engine, webhooks
apps/owner-agent/      A2A receivers for ben-agent, daniel-agent
packages/mcp/          ask-human MCP server for Claude Code
packages/shared/       types, Inkbox client setup, people config loader
config/people.yaml     humans: handle, phone, slack user id, identity, interrupt budget
demo-repo/             tiny app with billing.ts, CODEOWNERS (the thing Claude Code edits)
scripts/               setup scripts (create identities, webhooks, seed contacts)
```

### Core data

```ts
type Request = {
  id: string;
  question: string;          // "Can I change billing.ts to call the old endpoint?"
  context: string;           // diff / reason from the coding agent
  file?: string;             // used for CODEOWNERS lookup
  urgency: "low" | "normal" | "high";
  requester: string;         // A2A handle of the coding agent
  a2aTaskId: string;
  owner: string;             // person handle from CODEOWNERS
  target: string;            // person currently being asked
  step: "lookup" | "owner_agent" | "slack" | "imessage" | "call" | "done";
  slackThreadTs?: string;
  imessageId?: string;
  callId?: string;
  decision?: Decision;
};

type Decision = {
  outcome: "approved" | "blocked" | "redirect";
  instead?: string;          // "use the v2 endpoint"
  decidedBy: string;
  source: { channel: "slack" | "imessage" | "call" | "memory"; ref: string };
};
```

### Interrupt budget (`config/people.yaml`)

```yaml
people:
  ben:
    phone: "+1..."
    slack_user: U...
    agent: ben-agent
    max_step: call          # highest step allowed
    call_only_if: high      # min urgency for a call
    quiet_hours: "23:00-07:00"
  daniel:
    ...
```

The engine never goes above `max_step`, and it skips the call if urgency is below `call_only_if`. This is the "agents need written rules for when to interrupt" story.

---

## 3. Phase 0: setup and spikes (first ~90 min, all three people)

**Do not write the engine until these spikes pass.** Each one is a small script in `scripts/spikes/`. If a spike fails, use its fallback and move on.

| Spike | Pass when | Fallback |
|---|---|---|
| **S1 Voice AI add guest** (highest risk) | A `place_call(mode:"hosted_agent")` to Ben's phone, Ben says "add Daniel", Daniel's phone rings and all three talk. `call.ended` arrives with transcript + action items. | Transfer to Daniel (two calls, no three-way). Or two separate calls. |
| **S2 Slack send + reply webhook** | Agent posts in a channel thread. A human reply in that thread arrives as a webhook. Find how to DM (or just @mention in channel). | @mention in a shared channel. |
| **S3 Slack task card** | Start, append, stop a task stream in a thread. Check `native_task_streaming` capability. | Edit one status message in place. |
| **S4 iMessage tapback** | Agent starts a chat from the dedicated line. A 👍 comes back as `imessage.reaction_received`. | Treat a text reply "yes"/"no" as the answer. |
| **S5 A2A same-org** | `claude-coder` sends a task to `switchboard`; switchboard replies `progress` then `complete`; caller sees state changes. | HTTP fallback API. |

### Setup checklist

- [ ] Admin API key in `.env` as `INKBOX_API_KEY`.
- [ ] **Buy the 250-minute call pack ($7).** The plan has only 30 min per number.
- [ ] Create identities: `switchboard`, `claude-coder`, `ben-agent`, `daniel-agent`. Mint an agent-scoped key for each (A2A clients need the identity's own key).
- [ ] Assign a dedicated phone number to `switchboard` (needed for add guest).
- [ ] Attach the dedicated iMessage number to `switchboard`.
- [ ] Connect `switchboard` to the team Slack workspace. Make `#switchboard-demo`.
- [ ] Create contacts for Ben, Daniel (and Philip as a spare): phone, email, Slack link.
- [ ] Set the Voice AI voice and standing `instructions` on `switchboard`. Set authority mode to `contact_scoped`.
- [ ] Start an Inkbox tunnel to the local server. Subscribe webhooks: A2A, Slack, iMessage, phone.
- [ ] Verify webhook signatures from day one (signing keys doc).
- [ ] Add your own phones to an allow rule where needed (contact rules).

---

## 4. Workstreams (three people in parallel after Phase 0)

| Stream | Owner (suggested) | Scope |
|---|---|---|
| **A: Voice + iMessage** | Ben | Voice AI call builder (`reason` writer, guest instructions, voicemail behavior), `call.ended` handler, decision extraction, iMessage send + tapback handler. |
| **B: Engine + Slack** | Daniel | Request store, escalation state machine with timers, people config + interrupt budget, Slack thread + task card, Slack reply handler, final summary. |
| **C: MCP + A2A + memory** | Philip | `ask_human` MCP server, A2A client + Switchboard A2A receiver, owner agents, Notes + contact memory read/write, demo repo, video. |

Interfaces to agree on in Phase 0 (in `packages/shared`): the `Request` and `Decision` types, and one function per step:

```ts
runStep(req: Request): Promise<void>        // engine calls this
onSignal(req: Request, s: Signal): void     // webhook handlers call this
// Signal = { kind: "reply" | "tapback" | "call_ended" | "a2a_answer", ... }
```

---

## 5. Timeline

Times are Saturday → Sunday. Each phase ends with a **gate**: the listed demo steps work end to end.

| By | Phase | Gate |
|---|---|---|
| Sat ~2:00 PM | **0. Setup + spikes** | S1–S5 pass or have a chosen fallback. |
| Sat ~7:00 PM | **1. Core path** | Steps 1, 4, 6, 7, 8, 10: Claude Code → Slack → call → add Daniel → decision back to Claude Code. **This is the minimum demo.** |
| Sat ~11:30 PM | **2. More channels** | Steps 3 and 5: A2A to owner agent, iMessage tapback, live task card. Full Act 1. |
| Sun ~3:00 AM | **3. Memory** | Steps 2, 9, 11–13: Notes + memory written after the call, Act 2 works with no contact. |
| Sun ~3:00–6:00 AM | **4. Harden** | Restart safety, idempotency keys, clean logs, interrupt budget shown in the demo. Sleep in shifts. |
| Sun 6:00–8:00 AM | **5. Rehearse + record** | 5+ full runs. Record the video by 8:00 AM. |
| Sun 8:00–9:30 AM | **6. Submit** | README, GitHub public, video uploaded, form sent with track **Inkbox**. |

Remember: you cannot re-enter after midnight if you leave.

---

## 6. Cut list (cut from the top if behind)

1. Interrupt budget quiet hours (keep `max_step` only).
2. Slack task card → one status message edited in place.
3. iMessage step → skip straight from Slack to call.
4. A2A between MCP and Switchboard → HTTP fallback (keep A2A to the owner agent; that is the story).
5. Contact memory → Notes only.

**Never cut:** the call with the guest, the decision returning to Claude Code, and Act 2. Those are the demo.

---

## 7. Demo safety

- **Pre-record a backup video** of a clean run. If the live run fails, play it.
- Use **short timeouts** in demo mode (Slack 20 s, iMessage 15 s) via an env var. Keep real values in config.
- Keep a **reset script** that deletes the demo Notes and memories, so Act 1 can run again.
- Keep phones charged, unmuted, and Do Not Disturb off. Test signal in the room.
- Watch call minutes. Each rehearsal uses 2+ calls.
- If Voice AI returns `503 hosted_agent_at_capacity`, retry after a few seconds (build the retry in).

---

## 8. Submission checklist

- [ ] Public GitHub repo with README: one-line pitch, the escalation ladder diagram, Inkbox features used, how to run.
- [ ] Video (2–3 min): problem (15 s), Act 1, Act 2, the ladder + interrupt budget (15 s).
- [ ] Form: GitHub link, video, track = Inkbox.
- [ ] Ask to present live.

---

## 9. Open questions to answer in Phase 0

- How to open a Slack DM through Inkbox (`direct_messages_open` capability exists; endpoint not documented).
- Exact task stream (task card) API calls.
- Whether Voice AI reliably adds the guest from the `reason` alone, and what it says to the guest.
- How fast `call.ended` arrives after hangup.
- Whether a same-org A2A call needs any setting turned on (receiver enable) for each identity.
