/**
 * GRI Scoring Engine
 * Deterministic logic for calculating Growth Readiness Index.
 * Based on the AIStart360.csv documentation.
 */

export interface GriAnswers {
  // Finance
  revenue: number;
  margin: number;
  cac: number;
  ltv: number;
  runway: number;

  // Market & Product
  industry: string;
  mainOffer: string;
  avgCheck: number;
  
  // Sales & Funnel
  conversionRate?: number;
  hasCrm?: boolean;
  hasScripts?: boolean;
  
  // Operations & Team
  processesDocumented?: boolean;
  delegationReady?: boolean;
  teamSize?: number;

  // Strategy & Founder
  ownerHoursWeekly?: number;
  hasDeputy?: boolean;
  strategicHorizonYears?: number;
}

export interface GriResult {
  score: number;
  productScore: number;
  /**
   * Trust & Positioning block. `null` means "not enough data to score" — the
   * `GriAnswers` shape carries no qualitative trust/positioning signals (brand,
   * reviews, USP, differentiation), so this engine cannot honestly score it and
   * refuses to fabricate a value. Consumers must render `null` as "нет данных".
   */
  trustScore: number | null;
  businessModelScore: number;
  cashScore: number;
  operationsScore: number;
  teamScore: number;
  founderScore: number;
  /** How many blocks the overall `score` was averaged over (non-null blocks). */
  blocksUsed: number;
}

/**
 * Trust & Positioning block (0–100) or `null` when it cannot be honestly scored.
 *
 * The finance-oriented `GriAnswers` shape has no qualitative inputs that measure
 * trust/positioning (brand recognition, reviews, expert positioning, USP), so
 * there is nothing to score here — we return `null` rather than the old constant
 * `50`, which silently dragged every overall score toward the midpoint. Real
 * trust signals live in the survey (s5_* marketing) and the 62-criterion
 * assessment; those feed the canonical engine, not this one.
 */
function computeTrustBlock(_a: GriAnswers): number | null {
  return null;
}

/**
 * calculateGri — Calculates scores for 7 growth readiness blocks (0-100 scale).
 * Formulas derived from the project methodology.
 */
export function calculateGri(a: GriAnswers): GriResult {
  // 1. Business Model (Unit Economics)
  // Target: LTV:CAC >= 3, Margin >= 50%
  const businessModelScore = (() => {
    const ltvCacRatio = a.ltv / Math.max(a.cac, 1);
    const ltvWeight = Math.min(ltvCacRatio / 3, 1) * 50;
    const marginWeight = Math.min(a.margin / 50, 1) * 50;
    return ltvWeight + marginWeight;
  })();

  // 2. Cash Stability
  // Target: Runway >= 12 months
  const cashScore = (() => {
    return Math.min(a.runway / 12, 1) * 100;
  })();

  // 3. Product & Demand
  // Target: Conversion >= 15%, High Avg Check
  const productScore = (() => {
    const convWeight = Math.min((a.conversionRate || 0) / 15, 1) * 70;
    const scriptsBonus = a.hasScripts ? 30 : 0;
    return convWeight + scriptsBonus;
  })();

  // 4. Operations
  // Target: Documented processes, CRM
  const operationsScore = (() => {
    const processesWeight = a.processesDocumented ? 60 : 0;
    const crmWeight = a.hasCrm ? 40 : 0;
    return processesWeight + crmWeight;
  })();

  // 5. Team
  // Target: Size >= 5, Delegation
  const teamScore = (() => {
    const teamSizeWeight = Math.min((a.teamSize || 0) / 10, 1) * 50;
    const delegationWeight = a.delegationReady ? 50 : 0;
    return teamSizeWeight + delegationWeight;
  })();

  // 6. Founder Readiness
  // Target: < 20 hours in operations, has deputy
  const founderScore = (() => {
    const hours = a.ownerHoursWeekly || 40;
    const hoursWeight = Math.max(0, (60 - hours) / 40) * 60; // 60% of score
    const deputyWeight = a.hasDeputy ? 40 : 0;
    return Math.min(100, hoursWeight + deputyWeight);
  })();

  // 7. Trust & Positioning — honestly null when there are no qualitative signals.
  const trustScore = computeTrustBlock(a);

  // Overall score = mean of the blocks we could actually measure. Averaging over
  // only the non-null blocks avoids diluting the result with a phantom value.
  const measurable = [
    businessModelScore,
    cashScore,
    productScore,
    operationsScore,
    teamScore,
    founderScore,
    trustScore,
  ].filter((b): b is number => b !== null);
  const score = measurable.reduce((sum, b) => sum + b, 0) / measurable.length;

  return {
    score: Math.round(score),
    businessModelScore: Math.round(businessModelScore),
    cashScore: Math.round(cashScore),
    productScore: Math.round(productScore),
    operationsScore: Math.round(operationsScore),
    teamScore: Math.round(teamScore),
    founderScore: Math.round(founderScore),
    trustScore: trustScore === null ? null : Math.round(trustScore),
    blocksUsed: measurable.length,
  };
}
