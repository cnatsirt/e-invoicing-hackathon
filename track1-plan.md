# Track 1 — Agentic E-Invoicing: Plan & Division of Labour

**Hackathon:** Agentic Commerce II · Stripe Community Brussels · 27 June 2026  
**Team:** Jimmy (data scientist / AI) + Tristan (software developer)  
**Goal:** Build end-to-end agentic e-invoicing — user sends messy input, agent produces a PEPPOL-compliant invoice + Stripe payment link + double-entry bookkeeping, automatically.

---

## What We're Building

A WhatsApp-style chat interface where a business owner sends something like:

> *"Invoice Acme Corp for 3 days consulting at €600/day, 21% VAT"*  
> or a photo / PDF of a handwritten note / receipt

...and the agent:
1. Extracts the **raw facts** (buyer, line items, VAT rate, dates) — amounts are computed in code, not by the AI
2. Confirms with the user
3. Generates a PEPPOL BIS 3.0 invoice via the **e-invoice.be API** (JSON → validated UBL) and **sends it over Peppol**
4. Creates a Stripe payment link and sends it to the client
5. Logs the double-entry journal entries automatically (Dr AR / Cr Revenue / Cr VAT Payable)

> **We do NOT hand-roll UBL XML.** e-invoice.be (Track 1 sponsor; their CTO is a judge) is a JSON-in → valid-UBL-out certified Peppol access point with a free sandbox. We POST flat JSON, they generate EN16931/schematron-valid UBL and route it. Building on the sponsor's rails = faster, more reliable, and the strongest possible compliance story. The cash flags ("compliant invoices created earn immediate payment") almost certainly fire through their pipeline.

**Live demo moment:** submit a real invoice during the hackathon → collect the cash flag on the spot.

---

## Architecture

```
User input (chat text / voice transcript)          PDF / photo of a document
        ↓                                                   ↓
  Claude API (Jimmy)                              e-invoice.be PDF conversion
  — extracts RAW FACTS only (buyer + line           POST /api/documents/pdf
    items), money-free RawInvoice JSON              (their OCR — we don't build vision)
  — validates completeness, asks follow-up
        ↓
  RawInvoice JSON  (no euro amounts)
        ↓
  Backend money engine (Tristan · TypeScript · money.ts)
  — computeInvoice(): derives every line/VAT/total + double-entry journal
  — EN16931 per-category VAT, balanced books asserted (the LLM touches no euros)
        ↓
  ComputedInvoice  →  toDocumentCreate()  →  flat DocumentCreate
        ↓
       ┌────────────────────────┬───────────────────────┐
       ↓                        ↓                       ↓
 e-invoice.be API         Stripe API              Journal entries
 POST /api/documents/     (payment link)          (already computed
 POST /{id}/send   →      (Tristan — TODO)         in money.ts)
 GET  /{id}/ubl                  ↓                 Dr AR / Cr Revenue
 Validated UBL            Link sent to client       / Cr VAT Payable
 sent over Peppol
```

Frontend: Lovable (we have free credits) — chat UI, agent trace, invoice preview.

---

## APIs & Services

| Service | Who | What For |
|---|---|---|
| **Groq API** (Llama 4 Scout) | Jimmy | Extract raw facts from messy chat/voice text into a money-free `RawInvoice` |
| **e-invoice.be API** | Tristan | JSON → validated PEPPOL UBL + send over Peppol; PDF/photo → structured doc (OCR) |
| **Stripe API** | Tristan | Generate payment links after invoice creation (TODO) |
| **Lovable** | Both | Frontend chat UI (we have event credits) |

Keep the stack minimal. e-invoice.be replaces the XML generator, the validator (it validates on create), **and** document vision — `POST /api/documents/pdf` / `/api/conversion/pdf` OCR a PDF into a document, so we don't build Claude vision. The backend is plain **TypeScript on Node 24** (native type-stripping, zero build) — not FastAPI/Express.

Secrets live in `backend/.env` (`EINVOICE_API_KEY`; see `backend/.env.example`).

---

## The JSON Contract (Jimmy → Tristan)

