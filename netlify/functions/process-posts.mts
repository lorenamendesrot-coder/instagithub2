// =============================================================================
// netlify/functions/process-posts.mts
// Netlify Scheduled Function — roda de 10 em 10 minutos.
//
// O que faz:
//  1. Busca todos os posts agendados com scheduledAt <= agora
//  2. Para cada post, verifica canPublish() por conta
//  3. Se permitido → publica via Meta Graph API (mantendo sua lógica atual)
//  4. Registra resultado no PostingLog
//  5. Gera slots futuros distribuídos ao longo do dia (se loop = true)
//
// NÃO substitui nenhuma lógica existente — apenas adiciona as verificações
// de rate limit e warm-up antes de chamar seu publishOne() já existente.
// =============================================================================

import type { Config, Context } from "@netlify/functions";
import {
  canPublish,
  recordPost,
  resolveBackoff,
  advanceWarmupIfNeeded,
} from "../../src/lib/rate-limiter.js";
import {
  calcNextSlot,
  randomDelayFromMinutes,
  distributePostsOverDay,
  utcDateKey,
  formatWaitTime,
} from "../../src/lib/utils.js";
import { WARMUP_STAGES, GLOBAL_LIMITS } from "../../src/lib/warmup-config.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const GRAPH  = "https://graph.facebook.com/v21.0";
const sleep  = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Tipos locais ─────────────────────────────────────────────────────────────

interface ScheduledPost {
  id:           string;
  accountId:    string;
  accessToken:  string;
  mediaUrl:     string;
  mediaType:    "IMAGE" | "VIDEO";
  postType:     "FEED" | "REEL" | "STORY";
  caption?:     string;
  scheduledAt:  Date;
  loop:         boolean;
  status:       string;     // "pending" | "running" | "done" | "error"
}

// ─── Publicação (sua lógica existente, aqui como referência) ──────────────────

