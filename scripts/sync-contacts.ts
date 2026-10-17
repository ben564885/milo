// Keep Inkbox contacts in sync with config/people.yaml (phones, emails).
import { adminClient, loadPeople } from "../packages/shared/src/index.ts";
const inkbox = adminClient();
const contacts: any[] = await inkbox.contacts.list();
for (const p of Object.values(loadPeople())) {
  const c = contacts.find((c) => c.givenName === p.name && c.notes === "milo-demo")
    ?? contacts.find((c) => p.phone && c.phones?.some((x: any) => x.value === p.phone));
  const phones = p.phone ? [{ value: p.phone, label: "mobile", isPrimary: true }] : [];
  const emails = p.email ? [{ value: p.email, label: "work", isPrimary: true }] : [];
  if (!c) { await inkbox.contacts.create({ givenName: p.name, notes: "milo-demo", phones, emails }); console.log("+", p.name); continue; }
  const hasPhone = !p.phone || c.phones?.some((x: any) => x.value === p.phone);
  if (!hasPhone) { await inkbox.contacts.update(c.id, { phones } as any); console.log("~", p.name, p.phone); }
  else console.log("=", p.name);
}