Jimmy's extraction layer outputs a **money-free `RawInvoice`** — raw facts only. The backend's money engine (`money.ts`) computes every euro amount and the journal; the mapping layer (`mapping.ts`) turns that into e-invoice.be's flat body. **`RawInvoice` (in `backend/src/types.ts`) is the interface between us.**

> Hard rule: the extraction layer emits **no euro amounts** — no line totals, no subtotal/VAT/total, no journal. `vat_rate` is a **fraction** (`0.21`), not a percentage. If the LLM output contains a computed total, it's wrong. This is what lets us claim "the AI never touches a euro."

Fields come from three sources:
- **Claude extracts** — buyer + line items, from user input each time
- **Seller profile** — set once; held by the backend (`sample.ts`), injected at compute time
- **Auto-computed by the backend** — invoice number (sequential), due date (issue + 30 days), all line/VAT/totals, tax breakdown, journal entries

```jsonc
// RawInvoice — what Jimmy's extractor emits (money-free)
{
  "meta": {
    "issue_date": "2026-06-27",
    "due_date": "2026-07-27",     // optional — backend defaults to issue + 30d
    "currency": "EUR"             // optional — defaults EUR
  },
  "seller": {                     // from profile (backend holds this; shown for completeness)
    "name": "Jimmy Zhang Consulting",
    "vat_number": "BE0123456789",
    "address": "Rue Picard 11, 1000 Brussels",
    "country_code": "BE",
    "email": "jimmy@example.com",
    "iban": "BE68539007547034",
    "bank_name": "BNP Paribas Fortis"
  },
  "buyer": {
    "name": "Acme Corp",
    "vat_number": "BE0987654321",
    "address": "Avenue Louise 1, 1050 Brussels",
    "country_code": "BE",
    "email": "accounts@acme.com",
    "buyer_reference": "PO-4521", // optional PO number
    "peppol_scheme": "9925",      // EAS code: 9925 = BE VAT, 0208 = BE CBE
    "peppol_id": "BE0987654321"
  },
  "line_items": [
    {
      "description": "Consulting services — June 2026",
      "quantity": 3,
      "unit_code": "DAY",         // UN/ECE: DAY, HUR, C62 (each)
      "unit_price": 600.00,
      "vat_rate": 0.21,           // FRACTION, not percentage
      "vat_category_code": "S"    // optional — backend defaults S (rate>0) / Z
    }
  ]
}
```

The backend's `computeInvoice()` turns that into a `ComputedInvoice` — adding `line_net`/`line_tax` per item, a per-category `tax_breakdown`, `totals` (`subtotal`/`vat_amount`/`total`), and the balanced `journal_entries` (Dr AR / Cr Revenue / Cr VAT Payable). All deterministic, all in code.

**Key field notes:**
- `document_type` is always `"INVOICE"`, `direction` `"OUTBOUND"` — set by the mapping layer
- `unit_code`: UN/ECE unit codes — `DAY`, `HUR` (hour), `C62` (unit/each)
- `vat_rate`: fraction (`0.21`); the mapping layer converts to the percentage (`21`) e-invoice.be wants
- `vat_category_code`: `"S"` = standard (21% BE); `"Z"` = zero-rated; `"E"` = exempt — optional, backend defaults from the rate
- `peppol_scheme`/`peppol_id`: combined to `customer_peppol_id` (`"9925:BE0987654321"`); the seller's scheme is hardcoded `9925`
- `buyer_reference`: optional PO number → `purchase_order`
- `tax_breakdown` / `journal_entries`: computed by `money.ts`, **not** part of the handoff

---

## e-invoice.be Integration (Outbound) — Tristan ✅ built (`backend/src/einvoice.ts`)

**Auth:** `Authorization: Bearer $EINVOICE_API_KEY` (from `backend/.env`). Base URL `https://api.e-invoice.be` (override via `EINVOICE_BASE_URL`). Implemented with plain `fetch`, no SDK. Sandbox = free; on create it validates + serializes like prod, and `/send` with an `email` param emails the UBL back instead of routing (perfect for the demo).

