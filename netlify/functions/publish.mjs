// publish.mjs — com Rate Limit + Warm-up integrado
// Substituto direto do publish.mjs original. Contrato de API 100% idêntico.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const GRAPH  = "https://graph.facebook.com/v21.0";
const sleep  = (ms) => new Promise((r) => setTimeout(r, ms));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── Limites de warm-up por estágio ──────────────────────────────────────────
const WARMUP_STAGES = [
  { stage: 1, durationDays: 1, maxPerDay: 6,  maxPerHour: 1, minGapMin: 60, maxGapMin: 120 },
  { stage: 2, durationDays: 1, maxPerDay: 12, maxPerHour: 2, minGapMin: 30, maxGapMin: 60  },
  { stage: 3, durationDays: 1, maxPerDay: 24, maxPerHour: 3, minGapMin: 18, maxGapMin: 35  },
  { stage: 4, durationDays: 1, maxPerDay: 36, maxPerHour: 4, minGapMin: 13, maxGapMin: 22  },
  { stage: 5, durationDays: 1, maxPerDay: 50, maxPerHour: 4, minGapMin: 10, maxGapMin: 18  },
];

const SAFETY_MARGIN    = 0.85; // usa só 85% do limite declarado
const POST_WINDOW_START = 7;   // não postar antes das 7h UTC
const POST_WINDOW_END   = 23;  // não postar depois das 23h UTC

// Códigos de erro da Meta que indicam rate limit
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

// ─── Helpers de data ──────────────────────────────────────────────────────────

function utcDateKey(tsMs = Date.now()) {
  return new Date(tsMs).toISOString().slice(0, 10);
}

function utcHour(tsMs = Date.now()) {
  return new Date(tsMs).getUTCHours();
}

