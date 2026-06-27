# Backend — money engine + e-invoice.be client

Pure TypeScript, run directly on Node 24 (native type-stripping, zero build).

## Modules
- `src/money.ts` — deterministic invoice math + double-entry journal (LLM touches no euros)
- `src/mapping.ts` — `toDocumentCreate()`: our rich contract → e-invoice.be flat schema
- `src/einvoice.ts` — API client: `createDocument`, `sendDocument`, `getUbl`
- `src/stripe.ts` — Stripe Payment Link creation (fetch, no SDK)
- `src/invoice.ts` — shared extract + send logic (used by CLI and HTTP server)
- `src/server.ts` — HTTP API for the frontend
- `src/sample.ts` — sample raw invoice
- `src/test-send.ts` — end-to-end CLI

## Run

```bash
cd backend
cp .env.example .env        # EINVOICE_API_KEY, GROQ_API_KEY, STRIPE_SECRET_KEY

# HTTP API (frontend calls this)
npm run dev

# full CLI: text → Groq → PEPPOL send + Stripe link
npm run pipeline -- "Invoice Acme for 3 days at €600/day, 21% VAT, BE0987654321"

# offline sanity check (no key needed): compute + show the body that would be sent
node --env-file-if-exists=.env src/test-send.ts --dry

# real create + send against the sandbox (emails the validated UBL back)
npm run send
```

### API (for Lovable)

```
POST /api/extract  { "message": "Invoice Acme …" }
  → { status: "ready", confirmation, raw, computed }
  → { status: "incomplete", missing_fields, partial_data? }

POST /api/send     { "raw": <RawInvoice from extract> }
  → { status: "sent", document_id, payment_link_url, ubl_path, computed, … }
```

`npm run send` creates the document (validates), sends it (sandbox emails the
UBL to `DEMO_EMAIL`/seller email), and saves the returned UBL to `out/<INV>.xml`.

## Type-check (optional)
```bash
npm install   # only needed for tsc; running the app needs no deps
npm run typecheck
```