**Flow (driven by `backend/src/test-send.ts`, `--dry` for offline):**
1. `POST /api/documents/` — body is the **flat** `DocumentCreate` from `toDocumentCreate()`. Returns `{ id, state }`. Validates here; errors surface as readable hints (`asError`).
2. `POST /api/documents/{id}/send` — Peppol IDs as **query params**: `sender_peppol_scheme`, `sender_peppol_id`, `receiver_peppol_scheme`, `receiver_peppol_id`, and `email` (sandbox delivery). No body.
3. `GET /api/documents/{id}/ubl` — fetch the generated UBL XML; saved to `backend/out/<INV>.xml` for the demo.

**Inbound / photos:** `POST /api/documents/pdf` and `POST /api/conversion/pdf` OCR a PDF into a structured document — this is our "vision," and the path for the inbound stretch goal.

> Peppol IDs: Belgian companies use scheme `0208` (enterprise/CBE number) or `9925` (BE VAT). Verify a receiver with `GET /api/lookup` / `GET /api/validate/peppol-id` before send.

**Mapping: `ComputedInvoice` → `DocumentCreate` (`toDocumentCreate()`; their schema is FLAT, `tax_rate` is a percentage like `21`, not `0.21`):**

| Computed invoice | e-invoice.be field |
|---|---|
| `meta.invoice_number` | `invoice_id` |
| `meta.issue_date` | `invoice_date` |
| `meta.due_date` | `due_date` |
| `meta.currency` | `currency` |
| (constant) | `document_type` = `"INVOICE"`, `direction` = `"OUTBOUND"` |
| `seller.name` / `vat_number` / `address` / `email` | `vendor_name` / `vendor_tax_id` / `vendor_address` / `vendor_email` |
| `seller.iban` | `payment_details[0].iban` |
| `buyer.name` / `vat_number` / `address` / `email` | `customer_name` / `customer_tax_id` / `customer_address` / `customer_email` |
| `buyer.peppol_scheme`+`peppol_id` | `customer_peppol_id` (`"scheme:id"`) |
| `buyer.buyer_reference` | `purchase_order` |
| `line_items[]` | `items[]`: `description`, `quantity`, `unit_code`→`unit`, `unit_price`, `line_net`→`amount`, `line_tax`→`tax`, `vat_rate*100`→`tax_rate` |
| `tax_breakdown[]` | `tax_details[]`: `tax_amount`→`amount`, `vat_rate*100`→`rate` (string) |
| `totals.subtotal` / `vat_amount` / `total` | `subtotal` / `total_tax` / `invoice_total` (also `amount_due`) |
| first line's `vat_category_code` | `tax_code` |

`RawInvoice` → `computeInvoice()` → `ComputedInvoice` → `toDocumentCreate()` → `DocumentCreate`. The computed invoice is the internal source of truth; the mapping is a small pure function.

---

## Division of Labour

### Jimmy — Agent & Extraction Layer (`backend/src/extraction.ts`)

**Done:** `extraction.ts` — Groq (Llama 4 Scout) extracts money-free `RawInvoice` from messy text, matching `types.ts` exactly.

- [x] Groq extraction — emits `RawInvoice`, multilingual (EN/FR/NL)
- [x] `vat_rate` as fraction (0.21), no amounts, no totals
- [x] `formatConfirmation()` — human-readable summary before sending
- [x] Missing fields detection
- [ ] Prompt hardening — test against 5+ messy input formats
- [ ] Wire into HTTP endpoint so frontend can call it
- [x] ~~Python agent~~ — replaced by `backend/src/extraction.ts`
- [x] ~~Claude vision~~ — dropped; e-invoice.be `POST /api/documents/pdf` OCRs PDFs/photos

**Key fields extracted:**  
Buyer name + VAT + email + address, line items (description, qty, `unit_code`, `unit_price`, `vat_rate` as fraction), issue date. Seller from profile; all amounts backend-computed.

### Tristan — Backend, PEPPOL & Stripe (`backend/`)

**Done:** TypeScript backend (Node 24, zero build) — deterministic money engine + mapping + e-invoice.be client, working end-to-end via `test-send.ts`.

