# Backend — money engine + e-invoice.be client

Pure TypeScript, run directly on Node 24 (native type-stripping, zero build).

## Modules
- `src/money.ts` — deterministic invoice math + double-entry journal (LLM touches no euros)
- `src/mapping.ts` — `toDocumentCreate()`: our rich contract → e-invoice.be flat schema
- `src/einvoice.ts` — API client: `createDocument`, `sendDocument`, `getUbl`
- `src/sample.ts` — sample raw invoice
- `src/test-send.ts` — end-to-end CLI

## Run

```bash
cd backend
cp .env.example .env        # then paste your e-invoice.be SANDBOX key

# offline sanity check (no key needed): compute + show the body that would be sent
node --env-file-if-exists=.env src/test-send.ts --dry

# real create + send against the sandbox (emails the validated UBL back)
npm run send
```

`npm run send` creates the document (validates), sends it (sandbox emails the
UBL to `DEMO_EMAIL`/seller email), and saves the returned UBL to `out/<INV>.xml`.

## Type-check (optional)
```bash
npm install   # only needed for tsc; running the app needs no deps
npm run typecheck
```
