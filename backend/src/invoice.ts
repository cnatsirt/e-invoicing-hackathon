import { mkdirSync, writeFileSync } from "node:fs";
import { extractInvoice, formatConfirmation } from "./extraction.ts";
import { computeInvoice } from "./money.ts";
import { toDocumentCreate } from "./mapping.ts";
import { createDocument, sendDocument, getUbl } from "./einvoice.ts";
import { assertStripeConfigured, createPaymentLink } from "./stripe.ts";
import { SELLER } from "./seller.ts";
import type { ExtractedFacts, RawInvoice, ComputedInvoice } from "./types.ts";

export type ExtractResult =
  | { status: "incomplete"; missing_fields: string[]; partial_data?: unknown }
  | {
      status: "ready";
      confirmation: string;
      raw: RawInvoice;
      computed: ComputedInvoice;
    };

export async function extractFromMessage(message: string): Promise<ExtractResult> {
  const extracted = await extractInvoice(message);
  if ("missing_fields" in extracted) {
    return {
      status: "incomplete",
      missing_fields: extracted.missing_fields,
      partial_data: extracted.partial_data,
    };
  }

  const raw: RawInvoice = { ...extracted, seller: SELLER };
  const computed = computeInvoice(raw);
  return {
    status: "ready",
    confirmation: formatConfirmation(extracted as ExtractedFacts),
    raw,
    computed,
  };
}

export interface SendOptions {
  /** Skip Stripe entirely (--no-stripe). PEPPOL still sends. */
  skipStripe?: boolean;
}

export interface SendResult {
  document_id: string;
  document_state?: string;
  invoice_number: string;
  ubl_path: string;
  payment_link_url?: string;
  computed: ComputedInvoice;
}

/** PEPPOL send succeeded but the payment link could not be created. */
export class InvoiceSentStripeFailedError extends Error {
  readonly sent: SendResult;

  constructor(sent: SendResult, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Invoice sent over Peppol but Stripe payment link failed: ${detail}`);
    this.name = "InvoiceSentStripeFailedError";
    this.sent = sent;
  }
}

/**
 * Create PEPPOL invoice + optional Stripe payment link.
 *
 * Stripe policy (Tristan):
 * - Validate key BEFORE irreversible Peppol send (unless skipStripe).
 * - If Stripe fails after send, throw InvoiceSentStripeFailedError — never
 *   return success with a missing payment link.
 */
export async function sendInvoice(raw: RawInvoice, options?: SendOptions): Promise<SendResult> {
  if (!options?.skipStripe) assertStripeConfigured();

  const computed = computeInvoice(raw);
  const body = toDocumentCreate(computed);

  const created = await createDocument(body);
  const email = process.env.DEMO_EMAIL ?? computed.seller.email;

  await sendDocument(created.id, {
    sender_peppol_scheme: computed.seller.peppol_scheme,
    sender_peppol_id: computed.seller.peppol_id,
    receiver_peppol_scheme: computed.buyer.peppol_scheme ?? "9925",
    receiver_peppol_id: computed.buyer.peppol_id ?? computed.buyer.vat_number,
    email,
  });

  const ubl = await getUbl(created.id);
  mkdirSync("out", { recursive: true });
  const ubl_path = `out/${computed.meta.invoice_number}.xml`;
  writeFileSync(ubl_path, ubl);

  const sent: SendResult = {
    document_id: created.id,
    document_state: created.state,
    invoice_number: computed.meta.invoice_number,
    ubl_path,
    computed,
  };

  if (options?.skipStripe) return sent;

  try {
    const pay = await createPaymentLink(computed);
    return { ...sent, payment_link_url: pay.url };
  } catch (e) {
    throw new InvoiceSentStripeFailedError(sent, e);
  }
}
