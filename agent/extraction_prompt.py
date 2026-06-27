"""
Invoice Extraction Agent — Track 1, Agentic E-Invoicing
Hackathon: Agentic Commerce II, Brussels, 27 June 2026

Extracts structured invoice data from messy user input and outputs JSON
that maps directly to the e-invoice.be API format (POST /api/documents/).
"""

import anthropic
import json
import os
import requests
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Config — all secrets from .env
# ---------------------------------------------------------------------------
anthropic_client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from .env

E_INVOICE_API_KEY = os.environ["E_INVOICE_API_KEY"]
E_INVOICE_BASE_URL = os.getenv("E_INVOICE_BASE_URL", "https://api.e-invoice.be")
E_INVOICE_HEADERS = {
    "Authorization": f"Bearer {E_INVOICE_API_KEY}",
    "Content-Type": "application/json",
}

# ---------------------------------------------------------------------------
# Seller profile — set once, injected into every extraction call
# ---------------------------------------------------------------------------
SELLER_PROFILE = {
    "vendor_name": "Your Company Name",
    "vendor_tax_id": "BE0123456789",       # full VAT incl. BE prefix
    "vendor_address": "Your Street 1, 1000 Brussels, Belgium",
    "vendor_email": "you@yourcompany.be",
    "payment_details": [
        {
            "iban": "BE68539007547034",    # your IBAN, no spaces
            "swift": "GEBABEBB",
            "payment_reference": None,     # filled in per invoice below
        }
    ],
}

INVOICE_COUNTER = 1  # increment per invoice in a real app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def next_invoice_number() -> str:
    return f"INV-{date.today().year}-{INVOICE_COUNTER:03d}"


def build_context() -> dict:
    today = date.today()
    invoice_id = next_invoice_number()
    profile = json.loads(json.dumps(SELLER_PROFILE))  # deep copy
    profile["payment_details"][0]["payment_reference"] = invoice_id
    return {
        "seller": profile,
        "defaults": {
            "document_type": "INVOICE",
            "invoice_id": invoice_id,
            "invoice_date": today.isoformat(),
            "due_date": (today + timedelta(days=30)).isoformat(),
            "currency": "EUR",
            "payment_term": "Payment due within 30 days",
        },
    }


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are an invoicing agent for Belgian SMEs. Convert any user input — casual text, voice transcript, or image — into a structured JSON invoice that maps directly to the e-invoice.be API format.

## Output rules
- Return ONLY valid JSON. No prose, no markdown fences.
- If required buyer fields are missing, return {"missing_fields": [...], "partial_data": {...}}.
- Never ask for seller details (injected from profile) or currency (always EUR).

## e-invoice.be JSON format
Output this exact structure:

{
  "document_type": "INVOICE",
  "invoice_id": "<from defaults>",
  "invoice_date": "<YYYY-MM-DD>",
  "due_date": "<YYYY-MM-DD>",
  "currency": "EUR",
  "vendor_name": "<from seller profile>",
  "vendor_tax_id": "<from seller profile>",
  "vendor_address": "<from seller profile>",
  "vendor_email": "<from seller profile>",
  "customer_name": "<extract>",
  "customer_tax_id": "<extract - format: BE + 10 digits, e.g. BE0987654321>",
  "customer_address": "<extract>",
  "customer_email": "<extract>",
  "purchase_order": "<extract if mentioned, else omit>",
  "items": [
    {
      "description": "<extract>",
      "quantity": <number>,
      "unit": "<unit code>",
      "unit_price": <number>,
      "amount": <quantity × unit_price — ALWAYS recompute, do not trust user>,
      "tax_rate": "<percentage string e.g. '21.00'>"
    }
  ],
  "payment_term": "Payment due within 30 days",
  "payment_details": [<from seller profile>],
  "_journal_entries": [
    {"account": "Accounts Receivable", "debit": <invoice_total>, "credit": 0},
    {"account": "VAT Payable", "debit": 0, "credit": <total_tax>},
    {"account": "Revenue", "debit": 0, "credit": <subtotal>}
  ],
  "_totals": {
    "subtotal": <sum of all item amounts>,
    "vat_amount": <sum of item amounts × their tax rates>,
    "total": <subtotal + vat_amount>
  }
}

