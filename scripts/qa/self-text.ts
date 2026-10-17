import { agentClient, loadIdentities } from "../../packages/shared/src/index.ts";
const { milo } = loadIdentities();
const id = await agentClient(milo.handle).getIdentity(milo.handle);
const r: any = await (id as any).sendText({ to: process.argv[2] ?? process.env.MILO_IMESSAGE_NUMBER!, text: "QA self-test from Milo phone" });
console.log("sent", r.id, r.status ?? r.deliveryStatus);
