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
    name: "Jimmy Zhang Consulting",
    vat_number: "BE0123456789",
    address: "Rue Picard 11, 1000 Brussels, Belgium",
    country_code: "BE",
    email: "jimmy@example.com",
    iban: "BE68539007547034",
    bank_name: "BNP Paribas Fortis",
  },
  buyer: {
    name: "Acme Corp",
    vat_number: "BE0987654321",
    address: "Avenue Louise 1, 1050 Brussels, Belgium",
    country_code: "BE",
    email: "accounts@acme.com",
    buyer_reference: "PO-4521",
    peppol_scheme: "9925", // Belgian VAT
    peppol_id: "BE0987654321",
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
