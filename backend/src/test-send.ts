import { writeFileSync, mkdirSync } from "node:fs";
import { computeInvoice } from "./money.ts";
import { toDocumentCreate } from "./mapping.ts";
import { createDocument, sendDocument, getUbl } from "./einvoice.ts";
import { sampleInvoice } from "./sample.ts";

const DRY = process.argv.includes("--dry") || process.env.DRY_RUN === "1";

function money(n: number): string {
  return n.toFixed(2).padStart(10);
}

async function main() {
  // 1) Deterministic computation (no LLM, no network)
  const inv = computeInvoice(sampleInvoice);

  console.log(`\n=== ${inv.meta.invoice_number}  (${inv.seller.name} → ${inv.buyer.name}) ===`);
  for (const li of inv.line_items) {
    console.log(`  ${li.quantity} × ${li.unit_price} ${li.description}  net ${money(li.line_net)}  vat ${money(li.line_tax)}`);
  }
  console.log("  ----------------------------------------------");
  console.log(`  Subtotal ${money(inv.totals.subtotal)}`);
  console.log(`  VAT      ${money(inv.totals.vat_amount)}`);
  console.log(`  TOTAL    ${money(inv.totals.total)} ${inv.meta.currency}`);

  console.log("\n  Double-entry journal:");
  for (const e of inv.journal_entries) {
    console.log(`    ${e.account.padEnd(22)} Dr ${money(e.debit)}   Cr ${money(e.credit)}`);
  }

  // 2) Map to e-invoice.be's flat DocumentCreate
  const body = toDocumentCreate(inv);

  if (DRY) {
    console.log("\n[--dry] DocumentCreate body that WOULD be sent:\n");
    console.log(JSON.stringify(body, null, 2));
    console.log("\n[--dry] Skipping network calls. Remove --dry to create + send.");
    return;
  }

  // 3) Create (validates) → 4) Send (sandbox emails the UBL back) → 5) Fetch UBL
  console.log("\n→ POST /api/documents/ …");
  const created = await createDocument(body);
  console.log(`  created id=${created.id} state=${created.state ?? "?"}`);

  const email = process.env.DEMO_EMAIL ?? inv.seller.email;
  console.log(`→ POST /api/documents/${created.id}/send  (email → ${email}) …`);
  const sent = await sendDocument(created.id, {
    sender_peppol_scheme: inv.seller.peppol_scheme,
    sender_peppol_id: inv.seller.peppol_id,
    receiver_peppol_scheme: inv.buyer.peppol_scheme,
    receiver_peppol_id: inv.buyer.peppol_id,
    email,
  });
  console.log(`  sent. state=${sent.state ?? "?"}`);

  console.log(`→ GET /api/documents/${created.id}/ubl …`);
  const ubl = await getUbl(created.id);
  mkdirSync("out", { recursive: true });
  const path = `out/${inv.meta.invoice_number}.xml`;
  writeFileSync(path, ubl);
  console.log(`  saved ${ubl.length} bytes → backend/${path}`);
  console.log("\n  UBL preview:");
  console.log(ubl.split("\n").slice(0, 12).map((l) => "    " + l).join("\n"));

  console.log("\n✅ Done. A validated PEPPOL UBL invoice was created & sent via e-invoice.be.");
}

main().catch((err) => {
  console.error("\n❌ " + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
