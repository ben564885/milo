import { extractDecision } from "../../packages/shared/src/index.ts";
const q = "What background color should the transcript site use?";
const o = ["red", "green", "blue"];
for (const [t, want] of [["blue", "blue"], ["let's do green i guess", "green"], ["hmm red looks better", "red"], ["ask philip", ""], ["none of those, keep it peach", ""]] as const) {
  const x = await extractDecision(q, t, ["Ben", "Philip", "Daniel"], o);
  console.log((x.choice ?? "") === want ? "✓" : "✗", JSON.stringify(t), "→", x.outcome, x.choice || "-", x.instead || "");
}
