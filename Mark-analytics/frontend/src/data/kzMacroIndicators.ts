/**
 * Curated registry of macro / market indicators affecting the Kazakhstan economy.
 *
 * ВАЖНО: данные здесь СТАТИЧНЫЕ (curated) — собраны вручную из публичных
 * источников (НБРК, БНС АСПиР РК, KASE, AIX). Это НЕ live-фид.
 *
 * Правило честности: если по показателю нет уверенного свежего значения —
 * `latest_value: null` и `period: null`. UI в таком случае показывает «—»
 * и пометку «нет данных». Никогда не выдумываем цифры.
 *
 * TODO(live-feed): заменить статичные значения на живые интеграции —
 *   - Монетарная политика / реальный сектор / труд: nationalbank.kz, stat.gov.kz (БНС АСПиР РК)
 *   - Валютный рынок: nationalbank.kz (офиц. курсы) / exchangerate.host
 *   - Сырьё: EIA / LME / Yahoo Finance (free tier)
 *   - Фондовый рынок: kase.kz, aix.kz
 */

export type IndicatorPriority = 'high' | 'medium' | 'low';

export type IndicatorSource =
  | 'НБРК'
  | 'БНС АСПиР РК'
  | 'KASE'
  | 'AIX'
  | 'Минфин РК'
  | 'EIA'
  | 'LME';

export interface MacroCategory {
  id: string;
  /** Заголовок категории на русском. */
  name_ru: string;
  /** Порядок отображения (меньше = выше). */
  order: number;
}

export interface MacroIndicatorEntry {
  id: string;
  name_ru: string;
  /** id категории из MACRO_CATEGORIES. */
  category: string;
  priority: IndicatorPriority;
  /** Единица измерения, напр. '%', '₸', '$/барр.'. */
  unit: string;
  /**
   * Последнее опубликованное значение. `null`, если нет уверенного свежего
   * числа — UI покажет «—» / «нет данных».
   */
  latest_value: number | null;
  /** Период значения, напр. '2026-05'. `null`, если latest_value null. */
  period: string | null;
  source: IndicatorSource;
  /** 1 строка: как показатель влияет на рынок. */
  impact_note: string;
}

export const MACRO_CATEGORIES: MacroCategory[] = [
  { id: 'monetary', name_ru: 'Монетарная политика', order: 1 },
  { id: 'fx', name_ru: 'Валютный рынок', order: 2 },
  { id: 'commodities', name_ru: 'Сырьё', order: 3 },
  { id: 'real', name_ru: 'Реальный сектор', order: 4 },
  { id: 'equities', name_ru: 'Фондовый рынок', order: 5 },
  { id: 'labor', name_ru: 'Демография и труд', order: 6 },
  { id: 'fiscal', name_ru: 'Фискальная политика', order: 7 },
];

/**
 * Реестр показателей.
 *
 * Значения — ориентировочные публичные данные за конец 2025 / начало 2026 гг.
 * Там, где нет уверенности в свежей цифре, стоит `null` (см. правило честности).
 */
