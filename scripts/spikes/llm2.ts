import { extractDecision } from "../../packages/shared/src/index.ts";
const q = "Can I change the refund logic in billing.ts to call the legacy v1 charge endpoint?";
console.log(await extractDecision(q, "Human: I don't know. Let's ask Philip.\nMilo: I'm adding Philip now.\nHuman: Hi.", ["Ben", "Philip", "Daniel"]));
console.log(await extractDecision(q, "Human (Philip): No, don't change it. Use the v2 endpoint.", ["Ben", "Philip", "Daniel"]));
