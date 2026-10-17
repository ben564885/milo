import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { ROOT } from "./env.ts";

export type Step = "lookup" | "owner_agent" | "slack" | "imessage" | "call";
export const LADDER: Step[] = ["lookup", "owner_agent", "slack", "imessage", "call"];

export type Person = {
  handle: string;
  name: string;
  phone?: string;
  email?: string;
  slack_user?: string;
  agent?: string; // A2A handle of this person's agent
  contact_id?: string; // Inkbox contact id (filled by setup)
  max_step: Step;
  call_only_if: "low" | "normal" | "high";
  quiet_hours?: string; // "23:00-07:00"
};

export type People = Record<string, Person>;

export function loadPeople(): People {
  // Real contact details live in the git-ignored people.local.yaml; people.yaml holds example values.
  const local = join(ROOT, "config/people.local.yaml");
  const raw = parse(readFileSync(existsSync(local) ? local : join(ROOT, "config/people.yaml"), "utf8")) as { people: Record<string, Omit<Person, "handle">> };
  return Object.fromEntries(Object.entries(raw.people).map(([handle, p]) => [handle, { handle, ...p }]));
}

export type IdentityRecord = { handle: string; id: string; email: string };
export type Identities = {
  milo: IdentityRecord;
  coder: IdentityRecord;
  owners: Record<string, IdentityRecord>; // person handle -> their agent identity
  slack?: { connectionId: string; channelId: string };
};

// Real Inkbox/Slack IDs live in the git-ignored identities.local.json (written by scripts/setup.ts).
const IDS = join(ROOT, "config/identities.local.json");

export function loadIdentities(): Identities {
  if (!existsSync(IDS)) throw new Error("config/identities.local.json missing. Run: pnpm tsx scripts/setup.ts");
  return JSON.parse(readFileSync(IDS, "utf8"));
}

export function saveIdentities(ids: Identities) {
  writeFileSync(IDS, JSON.stringify(ids, null, 2) + "\n");
}

export function ownersFile(): Record<string, string> {
  // CODEOWNERS-style map: path glob -> person handle
  const path = join(ROOT, "demo-repo/CODEOWNERS");
  const map: Record<string, string> = {};
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [pattern, owner] = t.split(/\s+/);
    if (pattern && owner) map[pattern] = owner.replace(/^@/, "");
  }
  return map;
}

export function ownerOf(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const map = ownersFile();
  let best: string | undefined;
  let bestLen = -1;
  for (const [pattern, owner] of Object.entries(map)) {
    const p = pattern.replace(/^\//, "");
    const hit = p === "*" || file === p || file.endsWith("/" + p) || file.endsWith(p) || (p.endsWith("/") && file.includes(p));
    if (hit && p.length > bestLen) { best = owner; bestLen = p.length; }
  }
  return best;
}
