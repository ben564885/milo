import { randomUUID } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { callBrief, DEMO, extractDecision, loadIdentities, ownerOf, type AskPayload, type Decision, type People, type Person, type Step } from "@milo/shared";
import * as ch from "./channels.ts";
import { startConference } from "./conference.ts";
import { findDecision, memoriesFor, recordDecision, remember } from "./memory.ts";
import { allowed, resolvePeople } from "./people.ts";
import { clear, emit, waitFor, type Signal } from "./signals.ts";
import { list, save, type Request } from "./store.ts";

const LISTEN_AFTER = Number(process.env.MILO_LISTEN_AFTER_MS ?? 20 * 60_000);
const T = {
  ownerAgent: Number(process.env.MILO_T_OWNER_AGENT ?? 12_000),
  slack: Number(process.env.MILO_T_SLACK ?? (DEMO ? 20_000 : 10 * 60_000)),
  imessage: Number(process.env.MILO_T_IMESSAGE ?? (DEMO ? 15_000 : 10 * 60_000)),
  call: Number(process.env.MILO_T_CALL ?? 6 * 60_000),
};
const FIRST_CONTACT = process.env.MILO_FIRST_CONTACT ?? "ben";

const ICON: Record<string, string> = { lookup: "🗂️", owner_agent: "🤖", slack: "💬", imessage: "📱", call: "📞", done: "✅", info: "•" };

/** End older requests that are still waiting on the same thing, so they don't post stale messages later. */
function supersedeOlder(r: Request) {
  for (const old of list(50)) {
    if (old.id === r.id || old.status !== "running") continue;
    const same = r.file ? old.file === r.file : old.question.trim().toLowerCase() === r.question.trim().toLowerCase();
    if (!same) continue;
    old.superseded = true;
    save(old);
    emit(old.id, { kind: "cancel" });
  }
}

export function newRequest(p: AskPayload & { a2aTaskId?: string }): Request {
  const r: Request = {
    id: randomUUID().slice(0, 8),
    question: p.question,
    context: p.context ?? "",
    file: p.file,
    urgency: p.urgency ?? "normal",
    requester: p.requester ?? "an agent",
    a2aTaskId: p.a2aTaskId,
    owner: p.owner,
    options: p.options?.length ? p.options : undefined,
    step: "lookup",
    status: "running",
    log: [],
    createdAt: new Date().toISOString(),
  };
  save(r);
  supersedeOlder(r);
  return r;
}

// Milo talks in Slack like a teammate: the first message starts a thread, later ones reply in it, in order.
const threadChains = new Map<string, Promise<unknown>>();
const a2aChains = new Map<string, Promise<unknown>>();
function say(r: Request, text: string, file?: { path: string; comment: string }): Promise<unknown> {
  if (!r.slack) return Promise.resolve();
  const slack = r.slack;
  const prev = threadChains.get(r.id) ?? Promise.resolve();
  const next = prev.then(async (): Promise<unknown> => {
    if (!slack.threadTs) {
      slack.threadTs = await ch.slackPost(text);
      save(r);
      if (file && slack.threadTs) await ch.slackUpload(file.path, slack.threadTs, file.comment);
      return;
    }
    return file ? ch.slackUpload(file.path, slack.threadTs, file.comment) : ch.slackPost(text, slack.threadTs);
  }).catch((e) => console.warn("[slack]", e.message));
  threadChains.set(r.id, next);
  return next;
}
const lc = (s: string) => s.toLowerCase();
const isSuperseded = (r: Request) => r.superseded || Boolean(list(50).find((x) => x.id === r.id)?.superseded);
const orList = (o: string[]) => (o.length < 3 ? o.join(" or ") : `${o.slice(0, -1).join(", ")}, or ${o.at(-1)}`);
/** The question as a person would ask it, with the options for a choice question. */
const asked = (r: Request) => (r.options?.length ? `${r.question.replace(/\?\s*$/, "")}? ${orList(r.options)}?` : r.question);
const shortFile = (r: Request) => (r.file ? r.file.split("/").pop()! : "this");

/** A permanent link to a call transcript page; the transcript is compressed into the URL itself. */
function transcriptLink(data: Record<string, unknown>): string {
  const packed = deflateRawSync(Buffer.from(JSON.stringify(data))).toString("base64url");
  return `${process.env.MILO_TRANSCRIPT_BASE ?? "https://milo-calls.vercel.app/t"}#${packed}`;
}

