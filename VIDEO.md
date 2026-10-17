# Milo: 1-Minute Demo Video

Goal: in 60 seconds, a judge understands the problem, sees Milo get a real human answer across real channels, and sees Milo remember it. Record by **Sun 8:00 AM**.

## The one idea the video must land

> Agents get stuck waiting on humans. Milo gets the answer: it asks your agent first, then Slack, iMessage, and a phone call, and it remembers every answer so it interrupts you less next time.

Everything that does not serve that sentence gets cut.

---

## Script (60 s)

| Time | Picture | Voice-over / on-screen text |
|---|---|---|
| **0:00–0:06** | Black screen, white text, one line at a time. Then a Slack ping sound. | "Your agent is blocked." / "It needs a human." / "The human is busy." |
| **0:06–0:12** | Screen recording: Claude Code in a terminal. It wants to edit `billing.ts` and calls `ask_human`. | VO: "Claude wants to change billing code. It doesn't guess. It asks Milo." |
| **0:12–0:20** | Split screen. Left: Slack thread with Milo's live status card ticking: *Checked notes → Asked Daniel's agent → Messaging Ben*. Right: a phone with an iMessage from Milo: "👍 approve / 👎 block". | VO: "Milo asks Daniel's agent first. No answer. It tries Slack. Then iMessage." |
| **0:20–0:34** | Real phone on a table rings. Caller: **Milo** with the owl avatar. Ben answers on speaker. Subtitles of the call. Ben: "Daniel owns that, get him on." Second phone rings. Daniel: "Don't change it. Use the v2 endpoint." | VO is silent. Let the real call play. Subtitles carry it. |
| **0:34–0:42** | Back to the screen: Slack card turns green, summary posted. Terminal: `ask_human` returns `{decision: "blocked", instead: "use v2", decided_by: "Daniel"}`. Claude rewrites its plan. | VO: "Decision returned to the agent. Logged in Slack. Saved to memory." |
| **0:42–0:52** | **Act 2.** Claude asks about `billing.ts` again. Slack status card: *Found Daniel's decision from 2:14 PM*. Card turns green in about 2 seconds. Both phones stay dark. | VO: "Next time, Milo already knows. Nobody's phone rings." |
| **0:52–1:00** | Owl logo + "Milo" + one line. Small "Built on Inkbox" with the Inkbox logo. Team names. | Text: "Milo: the human response layer for agents." VO: "Built on Inkbox: A2A, Slack, iMessage, Voice AI, contact memory." |

Word count of the voice-over: about 75 words. That fits 60 seconds with room for the real call audio.

---

## Shots to capture (shot list)

1. **Terminal**: Claude Code calling `ask_human`. Large font (18+ pt), dark theme, clean prompt.
2. **Slack**: the `#milo-demo` channel in the buzzle workspace, Milo's status card updating live. Zoom the window so text is readable on a phone screen.
3. **iMessage**: a phone screen recording (Control Center → Screen Recording) when Milo's message arrives.
4. **Phone call, wide shot**: two phones on a table, filmed from above. Ringing screen with "Milo" and the owl avatar must be visible.
5. **Phone call audio**: put the phones on speaker, record room audio with a third phone or laptop mic close to them. Also keep the Inkbox transcript to build subtitles.
6. **Return screen**: terminal shows the JSON decision; Slack shows the summary.
7. **Act 2**: same terminal + Slack, phones in frame and silent.
8. **End card**: owl logo (`milo-owl-transparent.png`), Inkbox wordmark.

Record each shot separately, several takes. Edit together. Do not try to get the full minute in one take.

---

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
