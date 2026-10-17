import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { adminClient, agentClient, loadIdentities, ROOT, type AskPayload } from "@milo/shared";
import { BOARD_HTML } from "./board.ts";
import { attachCallSockets } from "./conference.ts";
import { availability } from "./channels.ts";
import { newRequest, run, timeouts } from "./engine.ts";
import { startInbox } from "./inbox.ts";
import { mountX402Demo } from "./x402-demo.ts";
import { listApprovals, resetApprovals, revokeApproval } from "./payments.ts";
import { failInterrupted, get, list, reset } from "./store.ts";
import { handleWebhook } from "./webhooks.ts";

const PORT = Number(process.env.PORT ?? 8787);

// Keep the server up during a demo: log unexpected errors instead of crashing.
process.on("uncaughtException", (e) => console.error("[milo] uncaught:", e));
process.on("unhandledRejection", (e) => console.error("[milo] unhandled rejection:", e));
const app = new Hono();

// The Inkbox tunnel makes this server public. Only Inkbox's webhook may come in that way;
// everything else (status page, API, reset) is local-only.
app.use("*", async (c, next) => {
  // Requests through the tunnel carry forwarding headers (the tunnel rewrites Host to 127.0.0.1).
  const viaTunnel = Boolean(c.req.header("x-forwarded-for") || c.req.header("x-forwarded-host") || c.req.header("forwarded"));
  const local = !viaTunnel;
  if (!local && c.req.path !== "/hooks/inkbox") return c.text("not found", 404);
  await next();
});

app.get("/", (c) => c.html(BOARD_HTML));
app.get("/favicon.ico", (c) => c.redirect("/logo.png"));
app.get("/logo.png", (c) => {
  const p = join(ROOT, "assets/milo-avatar-512.png");
  return existsSync(p) ? c.body(readFileSync(p), 200, { "content-type": "image/png" }) : c.notFound();
});
app.get("/api/requests", (c) => c.json(list(10)));
app.get("/api/requests/:id", (c) => {
  const r = get(c.req.param("id"));
  return r ? c.json(r) : c.notFound();
});
app.get("/api/status", async (c) => c.json({ ok: true, channels: await availability(), timeouts }));

// HTTP fallback for agents that don't speak A2A. Waits up to ?wait=ms for the decision.
app.post("/api/ask", async (c) => {
  const body = (await c.req.json()) as AskPayload;
  if (!body?.question) return c.json({ error: "question is required" }, 400);
  const req = newRequest(body);
  const done = run(req);
  const wait = Number(c.req.query("wait") ?? 0);
  if (wait > 0) {
    const d = await Promise.race([done, new Promise((r) => setTimeout(() => r(undefined), wait))]);
    if (d) return c.json({ id: req.id, decision: d });
  }
  return c.json({ id: req.id, status: "running" }, 202);
});

// Standing "always approve" payment approvals, and a way to take one back.
app.get("/api/payments/approvals", (c) => c.json(listApprovals()));
app.delete("/api/payments/approvals", (c) => {
  const endpoint = c.req.query("endpoint");
  if (!endpoint) return c.json({ error: "endpoint is required, e.g. ?endpoint=GET https://api.example.com/weather" }, 400);
  return revokeApproval(endpoint) ? c.json({ ok: true }) : c.notFound();
});

mountX402Demo(app);

// Reset demo state: local requests, payment approvals, and Milo decision notes.
app.post("/api/reset", async (c) => {
  reset();
  resetApprovals();
  const notes = (await adminClient().notes.list({ q: "milo-decision", limit: 100 }).catch(() => [])) as any[];
  for (const n of notes) if (String(n.body).includes("[milo-decision]")) await adminClient().notes.delete(n.id).catch(() => {});
  return c.json({ ok: true, deletedNotes: notes.length });
});

app.post("/hooks/inkbox", async (c) => {
  const raw = await c.req.text();
  const headers = Object.fromEntries(c.req.raw.headers.entries());
  try {
    return c.body(null, (await handleWebhook(raw, headers)) as any);
  } catch (err) {
    console.error("[webhook]", err);
    return c.body(null, 500);
  }
});

const server = serve({ fetch: app.fetch, port: PORT }, () => console.log(`🦉 Milo on http://localhost:${PORT}`));
attachCallSockets(server as any);
failInterrupted();
startInbox();

if (process.env.MILO_TUNNEL !== "0") {
  const { connect } = await import("@inkbox/sdk/tunnels/connect");
  const ids = loadIdentities();
  // The listener must be awaited (wait()) or it stops serving traffic.
  const startTunnel = async (): Promise<void> => {
    try {
      const l: any = await connect(agentClient(ids.milo.handle) as any, { name: ids.milo.handle, forwardTo: `http://127.0.0.1:${PORT}` } as any);
      console.log(`🌐 Public URL: ${l.publicUrl}`);
      await l.wait();
      console.warn(`[tunnel] closed (${l.status}); reconnecting`);
    } catch (e: any) {
      console.warn("[tunnel] error:", e.message);
    }
    setTimeout(startTunnel, 3000);
  };
  void startTunnel();
}