async function log(r: Request, step: Request["log"][number]["step"], text: string, ok?: boolean) {
  r.log.push({ at: new Date().toISOString(), step, text, ok });
  save(r);
  console.log(`[${r.id}] ${ICON[step] ?? ""} ${text}`);
  if (r.a2aTaskId && r.status === "running") {
    const taskId = r.a2aTaskId;
    const prev = a2aChains.get(r.id) ?? Promise.resolve();
    a2aChains.set(r.id, prev.then(() => ch.a2aProgress(taskId, text)));
  }
}

function decision(partial: Omit<Decision, "at">): Decision {
  return { ...partial, at: new Date().toISOString() };
}

export async function run(r: Request): Promise<Decision> {
  const people = await resolvePeople();
  const avail = await ch.availability().catch(() => ({ slack: false, imessage: false, phone: false, phoneNumber: undefined }));
  const ownerHandle = (r.owner && people[r.owner] ? r.owner : undefined) ?? ownerOf(r.file);
  const owner: Person | undefined = ownerHandle ? people[ownerHandle] : undefined;
  const target: Person | undefined = people[FIRST_CONTACT] ?? owner;
  r.owner = owner?.handle;
  r.target = target?.handle;
  const names = Object.values(people).map((p) => p.name);

  if (avail.slack) {
    r.slack = { connectionId: loadIdentities().slack!.connectionId, channel: loadIdentities().slack!.channelId };
  }

  let d: Decision | undefined;
  try {
    d = await ladder(r, people, owner, target, names, avail);
    const next = redirectTarget(d, people, target);
    if (next) {
      await log(r, "info", `${target?.name ?? "they"} said to ask ${next.name}`);
      r.target = next.handle; save(r);
      const from = target?.name ?? "They";
      r.context = `${r.context}\n${from} said ${next.name} owns this and should decide.`.trim();
      // A redirect said on a phone call goes straight to a phone call with the named person.
      d = await reach(r, people, next, owner, names, avail, d?.source.channel === "call" ? "call" : undefined)
        ?? decision({ outcome: "no_answer", answer: `${from} said ${next.name} decides, and ${next.name} has not answered yet.`, instead: `Ask ${next.name}`, source: { channel: "none" } });
    }
  } catch (err) {
    console.error(`[${r.id}] engine error`, err);
    await log(r, "info", `error: ${(err as Error).message}`, false);
  }
  // Nobody decided yet: keep listening on Slack and text instead of forgetting the question.
  if ((!d || d.outcome === "no_answer") && LISTEN_AFTER > 0 && (r.slack?.threadTs || r.imessageId) && !isSuperseded(r)) {
    const who = people[r.target ?? ""] ?? target;
    r.listening = true; r.step = "imessage"; save(r);
    await log(r, "info", `still listening on slack and text for ${Math.round(LISTEN_AFTER / 60_000)} min`);
    if (r.slack?.threadTs) void say(r, "couldn't reach anyone yet, i'll keep an eye on this thread");
    const late = who ? await awaitHuman(r, LISTEN_AFTER, names, who) : undefined;
    if (late) d = late;
  }
  d ??= decision({ outcome: "no_answer", answer: "No human answered in time.", source: { channel: "none" } });
  await finish(r, d, people, owner, target);
  return d;
}

