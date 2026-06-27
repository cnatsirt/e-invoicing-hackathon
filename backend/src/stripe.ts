import type { ComputedInvoice } from "./types.ts";

// Stripe client — plain fetch + form-encoding (like einvoice.ts), no SDK.
const STRIPE_API = "https://api.stripe.com/v1";

function apiKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("your_")) {
    throw new Error("Missing STRIPE_SECRET_KEY. Add a Stripe test key (sk_test_…) to .env.");
  }
  return key;
}

// Stripe expects application/x-www-form-urlencoded with bracketed keys for
// nested params, e.g. "line_items[0][price]". URLSearchParams encodes that as-is.
async function stripePost<T>(path: string, form: Record<string, string>): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const data = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  }
  return data as T;
}

export interface PaymentLink {
  id: string;
  url: string;
}

/**
 * Create a Stripe Payment Link for an invoice's grand total. The total is the
 * single source of truth (computed by money.ts); we never re-derive it here.
 * Payment Links require a Price id, so we create an inline Price first.
 */
export async function createPaymentLink(inv: ComputedInvoice): Promise<PaymentLink> {
  const unitAmount = Math.round(inv.totals.total * 100); // minor units (cents)
  const currency = inv.meta.currency.toLowerCase();

  // 1) Price (auto-creates a product via product_data).
  const price = await stripePost<{ id: string }>("/prices", {
    currency,
    unit_amount: String(unitAmount),
    "product_data[name]": `Invoice ${inv.meta.invoice_number} — ${inv.buyer.name}`,
  });

  // 2) Payment Link referencing that price.
  const link = await stripePost<{ id: string; url: string }>("/payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": "1",
  });

  return { id: link.id, url: link.url };
}