function formatWaitTime(ms) {
  if (ms <= 0) return "agora";
  const s = Math.ceil(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

// ─── Warm-up: obter ou criar estado da conta ──────────────────────────────────

async function getOrCreateWarmupState(accountId) {
  const existing = await prisma.warmupState.findUnique({ where: { id: accountId } });
  if (existing) return existing;

  console.log(`[warmup] Nova conta: ${accountId} — iniciando Stage 1`);
  return prisma.warmupState.create({
    data: {
      id:          accountId,
      stage:       1,
      startedAt:   new Date(),
      dayInStage:  0,
      postsToday:  0,
      postsHour:   0,
      currentHour: -1,
      dateKey:     utcDateKey(),
      graduated:   false,
    },
  });
}

// ─── Reset de contadores diários/horários ─────────────────────────────────────

async function resetCountersIfNeeded(state) {
  const today  = utcDateKey();
  const hour   = utcHour();
  const updates = {};

  if (state.dateKey !== today) {
    updates.postsToday  = 0;
    updates.dateKey     = today;
    updates.dayInStage  = (state.dayInStage ?? 0) + 1;
  }
  if (state.currentHour !== hour) {
    updates.postsHour   = 0;
    updates.currentHour = hour;
  }
  if (Object.keys(updates).length === 0) return state;

  return prisma.warmupState.update({ where: { id: state.id }, data: updates });
}

// ─── Avançar estágio de warm-up ───────────────────────────────────────────────

async function advanceWarmupIfNeeded(accountId) {
  const state = await getOrCreateWarmupState(accountId);
  if (state.graduated) return;

  const stageConfig = WARMUP_STAGES.find((s) => s.stage === state.stage);
  if (!stageConfig || state.dayInStage < stageConfig.durationDays) return;

  const nextStage = state.stage + 1;
  const hasNext   = WARMUP_STAGES.find((s) => s.stage === nextStage);

  if (!hasNext) {
    await prisma.warmupState.update({
      where: { id: accountId },
      data:  { graduated: true, graduatedAt: new Date() },
    });
    console.log(`[warmup] ✅ ${accountId} GRADUOU do warm-up`);
    return;
  }

  await prisma.warmupState.update({
    where: { id: accountId },
    data:  { stage: nextStage, dayInStage: 0 },
  });
  console.log(`[warmup] ${accountId} avançou para Stage ${nextStage}`);
}

// ─── Back-off ativo? ──────────────────────────────────────────────────────────

async function getActiveBackoff(accountId) {
  return prisma.rateLimitEvent.findFirst({
    where: { accountId, resolvedAt: null, backoffUntil: { gt: new Date() } },
    orderBy: { occurredAt: "desc" },
  });
}

// ─── canPublish — verificação principal ──────────────────────────────────────

async function canPublish(accountId) {
  const now = Date.now();

  let state = await getOrCreateWarmupState(accountId);
  state     = await resetCountersIfNeeded(state);
  await advanceWarmupIfNeeded(accountId);
  state     = await prisma.warmupState.findUniqueOrThrow({ where: { id: accountId } });

  const stageConfig = state.graduated
    ? null
    : WARMUP_STAGES.find((s) => s.stage === state.stage);

  const limits = stageConfig
    ? {
        maxPerDay:  Math.floor(stageConfig.maxPerDay  * SAFETY_MARGIN),
        maxPerHour: Math.floor(stageConfig.maxPerHour * SAFETY_MARGIN),
        minGapMin:  stageConfig.minGapMin,
      }
    : {
        maxPerDay:  Math.floor(50 * SAFETY_MARGIN),
        maxPerHour: Math.floor(4  * SAFETY_MARGIN),
        minGapMin:  10,
      };

  const currentLimits = {
    maxPerDay:  limits.maxPerDay,
    maxPerHour: limits.maxPerHour,
    postsToday: state.postsToday,
    postsHour:  state.postsHour,
  };

  // 1. Back-off ativo?
  const backoff = await getActiveBackoff(accountId);
  if (backoff) {
    const waitMs = backoff.backoffUntil.getTime() - now;
    return { canPost: false, reason: `Rate limit ativo. Back-off por mais ${formatWaitTime(waitMs)}.`, waitMs, waitHuman: formatWaitTime(waitMs), stage: state.stage, limits: currentLimits };
  }

  // 2. Limite diário?
  if (state.postsToday >= limits.maxPerDay) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(POST_WINDOW_START, 0, 0, 0);
    const waitMs = tomorrow.getTime() - now;
    return { canPost: false, reason: `Limite diário atingido (${state.postsToday}/${limits.maxPerDay}). Stage ${state.stage}.`, waitMs, waitHuman: formatWaitTime(waitMs), stage: state.stage, limits: currentLimits };
  }

  // 3. Limite por hora?
  if (state.postsHour >= limits.maxPerHour) {
    const nextHour = new Date(now);
    nextHour.setMinutes(60, 0, 0);
    const waitMs = nextHour.getTime() - now;
    return { canPost: false, reason: `Limite por hora atingido (${state.postsHour}/${limits.maxPerHour}).`, waitMs, waitHuman: formatWaitTime(waitMs), stage: state.stage, limits: currentLimits };
  }

  // 4. Gap mínimo desde último post?
  if (state.lastPostAt) {
    const elapsed  = now - state.lastPostAt.getTime();
    const minGapMs = limits.minGapMin * 60_000;
    if (elapsed < minGapMs) {
      const waitMs = minGapMs - elapsed;
      return { canPost: false, reason: `Gap mínimo não atingido. Aguardar ${formatWaitTime(waitMs)}.`, waitMs, waitHuman: formatWaitTime(waitMs), stage: state.stage, limits: currentLimits };
    }
  }

  // 5. Dentro da janela de horário (7h-23h UTC)?
  const hour = utcHour(now);
  if (hour < POST_WINDOW_START || hour >= POST_WINDOW_END) {
    const nextWindow = new Date(now);
    if (hour >= POST_WINDOW_END) nextWindow.setUTCDate(nextWindow.getUTCDate() + 1);
    nextWindow.setUTCHours(POST_WINDOW_START, 0, 0, 0);
    const waitMs = nextWindow.getTime() - now;
    return { canPost: false, reason: `Fora da janela de postagem (${POST_WINDOW_START}h-${POST_WINDOW_END}h UTC). Aguardar ${formatWaitTime(waitMs)}.`, waitMs, waitHuman: formatWaitTime(waitMs), stage: state.stage, limits: currentLimits };
  }

  return { canPost: true, stage: state.stage, limits: currentLimits };
}

// ─── Registrar postagem ───────────────────────────────────────────────────────

async function recordPost({ accountId, mediaUrl, mediaType, postType, caption, success, errorMsg, mediaId, delayMs }) {
  const state = await getOrCreateWarmupState(accountId);

  // Detectar rate limit da Meta pelo texto do erro
  let isRateLimit   = false;
  let rateLimitCode = 0;

  if (!success && errorMsg) {
    const codeMatch = errorMsg.match(/code[:\s]+(\d+)/i);
    if (codeMatch) {
      const code = parseInt(codeMatch[1]);
      if (RATE_LIMIT_CODES.has(code)) { isRateLimit = true; rateLimitCode = code; }
    }
    if (errorMsg.toLowerCase().includes("rate limit") || errorMsg.toLowerCase().includes("throttling")) {
      isRateLimit = true;
    }
  }

  // Criar evento de back-off se necessário
  if (isRateLimit) {
    const prevCount  = await prisma.rateLimitEvent.count({ where: { accountId } });
    const BACKOFF_MIN = [15, 30, 60, 120, 240, 480];
    const idx        = Math.min(prevCount, BACKOFF_MIN.length - 1);
    const backoffMs  = BACKOFF_MIN[idx] * 60_000;
    const backoffUntil = new Date(Date.now() + backoffMs);

    await prisma.rateLimitEvent.create({
      data: { accountId, errorCode: rateLimitCode, errorMsg: errorMsg ?? "rate limit", backoffUntil },
    });
    console.warn(`[rate-limit] ⚠️ ${accountId} — back-off por ${formatWaitTime(backoffMs)}`);
  }

  // Incrementar contadores só em sucesso
  if (success) {
    await prisma.warmupState.update({
      where: { id: accountId },
      data:  { postsToday: state.postsToday + 1, postsHour: state.postsHour + 1, lastPostAt: new Date() },
    });
  }

  // Log de auditoria (sempre)
  await prisma.postingLog.create({
    data: {
      accountId, mediaUrl, mediaType, postType,
      caption:     caption || null,
      success,
      errorMsg:    errorMsg || null,
      mediaId:     mediaId  || null,
      warmupStage: state.stage,
      delayMs:     delayMs  || null,
      publishedAt: success ? new Date() : null,
    },
  });
}

// ─── Resolver back-off após sucesso ───────────────────────────────────────────

async function resolveBackoff(accountId) {
  await prisma.rateLimitEvent.updateMany({
    where: { accountId, resolvedAt: null },
    data:  { resolvedAt: new Date() },
  });
}

// ─── Validação de URL e token (igual ao original) ────────────────────────────

function isValidMediaUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function verifyToken(token) {
  try {
    const res  = await fetch(`${GRAPH}/me?fields=id&access_token=${token}`);
    const data = await res.json();
    if (data.error) return { valid: false, expired: data.error.code === 190 };
    return { valid: true, expired: false };
  } catch {
    return { valid: true, expired: false };
  }
}

// ─── Aguardar processamento de vídeo (igual ao original) ─────────────────────

async function waitForContainer(containerId, token, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(6000);
    const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${token}`);
    const data = await res.json();
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR")    return false;
  }
  return false;
}

// ─── publishOne (igual ao original) ──────────────────────────────────────────

async function publishOne({ account, media_url, media_type, post_type, caption }) {
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
    let payload = { access_token: token };

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
    const cData = await cRes.json();
    if (cData.error) return { success: false, error: cData.error.message, errorCode: cData.error.code };

    if (isVideo || post_type === "REEL") {
      const ready = await waitForContainer(cData.id, token);
      if (!ready) return { success: false, error: "Timeout no processamento do vídeo (120s). Tente novamente." };
    }

    const pRes  = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    const pData = await pRes.json();
    if (pData.error) return { success: false, error: pData.error.message, errorCode: pData.error.code };

    return { success: true, media_id: pData.id, published_at: new Date().toISOString() };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

export const handler = async (event) => {
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

  let body;
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
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    // ── NOVO: verificar rate limit + warmup ───────────────────────────────
    if (!skip_rate_limit) {
      await getOrCreateWarmupState(account.id); // garante que conta nova entra no stage 1

      const check = await canPublish(account.id);

      if (!check.canPost) {
        console.log(`[publish] ⏳ ${account.username} bloqueado: ${check.reason}`);
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
        continue;
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    const caption = captions?.[account.id] ?? default_caption ?? "";
    const t0      = Date.now();
    const result  = await publishOne({ account, media_url, media_type, post_type, caption });
    const elapsed = Date.now() - t0;

    // ── NOVO: registrar log e contadores ──────────────────────────────────
    if (!skip_rate_limit) {
      await recordPost({
        accountId: account.id,
        mediaUrl:  media_url,
        mediaType: media_type,
        postType:  post_type,
        caption,
        success:   result.success,
        errorMsg:  result.error,
        mediaId:   result.media_id,
        delayMs:   elapsed,
      });

      if (result.success) await resolveBackoff(account.id);
    }
    // ─────────────────────────────────────────────────────────────────────

    results.push({ account_id: account.id, username: account.username, ...result });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