async function ladder(r: Request, people: People, owner: Person | undefined, target: Person | undefined, names: string[], avail: Awaited<ReturnType<typeof ch.availability>>): Promise<Decision | undefined> {
  // 0. Already decided?
  r.step = "lookup"; save(r);
  const found = await findDecision(r.question, r.file);
  if (found) {
    const outcome = /Outcome: (\w+)/.exec(found.body)?.[1] as Decision["outcome"] | undefined;
    const by = /Decided by: (.+)/.exec(found.body)?.[1];
    const at = /At: (.+)/.exec(found.body)?.[1];
    const answer = /Answer: (.+)/.exec(found.body)?.[1] ?? found.title;
    const instead = /Instead: (.+)/.exec(found.body)?.[1];
    const choice = /Choice: (.+)/.exec(found.body)?.[1];
    const when = at ? new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "earlier";
    await log(r, "lookup", `${by ?? "someone"} already decided this at ${when}, no need to bug anyone`);
    return decision({ outcome: outcome ?? "approved", answer, instead, choice, decidedBy: by, source: { channel: "memory", ref: found.noteId } });
  }
  await log(r, "lookup", "checked past decisions, nothing on this yet");

  // 1. Ask the owner's agent over A2A.
  if (owner?.agent) {
    r.step = "owner_agent"; save(r);
    await log(r, "owner_agent", `asking ${owner.name}'s agent first`);
    const res = await ch.askOwnerAgent(owner.agent, JSON.stringify({ question: r.question, file: r.file, requester: r.requester }), T.ownerAgent).catch((e) => ({ state: "error", text: e.message, data: undefined }));
    if (/COMPLETED/.test(res.state) && res.data?.outcome) {
      await log(r, "owner_agent", `${owner.name}'s agent knew: ${res.data.answer ?? res.text}`);
      return decision({ outcome: res.data.outcome, answer: res.data.answer ?? res.text ?? "", instead: res.data.instead, decidedBy: res.data.decidedBy ?? `${owner.name}'s agent`, source: { channel: "owner_agent", ref: owner.agent } });
    }
    await log(r, "owner_agent", `${owner.name}'s agent said: "${(res.text ?? "no answer").toLowerCase()}"`, false);
    await log(r, "owner_agent", `no recorded decision, so a person has to decide`);
  }

  return reach(r, people, target, owner, names, avail);
}

