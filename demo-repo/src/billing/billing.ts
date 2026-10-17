// Billing client for the demo app. Owned by Daniel (see CODEOWNERS).
const LEGACY_CHARGE_URL = "https://api.example.com/v1/charge";
const CHARGE_URL = "https://api.example.com/v2/charges";

export async function charge(customerId: string, amountCents: number) {
  const res = await fetch(CHARGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customer: customerId, amount: amountCents }),
  });
  if (!res.ok) throw new Error(`charge failed: ${res.status}`);
  return res.json();
}

export async function refund(chargeId: string) {
  // TODO: refunds still use the legacy endpoint
  const res = await fetch(`${LEGACY_CHARGE_URL}/${chargeId}/refund`, { method: "POST" });
  if (!res.ok) throw new Error(`refund failed: ${res.status}`);
  return res.json();
}
