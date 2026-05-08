import { z } from 'zod';

export const PortalConfigSchema = z
  .object({
    baseUrl: z.string().url(),
  })
  .strict();

export const RateLimitConfigSchema = z
  .object({
    requestsPerSecondPerHost: z.number().positive().max(10),
  })
  .strict();

export const ConcurrencyConfigSchema = z
  .object({
    maxConcurrentRequestsPerHost: z.number().int().min(1).max(8),
  })
  .strict();

export const BackoffConfigSchema = z
  .object({
    initialMs: z.number().int().min(100),
    maxMs: z.number().int().min(1000),
    failureBudget: z.number().int().min(1),
  })
  .strict();

export const RobotsConfigSchema = z
  .object({
    recheckIntervalSeconds: z.number().int().min(60),
  })
  .strict();

export const CrawlerConfigSchema = z
  .object({
    userAgent: z.string().min(1),
    rateLimit: RateLimitConfigSchema,
    concurrency: ConcurrencyConfigSchema,
    backoff: BackoffConfigSchema,
    robots: RobotsConfigSchema,
  })
  .strict();

export const StoreConfigSchema = z
  .object({
    root: z.string().min(1),
    freshnessSloSeconds: z.number().int().min(60).default(86400),
  })
  .strict();

export const NotifierConfigSchema = z
  .object({
    kind: z.enum(['stderr', 'webhook']),
    webhookUrl: z.string().url().nullable().optional(),
    webhookBearerEnv: z.string().min(1).nullable().optional(),
  })
  .strict();

export const ScheduleConfigSchema = z
  .object({
    enabled: z.boolean(),
    cron: z.string().nullable().optional(),
    timezone: z.string().default('Europe/Sofia'),
    onOverlap: z.enum(['skip', 'queue']),
    failureRateThreshold: z.number().min(0).max(1),
    notifier: NotifierConfigSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.enabled && !val.cron) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'schedule.cron is required when schedule.enabled=true',
        path: ['cron'],
      });
    }
  });

export const ScopeConfigSchema = z
  .object({
    publishers: z.array(z.string().min(1)).optional(),
    categories: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    datasetIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const TranslatorConfigSchema = z
  .object({
    provider: z.enum(['local-marianmt', 'hosted-api']),
    modelId: z.string().nullable().optional(),
    endpointUrl: z.string().url().nullable().optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
  })
  .strict();

export const EmbedderConfigSchema = z
  .object({
    provider: z.enum(['local-onnx', 'hosted-api']),
    modelId: z.string().nullable().optional(),
    endpointUrl: z.string().url().nullable().optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
  })
  .strict();

export const EnrichmentConfigSchema = z
  .object({
    translator: TranslatorConfigSchema,
    embedder: EmbedderConfigSchema,
  })
  .strict();

export const IndexConfigSchema = z
  .object({
    incremental: z.boolean(),
  })
  .strict();

export const DanniConfigSchema = z
  .object({
    portal: PortalConfigSchema,
    crawler: CrawlerConfigSchema,
    store: StoreConfigSchema,
    schedule: ScheduleConfigSchema,
    scope: ScopeConfigSchema,
    enrichment: EnrichmentConfigSchema,
    index: IndexConfigSchema,
  })
  .strict();

export type DanniConfig = z.infer<typeof DanniConfigSchema>;
export type PortalConfig = z.infer<typeof PortalConfigSchema>;
export type CrawlerConfig = z.infer<typeof CrawlerConfigSchema>;
export type StoreConfig = z.infer<typeof StoreConfigSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;
export type ScopeConfig = z.infer<typeof ScopeConfigSchema>;
export type NotifierConfig = z.infer<typeof NotifierConfigSchema>;
export type EnrichmentConfig = z.infer<typeof EnrichmentConfigSchema>;
export type TranslatorConfig = z.infer<typeof TranslatorConfigSchema>;
export type EmbedderConfig = z.infer<typeof EmbedderConfigSchema>;
export type IndexConfig = z.infer<typeof IndexConfigSchema>;