Note: fields prefixed with _ are for UI display only and are stripped before sending to the e-invoice.be API.

## Field extraction rules

### items
- quantity: numeric, default 1
- unit codes: "days"/"jour"/"dag" → "DAY" | "hours"/"heures"/"uur" → "HUR" | everything else → "C62"
- amount: ALWAYS recompute as quantity × unit_price
- tax_rate: string with 2 decimals — "21.00" (default Belgium), "6.00", "0.00"
  - If user says "no VAT" or "VAT exempt" → "0.00"
  - If user says "6%" → "6.00"
  - Default to "21.00" if not stated

### dates
- invoice_date: today from defaults if not stated
- due_date: invoice_date + 30 days if not stated

### customer fields (required)
- customer_name: required
- customer_tax_id: required for PEPPOL B2B — ask if missing
- customer_email: required to send payment link — ask if missing
- customer_address: ask if missing

### _totals and _journal_entries
- Compute from items: subtotal = Σ(amount), vat = Σ(amount × tax_rate/100), total = subtotal + vat
- journal_entries always has exactly 3 lines as shown

## Language
User may write in English, French, or Dutch. Always output field values in English.

## Missing fields response
{
  "missing_fields": ["customer_tax_id", "customer_email"],
  "partial_data": { ...everything you did extract... }
}
List all missing fields at once."""


# ---------------------------------------------------------------------------
# Extraction — text
# ---------------------------------------------------------------------------
def extract_invoice_from_text(user_message: str) -> dict:
    context = build_context()
    response = anthropic_client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"""<context>
{json.dumps(context, indent=2)}
</context>

<user_input>
{user_message}
</user_input>

Extract the invoice and return the complete JSON.""",
            }
        ],
    )
    return json.loads(response.content[0].text.strip())


# ---------------------------------------------------------------------------
# Extraction — image (receipt / photo of invoice)
# ---------------------------------------------------------------------------
def extract_invoice_from_image(image_base64: str, media_type: str = "image/jpeg") -> dict:
    context = build_context()
    response = anthropic_client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_base64,
                        },
                    },
                    {
                        "type": "text",
                        "text": f"""<context>
{json.dumps(context, indent=2)}
</context>

