import { extractDecision } from "../../packages/shared/src/index.ts";
const q = "What background color should the transcript page use?";
for (const t of ["<@UMILOBOT0> lets use white", "blue", "ask philip", "idk"]) {
  const x = await extractDecision(q, t.replace(/<@[A-Z0-9]+>/g, ""), ["Ben", "Philip", "Daniel"], ["red", "green", "blue"]);
  console.log(JSON.stringify(t), "→", x.outcome, x.choice || "-");
}
