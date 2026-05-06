// =============================================================================
// netlify/functions/publish-with-ratelimit.mts
// Drop-in replacement para o seu publish.mjs existente.
// Adiciona canPublish() antes de cada publicação — sem remover NENHUMA lógica.
//
// COMO USAR:
//   1. Renomeie seu publish.mjs atual para publish-original.mjs (backup)
//   2. Renomeie este arquivo para publish.mts
//   3. Defina DATABASE_URL nas variáveis de ambiente do Netlify
//
// O contrato da API (request/response) é 100% idêntico ao original.
// =============================================================================

import {
  canPublish,
  recordPost,
  resolveBackoff,
  getOrCreateWarmupState,
} from "../../src/lib/rate-limiter.js";
import { formatWaitTime } from "../../src/lib/utils.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── Validação (igual ao original) ───────────────────────────────────────────

function isValidMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function verifyToken(token: string): Promise<{ valid: boolean; expired: boolean }> {
  try {
    const res  = await fetch(`${GRAPH}/me?fields=id&access_token=${token}`);
    const data = await res.json() as { error?: { code: number } };
    if (data.error) {
      return { valid: false, expired: data.error.code === 190 };
    }
    return { valid: true, expired: false };
  } catch {
    return { valid: true, expired: false };
  }
}

async function waitForContainer(containerId: string, token: string, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(6_000);
    const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${token}`);
    const data = await res.json() as { status_code?: string };
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR")    return false;
  }
  return false;
}

// ─── publishOne — igual ao original, retorna mais dados para o recordPost ─────

async function publishOne(opts: {
  account:    { id: string; access_token: string; username: string };
  media_url:  string;
  media_type: string;
  post_type:  string;
  caption:    string;
}): Promise<{
  success: boolean;
  error?: string;
  errorCode?: number;
  token_expired?: boolean;
  media_id?: string;
  published_at?: string;
}> {
  const { account, media_url, media_type, post_type, caption } = opts;
  const { id: igId, access_token: token } = account;
  const isVideo = media_type === "VIDEO";

  const tokenCheck = await verifyToken(token);
  if (!tokenCheck.valid) {
    const msg = tokenCheck.expired
      ? "Token expirado. Reconecte a conta no painel de Contas."
      : "Token inválido. Reconecte a conta no painel de Contas.";
    return { success: false, error: msg, token_expired: tokenCheck.expired };
  }

  try {
    let payload: Record<string, unknown> = { access_token: token };

    if (post_type === "FEED") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "REELS", caption }
        : { ...payload, image_url: media_url, caption };
    } else if (post_type === "REEL") {
      if (!isVideo) return { success: false, error: "Reels só aceita vídeo via API do Instagram. Use a mídia do tipo VIDEO." };
      payload = { ...payload, video_url: media_url, media_type: "REELS", caption, share_to_feed: true };
    } else if (post_type === "STORY") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "VIDEO" }
        : { ...payload, image_url: media_url };
    }

    const cRes  = await fetch(`${GRAPH}/${igId}/media`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const cData = await cRes.json() as { id?: string; error?: { message: string; code: number } };
    if (cData.error) return { success: false, error: cData.error.message, errorCode: cData.error.code };

    if (isVideo || post_type === "REEL") {
      const ready = await waitForContainer(cData.id!, token);
      if (!ready) return { success: false, error: "Timeout no processamento do vídeo (120s). Tente novamente." };
    }

    const pRes  = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    const pData = await pRes.json() as { id?: string; error?: { message: string; code: number } };
    if (pData.error) return { success: false, error: pData.error.message, errorCode: pData.error.code };

    return { success: true, media_id: pData.id, published_at: new Date().toISOString() };

  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

export const handler = async (event: {
  httpMethod: string;
  headers?: Record<string, string>;
  body?: string;
}) => {
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin    = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN
    : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
    ...(corsOrigin !== "*" && { "Vary": "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  let body: {
    accounts:        Array<{ id: string; access_token: string; username: string }>;
    media_url:       string;
    media_type:      string;
    post_type:       string;
    captions?:       Record<string, string>;
    default_caption?: string;
    delay_seconds?:  number;
    skip_rate_limit?: boolean; // flag para bypass em testes
  };

  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const { accounts, media_url, media_type, post_type, captions, default_caption, delay_seconds, skip_rate_limit } = body;

  if (!accounts?.length || !media_url || !media_type || !post_type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };
  }

  const VALID_MEDIA_TYPES = ["IMAGE", "VIDEO"];
  const VALID_POST_TYPES  = ["FEED", "REEL", "STORY"];
  if (!VALID_MEDIA_TYPES.includes(media_type)) return { statusCode: 400, headers, body: JSON.stringify({ error: `media_type inválido: ${media_type}` }) };
  if (!VALID_POST_TYPES.includes(post_type))   return { statusCode: 400, headers, body: JSON.stringify({ error: `post_type inválido: ${post_type}` }) };
  if (!isValidMediaUrl(media_url))             return { statusCode: 400, headers, body: JSON.stringify({ error: "media_url deve ser uma URL HTTPS válida" }) };

  const delayMs = (parseInt(String(delay_seconds)) || 0) * 1000;
  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    // ── NOVO: verificar rate limit + warmup antes de publicar ──────────────
    if (!skip_rate_limit) {
      // Garantir que a conta tem estado criado (conta nova → stage 1 automático)
      await getOrCreateWarmupState(account.id);

      const check = await canPublish(account.id, account.access_token, false);

      if (!check.canPost) {
        console.log(`[publish] ⏳ ${account.username} (${account.id}) bloqueado: ${check.reason}`);
        results.push({
          account_id:   account.id,
          username:     account.username,
          success:      false,
          rate_limited: true,
          error:        check.reason,
          wait_ms:      check.waitMs,
          wait_human:   check.waitHuman,
          warmup_stage: check.stage,
        });
        continue; // pula para próxima conta sem publicar
      }
    }
    // ── FIM: lógica nova ───────────────────────────────────────────────────

    const caption = captions?.[account.id] ?? default_caption ?? "";
    const t0      = Date.now();

    // Chamar publishOne (IDENTICO ao original)
    const result = await publishOne({ account, media_url, media_type, post_type, caption });
    const elapsed = Date.now() - t0;

    // ── NOVO: registrar no PostingLog ──────────────────────────────────────
    if (!skip_rate_limit) {
      await recordPost({
        accountId:  account.id,
        mediaUrl:   media_url,
        mediaType:  media_type as "IMAGE" | "VIDEO",
        postType:   post_type as "FEED" | "REEL" | "STORY",
        caption,
        success:    result.success,
        errorMsg:   result.error,
        mediaId:    result.media_id,
        delayMs:    elapsed,
      });

      if (result.success) {
        await resolveBackoff(account.id);
      }
    }
    // ── FIM: lógica nova ───────────────────────────────────────────────────

    results.push({ account_id: account.id, username: account.username, ...result });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