This is a photo of an invoice or receipt. Extract all visible invoice fields and return the complete JSON.""",
                    },
                ],
            }
        ],
    )
    return json.loads(response.content[0].text.strip())


# ---------------------------------------------------------------------------
# Strip internal _ fields before sending to e-invoice.be API
# ---------------------------------------------------------------------------
def to_api_payload(invoice: dict) -> dict:
    return {k: v for k, v in invoice.items() if not k.startswith("_")}


# ---------------------------------------------------------------------------
# e-invoice.be API calls
# ---------------------------------------------------------------------------
def validate_invoice(invoice: dict) -> dict:
    """Returns {"valid": True} or {"valid": False, "errors": [...]}"""
    payload = to_api_payload(invoice)
    r = requests.post(
        f"{E_INVOICE_BASE_URL}/api/validate/json",
        headers=E_INVOICE_HEADERS,
        json=payload,
    )
    return r.json()


def create_invoice(invoice: dict) -> dict:
    """Creates the invoice (state: DRAFT). Returns document with id."""
    payload = to_api_payload(invoice)
    r = requests.post(
        f"{E_INVOICE_BASE_URL}/api/documents/",
        headers=E_INVOICE_HEADERS,
        json=payload,
    )
    r.raise_for_status()
    return r.json()


def send_invoice(document_id: str) -> dict:
    """Sends via PEPPOL (or email if test mode). Returns updated state."""
    r = requests.post(
        f"{E_INVOICE_BASE_URL}/api/documents/{document_id}/send",
        headers=E_INVOICE_HEADERS,
    )
    r.raise_for_status()
    return r.json()


def check_peppol_registration(vat_number: str) -> dict:
    """Check if a company is registered on PEPPOL. vat_number e.g. 'BE0987654321'"""
    # Belgian scheme: 0208, strip 'BE' prefix
    company_id = vat_number.replace("BE", "").replace("be", "")
    peppol_id = f"0208:{company_id}"
    r = requests.get(
        f"{E_INVOICE_BASE_URL}/api/validate/peppol-id",
        headers=E_INVOICE_HEADERS,
        params={"peppol_id": peppol_id},
    )
    return r.json()


# ---------------------------------------------------------------------------
# Human-readable confirmation (shown to user before sending)
# ---------------------------------------------------------------------------
def format_confirmation(invoice: dict) -> str:
    totals = invoice.get("_totals", {})
    items = invoice.get("items", [])
    lines = [
        f"  • {i['description']}: {i['quantity']} {i['unit']} × €{i['unit_price']:.2f} = €{i['amount']:.2f} (+{i['tax_rate']}% VAT)"
        for i in items
    ]
    return f"""Here's what I've got — reply 'yes' to generate the invoice + payment link:

📋 {invoice.get('invoice_id')} · {invoice.get('invoice_date')} → due {invoice.get('due_date')}
🏢 To: {invoice.get('customer_name')} ({invoice.get('customer_tax_id')})
📧 Send to: {invoice.get('customer_email')}

{chr(10).join(lines)}

💶 Subtotal:  €{totals.get('subtotal', 0):.2f}
🧾 VAT:       €{totals.get('vat_amount', 0):.2f}
✅ Total:     €{totals.get('total', 0):.2f}"""


# ---------------------------------------------------------------------------
# Full agent flow: extract → validate → confirm → create → send
# ---------------------------------------------------------------------------
def run_invoice_flow(user_input: str, auto_send: bool = False):
    print(f"\n{'='*60}")
    print(f"Input: {user_input[:80]}...")
    print('='*60)

    # 1. Extract
    invoice = extract_invoice_from_text(user_input)

    if "missing_fields" in invoice:
        print(f"⚠️  Need more info: {invoice['missing_fields']}")
        return

    # 2. Show confirmation
    print(format_confirmation(invoice))

    # 3. Validate against e-invoice.be
    print("\n🔍 Validating with e-invoice.be...")
    validation = validate_invoice(invoice)
    if not validation.get("valid"):
        print(f"❌ Validation failed: {validation.get('errors')}")
        return
    print("✅ Valid PEPPOL invoice")

    if not auto_send:
        return invoice

    # 4. Create
    print("📄 Creating invoice...")
    doc = create_invoice(invoice)
    print(f"✅ Created: {doc['id']} (state: {doc['state']})")

    # 5. Send
    print("📤 Sending via PEPPOL...")
    result = send_invoice(doc["id"])
    print(f"✅ Sent — state: {result['state']}")

    return doc


# ---------------------------------------------------------------------------
# Quick tests
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    test_inputs = [
        "Invoice Acme Corp for 3 days consulting at €600/day, 21% VAT. Their VAT is BE0987654321, send to accounts@acme.com",
        "stuur factuur naar Jan Peeters (BE0111222333, jan@peeters.be) voor 8 uur werk aan €95/uur",
        "Invoice TechStartup SA, 2 days UX workshop €800/day + 1 day report writing €600, all 21% VAT. VAT BE0555666777 billing@techstartup.io",
        "Receipt: web hosting renewal €199/year, 21% VAT, client Digital Agency BE0444555666 pay@digitalagency.be",
    ]

    for text in test_inputs:
        run_invoice_flow(text, auto_send=False)
