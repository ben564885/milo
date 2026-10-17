import { adminClient, loadIdentities } from "../../packages/shared/src/index.ts";
const s = loadIdentities().slack!;
const inkbox: any = adminClient();
const all: any[] = [];
let cursor: string | undefined;
do {
  const page: any = await inkbox.slack.listMessages(s.connectionId, s.channelId, { limit: 100, cursor });
  all.push(...(page.messages ?? []));
  cursor = page.nextCursor ?? undefined;
} while (cursor);
let replies = 0;
for (const m of [...all]) {
  if (Number(m.reply_count ?? m.replyCount ?? 0) > 0) {
    const th: any = await inkbox.slack.listMessages(s.connectionId, s.channelId, { threadTs: m.ts, limit: 100 });
    for (const r of th.messages ?? []) if (r.ts !== m.ts) { all.push(r); replies++; }
  }
}
const who = (m: any) => m.user ?? m.bot_id ?? m.subtype ?? "?";
const counts: Record<string, number> = {};
for (const m of all) counts[who(m)] = (counts[who(m)] ?? 0) + 1;
console.log("total", all.length, "replies", replies, counts);
console.log("sample keys", Object.keys(all[0] ?? {}).join(","));
(await import("node:fs")).writeFileSync("data/slack-msgs.json", JSON.stringify(all.map((m) => ({ ts: m.ts, user: m.user, bot_id: m.bot_id, subtype: m.subtype, text: (m.text ?? "").slice(0, 60) })), null, 1));