async function waitForContainer(
  containerId: string,
  token: string,
  maxAttempts = 20,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(6_000);
    const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${token}`);
    const data = await res.json() as { status_code?: string };
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR")    return false;
  }
  return false;
}

async function publishOne(post: ScheduledPost): Promise<{
  success: boolean;
  mediaId?: string;
  errorMsg?: string;
  errorCode?: number;
}> {
  const { accountId: igId, accessToken: token, mediaUrl, mediaType, postType, caption } = post;
  const isVideo = mediaType === "VIDEO";

  try {
    // Montar payload — mantém exatamente a lógica do seu publish.mjs
    let payload: Record<string, unknown> = { access_token: token };

    if (postType === "FEED") {
      payload = isVideo
        ? { ...payload, video_url: mediaUrl, media_type: "REELS", caption }
        : { ...payload, image_url: mediaUrl, caption };
    } else if (postType === "REEL") {
      if (!isVideo) return { success: false, errorMsg: "Reels só aceita VIDEO" };
      payload = { ...payload, video_url: mediaUrl, media_type: "REELS", caption, share_to_feed: true };
    } else if (postType === "STORY") {
      payload = isVideo
        ? { ...payload, video_url: mediaUrl, media_type: "VIDEO" }
        : { ...payload, image_url: mediaUrl };
    }

    // Criar container de mídia
    const cRes  = await fetch(`${GRAPH}/${igId}/media`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const cData = await cRes.json() as { id?: string; error?: { message: string; code: number } };
    if (cData.error) return { success: false, errorMsg: cData.error.message, errorCode: cData.error.code };

    // Aguardar processamento de vídeo
    if (isVideo || postType === "REEL") {
      const ready = await waitForContainer(cData.id!, token);
      if (!ready) return { success: false, errorMsg: "Timeout no processamento do vídeo (120s)" };
    }

    // Publicar
    const pRes  = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    const pData = await pRes.json() as { id?: string; error?: { message: string; code: number } };
    if (pData.error) return { success: false, errorMsg: pData.error.message, errorCode: pData.error.code };

    return { success: true, mediaId: pData.id };

  } catch (err) {
    return { success: false, errorMsg: (err as Error).message };
  }
}

// ─── Reagendar para o próximo slot (loop) ─────────────────────────────────────

async function rescheduleLoop(post: ScheduledPost): Promise<void> {
  // Buscar estado de warmup da conta para usar os limites corretos
  const warmup = await prisma.warmupState.findUnique({ where: { id: post.accountId } });
  const stageConfig = warmup?.graduated
    ? null
    : WARMUP_STAGES.find((s) => s.stage === (warmup?.stage ?? 1));

  const minGap = stageConfig?.minGapMin ?? GLOBAL_LIMITS.minDelayMin;
  const maxGap = stageConfig?.maxGapMin ?? GLOBAL_LIMITS.maxDelayMin;

  const next = calcNextSlot({
    afterMs:     Date.now(),
    minGapMin:   minGap,
    maxGapMin:   maxGap,
    windowStart: GLOBAL_LIMITS.postWindowStart,
    windowEnd:   GLOBAL_LIMITS.postWindowEnd,
  });

  // Aqui você atualiza o registro no seu banco/store de fila
  // Adapte para o seu ORM / IndexedDB / tabela existente
  await prisma.$executeRaw`
    UPDATE scheduled_posts
    SET scheduled_at = ${new Date(next.timestamp)}, status = 'pending'
    WHERE id = ${post.id}
  `;

  console.log(`[process-posts] 🔄 ${post.accountId} — reagendado para ${next.isoString}`);
}

// ─── Handler principal ────────────────────────────────────────────────────────

export default async function handler(_req: Request, _context: Context): Promise<Response> {
  const startedAt = Date.now();
  const results: Array<{
    postId:    string;
    accountId: string;
    outcome:   "published" | "skipped" | "error" | "rate_limited";
    reason?:   string;
  }> = [];

  console.log(`[process-posts] ⏰ Iniciando — ${new Date().toISOString()}`);

  // Buscar posts pendentes com scheduledAt <= agora
  // ADAPTE a query para o seu banco / ORM existente
  const duePosts = await prisma.$queryRaw<ScheduledPost[]>`
    SELECT id, account_id as "accountId", access_token as "accessToken",
           media_url as "mediaUrl", media_type as "mediaType",
           post_type as "postType", caption, scheduled_at as "scheduledAt",
           loop, status
    FROM scheduled_posts
    WHERE status = 'pending'
      AND scheduled_at <= NOW()
    ORDER BY scheduled_at ASC
    LIMIT 30
  `;

  if (!duePosts.length) {
    console.log("[process-posts] Nenhum post pendente.");
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  console.log(`[process-posts] ${duePosts.length} posts pendentes`);

  for (const post of duePosts) {
    // ── Verificar warm-up + rate limit ──────────────────────────────────────
    const check = await canPublish(
      post.accountId,
      post.accessToken,
      true, // consultar quota da Meta
    );

    if (!check.canPost) {
      console.log(
        `[process-posts] ⏳ ${post.accountId} — AGUARDAR: ${check.reason} (${check.waitHuman})`,
      );

      // Se for limite diário → marcar como "deferred" e reagendar para amanhã
      if (check.reason?.includes("Limite diário")) {
        const nextSlot = calcNextSlot({
          afterMs:    Date.now(),
          minGapMin:  60,
          maxGapMin:  90,
          windowStart: GLOBAL_LIMITS.postWindowStart,
          windowEnd:   GLOBAL_LIMITS.postWindowEnd,
        });
        await prisma.$executeRaw`
          UPDATE scheduled_posts
          SET scheduled_at = ${new Date(nextSlot.timestamp)}
          WHERE id = ${post.id}
        `;
      }

      results.push({ postId: post.id, accountId: post.accountId, outcome: "skipped", reason: check.reason });
      continue;
    }

    // ── Marcar como "running" ─────────────────────────────────────────────
    await prisma.$executeRaw`
      UPDATE scheduled_posts SET status = 'running' WHERE id = ${post.id}
    `;

    // ── Publicar ──────────────────────────────────────────────────────────
    const t0     = Date.now();
    const result = await publishOne(post);
    const elapsed = Date.now() - t0;

    // ── Registrar no PostingLog + atualizar contadores ────────────────────
    await recordPost({
      accountId: post.accountId,
      mediaUrl:  post.mediaUrl,
      mediaType: post.mediaType,
      postType:  post.postType,
      caption:   post.caption,
      success:   result.success,
      errorMsg:  result.errorMsg,
      mediaId:   result.mediaId,
      delayMs:   elapsed,
    });

    if (result.success) {
      // Resolver back-offs anteriores (se houver)
      await resolveBackoff(post.accountId);

      // Atualizar status do post
      if (post.loop) {
        await rescheduleLoop(post);
      } else {
        await prisma.$executeRaw`
          UPDATE scheduled_posts SET status = 'done' WHERE id = ${post.id}
        `;
      }

      results.push({ postId: post.id, accountId: post.accountId, outcome: "published" });
      console.log(`[process-posts] ✅ ${post.accountId} — publicado (${post.postType})`);

    } else {
      // Erro — salvar e verificar se é rate limit
      await prisma.$executeRaw`
        UPDATE scheduled_posts SET status = 'error', error_msg = ${result.errorMsg} WHERE id = ${post.id}
      `;

      const outcome = result.errorCode && [4, 17, 32, 613].includes(result.errorCode)
        ? "rate_limited"
        : "error";

      results.push({
        postId:    post.id,
        accountId: post.accountId,
        outcome,
        reason:    result.errorMsg,
      });
      console.error(`[process-posts] ❌ ${post.accountId} — falhou: ${result.errorMsg}`);
    }

    // ── Delay entre contas (sua config: 10-18 min randômico) ─────────────
    // Aqui aplicamos um delay MUITO menor entre iterações do loop da função,
    // pois o scheduler já respeita os gaps via scheduledAt.
    // Este delay é apenas para não sobrecarregar a API em uma única invocação.
    if (duePosts.indexOf(post) < duePosts.length - 1) {
      await sleep(2_000); // 2s entre chamadas à API dentro desta invocação
    }
  }

  const elapsed = Date.now() - startedAt;
  const summary = {
    processed:    results.length,
    published:    results.filter((r) => r.outcome === "published").length,
    skipped:      results.filter((r) => r.outcome === "skipped").length,
    errors:       results.filter((r) => r.outcome === "error").length,
    rateLimited:  results.filter((r) => r.outcome === "rate_limited").length,
    elapsedMs:    elapsed,
    results,
  };

  console.log(`[process-posts] Concluído em ${elapsed}ms:`, summary);

  return new Response(JSON.stringify(summary), {
    status:  200,
    headers: { "Content-Type": "application/json" },
  });
}

// Netlify Scheduled Function: roda a cada 10 minutos
export const config: Config = {
  schedule: "*/10 * * * *",
};
