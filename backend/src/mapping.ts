import type { ComputedInvoice, DocumentCreate } from "./types.ts";
import { round2 } from "./money.ts";

const pct = (rate: number) => round2(rate * 100); // 0.21 -> 21

// Receiver routing ID. An explicit buyer.peppol_* wins; otherwise derive it
// from the VAT number (Belgian default scheme 9925 = VAT, "9925:BE0987654321").
// create() needs this to derive the receiver, so a buyer must carry either
// peppol_* or a vat_number.
function customerPeppolId(buyer: ComputedInvoice["buyer"]): string | undefined {
  if (buyer.peppol_scheme && buyer.peppol_id) {
    return `${buyer.peppol_scheme}:${buyer.peppol_id}`;
  }
  if (buyer.vat_number) {
    return `9925:${buyer.vat_number.replace(/\s+/g, "")}`;
  }
  return undefined;
}

/**
 * Pure mapping from our internal computed invoice to e-invoice.be's flat
 * DocumentCreate body. Their schema is flat, tax_rate is a PERCENTAGE.
 */
export function toDocumentCreate(inv: ComputedInvoice): DocumentCreate {
  const overallTaxCode = inv.line_items[0]?.vat_category_code ?? "S";

  return {
    document_type: "INVOICE",
    direction: "OUTBOUND",
    invoice_id: inv.meta.invoice_number,
    invoice_date: inv.meta.issue_date,
    due_date: inv.meta.due_date,
    currency: inv.meta.currency,

    vendor_name: inv.seller.name,
    vendor_email: inv.seller.email,
    vendor_address: inv.seller.address,
    vendor_tax_id: inv.seller.vat_number,
    vendor_company_id: inv.seller.company_id,

    customer_name: inv.buyer.name,
    customer_email: inv.buyer.email,
    customer_address: inv.buyer.address,
    customer_tax_id: inv.buyer.vat_number,
    customer_peppol_id: customerPeppolId(inv.buyer),
    purchase_order: inv.buyer.buyer_reference,

    tax_code: overallTaxCode,
    subtotal: inv.totals.subtotal,
    total_tax: inv.totals.vat_amount,
    invoice_total: inv.totals.total,
    amount_due: inv.totals.total,

    payment_details: inv.seller.iban ? [{ iban: inv.seller.iban }] : undefined,
    tax_details: inv.tax_breakdown.map((t) => ({
      amount: t.tax_amount,
      rate: String(pct(t.vat_rate)),
    })),
    items: inv.line_items.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unit: li.unit_code,
      unit_price: li.unit_price,
      amount: li.line_net,
      tax: li.line_tax,
      tax_rate: pct(li.vat_rate),
    })),
  };
}