async function reach(r: Request, people: People, target: Person | undefined, owner: Person | undefined, names: string[], avail: Awaited<ReturnType<typeof ch.availability>>, startAt?: "call"): Promise<Decision | undefined> {
  if (startAt === "call") avail = { ...avail, slack: false, imessage: false };
  // 2. Slack
  const humanQ = `${r.requester} wants to know: “${r.question}”${r.file ? ` (\`${r.file}\`)` : ""}`;
  if (avail.slack && allowed("slack", target, r.urgency).ok) {
    r.step = "slack"; save(r);
    let q = asked(r).trim();
    q = q.charAt(0).toLowerCase() + q.slice(1);
    await say(r, `hey ${ch.mention(target)}, quick one from ${lc(r.requester)}: ${lc(q)}`);
    await log(r, "slack", `waiting ${Math.round(T.slack / 1000)}s for ${target!.name} to answer here`);
    const d = await awaitHuman(r, T.slack, names, target!);
    if (d) return d;
    await log(r, "slack", r.replied ? `no clear answer from ${target!.name} here` : `nothing from ${target!.name} here`, false);
  } else if (!avail.slack) {
    await log(r, "info", "slack isn't connected, skipping it");
  }

  // 3. iMessage
  const im = allowed("imessage", target, r.urgency);
  if (avail.imessage && target?.phone && im.ok) {
    r.step = "imessage"; save(r);
    // Inkbox blocks links in a first iMessage, and "billing.ts" looks like a domain. Break the dots.
    const noLinks = (s: string) => s.replace(/`/g, "").replace(/\(?[\w./-]*?([\w-]+)\.[a-z]{1,5}\b\)?/gi, "the $1 file").replace(/https?:\S+/g, "");
    // Two casual texts: "yo", then the question. Before a person's first reply, each must be under 160 characters.
    let q = noLinks(asked(r)).trim();
    q = q.charAt(0).toLowerCase() + q.slice(1);
    if (q.length > 155) q = q.slice(0, 154).trimEnd() + "…";
    const sent = await ch.imessageSend(target.phone, "yo")
      .then(() => ch.imessageSend(target.phone!, q))
      .catch(async (e) => {
        await log(r, "imessage", `couldn't text: ${e.detail?.message ?? e.message}`, false);
        return undefined;
      });
    if (sent) {
      r.imessageId = sent.id; r.imessageConversationId = sent.conversationId; save(r);
      if (r.slack?.threadTs) void say(r, `${ch.mention(target)} texted you too`);
      await log(r, "imessage", `texted ${target.name}: "yo" then "${q}". waiting ${Math.round(T.imessage / 1000)}s`);
      const d = await awaitHuman(r, T.imessage, names, target);
      if (d) return d;
      await log(r, "imessage", `no answer from ${target.name} over text`, false);
    }
  } else if (!im.ok) {
    await log(r, "imessage", `not texting: ${im.why}`, false);
  }

  // 4. Phone call with Voice AI (+ owner as guest)
  const away = (process.env.MILO_UNAVAILABLE ?? "").split(",").map((s) => s.trim());
  const call = target && away.includes(target.handle) ? { ok: false, why: `${target.name} is marked unavailable` } : allowed("call", target, r.urgency);
  if (avail.phone && target?.phone && call.ok) {
    r.step = "call"; save(r);
    // Default: our own conference bridge (Inkbox media streams + OpenAI Realtime), so guests are heard.
    // MILO_CALL_ENGINE=hosted uses Inkbox Voice AI instead.
    if ((process.env.MILO_CALL_ENGINE ?? "bridge") === "bridge") {
      const away = (process.env.MILO_UNAVAILABLE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const short = r.file ? `the ${r.file.split("/").pop()!.replace(/\.\w+$/, "")} code` : "this change";
      const referredBy = /(\w+) said (\w+) owns this/.exec(r.context)?.[1];
      await log(r, "call", `calling ${target.name}`);
      if (r.slack?.threadTs) void say(r, `${ch.mention(target)} calling you`);
      const conf = startConference({
        question: asked(r), options: r.options, context: r.context.replace(/\n?\w+ said \w+ owns this and should decide\./, "").trim(), requester: r.requester,
        shortName: short, target, people, away, referredBy,
        onEvent: (text, ok) => {
          void log(r, "call", text, ok);
          const adding = /^adding (\w+) to the call/.exec(text)?.[1];
          const guest = adding && Object.values(people).find((p) => p.name.toLowerCase() === adding.toLowerCase());
          if (guest && r.slack?.threadTs) void say(r, `pulling in ${ch.mention(guest)}`);
        },
      });
      // Keep listening on Slack and text during the call; a clear answer there ends the call.
      let callDone = false;
      const other = (async () => {
        while (!callDone) {
          const sig = await waitFor(r.id, 1000);
          if (!sig || sig.kind === "call_ended") continue;
          const d = await interpret(r, sig, names, target);
          if (d) return d;
        }
        return undefined;
      })();
      const first = await Promise.race([
        conf.result.then((res) => ({ res, early: undefined as Decision | undefined })),
        other.then((early) => ({ res: undefined, early })),
      ]).catch(async (e) => { await log(r, "call", `call didn't go through: ${e.message}`, false); return { res: undefined, early: undefined }; });
      if (first.early) {
        await log(r, "call", `${first.early.decidedBy ?? target.name} answered on ${first.early.source.channel}, hanging up`);
        conf.abort();
        const res = await conf.result.catch(() => undefined);
        callDone = true;
        if (res) { r.call = { transcript: res.transcript, recordingPath: res.recordingPath, seconds: res.seconds, joined: res.joined }; save(r); }
        return first.early;
      }
      const res = first.res;
      callDone = true;
      await other.catch(() => undefined);
      if (!res) return undefined;
      await log(r, "call", `call ended after ${res.seconds}s${res.joined.length ? ` with ${res.joined.join(" and ")}` : ""}`);
      r.call = { transcript: res.transcript, recordingPath: res.recordingPath, seconds: res.seconds, joined: res.joined };
      save(r);
      if (!res.connected && !res.decision) { await log(r, "call", `${target.name} didn't pick up`, false); return undefined; }
      if (res.decision) return decision({ ...res.decision, source: { channel: "call", ref: res.joined.join(", ") } });
      const x = await extractDecision(r.question, res.transcript, names, r.options);
      await log(r, "call", "call ended");
      if (x.outcome !== "no_answer") return decision({ ...x, instead: x.instead || undefined, decidedBy: x.decidedBy || target.name, source: { channel: "call" } });
      return undefined;
    }
    const reason = await buildCallReason(r, target, owner, people);
    const callId = await ch.placeHostedCall(target.phone, reason, `Hi ${target.name}, it's Milo. ${r.requester} is blocked on a quick decision about the ${r.file ? r.file.split("/").pop()!.replace(/\.\w+$/, "") + " file" : "change"}. ${avail.imessage ? "I sent you an iMessage, just react with a thumbs up or down. " : ""}Or call me back at this number.`)
      .catch(async (e) => { await log(r, "call", `Call failed: ${e.detail?.message ?? e.message}`, false); return undefined; });
    if (!callId) return undefined;
    r.callId = callId; save(r);
    await log(r, "call", `calling ${target.name}`);
    const deadline = Date.now() + T.call;
    while (Date.now() < deadline) {
      const sig = await waitFor(r.id, deadline - Date.now());
      if (!sig) break;
      if (sig.kind === "call_ended") {
        if (sig.callId !== callId) continue;
        const transcript = sig.transcript + (sig.actionItems.length ? `\n\nAction items:\n${sig.actionItems.join("\n")}` : "");
        await log(r, "call", sig.hangup === "voicemail" ? `${target.name} didn't pick up. Left a voicemail.` : `Call ended (${sig.outcome ?? "completed"}).`, sig.hangup === "voicemail" ? false : undefined);
        if (sig.hangup === "voicemail" || !sig.transcript.trim()) return undefined;
        const x = await extractDecision(r.question, transcript, names, r.options);
        if (x.outcome !== "no_answer") return decision({ ...x, instead: x.instead || undefined, decidedBy: x.decidedBy || target.name, source: { channel: "call", ref: callId } });
        return undefined;
      }
      // A late iMessage/Slack answer during the call still counts.
      const late = await interpret(r, sig, names, target);
      if (late) return late;
    }
    await log(r, "call", "call ran too long", false);
  } else if (!avail.phone) {
    await log(r, "info", "no phone number yet, skipping the call");
  } else if (!call.ok) {
    await log(r, "call", `not calling: ${call.why}`, false);
  }
  return undefined;
}

