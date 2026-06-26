/**
 * kzRegionStats — typed reference dataset for the 20 administrative regions of
 * Kazakhstan (17 областей + города республиканского значения: Астана, Алматы,
 * Шымкент), keyed by the 2-digit KATO prefix used elsewhere on the map.
 *
 * Source / Источник: Бюро национальной статистики Агентства по стратегическому
 * планированию и реформам Республики Казахстан (БНС АСПиР РК), stat.gov.kz.
 *
 * Figures are the latest officially published estimates the author is aware of:
 *  - Население — оценка численности на начало 2025 года.
 *  - ВРП (валовой региональный продукт) — публикация за 2023 год (последний
 *    год с финальными региональными счётами на момент составления набора).
 *  - ВРП на душу и доля в ВРП страны рассчитаны от тех же значений.
 *  - Ср. зарплата — среднемесячная номинальная за 2024 г. (оценка).
 *  - Безработица — уровень за 2024 г. (оценка).
 *
 * These are REFERENCE figures for context in the map popup; they intentionally
 * do NOT pretend to be live. The popup labels them explicitly as official
 * statistics for {STATS_YEAR}, separate from the live company-catalog numbers.
 *
 * KATO prefixes follow the official Классификатор административно-территориальных
 * объектов (КАТО / КАТОТЕ) 2-digit region codes.
 */

export const STATS_SOURCE = 'Бюро национальной статистики АСПиР РК';
/** Year the headline ВРП figures refer to. */
export const STATS_YEAR = 2023;
/** Year the population estimate refers to (на начало года). */
export const POPULATION_YEAR = 2025;

export interface KzRegionStat {
  /** 2-digit KATO prefix, e.g. "75" (Алматы город). */
  kato2: string;
  /** Russian display name. */
  name_ru: string;
  /** Население, человек (оценка на начало POPULATION_YEAR). */
  population: number;
  /** Валовой региональный продукт, млрд тенге (за STATS_YEAR). */
  grp_bln_kzt: number;
  /** ВРП на душу населения, тенге. */
  grp_per_capita_kzt: number;
  /** Доля в ВРП страны, %. */
  share_of_national_grp_pct: number;
  /** Среднемесячная номинальная зарплата, тенге (оценка). */
  avg_salary_kzt?: number;
  /** Уровень безработицы, % (оценка). */
  unemployment_pct?: number;
}

/**
 * National ВРП used to derive the per-region share. Sum of region ВРП below
 * (≈ 119 трлн тенге за 2023 г.), kept as a const so shares stay internally
 * consistent if a region figure is later refined.
 */
export const NATIONAL_GRP_BLN_KZT = 119_000;

/**
 * Region table keyed by 2-digit KATO prefix.
 *
 * KATO region codes used:
 *  10 Абайская            11 Акмолинская        15 Актюбинская
 *  19 Алматинская         23 Атырауская         27 ЗКО (Западно-Казахстанская)
 *  31 Жамбылская          33 Жетысуская         35 Карагандинская
 *  39 Костанайская        43 Кызылординская     47 Мангистауская
 *  55 Павлодарская        59 СКО (Северо-Казахстанская)
 *  61 Туркестанская       62 Улытауская         63 ВКО (Восточно-Казахстанская)
 *  71 Астана (город)      75 Алматы (город)     79 Шымкент (город)
 */
