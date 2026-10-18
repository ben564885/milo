# Milo: 1-Minute Demo Video

Goal: in about a minute, a judge sees an agent ask permission to pay and ask for a decision, and sees Milo get real human answers across real channels. Record by **Sun 8:00 AM**.

## Final script (from the team voice memo, Sat night)

Pitch line: **"Milo is the persistent permission layer for agents."** Target: about 2 minutes.

### Scene 1: the problem (already filmed, no Milo)
- Ben types in Claude Code (`~/lumen-no-milo`, started with `claude --strict-mcp-config`): **"add a pricing tier for our customers' dogs"**.
- Ben gets up and walks out of the booth. Claude's question appears on screen to an empty chair.
- Text: "Your agent has a question. You're not here."

### Scene 2: the same question, with Milo
1. **Terminal, zoomed in:** the same prompt in `yc-demo-site`. Claude calls Milo (`ask_human`). Hold on the tool call for one beat.
2. **Laptop, Slack notification:** Milo asks Ben in #milo-demo. Nobody answers. (Optional: Ben's Slack status goes from active to away. Milo does not read presence; it waits about 20 s. Show it as a picture, do not claim it in the VO.)
3. **Phone on the table:** the iMessage from Milo lights up the lock screen. Ben is clearly visible far away, in a conversation.
4. **The ringtone.** Ben looks up, runs over, sits down, picks up.
5. **The call** (cut the latency in the edit): "Hey Ben, this is Milo…" Milo asks the dog-tier question with its options. Ben picks one (the funniest: "free with a belly rub"). "Bye." Milo hangs up.
6. **Title cards:** "We built Milo so you can answer your agent from here," (the desk) "here," (a spontaneous spot) "or here." (the toilet).
7. **Slack thread:** the decision, the **call recording**, and the **transcript link**. The site updates with the dog tier.

### Scene 3: the agent wants to pay (x402)
1. **Terminal:** **"add live weather data to the landing page"**. Claude calls `paid_fetch`; the weather API answers HTTP 402, $0.01 USDC.
2. **Slack:** Milo asks: approve once, always approve, or deny? Ben, now at his desk, replies **"always approve"**.
3. **Slack thread:** paid, who approved it, and the **transaction link**. Quick cut to the Basescan page. The site shows the live weather.
4. **Text: "One day later."** A new chat, the same prompt. Claude pays right away: no Slack question, no text, no call. The one daily Slack line counts up. Text: "Milo remembers."

### Scene 4: close
- Owl logo. VO / text: **"Milo is the persistent permission layer for agents."**
- "Built on Inkbox: Slack, iMessage, phone, A2A, contact memory."
- "We hope to demo it for you this afternoon. Thank you." Team names.

### Notes for the shoot
- Phone: notifications must show on the **lock screen** (Settings > Notifications > Show Previews: Always), and the ringer must be on.
- Save Milo as a contact first (`~/Downloads/Milo.vcf`) so the call shows "Milo" and the owl.
- Reset before scene 2: `curl -X POST localhost:8787/api/reset`. Do **not** reset between scene 3 and "one day later", or Milo asks again.
- Scene 2 must reach the call: do not answer in Slack or by text.

---

## The one idea the video must land

> Agents get stuck waiting on humans: for decisions, and for permission to spend money. Milo is the permission layer: approve, deny, or always approve, from Slack, iMessage or a phone call. Most agent payments are fractions of a cent, so "always approve" lets the agent keep working while every payment is logged in Slack.

Everything that does not serve that sentence gets cut.

---

## Setup before recording

- `pnpm milo` and `pnpm owners` run in `yc-hack-oct`. `/api/status` on :8787 is ok.
- A **new** Claude Code chat in `yc-demo-site` (it must have the `paid_fetch` tool).
- Slack `#milo-demo` open and zoomed. Ben's and Philip's phones on the table, sound on.
- Payer wallet has test USDC (`pnpm tsx scripts/wallet.ts`). The Lumen API costs $0.01 per call on Base Sepolia.
- After every rehearsal, reset: `curl -X POST localhost:8787/api/reset`. It clears payment approvals and saved decisions. Without it, Milo pays prompt 1 without asking and answers prompt 2 from memory, so nobody gets a call.
- Ben is the first contact and the payment approver. `index.html` is owned by Philip (`.github/CODEOWNERS`).

## Prompt 1: the agent wants to pay (answered in Slack)

Prompt in Claude Code: **"add a small live weather line under the hero using our forecast api"**

1. Claude Code calls `paid_fetch` on `https://yc-demo-site.vercel.app/api/forecast`. The API answers **402: $0.01 USDC**.
2. Milo posts in Slack: claude code wants to pay $0.01 for the weather api, approve once, always approve, or deny?
3. **Ben replies in the Slack thread: "always approve"**. (Answer within 20 s, before Milo texts.)
4. Milo pays. Slack thread: paid, who approved it, today's budget, and the **Basescan transaction link**.
5. Claude Code adds the weather line and deploys. Show the live site.
6. Optional, 3 seconds: "refresh the weather". Milo pays on the standing approval with no ping; the one daily Slack line goes from "once" to "2 times today". This is the shot that sells always approve.

