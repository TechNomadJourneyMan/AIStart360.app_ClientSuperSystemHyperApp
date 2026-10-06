/**
 * lib/ai/providers/store.ts — data access for providers, credentials, models,
 * routes and budgets (migration 094). Server-only; Prisma raw SQL like the
 * agent store. Numerics are bound as text (`${x}::text::numeric`): binding a JS
 * number directly into a NUMERIC column after an integer one trips Prisma.
 *
 * This layer does no validation and no encryption — that is service.ts.
 * Credential rows carry the ciphertext; only the service/router may read them.
 */
import { prisma } from '@/lib/db'
import type {
  BudgetsRow,
  Capability,
  ChatTier,
  CredentialRow,
  ModelRow,
  ProviderRow,
  ProviderSnapshot,
  RouteRow,
} from './types'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const numText = (v: number | null | undefined): string | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : String(v)

function provider(r: Record<string, unknown>): ProviderRow {
  return {
    ...(r as unknown as ProviderRow),
    extra_headers: (r.extra_headers ?? {}) as Record<string, string>,
    daily_budget_usd: num(r.daily_budget_usd),
  }
}

function model(r: Record<string, unknown>): ModelRow {
  return {
    ...(r as unknown as ModelRow),
    price_in_per_mtok: num(r.price_in_per_mtok),
    price_out_per_mtok: num(r.price_out_per_mtok),
  }
}

// ── providers ──────────────────────────────────────────────────────────────

export async function listProviders(): Promise<ProviderRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.ai_providers ORDER BY created_at, key`
  return rows.map(provider)
}

export async function getProvider(id: string): Promise<ProviderRow | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.ai_providers WHERE id = ${id}::uuid`
  return rows[0] ? provider(rows[0]) : null
}

export async function getProviderByKey(key: string): Promise<ProviderRow | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.ai_providers WHERE key = ${key}`
  return rows[0] ? provider(rows[0]) : null
}

export interface ProviderWrite {
  key: string
  name: string
  kind: ProviderRow['kind']
  base_url: string
  chat_path: string
  embeddings_path: string
  rerank_path: string | null
  ocr_mode: ProviderRow['ocr_mode']
  extra_headers: Record<string, string>
  supports_response_format: boolean
  enabled: boolean
  daily_budget_usd: number | null
  privacy_note: string | null
}

export async function insertProvider(p: ProviderWrite, createdBy: string): Promise<ProviderRow> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    INSERT INTO public.ai_providers
      (key, name, kind, base_url, chat_path, embeddings_path, rerank_path, ocr_mode, extra_headers,
       supports_response_format, enabled, daily_budget_usd, privacy_note, created_by)
    VALUES (${p.key}, ${p.name}, ${p.kind}, ${p.base_url}, ${p.chat_path}, ${p.embeddings_path}, ${p.rerank_path},
            ${p.ocr_mode}, ${JSON.stringify(p.extra_headers)}::jsonb, ${p.supports_response_format}, ${p.enabled},
            ${numText(p.daily_budget_usd)}::text::numeric, ${p.privacy_note}, ${createdBy})
    RETURNING *`
  return provider(rows[0])
}

