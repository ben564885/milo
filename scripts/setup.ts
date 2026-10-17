/**
 * Idempotent Inkbox setup for Milo.
 *   pnpm tsx scripts/setup.ts
 * Creates identities, agent-scoped keys (.env.local), enables A2A,
 * creates contacts for people, and writes config/identities.json.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adminClient, keyVar, loadPeople, ROOT, saveIdentities, type Identities, type IdentityRecord } from "../packages/shared/src/index.ts";

const inkbox = adminClient();
const people = loadPeople();
const MILO = process.env.MILO_HANDLE ?? "hey-milo";

const localEnv = join(ROOT, ".env.local");
const haveKey = (h: string) => existsSync(localEnv) && readFileSync(localEnv, "utf8").includes(keyVar(h) + "=");

async function ensureIdentity(handle: string, displayName: string, description: string): Promise<IdentityRecord> {
  let identity;
  try {
    identity = await inkbox.getIdentity(handle);
    console.log(`= ${handle} exists`);
  } catch {
    identity = await inkbox.createIdentity(handle, { displayName, description });
    console.log(`+ ${handle} created`);
  }
  if (!haveKey(handle)) {
    const key = await inkbox.apiKeys.create({ label: `${handle}-agent`, scopedIdentityId: identity.id });
    appendFileSync(localEnv, `${keyVar(handle)}=${(key as any).apiKey ?? (key as any).key}\n`);
    console.log(`  key saved as ${keyVar(handle)}`);
  }
  await identity.a2aEnable();
  return { handle, id: identity.id, email: identity.emailAddress ?? "" };
}

const milo = await ensureIdentity(MILO, "Milo",
  "Milo gets human decisions for blocked agents. Send a question; Milo asks the owner's agent first, then escalates over Slack, iMessage and phone, and returns a structured decision.");
const coder = await ensureIdentity(`${MILO}-coder`, "Claude Coder", "Coding agent that asks Milo when it needs a human decision.");

const owners: Record<string, IdentityRecord> = {};
for (const p of Object.values(people)) {
  if (!p.agent) continue;
  owners[p.handle] = await ensureIdentity(p.agent, `${p.name}'s Agent`, `Answers questions on ${p.name}'s behalf from recorded decisions.`);
}

// Advertise Milo's skill on its Agent Card.
const miloIdentity = await inkbox.getIdentity(MILO);
await miloIdentity.a2aSetSkills([{
  id: "ask_human",
  name: "Ask a human",
  description: "Get a decision from the human who owns something. Input: a question, context, optional file path and urgency. Output: a structured decision.",
  tags: ["human-in-the-loop", "escalation", "approval"],
  examples: ["Can I change billing.ts to call the legacy endpoint?"],
} as any]);

// Contacts for each person (match by phone or email).
const existing = await inkbox.contacts.list();
for (const p of Object.values(people)) {
  const found = existing.find((c: any) =>
    (p.phone && c.phones?.some((x: any) => x.value === p.phone)) ||
    (p.email && c.emails?.some((x: any) => x.value === p.email)) ||
    (c.givenName === p.name && c.notes === "milo-demo"));
  if (found) { console.log(`= contact ${p.name}`); continue; }
  await inkbox.contacts.create({
    givenName: p.name,
    notes: "milo-demo",
    phones: p.phone ? [{ value: p.phone, label: "mobile", isPrimary: true }] : [],
    emails: p.email ? [{ value: p.email, label: "work", isPrimary: true }] : [],
  });
  console.log(`+ contact ${p.name}`);
}

const ids: Identities = { milo, coder, owners };
saveIdentities(ids);
console.log("\nWrote config/identities.json");
