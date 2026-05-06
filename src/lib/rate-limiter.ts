// =============================================================================
// src/lib/rate-limiter.ts
// Módulo principal do sistema de Rate Limit + Warm-up.
//
// Função pública central:
//   canPublish(accountId) → { canPost, reason?, waitMs? }
//
// Gestão de estado:
//   getOrCreateWarmupState(accountId)  — cria estado para conta nova
//   advanceWarmupIfNeeded(accountId)   — avança estágio após N dias
//   recordPost(accountId, result)      — registra publicação e atualiza contadores
//   checkMetaQuota(accountId, token)   — consulta /content_publishing_limit da Meta
// =============================================================================

import { PrismaClient }   from "@prisma/client";
import {
  WARMUP_STAGES,
  GLOBAL_LIMITS,
  META_RATE_LIMIT_CODES,
  WarmupStage,
} from "./warmup-config.js";
import {
  utcDateKey,
  utcHour,
  calcBackoffMs,
  formatWaitTime,
} from "./utils.js";

// Singleton Prisma — não instanciar dentro de cada função
const prisma = new PrismaClient();

const GRAPH = "https://graph.facebook.com/v21.0";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CanPublishResult {
  canPost:    boolean;
  reason?:    string;          // motivo quando canPost = false
  waitMs?:    number;          // ms para tentar novamente
  waitHuman?: string;          // ex: "14m 30s"
  stage?:     number;          // estágio de warmup atual
  limits?: {
    maxPerDay:  number;
    maxPerHour: number;
    postsToday: number;
    postsHour:  number;
  };
}

export interface RecordPostOptions {
  accountId:  string;
  mediaUrl:   string;
  mediaType:  "IMAGE" | "VIDEO";
  postType:   "FEED" | "REEL" | "STORY";
  caption?:   string;
  success:    boolean;
  errorMsg?:  string;
  mediaId?:   string;
  delayMs?:   number;
  quotaUsage?: number;
}

// ─── 1. Obter ou criar estado de warmup ──────────────────────────────────────

/**
 * Retorna o estado de warmup da conta.
 * Se não existir → cria com stage=1 e contadores zerados.
 * Chamado automaticamente por canPublish().
 */
