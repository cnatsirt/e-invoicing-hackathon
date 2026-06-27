# Track 1 — Agentic E-Invoicing: Plan & Division of Labour

**Hackathon:** Agentic Commerce II · Stripe Community Brussels · 27 June 2026  
**Team:** Jimmy (data scientist / AI) + Tristan (software developer)  
**Goal:** Build end-to-end agentic e-invoicing — user sends messy input, agent produces a PEPPOL-compliant invoice + Stripe payment link + double-entry bookkeeping, automatically.

---

## What We're Building

A WhatsApp-style chat interface where a business owner sends something like:

> *"Invoice Acme Corp for 3 days consulting at €600/day, 21% VAT"*  
> or a photo of a handwritten note / receipt

...and the agent:
1. Extracts all structured fields (vendor, buyer, line items, VAT, amounts, dates)
2. Confirms with the user
3. Generates a PEPPOL BIS 3.0 invoice via the **e-invoice.be API** (JSON → validated UBL) and **sends it over Peppol**
4. Creates a Stripe payment link and sends it to the client
5. Logs the double-entry journal entries automatically (Dr AR / Cr Revenue / Cr VAT Payable)

> **We do NOT hand-roll UBL XML.** e-invoice.be (Track 1 sponsor; their CTO is a judge) is a JSON-in → valid-UBL-out certified Peppol access point with a free sandbox. We POST flat JSON, they generate EN16931/schematron-valid UBL and route it. Building on the sponsor's rails = faster, more reliable, and the strongest possible compliance story. The cash flags ("compliant invoices created earn immediate payment") almost certainly fire through their pipeline.

**Live demo moment:** submit a real invoice during the hackathon → collect the cash flag on the spot.

---

## Architecture

```
User input (text / image)
        ↓
  Claude API (Jimmy)
  — extracts structured JSON from messy input
  — validates completeness, asks follow-up if needed
        ↓
  Structured Invoice JSON (e-invoice.be format)
        ↓
       ┌──────────────────────────┬──────────────────────┐
       ↓                          ↓                      ↓
e-invoice.be API            Stripe API             UI display
(PEPPOL transmission)   (payment link)         (journal entries
(Tristan)               (Tristan)               + confirmation)
       ↓                          ↓
Invoice sent via PEPPOL    Link sent to client
```

Frontend: Lovable (we have free credits) — chat UI, agent trace, invoice preview.

---

## APIs & Services

| Service | Who | What For |
|---|---|---|
<<<<<<< Updated upstream
| **Anthropic API** (Claude) | Jimmy | Extraction, reasoning, vision for receipt photos |
| **e-invoice.be API** | Tristan | JSON → PEPPOL UBL conversion + network transmission (replaces XML generator) |
| **Stripe API** | Tristan | Generate payment links after invoice creation |
| **Lovable** | Both | Frontend chat UI (event credits) |

**Key insight:** e-invoice.be is a certified PEPPOL Access Point. Tristan does NOT need to write an XML generator — just POST JSON to their API and they handle everything including transmission.

e-invoice.be sandbox API key: in `.env` as `E_INVOICE_API_KEY`
=======
| **Anthropic API** (Claude) | Jimmy | Extraction, reasoning, vision (receipt photos) |
| **e-invoice.be API** | Tristan | JSON → validated PEPPOL UBL + send over Peppol (replaces hand-rolled XML) |
| **Stripe API** | Tristan | Generate payment links after invoice creation |
| **Lovable** | Both | Frontend chat UI (we have event credits) |

No other APIs needed. Keep the stack minimal. e-invoice.be replaces both the XML generator *and* the test validator — it validates on create.
>>>>>>> Stashed changes

---

## The JSON Contract (Jimmy → Tristan)

Jimmy's extraction layer outputs JSON that maps **directly** to the e-invoice.be API format.
Fields prefixed with `_` are for UI display only and stripped before the API call.