- [x] Deterministic money engine — line/VAT/totals + balanced journal in code, NOT the LLM (`money.ts`)
- [x] `toDocumentCreate()` mapping function (`mapping.ts`)
- [x] e-invoice.be `POST /documents` → `POST /{id}/send` (sandbox key from `.env`, `email` delivery) (`einvoice.ts`)
- [x] Fetch generated UBL (`GET /{id}/ubl`) — saved to `out/<INV>.xml`
- [ ] Stripe payment link creation on invoice confirmation
- [ ] Glue: accept Jimmy's `RawInvoice` (HTTP endpoint or import) instead of the `sample.ts` fixture
- [ ] Wire up Lovable frontend to backend
- [ ] PDF invoice generation (optional — or reuse e-invoice.be's PDF)

**Compliance is handled by e-invoice.be** — they generate EN16931/schematron-valid UBL and validate on create. We just send correct, complete JSON.

---

## STRETCH (post-MVP only) — Inbound / Auto-Booking Purchases

**Do NOT start until the outbound demo is end-to-end and rehearsed.** Outbound alone is a complete, winning demo. Inbound roughly doubles the "accountant just signs" story (covers Accounts Payable too) but adds nothing if outbound is shaky.

- [ ] Poll `GET /api/inbox/invoices` (simpler than webhooks for a demo) or register `POST /api/webhooks/`
- [ ] Use `POST /api/documents/pdf` to OCR a supplier PDF into a document
- [ ] Reuse the bookkeeping engine to book a *purchase*: Dr Expense / Dr VAT recoverable / Cr Accounts Payable
- [ ] Demo: feed a sample supplier invoice → agent books it → ledger shows sale **and** purchase, balanced

> Sandbox sends don't route to real third parties, so for the inbound demo, feed a sample supplier document into the handler manually — identical code path.

---

## Judging Criteria (what to optimise for)

1. **Automation depth** — invoice → PEPPOL → double-entry, no human steps except sign-off
2. **Trust & compliance** — PEPPOL-valid, correct VAT, auditable
3. **Real-world pull** — WhatsApp-simple for an SME
4. **Agentic execution** — working demo, agent has real authority
5. **Compelling pitch** — 5 minutes, tight narrative

---

## The 5-Minute Pitch Flow

1. *"Belgian SMEs face fines for non-compliant invoicing. Compliance tools are built for accountants, not business owners with a phone."*
2. Live demo: type or photo → agent confirms fields → PEPPOL invoice transmitted via e-invoice.be (show the real UBL) → Stripe payment link sent
3. Show journal entries logged automatically — *"deterministic code does the accounting, the AI never touches a euro amount."*
4. *"The accountant just signs. Everything else is handled."*
5. Show the Stripe receipt if paid during the day, and the cash flag earned for a real compliant invoice.
6. (If inbound stretch landed) *"...and it works both ways"* — supplier invoice arrives, books itself, ledger stays balanced.

---

## Timeline

| Time | Jimmy | Tristan |
|---|---|---|
| Now → 12:30 | Extraction prompt → `RawInvoice` + validation loop | ✅ money engine + e-invoice.be client (done) → Stripe |
| 12:30–13:00 | Lunch — integration sync on `RawInvoice` | Lunch |
| 13:00–15:00 | Prompt hardening + follow-up loop | Glue (accept `RawInvoice`) + Lovable frontend |
| 15:00–17:00 | End-to-end integration testing | End-to-end integration testing |
| 17:00–18:00 | Pitch prep + demo rehearsal | Pitch prep + demo rehearsal |
| 18:00 | **Pitches** | **Pitches** |

---

## Repo Structure

```
e-invoicing-hackathon/
├── agent/                  # Jimmy — Claude extraction → RawInvoice
│   └── extraction_prompt.py
├── backend/                # Tristan — TypeScript (Node 24, zero build)
│   ├── src/
│   │   ├── types.ts        # RawInvoice / ComputedInvoice / DocumentCreate
│   │   ├── money.ts        # deterministic money engine + journal
│   │   ├── mapping.ts      # toDocumentCreate()
│   │   ├── einvoice.ts     # e-invoice.be client (create / send / ubl)
│   │   ├── sample.ts       # sample RawInvoice fixture
│   │   └── test-send.ts    # end-to-end CLI (--dry)
│   └── .env.example        # EINVOICE_API_KEY template
├── api/                    # shared contract (placeholder)
├── openapi.json            # e-invoice.be API spec (reference)
└── track1-plan.md
```
