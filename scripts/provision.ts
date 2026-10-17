// Give Milo a dedicated phone number and the dedicated iMessage line, set voice + avatar.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminClient, loadIdentities, ROOT } from "../packages/shared/src/index.ts";

const inkbox = adminClient();
const { milo } = loadIdentities();
const id = await inkbox.getIdentity(milo.handle);

if (!id.phoneNumber) {
  try { const n = await id.provisionPhoneNumber(); console.log("+ phone", (n as any).number); }
  catch (e: any) { console.log("! phone:", e.statusCode, JSON.stringify(e.detail)); }
} else console.log("= phone", (id.phoneNumber as any).number);

await id.refresh();
if (!id.imessageNumber) {
  try {
    const r = await fetch(`https://inkbox.ai/api/v1/identities/${milo.handle}`, {
      method: "PATCH",
      headers: { "X-API-Key": process.env.INKBOX_API_KEY!, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ imessage_enabled: true, claim_imessage_number: true }),
    });
    console.log(r.ok ? "+ imessage claimed" : `! imessage: ${r.status} ${await r.text()}`);
  } catch (e: any) { console.log("! imessage:", e.message); }
} else console.log("= imessage", JSON.stringify(id.imessageNumber));

await id.refresh();
console.log("phone:", JSON.stringify(id.phoneNumber));
console.log("imessage:", JSON.stringify(id.imessageNumber));