/** Writes every mutable column (the service merges the patch first). `key` is immutable. */
export async function updateProviderRow(id: string, p: Omit<ProviderWrite, 'key'>): Promise<ProviderRow | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    UPDATE public.ai_providers SET
      name = ${p.name}, kind = ${p.kind}, base_url = ${p.base_url}, chat_path = ${p.chat_path},
      embeddings_path = ${p.embeddings_path}, rerank_path = ${p.rerank_path}, ocr_mode = ${p.ocr_mode},
      extra_headers = ${JSON.stringify(p.extra_headers)}::jsonb, supports_response_format = ${p.supports_response_format},
      enabled = ${p.enabled}, daily_budget_usd = ${numText(p.daily_budget_usd)}::text::numeric,
      privacy_note = ${p.privacy_note}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING *`
  return rows[0] ? provider(rows[0]) : null
}

export async function deleteProviderRow(id: string): Promise<boolean> {
  const n = await prisma.$executeRaw`DELETE FROM public.ai_providers WHERE id = ${id}::uuid`
  return n > 0
}

// ── credentials ────────────────────────────────────────────────────────────

export async function listCredentials(providerId?: string): Promise<CredentialRow[]> {
  return prisma.$queryRaw<CredentialRow[]>`
    SELECT * FROM public.ai_credentials
    WHERE (${providerId ?? null}::uuid IS NULL OR provider_id = ${providerId ?? null}::uuid)
    ORDER BY created_at, id`
}

export async function getCredential(id: string): Promise<CredentialRow | null> {
  const rows = await prisma.$queryRaw<CredentialRow[]>`SELECT * FROM public.ai_credentials WHERE id = ${id}::uuid`
  return rows[0] ?? null
}

export async function insertCredential(c: {
  id: string
  providerId: string
  label: string
  ciphertext: string
  hint: string
  enabled: boolean
  createdBy: string
}): Promise<CredentialRow> {
  const rows = await prisma.$queryRaw<CredentialRow[]>`
    INSERT INTO public.ai_credentials (id, provider_id, label, secret_ciphertext, secret_hint, enabled, created_by)
    VALUES (${c.id}::uuid, ${c.providerId}::uuid, ${c.label}, ${c.ciphertext}, ${c.hint}, ${c.enabled}, ${c.createdBy})
    RETURNING *`
  return rows[0]
}

export async function updateCredentialMeta(id: string, m: { label: string; enabled: boolean }): Promise<CredentialRow | null> {
  const rows = await prisma.$queryRaw<CredentialRow[]>`
    UPDATE public.ai_credentials SET label = ${m.label}, enabled = ${m.enabled}, updated_at = now()
    WHERE id = ${id}::uuid RETURNING *`
  return rows[0] ?? null
}

/** New secret: verification state is reset (the new key is unverified). */
export async function rotateCredentialSecret(id: string, ciphertext: string, hint: string): Promise<CredentialRow | null> {
  const rows = await prisma.$queryRaw<CredentialRow[]>`
    UPDATE public.ai_credentials SET
      secret_ciphertext = ${ciphertext}, secret_hint = ${hint}, rotated_at = now(), updated_at = now(),
      last_verified_at = NULL, last_verify_ok = NULL, last_verify_error = NULL
    WHERE id = ${id}::uuid RETURNING *`
  return rows[0] ?? null
}

export async function recordVerification(id: string, ok: boolean, error: string | null): Promise<CredentialRow | null> {
  const rows = await prisma.$queryRaw<CredentialRow[]>`
    UPDATE public.ai_credentials SET
      last_verified_at = now(), last_verify_ok = ${ok}, last_verify_error = ${error?.slice(0, 500) ?? null}
    WHERE id = ${id}::uuid RETURNING *`
  return rows[0] ?? null
}

export async function deleteCredentialRow(id: string): Promise<boolean> {
  const n = await prisma.$executeRaw`DELETE FROM public.ai_credentials WHERE id = ${id}::uuid`
  return n > 0
}

// ── models ─────────────────────────────────────────────────────────────────

export async function listModels(providerId?: string): Promise<ModelRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.ai_models
    WHERE (${providerId ?? null}::uuid IS NULL OR provider_id = ${providerId ?? null}::uuid)
    ORDER BY capability, model_id`
  return rows.map(model)
}

export async function getModel(id: string): Promise<ModelRow | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM public.ai_models WHERE id = ${id}::uuid`
  return rows[0] ? model(rows[0]) : null
}

export interface ModelWrite {
  providerId: string
  credentialId: string | null
  modelId: string
  capability: Capability
  label: string | null
  priceInPerMtok: number | null
  priceOutPerMtok: number | null
  enabled: boolean
}

/** Insert or update by (provider, model id, capability). */
export async function upsertModelRow(m: ModelWrite): Promise<ModelRow> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    INSERT INTO public.ai_models
      (provider_id, credential_id, model_id, capability, label, price_in_per_mtok, price_out_per_mtok, enabled)
    VALUES (${m.providerId}::uuid, ${m.credentialId}::uuid, ${m.modelId}, ${m.capability}, ${m.label},
            ${numText(m.priceInPerMtok)}::text::numeric, ${numText(m.priceOutPerMtok)}::text::numeric, ${m.enabled})
    ON CONFLICT (provider_id, model_id, capability) DO UPDATE SET
      credential_id = EXCLUDED.credential_id, label = EXCLUDED.label,
      price_in_per_mtok = EXCLUDED.price_in_per_mtok, price_out_per_mtok = EXCLUDED.price_out_per_mtok,
      enabled = EXCLUDED.enabled, updated_at = now()
    RETURNING *`
  return model(rows[0])
}

export async function deleteModelRow(id: string): Promise<boolean> {
  const n = await prisma.$executeRaw`DELETE FROM public.ai_models WHERE id = ${id}::uuid`
  return n > 0
}

// ── routes ─────────────────────────────────────────────────────────────────

export async function listRoutes(): Promise<RouteRow[]> {
  return prisma.$queryRaw<RouteRow[]>`SELECT * FROM public.ai_routes ORDER BY capability, tier`
}

export async function upsertRoute(capability: Capability, tier: ChatTier | null, modelRowId: string, by: string): Promise<RouteRow> {
  const rows = await prisma.$queryRaw<RouteRow[]>`
    INSERT INTO public.ai_routes (capability, tier, model_id, updated_by)
    VALUES (${capability}, ${tier}, ${modelRowId}::uuid, ${by})
    ON CONFLICT (capability, coalesce(tier, '')) DO UPDATE SET
      model_id = EXCLUDED.model_id, updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING *`
  return rows[0]
}

