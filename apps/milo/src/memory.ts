import { adminClient, noteAnswers, type Decision, type Person } from "@milo/shared";

const TAG = "[milo-decision]";

export type FoundDecision = { noteId: string; title: string; body: string; why: string };

/** Search Inkbox Notes for a recorded decision that already answers this question. */
export async function findDecision(question: string, file?: string): Promise<FoundDecision | undefined> {
  const inkbox = adminClient();
  const queries = [file, file?.split("/").pop(), question.split(/\s+/).filter((w) => w.length > 4).slice(0, 3).join(" ")].filter(Boolean) as string[];
  const seen = new Set<string>();
  for (const q of queries) {
    const notes = await inkbox.notes.list({ q, limit: 10, order: "recent" }).catch(() => []);
    for (const n of notes as any[]) {
      if (seen.has(n.id) || !String(n.body).includes(TAG)) continue;
      seen.add(n.id);
      const verdict = await noteAnswers(question, n.body);
      if (verdict.answers) return { noteId: n.id, title: n.title ?? "", body: n.body, why: verdict.why };
    }
  }
  return undefined;
}

export async function recordDecision(input: { question: string; file?: string; decision: Decision; requester: string }) {
  const inkbox = adminClient();
  const d = input.decision;
  const title = `Decision: ${input.file ?? input.question.slice(0, 60)}`;
  const body = [
    TAG,
    `File: ${input.file ?? "n/a"}`,
    `Question: ${input.question}`,
    `Outcome: ${d.outcome}`,
    `Answer: ${d.answer}`,
    d.instead ? `Instead: ${d.instead}` : "",
    d.choice ? `Choice: ${d.choice}` : "",
    `Decided by: ${d.decidedBy ?? "unknown"}`,
    `Source: ${d.source.channel}${d.source.ref ? ` (${d.source.ref})` : ""}`,
    `Asked by: ${input.requester}`,
    `At: ${d.at}`,
  ].filter(Boolean).join("\n");
  const note = await inkbox.notes.create({ title, body });
  return note.id as string;
}

/** Read active memories for a person (used in call briefs). */
export async function memoriesFor(person?: Person): Promise<string[]> {
  if (!person?.contact_id) return [];
  const facts = await adminClient().contacts.facts.list(person.contact_id).catch(() => []);
  return (facts as any[]).map((f) => f.content as string);
}

export async function remember(person: Person | undefined, kind: "profile" | "preference" | "context", content: string) {
  if (!person?.contact_id) return;
  try {
    await adminClient().contacts.facts.create(person.contact_id, { kind, content: content.slice(0, 500) });
  } catch (err) {
    console.warn(`[memory] could not save fact for ${person.name}:`, (err as Error).message);
  }
}
