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

> **We do NOT hand-roll UBL XML.** e-invoice.be (Track 1 sponsor; their CTO is a judge) is a JSON-in → valid-UBL-out certified Peppol access point with a free sandbox. We POST flat JSON, they generate EN16931/schematron-valid UBL and route it. Building on the sponsor's rails = faster, more reliable, and the strongest possible compliance story.

**Live demo moment:** submit a real invoice during the hackathon → collect the cash flag on the spot.

---

## Architecture

```
User input (chat text / voice transcript)          PDF / photo of a document
        ↓                                                   ↓
  Groq API / Llama 4 Scout (Jimmy)                e-invoice.be PDF conversion
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

Keep the stack minimal. e-invoice.be replaces the XML generator, the validator (it validates on create), **and** document vision. The backend is plain **TypeScript on Node 22** (tsx runner, zero build) — not FastAPI/Express.

Secrets live in `backend/.env` (`EINVOICE_API_KEY`, `GROQ_API_KEY`; see `backend/.env.example`).

---

## The JSON Contract (Jimmy → Tristan)

Jimmy's extraction layer outputs a **money-free `RawInvoice`** — raw facts only. The backend's money engine (`money.ts`) computes every euro amount and the journal; the mapping layer (`mapping.ts`) turns that into e-invoice.be's flat body. **`RawInvoice` (in `backend/src/types.ts`) is the interface between us.**

> Hard rule: the extraction layer emits **no euro amounts** — no line totals, no subtotal/VAT/total, no journal. `vat_rate` is a **fraction** (`0.21`), not a percentage. This is what lets us claim "the AI never touches a euro."

Fields come from three sources:
- **Groq extracts** — buyer + line items, from user input each time
- **Seller profile** — set once in `extraction.ts`; injected at extraction time (never seen by the LLM)
- **Auto-computed by the backend** — invoice number, due date, all line/VAT/totals, tax breakdown, journal entries

```jsonc
// RawInvoice — what Jimmy's extractor emits (money-free)
{
  "meta": {
    "issue_date": "2026-06-27",
    "due_date": "2026-07-27",     // optional — backend defaults to issue + 30d
    "currency": "EUR"             // optional — defaults EUR
  },
  "seller": {
    // Sandbox tenant identity — matches the e-invoice.be account (GET /api/me)
    "name": "Test Company BV",
    "vat_number": "BE0999465828",
    "company_id": "0999465828",   // CBE number — drives sender Peppol ID (scheme 0208)
    "address": "Teststraat 1, 1000 Brussel, Belgium",
    "country_code": "BE",
    "email": "tristan@cott.am",
    "iban": "BE68539007547034",
    "bank_name": "BNP Paribas Fortis",
    "peppol_scheme": "0208",
    "peppol_id": "0999465828"
  },
  "buyer": {
    "name": "Acme Corp",
    "vat_number": "BE0987654321",  // backend derives customer_peppol_id from this
    "address": "Avenue Louise 1, 1050 Brussels",
    "country_code": "BE",
    "email": "accounts@acme.com",
    "buyer_reference": "PO-4521"  // optional PO number
  },
  "line_items": [
    {
      "description": "Consulting services",
      "quantity": 3,
      "unit_code": "DAY",         // UN/ECE: DAY, HUR, C62 (each)
      "unit_price": 600.00,
      "vat_rate": 0.21,           // FRACTION, not percentage
      "vat_category_code": "S"    // optional — backend defaults S (rate>0) / Z
    }
  ]
}
```

**Key field notes:**
- `unit_code`: UN/ECE — `DAY`, `HUR` (hour), `C62` (unit/each)
- `vat_rate`: fraction (`0.21`); mapping layer converts to percentage (`21`) for e-invoice.be
- `vat_category_code`: `"S"` standard, `"Z"` zero-rated, `"E"` exempt — optional, backend defaults from rate
- `buyer.peppol_*`: optional — backend derives `"9925:BE<vat>"` from `vat_number` if absent
- `seller.company_id` + `peppol_scheme` + `peppol_id`: required — identifies the sender on Peppol (scheme 0208 = BE CBE)
- `buyer_reference`: optional PO number → `purchase_order`

---

## e-invoice.be Integration (Outbound) — Tristan ✅ verified end-to-end

**Auth:** `Authorization: Bearer $EINVOICE_API_KEY` (from `backend/.env`). Base URL `https://api.e-invoice.be`. Implemented with plain `fetch`, no SDK.

**Flow:**
1. `POST /api/documents/` — body is the flat `DocumentCreate` from `toDocumentCreate()`. Returns `{ id, state }`. Validates here.
2. `POST /api/documents/{id}/send` — Peppol IDs as query params + `email` for sandbox delivery.
3. `GET /api/documents/{id}/ubl` — follows `signed_url` to fetch the real UBL XML; saved to `backend/out/<INV>.xml`.