export async function getOrCreateWarmupState(accountId: string) {
  const existing = await prisma.warmupState.findUnique({ where: { id: accountId } });
  if (existing) return existing;

  // Conta nova → criar estado inicial
  console.log(`[warmup] Nova conta detectada: ${accountId} — iniciando warm-up Stage 1`);
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

// ─── 2. Reset de contadores diários/horários ──────────────────────────────────

/**
 * Reseta postsToday se mudou o dia, e postsHour se mudou a hora.
 * Retorna o estado atualizado.
 */
async function resetCountersIfNeeded(state: Awaited<ReturnType<typeof getOrCreateWarmupState>>) {
  const now     = Date.now();
  const today   = utcDateKey(now);
  const hour    = utcHour(now);
  const updates: Record<string, unknown> = {};

  if (state.dateKey !== today) {
    updates.postsToday   = 0;
    updates.dateKey      = today;
    updates.dayInStage   = (state.dayInStage ?? 0) + 1;
    console.log(`[warmup] ${state.id} — novo dia (${today}), postsToday resetado`);
  }

  if (state.currentHour !== hour) {
    updates.postsHour    = 0;
    updates.currentHour  = hour;
  }

  if (Object.keys(updates).length === 0) return state;

  return prisma.warmupState.update({
    where: { id: state.id },
    data:  updates,
  });
}

// ─── 3. Avançar estágio de warmup ────────────────────────────────────────────

/**
 * Avança para o próximo estágio se o tempo mínimo no estágio atual passou.
 * Chamado após cada reset de dia.
 */
export async function advanceWarmupIfNeeded(accountId: string): Promise<void> {
  const state = await getOrCreateWarmupState(accountId);
  if (state.graduated) return;

  const currentStageConfig = WARMUP_STAGES.find((s) => s.stage === state.stage);
  if (!currentStageConfig) return;

  // Verificar se passou os dias necessários neste estágio
  if (state.dayInStage < currentStageConfig.durationDays) return;

  const nextStage = state.stage + 1;
  const isLastStage = !WARMUP_STAGES.find((s) => s.stage === nextStage);

  if (isLastStage || nextStage > WARMUP_STAGES.length) {
    // Graduou! Passou por todos os estágios.
    await prisma.warmupState.update({
      where: { id: accountId },
      data:  { graduated: true, graduatedAt: new Date() },
    });
    console.log(`[warmup] ✅ ${accountId} GRADUOU do warm-up após ${state.dayInStage} dias`);
    return;
  }

  await prisma.warmupState.update({
    where: { id: accountId },
    data:  { stage: nextStage, dayInStage: 0 },
  });
  console.log(`[warmup] ${accountId} avançou para Stage ${nextStage}`);
}

// ─── 4. Verificar back-off ativo ─────────────────────────────────────────────

/**
 * Retorna o evento de back-off ativo para a conta, se existir.
 */
async function getActiveBackoff(accountId: string) {
  return prisma.rateLimitEvent.findFirst({
    where: {
      accountId,
      resolvedAt:   null,
      backoffUntil: { gt: new Date() },
    },
    orderBy: { occurredAt: "desc" },
  });
}

// ─── 5. Verificar quota da Meta ───────────────────────────────────────────────

/**
 * Consulta /content_publishing_limit da Meta e retorna % de quota usada.
 * Retorna null em caso de falha (não bloquear postagem por falha de rede).
 */
export async function checkMetaQuota(
  accountId: string,
  accessToken: string,
): Promise<{ quotaUsage: number; quotaTotal: number } | null> {
  try {
    const res  = await fetch(
      `${GRAPH}/${accountId}/content_publishing_limit?fields=config,quota_usage&access_token=${accessToken}`,
    );
    const data = await res.json();

    if (data.error || !data.data?.length) return null;

    const entry = data.data[0];
    return {
      quotaUsage: entry.quota_usage  ?? 0,
      quotaTotal: entry.config?.quota_total ?? 50,
    };
  } catch {
    return null; // falha de rede → não bloquear
  }
}

// ─── 6. canPublish — função principal ────────────────────────────────────────

/**
 * Verifica se uma conta pode publicar agora.
 *
 * Ordem de verificações:
 *  1. Back-off ativo (rate limit da Meta detectado anteriormente)
 *  2. Limites de warm-up (posts/dia e posts/hora do estágio atual)
 *  3. Gap mínimo desde o último post
 *  4. Janela de horário (7h-23h)
 *  5. (Opcional) Quota real da Meta via API
 *
 * @param accountId   instagram_id da conta
 * @param accessToken token de acesso (necessário apenas para checkMetaQuota)
 * @param checkQuota  se true, consulta a Meta API (gasta uma chamada de API)
 */
export async function canPublish(
  accountId:   string,
  accessToken?: string,
  checkQuota   = false,
): Promise<CanPublishResult> {
  const now = Date.now();

  // ── Obter estado (cria se conta nova) ──────────────────────────────────────
  let state = await getOrCreateWarmupState(accountId);
  state     = await resetCountersIfNeeded(state);

  // Avançar estágio se necessário (novo dia)
  await advanceWarmupIfNeeded(accountId);
  state = await prisma.warmupState.findUniqueOrThrow({ where: { id: accountId } });

  // ── Limites do estágio atual ───────────────────────────────────────────────
  const stageConfig: WarmupStage | undefined = state.graduated
    ? undefined
    : WARMUP_STAGES.find((s) => s.stage === state.stage);

  const limits = stageConfig
    ? {
        maxPerDay:  Math.floor(stageConfig.maxPerDay  * GLOBAL_LIMITS.safetyMargin),
        maxPerHour: Math.floor(stageConfig.maxPerHour * GLOBAL_LIMITS.safetyMargin),
        minGapMin:  stageConfig.minGapMin,
        maxGapMin:  stageConfig.maxGapMin,
      }
    : {
        // Conta graduada → limites plenos (com margem de segurança)
        maxPerDay:  Math.floor(GLOBAL_LIMITS.maxPerDay  * GLOBAL_LIMITS.safetyMargin),
        maxPerHour: Math.floor(GLOBAL_LIMITS.maxPerHour * GLOBAL_LIMITS.safetyMargin),
        minGapMin:  GLOBAL_LIMITS.minDelayMin,
        maxGapMin:  GLOBAL_LIMITS.maxDelayMin,
      };

  const currentLimits = {
    maxPerDay:  limits.maxPerDay,
    maxPerHour: limits.maxPerHour,
    postsToday: state.postsToday,
    postsHour:  state.postsHour,
  };

  // ── Verificação 1: back-off ativo ──────────────────────────────────────────
  const backoff = await getActiveBackoff(accountId);
  if (backoff) {
    const waitMs = backoff.backoffUntil.getTime() - now;
    return {
      canPost:    false,
      reason:     `Rate limit da Meta ativo (código ${backoff.errorCode}). Back-off por mais ${formatWaitTime(waitMs)}.`,
      waitMs,
      waitHuman:  formatWaitTime(waitMs),
      stage:      state.stage,
      limits:     currentLimits,
    };
  }

  // ── Verificação 2: limite diário ───────────────────────────────────────────
  if (state.postsToday >= limits.maxPerDay) {
    // Calcular quando reseta (meia-noite UTC)
    const tomorrowUtc = new Date();
    tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1);
    tomorrowUtc.setUTCHours(GLOBAL_LIMITS.postWindowStart, 0, 0, 0);
    const waitMs = tomorrowUtc.getTime() - now;

    return {
      canPost:    false,
      reason:     `Limite diário atingido (${state.postsToday}/${limits.maxPerDay} posts). Stage ${state.stage}.`,
      waitMs,
      waitHuman:  formatWaitTime(waitMs),
      stage:      state.stage,
      limits:     currentLimits,
    };
  }

  // ── Verificação 3: limite por hora ────────────────────────────────────────
  if (state.postsHour >= limits.maxPerHour) {
    // Próximo reset = início da próxima hora
    const nextHour = new Date(now);
    nextHour.setMinutes(60, 0, 0);
    const waitMs = nextHour.getTime() - now;

    return {
      canPost:    false,
      reason:     `Limite por hora atingido (${state.postsHour}/${limits.maxPerHour} posts na hora atual). Stage ${state.stage}.`,
      waitMs,
      waitHuman:  formatWaitTime(waitMs),
      stage:      state.stage,
      limits:     currentLimits,
    };
  }

  // ── Verificação 4: gap mínimo desde o último post ─────────────────────────
  if (state.lastPostAt) {
    const lastPostMs  = state.lastPostAt.getTime();
    const minGapMs    = limits.minGapMin * 60_000;
    const elapsed     = now - lastPostMs;

    if (elapsed < minGapMs) {
      const waitMs = minGapMs - elapsed;
      return {
        canPost:    false,
        reason:     `Gap mínimo não atingido. Último post há ${formatWaitTime(elapsed)}, mínimo ${limits.minGapMin} min. Aguardar ${formatWaitTime(waitMs)}.`,
        waitMs,
        waitHuman:  formatWaitTime(waitMs),
        stage:      state.stage,
        limits:     currentLimits,
      };
    }
  }

  // ── Verificação 5: janela de horário (7h-23h UTC) ─────────────────────────
  const hour = utcHour(now);
  if (hour < GLOBAL_LIMITS.postWindowStart || hour >= GLOBAL_LIMITS.postWindowEnd) {
    const nextWindow = new Date(now);
    if (hour >= GLOBAL_LIMITS.postWindowEnd) {
      nextWindow.setUTCDate(nextWindow.getUTCDate() + 1);
    }
    nextWindow.setUTCHours(GLOBAL_LIMITS.postWindowStart, 0, 0, 0);
    const waitMs = nextWindow.getTime() - now;

    return {
      canPost:    false,
      reason:     `Fora da janela de postagem (${GLOBAL_LIMITS.postWindowStart}h-${GLOBAL_LIMITS.postWindowEnd}h UTC). Aguardar ${formatWaitTime(waitMs)}.`,
      waitMs,
      waitHuman:  formatWaitTime(waitMs),
      stage:      state.stage,
      limits:     currentLimits,
    };
  }

  // ── Verificação 6 (opcional): quota real da Meta ──────────────────────────
  if (checkQuota && accessToken) {
    const quota = await checkMetaQuota(accountId, accessToken);
    if (quota) {
      const usagePct = quota.quotaUsage / quota.quotaTotal;
      const safeThreshold = GLOBAL_LIMITS.safetyMargin;

      if (usagePct >= safeThreshold) {
        const waitMs = 30 * 60_000; // aguardar 30 min antes de tentar de novo
        return {
          canPost:    false,
          reason:     `Quota Meta próxima do limite (${quota.quotaUsage}/${quota.quotaTotal} = ${Math.round(usagePct * 100)}%). Aguardar ${formatWaitTime(waitMs)}.`,
          waitMs,
          waitHuman:  formatWaitTime(waitMs),
          stage:      state.stage,
          limits:     currentLimits,
        };
      }
    }
  }

  // ── Tudo OK ───────────────────────────────────────────────────────────────
  return {
    canPost:   true,
    stage:     state.stage,
    limits:    currentLimits,
  };
}

