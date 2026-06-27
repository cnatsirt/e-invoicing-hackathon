/**
 * Minimal HTTP API for the Lovable frontend.
 *
 *   POST /api/extract  { "message": "Invoice Acme …" }
 *   POST /api/send     { "raw": <RawInvoice from /api/extract> }
 *   GET  /health
 *
 *   npm run dev
 */
import { createServer, type IncomingMessage } from "node:http";
import { extractFromMessage, sendInvoice } from "./invoice.ts";
import type { RawInvoice } from "./types.ts";

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(),
  });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) throw new Error("Empty request body");
  return JSON.parse(text) as T;
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = req.url ?? "/";

  try {
    if (req.method === "GET" && url === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url === "/api/extract") {
      const { message } = await readJson<{ message?: string }>(req);
      if (!message?.trim()) {
        json(res, 400, { error: "message is required" });
        return;
      }
      const result = await extractFromMessage(message.trim());
      json(res, 200, result);
      return;
    }

    if (req.method === "POST" && url === "/api/send") {
      const { raw } = await readJson<{ raw?: RawInvoice }>(req);
      if (!raw?.buyer || !raw?.line_items?.length) {
        json(res, 400, { error: "raw invoice with buyer and line_items is required" });
        return;
      }
      const result = await sendInvoice(raw);
      json(res, 200, { status: "sent", ...result });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌", message);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`→ API listening on http://localhost:${PORT}`);
  console.log(`  POST /api/extract  — Groq → confirmation + computed preview`);
  console.log(`  POST /api/send     — PEPPOL send + Stripe payment link`);
});
