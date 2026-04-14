// ─── Industry options ─────────────────────────────────────────────────────────
export const INDUSTRIES = [
  'IT / Technology',
  'Retail / E-commerce',
  'Manufacturing',
  'Construction',
  'Finance / Banking',
  'Education',
  'Medicine / Healthcare',
  'Logistics / Transportation',
  'HoReCa / Restaurants',
  'Agribusiness',
  'Consulting / B2B Services',
  'Media / Advertising',
  'Other',
] as const

// ─── Region options ──────────────────────────────────────────────────────────
export const REGIONS = [
  'Almaty',
  'Astana',
  'Shymkent',
  'Almaty Region',
  'Karaganda Region',
  'East Kazakhstan',
  'West Kazakhstan',
  'North Kazakhstan',
  'Russia',
  'Other CIS Countries',
] as const

// ─── Promo / sales channels ──────────────────────────────────────────────────
export const PROMO_CHANNELS = [
  'Instagram',
  'Facebook',
  'TikTok',
  'YouTube',
  'Telegram',
  'Google Ads',
  'SEO',
  'Email Marketing',
  'Partners / Referral Program',
  'Cold Calls',
  'Exhibitions / Events',
  'Word of Mouth',
] as const

// ─── Marketing channels ──────────────────────────────────────────────────────
export const MARKETING_CHANNELS = [
  'SMM (Social Media)',
  'Contextual Advertising',
  'SEO',
  'Email Newsletter',
  'Telegram Channel',
  'PR / Media',
  'Partner Marketing',
  'Influencer Marketing',
  'Offline Advertising',
] as const

// ─── Audience segments ───────────────────────────────────────────────────────
export const AUDIENCE_SEGMENTS = [
  'Small Business (SMB)',
  'Medium Business',
  'Large Business / Corporations',
  'Government Entities',
  'Individuals (B2C)',
  'Startups',
  'Foreign Companies',
] as const

// ─── Growth blockers ─────────────────────────────────────────────────────────
export const GROWTH_BLOCKERS = [
  'Money / Funding',
  'Team / Talent',
  'Processes / Operations',
  'Technology / IT',
  'Market / Competition',
  'Marketing / Sales',
  'Other',
] as const

// ─── Company stages ──────────────────────────────────────────────────────────
export const COMPANY_STAGES = [
  { value: 'Startup', label: 'Startup' },
  { value: 'Growth', label: 'Growth' },
  { value: 'Scale', label: 'Scale' },
  { value: 'Mature', label: 'Mature' },
] as const

// ─── Business models ─────────────────────────────────────────────────────────
export const BUSINESS_MODELS = [
  { value: 'B2B', label: 'B2B' },
  { value: 'B2C', label: 'B2C' },
  { value: 'B2B2C', label: 'B2B2C' },
  { value: 'Mixed', label: 'Mixed' },
] as const

// ─── CRM options ─────────────────────────────────────────────────────────────
export const CRM_OPTIONS = [
  { value: 'none', label: 'No CRM' },
  { value: 'excel', label: 'Excel / Google Sheets' },
  { value: 'amocrm', label: 'amoCRM' },
  { value: 'bitrix24', label: 'Bitrix24' },
  { value: 'other', label: 'Other CRM' },
] as const

// ─── Debt load options ───────────────────────────────────────────────────────
export const DEBT_LOAD_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
] as const

// ─── Management methods ──────────────────────────────────────────────────────
export const MANAGEMENT_METHODS = [
  { value: 'manual', label: 'Manual Management' },
  { value: 'kpi', label: 'KPI' },
  { value: 'okr', label: 'OKR' },
  { value: 'hybrid', label: 'Hybrid' },
] as const

// ─── Reporting tools ─────────────────────────────────────────────────────────
export const REPORTING_TOOLS = [
  { value: 'excel', label: 'Excel / Google Sheets' },
  { value: 'bi', label: 'BI System' },
  { value: 'crm', label: 'CRM Reports' },
  { value: 'none', label: 'No System' },
] as const

// ─── Task managers ───────────────────────────────────────────────────────────
export const TASK_MANAGERS = [
  { value: 'none', label: 'None' },
  { value: 'trello', label: 'Trello' },
  { value: 'jira', label: 'Jira' },
  { value: 'notion', label: 'Notion' },
  { value: 'other', label: 'Other' },
] as const
