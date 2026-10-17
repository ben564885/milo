import { slackLine } from "../../packages/shared/src/index.ts";
const base = { question: "We are adding the hero pill back. What text should it show?", options: ["new: weekly digest emails", "new: slack summaries", "now with team workspaces"], from: "Claude Code", file: "index.html" };
console.log("ask    :", await slackLine("ask", { ...base, to: "Ben" }));
console.log("close  :", await slackLine("close", { ...base, outcome: "blocked", decided_by: "Ben", decision: "Don't add the hero pill back.", what_they_said: "actually dont add it back", via: "slack" }));
console.log("close2 :", await slackLine("close", { question: "What color should the main call-to-action button be?", options: ["red","green","blue"], outcome: "approved", choice: "green", decided_by: "Philip", via: "call", on_call: ["ben","philip"], has_transcript: true }));
console.log("texted :", await slackLine("texted", { to: "Ben" }));
console.log("memory :", await slackLine("memory", { question: "What color should the main call-to-action button be?", choice: "green", decided_by: "Philip", from: "Claude Code" }));
