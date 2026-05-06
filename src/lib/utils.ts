// =============================================================================
// src/lib/utils.ts
// Funções utilitárias puras — sem dependências externas nem efeitos colaterais.
// =============================================================================

import {
  JITTER_FACTOR,
  GLOBAL_LIMITS,
  WARMUP_STAGES,
  WarmupStage,
} from "./warmup-config.js";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface TimeSlot {
  timestamp: number;   // ms Unix
  isoString: string;
  isInWindow: boolean;
}

export interface NextSlotOptions {
  afterMs:      number;          // base "a partir de quando" (ms Unix)
  minGapMin:    number;
  maxGapMin:    number;
  windowStart:  number;          // hora 0-23
  windowEnd:    number;          // hora 0-23
  timezoneOffset?: number;       // offset em minutos (padrão 0 = UTC)
}

// ─── Jitter ──────────────────────────────────────────────────────────────────

/**
 * Aplica jitter aleatório a um valor base.
 * Retorna um valor entre base*(1-factor) e base*(1+factor).
 *
 * Exemplo: jitterMs(60_000, 0.2) → entre 48_000 e 72_000
 */
export function jitterMs(baseMs: number, factor = JITTER_FACTOR): number {
  const spread = baseMs * factor;
  return Math.round(baseMs + (Math.random() * 2 - 1) * spread);
}

/**
 * Delay aleatório em ms entre [minMs, maxMs], com jitter adicional.
 */
export function randomDelayMs(minMs: number, maxMs: number): number {
  const base = minMs + Math.random() * (maxMs - minMs);
  return jitterMs(Math.round(base));
}

/**
 * Delay em ms a partir de minutos min/max (atalho).
 */
export function randomDelayFromMinutes(minMin: number, maxMin: number): number {
  return randomDelayMs(minMin * 60_000, maxMin * 60_000);
}

// ─── Janela de postagem ───────────────────────────────────────────────────────

/**
 * Retorna true se o timestamp está dentro da janela permitida.
 * Usa timezoneOffset (minutos) para converter UTC → local.
 */
export function isInPostWindow(
  tsMs: number,
  windowStart = GLOBAL_LIMITS.postWindowStart,
  windowEnd   = GLOBAL_LIMITS.postWindowEnd,
  timezoneOffsetMin = 0,
): boolean {
  const localMs  = tsMs + timezoneOffsetMin * 60_000;
  const hour     = new Date(localMs).getUTCHours();
  return hour >= windowStart && hour < windowEnd;
}

/**
 * Avança um timestamp para o início da próxima janela permitida.
 * Ex: se agora é 00:30 e janela começa às 7h, retorna 7h de hoje.
 */
export function advanceToWindow(
  tsMs: number,
  windowStart = GLOBAL_LIMITS.postWindowStart,
  windowEnd   = GLOBAL_LIMITS.postWindowEnd,
  timezoneOffsetMin = 0,
): number {
  if (isInPostWindow(tsMs, windowStart, windowEnd, timezoneOffsetMin)) {
    return tsMs;
  }

  const localMs   = tsMs + timezoneOffsetMin * 60_000;
  const d         = new Date(localMs);
  const hour      = d.getUTCHours();

  if (hour < windowStart) {
    // Ainda antes da janela de hoje → avançar para windowStart de hoje
    d.setUTCHours(windowStart, 0, 0, 0);
  } else {
    // Passou do fim da janela → windowStart de amanhã
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(windowStart, 0, 0, 0);
  }

  // Converter de volta para UTC
  const newTsMs = d.getTime() - timezoneOffsetMin * 60_000;
  // Adiciona jitter de 0-15 min para não bater exatamente na hora cheia
  return newTsMs + Math.round(Math.random() * 15 * 60_000);
}

// ─── Próximo slot de postagem ─────────────────────────────────────────────────

/**
 * Calcula o próximo timestamp seguro para postar.
 *
 * 1. Parte de `afterMs` (agora ou último post + delay mínimo)
 * 2. Aplica delay aleatório com jitter
 * 3. Verifica se está na janela — se não, empurra para a próxima janela
 */
