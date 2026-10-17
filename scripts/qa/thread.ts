import { adminClient, loadIdentities } from "../../packages/shared/src/index.ts";
const s = loadIdentities().slack!;
const inkbox: any = adminClient();
const roots: any = await inkbox.slack.listMessages(s.connectionId, s.channelId, { limit: 5 });
const root = (roots.messages ?? []).find((m: any) => /getting a human answer/.test(m.text ?? ""));
const th: any = await inkbox.slack.listMessages(s.connectionId, s.channelId, { threadTs: root.ts, limit: 100 });
for (const m of th.messages ?? []) console.log("---", (m.text ?? "") + ((m.files ?? []).length ? ` [file: ${m.files.map((f: any) => f.name).join(", ")}]` : ""));
