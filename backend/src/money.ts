import type {
  RawInvoice,
  ComputedInvoice,
  ComputedLine,
  TaxBreakdownRow,
  JournalEntry,
} from "./types.ts";

// Round to 2 decimals, half-up, EPSILON-corrected to avoid float drift
// (e.g. 1.005 -> 1.01). All money in the system passes through here.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let invoiceCounter = 0;
function nextInvoiceNumber(issueDate: string): string {
  invoiceCounter += 1;
  const year = issueDate.slice(0, 4);
  return `INV-${year}-${String(invoiceCounter).padStart(3, "0")}`;
}

/**
 * Deterministic invoice computation. Takes the raw extracted facts and
 * derives EVERY euro amount + the double-entry journal in code.
 * EN16931-aligned: per-category VAT is computed on the category's taxable
 * sum (BR-CO-17), not summed from per-line roundings.
 */
export function computeInvoice(raw: RawInvoice): ComputedInvoice {
  const currency = raw.meta.currency ?? "EUR";
  const issue_date = raw.meta.issue_date;
  const due_date = raw.meta.due_date ?? addDays(issue_date, 30);
  const invoice_number = raw.meta.invoice_number ?? nextInvoiceNumber(issue_date);

  const line_items: ComputedLine[] = raw.line_items.map((li) => {
    const vat_category_code = li.vat_category_code ?? (li.vat_rate > 0 ? "S" : "Z");
    const line_net = round2(li.quantity * li.unit_price);
    const line_tax = round2(line_net * li.vat_rate);
    return { ...li, vat_category_code, line_net, line_tax };
  });

  // Group taxable amounts by (category, rate); compute tax on the group total.
  const groups = new Map<string, TaxBreakdownRow>();
  for (const li of line_items) {
    const key = `${li.vat_category_code}|${li.vat_rate}`;
    const row = groups.get(key) ?? {
      vat_category_code: li.vat_category_code,
      vat_rate: li.vat_rate,
      taxable_amount: 0,
      tax_amount: 0,
    };
    row.taxable_amount = round2(row.taxable_amount + li.line_net);
    groups.set(key, row);
  }
  const tax_breakdown = [...groups.values()].map((row) => ({
    ...row,
    tax_amount: round2(row.taxable_amount * row.vat_rate),
  }));

  const subtotal = round2(tax_breakdown.reduce((s, r) => s + r.taxable_amount, 0));
  const vat_amount = round2(tax_breakdown.reduce((s, r) => s + r.tax_amount, 0));
  const total = round2(subtotal + vat_amount);

  // Double-entry: a sale increases an asset (AR) and is funded by revenue + a
  // VAT liability owed to the tax authority.
  const journal_entries: JournalEntry[] = [
    { account: "Accounts Receivable", debit: total, credit: 0 },
    { account: "Revenue", debit: 0, credit: subtotal },
  ];
  if (vat_amount > 0) {
    journal_entries.push({ account: "VAT Payable", debit: 0, credit: vat_amount });
  }
  assertBalanced(journal_entries);

  return {
    meta: { invoice_number, issue_date, due_date, currency },
    seller: raw.seller,
    buyer: raw.buyer,
    line_items,
    tax_breakdown,
    totals: { subtotal, vat_amount, total },
    journal_entries,
  };
}

// A correct double-entry set always balances. If this throws, the books are
// wrong and we must NOT send — that is the whole "safe to sign" guarantee.
export function assertBalanced(entries: JournalEntry[]): void {
  const debit = round2(entries.reduce((s, e) => s + e.debit, 0));
  const credit = round2(entries.reduce((s, e) => s + e.credit, 0));
  if (debit !== credit) {
    throw new Error(`Journal does not balance: debit ${debit} != credit ${credit}`);
  }
}
