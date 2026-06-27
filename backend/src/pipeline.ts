/**
 * Full pipeline: messy text → Groq extraction → deterministic money engine →
 * e-invoice.be create + send + UBL. One command:
 *
 *   npm run pipeline -- "Invoice Acme for 3 days at €600/day, 21% VAT, BE0987654321"
 *   npm run pipeline -- --dry "<message>"     # stop before any network call
 *
 * Closes the "glue: accept RawInvoice" TODO — this is what the frontend calls.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { extractInvoice, formatConfirmation } from "./extraction.ts";
import { computeInvoice } from "./money.ts";
import { toDocumentCreate } from "./mapping.ts";
import { createDocument, sendDocument, getUbl } from "./einvoice.ts";
import { createPaymentLink } from "./stripe.ts";
import { SELLER } from "./seller.ts";
import type { RawInvoice } from "./types.ts";

const DRY = process.argv.includes("--dry");
const message = process.argv
  .slice(2)
  .filter((a) => a !== "--dry")
  .join(" ")
  .trim();

function money(n: number): string {
  return n.toFixed(2).padStart(10);
}

async function main() {
  if (!message) {
    throw new Error('Provide an invoice message, e.g. npm run pipeline -- "Invoice Acme …"');
  }

  // 1) Extract RAW FACTS via Groq (no euros — money.ts owns every amount)
  console.log(`\n→ extracting via Groq: "${message.slice(0, 72)}${message.length > 72 ? "…" : ""}"`);
  const extracted = await extractInvoice(message);
  if ("missing_fields" in extracted) {
    console.log("⚠️  Missing required fields:", extracted.missing_fields);
    return;
  }

  // The seller is backend-owned config (seller.ts), never extracted. Merge it
  // into the raw facts to form the complete RawInvoice.
  const raw: RawInvoice = { ...extracted, seller: SELLER };

  console.log("\n" + formatConfirmation(raw));

  // 2) Deterministic money engine + double-entry journal
  const inv = computeInvoice(raw);
  console.log(`\n  Subtotal ${money(inv.totals.subtotal)}`);
  console.log(`  VAT      ${money(inv.totals.vat_amount)}`);
  console.log(`  TOTAL    ${money(inv.totals.total)} ${inv.meta.currency}`);
  for (const e of inv.journal_entries) {
    console.log(`    ${e.account.padEnd(22)} Dr ${money(e.debit)}   Cr ${money(e.credit)}`);
  }

  // 3) Map to e-invoice.be's flat DocumentCreate
  const body = toDocumentCreate(inv);
  if (DRY) {
    console.log("\n[--dry] DocumentCreate body that WOULD be sent:\n");
    console.log(JSON.stringify(body, null, 2));
    console.log("\n[--dry] Skipping network calls.");
    return;
  }

  // 4) create (validates) → send (sandbox emails the UBL) → fetch UBL
  console.log("\n→ POST /api/documents/ …");
  const created = await createDocument(body);
  console.log(`  created id=${created.id} state=${created.state ?? "?"}`);

  const email = process.env.DEMO_EMAIL ?? inv.seller.email;
  console.log(`→ POST /api/documents/${created.id}/send  (email → ${email}) …`);
  const sent = await sendDocument(created.id, {
    sender_peppol_scheme: inv.seller.peppol_scheme,
    sender_peppol_id: inv.seller.peppol_id,
    receiver_peppol_scheme: inv.buyer.peppol_scheme ?? "9925",
    receiver_peppol_id: inv.buyer.peppol_id ?? inv.buyer.vat_number,
    email,
  });
  console.log(`  sent. state=${sent.state ?? "?"}`);

  console.log(`→ GET /api/documents/${created.id}/ubl …`);
  const ubl = await getUbl(created.id);
  mkdirSync("out", { recursive: true });
  const path = `out/${inv.meta.invoice_number}.xml`;
  writeFileSync(path, ubl);
  console.log(`  saved ${ubl.length} bytes → backend/${path}`);

  // 5) Stripe payment link for the invoice total. Non-fatal: the compliance
  // flow already succeeded, so a Stripe config issue must not fail the run.
  console.log("→ creating Stripe payment link …");
  try {
    const pay = await createPaymentLink(inv);
    console.log(`  payment link: ${pay.url}`);
  } catch (e) {
    console.log(`  ⚠️  Stripe skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log("\n✅ Full pipeline OK: text → Groq → money engine → validated PEPPOL UBL sent.");
}

main().catch((err) => {
  console.error("\n❌ " + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
