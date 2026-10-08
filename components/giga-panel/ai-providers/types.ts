/**
 * Wire types of /api/giga-admin/ai-providers/* as the browser sees them
 * (dates are ISO strings). The server shapes live in lib/ai/providers/service.ts;
 * a key's secret never appears here — only `masked` («••••abcd»).
 */
export type ProviderKind = 'openrouter' | 'openai_compatible'
export type Capability = 'chat' | 'embeddings' | 'rerank' | 'ocr' | 'transcribe'
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
  /** Model ids GET /models returned for this key (107); null = never discovered. */
  discovered_models?: string[] | null
  models_discovered_at?: string | null
  discovery_error?: string | null
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
  /** 107: 'manual' (entered by the owner) | 'discovered' (GET /models). */
  source?: 'manual' | 'discovered'
  discovered_at?: string | null
  supports_vision?: boolean | null
  supports_tools?: boolean | null
  tier_hint?: ChatTier | null
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

export interface DiscoveryResultDto {
  credentialId: string
  credentialLabel: string
  providerKey: string
  ok: boolean
  error: string | null
  ids: string[]
  added: number
  bound: number
  refreshed: number
}

export interface DiscoverResponse { ok: true; results: DiscoveryResultDto[] }

export interface SlotTargetDto {
  providerKey: string
  providerName: string
  model: string
  origin: 'db' | 'env'
  credentialLabel: string | null
  healthy: boolean
}

export interface SlotStatusDto {
  capability: Capability
  tier: ChatTier | null
  current: SlotTargetDto | null
  next: SlotTargetDto[]
  lastError: string | null
  lastErrorAt: string | null
  unhealthyUntil: string | null
  problem: string | null
}

export interface StatusResponse { ok: true; slots: SlotStatusDto[]; checkedAt: string }

export interface VerifyResultDto {
  ok: boolean
  error: string | null
  checkedWith: 'chat' | 'embeddings' | 'models'
  model: string | null
  credential: CredentialDto
  discovery?: DiscoveryResultDto | null
}
