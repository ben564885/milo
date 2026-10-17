import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "@milo/shared";
import { slackPost, slackUpload } from "./channels.ts";
const dir = join(ROOT, "data/recordings");
const f = readdirSync(dir).map((n) => join(dir, n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const ts = await slackPost("*milo* · qa: recording upload test (simulated call)");
await slackUpload(f, ts!, "call recording (test)");
console.log("uploaded", f, "to thread", ts);