// ─── 7. Registrar postagem e atualizar contadores ────────────────────────────

/**
 * Registra o resultado de uma publicação no banco.
 * Deve ser chamado APÓS cada tentativa (sucesso ou falha).
 *
 * - Em caso de sucesso: incrementa postsToday, postsHour, atualiza lastPostAt
 * - Em caso de erro de rate limit da Meta: cria RateLimitEvent com back-off
 * - Em qualquer caso: salva PostingLog para auditoria
 */
export async function recordPost(opts: RecordPostOptions): Promise<void> {
  const state = await getOrCreateWarmupState(opts.accountId);

  // Detectar erro de rate limit da Meta
  let isRateLimit = false;
  let rateLimitCode: number | null = null;

  if (!opts.success && opts.errorMsg) {
    // A Meta inclui o código no texto do erro: "Error code: 32"
    const codeMatch = opts.errorMsg.match(/code[:\s]+(\d+)/i);
    if (codeMatch) {
      const code = parseInt(codeMatch[1]);
      if (META_RATE_LIMIT_CODES.has(code)) {
        isRateLimit   = true;
        rateLimitCode = code;
      }
    }
    // Também verificar mensagens conhecidas
    if (
      opts.errorMsg.toLowerCase().includes("rate limit") ||
      opts.errorMsg.toLowerCase().includes("throttling") ||
      opts.errorMsg.toLowerCase().includes("too many calls")
    ) {
      isRateLimit = true;
    }
  }

  // Contar eventos de rate limit anteriores para calcular back-off
  let backoffMs = 0;
  if (isRateLimit) {
    const previousEvents = await prisma.rateLimitEvent.count({
      where: { accountId: opts.accountId },
    });
    backoffMs = calcBackoffMs(previousEvents);
    const backoffUntil = new Date(Date.now() + backoffMs);

    await prisma.rateLimitEvent.create({
      data: {
        accountId:   opts.accountId,
        errorCode:   rateLimitCode ?? 0,
        errorMsg:    opts.errorMsg ?? "rate limit",
        backoffUntil,
      },
    });
    console.warn(
      `[rate-limit] ⚠️  ${opts.accountId} — back-off por ${formatWaitTime(backoffMs)} até ${backoffUntil.toISOString()}`,
    );
  }

  // Atualizar contadores (apenas em sucesso)
  if (opts.success) {
    await prisma.warmupState.update({
      where: { id: opts.accountId },
      data: {
        postsToday:  state.postsToday + 1,
        postsHour:   state.postsHour  + 1,
        lastPostAt:  new Date(),
      },
    });
  }

  // Log de auditoria (sempre)
  await prisma.postingLog.create({
    data: {
      accountId:   opts.accountId,
      mediaUrl:    opts.mediaUrl,
      mediaType:   opts.mediaType,
      postType:    opts.postType,
      caption:     opts.caption,
      success:     opts.success,
      errorMsg:    opts.errorMsg,
      mediaId:     opts.mediaId,
      warmupStage: state.stage,
      quotaUsage:  opts.quotaUsage,
      delayMs:     opts.delayMs,
      publishedAt: opts.success ? new Date() : null,
    },
  });

  console.log(
    `[record] ${opts.accountId} — ${opts.success ? "✅ OK" : "❌ FALHOU"} | ` +
    `Stage ${state.stage} | Posts hoje: ${state.postsToday + (opts.success ? 1 : 0)}`,
  );
}

