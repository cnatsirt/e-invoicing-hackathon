import type { DocumentCreate } from "./types.ts";

const BASE_URL = process.env.EINVOICE_BASE_URL ?? "https://api.e-invoice.be";

function apiKey(): string {
  const key = process.env.EINVOICE_API_KEY;
  if (!key) {
    throw new Error(
      "Missing EINVOICE_API_KEY. Add it to backend/.env (see .env.example).",
    );
  }
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  };
}

// Surface the API's validation hints instead of a bare status code — those
// hints are how we debug a rejected invoice during the build.
async function asError(res: Response): Promise<Error> {
  let body = await res.text();
  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* leave as text */
  }
  return new Error(`e-invoice.be ${res.status} ${res.statusText}\n${body}`);
}

export interface DocumentResponse {
  id: string;
  state?: string;
  [k: string]: unknown;
}

export async function createDocument(body: DocumentCreate): Promise<DocumentResponse> {
  const res = await fetch(`${BASE_URL}/api/documents/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as DocumentResponse;
}

export interface SendParams {
  sender_peppol_scheme?: string;
  sender_peppol_id?: string;
  receiver_peppol_scheme?: string;
  receiver_peppol_id?: string;
  email?: string; // sandbox: UBL is emailed here instead of routed
}

export async function sendDocument(
  documentId: string,
  params: SendParams,
): Promise<DocumentResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const res = await fetch(
    `${BASE_URL}/api/documents/${documentId}/send?${qs.toString()}`,
    { method: "POST", headers: authHeaders() },
  );
  if (!res.ok) throw await asError(res);
  return (await res.json()) as DocumentResponse;
}

export async function getUbl(documentId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/documents/${documentId}/ubl`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw await asError(res);
  return await res.text();
}
