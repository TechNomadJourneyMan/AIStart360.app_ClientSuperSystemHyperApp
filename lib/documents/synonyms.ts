/**
 * Canonical Russian↔English metric synonyms dictionary.
 *
 * Maps a canonical metric key (matches `MetricSource.field` convention —
 * snake_case, English) to a list of free-text synonyms in Russian and English
 * that may appear as `ParsedDataField.key` / `label` in parsed documents.
 *
 * Used by the Phase-2 doc-binder (`lib/documents/bind-fields.ts`) to fuzzy-match
 * extracted field labels back to metric ids in the registry.
 *
 * Synonym matching is case-insensitive and ё→е normalized.
 */

/** Canonical key (matches MetricSource.field convention) → array of synonyms (case-insensitive). */
export const METRIC_SYNONYMS: Record<string, string[]> = {
  // ─── Financial: top-line ──────────────────────────────────────────────
  revenue: [
    'выручка',
    'выручка (год)',
    'общая выручка',
    'revenue',
    'доход',
    'оборот',
    'sales revenue',
    'gross revenue',
  ],
  gross_revenue: [
    'валовая выручка',
    'валовый доход',
    'gross revenue',
    'gross sales',
    'общий оборот',
  ],
  net_revenue: ['чистая выручка', 'net revenue', 'net sales', 'нетто-выручка'],
  sales: ['продажи', 'sales', 'объём продаж', 'sales volume', 'продажи (₸)'],
  gross_profit: [
    'валовая прибыль',
    'gross profit',
    'gp',
    'маржа валовая',
    'валовый доход',
  ],
  gross_margin: [
    'маржинальность',
    'валовая маржа',
    'gross margin',
    'маржа',
    'gp%',
    'margin',
    'gross margin %',
  ],
  net_margin: ['чистая маржа', 'net margin', 'нетто маржа', 'net margin %'],
  operating_margin: [
    'операционная маржа',
    'operating margin',
    'op margin',
    'operational margin',
  ],
  ebitda: [
    'ebitda',
    'операционная прибыль',
    'oibda',
    'прибыль до налогов и амортизации',
    'earnings before interest',
  ],
  net_profit: [
    'чистая прибыль',
    'net profit',
    'net income',
    'прибыль после налогов',
    'итоговая прибыль',
    'чистый доход',
  ],
  operating_profit: [
    'операционная прибыль',
    'operating profit',
    'ebit',
    'прибыль от операций',
  ],
  operating_expenses: [
    'операционные расходы',
    'opex',
    'operating expenses',
    'расходы операционные',
    'операционка',
  ],
  cogs: [
    'себестоимость',
    'себестоимость продаж',
    'cogs',
    'cost of goods sold',
    'расходы: себестоимость',
  ],
  cogs_index: [
    'себестоимость (индекс)',
    'индекс себестоимости',
    'cogs index',
    'cost index',
  ],
  cost_of_sales: ['cost of sales', 'себестоимость продаж', 'затраты на продажи'],
  total_assets: [
    // never a bare «активы»: «нематериальные активы» would match it
    'итого активы',
    'активы всего',
    'всего активов',
    'итого актив',
    'валюта баланса',
    'total assets',
    'баланс (актив)',
  ],
  export_revenue: [
    'выручка от экспорта',
    'экспортная выручка',
    'export revenue',
    'export sales',
  ],
  roa: ['roa', 'return on assets', 'рентабельность активов', 'доходность активов'],
  roi: ['roi', 'return on investment', 'рентабельность инвестиций', 'окупаемость'],
  roe: ['roe', 'return on equity', 'рентабельность капитала'],

  // ─── Cash / balance sheet ─────────────────────────────────────────────
  cash_flow: [
    'cash flow',
    'денежный поток',
    'cash flow (мес)',
    'кэш-флоу',
    'движение денег',
    'дкп',
  ],
  cash_runway: [
    'cash runway',
    'runway',
    'денежный запас',
    'запас прочности',
    'на сколько хватит денег',
  ],
  ar_days: [
    'дни дебиторки',
    'days receivable',
    'ar days',
    'дсо',
    'dso',
    'days sales outstanding',
  ],
  ap_days: [
    'дни кредиторки',
    'days payable',
    'ap days',
    'dpo',
    'days payable outstanding',
  ],
  accounts_receivable: [
    'дебиторская задолженность',
    'дебиторка',
    'accounts receivable',
    'ar',
    'receivables',
  ],
  accounts_payable: [
    'кредиторская задолженность',
    'кредиторка',
    'accounts payable',
    'ap',
    'payables',
  ],
  debt_load: [
    'долговая нагрузка',
    'debt load',
    'сумма задолженностей',
    'total debt',
    'обязательства',
  ],
  breakeven: [
    'точка безубыточности',
    'breakeven',
    'break-even point',
    'безубыточность',
    'bep',
  ],
  inventory_turnover: [
    'оборачиваемость запасов',
    'inventory turnover',
    'оборачиваемость склада',
    'turnover',
  ],

  // ─── Unit economics ────────────────────────────────────────────────────
  cac: [
    'cac',
    'стоимость привлечения',
    'стоимость клиента',
    'customer acquisition cost',
    'cpa',
    'стоимость привлечения клиента',
  ],
  ltv: [
    'ltv',
    'lifetime value',
    'ценность клиента',
    'пожизненная ценность',
    'клиентская ценность',
    'cltv',
    'customer lifetime value',
  ],
  cltv: [
    'cltv',
    'customer lifetime value',
    'пожизненная ценность клиента',
    'ltv клиента',
  ],
  ltv_cac: [
    'ltv/cac',
    'ltv to cac',
    'отношение ltv к cac',
    'ltv:cac',
    'юнит-экономика',
  ],
  cac_payback: [
    'cac payback',
    'окупаемость cac',
    'payback period',
    'срок окупаемости',
    'возврат cac',
  ],
  arpu: ['arpu', 'средний доход на пользователя', 'average revenue per user', 'доход на 1 клиента'],
  avg_check: [
    'средний чек',
    'average check',
    'avg check',
    'aov',
    'average order value',
  ],
  avg_order_value: [
    'средний чек ecommerce',
    'ecommerce средний чек',
    'средний чек заказа',
    'средняя стоимость заказа',
    'средняя сумма заказа',
    'avg order value',
  ],
  basket_size: [
    'размер корзины',
    'basket size',
    'средняя корзина',
    'items per basket',
  ],
  frequency: [
    'частота покупок',
    'frequency',
    'purchase frequency',
    'кол-во покупок',
    'среднее кол-во покупок',
  ],
  recency: ['recency', 'давность покупки', 'recent purchase', 'дни с последней покупки'],

  // ─── Marketing / acquisition ───────────────────────────────────────────
  cpl: [
    'cpl',
    'стоимость лида',
    'cost per lead',
    'cpl (стоимость лида)',
    'цена лида',
  ],
  cpc: ['cpc', 'cost per click', 'стоимость клика', 'цена клика'],
  cpm: ['cpm', 'cost per mille', 'стоимость 1000 показов', 'цена 1000 показов'],
  ctr: ['ctr', 'click-through rate', 'кликабельность', 'процент кликов'],
  roas: [
    'roas',
    'return on ad spend',
    'возврат на рекламу',
    'окупаемость рекламы',
    'роас',
  ],
  ad_spend: [
    'рекламный бюджет',
    'расходы на рекламу',
    'ad spend',
    'advertising spend',
    'marketing spend',
    'затраты на рекламу',
  ],
  marketing_budget: [
    'маркетинговый бюджет',
    'бюджет на маркетинг',
    'расходы: маркетинг',
    'marketing budget',
    'marketing expenses',
  ],
  marketing_channels_count: [
    'количество каналов маркетинга',
    'каналы маркетинга',
    'marketing channels',
    'channels count',
    'число каналов',
  ],
  leads_count: [
    'количество лидов',
    'лидов в мес',
    'leads',
    'leads count',
    'кол-во новых лидов',
    'число лидов',
  ],
  qualified_leads: [
    'целевые лиды',
    'квалифицированные лиды',
    'qualified leads',
    'sql',
    'кол-во целевых лидов',
  ],
  cost_per_qualified_lead: [
    'стоимость целевого лида',
    'cost per qualified lead',
    'cpql',
    'цена sql',
  ],

  // ─── Sales / pipeline ──────────────────────────────────────────────────
  deals_count: [
    'количество сделок',
    'завершённые сделки',
    'deals',
    'closed deals',
    'сделок',
    'число сделок',
  ],
  new_customers: [
    'новые клиенты',
    'количество новых клиентов',
    'new customers',
    'new clients',
    'привлечённые клиенты',
  ],
  active_customers: [
    'активные клиенты',
    'активных клиентов',
    'active customers',
    'active users',
    'действующие клиенты',
  ],
  win_rate: [
    'win rate',
    'процент побед',
    '% выигранных сделок',
    'конверсия в продажу',
    '% выбравших вас',
  ],
  loss_rate: [
    'loss rate',
    'процент проигрышей',
    '% проигранных',
    '% выбравших конкурента',
  ],
  conversion_rate: [
    'конверсия',
    'conversion rate',
    'cr',
    'конверсия лид→клиент',
    'конверсия лид → продажа',
    'процент конверсии',
  ],
  funnel_lead_to_call: [
    'конверсия лид → звонок',
    'lead to call',
    'лид → диалог',
  ],
  funnel_call_to_sale: [
    'конверсия звонок → продажа',
    'call to sale',
    'звонок → продажа',
  ],
  deal_cycle_days: [
    'цикл сделки',
    'цикл закрытия сделки',
    'sales cycle',
    'deal cycle',
    'средний цикл закрытия',
    'дни до закрытия',
  ],
  sales_cycle: [
    'sales cycle',
    'цикл продаж',
    'длительность цикла продаж',
    'sales cycle length',
  ],
  time_to_close: [
    'time to close',
    'время до закрытия',
    'ttc',
    'дни до сделки',
  ],
  time_to_response: [
    'time to response',
    'время отклика',
    'ttr',
    'скорость ответа',
    'reaction time',
  ],
  pipeline_value: [
    'pipeline value',
    'объём воронки',
    'стоимость воронки',
    'pipeline',
    'воронка (₸)',
  ],
  quota_attainment: [
    'quota attainment',
    'выполнение плана продаж',
    '% выполнения плана',
    'plan attainment',
  ],
  revenue_per_seller: [
    'выручка с продажника',
    'revenue per seller',
    'revenue per sales rep',
    'продажи на менеджера',
  ],

  // ─── Retention / loyalty ──────────────────────────────────────────────
  churn_rate: [
    'churn',
    'отток',
    'отток клиентов',
    'churn rate',
    'churn %',
    'коэффициент оттока',
  ],
  retention: [
    'retention',
    'удержание',
    'удержание клиентов',
    'retention rate',
    'retention 30d',
    'retention 30/60/90',
  ],
  repeat_rate: [
    'repeat rate',
    'repeat purchase rate',
    'повторные покупки',
    '% повторных',
    'повторяемость',
  ],
  repeat_revenue: [
    'повторная выручка',
    'repeat revenue',
    'выручка с повторных',
    'recurring revenue',
  ],
  nps: [
    'nps',
    'net promoter score',
    'индекс лояльности',
    'индекс удовлетворённости',
    'промоутер скор',
  ],
  enps: ['enps', 'employee nps', 'индекс лояльности сотрудников'],
  csat: ['csat', 'customer satisfaction', 'удовлетворённость клиентов'],
  referral_rate: [
    'referral rate',
    'процент рекомендаций',
    '% лидов по рекомендации',
    'реферальная конверсия',
  ],

  // ─── Engagement / digital ──────────────────────────────────────────────
  website_visits: [
    'посещений сайта',
    'посещения сайта',
    'визиты на сайт',
    'визитов на сайт',
    'сеансы',
    'sessions',
    'посещений сайта/мес',
    'website visits',
    'site traffic',
    'трафик сайта',
    'visits',
  ],
  followers: [
    'фолловеры',
    'подписчики',
    'followers',
    'фолловеры соцсети',
    'social followers',
  ],
  engagement_rate: [
    'engagement rate',
    'er',
    'вовлечённость',
    'процент вовлечённости',
    'вовлеченность',
  ],
  dau: ['dau', 'daily active users', 'активные пользователи в день'],
  mau: ['mau', 'monthly active users', 'активные пользователи в месяц'],
  share_rate: ['share rate', 'процент репостов', 'sharing rate', 'репосты'],
  ugc_volume: ['ugc', 'ugc volume', 'пользовательский контент', 'объём ugc'],

  // ─── Operations ───────────────────────────────────────────────────────
  delivery_time: [
    'время доставки',
    'delivery time',
    'срок доставки',
    'lead time',
    'дни доставки',
  ],
  sla_compliance: [
    'выполнение sla',
    'sla compliance',
    'sla %',
    'соблюдение sla',
  ],
  defect_rate: [
    'брак',
    'процент брака',
    'возвраты',
    'defect rate',
    'return rate',
    'брак / возвраты',
  ],
  productivity: [
    'производительность',
    'productivity',
    'output per employee',
    'выработка',
  ],
  process_repeatability: [
    'повторяемость процессов',
    'process repeatability',
    'стандартизация процессов',
  ],
  predictability: ['предсказуемость', 'predictability', 'прогнозируемость'],
  sku_count: [
    'кол-во sku',
    'количество sku',
    'sku count',
    'число позиций',
    'активных sku',
    'число sku',
  ],

  // ─── Team / HR ────────────────────────────────────────────────────────
  employee_count: [
    'количество сотрудников',
    'кол-во сотрудников',
    'employees',
    'headcount',
    'число сотрудников',
    'staff count',
  ],
  dept_count: [
    'количество отделов',
    'число отделов',
    'departments',
    'dept count',
    'отделов',
  ],
  employee_turnover: [
    'текучесть кадров',
    'текучка',
    'employee turnover',
    'turnover rate',
    'staff turnover',
  ],
  hiring_speed: [
    'скорость найма',
    'time to hire',
    'hiring speed',
    'дни до найма',
  ],
  okr_completion: [
    'процент выполнения okr',
    'okr completion',
    '% okr',
    'выполнение okr',
  ],

  // ─── Market / strategy ────────────────────────────────────────────────
  market_share: [
    'доля рынка',
    'market share',
    'рыночная доля',
    'доля рынка сегмента',
  ],
  export_share: [
    'доля экспорта',
    'export share',
    '% экспорта',
    'экспортная доля',
  ],
  online_sales_share: [
    'доля онлайн-продаж',
    'online sales share',
    '% онлайн',
    'процент онлайн-продаж',
  ],
  brand_awareness: [
    'узнаваемость бренда',
    'brand awareness',
    'известность бренда',
    'brand recognition',
  ],
  segment_count: [
    'количество сегментов',
    'число сегментов',
    'segment count',
    'segments',
  ],
  competitor_count: [
    'количество конкурентов',
    'число конкурентов',
    'competitor count',
    'competitors',
  ],
  competitor_customers: [
    'клиенты от конкурентов',
    'кол-во клиентов от конкурентов',
    '% от конкурентов',
  ],

  // ─── Refusals / objections ────────────────────────────────────────────
  refusals: [
    'отказы',
    'причины отказов',
    'refusals',
    'rejections',
    'losses',
    'кол-во отказов',
  ],

  // ─── Product ──────────────────────────────────────────────────────────
  product_score: [
    'product score',
    'оценка продукта',
    'product score (gri)',
    'индекс продукта',
  ],
  upsell_share: [
    'доля апселов',
    'upsell share',
    'апсейлы %',
    'процент апселлов',
  ],
  upsell_amount: ['сумма апселов', 'upsell amount', 'апсейл выручка'],
  crosssell_share: [
    'доля кросс-продаж',
    'crosssell share',
    'cross-sell %',
    'кросс-продажи %',
  ],
  crosssell_amount: ['сумма кросселлов', 'crosssell amount', 'cross-sell revenue'],

  // ─── Funnel stages (current wizard step 5 + CRM exports) ──────────────
  funnel_call_to_meeting: [
    'звонок -> встреча',
    'звонок → встреча',
    'конверсия звонок встреча',
    'диалог → встреча',
    'call to meeting',
  ],
  funnel_meeting_to_proposal: [
    'встреча -> кп',
    'встреча → кп',
    'конверсия встреча кп',
    'meeting to proposal',
  ],
  funnel_proposal_to_sale: [
    'кп -> сделка',
    'кп → сделка',
    'кп → продажа',
    'конверсия кп в сделку',
    'конверсия кп сделка',
    'proposal to deal',
    'proposal to sale',
  ],
  lead_to_dialog_days: ['лид → диалог (дни)', 'дней от лида до диалога', 'lead to dialog days'],
  dialog_to_meeting_days: ['диалог → встреча (дни)', 'дней от диалога до встречи', 'dialog to meeting days'],
  meeting_to_proposal_days: ['встреча → кп (дни)', 'дней от встречи до кп', 'meeting to proposal days'],
  proposal_to_deal_days: ['кп → сделка (дни)', 'дней от кп до сделки', 'proposal to deal days'],
  revenue_by_channel: ['выручка по каналам', 'продажи по каналам', 'сумма продаж с канала', 'revenue by channel', 'sales by channel'],
  referral_customers: ['клиенты по рекомендации', 'клиентов по рекомендации', 'реферальные клиенты', 'referral customers', 'referred customers'],
  referral_leads_share: ['лиды по рекомендации', 'доля лидов по рекомендации', 'лидов по рекомендации %', 'referral leads share'],
  content_to_dialog_rate: ['конверсия контент → диалог', 'cr контент → диалог', 'контент в диалог', 'content to dialog'],
  warm_leads_share: ['прогретые лиды', 'доля прогретых лидов', 'прогретых лидов', 'warm leads'],
  competitive_win_rate: ['выбравших вас', 'выигрыш у конкурентов', 'победы над конкурентами', 'competitive win rate'],
  competitive_loss_rate: ['выбравших конкурента', 'проигрыш конкурентам', 'ушли к конкуренту', 'competitive loss rate'],

  // ─── Time-related funnel ──────────────────────────────────────────────
  time_between_purchases: [
    'time between purchases',
    'время между покупками',
    'интервал покупок',
    'дни между покупками',
  ],
  time_to_interest: [
    'time-to-interest',
    'время до интереса',
    'ttI',
    'дни до интереса',
  ],
};

