/**
 * Company API shapes for the deep-drawer (Phase 1).
 *
 * These mirror `backend/app/schemas/company.py` + extended JSONB fields on the
 * model (founders/directors/share_capital_kzt/government_share_pct). They will
 * be superseded by `src/types/api.gen.ts` once `openapi-typescript` is wired in.
 */

export type Severity = 'ok' | 'info' | 'warn' | 'danger';

export interface IndustryRef {
  code: string | null;
  label: string | null;
}

export interface AddressShort {
  country: string | null;
  region: string | null;
  city: string | null;
  street: string | null;
}

export interface CompanyInsight {
  severity: Severity;
  title: string;
  body: string;
  evidence?: Record<string, unknown>;
}

export interface TimelineEvent {
  at: string; // ISO 8601
  kind: string;
  label: string;
  payload?: Record<string, unknown>;
}

export interface CompanyScores {
  digital_maturity: number;
  data_completeness_pct: number;
  freshness_days: number;
  confidence_score: number;
  risk_level: 'low' | 'medium' | 'high';
  ai_growth_score: number;
}

export interface CompanyListItem {
  id: string;
  bin: string | null;
  name: string;
  country: string;
  legal_form: string | null;
  status: string | null;
  industry: IndustryRef | null;
  registered_at: string | null;
  employee_count: number | null;
  revenue_usd: number | string | null;
  website: string | null;
  tags: string[] | null;
  confidence: number | null;
  size_category: string | null;
  ownership_type_detail: string | null;
  kato_code: string | null;
  data_source: string | null;
  latitude?: number | null;
  longitude?: number | null;
  region_kato?: string | null;
  region_name?: string | null;
  city_name?: string | null;
  updated_at: string;
}

export interface CompanyOwner {
  name: string;
  share_pct?: number | string | null;
  since?: string | null;
  country?: string | null;
  role?: string | null;
}

export interface CompanyDetail extends CompanyListItem {
  description: string | null;
  inn: string | null;
  ogrn: string | null;
  capitalization_usd: number | string | null;
  email: string | null;
  phone: string | null;
  address: AddressShort | null;
  risk_score: number | null;
  last_seen_at: string | null;
  raw: Record<string, unknown> | null;

  // Phase-0 enrichment (denormalized for KZ).
  share_capital_kzt?: number | string | null;
  government_share_pct?: number | string | null;
  founders?: CompanyOwner[] | null;
  directors?: CompanyOwner[] | null;

  scores: CompanyScores | null;
  insights: CompanyInsight[];
  similar: CompanyListItem[];
  timeline_events: TimelineEvent[];
  related_tenders: Array<Record<string, unknown>>;
}

export interface CompanyInsightsBundle {
  scores: CompanyScores;
  insights: CompanyInsight[];
}