export async function deleteRoute(capability: Capability, tier: ChatTier | null): Promise<boolean> {
  const n = await prisma.$executeRaw`
    DELETE FROM public.ai_routes WHERE capability = ${capability} AND coalesce(tier, '') = coalesce(${tier}::text, '')`
  return n > 0
}

// ── budgets ────────────────────────────────────────────────────────────────

export async function getBudgetsRow(): Promise<BudgetsRow | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT platform_daily_usd, company_daily_usd, updated_by, updated_at FROM public.ai_budgets WHERE id = 1`
  const r = rows[0]
  if (!r) return null
  return {
    platform_daily_usd: num(r.platform_daily_usd),
    company_daily_usd: num(r.company_daily_usd),
    updated_by: (r.updated_by as string | null) ?? null,
    updated_at: (r.updated_at as Date | null) ?? null,
  }
}

export async function setBudgetsRow(b: { platformDailyUsd: number | null; companyDailyUsd: number | null; by: string }): Promise<BudgetsRow> {
  await prisma.$executeRaw`
    INSERT INTO public.ai_budgets (id, platform_daily_usd, company_daily_usd, updated_by, updated_at)
    VALUES (1, ${numText(b.platformDailyUsd)}::text::numeric, ${numText(b.companyDailyUsd)}::text::numeric, ${b.by}, now())
    ON CONFLICT (id) DO UPDATE SET
      platform_daily_usd = EXCLUDED.platform_daily_usd, company_daily_usd = EXCLUDED.company_daily_usd,
      updated_by = EXCLUDED.updated_by, updated_at = now()`
  return (await getBudgetsRow()) as BudgetsRow
}

// ── snapshot for the router ────────────────────────────────────────────────

export async function loadSnapshot(): Promise<ProviderSnapshot> {
  const [providers, credentials, models, routes, budgets] = await Promise.all([
    listProviders(),
    listCredentials(),
    listModels(),
    listRoutes(),
    getBudgetsRow(),
  ])
  return { providers, credentials, models, routes, budgets }
}

// ── spend ──────────────────────────────────────────────────────────────────

/** USD a provider spent today (UTC day): non-agent ledger rows + agent runs. */
export async function providerSpendToday(providerKey: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ s: unknown }>>`
    SELECT
      (SELECT coalesce(sum(cost_usd), 0) FROM public.ai_usage_ledger
        WHERE provider_key = ${providerKey} AND created_at >= date_trunc('day', now()))
    + (SELECT coalesce(sum(cost_usd), 0) FROM public.agent_runs
        WHERE provider_key = ${providerKey} AND started_at >= date_trunc('day', now())) AS s`
  return Number(rows[0]?.s ?? 0)
}

export type SpendGroupBy = 'provider' | 'model' | 'feature' | 'company'

export interface SpendRow {
  /** Provider key / model id / source ('feature:x', 'agent:x') / company id; null = not recorded. */
  key: string | null
  costUsd: number
  calls: number
  tokensIn: number
  tokensOut: number
}

/**
 * Spend over the last `days` days from ai_usage_ledger (non-agent features)
 * and agent_runs (agents; one row per run, calls = llm_calls). Agent runs keep
 * the provider of their last model call.
 */
export async function spendSummaryRows(days: number, groupBy: SpendGroupBy): Promise<SpendRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH calls AS (
      SELECT source, model, provider_key, company_id, cost_usd, 1 AS calls, tokens_in, tokens_out
      FROM public.ai_usage_ledger
      WHERE created_at >= now() - make_interval(days => ${String(days)}::text::int)
      UNION ALL
      SELECT 'agent:' || agent_key, model, provider_key, company_id, cost_usd, llm_calls, tokens_in, tokens_out
      FROM public.agent_runs
      WHERE started_at >= now() - make_interval(days => ${String(days)}::text::int) AND llm_calls > 0
    )
    SELECT
      CASE ${groupBy}::text
        WHEN 'provider' THEN provider_key
        WHEN 'model' THEN model
        WHEN 'feature' THEN source
        ELSE company_id
      END AS key,
      coalesce(sum(cost_usd), 0) AS cost, coalesce(sum(calls), 0) AS calls,
      coalesce(sum(tokens_in), 0) AS tin, coalesce(sum(tokens_out), 0) AS tout
    FROM calls
    GROUP BY 1
    ORDER BY 2 DESC, 1
    LIMIT 200`
  return rows.map((r) => ({
    key: (r.key as string | null) ?? null,
    costUsd: Number(r.cost ?? 0),
    calls: Number(r.calls ?? 0),
    tokensIn: Number(r.tin ?? 0),
    tokensOut: Number(r.tout ?? 0),
  }))
}
