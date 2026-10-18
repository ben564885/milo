/**
 * Milo's own conference bridge.
 *
 * Milo calls each person over Inkbox in media-stream mode. Inkbox streams each
 * call's raw audio to us over a WebSocket (through the Inkbox tunnel). We mix the
 * audio so every person hears everyone else, and feed the mix to an OpenAI
 * Realtime voice model that speaks as Milo. Milo can add a guest, record the
 * decision, and end the call with tools.
 */
import type { IncomingMessage, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { agentClient, loadIdentities, ROOT, type People, type Person } from "@milo/shared";
import { decode, FRAME, mix, SILENCE } from "./g711.ts";

const RT_MODEL = process.env.MILO_RT_MODEL ?? "gpt-realtime-2.1";
const RT_VOICE = process.env.MILO_RT_VOICE ?? "cedar";
const TICK_MS = 20;
const MAX_BUFFERED_FRAMES = 25; // drop inbound audio older than ~0.5 s

export type BridgeDecision = { outcome: "approved" | "blocked" | "redirect"; answer: string; instead?: string; decidedBy?: string; choice?: string };
export type BridgeResult = { decision?: BridgeDecision; transcript: string; connected: boolean; joined: string[]; recordingPath?: string; seconds: number };

type Leg = { person: Person; callId?: string; ws?: WebSocket; streamId?: string; inbound: Buffer; live: boolean; ended: boolean; spoke: boolean };

const conferences = new Map<string, Conference>();

/** QA hook: when set, dial() does not place a real call; the test connects a simulated phone. */
let fakeDial: ((conf: string, leg: string) => void) | undefined;
export function setFakeDial(fn?: (conf: string, leg: string) => void) { fakeDial = fn; }

export type BridgeInput = {
  question: string;
  options?: string[];
  /** Someone on the call changed who Milo asks first or who approves payments. Returns what to tell them. */
  onChangeRole?: (role: "first_contact" | "payment_approver", name: string, changedBy: string) => Promise<string>;
  context: string;
  requester: string;
  shortName: string; // "the billing code"
  target: Person;
  people: People;
  away: string[];
  referredBy?: string;
  onEvent: (text: string, ok?: boolean) => void;
};

class Conference {
  id = randomUUID().slice(0, 8);
  legs = new Map<string, Leg>();
  ai!: WebSocket;
  aiOut = Buffer.alloc(0);
  aiInBatch: Buffer[] = [];
  transcript: string[] = [];
  decision?: BridgeDecision;
  ending = false;
  responding = false;
  goodbye = false;
  ticker?: NodeJS.Timeout;
  t0 = 0;
  ticks = 0;
  done!: (r: BridgeResult) => void;
  result: Promise<BridgeResult>;
  timers: NodeJS.Timeout[] = [];
  recording: Buffer[] = []; // full mix (everyone + Milo), μ-law frames

  constructor(public input: BridgeInput) {
    this.result = new Promise((res) => (this.done = res));
    conferences.set(this.id, this);
  }

  // ---------- lifecycle ----------
  async start() {
    await this.openAI();
    await this.dial(this.input.target);
    this.t0 = Date.now();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    // Give up if the first person never connects (no answer / voicemail).
    this.timers.push(setTimeout(() => { if (!this.legs.get(this.input.target.handle)?.live) this.finish(); }, 60_000));
    // Hard cap on the whole call.
    this.timers.push(setTimeout(() => this.finish(), 9 * 60_000));
    return this.result;
  }

  finish() {
    if (!conferences.has(this.id)) return;
    conferences.delete(this.id);
    clearInterval(this.ticker);
    for (const t of this.timers) clearTimeout(t);
    for (const leg of this.legs.values()) this.hangUp(leg);
    try { this.ai?.close(); } catch {}
    const joined = [...this.legs.values()].filter((l) => l.spoke || l.live || l.streamId).map((l) => l.person.name);
    const connected = [...this.legs.values()].some((l) => l.spoke);
    const recordingPath = this.saveRecording();
    this.done({ decision: this.decision, transcript: this.transcript.join("\n"), connected, joined, recordingPath, seconds: Math.round((this.recording.length * TICK_MS) / 1000) });
  }

  saveRecording(): string | undefined {
    if (this.recording.length < 50) return undefined; // under 1 s: nothing worth keeping
    const pcm = decode(Buffer.concat(this.recording));
    const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(data.length, 40);
    const dir = join(ROOT, "data/recordings");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `milo-call-${this.id}.wav`);
    writeFileSync(path, Buffer.concat([h, data]));
    return path;
  }

  hangUp(leg: Leg) {
    const wasEnded = leg.ended;
    leg.ended = true;
    leg.live = false;
    if (!wasEnded) {
      try { leg.ws?.send(JSON.stringify({ event: "stop", reason: "agent_hang_up" })); } catch {}
      setTimeout(() => { try { leg.ws?.close(); } catch {} }, 1500);
    }
    // Closing the media stream does not end the phone call, so hang up through the calls API too.
    if (leg.callId) {
      const ids = loadIdentities();
      void agentClient(ids.milo.handle).getIdentity(ids.milo.handle)
        .then((m) => m.hangupCall(leg.callId!))
        .then(() => console.log(`[bridge] hung up ${leg.person.name} (${leg.callId})`))
        .catch((e) => { if (e?.statusCode !== 409 && e?.statusCode !== 404) console.warn(`[bridge] hangup ${leg.person.name}:`, e?.detail ?? e.message); });
    }
  }

  // ---------- phone legs ----------
  async dial(person: Person) {
    const ids = loadIdentities();
    const leg: Leg = { person, inbound: Buffer.alloc(0), live: false, ended: false, spoke: false };
    this.legs.set(person.handle, leg);
    const url = `wss://${ids.milo.handle}.inkboxwire.com/ws/call?conf=${this.id}&leg=${person.handle}`;
    if (fakeDial) { fakeDial(this.id, person.handle); return; } // QA: a simulated phone connects instead
    const milo = await agentClient(ids.milo.handle).getIdentity(ids.milo.handle);
    try {
      const call: any = await milo.placeCall({ toNumber: person.phone!, clientWebsocketUrl: url, onVoicemail: "hang_up" } as any);
      leg.callId = call.id;
    } catch (err: any) {
      // A second simultaneous call may need the other line (the dedicated iMessage number).
      const res = await fetch("https://inkbox.ai/api/v1/phone/place-call", {
        method: "POST",
        headers: { "X-API-Key": process.env[`INKBOX_KEY_${ids.milo.handle.toUpperCase().replace(/-/g, "_")}`]!, "Content-Type": "application/json" },
        body: JSON.stringify({ origination: "dedicated_imessage_number", to_number: person.phone, client_websocket_url: url, on_voicemail: "hang_up" }),
      });
      if (!res.ok) throw new Error(`could not call ${person.name}: ${err?.detail?.message ?? err.message}; fallback ${res.status} ${await res.text()}`);
      leg.callId = ((await res.json()) as any).id;
    }
  }

  attach(handle: string, ws: WebSocket) {
    const leg = this.legs.get(handle);
    if (!leg) return ws.close();
    leg.ws = ws;
    ws.on("error", (e) => console.warn(`[bridge] ${handle} socket error: ${e.message}`)); // e.g. Inkbox closing with code 1006
    ws.on("message", (m) => {
      let e: any;
      try { e = JSON.parse(m.toString()); } catch { return; }
      if (e.event === "start") {
        leg.streamId = e.stream_id ?? e.start?.stream_id;
        leg.live = true;
        const first = handle === this.input.target.handle;
        this.input.onEvent(first ? `${leg.person.name} picked up` : `${leg.person.name} joined the call`);
        this.say(first
          ? `[${leg.person.name} answered the phone. Start now with your opening line.]`
          : `[${leg.person.name} just joined the call. Greet ${leg.person.name} by name, give a two-sentence summary, and ask for the decision.]`);
      } else if (e.event === "media" && (e.media?.track ?? "inbound") === "inbound" && e.media?.payload) {
        leg.inbound = Buffer.concat([leg.inbound, Buffer.from(e.media.payload, "base64")]);
        const max = MAX_BUFFERED_FRAMES * FRAME;
        if (leg.inbound.length > max) leg.inbound = leg.inbound.subarray(leg.inbound.length - max);
      } else if (e.event === "stop") {
        this.legEnded(leg);
      }
    });
    ws.on("close", () => this.legEnded(leg));
  }

  legEnded(leg: Leg) {
    const wasLive = leg.live;
    leg.live = false;
    leg.ended = true;
    if (wasLive && !this.ending) this.input.onEvent(`${leg.person.name} hung up`);
    // The call ends when the first person hangs up, or when nobody is left.
    const anyLive = [...this.legs.values()].some((l) => l.live);
    if (leg.person.handle === this.input.target.handle || !anyLive) setTimeout(() => this.finish(), 300);
  }

  // ---------- audio clock ----------
  tick() {
    const due = Math.floor((Date.now() - this.t0) / TICK_MS) - this.ticks;
    for (let n = 0; n < Math.min(due, 10); n++) this.frame();
    this.ticks += Math.max(due, 0);
  }

  frame() {
    const live = [...this.legs.values()].filter((l) => l.live);
    const inFrames = new Map<string, Buffer>();
    for (const l of live) {
      if (l.inbound.length >= FRAME) {
        inFrames.set(l.person.handle, l.inbound.subarray(0, FRAME));
        l.inbound = l.inbound.subarray(FRAME);
      } else {
        inFrames.set(l.person.handle, SILENCE);
      }
    }
    let aiFrame: Buffer | undefined;
    if (this.aiOut.length >= FRAME) {
      aiFrame = this.aiOut.subarray(0, FRAME);
      this.aiOut = this.aiOut.subarray(FRAME);
    } else if (this.aiOut.length > 0) {
      aiFrame = Buffer.concat([this.aiOut, SILENCE.subarray(this.aiOut.length)]);
      this.aiOut = Buffer.alloc(0);
    }

    // Milo hears everyone.
    this.aiInBatch.push(mix([...inFrames.values()]));
    if (this.aiInBatch.length >= 5) {
      this.sendAI({ type: "input_audio_buffer.append", audio: Buffer.concat(this.aiInBatch).toString("base64") });
      this.aiInBatch = [];
    }

    // The recording hears everyone plus Milo (only while someone is on the line).
    if (live.length) this.recording.push(mix(aiFrame ? [...inFrames.values(), aiFrame] : [...inFrames.values()]));

    // Each person hears everyone else plus Milo.
    for (const l of live) {
      if (!l.ws || l.ws.readyState !== WebSocket.OPEN) continue;
      const others = live.filter((o) => o !== l).map((o) => inFrames.get(o.person.handle)!);
      const out = mix(aiFrame ? [...others, aiFrame] : others);
      l.ws.send(JSON.stringify({ event: "media", stream_id: l.streamId, media: { track: "outbound", payload: out.toString("base64") } }));
    }

    if (this.ending && this.aiOut.length === 0 && !this.responding) {
      this.ending = false;
      setTimeout(() => this.finish(), 800);
    }
  }

  // ---------- Milo's voice (OpenAI Realtime) ----------
  openAI(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${RT_MODEL}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
      this.ai.on("open", () => {
        this.sendAI({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: this.instructions(),
            output_modalities: ["audio"],
            audio: {
              input: { format: { type: "audio/pcmu" }, turn_detection: { type: "server_vad", silence_duration_ms: 500 }, transcription: { model: "gpt-4o-mini-transcribe" } },
              output: { format: { type: "audio/pcmu" }, voice: RT_VOICE },
            },
            tools: TOOLS,
          },
        });
        resolve();
      });
      this.ai.on("error", (e) => { console.error("[bridge] openai", e.message); reject(e); });
      this.ai.on("message", (m) => this.onAI(JSON.parse(m.toString())));
    });
  }

  sendAI(e: unknown) {
    if (this.ai?.readyState === WebSocket.OPEN) this.ai.send(JSON.stringify(e));
  }

  say(note: string) {
    this.sendAI({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: note }] } });
    this.sendAI({ type: "response.create" });
  }

  async onAI(e: any) {
    if (process.env.MILO_BRIDGE_DEBUG && /response\.(created|done)|function_call_arguments\.done|output_audio_transcript\.done/.test(e.type)) {
      console.log(`[bridge:${((Date.now() - this.t0) / 1000).toFixed(1)}s] ${e.type} ${e.name ?? ""} ${e.transcript ?? ""} ${e.type === "response.done" ? `status=${e.response?.status} out=${(e.response?.output ?? []).map((o: any) => o.type + (o.name ? ":" + o.name : "")).join(",")} aiOut=${this.aiOut.length}` : ""}`);
    }
    switch (e.type) {
      case "response.created": this.responding = true; break;
      case "response.output_audio.delta": this.aiOut = Buffer.concat([this.aiOut, Buffer.from(e.delta, "base64")]); break;
      case "input_audio_buffer.speech_started":
        this.aiOut = Buffer.alloc(0); // someone talked over Milo: stop playing
        for (const l of this.legs.values()) if (l.live) l.spoke = true;
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.transcript?.trim()) this.transcript.push(`them: ${e.transcript.trim()}`);
        break;
      case "response.output_audio_transcript.done":
        if (e.transcript?.trim()) this.transcript.push(`milo: ${e.transcript.trim()}`);
        break;
      case "error":
        if (e.error?.code !== "response_cancel_not_active") console.warn("[bridge] openai error", JSON.stringify(e.error));
        break;
      case "response.done": {
        this.responding = false;
        if (this.goodbye) { this.goodbye = false; this.ending = true; break; } // goodbye spoken: hang up once it has played
        const calls = (e.response?.output ?? []).filter((o: any) => o.type === "function_call");
        let follow = false;
        for (const c of calls) {
          const out = await this.runTool(c.name, safeJSON(c.arguments));
          this.sendAI({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: out } });
          if (c.name !== "end_call" && c.name !== "record_decision") follow = true;
        }
        if (calls.some((c: any) => c.name === "record_decision") && this.decision) {
          // Say the confirmation exactly, with tools off, then hang up.
          this.goodbye = true;
          this.sendAI({ type: "response.create", response: { tool_choice: "none", instructions: `Say exactly this, warmly and quickly, and nothing else: "${confirmation(this.decision)}"` } });
        } else if (follow) {
          this.sendAI({ type: "response.create" });
        }
        break;
      }
    }
  }

  async runTool(name: string, args: any): Promise<string> {
    if (name === "add_guest") {
      const wanted = String(args.name ?? "").toLowerCase();
      const p = Object.values(this.input.people).find((x) => x.name.toLowerCase() === wanted || x.handle === wanted);
      if (!p) return `No one named ${args.name} is in the team list. People you can add: ${this.roster().map((x) => x.name).join(", ") || "nobody"}.`;
      if (this.input.away.includes(p.handle)) return `${p.name} cannot be reached right now. Tell them that.`;
      if (!p.phone) return `There is no phone number for ${p.name}.`;
      if (this.legs.has(p.handle)) return `${p.name} is already on the call or being called.`;
      this.input.onEvent(`adding ${p.name} to the call`);
      try {
        await this.dial(p);
        return `Calling ${p.name} now. Tell ${this.input.target.name} you are adding ${p.name}, then wait. When ${p.name} joins you will get a note.`;
      } catch (err) {
        this.input.onEvent(`couldn't reach ${p.name}`, false);
        return `The call to ${p.name} failed. Say so briefly.`;
      }
    }
    if (name === "record_decision") {
      this.decision = { outcome: args.outcome, answer: args.answer, instead: args.instead || undefined, decidedBy: args.decided_by || undefined, choice: args.choice || undefined };
      this.input.onEvent(`${this.decision.decidedBy ?? "they"} decided: ${this.decision.answer}`);
      return "Recorded.";
    }
    if (name === "change_contact") {
      if (!this.input.onChangeRole) return "That can't be changed from this call.";
      const role = args.role === "payment_approver" ? "payment_approver" : "first_contact";
      const text = await this.input.onChangeRole(role, String(args.name ?? ""), String(args.changed_by || this.input.target.name));
      this.input.onEvent(text);
      return `${text}. Confirm it in one short sentence, then continue with the question.`;
    }
    if (name === "end_call") {
      this.ending = true;
      return "Ending.";
    }
    return "Unknown tool.";
  }

  roster() {
    return Object.values(this.input.people).filter((p) => p.handle !== this.input.target.handle && p.phone && !this.input.away.includes(p.handle));
  }

  instructions() {
    const { target, referredBy, shortName, question, context, requester, away, people } = this.input;
    const awayNames = Object.values(people).filter((p) => away.includes(p.handle)).map((p) => p.name);
    const opening = referredBy
      ? `Hey ${target.name}, this is Milo. ${referredBy} said you own ${shortName}, so I wanted to get a quick decision from you.`
      : `Hey ${target.name}, this is Milo.`;
    return [
      `You are Milo, a friendly, brisk teammate on a phone call. You get quick decisions from people for blocked coding agents. ${requester} is blocked and needs a decision.`,
      `The question: ${question}`,
      this.input.options?.length ? `This is a choice question. Suggested options: ${this.input.options.join(", ")}. They may also name something else. When someone picks, call record_decision with outcome approved and choice set to what they picked.` : "",
      context ? `Background: ${context}` : "",
      `Refer to code by a short spoken name like "${shortName}". Never read file paths or file extensions aloud.`,
      `When the call connects, say exactly: "${opening}" Then ask the question in one or two short sentences.`,
      `Always speak in the first person ("I"). Never refer to yourself as Milo in the third person. Do not say you are an AI unless someone asks; if asked, answer honestly.`,
      `Keep every turn short (one to three sentences). This is a phone call with several people; listen to everyone on the line.`,
      `If someone says another person decides or asks you to bring someone in, call add_guest with that person's name. People you can add: ${this.roster().map((p) => p.name).join(", ") || "nobody"}.${awayNames.length ? ` ${awayNames.join(" and ")} cannot be reached right now.` : ""}`,
      `When a new person joins, greet them by name, give a two-sentence summary, and ask them for the decision.`,
      `As soon as someone clearly decides (yes, no, or do something else instead), call record_decision right away without saying anything first. The call then wraps up automatically. Never narrate what you are about to do (no "let me confirm").`,
      `If someone says that from now on a different person should be asked first, or should approve payments, call change_contact. That is a lasting change, not the answer to this question. If they also want that person to decide this question, add them with add_guest.`,
      `If the people on the call ask you to explain or repeat, do it right away. Never stay silent when someone talks to you.`,
    ].filter(Boolean).join("\n");
  }
}

