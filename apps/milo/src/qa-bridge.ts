/**
 * QA: full bridged call with two simulated phones and generated speech.
 * Ben says to add Philip; Philip decides. Milo must add Philip, hear him, and record the decision.
 */
import { createServer } from "node:http";
import WebSocket from "ws";
import { loadPeople } from "@milo/shared";
import { attachCallSockets, runConference, setFakeDial } from "./conference.ts";
import { encode, FRAME, SILENCE } from "./g711.ts";

async function speech(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "pcm" }),
  });
  const pcm24 = new Int16Array((await res.arrayBuffer()));
  const pcm8 = new Int16Array(Math.floor(pcm24.length / 3));
  for (let i = 0; i < pcm8.length; i++) pcm8[i] = Math.round((pcm24[3 * i] + pcm24[3 * i + 1] + pcm24[3 * i + 2]) / 3);
  return encode(pcm8);
}

const PORT = 8799;
const server = createServer();
attachCallSockets(server);
server.listen(PORT);

const lines: Record<string, string> = {
  ben: "Hmm, I'm not sure about that. Philip owns the billing stuff. Can you add Philip to the call?",
  philip: "Hey. No, don't change it. Use the v2 refunds endpoint instead.",
};
const audio: Record<string, Buffer> = {};
for (const [k, t] of Object.entries(lines)) audio[k] = await speech(t);
console.log("generated speech:", Object.fromEntries(Object.entries(audio).map(([k, v]) => [k, `${(v.length / 8000).toFixed(1)}s`])));

function phone(conf: string, leg: string) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws/call?conf=${conf}&leg=${leg}`);
  let heardMilo = 0, quiet = 0, spoken = false, queue = Buffer.alloc(0);
  ws.on("open", () => {
    ws.send(JSON.stringify({ event: "start", stream_id: `s-${leg}` }));
    const t = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return clearInterval(t);
      let frame = SILENCE;
      if (queue.length >= FRAME) { frame = queue.subarray(0, FRAME); queue = queue.subarray(FRAME); }
      ws.send(JSON.stringify({ event: "media", stream_id: `s-${leg}`, media: { track: "inbound", payload: frame.toString("base64") } }));
    }, 20);
  });
  ws.on("message", (m) => {
    const e = JSON.parse(m.toString());
    if (e.event === "stop") { console.log(`[${leg}] got stop`); ws.close(); return; }
    if (e.event !== "media") return;
    const loud = Buffer.from(e.media.payload, "base64").some((b) => b !== 0xff && b !== 0x7f && Math.abs((b & 0x7f) - 0x7f) > 8);
    if (loud) { heardMilo++; quiet = 0; } else quiet++;
    // Speak once, after hearing Milo talk and then ~1.2 s of quiet.
    if (!spoken && heardMilo > 40 && quiet > 60) {
      spoken = true;
      console.log(`[${leg}] speaking: ${lines[leg]}`);
      queue = Buffer.concat([queue, audio[leg]]);
    }
  });
}

setFakeDial((conf, leg) => { console.log(`[dial] ${leg}`); setTimeout(() => phone(conf, leg), 1500); });
const people = loadPeople();
const t0 = Date.now();
const res = await Promise.race([
  runConference({
    question: "Can I change the refund logic in billing.ts to call the legacy v1 charge endpoint?",
    context: "Refunds fail on v2 for old charges; v1 still works.",
    requester: "Claude Code", shortName: "the billing code", target: people.ben, people, away: ["daniel"],
    onEvent: (t) => console.log(`  • ${t}`),
  }),
  new Promise((r) => setTimeout(() => r({ timeout: true }), 150_000)),
]);
console.log(`\nRESULT after ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify((res as any).decision ?? res, null, 1));
console.log("\nTRANSCRIPT:\n" + ((res as any).transcript ?? ""));
process.exit(0);