/**
 * Normalize a string for fuzzy matching:
 *  - lowercase
 *  - transliterate ё → е
 *  - strip punctuation (keeps alphanumerics, %, /, spaces)
 *  - collapse whitespace
 */
export function normalizeForMatch(s: string): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}%\/\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lazily built reverse index: normalized synonym → canonical key. */
let _synonymIndex: Map<string, string> | null = null;

/** Reverse map cache (memoised). */
export function getSynonymIndex(): Map<string, string> {
  if (_synonymIndex) return _synonymIndex;
  const map = new Map<string, string>();
  for (const [canonical, synonyms] of Object.entries(METRIC_SYNONYMS)) {
    // Map the canonical key itself to itself.
    map.set(normalizeForMatch(canonical), canonical);
    map.set(normalizeForMatch(canonical.replace(/_/g, ' ')), canonical);
    for (const syn of synonyms) {
      const n = normalizeForMatch(syn);
      if (!n) continue;
      // First synonym wins if collision; do not overwrite explicit canonical mapping.
      if (!map.has(n)) map.set(n, canonical);
    }
  }
  _synonymIndex = map;
  return map;
}

/**
 * Match a free-text field key/label against METRIC_SYNONYMS.
 * Returns the canonical key, or null if no match.
 *
 * Strategy:
 *   1. Exact normalized match against the synonym index.
 *   2. If no exact hit, scan for the longest synonym contained in the input
 *      (handles labels like "Выручка 2025 (₸)" → revenue).
 */