const TOOLS = [
  {
    type: "function", name: "add_guest",
    description: "Add a teammate to this phone call by calling them. Use when someone says another person decides or asks you to bring someone in.",
    parameters: { type: "object", properties: { name: { type: "string", description: "First name of the person to add" } }, required: ["name"] },
  },
  {
    type: "function", name: "record_decision",
    description: "Record the decision once a person on the call clearly decides.",
    parameters: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["approved", "blocked", "redirect"], description: "approved = go ahead; blocked = don't; redirect = don't, do something else instead" },
        answer: { type: "string", description: "One sentence: what was decided" },
        instead: { type: "string", description: "Short action to do instead, e.g. \"use the v2 refunds endpoint\", or empty" },
        decided_by: { type: "string", description: "First name of the person who decided" },
        choice: { type: "string", description: "For a choice question: the option they picked, exactly as listed. Otherwise empty." },
      },
      required: ["outcome", "answer", "decided_by"],
    },
  },
  {
    type: "function", name: "change_contact",
    description: "Change, from now on, who Milo asks first about questions (first_contact) or who approves agent payments (payment_approver).",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["first_contact", "payment_approver"] },
        name: { type: "string", description: "First name of the new person" },
        changed_by: { type: "string", description: "First name of the person asking for the change" },
      },
      required: ["role", "name"],
    },
  },
  { type: "function", name: "end_call", description: "Hang up for everyone after the decision is confirmed and you said bye.", parameters: { type: "object", properties: {}, required: [] } },
];

