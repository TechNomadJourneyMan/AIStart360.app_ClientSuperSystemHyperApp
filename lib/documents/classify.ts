/**
 * Document type auto-classifier.
 *
 * Pure heuristic — NO AI calls. Used when a user uploads a document without
 * declaring a doc_type (or picks `other`). Produces a best-effort guess based
 * on filename patterns and text-preview Russian/English keyword signals.
 *
 * Output: one of the allowed CHECK-constraint values from migration 012:
 *   pl_report, balance_sheet, marketing_report, ops_report, crm_export, audit,
 *   other, financial_report, patient_base, pricelist, services_catalog,
 *   packages, scripts, brand_rules
 */

export type DocType =
  | 'pl_report'
  | 'balance_sheet'
  | 'marketing_report'
  | 'ops_report'
  | 'crm_export'
  | 'audit'
  | 'financial_report'
  | 'patient_base'
  | 'pricelist'
  | 'services_catalog'
  | 'packages'
  | 'scripts'
  | 'brand_rules'
  | 'other'

export interface ClassifyInput {
  fileName: string
  textPreview: string
  declaredDocType?: string | null
}

export interface ClassifyScore {
  docType: string
  score: number
}

export interface ClassifyResult {
  docType: string
  confidence: number
  reasoning: string
  scores: ClassifyScore[]
}

const ALLOWED: DocType[] = [
  'pl_report',
  'balance_sheet',
  'marketing_report',
  'ops_report',
  'crm_export',
  'audit',
  'financial_report',
  'patient_base',
  'pricelist',
  'services_catalog',
  'packages',
  'scripts',
  'brand_rules',
  'other',
]

// Specificity ranking — used as a tie-breaker. Higher = more specific.
// Medical/domain-specific types beat generic financial/ops types, which beat 'other'.
const SPECIFICITY: Record<DocType, number> = {
  patient_base: 10,
  packages: 9,
  services_catalog: 9,
  scripts: 9,
  pricelist: 8,
  brand_rules: 8,
  pl_report: 7,
  balance_sheet: 7,
  marketing_report: 6,
  ops_report: 6,
  crm_export: 6,
  audit: 6,
  financial_report: 4,
  other: 0,
}

// Filename regex patterns per doc type. Each match adds a fixed score.
const FILENAME_PATTERNS: Record<Exclude<DocType, 'other'>, RegExp[]> = {
  pl_report: [
    /p[\-_\s]?and?[\-_\s]?l/i,
    /pnl/i,
    /пиэль/i,
    /опу/i,
    /opu/i,
    /отчёт.*о.*прибылях/i,
    /отчет.*о.*прибылях/i,
    /profit.*loss/i,
    /прибыл.*убыт/i,
  ],
  balance_sheet: [/balance/i, /баланс/i, /balance.*sheet/i, /бух.*баланс/i],
  marketing_report: [
    /marketing/i,
    /маркет/i,
    /реклам/i,
    /ad[\s_-]?report/i,
    /campaign/i,
    /кампан/i,
    /seo/i,
    /ppc/i,
  ],
  ops_report: [
    /operations?/i,
    /операц/i,
    /произв/i,
    /production/i,
    /warehouse/i,
    /склад/i,
    /logist/i,
    /логист/i,
  ],
  crm_export: [
    /\bcrm\b/i,
    /exp(ort)?/i,
    /amocrm/i,
    /bitrix/i,
    /битрикс/i,
    /amo[\s_-]?crm/i,
    /deals?/i,
    /сделки/i,
  ],
  audit: [/audit/i, /аудит/i, /inspection/i, /проверк/i],
  financial_report: [
    /financial/i,
    /finance/i,
    /финанс/i,
    /фин[\s_-]?отч/i,
    /fin[\s_-]?report/i,
  ],
  patient_base: [
    /patient/i,
    /пациент/i,
    /yclients/i,
    /y[\s_-]?clients/i,
    /клиент.*медиц/i,
    /медиц.*клиент/i,
    /база.*пациент/i,
  ],
  pricelist: [/pricelist/i, /price[\s_-]?list/i, /прайс/i, /\bprice\b/i, /тариф/i],
  services_catalog: [
    /service/i,
    /catalog/i,
    /каталог.*услуг/i,
    /услуг.*перечень/i,
    /перечень.*услуг/i,
    /услуги/i,
  ],
  packages: [
    /package/i,
    /пакет.*услуг/i,
    /программ.*обследов/i,
    /чек[\s_-]?ап/i,
    /check[\s_-]?up/i,
  ],
  scripts: [
    /\bscript/i,
    /скрипт/i,
    /callscript/i,
    /колл[\s_-]?скрипт/i,
    /call[\s_-]?script/i,
  ],
  brand_rules: [
    /brand/i,
    /бренд/i,
    /guideline/i,
    /tone.*of.*voice/i,
    /\btov\b/i,
    /brandbook/i,
    /брендбук/i,
  ],
}