// ─── 8. Resolver back-off ─────────────────────────────────────────────────────

/**
 * Marca todos os back-offs ativos de uma conta como resolvidos.
 * Chamado automaticamente quando um post é publicado com sucesso
 * após o período de back-off.
 */
export async function resolveBackoff(accountId: string): Promise<void> {
  await prisma.rateLimitEvent.updateMany({
    where: { accountId, resolvedAt: null },
    data:  { resolvedAt: new Date() },
  });
}

// ─── 9. Resumo do estado de uma conta ────────────────────────────────────────

/**
 * Retorna um resumo legível do estado de uma conta.
 * Útil para dashboards e logs de diagnóstico.
 */
export async function getAccountSummary(accountId: string) {
  const state   = await prisma.warmupState.findUnique({ where: { id: accountId } });
  const backoff = await getActiveBackoff(accountId);
  const today   = await prisma.postingLog.count({
    where: {
      accountId,
      attemptedAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
      success: true,
    },
  });

  if (!state) return null;

  const stageConfig = WARMUP_STAGES.find((s) => s.stage === state.stage);

  return {
    accountId,
    warmup: {
      stage:       state.stage,
      stageLabel:  stageConfig?.label ?? "Graduado",
      graduated:   state.graduated,
      graduatedAt: state.graduatedAt,
      dayInStage:  state.dayInStage,
      startedAt:   state.startedAt,
    },
    counters: {
      postsToday:    state.postsToday,
      postsHour:     state.postsHour,
      lastPostAt:    state.lastPostAt,
      logsToday:     today,
    },
    limits: stageConfig
      ? { maxPerDay: stageConfig.maxPerDay, maxPerHour: stageConfig.maxPerHour }
      : { maxPerDay: GLOBAL_LIMITS.maxPerDay, maxPerHour: GLOBAL_LIMITS.maxPerHour },
    backoff: backoff
      ? { active: true, until: backoff.backoffUntil, code: backoff.errorCode }
      : { active: false },
  };
}
