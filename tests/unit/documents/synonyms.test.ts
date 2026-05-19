import { describe, it, expect } from 'vitest';
import {
  METRIC_SYNONYMS,
  normalizeForMatch,
  matchSynonym,
  getSynonymIndex,
} from '@/lib/documents/synonyms';

describe('normalizeForMatch', () => {
  it('lowercases the input', () => {
    expect(normalizeForMatch('Revenue')).toBe('revenue');
    expect(normalizeForMatch('GROSS MARGIN')).toBe('gross margin');
  });

  it('transliterates ё → е', () => {
    expect(normalizeForMatch('Учёт')).toBe('учет');
    expect(normalizeForMatch('Объём продаж')).toBe('объем продаж');
  });

  it('strips punctuation but preserves % and /', () => {
    expect(normalizeForMatch('Churn %')).toBe('churn %');
    expect(normalizeForMatch('LTV/CAC')).toBe('ltv/cac');
    expect(normalizeForMatch('Выручка, ₸!')).toBe('выручка');
  });

  it('collapses whitespace', () => {
    expect(normalizeForMatch('  gross   margin  ')).toBe('gross margin');
    expect(normalizeForMatch('net\tprofit')).toBe('net profit');
  });

  it('handles empty / falsy input', () => {
    expect(normalizeForMatch('')).toBe('');
    // @ts-expect-error — guard against runtime undefined input
    expect(normalizeForMatch(undefined)).toBe('');
  });
});

describe('matchSynonym', () => {
  it('matches Russian → canonical English key', () => {
    expect(matchSynonym('Выручка')).toBe('revenue');
    expect(matchSynonym('Чистая прибыль')).toBe('net_profit');
    expect(matchSynonym('Маржинальность')).toBe('gross_margin');
    expect(matchSynonym('Отток клиентов')).toBe('churn_rate');
  });

  it('matches English variants (case-insensitive)', () => {
    expect(matchSynonym('GROSS MARGIN')).toBe('gross_margin');
    expect(matchSynonym('gross margin')).toBe('gross_margin');
    expect(matchSynonym('NPS')).toBe('nps');
    expect(matchSynonym('Net Promoter Score')).toBe('nps');
  });

  it('matches synonyms with punctuation / units', () => {
    expect(matchSynonym('Выручка (год)')).toBe('revenue');
    expect(matchSynonym('CPL (стоимость лида)')).toBe('cpl');
    expect(matchSynonym('Churn %')).toBe('churn_rate');
  });

  it('matches via substring scan for labels with extra context', () => {
    expect(matchSynonym('Выручка 2025 (₸)')).toBe('revenue');
    expect(matchSynonym('Расходы: маркетинг по каналам')).toBe('marketing_budget');
  });

  it('returns null for unknown inputs', () => {
    expect(matchSynonym('xyz unknown')).toBeNull();
    expect(matchSynonym('totally not a metric')).toBeNull();
    expect(matchSynonym('')).toBeNull();
  });

  it('canonical key itself is a valid input', () => {
    expect(matchSynonym('revenue')).toBe('revenue');
    expect(matchSynonym('net_profit')).toBe('net_profit');
    expect(matchSynonym('cac')).toBe('cac');
  });
});

describe('getSynonymIndex', () => {
  it('returns the same Map instance on repeated calls (memoised)', () => {
    const a = getSynonymIndex();
    const b = getSynonymIndex();
    expect(a).toBe(b);
  });

  it('every canonical key resolves to itself via the index', () => {
    const idx = getSynonymIndex();
    for (const canonical of Object.keys(METRIC_SYNONYMS)) {
      expect(idx.get(normalizeForMatch(canonical))).toBe(canonical);
    }
  });
});

describe('METRIC_SYNONYMS coverage', () => {
  it('contains at least 80 canonical keys', () => {
    expect(Object.keys(METRIC_SYNONYMS).length).toBeGreaterThanOrEqual(80);
  });

  it('every canonical key has at least 3 synonyms', () => {
    for (const [key, syns] of Object.entries(METRIC_SYNONYMS)) {
      expect(syns.length, `expected ${key} to have ≥3 synonyms`).toBeGreaterThanOrEqual(3);
    }
  });

  it('includes the headline financial metrics from descriptions.ts', () => {
    const required = [
      'revenue',
      'gross_margin',
      'ebitda',
      'net_profit',
      'cac',
      'ltv',
      'cpl',
      'nps',
      'churn_rate',
      'avg_check',
      'win_rate',
      'deal_cycle_days',
      'retention',
      'arpu',
      'roi',
      'roa',
      'cash_flow',
      'employee_count',
      'market_share',
      'conversion_rate',
    ];
    for (const key of required) {
      expect(METRIC_SYNONYMS, `missing canonical key: ${key}`).toHaveProperty(key);
    }
  });
});