export function calcNextSlot(opts: NextSlotOptions): TimeSlot {
  const {
    afterMs,
    minGapMin,
    maxGapMin,
    windowStart  = GLOBAL_LIMITS.postWindowStart,
    windowEnd    = GLOBAL_LIMITS.postWindowEnd,
    timezoneOffset = 0,
  } = opts;

  const delayMs = randomDelayFromMinutes(minGapMin, maxGapMin);
  let ts        = afterMs + delayMs;

  // Verificar janela e avançar se necessário
  ts = advanceToWindow(ts, windowStart, windowEnd, timezoneOffset);

  return {
    timestamp:  ts,
    isoString:  new Date(ts).toISOString(),
    isInWindow: isInPostWindow(ts, windowStart, windowEnd, timezoneOffset),
  };
}

// ─── Distribuição diária ──────────────────────────────────────────────────────

/**
 * Distribui N posts ao longo de uma janela de horas (ex: 7h-23h = 16h),
 * respeitando o gap mínimo entre posts e adicionando jitter natural.
 *
 * Retorna um array de timestamps ordenados.
 */
export function distributePostsOverDay(
  count:          number,
  dayStartMs:     number,          // início do dia (ms Unix)
  stage:          WarmupStage,
  timezoneOffset  = 0,
): number[] {
  if (count <= 0) return [];

  const windowStart = GLOBAL_LIMITS.postWindowStart;
  const windowEnd   = GLOBAL_LIMITS.postWindowEnd;

  // Calcular timestamp do início da janela deste dia
  const localDayStart = dayStartMs + timezoneOffset * 60_000;
  const d = new Date(localDayStart);
  d.setUTCHours(windowStart, 0, 0, 0);
  const windowStartMs = d.getTime() - timezoneOffset * 60_000;
  const windowEndMs   = windowStartMs + (windowEnd - windowStart) * 3_600_000;
  const windowDuration = windowEndMs - windowStartMs;

  // Gap base = janela / número de posts
  const baseGapMs = Math.floor(windowDuration / count);
  const minGapMs  = stage.minGapMin * 60_000;

  if (baseGapMs < minGapMs) {
    // Muitos posts para a janela — usar gap mínimo e concentrar no início
    console.warn(`[distributePostsOverDay] Gap base ${baseGapMs}ms < mínimo ${minGapMs}ms para ${count} posts`);
  }

  const slots: number[] = [];
  let cursor = windowStartMs + Math.round(Math.random() * 10 * 60_000); // offset inicial 0-10 min

  for (let i = 0; i < count; i++) {
    // Jitter ±20% sobre o gap base
    const gap   = jitterMs(Math.max(baseGapMs, minGapMs));
    const slot  = i === 0 ? cursor : cursor + gap;
    cursor      = slot;

    if (slot >= windowEndMs) break; // não ultrapassar o fim da janela
    slots.push(slot);
  }

  return slots;
}

// ─── Helpers de data ──────────────────────────────────────────────────────────

/**
 * Chave de data "YYYY-MM-DD" em UTC.
 * Usada para comparar se é o mesmo dia ao resetar contadores.
 */
export function utcDateKey(tsMs = Date.now()): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

/**
 * Hora UTC atual (0-23).
 */
export function utcHour(tsMs = Date.now()): number {
  return new Date(tsMs).getUTCHours();
}

/**
 * Back-off exponencial em ms para o N-ésimo evento de rate limit.
 */
export function calcBackoffMs(eventCount: number): number {
  const BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480];
  const idx = Math.min(eventCount, BACKOFF_MINUTES.length - 1);
  const baseMs = BACKOFF_MINUTES[idx] * 60_000;
  return jitterMs(baseMs, 0.10); // jitter menor no backoff (±10%)
}

/**
 * Formata milissegundos em string legível: "2h 15m" ou "45s".
 */
export function formatWaitTime(ms: number): string {
  if (ms <= 0) return "agora";
  const s = Math.ceil(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}
