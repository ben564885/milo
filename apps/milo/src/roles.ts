import { extractRoleChange, loadIdentities, loadPeople, ROLE_LABEL, type Person, type Role } from "@milo/shared";
import * as ch from "./channels.ts";
import { db } from "./store.ts";

/** Who Milo asks first, and who approves payments. Saved here so anyone can change them from any channel. */
export type RoleSetting = { role: Role; handle: string; changedBy?: string; via?: string; at?: string };

const DEFAULTS: Record<Role, string> = {
  first_contact: process.env.MILO_FIRST_CONTACT ?? "ben",
  payment_approver: process.env.MILO_PAYMENT_APPROVER ?? "ben",
};

const slackOn = () => { try { return Boolean(loadIdentities().slack); } catch { return false; } };

db.exec("CREATE TABLE IF NOT EXISTS roles (role TEXT PRIMARY KEY, json TEXT)");

export function getRole(role: Role): RoleSetting {
  const row = db.prepare("SELECT json FROM roles WHERE role = ?").get(role) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : { role, handle: DEFAULTS[role] };
}

export function listRoles(): RoleSetting[] {
  return (Object.keys(DEFAULTS) as Role[]).map(getRole);
}

export function resetRoles() { db.exec("DELETE FROM roles"); }

/** Find a team member by first name or handle. */
export function findPerson(name: string): Person | undefined {
  const n = name.trim().toLowerCase().replace(/^@/, "");
  return Object.values(loadPeople()).find((p) => p.handle === n || p.name.toLowerCase() === n);
}

/** Change a role, and say so in Slack. Anyone may ask; only people on the team list can be picked. */
export async function changeRole(role: Role, name: string, changedBy: string, via: string): Promise<{ ok: boolean; text: string; person?: Person }> {
  const person = findPerson(name);
  if (!person) return { ok: false, text: `No one named ${name} is on the team list. People: ${Object.values(loadPeople()).map((p) => p.name).join(", ")}.` };
  const before = loadPeople()[getRole(role).handle]?.name ?? getRole(role).handle;
  if (getRole(role).handle === person.handle) return { ok: true, person, text: `${person.name} is already the ${ROLE_LABEL[role]}.` };
  db.prepare("INSERT INTO roles (role, json) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET json = excluded.json")
    .run(role, JSON.stringify({ role, handle: person.handle, changedBy, via, at: new Date().toISOString() } satisfies RoleSetting));
  console.log(`[roles] ${role}: ${before} → ${person.name} (by ${changedBy} via ${via})`);
  const text = role === "payment_approver"
    ? `ok, from now on ${person.name.toLowerCase()} approves payments instead of ${before.toLowerCase()} (changed by ${changedBy.toLowerCase()} over ${via})`
    : `ok, from now on i'll ask ${person.name.toLowerCase()} first instead of ${before.toLowerCase()} (changed by ${changedBy.toLowerCase()} over ${via})`;
  if (slackOn()) await ch.slackPost(`${text}. heads up ${ch.mention(person)}`).catch((e) => console.warn("[slack]", e.message));
  return { ok: true, person, text };
}

/** If a message changes a role, apply it. Returns what changed. */
export async function roleChangeFrom(text: string, changedBy: string, via: string) {
  const change = await extractRoleChange(text, Object.values(loadPeople()).map((p) => p.name));
  if (!change) return undefined;
  const res = await changeRole(change.role, change.person, changedBy, via);
  return res.ok ? { role: change.role, ...res } : undefined;
}
