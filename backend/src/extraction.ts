/**
 * Invoice Extraction Agent — Track 1, Agentic E-Invoicing
 *
 * Calls Groq (Llama 4 Scout) with messy user text and returns a money-free
 * RawInvoice matching the contract in types.ts.
 *
 * Rules:
 *  - LLM extracts RAW FACTS only (buyer + line items)
 *  - NO euro amounts, NO totals, NO VAT sums — money.ts handles all that
 *  - vat_rate is a FRACTION (0.21), not a percentage
 *  - Seller is NOT emitted here — it's backend-owned (seller.ts), merged in later
 */

import Groq from "groq-sdk";
import type { ExtractedFacts, RawLineItem } from "./types.ts";

const groq = new Groq(); // reads GROQ_API_KEY from env

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an invoicing agent for Belgian SMEs. Extract raw invoice facts from user input and return a single JSON object.

CRITICAL RULES:
- Return ONLY valid JSON. No prose, no markdown fences.
- Extract RAW FACTS only — NO computed amounts, NO totals, NO VAT sums.
- vat_rate MUST be a decimal fraction: 0.21 (not "21" or "21.00")
- If required buyer fields are missing, return: {"missing_fields": ["buyer.vat_number", ...], "partial_data": {...}}

OUTPUT FORMAT:
{
  "meta": {
    "issue_date": "YYYY-MM-DD",
    "due_date": "YYYY-MM-DD",
    "currency": "EUR"
  },
  "buyer": {
    "name": "<extract>",
    "vat_number": "<extract from the input — format BE followed by 10 digits, e.g. BE0XXXXXXXXX; never invent or copy this example>",
    "address": "<extract if mentioned>",
    "country_code": "BE",
    "email": "<extract>",
    "buyer_reference": "<PO number if mentioned>",
    "peppol_scheme": "9925",
    "peppol_id": "<same as vat_number>"
  },
  "line_items": [
    {
      "description": "<extract>",
      "quantity": <number>,
      "unit_code": "<DAY|HUR|C62>",
      "unit_price": <number — price per unit ONLY, never a total>,
      "vat_rate": <0.21 or 0.06 or 0.00 — FRACTION>,
      "vat_category_code": "S"
    }
  ]
}

FIELD RULES:

unit_code inference:
- "days" / "jour" / "dag" → "DAY"
- "hours" / "heures" / "uur" → "HUR"
- anything else → "C62"

vat_rate (FRACTION — not percentage):
- Default Belgium: 0.21
- Reduced: 0.06
- Zero / exempt: 0.00
- "21%" → 0.21, "6%" → 0.06, "0%" → 0.00

vat_category_code:
- rate > 0 → "S" (standard)
- rate = 0 → "Z" (zero-rated)

dates:
- issue_date: use today's date if not mentioned
- due_date: issue_date + 30 days if not mentioned

unit_price: ALWAYS the per-unit price. If user says "€1800 for 3 days", unit_price = 600.

buyer.name: the company or person being invoiced. Extract even if followed by a colon or punctuation (e.g. "Invoice OpenPeppol: ..." → buyer.name = "OpenPeppol").

description: ALWAYS in English, even if input is French or Dutch. Translate if needed (e.g. "conseil" → "consulting", "reiskosten" → "travel expenses").

DO NOT include: line totals, subtotal, VAT amounts, total, journal entries.
DO NOT include seller fields (injected by backend).

Language: user may write in English, French, or Dutch. Output ALL field values in English.

Missing fields response:
{"missing_fields": ["buyer.vat_number", "buyer.email"], "partial_data": {...}}
List ALL missing required fields at once.`;

// ---------------------------------------------------------------------------
// Extract from text
// ---------------------------------------------------------------------------
export async function extractInvoice(userMessage: string, today: string = new Date().toISOString().split("T")[0]): Promise<ExtractedFacts | { missing_fields: string[]; partial_data: unknown }> {
  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Today's date: ${today}

<user_input>
${userMessage}
</user_input>

Extract raw invoice facts and return JSON.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = JSON.parse(response.choices[0].message.content ?? "{}");

  // If missing fields flagged, return as-is for the caller to handle
  if (raw.missing_fields) return raw;

  // Raw facts only — the backend merges in the seller (see seller.ts).
  return raw as ExtractedFacts;
}

// ---------------------------------------------------------------------------
// Human-readable confirmation (shown to user before sending)
// ---------------------------------------------------------------------------
export function formatConfirmation(invoice: ExtractedFacts): string {
  const lines = invoice.line_items.map((item: RawLineItem) =>
    `  • ${item.description}: ${item.quantity} ${item.unit_code ?? "C62"} × €${item.unit_price.toFixed(2)} (+${(item.vat_rate * 100).toFixed(0)}% VAT)`
  );

  return [
    `Invoice to: ${invoice.buyer.name} (${invoice.buyer.vat_number})`,
    `Send to: ${invoice.buyer.email}`,
    `Date: ${invoice.meta.issue_date} → due ${invoice.meta.due_date ?? invoice.meta.issue_date + " +30d"}`,
    ``,
    ...lines,
    ``,
    `(Totals computed by backend — reply 'yes' to generate invoice + payment link)`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Quick test — run with: node --env-file=../.env src/extraction.ts
// ---------------------------------------------------------------------------
if (process.argv[1]?.endsWith("extraction.ts")) {
  const tests = [
    // Edge case 1: total price given, not unit price
    "Invoice Acme Corp €1800 for 3 days consulting, 21% VAT. VAT BE0848934496, accounts@acme.com",
    // Edge case 2: missing VAT number
    "Invoice Collibra for 2 days workshop at €800/day, billing@collibra.com",
    // Edge case 3: mixed VAT rates
    "Invoice OpenPeppol: €500 consulting 21% VAT + €200 travel expenses 0% VAT. BE0848934496, billing@openpeppol.org",
    // Edge case 4: French input
    "Facture pour Collibra, 2 jours de conseil à €700/jour, TVA 21%. BE0471938850, billing@collibra.com",
    // Edge case 5: fractional quantity
    "Invoice Acme Corp for half a day's work at €800/day, 21% VAT. BE0848934496, accounts@acme.com",
  ];

  for (const text of tests) {
    console.log("\n" + "=".repeat(60));
    console.log(`Input: ${text.slice(0, 70)}...`);
    console.log("=".repeat(60));
    const result = await extractInvoice(text);
    if ("missing_fields" in result) {
      console.log("⚠️  Missing:", result.missing_fields);
    } else {
      console.log(formatConfirmation(result));
      console.log("\nRawInvoice JSON:");
      console.log(JSON.stringify(result, null, 2));
    }
  }
}
