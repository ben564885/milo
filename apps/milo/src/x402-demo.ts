import type { Hono } from "hono";

// A local x402 endpoint to try the payment flow without a real seller. It does not verify or settle the payment.
export function mountX402Demo(app: Hono) {
  app.get("/x402/demo/:name", (c) => {
    const network = process.env.MILO_DEMO_X402_NETWORK ?? "eip155:84532";
    const amount = c.req.query("price") ?? "10000"; // atomic USDC; 10000 = $0.01
    const requirements = {
      scheme: "exact", network, amount, maxTimeoutSeconds: 60,
      asset: network === "eip155:8453" ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: process.env.MILO_DEMO_X402_PAY_TO ?? "0x000000000000000000000000000000000000dEaD",
      extra: { name: "USDC", version: "2" },
    };
    const paid = c.req.header("payment-signature") ?? c.req.header("x-payment");
    if (!paid) {
      const body = { x402Version: 2, error: "Payment required", resource: { url: c.req.url, description: `Demo ${c.req.param("name")} data`, mimeType: "application/json" }, accepts: [requirements] };
      c.header("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(body)).toString("base64"));
      return c.json(body, 402);
    }
    let payer: string | undefined;
    try { payer = JSON.parse(Buffer.from(paid, "base64").toString()).payload?.authorization?.from; } catch {}
    c.header("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({ success: true, transaction: "0xdemo", network, payer })).toString("base64"));
    return c.json({ name: c.req.param("name"), city: c.req.query("city") ?? "San Francisco", forecast: "fog, then sun", tempF: 64, paidBy: payer });
  });
}
