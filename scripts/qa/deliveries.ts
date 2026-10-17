import { adminClient } from "../../packages/shared/src/index.ts";
const inkbox: any = adminClient();
const w = inkbox.webhooks;
console.log(Object.keys(w));
const res = await (w.deliveries?.list ?? w.listDeliveries)?.call(w.deliveries ?? w, { limit: 10 }).catch((e: any) => e.message);
console.log(JSON.stringify(res, null, 1)?.slice(0, 2500));