On-screen labels: "HTTP 402", "x402 / USDC on Base", "Slack", "always approve", "Basescan".

## Prompt 2: the agent needs a decision (group call)

Prompt in Claude Code: a normal site change that leaves a real choice open, e.g. **"make the pricing section stand out more"** (Claude asks one question with three options, per `yc-demo-site/CLAUDE.md`).

1. Claude Code calls `ask_human`. Milo checks memory and asks Philip's agent over A2A (it has no answer).
2. Slack: "hey @ben, quick one from claude code: …". **Do not answer.**
3. iMessage on Ben's phone: "yo", then the question. **Do not answer.**
4. Ben's phone rings: Milo. Ben: **"Philip owns the site, can you add him?"**
5. Philip's phone rings and he joins the same call. Milo sums it up. **Philip picks an option** (or something else). Say "bye"; Milo hangs up.
6. Slack thread: the decision, the transcript link and the call recording. iMessage: "taken care of over the phone".
7. Claude Code applies Philip's choice and deploys. Show the live site.

On-screen labels: "A2A", "Slack", "iMessage", "Phone", "+ guest on the same call", "Contact memory".

## Script (about 75 s, cut to fit)

| Time | Picture | Voice-over / on-screen text |
|---|---|---|
| 0:00–0:05 | Black screen, white text. | "Agents need humans: for decisions, and for money." |
| 0:05–0:12 | Claude Code: prompt 1, `paid_fetch`, the 402. | "Claude wants to pay one cent for live weather. It can't just pay. It asks Milo." |
| 0:12–0:22 | Slack: Milo's ask, Ben types "always approve", the paid line with the Basescan link. | "Approve once, always, or deny. Ben says always." |
| 0:22–0:28 | Basescan transaction, then the live site with the weather line. Optional: refresh, the daily line ticks to 2. | "A real onchain USDC transfer on Base. Next time, it just pays, and logs it." |
| 0:28–0:35 | Claude Code: prompt 2, `ask_human`. Slack ask, iMessage on the phone, nobody answers. | "Now a design question. Slack, then a text." |
| 0:35–0:55 | Two phones on the table. Ben picks up, asks to add Philip. Philip joins and decides. Subtitles. | VO silent. Let the call play. |
| 0:55–1:05 | Slack thread: decision, transcript, recording. iMessage "taken care of over the phone". Site updates. | "The decision goes back to the agent, and Milo remembers it." |
| 1:05–1:12 | Owl logo, "Milo", "Built on Inkbox". Team names. | "Milo: the permission layer for agents." |

---

## Shots to capture (shot list)

1. **Terminal**: both prompts, `paid_fetch` and `ask_human` calls. Large font (18+ pt), dark theme.
2. **Slack**: prompt 1 thread (ask, Ben's reply, paid line with link), prompt 2 thread (ask, texted, calling, decision, transcript, recording).
3. **Basescan**: the transaction page for prompt 1.
4. **iMessage**: Ben's phone screen recording when Milo texts.
5. **Phone call, wide shot**: both phones on a table, "Milo" with the owl avatar on the ringing screen. Room audio close to the phones.
6. **Live site**: before and after each prompt (https://yc-demo-site.vercel.app).
7. **End card**: owl logo (`milo-owl-transparent.png`), Inkbox wordmark.

Record each prompt separately, several takes. Edit together.

## Three possible formats (choose one)

**A. Story with a real call (recommended).** The script above. The live phone ringing is the moment people remember. It also proves that this is real, not a mock.

**B. "Day in the life" comparison.** First 10 seconds: an engineer in 2019 who pings on Slack, waits, then calls a teammate. Then: "Agents can't do this. Now they can." Then the same flow with Milo. Stronger story, but costs about 15 seconds of the minute.

**C. Pure screen recording.** One screen with four panels (terminal, Slack, iMessage mirror, call transcript live). Easiest to film, but loses the physical phone moment. Use it only as the backup if the phones are unreliable.

---

## Production tips

- **Captions on everything.** Judges often watch with sound off.
- **Speed up the waiting.** Show "20 s later" text and cut the dead time; never show a spinner for more than 1 second.
- **Big text.** Every screen element must be readable on a laptop at 50% size.
- **Real names, real phones.** It is more convincing than any animation.
- **Music:** quiet, upbeat, no lyrics. Drop it to silence under the phone call.
- **Highlight Inkbox features on screen** as small labels when they happen ("A2A", "Slack", "iMessage tapback", "Voice AI + guest", "Contact memory"). This is the Inkbox track; make the judges count the channels.
- **Tools:** Screen Studio or QuickTime for screen capture, phone screen recording for iMessage, CapCut or iMovie to edit.
- **Backup:** record one clean full run early (Saturday night) even if rough, so there is always something to submit.

## Owners and timing

| Task | When |
|---|---|
| Rough full run recorded (backup) | Sat ~11:30 PM, after Phase 2 |
| Final shots | Sun 6:00–7:30 AM |
| Edit + captions | Sun 7:30–8:30 AM |
| Upload + link in submission | By Sun 9:30 AM |
