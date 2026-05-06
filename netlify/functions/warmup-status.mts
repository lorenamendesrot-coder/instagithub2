// =============================================================================
// netlify/functions/warmup-status.mts
// Endpoint GET/POST para consultar o estado de warmup de uma ou mais contas.
// Usado pelo dashboard React para exibir stage, limites, próximo post, etc.
//
// GET  /.netlify/functions/warmup-status?accountId=123
// POST /.netlify/functions/warmup-status  { accountIds: ["123", "456"] }
// =============================================================================

import { getAccountSummary, canPublish } from "../../src/lib/rate-limiter.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

export const handler = async (event: {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
}) => {
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin    = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
    ...(corsOrigin !== "*" && { "Vary": "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  // ── GET: single account ───────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    const accountId = event.queryStringParameters?.accountId;
    if (!accountId) return { statusCode: 400, headers, body: JSON.stringify({ error: "accountId obrigatório" }) };

    const summary = await getAccountSummary(accountId);
    if (!summary) return { statusCode: 404, headers, body: JSON.stringify({ error: "Conta não encontrada" }) };

    return { statusCode: 200, headers, body: JSON.stringify(summary) };
  }

  // ── POST: múltiplas contas ────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    let body: { accountIds?: string[] };
    try { body = JSON.parse(event.body || "{}"); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

    const { accountIds } = body;
    if (!accountIds?.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "accountIds obrigatório" }) };

    const summaries = await Promise.all(accountIds.map(getAccountSummary));

    // Enriquecer com canPublish (sem chamar a Meta API — apenas verificações locais)
    const enriched = await Promise.all(
      summaries.map(async (s, i) => {
        if (!s) return { accountId: accountIds[i], error: "não encontrado" };
        const check = await canPublish(s.accountId, undefined, false);
        return { ...s, canPublish: check };
      }),
    );

    return { statusCode: 200, headers, body: JSON.stringify({ accounts: enriched }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };
};
