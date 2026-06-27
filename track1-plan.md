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
3. Sends to e-invoice.be API → PEPPOL-compliant invoice transmitted automatically
4. Creates a Stripe payment link and sends it to the client
5. Displays double-entry journal entries (Debit AR / Credit Revenue)

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
| **Anthropic API** (Claude) | Jimmy | Extraction, reasoning, vision for receipt photos |
| **e-invoice.be API** | Tristan | JSON → PEPPOL UBL conversion + network transmission (replaces XML generator) |
| **Stripe API** | Tristan | Generate payment links after invoice creation |
| **Lovable** | Both | Frontend chat UI (event credits) |

**Key insight:** e-invoice.be is a certified PEPPOL Access Point. Tristan does NOT need to write an XML generator — just POST JSON to their API and they handle everything including transmission.

e-invoice.be sandbox API key: in `.env` as `E_INVOICE_API_KEY`

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

- [ ] Stripe payment link creation after invoice confirmed
- [ ] Wire `POST /agent/confirm` to call Stripe after e-invoice.be send
- [ ] Lovable frontend: chat UI + confirmation display + journal entries
- [ ] Connect frontend to Jimmy's FastAPI endpoints

---

## Judging Criteria (what to optimise for)

1. **Automation depth** — invoice → PEPPOL → double-entry, no human steps except sign-off
2. **Trust & compliance** — PEPPOL-valid, correct VAT, auditable
3. **Real-world pull** — WhatsApp-simple for an SME
4. **Agentic execution** — working demo, agent has real authority
5. **Compelling pitch** — 5 minutes, tight narrative

---

## The 5-Minute Pitch Flow

1. *"Belgian SMEs face fines for non-compliant invoicing. Compliance tools are built for accountants, not business owners."*
2. Live demo: type or photo → agent confirms fields → PEPPOL invoice transmitted → Stripe payment link sent
3. Show journal entries logged automatically
4. *"The accountant just signs. Everything else is handled."*
5. Show the Stripe receipt from the cash flag invoice we sent during the day.

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