**Verified:** create (DRAFT) → send (TRANSIT) → validated EN16931/PEPPOL UBL ✅

---

## Division of Labour

### Jimmy — Agent & Extraction Layer (`backend/src/extraction.ts`)

- [x] Groq extraction — emits `RawInvoice`, multilingual (EN/FR/NL)
- [x] `vat_rate` as fraction (0.21), no amounts, no totals
- [x] `formatConfirmation()` — human-readable summary before sending
- [x] Missing fields detection
- [x] Prompt hardening — 5 edge cases (total→unit price, missing VAT, mixed rates, French, fractional quantity)
- [x] Seller profile synced with types.ts (`company_id`, `peppol_scheme`, `peppol_id`)
- [ ] Wire into HTTP endpoint so frontend can call it

### Tristan — Backend, PEPPOL & Stripe (`backend/`)

- [x] Deterministic money engine — line/VAT/totals + balanced journal (`money.ts`)
- [x] `toDocumentCreate()` mapping function (`mapping.ts`)
- [x] e-invoice.be create → send → UBL fetch, end-to-end verified (`einvoice.ts`)
- [x] Derive `customer_peppol_id` from `buyer.vat_number` when no explicit peppol fields
- [x] Seller `company_id`/`peppol_scheme`/`peppol_id` wired to sender Peppol ID
- [ ] Stripe payment link creation
- [ ] HTTP endpoint: raw text → `extractInvoice()` → `computeInvoice()` → `create()` → `send()`
- [ ] Wire up Lovable frontend

---

## STRETCH (post-MVP only) — Inbound / Auto-Booking Purchases

**Do NOT start until the outbound demo is rehearsed.**

- [ ] Poll `GET /api/inbox/invoices` or register `POST /api/webhooks/`
- [ ] Use `POST /api/documents/pdf` to OCR a supplier PDF
- [ ] Book a purchase: Dr Expense / Dr VAT recoverable / Cr Accounts Payable
- [ ] Demo: supplier invoice arrives, books itself, ledger stays balanced

---

## Judging Criteria

1. **Automation depth** — invoice → PEPPOL → double-entry, no human steps except sign-off
2. **Trust & compliance** — PEPPOL-valid, correct VAT, auditable
3. **Real-world pull** — WhatsApp-simple for an SME
4. **Agentic execution** — working demo, agent has real authority
5. **Compelling pitch** — 5 minutes, tight narrative

---

## The 5-Minute Pitch Flow

1. *"Belgian SMEs face fines for non-compliant invoicing. Compliance tools are built for accountants, not business owners with a phone."*
2. Live demo: type or photo → agent confirms fields → PEPPOL invoice transmitted via e-invoice.be (show the real UBL) → Stripe payment link sent
3. Show journal entries — *"deterministic code does the accounting, the AI never touches a euro amount."*
4. *"The accountant just signs. Everything else is handled."*
5. Show the Stripe receipt and the cash flag earned for a real compliant invoice.
6. (If inbound stretch landed) *"...and it works both ways"* — supplier invoice arrives, books itself.

---

## Timeline

| Time | Jimmy | Tristan |
|---|---|---|
| ✅ Done | Extraction + edge case hardening + seller profile sync | Money engine + e-invoice.be client, end-to-end verified |
| Now → 15:00 | Support integration / frontend | HTTP endpoint glue + Stripe payment link |
| 15:00–17:00 | End-to-end integration + Lovable frontend | End-to-end integration + Lovable frontend |
| 17:00–18:00 | Pitch prep + demo rehearsal | Pitch prep + demo rehearsal |
| 18:00 | **Pitches** | **Pitches** |

---

## Repo Structure

```
e-invoicing-hackathon/
├── backend/                # TypeScript (Node 22, tsx runner — zero build)
│   ├── src/
│   │   ├── types.ts        # RawInvoice / ComputedInvoice / DocumentCreate
│   │   ├── money.ts        # deterministic money engine + journal
│   │   ├── mapping.ts      # toDocumentCreate()
│   │   ├── einvoice.ts     # e-invoice.be client (create / send / ubl)
│   │   ├── extraction.ts   # Groq extraction agent → RawInvoice (Jimmy)
│   │   ├── sample.ts       # sample RawInvoice fixture (Tristan's test)
│   │   └── test-send.ts    # end-to-end CLI
│   ├── out/                # generated UBL XML saved here
│   ├── .env                # secrets (not committed)
│   └── .env.example        # template
├── api/                    # shared contract (placeholder)
├── openapi.json            # e-invoice.be API spec (reference)
└── track1-plan.md
```
