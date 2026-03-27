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
  overallScore: number;
  productScore: number;
  trustScore: number;
  businessModelScore: number;
  cashScore: number;
  operationsScore: number;
  teamScore: number;
  founderScore: number;
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

  // 7. Trust & Positioning (Placeholder for qualitative analysis)
  const trustScore = 50;

  const overallScore = (
    businessModelScore +
    cashScore +
    productScore +
    operationsScore +
    teamScore +
    founderScore +
    trustScore
  ) / 7;

  return {
    overallScore: Math.round(overallScore),
    businessModelScore: Math.round(businessModelScore),
    cashScore: Math.round(cashScore),
    productScore: Math.round(productScore),
    operationsScore: Math.round(operationsScore),
    teamScore: Math.round(teamScore),
    founderScore: Math.round(founderScore),
    trustScore: Math.round(trustScore),
  };
}