// Substring keywords (lowercase) for text-preview matching. Heavier weight.
const TEXT_KEYWORDS: Record<Exclude<DocType, 'other'>, string[]> = {
  pl_report: [
    'выручка',
    'чистая прибыль',
    'себестоимость',
    'отчёт о прибылях',
    'отчет о прибылях',
    'валовая прибыль',
    'операционная прибыль',
    'ebitda',
    'opex',
    'cogs',
    'gross profit',
    'net income',
    'profit and loss',
    'p&l',
  ],
  balance_sheet: [
    'активы',
    'пассивы',
    'обязательства',
    'собственный капитал',
    'долгосрочные',
    'краткосрочные',
    'итого активы',
    'итого пассивы',
    'balance sheet',
    'total assets',
    'total liabilities',
    'equity',
  ],
  marketing_report: [
    'маркетинг',
    'каналы',
    'ctr',
    'cpc',
    'cpm',
    'roas',
    'roi',
    'клики',
    'показы',
    'конверсия',
    'лиды',
    'охват',
    'campaign',
    'impressions',
    'clicks',
    'ad spend',
  ],
  ops_report: [
    'производство',
    'операционн',
    'выпуск',
    'смена',
    'смены',
    'оборудован',
    'простой',
    'склад',
    'производительность',
    'throughput',
    'downtime',
    'utilization',
  ],
  crm_export: [
    'сделка',
    'сделки',
    'клиент',
    'воронка',
    'лид',
    'amocrm',
    'bitrix',
    'pipeline',
    'deal stage',
    'lead source',
    'contact',
    'ответственный',
  ],
  audit: [
    'аудит',
    'аудитор',
    'аудиторское заключение',
    'проверка',
    'нарушения',
    'замечания',
    'auditor',
    'audit report',
    'findings',
    'observation',
  ],
  financial_report: [
    'финансовый отчёт',
    'финансовый отчет',
    'финансовые показатели',
    'financial report',
    'financial statement',
    'отчётность',
    'отчетность',
  ],
  patient_base: [
    'пациент',
    'пациенты',
    'история болезни',
    'диагноз',
    'мкб',
    'фио пациента',
    'дата рождения',
    'патронаж',
    'visit',
    'patient id',
    'medical record',
  ],
  pricelist: [
    'прайс',
    'прайс-лист',
    'прайс лист',
    'цена',
    'стоимость услуги',
    'тариф',
    'price',
    'unit price',
    'цена, руб',
    'стоимость, руб',
  ],
  services_catalog: [
    'каталог услуг',
    'перечень услуг',
    'наименование услуги',
    'описание услуги',
    'service catalog',
    'service description',
  ],
  packages: [
    'пакет услуг',
    'программа обследования',
    'чек-ап',
    'чек ап',
    'check-up',
    'checkup',
    'комплекс услуг',
    'package',
    'комплексная программа',
  ],
  scripts: [
    'скрипт',
    'скрипт продаж',
    'колл-скрипт',
    'callscript',
    'диалог с клиентом',
    'возражения',
    'sales script',
    'objection',
    'opening line',
  ],
  brand_rules: [
    'бренд',
    'brandbook',
    'брендбук',
    'tone of voice',
    'tov',
    'фирменный стиль',
    'логотип',
    'логотипа',
    'brand guideline',
    'brand voice',
  ],
}

const FILENAME_HIT_WEIGHT = 2
const TEXT_HIT_WEIGHT = 3
const DECLARED_PRIOR_MULTIPLIER = 3

function isAllowed(value: string | null | undefined): value is DocType {
  return !!value && (ALLOWED as string[]).includes(value)
}

