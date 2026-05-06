// =============================================================================
// src/lib/warmup-config.ts
// Configuração central dos estágios de warm-up e limites globais.
// Altere apenas aqui — todo o restante do sistema lê deste arquivo.
// =============================================================================

/**
 * Plano de warm-up acelerado por DIAS (não semanas).
 * Objetivo: conta entregando forte a partir do Dia 3.
 *
 * Raciocínio dos limites:
 *   - A Meta monitora velocidade de crescimento de atividade por conta.
 *   - Contas novas postando 50/dia no Dia 1 levantam flags imediatas.
 *   - Aumentar ~70% a cada 1-2 dias imita padrão humano orgânico.
 *   - Jitter de ±20% nos horários evita fingerprint de automação.
 */
export const WARMUP_STAGES = [
  {
    stage:        1,
    label:        "Aquecimento suave",
    durationDays: 1,       // permanece 1 dia neste estágio
    maxPerDay:    6,        // 6 posts no dia 1
    maxPerHour:   1,        // máximo 1 por hora
    minGapMin:    60,       // mínimo 60 min entre posts
    maxGapMin:    120,
    description:  "Dia 1: tráfego mínimo para ativar a conta sem alarmar algoritmos",
  },
  {
    stage:        2,
    label:        "Aceleração inicial",
    durationDays: 1,       // 1 dia
    maxPerDay:    12,
    maxPerHour:   2,
    minGapMin:    30,
    maxGapMin:    60,
    description:  "Dia 2: dobra o volume — sinal de conta ativa",
  },
  {
    stage:        3,
    label:        "Volume moderado",
    durationDays: 1,       // 1 dia
    maxPerDay:    24,
    maxPerHour:   3,
    minGapMin:    18,
    maxGapMin:    35,
    description:  "Dia 3: força de entrega começa aqui — 50% do limite final",
  },
  {
    stage:        4,
    label:        "Volume alto",
    durationDays: 1,       // 1 dia
    maxPerDay:    36,
    maxPerHour:   4,
    minGapMin:    13,
    maxGapMin:    22,
    description:  "Dia 4: 72% do limite — conta consolidada",
  },
  {
    stage:        5,
    label:        "Volume pleno",
    durationDays: 1,       // 1 dia — após isso, `graduated = true`
    maxPerDay:    50,       // sua config atual: 50/dia
    maxPerHour:   4,        // sua config atual: 4/hora
    minGapMin:    10,       // sua config atual: 10-18 min
    maxGapMin:    18,
    description:  "Dia 5: limite pleno ativado — igual à sua config atual",
  },
] as const;

export type WarmupStage = (typeof WARMUP_STAGES)[number];

/**
 * Limites globais (seu sistema atual).
 * Usados para contas que já graduaram do warmup.
 */
export const GLOBAL_LIMITS = {
  maxPerDay:       50,
  maxPerHour:      4,
  minDelayMin:     10,     // delay entre posts (minutos)
  maxDelayMin:     18,
  /** Margem de segurança: usa apenas X% do limite declarado pela Meta */
  safetyMargin:    0.85,
  /**
   * Janela de distribuição diária.
   * Posts espalhados só entre 7h e 23h (horário local da conta).
   * Evita posts nas madrugadas — padrão mais humano.
   */
  postWindowStart: 7,      // hora de início (0-23)
  postWindowEnd:   23,     // hora de fim (0-23)
} as const;

/**
 * Códigos de erro da Meta que indicam rate limit.
 * Quando detectados → aplicar back-off exponencial.
 */
export const META_RATE_LIMIT_CODES = new Set([
  4,    // Application request limit reached
  17,   // User request limit reached
  32,   // Page-level throttling
  613,  // Calls to this API have exceeded the rate limit
]);

/**
 * Back-off exponencial por número de eventos consecutivos de rate limit.
 * index 0 = primeiro evento, index 1 = segundo, etc.
 */
export const BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480] as const;

/**
 * Jitter máximo aplicado sobre qualquer delay calculado (±%).
 * Exemplo: delay de 10 min com jitter 0.2 → entre 8 e 12 min.
 */
export const JITTER_FACTOR = 0.20;
