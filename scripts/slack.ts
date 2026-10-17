/**
 * Slack setup for Milo (buzzle workspace).
 *   pnpm tsx scripts/slack.ts                 -> show connection status / install link
 *   pnpm tsx scripts/slack.ts milo-demo       -> pick channel #milo-demo, join it, save to config
 *   pnpm tsx scripts/slack.ts users           -> list Slack users (to fill slack_user in people.yaml)
 */
import { randomUUID } from "node:crypto";
import { adminClient, loadIdentities, saveIdentities } from "../packages/shared/src/index.ts";

const inkbox = adminClient();
const ids = loadIdentities();
const res: any = await inkbox.slack.listConnections(ids.milo.id);
const conns: any[] = res.connections ?? [];
const conn = conns.find((c) => c.status === "connected");
console.log("connections:", conns.map((c) => `${c.id} ${c.workspaceName ?? c.workspaceId} ${c.status}`), "setup:", JSON.stringify(res.setup ?? null));

if (!conn && res.setup?.status === "needs_credentials" && process.env.SLACK_CONFIGURATION_ACCESS_TOKEN) {
  const ws: any = await inkbox.slack.saveProvisioningWorkspace({
    accessToken: process.env.SLACK_CONFIGURATION_ACCESS_TOKEN!,
    refreshToken: process.env.SLACK_CONFIGURATION_REFRESH_TOKEN!,
  });
  console.log("saved workspace", ws.id, ws.name ?? ws.workspaceName ?? "");
  let setup: any = await inkbox.slack.startSetup(ids.milo.id, ws.id);
  const deadline = Date.now() + 120_000;
  while (setup.status === "pending" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    setup = (await inkbox.slack.listConnections(ids.milo.id) as any).setup ?? setup;
    console.log("setup:", setup.status);
  }
}

if (!conn) {
  try {
    const inst: any = await inkbox.slack.startInstallation(ids.milo.id);
    console.log("\nOpen this link to install Milo in Slack (keep it private):\n" + (inst.authorizationUrl ?? JSON.stringify(inst)));
  } catch (e: any) {
    console.log("\nCannot start installation yet:", e.detail?.message ?? e.message);
    console.log("Connect the identity in the Inkbox Console: Identities → hey-milo → Slack → buzzle.");
  }
  process.exit(0);
}

const arg = process.argv[2];
if (arg === "users") {
  const u: any = await inkbox.slack.listUsers(conn.id, { limit: 200 } as any);
  for (const x of u.users ?? []) if (!x.is_bot && !x.isBot && !x.deleted) console.log(x.id, x.real_name ?? x.realName ?? x.name);
  process.exit(0);
}

const conv: any = await inkbox.slack.listConversations(conn.id, { limit: 200 } as any);
const list: any[] = conv.conversations ?? [];
if (!arg) { console.log(list.map((c) => `#${c.name} ${c.id}`).join("\n")); process.exit(0); }
const ch = list.find((c) => c.name === arg.replace(/^#/, ""));
if (!ch) { console.log(`#${arg} not found. Create it in Slack first.`); process.exit(1); }
await inkbox.slack.joinConversation(conn.id, ch.id, { idempotencyKey: `join:${ch.id}:${randomUUID()}` }).catch((e: any) => console.log("join:", e.message));
saveIdentities({ ...ids, slack: { connectionId: conn.id, channelId: ch.id } });
console.log(`Saved Slack: connection ${conn.id}, channel #${ch.name} (${ch.id})`);
