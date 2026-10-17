import OpenAI from "openai";
import type { Decision } from "./types.ts";

const MODEL = process.env.MILO_MODEL ?? "gpt-5.4-mini";
const hasKey = () => Boolean(process.env.OPENAI_API_KEY);
let client: OpenAI | undefined;

async function json<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T | undefined> {
  if (!hasKey()) return undefined;
  client ??= new OpenAI();
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } },
    });
    const text = res.choices[0]?.message?.content;
    return text ? (JSON.parse(text) as T) : undefined;
  } catch (err) {
    console.error("[llm]", (err as Error).message);
    return undefined;
  }
}

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "answer", "instead", "decidedBy", "choice"],
  properties: {
    outcome: { type: "string", enum: ["approved", "blocked", "redirect", "no_answer"] },
    answer: { type: "string", description: "One sentence: what the human decided." },
    instead: { type: "string", description: "What to do instead, or empty string." },
    decidedBy: { type: "string", description: "Name of the person who decided, or empty string." },
    choice: { type: "string", description: "For a choice question: what the person picked (one of the options, or what they named instead). Otherwise empty string." },
  },
};

type Extracted = { outcome: Decision["outcome"]; answer: string; instead: string; decidedBy: string; choice?: string };

/** Turn a human reply (Slack text, iMessage, or call transcript) into a decision. */
export async function extractDecision(question: string, reply: string, people: string[], options?: string[]): Promise<Extracted> {
  const out = await json<Extracted>(
    "You read a human's reply (a chat message or a call transcript) to an agent's yes/no question and return the decision. The person replying is the person who was asked, so a direct answer from them IS a decision. Short replies count: yes / yeah / yep / sure / fine / ok / sounds good / go for it / ship it = approved. no / nah / nope / don't / stop / not now = blocked. \"Don't, do X instead\" = redirect with instead X. Only if the reply just says to ask another person (\"ask Philip\", \"not sure, Philip owns it\") is it NOT a decision: return no_answer with instead \"Ask <name>\". If the reply is unrelated or unclear, return no_answer.",
    `Question the agent asked:\n${question}\n${options?.length ? `\nThis is a choice question. Suggested options: ${options.join(", ")}. The options are suggestions: if the person picks one, or names something else instead (for example \"white\"), return outcome approved and set choice to what they picked, in a word or two.\n` : ""}\nPeople who may have answered: ${people.join(", ")}\n\nReply or call transcript:\n${reply}`,
    decisionSchema,
  );
  if (out) return out;
  const picked = options?.find((o) => new RegExp(`\\b${o.toLowerCase()}\\b`).test(reply.toLowerCase()));
  return picked ? { outcome: "approved", answer: `Picked ${picked}.`, instead: "", decidedBy: "", choice: picked } : heuristicDecision(reply, people);
}

export function heuristicDecision(reply: string, people: string[]): Extracted {
  const t = reply.toLowerCase();
  const insteadMatch = reply.match(/(?:use|instead|try)\s+(?:the\s+)?([^.!\n]+)/i);
  const decidedBy = [...people].reverse().find((p) => t.includes(p.toLowerCase())) ?? "";
  const blocked = /\b(don'?t|do not|no\b|nah|nope|block|stop|👎)/i.test(reply);
  const approved = /\b(yes|yeah|yep|yup|sure|fine|go ahead|go for it|approve|ship it|sounds good|lgtm|ok\b|okay|👍)/i.test(reply);
  if (blocked) return { outcome: insteadMatch ? "redirect" : "blocked", answer: reply.trim().slice(0, 200), instead: insteadMatch?.[0] ?? "", decidedBy };
  if (approved) return { outcome: "approved", answer: reply.trim().slice(0, 200), instead: "", decidedBy };
  return { outcome: "no_answer", answer: reply.trim().slice(0, 200), instead: "", decidedBy };
}

/** Does this stored decision note answer the new question? */
export async function noteAnswers(question: string, note: string): Promise<{ answers: boolean; why: string }> {
  const out = await json<{ answers: boolean; why: string }>(
    "An agent has a new question. Decide if a recorded human decision already covers the same file or the same kind of change, so the agent can apply that decision without asking a human again. The decision may allow or block the change; either way it counts. Return answers=true if it covers it, false if it is about something unrelated.",
    `New question:\n${question}\n\nRecorded decision:\n${note}`,
    { type: "object", additionalProperties: false, required: ["answers", "why"], properties: { answers: { type: "boolean" }, why: { type: "string" } } },
  );
  if (out) return out;
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_.\/-]{4,}/g) ?? []);
  const q = words(question);
  const hits = [...words(note)].filter((w) => q.has(w));
  return { answers: hits.some((w) => w.includes(".")) || hits.length >= 3, why: `shared terms: ${hits.join(", ")}` };
}

