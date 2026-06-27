# Track 1 — Agentic E-Invoicing: Plan & Division of Labour

**Hackathon:** Agentic Commerce II · Stripe Community Brussels · 27 June 2026  
**Team:** Jimmy (data scientist / AI) + Tristan (software developer)  
**Goal:** Build end-to-end agentic e-invoicing — user sends messy input, agent produces a PEPPOL-compliant invoice + Stripe payment link + double-entry bookkeeping, automatically.

---

## What We're Building

A WhatsApp-style chat interface where a business owner sends something like:

> *"Invoice Acme Corp €500 for 3 days consulting at €600/day, 21% VAT"*  
> or a photo of a handwritten note / receipt

...and the agent:
1. Extracts all structured fields (vendor, buyer, line items, VAT, amounts, dates)
2. Confirms with the user
3. Generates a PEPPOL BIS 3.0 compliant XML invoice
4. Creates a Stripe payment link and sends it to the client
5. Logs the double-entry journal entries automatically (Debit AR / Credit Revenue)

**Live demo moment:** submit a real invoice during the hackathon and collect the cash flag on the spot.

---

## Architecture

```
User input (text / image)
        ↓
  Claude API (Jimmy)
  — extracts structured JSON from messy input
  — validates completeness, asks follow-up if needed
        ↓
  Structured Invoice JSON
        ↓
       ┌────────────────────────┬───────────────────────┐
       ↓                        ↓                       ↓
PEPPOL XML generator     Stripe payment link      Journal entries
(Tristan)                (Tristan)                (Tristan / rule-based)
       ↓                        ↓                       ↓
  XML download            Link sent to client     Debit AR / Credit Revenue
  + validation
```

Frontend: Lovable (we have free credits) — chat UI, agent trace, invoice preview.

---

## APIs & Services

