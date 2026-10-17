export type Urgency = "low" | "normal" | "high";

export type AskPayload = {
  question: string;
  context?: string;
  file?: string;
  urgency?: Urgency;
  requester?: string;
  owner?: string; // person handle (from the caller repo's CODEOWNERS)
  options?: string[]; // for a choice question, e.g. ["red", "green", "blue"]
  repo?: string;
};

export type Decision = {
  outcome: "approved" | "blocked" | "redirect" | "no_answer";
  answer: string; // one-line human answer
  choice?: string; // the option picked, for a choice question
  instead?: string;
  decidedBy?: string;
  source: { channel: "memory" | "owner_agent" | "slack" | "imessage" | "call" | "none"; ref?: string };
  at: string;
};