export const KZ_MACRO_INDICATORS: MacroIndicatorEntry[] = [
  // --- Монетарная политика ---
  {
    id: 'nbk_base_rate',
    name_ru: 'Базовая ставка НБРК',
    category: 'monetary',
    priority: 'high',
    unit: '%',
    latest_value: 18.0,
    period: '2026-03',
    source: 'НБРК',
    impact_note: 'Главный ориентир стоимости денег: рост ставки тормозит кредит и охлаждает рынок.',
  },
  {
    id: 'cpi_yoy',
    name_ru: 'Инфляция ИПЦ, г/г',
    category: 'monetary',
    priority: 'high',
    unit: '%',
    latest_value: 11.3,
    period: '2026-02',
    source: 'БНС АСПиР РК',
    impact_note: 'Высокая инфляция съедает реальные доходы и держит ставку повышенной.',
  },
  {
    id: 'inflation_expectations',
    name_ru: 'Инфляционные ожидания населения',
    category: 'monetary',
    priority: 'medium',
    unit: '%',
    latest_value: null,
    period: null,
    source: 'НБРК',
    impact_note: 'Якорят будущую инфляцию: рост ожиданий усиливает давление на цены и ставку.',
  },

  // --- Валютный рынок ---
  {
    id: 'usd_kzt',
    name_ru: 'USD / KZT',
    category: 'fx',
    priority: 'high',
    unit: '₸',
    latest_value: 525.0,
    period: '2026-03',
    source: 'НБРК',
    impact_note: 'Ослабление тенге разгоняет импортную инфляцию и валютные издержки бизнеса.',
  },
  {
    id: 'eur_kzt',
    name_ru: 'EUR / KZT',
    category: 'fx',
    priority: 'medium',
    unit: '₸',
    latest_value: null,
    period: null,
    source: 'НБРК',
    impact_note: 'Важен для импорта из ЕС и контрактов в евро.',
  },
  {
    id: 'rub_kzt',
    name_ru: 'RUB / KZT',
    category: 'fx',
    priority: 'medium',
    unit: '₸',
    latest_value: null,
    period: null,
    source: 'НБРК',
    impact_note: 'Влияет на приграничную торговлю и конкуренцию с российским импортом.',
  },

  // --- Сырьё ---
  {
    id: 'brent',
    name_ru: 'Нефть Brent',
    category: 'commodities',
    priority: 'high',
    unit: '$/барр.',
    latest_value: null,
    period: null,
    source: 'EIA',
    impact_note: 'Ключ к экспортной выручке и наполнению бюджета и Нацфонда.',
  },
  {
    id: 'gold',
    name_ru: 'Золото',
    category: 'commodities',
    priority: 'medium',
    unit: '$/унц.',
    latest_value: null,
    period: null,
    source: 'LME',
    impact_note: 'Часть экспорта и ЗВР; рост поддерживает золотодобытчиков.',
  },
  {
    id: 'copper',
    name_ru: 'Медь',
    category: 'commodities',
    priority: 'medium',
    unit: '$/т',
    latest_value: null,
    period: null,
    source: 'LME',
    impact_note: 'Индикатор спроса промышленности; важна для горно-металлургического сектора.',
  },
  {
    id: 'uranium',
    name_ru: 'Уран (спот U3O8)',
    category: 'commodities',
    priority: 'medium',
    unit: '$/фунт',
    latest_value: null,
    period: null,
    source: 'LME',
    impact_note: 'Казахстан — лидер по добыче урана; цена влияет на выручку «Казатомпрома».',
  },

  // --- Реальный сектор ---
  {
    id: 'gdp_yoy',
    name_ru: 'ВВП, г/г',
    category: 'real',
    priority: 'high',
    unit: '%',
    latest_value: 5.0,
    period: '2025',
    source: 'БНС АСПиР РК',
    impact_note: 'Общий темп экономики: ускорение расширяет спрос и рынки сбыта.',
  },
  {
    id: 'industrial_production',
    name_ru: 'Промышленное производство, г/г',
    category: 'real',
    priority: 'medium',
    unit: '%',
    latest_value: null,
    period: null,
    source: 'БНС АСПиР РК',
    impact_note: 'Пульс реального сектора и загрузки производственных мощностей.',
  },
  {
    id: 'retail_trade',
    name_ru: 'Розничная торговля, г/г',
    category: 'real',
    priority: 'medium',
    unit: '%',
    latest_value: null,
    period: null,
    source: 'БНС АСПиР РК',
    impact_note: 'Прокси потребительского спроса — ключ для B2C-сегментов.',
  },

  // --- Фондовый рынок ---
  {
    id: 'kase_index',
    name_ru: 'Индекс KASE',
    category: 'equities',
    priority: 'high',
    unit: 'пт',
    latest_value: null,
    period: null,
    source: 'KASE',
    impact_note: 'Барометр настроений по локальным голубым фишкам.',
  },
  {
    id: 'aix_qazaq',
    name_ru: 'AIX Qazaq Index',
    category: 'equities',
    priority: 'low',
    unit: 'пт',
    latest_value: null,
    period: null,
    source: 'AIX',
    impact_note: 'Отражает динамику бумаг, торгуемых на бирже МФЦА.',
  },

  // --- Демография и труд ---
  {
    id: 'population',
    name_ru: 'Население',
    category: 'labor',
    priority: 'medium',
    unit: 'млн чел.',
    latest_value: 20.3,
    period: '2025',
    source: 'БНС АСПиР РК',
    impact_note: 'Размер внутреннего рынка и трудовых ресурсов.',
  },
  {
    id: 'unemployment',
    name_ru: 'Уровень безработицы',
    category: 'labor',
    priority: 'medium',
    unit: '%',
    latest_value: null,
    period: null,
    source: 'БНС АСПиР РК',
    impact_note: 'Низкая безработица поддерживает потребление, но давит на зарплаты.',
  },
  {
    id: 'real_incomes',
    name_ru: 'Реальные денежные доходы, г/г',
    category: 'labor',
    priority: 'medium',
    unit: '%',
    latest_value: null,
    period: null,
    source: 'БНС АСПиР РК',
    impact_note: 'Определяет реальную покупательную способность домохозяйств.',
  },

  // --- Фискальная политика ---
  {
    id: 'national_fund',
    name_ru: 'Активы Нацфонда',
    category: 'fiscal',
    priority: 'high',
    unit: 'млрд $',
    latest_value: null,
    period: null,
    source: 'НБРК',
    impact_note: 'Подушка безопасности бюджета и источник трансфертов в экономику.',
  },
  {
    id: 'budget_balance',
    name_ru: 'Баланс госбюджета к ВВП',
    category: 'fiscal',
    priority: 'medium',
    unit: '% ВВП',
    latest_value: null,
    period: null,
    source: 'Минфин РК',
    impact_note: 'Дефицит требует заимствований или трансфертов из Нацфонда.',
  },
];

/** Лейблы приоритетов для бейджей. */
export const PRIORITY_LABELS: Record<IndicatorPriority, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

/** Порядок сортировки: high → medium → low. */
export const PRIORITY_ORDER: Record<IndicatorPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Найти категорию по id. */
export function getCategory(id: string): MacroCategory | undefined {
  return MACRO_CATEGORIES.find((c) => c.id === id);
}

/** Найти показатель по id. */
export function getIndicator(id: string): MacroIndicatorEntry | undefined {
  return KZ_MACRO_INDICATORS.find((i) => i.id === id);
}

/** Показатели категории, отсортированные по приоритету. */
export function indicatorsByCategory(categoryId: string): MacroIndicatorEntry[] {
  return KZ_MACRO_INDICATORS.filter((i) => i.category === categoryId).sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}
