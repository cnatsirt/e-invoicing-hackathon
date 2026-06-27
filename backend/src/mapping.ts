import type { ComputedInvoice, DocumentCreate } from "./types.ts";
import { round2 } from "./money.ts";

const pct = (rate: number) => round2(rate * 100); // 0.21 -> 21

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

    customer_name: inv.buyer.name,
    customer_email: inv.buyer.email,
    customer_address: inv.buyer.address,
    customer_tax_id: inv.buyer.vat_number,
    customer_peppol_id:
      inv.buyer.peppol_scheme && inv.buyer.peppol_id
        ? `${inv.buyer.peppol_scheme}:${inv.buyer.peppol_id}`
        : undefined,
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
