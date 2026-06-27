import type { Seller } from "./types.ts";

// The single, backend-owned seller profile. The LLM never sees or sets this —
// the extraction layer emits raw facts (buyer + line items) and the backend
// merges this in.
//
// For the e-invoice.be sandbox the sender Peppol ID must be one the tenant
// owns (GET /api/me) — currently 0208:0999465828, and create() derives it from
// vendor_tax_id (BE + CBE).
// TODO before go-live: swap for the production identity. It must be registered
// /owned on the e-invoice.be tenant, or create() rejects the sender.
export const SELLER: Seller = {
  name: "Test Company BV",
  vat_number: "BE0999465828",
  company_id: "0999465828",
  address: "Teststraat 1, 1000 Brussel, Belgium",
  country_code: "BE",
  email: "tristan@cott.am",
  iban: "BE68539007547034",
  bank_name: "BNP Paribas Fortis",
  peppol_scheme: "0208", // BE CBE/enterprise number
  peppol_id: "0999465828",
};