```json
{
  "document_type": "INVOICE",
  "invoice_id": "INV-2026-001",
  "invoice_date": "2026-06-27",
  "due_date": "2026-07-27",
  "currency": "EUR",
  "vendor_name": "Your Company",
  "vendor_tax_id": "BE0123456789",
  "vendor_address": "Rue Picard 11, 1000 Brussels, Belgium",
  "vendor_email": "you@company.be",
  "customer_name": "Acme Corp",
  "customer_tax_id": "BE0987654321",
  "customer_address": "Avenue Louise 1, 1050 Brussels, Belgium",
  "customer_email": "accounts@acme.com",
  "purchase_order": "PO-4521",
  "items": [
    {
      "description": "Consulting services — June 2026",
      "quantity": 3,
      "unit": "DAY",
      "unit_price": 600.00,
      "amount": 1800.00,
      "tax_rate": "21.00"
    }
  ],
  "payment_term": "Payment due within 30 days",
  "payment_details": [
    {
      "iban": "BE68539007547034",
      "swift": "GEBABEBB",
      "payment_reference": "INV-2026-001"
    }
  ],
  "_totals": {
    "subtotal": 1800.00,
    "vat_amount": 378.00,
    "total": 2178.00
  },
  "_journal_entries": [
    { "account": "Accounts Receivable", "debit": 2178.00, "credit": 0 },
    { "account": "VAT Payable",         "debit": 0,       "credit": 378.00 },
    { "account": "Revenue",             "debit": 0,       "credit": 1800.00 }
  ]
}
```

**Notes:**
- `tax_rate` is a string `"21.00"`, not `0.21`
- `amount` = quantity × unit_price (pre-computed by Claude)
- `unit` codes: `DAY`, `HUR` (hours), `C62` (units/pieces)
- `purchase_order` only included if user mentions a PO number
- `_totals` and `_journal_entries` are stripped by `to_api_payload()` before sending to e-invoice.be

---

## e-invoice.be API Flow (Tristan)

Three calls, in order:

```
POST /api/validate/json     ← validate without creating anything (use during dev)
POST /api/documents/        ← create invoice (state: DRAFT)
POST /api/documents/{id}/send  ← transmit via PEPPOL
```

Base URL: `https://api.e-invoice.be`  
Auth: `Authorization: Bearer <E_INVOICE_API_KEY>`

---

## e-invoice.be Integration (Outbound) — Tristan

**Auth:** `Authorization: Bearer <SANDBOX_API_KEY>`. Base URL `https://api.e-invoice.be`.
SDKs exist (`e-invoice-api` on npm/pip) or just use `fetch`. Sandbox = free; on create it validates + serializes like prod, and `/send` with an `email` param emails the UBL back instead of routing (perfect for the demo).

**Two-call flow:**
1. `POST /api/documents/` — body is the **flat** `DocumentCreate` (mapping below). Returns `{ id, ... }`. Validates here; errors come back as readable hints.
2. `POST /api/documents/{id}/send` — Peppol IDs as **query params**: `sender_peppol_scheme`, `sender_peppol_id`, `receiver_peppol_scheme`, `receiver_peppol_id`, and `email` (sandbox delivery). No body.
3. (optional) `GET /api/documents/{id}/ubl` — fetch the generated UBL XML to show in the demo.

> Peppol IDs: Belgian companies use scheme `0208` (enterprise/CBE number) or `9925` (BE VAT). Verify a receiver with `GET /api/lookup` / `GET /api/validate/peppol-id` before send.

**Mapping: our JSON contract → `DocumentCreate` (their schema is FLAT, `tax_rate` is a percentage like `21`, not `0.21`):**

| Our contract | e-invoice.be field |
|---|---|
| `meta.invoice_number` | `invoice_id` |
| `meta.issue_date` | `invoice_date` |
| `meta.due_date` | `due_date` |
| `meta.currency` | `currency` |
| `seller.name` / `vat_number` / `address` / `email` | `vendor_name` / `vendor_tax_id` / `vendor_address` / `vendor_email` |
| `seller.iban` | `payment_details[0].iban` |
| `buyer.name` / `vat_number` / `address` / `email` | `customer_name` / `customer_tax_id` / `customer_address` / `customer_email` |
| buyer Peppol ID | `customer_peppol_id` |
| `buyer.buyer_reference` | `purchase_order` |
| `line_items[]` | `items[]`: `description`, `quantity`, `unit_price`, `line_total`→`amount`, `vat_rate*100`→`tax_rate`, line VAT→`tax`, `unit_code`→`unit` |
| `tax_breakdown[]` | `tax_details[]`: `tax_amount`→`amount`, `vat_rate*100`→`rate` (string) |
| `totals.subtotal` / `vat_amount` / `total` | `subtotal` / `total_tax` / `invoice_total` (also `amount_due`) |
| `line_items[].vat_category_code` | `tax_code` |

Keep our rich contract as the internal source of truth; this mapping is a small pure function `toDocumentCreate(contract)`.

---

## Division of Labour

### Jimmy — Agent & Extraction Layer (`agent/`)

