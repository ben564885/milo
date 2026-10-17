// Voice AI config, avatar, signing key, webhook subscription for Milo.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adminClient, loadIdentities, ROOT } from "../packages/shared/src/index.ts";

const inkbox = adminClient();
const { milo } = loadIdentities();
const id = await inkbox.getIdentity(milo.handle);

const catalog = await inkbox.hostedAgent.listVoices();
console.log("voices:", catalog.voices.filter((v: any) => v.available).map((v: any) => `${v.id}:${v.name}`).join(", "), "default:", catalog.defaultVoice);
const voice = process.env.MILO_VOICE ?? catalog.voices.find((v: any) => v.available && /orion/i.test(v.name))?.id ?? catalog.defaultVoice;
await id.setHostedAgentConfig({
  voice,
  instructions: [
    "You are Milo, a friendly, brisk teammate who gets quick decisions from people on behalf of coding agents.",
    "Open calls with \"Hey <name>, this is Milo.\" Do not say you are an AI unless someone asks; if asked, answer honestly.",
    "Always speak in the first person. Never refer to yourself as Milo in the third person.",
    "State the question in one or two sentences, get a clear decision (approve, block, or what to do instead) and who made it, confirm it back, then end the call.",
    "When someone asks you to bring in another person, add them as a guest, greet them as soon as they join, and give them a two-sentence summary. If anyone asks you to explain or repeat, do it right away.",
    "Record the final decision as a post-call action item that starts with 'DECISION:' and names who decided.",
  ].join(" "),
} as any);
console.log("voice set:", voice);
await id.setHostedAgentAuthorityMode({ authorityMode: "contact_scoped" } as any).catch((e: any) => console.log("authority:", e.message));

try {
  const png = readFileSync(join(ROOT, "assets/milo-avatar-1024-bg.png"));
  const anyId: any = id;
  const fn = anyId.uploadAvatar ?? anyId.setAvatar ?? anyId.uploadIMessageAvatar;
  if (fn) { await fn.call(id, png, { contentType: "image/png", filename: "milo.png" }); console.log("avatar set"); }
  else console.log("no avatar method on identity; methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(id)).filter((m) => /avatar/i.test(m)));
} catch (e: any) { console.log("avatar:", e.message); }

if (!process.env.INKBOX_WEBHOOK_SECRET) {
  const key: any = await id.createSigningKey();
  const secret = key.signingKey ?? key.secret ?? key.key;
  if (secret) { appendFileSync(join(ROOT, ".env.local"), `INKBOX_WEBHOOK_SECRET=${secret}\n`); console.log("signing key saved"); }
  else console.log("signing key fields:", Object.keys(key));
}

const url = `https://${milo.handle}.inkboxwire.com/hooks/inkbox`;
const events = ["imessage.received", "imessage.reaction_received", "call.ended", "text.received",
  "slack.mention_received", "slack.thread_reply_received", "slack.dm_received"];
const subs: any = await inkbox.webhooks.subscriptions.list({ agentIdentityId: id.id, scope: "identity" } as any).catch(() => []);
const existing = (Array.isArray(subs) ? subs : subs.items ?? subs.subscriptions ?? []).find((s: any) => s.url === url);
if (existing) {
  await inkbox.webhooks.subscriptions.update(existing.id, { scope: "identity", eventTypes: events } as any);
  console.log("webhook updated", existing.id);
} else {
  const s: any = await inkbox.webhooks.subscriptions.create({ agentIdentityId: id.id, url, eventTypes: events } as any);
  console.log("webhook created", s.id, url);
}
