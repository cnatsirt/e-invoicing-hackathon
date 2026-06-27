import type { RawInvoice } from "./types.ts";

// The raw facts an extraction step would produce from:
//   "Invoice Acme Corp for 3 days consulting at €600/day, 21% VAT"
// Note: NO totals, NO tax amounts, NO journal — money.ts derives all of that.
export const sampleInvoice: RawInvoice = {
  meta: {
    issue_date: "2026-06-27",
    currency: "EUR",
  },
  seller: {
    // The sandbox tenant's own identity (GET /api/me) — required: the sender
    // Peppol ID must be one the tenant owns.
    name: "Test Company BV",
    vat_number: "BE0999465828", // create derives the sender Peppol ID from this (BE + CBE)
    company_id: "0999465828",
    address: "Teststraat 1, 1000 Brussel, Belgium",
    country_code: "BE",
    email: "tristan@cott.am",
    iban: "BE68539007547034",
    bank_name: "BNP Paribas Fortis",
    peppol_scheme: "0208", // BE CBE/enterprise number
    peppol_id: "0999465828",
  },
  buyer: {
    name: "Acme Corp",
    vat_number: "BE0987654321",
    address: "Avenue Louise 1, 1050 Brussels, Belgium",
    country_code: "BE",
    email: "accounts@acme.com",
    buyer_reference: "PO-4521",
    // No peppol_* — the backend derives "9925:BE0987654321" from vat_number,
    // mirroring what the extractor emits (buyer with just a VAT number).
  },
  line_items: [
    {
      description: "Consulting services — June 2026",
      quantity: 3,
      unit_code: "DAY",
      unit_price: 600,
      vat_rate: 0.21,
      vat_category_code: "S",
    },
  ],
};
