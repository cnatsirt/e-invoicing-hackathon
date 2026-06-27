// The internal "rich contract" — this is the source of truth in our system.
// Jimmy's extraction layer produces the RAW facts (parties + line items).
// Our deterministic money engine (money.ts) fills in every euro amount.
// NOTHING here is computed by the LLM.

export interface Party {
  name: string;
  vat_number?: string;
  address?: string;
  country_code?: string; // ISO 3166-1 alpha-2, e.g. "BE"
  email?: string;
}

export interface Seller extends Party {
  iban?: string;
  bank_name?: string;
  company_id?: string; // CBE/enterprise number, e.g. "0999465828"
  peppol_scheme?: string; // our own EAS code, e.g. "0208" (BE CBE)
  peppol_id?: string; // our own participant id — the sender
}

export interface Buyer extends Party {
  buyer_reference?: string; // PO number
  peppol_scheme?: string; // EAS code, e.g. "9925" (BE VAT) or "0208" (BE CBE)
  peppol_id?: string; // the participant identifier
}

// VAT rate is a FRACTION here (0.21), not a percentage. The mapping layer
// converts to the percentage form e-invoice.be expects (21).
export interface RawLineItem {
  description: string;
  quantity: number;
  unit_code?: string; // UN/ECE: DAY, HUR, C62 (each)...
  unit_price: number;
  vat_rate: number; // 0.21
  vat_category_code?: string; // "S" standard, "Z" zero, "E" exempt, "AE" reverse charge
}

export interface RawInvoice {
  meta: {
    invoice_number?: string; // auto-generated if absent
    issue_date: string; // YYYY-MM-DD
    due_date?: string; // defaults to issue + 30d
    currency?: string; // defaults to EUR
  };
  seller: Seller;
  buyer: Buyer;
  line_items: RawLineItem[];
}

// ---- Computed (deterministic) ----

export interface ComputedLine extends RawLineItem {
  vat_category_code: string;
  line_net: number; // quantity * unit_price
  line_tax: number; // line_net * vat_rate
}

export interface TaxBreakdownRow {
  vat_category_code: string;
  vat_rate: number; // fraction
  taxable_amount: number;
  tax_amount: number;
}

export interface JournalEntry {
  account: string;
  debit: number;
  credit: number;
}

export interface ComputedInvoice {
  meta: Required<RawInvoice["meta"]>;
  seller: Seller;
  buyer: Buyer;
  line_items: ComputedLine[];
  tax_breakdown: TaxBreakdownRow[];
  totals: { subtotal: number; vat_amount: number; total: number };
  journal_entries: JournalEntry[];
}

// ---- e-invoice.be DocumentCreate (flat) — only the fields we send ----

export interface DocumentCreateItem {
  description: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  amount: number; // line net
  tax: number; // line VAT amount
  tax_rate: number; // percentage, e.g. 21
}

export interface DocumentCreate {
  document_type: "INVOICE";
  direction: "OUTBOUND";
  invoice_id: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  note?: string;

  vendor_name: string;
  vendor_email?: string;
  vendor_address?: string;
  vendor_tax_id?: string;
  vendor_company_id?: string; // resolves the sender Peppol ID (scheme 0208)

  customer_name: string;
  customer_email?: string;
  customer_address?: string;
  customer_tax_id?: string;
  customer_peppol_id?: string;
  purchase_order?: string;

  tax_code: string;
  subtotal: number;
  total_tax: number;
  invoice_total: number;
  amount_due: number;

  payment_details?: Array<{ iban?: string; swift?: string; payment_reference?: string }>;
  tax_details?: Array<{ amount: number; rate: string }>;
  items: DocumentCreateItem[];
}