/** Short spoken brief for Voice AI (fits in the 2,000-char reason). */
export async function callBrief(input: { person: string; requester: string; question: string; context?: string; owner?: string; ownerPhone?: string; memories: string[] }): Promise<string> {
  const out = await json<{ brief: string }>(
    "Write a call brief addressed to the phone voice agent as \"you\" (second person). Plain spoken English, under 1,000 characters. Do not write an opening greeting, do not mention AI, and never refer to the agent by name. Refer to files by a short spoken name (\"the billing code\"), never read paths or extensions aloud. Include the exact question, why it matters in one sentence, and what you must get: a yes/no decision or who decides.",
    JSON.stringify(input),
    { type: "object", additionalProperties: false, required: ["brief"], properties: { brief: { type: "string" } } },
  );
  if (out) return out.brief;
  return `${input.requester} is blocked and asks: ${input.question}${input.context ? ` Context: ${input.context.slice(0, 300)}` : ""}`;
}

export type SlackLineKind = "ask" | "texted" | "calling" | "pulling_in" | "close" | "memory" | "owner_agent" | "no_answer" | "listening" | "still_nothing";

/**
 * Write one Slack message in Milo's voice from facts. Placeholders: {who} = mention of the person
 * being addressed, {transcript} = the transcript link. Returns undefined without OpenAI.
 */
export async function slackLine(kind: SlackLineKind, facts: Record<string, unknown>): Promise<string | undefined> {
  const out = await json<{ text: string }>(
    [
      "You are Milo, an engineer on the team, writing one Slack message in a thread. You chase down decisions for coding agents.",
      "Write like a real teammate: all lowercase, no emojis, casual and short (one sentence, two at most), no corporate or robotic phrasing, no exclamation marks.",
      "Never invent facts. Use only what is in the facts. React naturally to what the person actually said.",
      "Never write an @ sign yourself. Write {who} exactly where you address or mention the person (it becomes a real @mention). Never address the coding agent; it is not in Slack. Write {transcript} exactly where the call transcript link goes, if the facts say there is one.",
      "Kinds and the shape of each (vary the wording, keep the facts):",
      "ask: first message with the question. e.g. \"hey {who}, quick one from claude code: what should the hero pill say? weekly digest emails, slack summaries, or team workspaces?\"",
      "texted: you also texted them. e.g. \"{who} texted you too\"",
      "calling: you are calling them now. e.g. \"{who} giving you a call\"",
      "pulling_in: you are adding {who} to the call. e.g. \"pulling {who} into the call\"",
      "close: the question is resolved; acknowledge their actual decision in your own words, no mention needed. e.g. \"ok, leaving the pill out\" or \"green it is, philip made the call. {transcript}\"",
      "memory: fyi someone already decided this earlier, so you didn't bother anyone. owner_agent: the owner's agent already knew.",
      "no_answer: nobody answered, holding off. listening: nobody answered yet, you'll keep an eye on the thread. still_nothing: still no answer, holding off.",
    ].join("\n"),
    JSON.stringify({ kind, ...facts }),
    { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } },
  );
  return out?.text?.trim() || undefined;
}
