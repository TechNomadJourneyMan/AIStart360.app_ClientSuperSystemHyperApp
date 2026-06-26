import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persisted competitor / market-analysis state.
 *
 * The `/competitors` route survey answers, the user's own company name, and a
 * `hasResult` flag are persisted to localStorage so the niche dashboard, KPIs,
 * charts, table, and map repopulate after a reload or navigation without the
 * user re-doing the survey.
 *
 * localStorage key: `mk-competitor-analysis`.
 */

/** Survey answers — the inputs that define the niche. */
export interface CompetitorSurvey {
  category: string | null;
  audience: string | null;
  stage: string | null;
  regions: string[];
  price: string | null;
  /** SAM fraction (0–1). */
  addressablePct: number;
  /** SOM fraction (0–1). */
  obtainablePct: number;
}

export const EMPTY_SURVEY: CompetitorSurvey = {
  category: null,
  audience: null,
  stage: null,
  regions: [],
  price: null,
  addressablePct: 0.3,
  obtainablePct: 0.05,
};

export interface CompetitorAnalysisState {
  survey: CompetitorSurvey;
  /** The user's own company name (optional, shown in the niche header). */
  businessName: string;
  /** True once a survey has been submitted and a result should be shown. */
  hasResult: boolean;

  setSurvey: (next: Partial<CompetitorSurvey>) => void;
  replaceSurvey: (next: CompetitorSurvey) => void;
  setBusinessName: (name: string) => void;
  setHasResult: (value: boolean) => void;
  reset: () => void;
}

export const COMPETITOR_ANALYSIS_STORAGE_KEY = 'mk-competitor-analysis';

export const useCompetitorAnalysisStore = create<CompetitorAnalysisState>()(
  persist(
    (set) => ({
      survey: EMPTY_SURVEY,
      businessName: '',
      hasResult: false,

      setSurvey: (next) =>
        set((s) => ({ survey: { ...s.survey, ...next } })),
      replaceSurvey: (next) => set({ survey: next }),
      setBusinessName: (name) => set({ businessName: name }),
      setHasResult: (value) => set({ hasResult: value }),
      reset: () =>
        set({ survey: EMPTY_SURVEY, businessName: '', hasResult: false }),
    }),
    {
      name: COMPETITOR_ANALYSIS_STORAGE_KEY,
      // Persist only the data fields, not the action functions.
      partialize: (s) => ({
        survey: s.survey,
        businessName: s.businessName,
        hasResult: s.hasResult,
      }),
    },
  ),
);