export function matchSynonym(input: string): string | null {
  const norm = normalizeForMatch(input);
  if (!norm) return null;
  const cached = _matchCache.get(norm);
  if (cached !== undefined) return cached;
  const result = matchNormalized(norm);
  if (_matchCache.size >= MATCH_CACHE_MAX) _matchCache.clear();
  _matchCache.set(norm, result);
  return result;
}

/**
 * Synonyms of 3+ characters, longest first — built once (the substring scan
 * used to re-sort the ~560 entries on every call, and the resolver calls it
 * per field × document source × metric).
 */
let _scanEntries: ReadonlyArray<readonly [string, string]> | null = null;

function scanEntries(): ReadonlyArray<readonly [string, string]> {
  if (_scanEntries) return _scanEntries;
  // Stable sort: on equal length the index (insertion) order decides, as before.
  _scanEntries = Array.from(getSynonymIndex().entries())
    .sort((a, b) => b[0].length - a[0].length)
    .filter(([syn]) => syn.length >= 3); // skip too-short tokens
  return _scanEntries;
}

/** Results by normalised input (the dictionary is static); bounded. */
const MATCH_CACHE_MAX = 10_000;
const _matchCache = new Map<string, string | null>();

function matchNormalized(norm: string): string | null {
  const idx = getSynonymIndex();

  // 1. Exact match.
  const exact = idx.get(norm);
  if (exact) return exact;

  // 2. Substring scan, longest synonym first to avoid false positives
  //    (e.g. "revenue" matching inside "revenue per seller").
  //    word-boundary-ish check: the synonym is surrounded by whitespace or
  //    string boundaries in the normalized input.
  const padded = ` ${norm} `;
  for (const [syn, canonical] of scanEntries()) {
    if (padded.includes(` ${syn} `)) return canonical;
  }
  return null;
}