function redirectTarget(d: Decision | undefined, people: People, from?: Person): Person | undefined {
  if (!d || (d.outcome !== "redirect" && d.outcome !== "no_answer")) return undefined;
  const away = (process.env.MILO_UNAVAILABLE ?? "").split(",").map((s) => s.trim());
  const text = `${d.instead ?? ""} ${d.answer}`.toLowerCase();
  return Object.values(people).find((p) => p.handle !== from?.handle && !away.includes(p.handle) && p.name.toLowerCase() !== (d.decidedBy ?? "").toLowerCase() && new RegExp(`\\b${p.name.toLowerCase()}\\b`).test(text));
}

async function awaitHuman(r: Request, ms: number, names: string[], who: Person): Promise<Decision | undefined> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const sig: Signal | undefined = await waitFor(r.id, deadline - Date.now());
    if (sig?.kind === "cancel") { r.superseded = true; save(r); return undefined; }
    if (!sig) return undefined;
    const d = await interpret(r, sig, names, who);
    if (d) return d;
  }
  return undefined;
}

async function interpret(r: Request, sig: Signal, names: string[], who: Person): Promise<Decision | undefined> {
  if (sig.kind === "imessage_tapback" && r.options?.length) return undefined;
  if (sig.kind === "imessage_tapback") {
    const up = ["like", "love", "emphasize"].includes(sig.reaction) || sig.emoji === "👍";
    const down = sig.reaction === "dislike" || sig.emoji === "👎";
    if (!up && !down) return undefined;
    await log(r, "imessage", `${who.name} ${up ? "gave it a thumbs up" : "gave it a thumbs down"}`);
    return decision({ outcome: up ? "approved" : "blocked", answer: up ? "Approved with a 👍 on iMessage." : "Blocked with a 👎 on iMessage.", decidedBy: who.name, source: { channel: "imessage", ref: r.imessageId } });
  }
  if (sig.kind === "slack_reply" || sig.kind === "imessage_reply") {
    const channel = sig.kind === "slack_reply" ? "slack" : "imessage";
    const by = (sig.kind === "slack_reply" ? sig.userName : undefined) ?? who.name;
    const x = await extractDecision(r.question, sig.text, names, r.options);
    r.replied = true;
    await log(r, channel, `${by} said "${sig.text.slice(0, 120)}"`);
    if (x.outcome === "no_answer" && !/^ask\b/i.test(x.instead ?? "")) await log(r, channel, `not a clear yes or no, still listening`, false);
    if (x.outcome !== "no_answer") return decision({ ...x, instead: x.instead || undefined, decidedBy: x.decidedBy || by, source: { channel, ref: r.slack?.threadTs ?? r.imessageId } });
  }
  return undefined;
}

