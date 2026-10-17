import { adminClient, loadPeople, LADDER, type People, type Person, type Step, type Urgency } from "@milo/shared";

let cache: { at: number; people: People } | undefined;

/** People from config/people.yaml, with Inkbox contact ids filled in. */
export async function resolvePeople(): Promise<People> {
  if (cache && Date.now() - cache.at < 60_000) return cache.people;
  const people = loadPeople();
  const contacts = (await adminClient().contacts.list().catch(() => [])) as any[];
  for (const p of Object.values(people)) {
    const c = contacts.find((c) =>
      (p.phone && c.phones?.some((x: any) => x.value === p.phone)) ||
      (p.email && c.emails?.some((x: any) => x.value === p.email)) ||
      (c.givenName === p.name && c.notes === "milo-demo"));
    if (c) p.contact_id = c.id;
  }
  cache = { at: Date.now(), people };
  return people;
}

const URG = { low: 0, normal: 1, high: 2 } as const;

function inQuietHours(range?: string): boolean {
  if (!range) return false;
  const [a, b] = range.split("-").map((s) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); });
  const now = new Date(); const t = now.getHours() * 60 + now.getMinutes();
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

/** The interrupt budget: may Milo use this step to reach this person? Every run uses the full ladder; only max_step limits it. */
export function allowed(step: Step, person: Person | undefined, urgency: Urgency): { ok: boolean; why?: string } {
  if (step === "lookup" || step === "owner_agent") return { ok: true };
  if (!person) return { ok: false, why: "no person to ask" };
  if (LADDER.indexOf(step) > LADDER.indexOf(person.max_step)) return { ok: false, why: `${person.name}'s budget stops at ${person.max_step}` };
  return { ok: true };
}

export function personByPhone(people: People, phone?: string | null) {
  return Object.values(people).find((p) => p.phone && p.phone === phone);
}

export function personBySlack(people: People, id?: string | null) {
  return Object.values(people).find((p) => p.slack_user && p.slack_user === id);
}
