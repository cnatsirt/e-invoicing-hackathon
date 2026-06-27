import { mkdirSync, writeFileSync } from "node:fs";
import { extractInvoice, formatConfirmation } from "./extraction.ts";
import { computeInvoice } from "./money.ts";
import { toDocumentCreate } from "./mapping.ts";
import { createDocument, sendDocument, getUbl } from "./einvoice.ts";
import { createPaymentLink } from "./stripe.ts";
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

export interface SendResult {
  document_id: string;
  document_state?: string;
  invoice_number: string;
  ubl_path: string;
  payment_link_url?: string;
  payment_link_error?: string;
  computed: ComputedInvoice;
}

export async function sendInvoice(raw: RawInvoice): Promise<SendResult> {
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

  // Non-fatal: PEPPOL already succeeded; missing Stripe key must not fail the run.
  let payment_link_url: string | undefined;
  let payment_link_error: string | undefined;
  try {
    const pay = await createPaymentLink(computed);
    payment_link_url = pay.url;
  } catch (e) {
    payment_link_error = e instanceof Error ? e.message : String(e);
  }

  return {
    document_id: created.id,
    document_state: created.state,
    invoice_number: computed.meta.invoice_number,
    ubl_path,
    payment_link_url,
    payment_link_error,
    computed,
  };
}