- [x] Claude extraction prompt — text input → e-invoice.be JSON
- [x] Claude vision integration — image/receipt → e-invoice.be JSON
- [x] Validation layer — detect missing fields, ask follow-up
- [x] Confirmation formatter — human-readable summary before sending
- [x] e-invoice.be validate/create/send wrappers
- [ ] FastAPI endpoint `POST /agent/extract` — called by frontend
- [ ] FastAPI endpoint `POST /agent/confirm` — triggers create + send + Stripe
- [ ] Test extraction against 5+ messy input formats

### Tristan — Backend & Frontend (`backend/`)

<<<<<<< Updated upstream
- [ ] Stripe payment link creation after invoice confirmed
- [ ] Wire `POST /agent/confirm` to call Stripe after e-invoice.be send
- [ ] Lovable frontend: chat UI + confirmation display + journal entries
- [ ] Connect frontend to Jimmy's FastAPI endpoints
=======
**Key fields Claude must extract reliably:**  
Seller name + VAT, buyer name + VAT + email, line items (description, qty, unit price), VAT rate (default 21% Belgium), issue date, due date, currency (default EUR).

---

### Tristan — Backend, PEPPOL & Stripe

**Immediate priority:** Backend skeleton + `toDocumentCreate()` mapping + e-invoice.be create/send working against the sandbox.

- [ ] Backend API (FastAPI or Express) with `/extract`, `/generate-invoice` (create+send), `/create-payment-link` endpoints
- [ ] `toDocumentCreate(contract)` mapping function (table above)
- [ ] e-invoice.be `POST /documents` then `POST /{id}/send` (sandbox key, `email` delivery)
- [ ] Deterministic money engine: compute line totals, `tax_breakdown`, `totals`, `journal_entries` in code (NOT the LLM)
- [ ] Stripe payment link creation on invoice confirmation
- [ ] Fetch + display generated UBL (`GET /documents/{id}/ubl`) for the demo
- [ ] PDF invoice generation (optional but good for demo)
- [ ] Wire up Lovable frontend to backend

**Compliance is handled by e-invoice.be** — they generate EN16931/schematron-valid UBL and validate on create. We just send correct, complete JSON.

---

## STRETCH (post-MVP only) — Inbound / Auto-Booking Purchases

**Do NOT start until the outbound demo is end-to-end and rehearsed.** Outbound alone is a complete, winning demo. Inbound roughly doubles the "accountant just signs" story (covers Accounts Payable too) but adds nothing if outbound is shaky.

- [ ] Poll `GET /api/inbox/invoices` (simpler than webhooks for a demo) or register `POST /api/webhooks/`
- [ ] Reuse the bookkeeping engine to book a *purchase*: Dr Expense / Dr VAT recoverable / Cr Accounts Payable
- [ ] Demo: feed a sample supplier UBL → agent books it → ledger shows sale **and** purchase, balanced

> Sandbox sends don't route to real third parties, so for the inbound demo, feed a sample supplier UBL into the handler manually — identical code path.
>>>>>>> Stashed changes

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
2. Live demo: type or photo → agent confirms fields → PEPPOL invoice transmitted → Stripe payment link sent
3. Show journal entries logged automatically — *"deterministic code does the accounting, the AI never touches a euro amount."*
4. *"The accountant just signs. Everything else is handled."*
5. Show the Stripe receipt from the cash flag invoice we sent during the day.
5. Show the Stripe receipt if paid during the day, and the cash flag earned for a real compliant invoice.
6. (If inbound stretch landed) *"...and it works both ways"* — supplier invoice arrives, books itself, ledger stays balanced.

---

## Timeline

| Time | Jimmy | Tristan |
|---|---|---|
| Now → 12:30 | FastAPI endpoints + test extraction | Stripe integration + Lovable frontend |
| 12:30–13:00 | Lunch — integration sync | Lunch |
| 13:00–15:00 | Image/vision input + prompt hardening | Wire frontend to backend |
| 15:00–17:00 | End-to-end integration testing | End-to-end integration testing |
| 17:00–18:00 | Pitch prep + demo rehearsal | Pitch prep + demo rehearsal |
| 18:00 | **Pitches** | **Pitches** |

---

## Repo Structure

```
e-invoicing-hackathon/
├── agent/              # Jimmy — extraction, Claude API, e-invoice.be calls
│   └── extraction_prompt.py
├── backend/            # Tristan — Stripe, frontend wiring
├── api/                # Shared API contract (FastAPI app goes here)
├── .env                # secrets — never commit
├── .env.example        # template — safe to commit
├── .gitignore
└── requirements.txt
```