/** What Milo says back after a decision, e.g. "OK, got it, Philip. I won't make that change; I'll use the v2 refunds endpoint instead. Thanks, bye!" */
export function confirmation(d: BridgeDecision): string {
  const who = d.decidedBy ? `, ${d.decidedBy}` : "";
  const instead = (d.instead ?? "").replace(/^(to\s+)?/i, "").replace(/\.$/, "").replace(/ instead$/i, "");
  const insteadLower = instead.charAt(0).toLowerCase() + instead.slice(1);
  const middle = d.choice ? `I'll go with ${d.choice}.`
    : d.outcome === "approved" ? "I'll go ahead with it."
    : d.outcome === "redirect" && instead ? `I won't make that change; I'll ${insteadLower}${/\binstead\b/i.test(instead) ? "" : " instead"}.`
    : "I won't make that change.";
  return `OK, got it${who}. ${middle} Thanks, bye!`;
}

function safeJSON(s: string) { try { return JSON.parse(s); } catch { return {}; } }

/** Run a bridged conference call that starts with input.target. */
export async function runConference(input: BridgeInput): Promise<BridgeResult> {
  return startConference(input).result;
}

/** Start a call and keep a handle to end it early (e.g. someone answered on Slack meanwhile). */
export function startConference(input: BridgeInput): { result: Promise<BridgeResult>; abort: () => void } {
  const conf = new Conference(input);
  const result = conf.start();
  return { result, abort: () => conf.finish() };
}

/** Accept Inkbox media-stream WebSockets on /ws/call. */
export function attachCallSockets(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("headers", (headers) => {
    headers.push("X-Use-Inkbox-Text-To-Speech: false", "X-Use-Inkbox-Speech-To-Text: false", "X-Inkbox-Audio-Format: pcmu_8000");
  });
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws/call") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", (e) => console.warn("[bridge] socket error:", e.message));
      const conf = conferences.get(url.searchParams.get("conf") ?? "");
      const leg = url.searchParams.get("leg") ?? "";
      console.log(`[bridge] socket for conf=${url.searchParams.get("conf")} leg=${leg} ${conf ? "" : "(unknown conference)"}`);
      if (!conf) return ws.close();
      conf.attach(leg, ws);
    });
  });
}