/**
 * Build a short Russian reasoning note describing the dominant signals
 * behind a chosen doc_type.
 */
function buildReasoning(
  docType: DocType,
  filenameHits: Record<string, number>,
  textHits: Record<string, string[]>,
  declaredDocType: string | null | undefined,
): string {
  if (docType === 'other') {
    return 'Недостаточно сигналов для классификации'
  }

  const parts: string[] = []
  const textWords = textHits[docType] ?? []
  if (textWords.length > 0) {
    const sample = textWords.slice(0, 3).join(', ')
    parts.push(`В тексте найдены ключевые слова: ${sample}`)
  }
  if ((filenameHits[docType] ?? 0) > 0) {
    parts.push('имя файла содержит характерные термины')
  }
  if (declaredDocType && declaredDocType === docType) {
    parts.push('пользователь явно указал этот тип')
  }

  if (parts.length === 0) {
    return 'Совпадение по общим признакам документа'
  }
  // Capitalise first letter of first part.
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return parts.join('; ')
}

/**
 * Classify a document by filename + text preview.
 *
 * Deterministic, no AI. Always returns a result (falls back to `other`).
 */
export function classifyDocument(input: ClassifyInput): ClassifyResult {
  const fileName = (input.fileName ?? '').toString()
  const textPreviewRaw = (input.textPreview ?? '').toString()
  // Limit text scan to first 2000 chars for performance and to match contract.
  const textPreview = textPreviewRaw.slice(0, 2000).toLowerCase()
  const declared = input.declaredDocType ?? null

  const scoreMap = new Map<DocType, number>()
  const filenameHits: Record<string, number> = {}
  const textHits: Record<string, string[]> = {}

  for (const t of ALLOWED) scoreMap.set(t, 0)

  // 1. Filename signals.
  for (const [type, patterns] of Object.entries(FILENAME_PATTERNS) as Array<
    [Exclude<DocType, 'other'>, RegExp[]]
  >) {
    let hits = 0
    for (const re of patterns) {
      if (re.test(fileName)) hits++
    }
    if (hits > 0) {
      filenameHits[type] = hits
      scoreMap.set(type, (scoreMap.get(type) ?? 0) + hits * FILENAME_HIT_WEIGHT)
    }
  }

  // 2. Text-preview signals.
  for (const [type, keywords] of Object.entries(TEXT_KEYWORDS) as Array<
    [Exclude<DocType, 'other'>, string[]]
  >) {
    const matched: string[] = []
    for (const kw of keywords) {
      if (textPreview.includes(kw)) matched.push(kw)
    }
    if (matched.length > 0) {
      textHits[type] = matched
      scoreMap.set(
        type,
        (scoreMap.get(type) ?? 0) + matched.length * TEXT_HIT_WEIGHT,
      )
    }
  }

  // 3. Declared override — strong prior unless user said 'other'/unknown.
  if (declared && declared !== 'other' && isAllowed(declared)) {
    const current = scoreMap.get(declared) ?? 0
    // Apply multiplier; if current is zero give a baseline prior so the
    // declared type still beats unrelated noise.
    const boosted = current > 0 ? current * DECLARED_PRIOR_MULTIPLIER : 6
    scoreMap.set(declared, boosted)
  }

  // 4. Rank — primary by score desc, tie-broken by specificity desc.
  const ranked: ClassifyScore[] = Array.from(scoreMap.entries())
    .map(([docType, score]) => ({ docType, score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const sa = SPECIFICITY[a.docType as DocType] ?? 0
      const sb = SPECIFICITY[b.docType as DocType] ?? 0
      return sb - sa
    })

  const topFive = ranked.slice(0, 5)
  const top = ranked[0]
  const second = ranked[1]

  if (!top || top.score === 0) {
    return {
      docType: 'other',
      confidence: 0,
      reasoning: 'Недостаточно сигналов для классификации',
      scores: topFive,
    }
  }

  const secondScore = second?.score ?? 0
  const rawConfidence = top.score / (top.score + secondScore + 1)
  const confidence = Math.max(0, Math.min(1, rawConfidence))

  const reasoning = buildReasoning(
    top.docType as DocType,
    filenameHits,
    textHits,
    declared,
  )

  return {
    docType: top.docType,
    confidence,
    reasoning,
    scores: topFive,
  }
}