| Service | Who | What For |
|---|---|---|
| **Anthropic API** (Claude) | Jimmy | Extraction, reasoning, vision (receipt photos) |
| **Stripe API** | Tristan | Generate payment links after invoice creation |
| **PEPPOL test validator** | Tristan | Validate XML — [test-validator.peppol.eu](https://test-validator.peppol.eu) (free, no access point needed) |
| **Lovable** | Both | Frontend chat UI (we have event credits) |

No other APIs needed. Keep the stack minimal.

---

## The JSON Contract (Jimmy → Tristan)

Jimmy's extraction layer outputs this JSON. Tristan's XML generator and Stripe integration consume it. **This is the interface between us.**

Fields come from three sources:
- **Claude extracts** — from user input each time
- **User profile** — set once at onboarding (seller VAT, IBAN, address)
- **Auto-computed** — invoice number (sequential), due date (issue + 30 days), all totals

```json
{
  "meta": {
    "invoice_number": "INV-2026-001",
    "invoice_type_code": "380",
    "issue_date": "2026-06-27",
    "due_date": "2026-07-27",
    "currency": "EUR"
  },
  "seller": {
    "name": "Jimmy Zhang Consulting",
    "vat_number": "BE0123456789",
    "address": "Rue Picard 11, 1000 Brussels",
    "country_code": "BE",
    "email": "jimmy@example.com",
    "iban": "BE68 5390 0754 7034",
    "bank_name": "BNP Paribas Fortis"
  },
  "buyer": {
    "name": "Acme Corp",
    "vat_number": "BE0987654321",
    "address": "Avenue Louise 1, 1050 Brussels",
    "country_code": "BE",
    "email": "accounts@acme.com",
    "buyer_reference": "PO-4521"
  },
  "line_items": [
    {
      "id": "1",
      "description": "Consulting services — June 2026",
      "quantity": 3,
      "unit_code": "DAY",
      "unit_price": 600.00,
      "vat_rate": 0.21,
      "vat_category_code": "S",
      "line_total": 1800.00
    }
  ],
  "tax_breakdown": [
    {
      "vat_category_code": "S",
      "vat_rate": 0.21,
      "taxable_amount": 1800.00,
      "tax_amount": 378.00
    }
  ],
  "totals": {
    "subtotal": 1800.00,
    "vat_amount": 378.00,
    "total": 2178.00
  },
  "journal_entries": [
    { "account": "Accounts Receivable", "debit": 2178.00, "credit": 0 },
    { "account": "VAT Payable",         "debit": 0,       "credit": 378.00 },
    { "account": "Revenue",             "debit": 0,       "credit": 1800.00 }
  ]
}
```

**Key field notes for Tristan:**
- `invoice_type_code`: always `"380"` (commercial invoice) — hardcoded
- `unit_code`: PEPPOL UN/ECE unit codes — `DAY`, `HUR` (hour), `C62` (unit/each)
- `vat_category_code`: `"S"` = standard rated (21% Belgium); `"Z"` = zero-rated; `"E"` = exempt
- `tax_breakdown`: pre-computed per VAT category — maps directly to PEPPOL `TaxSubtotal`
- `buyer_reference`: optional PO number, maps to `cbc:BuyerReference` in PEPPOL
- `journal_entries`: pre-computed — Tristan just renders these, no re-derivation needed

---

## Division of Labour

### Jimmy — Agent & Extraction Layer

**Immediate priority (unblocks Tristan):** Build the Claude extraction prompt that reliably converts any messy input into the JSON above.

- [ ] Claude extraction prompt — handles text, structured, and edge cases
- [ ] Claude vision integration — extract fields from receipt/invoice photos
- [ ] Validation layer — detect missing fields, ask follow-up questions
- [ ] Confirmation step — agent summarises extracted fields before proceeding
- [ ] Prompt hardening — test against at least 5 messy input formats

**Key fields Claude must extract reliably:**  
Seller name + VAT, buyer name + VAT + email, line items (description, qty, unit price), VAT rate (default 21% Belgium), issue date, due date, currency (default EUR).

---

### Tristan — Backend, PEPPOL & Stripe

**Immediate priority:** Set up backend skeleton + PEPPOL XML generator that consumes the JSON above.

- [ ] Backend API (FastAPI or Express) with `/extract`, `/generate-invoice`, `/create-payment-link` endpoints
- [ ] PEPPOL BIS Billing 3.0 XML generator from JSON input
- [ ] Validate XML against [test-validator.peppol.eu](https://test-validator.peppol.eu)
- [ ] Stripe payment link creation on invoice confirmation
- [ ] Double-entry journal entries (rule-based: Debit Accounts Receivable / Credit Revenue)
- [ ] PDF invoice generation (optional but good for demo)
- [ ] Wire up Lovable frontend to backend

**PEPPOL mandatory fields:** `cbc:ID` (invoice number), `cbc:IssueDate`, `cac:AccountingSupplierParty`, `cac:AccountingCustomerParty`, `cac:TaxTotal`, `cac:LegalMonetaryTotal`, `cac:InvoiceLine`. The JSON above covers all of them.

---

## Judging Criteria (what to optimise for)

The 5 criteria, in rough priority order for our build:

1. **Automation depth** — invoice → PEPPOL → double-entry with no human steps except final sign-off
2. **Trust & compliance** — PEPPOL-valid XML, correct VAT, auditable output
3. **Real-world pull** — demo must feel WhatsApp-simple
4. **Agentic execution** — working end-to-end demo that lands in 5 minutes
5. **Compelling pitch** — clear problem → demo → why it matters

---

## The 5-Minute Pitch Flow

1. *"Belgian SMEs face fines for non-compliant invoicing. Compliance tools are built for accountants, not business owners."*
2. Live demo: type or photograph messy input → agent confirms fields → PEPPOL XML generated → Stripe payment link sent
3. Show the journal entries logged automatically
4. *"The accountant just signs. Everything else is handled."*
5. If we sent the real invoice during the day: show the Stripe receipt — we already got paid.

---

## Timeline

| Time | Jimmy | Tristan |
|---|---|---|
| 11:00–12:30 | Extraction prompt + validation loop | Backend skeleton + PEPPOL XML generator |
| 12:30–13:00 | Lunch — sync on JSON contract | Lunch |
| 13:00–15:00 | Vision input (receipt photos) + prompt hardening | Stripe integration + journal entries |
| 15:00–17:00 | Integration testing with Tristan | Frontend wiring (Lovable) |
| 17:00–18:00 | Pitch prep + live demo rehearsal | Pitch prep + live demo rehearsal |
| 18:00 | **Pitches** | **Pitches** |

---

## First Steps Right Now

1. **Jimmy:** Start writing the extraction prompt — share the first version with Tristan for feedback on field completeness
2. **Tristan:** Set up the repo + backend skeleton, confirm the JSON schema above works for the PEPPOL fields you need
3. **Both:** Agree on the JSON contract so integration is clean at lunch

Repo suggestion: one shared GitHub repo, two folders — `agent/` (Jimmy) and `backend/` (Tristan), with a shared `api/` contract.