async function buildCallReason(r: Request, target: Person, owner?: Person, people?: People): Promise<string> {
  const memories = [...(await memoriesFor(target)), ...(await memoriesFor(owner))].slice(0, 6);
  const brief = await callBrief({ person: target.name, requester: r.requester, question: r.question, context: r.context, owner: owner?.name, ownerPhone: owner?.phone, memories });
  // MILO_UNAVAILABLE=daniel,philip keeps people off calls (no guest invites) while they are away.
  const away = (process.env.MILO_UNAVAILABLE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const roster = Object.values(people ?? {}).filter((p) => p.handle !== target.handle && p.phone && !away.includes(p.handle));
  const unavailable = Object.values(people ?? {}).filter((p) => away.includes(p.handle)).map((p) => p.name);
  // Guests are on by default (three-way call). MILO_GUESTS=0 switches to calling that person in a separate call instead.
  const guestsOn = process.env.MILO_GUESTS !== "0";
  const handoff = roster.length && !guestsOn
    ? `\nIf ${target.name} says someone else decides, ask who, tell ${target.name} you will call that person right after this call, record "REDIRECT: <name>" as a post-call action item, and end the call politely. Do not add anyone to this call. People you can reach: ${roster.map((p) => p.name).join(", ")}.${unavailable.length ? ` ${unavailable.join(" and ")} cannot be reached right now; say so if asked.` : ""}`
    : "";
  const guest = roster.length && guestsOn
    ? `\nIf ${target.name} asks you to bring someone in, add that person to this call as a guest. As soon as they join, greet them by name in the first person ("Hey Philip, this is Milo."), give a two-sentence summary, and ask them for the decision. If anyone on the call asks you to explain or repeat, do it right away. Never stay silent waiting for someone. You may add only these people: ${roster.map((p) => `${p.name} at ${p.phone}`).join(", ")}.${owner && roster.includes(owner) ? ` ${owner.name} owns ${r.file ? `the ${r.file.split("/").pop()!.replace(/\.\w+$/, "")} code` : "this code"}.` : ""} Never read file paths or extensions aloud; say "the billing code".${unavailable.length ? ` ${unavailable.join(" and ")} cannot be reached right now; say so if asked.` : ""}`
    : "";
  const short = r.file ? `the ${r.file.split("/").pop()!.replace(/\.\w+$/, "")} code` : "this change";
  const referredBy = /(\w+) said (\w+) owns this/.exec(r.context);
  const opening = referredBy
    ? `Hey ${target.name}, this is Milo. ${referredBy[1]} said you own ${short}, so I wanted to get a quick decision from you.`
    : `Hey ${target.name}, this is Milo.`;
  const text = [
    `You are Milo. You get quick decisions from people for blocked coding agents. You are calling ${target.name}, a teammate.`,
    `Start the call with exactly: "${opening}" Then ask the question in one or two short sentences.`,
    `Always speak in the first person ("I"). Never refer to yourself as "Milo" in the third person, and never say "Milo said" or "Milo is calling".`,
    `Do not say you are an AI unless someone asks; if asked, answer honestly.`,
    `If ${target.name} sounds confused or talks first, calmly say who you are and why you are calling again, then ask the question. Never say you called by mistake.`,
    brief,
    memories.length ? `What you know about these people: ${memories.join(" | ")}` : "",
    guest,
    handoff,
    `Goal: get a clear decision (approve, block, or what to do instead) and who decided. Confirm it back in one sentence, record it as a post-call action item starting with "DECISION:", then end the call politely. Keep the call under 2 minutes.`,
  ].filter(Boolean).join("\n");
  // Never let a file path reach the voice agent.
  return r.file ? text.split(r.file).join(short).replace(/\b[\w-]+\.(ts|tsx|js|py|go|rb|java)\b/g, short) : text;
}

async function finish(r: Request, d: Decision, people: People, owner?: Person, target?: Person) {
  clear(r.id);
  r.decision = d;
  r.step = "done";
  r.status = "done";
  save(r);
  await log(r, "done", d.outcome === "no_answer" ? `no answer yet, told ${r.requester} to hold off` : `sent the answer back to ${r.requester}`, d.outcome === "no_answer" ? false : undefined);

  // "Ask Philip" is a pointer, not a decision; never save it.
  if (d.outcome === "redirect" && /^ask\b/i.test(d.instead ?? "")) d = r.decision = { ...d, outcome: "no_answer" };
  if (d.outcome !== "no_answer" && d.source.channel !== "memory") {
    const noteId = await recordDecision({ question: r.question, file: r.file, decision: d, requester: r.requester }).catch((e) => { console.warn("[notes]", e.message); return undefined; });
    if (noteId) await log(r, "info", `saved it for next time`);
    const decider = Object.values(people).find((p) => p.name === d.decidedBy) ?? owner;
    await remember(decider, "context", `Decided on ${new Date().toDateString()}: ${r.file ?? r.question} → ${d.outcome}${d.instead ? `; instead: ${d.instead}` : ""}.`);
    if (target && decider && decider.handle !== target.handle) {
      await remember(target, "preference", `${target.name} sends decisions about ${r.file ?? "this area"} to ${decider.name}.`);
    }
  }

  // Close the loop on the text Milo sent: a threaded "taken care of" after a call, or a checkmark after a text answer.
  if (r.imessageId && r.imessageConversationId && d.outcome !== "no_answer") {
    const close = d.source.channel === "call" ? ch.imessageInConversation(r.imessageConversationId, "taken care of over the phone", r.imessageId)
      : d.source.channel === "imessage" ? ch.imessageInConversation(r.imessageConversationId, "✓")
      : undefined;
    await close?.catch((e) => console.warn("[imessage] close-out failed:", e.detail?.message ?? e.message));
  }

  if (r.slack && !isSuperseded(r)) await sayOutcome(r, d, people);

  if (r.a2aTaskId) {
    await a2aChains.get(r.id);
    const text = isSuperseded(r) && d.outcome === "no_answer" ? "Replaced by a newer question about the same thing. Use the answer to that one." : d.outcome === "no_answer" ? "No human decision yet. Do not proceed with this change." : `Decision: ${d.choice ? `use ${d.choice}` : d.outcome}. ${d.answer}${d.instead ? ` Instead: ${d.instead}` : ""}`;
    await ch.a2aComplete(r.a2aTaskId, text, { ...d, requestId: r.id }).catch((e) => console.warn("[a2a] complete failed:", e.message));
  }
}

/** The last thing Milo says in Slack, like an engineer closing the loop. */
async function sayOutcome(r: Request, d: Decision, people: People) {
  const by = d.decidedBy ? lc(d.decidedBy) : "they";
  const verdict = d.choice ? lc(d.choice) : d.outcome === "approved" ? "go ahead" : "no";
  const instead = d.instead ? `, going with ${lc(d.instead).replace(/\.$/, "")}` : "";
  const ch_ = d.source.channel;
  if (d.outcome === "no_answer") {
    if (r.slack?.threadTs) await say(r, r.listening ? "still nothing, holding off for now" : "couldn't reach anyone yet, holding off for now");
    return;
  }
  if (ch_ === "memory") return void (await say(r, `fyi ${lc(r.requester)} asked about ${shortFile(r)} again. ${by} already said ${verdict} on this earlier${instead}, so i didn't bug anyone`));
  if (ch_ === "owner_agent") return void (await say(r, `fyi ${lc(r.requester)} asked about ${shortFile(r)}. ${lc(d.decidedBy ?? "the owner's agent")} had the answer (${verdict}${instead}), so i didn't bug anyone`));
  if (ch_ === "slack") return void (await say(r, `got it, thanks${instead ? ` ${instead.slice(2)}` : ""}`));
  if (ch_ === "imessage") return void (await say(r, `${by} answered over text, ${verdict}${instead}. thanks`));
  // Call: summary + transcript link + recording.
  const c = r.call;
  const names = (c?.joined ?? []).map(lc);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? by;
  const lines = (c?.transcript ?? "").split("\n").map((l) => { const m = /^(milo|them): (.*)$/.exec(l); return m ? [m[1], m[2]] : null; }).filter(Boolean);
  const url = transcriptLink({ q: r.question, from: r.requester, who: names.join(", "), secs: c?.seconds, at: d.at, decision: d.answer, by: d.decidedBy, lines });
  await say(r, `talked to ${who}, ${by} said ${verdict}${instead}. <${url}|transcript>`);
  if (c?.recordingPath) await say(r, "", { path: c.recordingPath, comment: "call recording" });
  void people;
}

export const timeouts = T;
export type { Step };
