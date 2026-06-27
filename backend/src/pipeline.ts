/**
 * Full pipeline: messy text → Groq extraction → deterministic money engine →
 * e-invoice.be create + send + UBL. One command:
 *
 *   npm run pipeline -- "Invoice Acme for 3 days at €600/day, 21% VAT, BE0987654321"
 *   npm run pipeline -- --dry "<message>"     # stop before any network call
 *
 * Closes the "glue: accept RawInvoice" TODO — this is what the frontend calls.
 */
import { extractFromMessage, sendInvoice } from "./invoice.ts";

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

  console.log(`\n→ extracting via Groq: "${message.slice(0, 72)}${message.length > 72 ? "…" : ""}"`);
  const extracted = await extractFromMessage(message);
  if (extracted.status === "incomplete") {
    console.log("⚠️  Missing required fields:", extracted.missing_fields);
    return;
  }

  const { raw, computed: inv } = extracted;
  console.log("\n" + extracted.confirmation);
  console.log(`\n  Subtotal ${money(inv.totals.subtotal)}`);
  console.log(`  VAT      ${money(inv.totals.vat_amount)}`);
  console.log(`  TOTAL    ${money(inv.totals.total)} ${inv.meta.currency}`);
  for (const e of inv.journal_entries) {
    console.log(`    ${e.account.padEnd(22)} Dr ${money(e.debit)}   Cr ${money(e.credit)}`);
  }

  if (DRY) {
    console.log("\n[--dry] Skipping network calls.");
    return;
  }

  console.log("\n→ sending via e-invoice.be + Stripe …");
  const sent = await sendInvoice(raw);
  console.log(`  document id=${sent.document_id} state=${sent.document_state ?? "?"}`);
  console.log(`  saved UBL → backend/${sent.ubl_path}`);
  if (sent.payment_link_url) {
    console.log(`  payment link: ${sent.payment_link_url}`);
  } else if (sent.payment_link_error) {
    console.log(`  ⚠️  Stripe skipped: ${sent.payment_link_error}`);
  }

  console.log("\n✅ Full pipeline OK: text → Groq → money engine → validated PEPPOL UBL sent.");
}

main().catch((err) => {
  console.error("\n❌ " + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