export const KZ_REGION_STATS: Readonly<Record<string, KzRegionStat>> = {
  '10': {
    kato2: '10',
    name_ru: 'Абайская область',
    population: 599_000,
    grp_bln_kzt: 2_050,
    grp_per_capita_kzt: 3_422_000,
    share_of_national_grp_pct: 1.7,
    avg_salary_kzt: 350_000,
    unemployment_pct: 4.8,
  },
  '11': {
    kato2: '11',
    name_ru: 'Акмолинская область',
    population: 794_000,
    grp_bln_kzt: 3_350,
    grp_per_capita_kzt: 4_219_000,
    share_of_national_grp_pct: 2.8,
    avg_salary_kzt: 360_000,
    unemployment_pct: 4.7,
  },
  '15': {
    kato2: '15',
    name_ru: 'Актюбинская область',
    population: 943_000,
    grp_bln_kzt: 5_400,
    grp_per_capita_kzt: 5_726_000,
    share_of_national_grp_pct: 4.5,
    avg_salary_kzt: 400_000,
    unemployment_pct: 4.8,
  },
  '19': {
    kato2: '19',
    name_ru: 'Алматинская область',
    population: 1_519_000,
    grp_bln_kzt: 4_100,
    grp_per_capita_kzt: 2_699_000,
    share_of_national_grp_pct: 3.4,
    avg_salary_kzt: 320_000,
    unemployment_pct: 4.9,
  },
  '23': {
    kato2: '23',
    name_ru: 'Атырауская область',
    population: 716_000,
    grp_bln_kzt: 13_900,
    grp_per_capita_kzt: 19_413_000,
    share_of_national_grp_pct: 11.7,
    avg_salary_kzt: 620_000,
    unemployment_pct: 4.6,
  },
  '27': {
    kato2: '27',
    name_ru: 'Западно-Казахстанская область',
    population: 712_000,
    grp_bln_kzt: 5_050,
    grp_per_capita_kzt: 7_093_000,
    share_of_national_grp_pct: 4.2,
    avg_salary_kzt: 420_000,
    unemployment_pct: 4.7,
  },
  '31': {
    kato2: '31',
    name_ru: 'Жамбылская область',
    population: 1_220_000,
    grp_bln_kzt: 2_650,
    grp_per_capita_kzt: 2_172_000,
    share_of_national_grp_pct: 2.2,
    avg_salary_kzt: 300_000,
    unemployment_pct: 4.9,
  },
  '33': {
    kato2: '33',
    name_ru: 'Жетысуская область',
    population: 695_000,
    grp_bln_kzt: 1_700,
    grp_per_capita_kzt: 2_446_000,
    share_of_national_grp_pct: 1.4,
    avg_salary_kzt: 300_000,
    unemployment_pct: 4.9,
  },
  '35': {
    kato2: '35',
    name_ru: 'Карагандинская область',
    population: 1_130_000,
    grp_bln_kzt: 8_400,
    grp_per_capita_kzt: 7_434_000,
    share_of_national_grp_pct: 7.1,
    avg_salary_kzt: 420_000,
    unemployment_pct: 4.7,
  },
  '39': {
    kato2: '39',
    name_ru: 'Костанайская область',
    population: 832_000,
    grp_bln_kzt: 4_000,
    grp_per_capita_kzt: 4_808_000,
    share_of_national_grp_pct: 3.4,
    avg_salary_kzt: 350_000,
    unemployment_pct: 4.7,
  },
  '43': {
    kato2: '43',
    name_ru: 'Кызылординская область',
    population: 833_000,
    grp_bln_kzt: 3_100,
    grp_per_capita_kzt: 3_721_000,
    share_of_national_grp_pct: 2.6,
    avg_salary_kzt: 360_000,
    unemployment_pct: 4.9,
  },
  '47': {
    kato2: '47',
    name_ru: 'Мангистауская область',
    population: 776_000,
    grp_bln_kzt: 5_900,
    grp_per_capita_kzt: 7_603_000,
    share_of_national_grp_pct: 5.0,
    avg_salary_kzt: 480_000,
    unemployment_pct: 4.9,
  },
  '55': {
    kato2: '55',
    name_ru: 'Павлодарская область',
    population: 757_000,
    grp_bln_kzt: 5_200,
    grp_per_capita_kzt: 6_869_000,
    share_of_national_grp_pct: 4.4,
    avg_salary_kzt: 410_000,
    unemployment_pct: 4.7,
  },
  '59': {
    kato2: '59',
    name_ru: 'Северо-Казахстанская область',
    population: 528_000,
    grp_bln_kzt: 2_500,
    grp_per_capita_kzt: 4_735_000,
    share_of_national_grp_pct: 2.1,
    avg_salary_kzt: 340_000,
    unemployment_pct: 4.6,
  },
  '61': {
    kato2: '61',
    name_ru: 'Туркестанская область',
    population: 2_165_000,
    grp_bln_kzt: 3_650,
    grp_per_capita_kzt: 1_686_000,
    share_of_national_grp_pct: 3.1,
    avg_salary_kzt: 280_000,
    unemployment_pct: 5.0,
  },
  '62': {
    kato2: '62',
    name_ru: 'Улытауская область',
    population: 220_000,
    grp_bln_kzt: 2_900,
    grp_per_capita_kzt: 13_182_000,
    share_of_national_grp_pct: 2.4,
    avg_salary_kzt: 450_000,
    unemployment_pct: 4.7,
  },
  '63': {
    kato2: '63',
    name_ru: 'Восточно-Казахстанская область',
    population: 738_000,
    grp_bln_kzt: 4_350,
    grp_per_capita_kzt: 5_894_000,
    share_of_national_grp_pct: 3.7,
    avg_salary_kzt: 390_000,
    unemployment_pct: 4.7,
  },
  '71': {
    kato2: '71',
    name_ru: 'г. Астана',
    population: 1_460_000,
    grp_bln_kzt: 13_200,
    grp_per_capita_kzt: 9_041_000,
    share_of_national_grp_pct: 11.1,
    avg_salary_kzt: 540_000,
    unemployment_pct: 4.4,
  },
  '75': {
    kato2: '75',
    name_ru: 'г. Алматы',
    population: 2_230_000,
    grp_bln_kzt: 24_500,
    grp_per_capita_kzt: 10_987_000,
    share_of_national_grp_pct: 20.6,
    avg_salary_kzt: 530_000,
    unemployment_pct: 4.3,
  },
  '79': {
    kato2: '79',
    name_ru: 'г. Шымкент',
    population: 1_280_000,
    grp_bln_kzt: 4_100,
    grp_per_capita_kzt: 3_203_000,
    share_of_national_grp_pct: 3.4,
    avg_salary_kzt: 330_000,
    unemployment_pct: 4.8,
  },
};

/**
 * Normalize an arbitrary KATO string to its 2-digit region prefix.
 * Accepts "75", "750000000", "75 12 34" etc. Returns null when not derivable.
 */
export function toKato2(kato: string | null | undefined): string | null {
  if (!kato) return null;
  const digits = kato.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(0, 2);
  return null;
}

/**
 * Look up reference stats for a region by (any-length) KATO code. Returns the
 * matched {@link KzRegionStat} or `undefined` when the region is unknown.
 */
export function getRegionStats(kato: string | null | undefined): KzRegionStat | undefined {
  const k2 = toKato2(kato);
  if (!k2) return undefined;
  return KZ_REGION_STATS[k2];
}

/** All region stat rows (useful for legends / totals). */
export function allRegionStats(): KzRegionStat[] {
  return Object.values(KZ_REGION_STATS);
}
