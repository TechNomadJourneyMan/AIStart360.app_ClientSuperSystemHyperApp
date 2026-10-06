/**
 * Wire types of /api/giga-admin/ai-providers/* as the browser sees them
 * (dates are ISO strings). The server shapes live in lib/ai/providers/service.ts;
 * a key's secret never appears here — only `masked` («••••abcd»).
 */
export type ProviderKind = 'openrouter' | 'openai_compatible'
export type Capability = 'chat' | 'embeddings' | 'rerank' | 'ocr'
export type ChatTier = 'light' | 'standard' | 'premium'
export type OcrMode = 'chat_vision'
export type SpendGroupBy = 'provider' | 'model' | 'feature' | 'company'

export interface CredentialDto {
  id: string
  provider_id: string
  label: string
  secret_hint: string | null
  masked: string
  enabled: boolean
  last_verified_at: string | null
  last_verify_ok: boolean | null
  last_verify_error: string | null
  created_by: string | null
  created_at: string
  rotated_at: string | null
  updated_at: string
}

export interface ModelDto {
  id: string
  provider_id: string
  credential_id: string | null
  model_id: string
  capability: Capability
  label: string | null
  price_in_per_mtok: number | null
  price_out_per_mtok: number | null
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ProviderRouteRef {
  capability: Capability
  tier: ChatTier | null
  model_id: string
  model: string
}

export interface ProviderDto {
  id: string
  key: string
  name: string
  kind: ProviderKind
  base_url: string
  chat_path: string
  embeddings_path: string
  rerank_path: string | null
  ocr_mode: OcrMode | null
  extra_headers: Record<string, string>
  supports_response_format: boolean
  enabled: boolean
  daily_budget_usd: number | null
  privacy_note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  credentials: CredentialDto[]
  models: ModelDto[]
  routes: ProviderRouteRef[]
}

export interface ProvidersResponse { ok: true; providers: ProviderDto[]; encryptionConfigured: boolean }

export interface RouteDto {
  capability: Capability
  tier: ChatTier | null
  modelRowId: string
  modelId: string
  providerKey: string
  providerEnabled: boolean
  modelEnabled: boolean
  updatedBy: string | null
  updatedAt: string
}

export interface RoutesResponse { ok: true; routes: RouteDto[] }

export interface BudgetLevelDto { dailyUsd: number; source: 'db' | 'env'; configured: number | null }

export interface BudgetsDto {
  platform: BudgetLevelDto
  company: BudgetLevelDto
  providers: Array<{ key: string; name: string; dailyBudgetUsd: number | null; spentTodayUsd: number }>
  updatedBy: string | null
  updatedAt: string | null
}

export interface BudgetsResponse { ok: true; budgets: BudgetsDto }

export interface SpendRowDto { key: string | null; costUsd: number; calls: number; tokensIn: number; tokensOut: number }

export interface SpendResponse { ok: true; days: number; groupBy: SpendGroupBy; totalUsd: number; rows: SpendRowDto[] }

export interface VerifyResultDto {
  ok: boolean
  error: string | null
  checkedWith: 'chat' | 'embeddings' | 'models'
  model: string | null
  credential: CredentialDto
}
