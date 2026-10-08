/**
 * lib/ai/providers/types.ts — shared types of the multi-provider LLM layer
 * (migration 094, docs/platform/05-agents.md §8.1).
 */

export const PROVIDER_KINDS = ['openrouter', 'openai_compatible'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/**
 * The capabilities of migration 094. Kept as the type of ModelRow/RouteRow so
 * the pre-107 clients (the Telegram admin bot labels exactly these) compile
 * unchanged; since 107 a row may also hold 'transcribe' — read it with
 * capabilityOf() and use AiCapability / ALL_CAPABILITIES in new code.
 */
export const CAPABILITIES = ['chat', 'embeddings', 'rerank', 'ocr'] as const
export type Capability = (typeof CAPABILITIES)[number]

/** Every capability a model / route can have (107 adds speech-to-text). */
export const ALL_CAPABILITIES = ['chat', 'embeddings', 'rerank', 'ocr', 'transcribe'] as const
export type AiCapability = (typeof ALL_CAPABILITIES)[number]

/** The real capability of a model / route row (may be 'transcribe' since 107). */
export function capabilityOf(row: { capability: string }): AiCapability {
  return row.capability as AiCapability
}

/** ai_models.source (107). */
export type ModelSource = 'manual' | 'discovered'

/** Same values as gateway ModelTier (kept here to avoid an import cycle). */
export const CHAT_TIERS = ['light', 'standard', 'premium'] as const
export type ChatTier = (typeof CHAT_TIERS)[number]

export const OCR_MODES = ['chat_vision'] as const
export type OcrMode = (typeof OCR_MODES)[number]

/** Where a ledger cost came from (ai_usage_ledger.cost_source). */
export type CostSource = 'provider' | 'model_price' | 'estimate'

/**
 * Who performs a management action. Admin routes pass the staff member
 * (GigaActor id / email); the Telegram bot passes the linked chat/user.
 */
export interface ProviderActor {
  kind: 'staff' | 'telegram'
  /** Staff: profiles UUID; Telegram: the Telegram user id. */
  id: string
  /** Human-readable label for the audit log (email, @username). */
  label?: string
  /** Staff role, when known. */
  role?: string
  /** The HTTP request, when there is one (audit log IP / user agent). */
  req?: Request | null
}

export interface ProviderRow {
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
  created_at: Date
  updated_at: Date
}

/** A credential row as read from the DB — the ciphertext never leaves the server layer. */
export interface CredentialRow {
  id: string
  provider_id: string
  label: string
  secret_ciphertext: string
  secret_hint: string | null
  enabled: boolean
  last_verified_at: Date | null
  last_verify_ok: boolean | null
  last_verify_error: string | null
  /** Model ids GET /models returned for this key (107); null = never discovered. */
  discovered_models?: string[] | null
  models_discovered_at?: Date | null
  discovery_error?: string | null
  created_by: string | null
  created_at: Date
  rotated_at: Date | null
  updated_at: Date
}

/** What callers (admin UI, bots) see of a credential: never the secret. */
export type MaskedCredential = Omit<CredentialRow, 'secret_ciphertext'> & { masked: string }

export interface ModelRow {
  id: string
  provider_id: string
  credential_id: string | null
  model_id: string
  capability: Capability
  label: string | null
  price_in_per_mtok: number | null
  price_out_per_mtok: number | null
  enabled: boolean
  /** 107: 'manual' (owner) | 'discovered' (GET /models). Missing before 107 = manual. */
  source?: ModelSource
  discovered_at?: Date | null
  /** Image input; null/undefined = unknown. */
  supports_vision?: boolean | null
  /** OpenAI tools / tool_calls; null/undefined = unknown (tried). */
  supports_tools?: boolean | null
  /** Chat tier the automatic routing uses the model for first; null = any. */
  tier_hint?: ChatTier | null
  created_at: Date
  updated_at: Date
}

export interface RouteRow {
  id: string
  capability: Capability
  tier: ChatTier | null
  model_id: string
  updated_by: string | null
  updated_at: Date
}

export interface BudgetsRow {
  platform_daily_usd: number | null
  company_daily_usd: number | null
  updated_by: string | null
  updated_at: Date | null
}

/** Everything the router needs, loaded in one go (small tables). */
export interface ProviderSnapshot {
  providers: ProviderRow[]
  credentials: CredentialRow[]
  models: ModelRow[]
  routes: RouteRow[]
  budgets: BudgetsRow | null
}

/**
 * A resolved call target: which endpoint, model and key serve one call.
 * `apiKey` is plaintext in memory only — never log, return or persist it.
 */
export interface ProviderTarget {
  /** 'db' = configured in ai_routes/ai_models; 'env' = built-in fallback. */
  origin: 'db' | 'env'
  providerKey: string
  providerName: string
  kind: ProviderKind
  baseUrl: string
  chatPath: string
  embeddingsPath: string
  rerankPath: string | null
  ocrMode: OcrMode | null
  extraHeaders: Record<string, string>
  supportsResponseFormat: boolean
  model: string
  modelRowId: string | null
  credentialId: string | null
  apiKey: string
  priceInPerMtok: number | null
  priceOutPerMtok: number | null
  dailyBudgetUsd: number | null
  /** Model metadata (107); null = unknown. */
  supportsVision?: boolean | null
  supportsTools?: boolean | null
  tierHint?: ChatTier | null
}
