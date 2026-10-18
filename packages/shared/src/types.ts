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
  payment?: PaymentAsk; // set when the question is "may I pay this 402 endpoint?"
};

export type Decision = {
  outcome: "approved" | "blocked" | "redirect" | "no_answer";
  answer: string; // one-line human answer
  choice?: string; // the option picked, for a choice question
  scope?: "once" | "always"; // for a payment: approved for this call only, or for this endpoint from now on
  instead?: string;
  decidedBy?: string;
  source: { channel: "memory" | "owner_agent" | "slack" | "imessage" | "call" | "none"; ref?: string };
  at: string;
};

/** An x402 payment an agent wants to make, as sent to Milo with the question. */
export type PaymentAsk = {
  endpoint: string; // "GET https://api.example.com/weather": method + origin + path, no query
  url: string; // the full URL the agent called
  amount: string; // atomic units, e.g. "10000" = 0.01 USDC
  price: string; // human price, e.g. "$0.01 USDC"
  asset: string;
  network: string; // e.g. "eip155:84532"
  payTo: string;
  description?: string;
};
