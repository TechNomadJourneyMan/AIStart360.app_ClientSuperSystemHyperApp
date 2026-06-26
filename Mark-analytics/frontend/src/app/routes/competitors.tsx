import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Layers,
  MapPin,
  RotateCcw,
  Sparkles,
  Tag,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

import { MapShell, type CompanyPoint } from '../../components/map/MapShell';
import { CompanyDeepDrawer } from '../../components/drawers/CompanyDeepDrawer';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/cn';
import { formatCurrency, formatNumber, formatPercent } from '../../lib/format';
import { useMapStore } from '../../stores/map';
import {
  pointsFromMarketMap,
  useCompetitorMarketMap,
  useCompetitorOptions,
  useCompetitorWizard,
  type Competitor,
  type CompetitionLevel,
  type CompetitorOption,
  type CompetitorWizardResult,
  type MarketBlock,
  type WizardAnswers,
} from '../../hooks/useCompetitors';
import { MarketCharts } from '../../components/competitors/MarketCharts';
import {
  EMPTY_SURVEY,
  useCompetitorAnalysisStore,
  type CompetitorSurvey,
} from '../../stores/competitorAnalysis';

export const Route = createFileRoute('/competitors')({
  component: CompetitorsRoute,
});

type StepKey = 'category' | 'audience' | 'stage' | 'regions' | 'price';
const STEP_ORDER: StepKey[] = ['category', 'audience', 'stage', 'regions', 'price'];

interface SurveyState {
  category: string | null;
  audience: string | null;
  stage: string | null;
  regions: string[];
  price: string | null;
}

function surveyToAnswers(
  s: SurveyState,
  extra: { addressable_pct?: number; obtainable_pct?: number } = {},
): WizardAnswers {
  return {
    category: s.category ?? '',
    audience: s.audience,
    stage: s.stage,
    regions: s.regions,
    price: s.price,
    limit: 12,
    addressable_pct: extra.addressable_pct,
    obtainable_pct: extra.obtainable_pct,
  };
}

function storeSurveyToUi(s: CompetitorSurvey): SurveyState {
  return {
    category: s.category,
    audience: s.audience,
    stage: s.stage,
    regions: s.regions,
    price: s.price,
  };
}

function CompetitorsRoute(): JSX.Element {
  const { t } = useTranslation();
  const optionsQuery = useCompetitorOptions();
  const wizard = useCompetitorWizard();
  const marketMap = useCompetitorMarketMap();

  // Persisted analysis state (localStorage: mk-competitor-analysis).
  const { persistedSurvey, businessName, hasPersistedResult } =
    useCompetitorAnalysisStore(
      useShallow((s) => ({
        persistedSurvey: s.survey,
        businessName: s.businessName,
        hasPersistedResult: s.hasResult,
      })),
    );
  const replaceSurvey = useCompetitorAnalysisStore((s) => s.replaceSurvey);
  const setStoreSurvey = useCompetitorAnalysisStore((s) => s.setSurvey);
  const setBusinessName = useCompetitorAnalysisStore((s) => s.setBusinessName);
  const setHasResult = useCompetitorAnalysisStore((s) => s.setHasResult);
  const resetStore = useCompetitorAnalysisStore((s) => s.reset);

  // UI-only survey form state, seeded from persisted answers.
  const [survey, setSurvey] = useState<SurveyState>(() =>
    storeSurveyToUi(persistedSurvey),
  );
  const [stepIdx, setStepIdx] = useState(0);
  const addressablePct = persistedSurvey.addressablePct;
  const obtainablePct = persistedSurvey.obtainablePct;
  // Survey is shown unless a persisted/just-computed result exists.
  const [showSurvey, setShowSurvey] = useState(!hasPersistedResult);

  const result = wizard.data;
  const hasResult = Boolean(result) && !showSurvey;

  const runAnalysis = useCallback(
    (s: SurveyState, addr: number, obt: number) => {
      const answers = surveyToAnswers(s, {
        addressable_pct: addr,
        obtainable_pct: obt,
      });
      wizard.mutate(answers);
      marketMap.mutate(answers);
    },
    [wizard, marketMap],
  );

  // Restore: when a persisted result exists but the (ephemeral) mutation state
  // is idle — no data, not in flight, not errored — re-fire the analysis so the
  // dashboard + map repopulate without re-doing the survey.
  //
  // NOTE: `useMutation` state is NOT persisted (only the zustand store is), and
  // under React 18 StrictMode the component mounts → unmounts → remounts in dev.
  // A one-shot `useRef` guard survives the remount while the mutation instance
  // is torn down and recreated fresh, so the in-flight restore is dropped and
  // never re-fired — leaving the UI stuck on the loading skeleton forever.
  // Keying off the live mutation `status` (and `marketMap.status`) instead makes
  // the restore idempotent and remount-safe: it fires exactly when needed and is
  // a no-op once data is present / a request is pending.
  const wizardStatus = wizard.status;
  useEffect(() => {
    if (showSurvey) return;
    if (!hasPersistedResult || !persistedSurvey.category) return;
    // Only (re)fire when the mutation is genuinely idle for this view: no data
    // yet and not already running. `isError` is left alone so the user sees the
    // honest error card + Retry instead of an auto-retry loop.
    if (wizardStatus === 'idle') {
      runAnalysis(
        storeSurveyToUi(persistedSurvey),
        persistedSurvey.addressablePct,
        persistedSurvey.obtainablePct,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSurvey, hasPersistedResult, persistedSurvey.category, wizardStatus]);

  const handleSubmitSurvey = useCallback(() => {
    if (!survey.category) return;
    // Persist the submitted answers + mark a result exists.
    replaceSurvey({
      ...survey,
      addressablePct,
      obtainablePct,
    });
    setHasResult(true);
    runAnalysis(survey, addressablePct, obtainablePct);
    setShowSurvey(false);
  }, [
    survey,
    addressablePct,
    obtainablePct,
    runAnalysis,
    replaceSurvey,
    setHasResult,
  ]);

  const reopenSurvey = useCallback(() => {
    // Keep prior answers pre-selected; just return to the survey.
    setSurvey(storeSurveyToUi(persistedSurvey));
    setShowSurvey(true);
    setStepIdx(0);
  }, [persistedSurvey]);

  // Hard reset: wipe persisted answers + computed result and return to a blank
  // step-1 survey. Always reachable (from results AND the loading/error states)
  // so a stuck or stale state can never trap the user.
  const resetParams = useCallback(() => {
    resetStore();
    wizard.reset();
    marketMap.reset();
    setSurvey(storeSurveyToUi(EMPTY_SURVEY));
    setStepIdx(0);
    setShowSurvey(true);
  }, [resetStore, wizard, marketMap]);

  // --- Live re-run (debounced) when tune controls change in results view ----
  const tuneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRerun = useCallback(
    (next: Partial<{ regions: string[]; price: string | null; addr: number; obt: number }>) => {
      const nextSurvey: SurveyState = {
        ...survey,
        regions: next.regions ?? survey.regions,
        price: next.price !== undefined ? next.price : survey.price,
      };
      const addr = next.addr ?? addressablePct;
      const obt = next.obt ?? obtainablePct;
      setSurvey(nextSurvey);
      // Persist the tuned answers so they survive reload/navigation.
      setStoreSurvey({
        regions: nextSurvey.regions,
        price: nextSurvey.price,
        addressablePct: addr,
        obtainablePct: obt,
      });
      if (tuneTimer.current) clearTimeout(tuneTimer.current);
      tuneTimer.current = setTimeout(() => {
        if (nextSurvey.category) runAnalysis(nextSurvey, addr, obt);
      }, 450);
    },
    [survey, addressablePct, obtainablePct, runAnalysis, setStoreSurvey],
  );

  useEffect(() => () => {
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
  }, []);

  const mapPoints = useMemo<CompanyPoint[]>(
    () => pointsFromMarketMap(marketMap.data, result?.competitors ?? []),
    [marketMap.data, result?.competitors],
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[color:var(--primary)]" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">{t('competitors.title')}</h1>
        </div>
        <p className="max-w-2xl text-sm text-[color:var(--muted-foreground)]">
          {t('competitors.subtitle')}
        </p>
      </header>

      {showSurvey ? (
        <SurveyView
          options={optionsQuery.data}
          loading={optionsQuery.isLoading}
          error={optionsQuery.isError ? t('competitors.error.options') : null}
          onRetryOptions={() => void optionsQuery.refetch()}
          survey={survey}
          setSurvey={setSurvey}
          stepIdx={stepIdx}
          setStepIdx={setStepIdx}
          submitting={wizard.isPending}
          onSubmit={handleSubmitSurvey}
          businessName={businessName}
          setBusinessName={setBusinessName}
        />
      ) : wizard.isError ? (
        <ErrorPanel
          message={t('competitors.error.wizard')}
          detail={wizard.error?.message}
          retryLabel={t('competitors.error.retry')}
          onRetry={() => runAnalysis(survey, addressablePct, obtainablePct)}
          resetLabel={t('competitors.results.reset')}
          onReset={resetParams}
        />
      ) : hasResult && result ? (
        <ResultsView
          result={result}
          options={optionsQuery.data}
          mapPoints={mapPoints}
          recalculating={wizard.isPending}
          addressablePct={addressablePct}
          obtainablePct={obtainablePct}
          businessName={businessName}
          onTune={liveRerun}
          onReopen={reopenSurvey}
          onReset={resetParams}
        />
      ) : (
        // Not on the survey and no result yet: either the restore mutation is in
        // flight, or it is about to fire from the restore effect this tick. Show
        // a genuine skeleton (never a blank null branch) plus an always-available
        // reset so the user can never get trapped if a request silently stalls.
        <ResultsSkeleton onReset={resetParams} resetLabel={t('competitors.results.reset')} />
      )}

      <CompanyDeepDrawer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Survey (stepper)
// ---------------------------------------------------------------------------

const STEP_ICON: Record<StepKey, JSX.Element> = {
  category: <Building2 className="h-4 w-4" aria-hidden />,
  audience: <Users className="h-4 w-4" aria-hidden />,
  stage: <TrendingUp className="h-4 w-4" aria-hidden />,
  regions: <MapPin className="h-4 w-4" aria-hidden />,
  price: <Tag className="h-4 w-4" aria-hidden />,
};

interface SurveyViewProps {
  options: ReturnType<typeof useCompetitorOptions>['data'];
  loading: boolean;
  error: string | null;
  onRetryOptions: () => void;
  survey: SurveyState;
  setSurvey: React.Dispatch<React.SetStateAction<SurveyState>>;
  stepIdx: number;
  setStepIdx: React.Dispatch<React.SetStateAction<number>>;
  submitting: boolean;
  onSubmit: () => void;
  businessName: string;
  setBusinessName: (name: string) => void;
}

function optionsForStep(
  step: StepKey,
  options: SurveyViewProps['options'],
): CompetitorOption[] {
  if (!options) return [];
  switch (step) {
    case 'category':
      return options.categories;
    case 'audience':
      return options.audiences;
    case 'stage':
      return options.stages;
    case 'regions':
      return options.regions;
    case 'price':
      return options.prices;
    default:
      return [];
  }
}

function SurveyView({
  options,
  loading,
  error,
  onRetryOptions,
  survey,
  setSurvey,
  stepIdx,
  setStepIdx,
  submitting,
  onSubmit,
  businessName,
  setBusinessName,
}: SurveyViewProps): JSX.Element {
  const { t } = useTranslation();
  const step: StepKey = STEP_ORDER[stepIdx] ?? 'category';
  const isLast = stepIdx === STEP_ORDER.length - 1;
  const isMulti = step === 'regions';
  const opts = optionsForStep(step, options);

  const selectedKeys = useMemo<Set<string>>(() => {
    if (step === 'regions') return new Set(survey.regions);
    const v = survey[step];
    return v ? new Set([v]) : new Set();
  }, [step, survey]);

  const canAdvance = step === 'category' ? Boolean(survey.category) : true;

  const select = (key: string): void => {
    setSurvey((prev) => {
      if (step === 'regions') {
        const has = prev.regions.includes(key);
        return {
          ...prev,
          regions: has ? prev.regions.filter((r) => r !== key) : [...prev.regions, key],
        };
      }
      return { ...prev, [step]: prev[step] === key ? null : key } as SurveyState;
    });
  };

  if (error) {
    return (
      <ErrorPanel message={error} retryLabel={t('competitors.error.retry')} onRetry={onRetryOptions} />
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Stepper rail */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] p-3">
        {STEP_ORDER.map((s, i) => {
          const done = i < stepIdx;
          const active = i === stepIdx;
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                // Allow jumping back, or forward only if category chosen.
                if (i <= stepIdx || survey.category) setStepIdx(i);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-[color:var(--primary)] text-[color:var(--primary-foreground)]'
                  : done
                    ? 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]'
                    : 'text-[color:var(--muted-foreground)] hover:bg-[color:var(--accent)]',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : STEP_ICON[s]}
              <span className="hidden sm:inline">{t(`competitors.survey.steps.${s}`)}</span>
            </button>
          );
        })}
      </div>

      <CardContent className="flex flex-col gap-4 p-4 pt-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[color:var(--muted-foreground)]">
            {t('competitors.survey.step', { current: stepIdx + 1, total: STEP_ORDER.length })}
          </span>
          <h2 className="text-base font-semibold">
            {t(`competitors.survey.questions.${step}`)}
          </h2>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            {isMulti
              ? t('competitors.survey.multiSelectHint')
              : step !== 'category'
                ? t('competitors.survey.skipOptional')
                : t('competitors.survey.categoryRequired')}
          </p>
        </div>

        {step === 'category' ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[color:var(--muted-foreground)]">
              {t('competitors.survey.businessNameLabel')}
            </span>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder={t('competitors.survey.businessNamePlaceholder')}
              className={cn(
                'w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm',
                'placeholder:text-[color:var(--muted-foreground)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
              )}
            />
          </label>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div
            role={isMulti ? 'group' : 'radiogroup'}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {opts.map((opt) => {
              const selected = selectedKeys.has(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  role={isMulti ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  onClick={() => select(opt.key)}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
                    selected
                      ? 'border-[color:var(--primary)] bg-[color:var(--primary)]/10 text-[color:var(--foreground)]'
                      : 'border-[color:var(--border)] bg-[color:var(--card)] hover:border-[color:var(--ring)]',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                      selected
                        ? 'border-[color:var(--primary)] bg-[color:var(--primary)] text-[color:var(--primary-foreground)]'
                        : 'border-[color:var(--border)]',
                    )}
                    aria-hidden
                  >
                    {selected ? <CheckCircle2 className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0 leading-snug">{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('competitors.survey.back')}
          </Button>

          {isLast ? (
            <Button
              type="button"
              size="sm"
              disabled={!survey.category || submitting}
              onClick={onSubmit}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {t('competitors.survey.submit')}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={!canAdvance}
              onClick={() => setStepIdx((i) => Math.min(STEP_ORDER.length - 1, i + 1))}
            >
              {t('competitors.survey.next')}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface ResultsViewProps {
  result: CompetitorWizardResult;
  options: ReturnType<typeof useCompetitorOptions>['data'];
  mapPoints: CompanyPoint[];
  recalculating: boolean;
  addressablePct: number;
  obtainablePct: number;
  businessName: string;
  onTune: (next: Partial<{ regions: string[]; price: string | null; addr: number; obt: number }>) => void;
  onReopen: () => void;
  onReset: () => void;
}

const COMPETITION_VARIANT: Record<CompetitionLevel, 'default' | 'secondary' | 'muted'> = {
  low: 'secondary',
  moderate: 'default',
  high: 'muted',
};

function ResultsView({
  result,
  options,
  mapPoints,
  recalculating,
  addressablePct,
  obtainablePct,
  businessName,
  onTune,
  onReopen,
  onReset,
}: ResultsViewProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const niche = result.matched_niche;
  const market: MarketBlock | undefined = result.market ?? undefined;
  const isEmpty = (market?.company_count_total ?? result.competitors.length) === 0;

  const competitionLevel = (market?.competition_level ?? null) as CompetitionLevel | null;
  const leaderName = result.summary?.leader?.name ?? t('competitors.results.leaderNone');

  return (
    <div className="flex flex-col gap-4">
      {/* Niche header */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            {businessName.trim() ? (
              <span className="text-xs font-medium text-[color:var(--foreground)]">
                {t('competitors.results.yourCompany')}: {businessName.trim()}
              </span>
            ) : null}
            <span className="text-xs font-medium uppercase tracking-wider text-[color:var(--muted-foreground)]">
              {t('competitors.results.niche')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{niche.category_label}</span>
              {niche.regions && niche.regions.length > 0 ? (
                <Badge variant="outline">
                  <MapPin className="h-3 w-3" aria-hidden /> {niche.regions.join(', ')}
                </Badge>
              ) : null}
              {niche.price_segment ? (
                <Badge variant="muted">
                  <Tag className="h-3 w-3" aria-hidden /> {niche.price_segment}
                </Badge>
              ) : null}
              {niche.audience ? <Badge variant="muted">{niche.audience}</Badge> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {recalculating ? (
              <span className="flex items-center gap-1 text-xs text-[color:var(--muted-foreground)]">
                <Activity className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                {t('competitors.results.recalculating')}
              </span>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onReopen}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('competitors.results.changeParams')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onReset}>
              {t('competitors.results.reset')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live tune controls */}
      <TuneControls
        options={options}
        regions={niche.regions ?? []}
        addressablePct={addressablePct}
        obtainablePct={obtainablePct}
        onTune={onTune}
      />

      {isEmpty ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-[color:var(--muted-foreground)]">
            {t('competitors.results.empty')}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              icon={<Layers className="h-4 w-4" aria-hidden />}
              label={t('competitors.kpi.marketVolume')}
              value={formatCurrency(market?.market_volume_usd ?? market?.tam_usd ?? 0, i18n.language)}
              sub={t('competitors.kpi.tam')}
            />
            <KpiCard
              icon={<Target className="h-4 w-4" aria-hidden />}
              label={t('competitors.kpi.sam')}
              value={formatCurrency(market?.sam_usd ?? 0, i18n.language)}
            />
            <KpiCard
              icon={<Target className="h-4 w-4" aria-hidden />}
              label={t('competitors.kpi.som')}
              value={formatCurrency(market?.som_usd ?? 0, i18n.language)}
            />
            <KpiCard
              icon={<Building2 className="h-4 w-4" aria-hidden />}
              label={t('competitors.kpi.competitors')}
              value={formatNumber(market?.company_count_total ?? result.total, i18n.language)}
            />
            <KpiCard
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              label={t('competitors.kpi.leader')}
              value={leaderName}
              valueClassName="text-sm"
            />
            <KpiCard
              icon={<Activity className="h-4 w-4" aria-hidden />}
              label={t('competitors.kpi.concentration')}
              value={
                market?.hhi != null
                  ? `${t('competitors.kpi.hhi')} ${market.hhi.toFixed(3)}`
                  : '—'
              }
              sub={
                market?.concentration_top3_pct != null
                  ? `${t('competitors.kpi.top3')}: ${formatPercent(market.concentration_top3_pct)}`
                  : undefined
              }
              badge={
                competitionLevel ? (
                  <Badge variant={COMPETITION_VARIANT[competitionLevel] ?? 'muted'}>
                    {t(`competitors.competition.${competitionLevel}`)}
                  </Badge>
                ) : null
              }
            />
          </div>

          {/* Map */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[color:var(--primary)]" aria-hidden />
                {t('competitors.map.title')}
              </CardTitle>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">
                {t('competitors.map.hint')}
              </span>
            </CardHeader>
            <CardContent>
              <div className="h-[520px] w-full overflow-hidden rounded-md border border-[color:var(--border)]">
                <MapShell companies={mapPoints} />
              </div>
            </CardContent>
          </Card>

          {/* Charts */}
          <MarketCharts market={market} />

          {/* Competitor table */}
          <CompetitorTable competitors={result.competitors} />
        </>
      )}
    </div>
  );
}

// --- Tune controls (live re-run) -------------------------------------------

interface TuneControlsProps {
  options: ReturnType<typeof useCompetitorOptions>['data'];
  regions: string[];
  addressablePct: number;
  obtainablePct: number;
  onTune: TuneControlsCallback;
}

type TuneControlsCallback = (
  next: Partial<{ regions: string[]; price: string | null; addr: number; obt: number }>,
) => void;

function TuneControls({
  options,
  regions,
  addressablePct,
  obtainablePct,
  onTune,
}: TuneControlsProps): JSX.Element {
  const { t } = useTranslation();
  const regionOpts = options?.regions ?? [];
  const priceOpts = options?.prices ?? [];

  const toggleRegion = (key: string): void => {
    const has = regions.includes(key);
    onTune({ regions: has ? regions.filter((r) => r !== key) : [...regions, key] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[color:var(--primary)]" aria-hidden />
          {t('competitors.results.tune')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {regionOpts.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[color:var(--muted-foreground)]">
              {t('competitors.results.tuneRegions')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {regionOpts.map((r) => {
                const active = regions.includes(r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleRegion(r.key)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-[color:var(--primary)] bg-[color:var(--primary)]/10 text-[color:var(--foreground)]'
                        : 'border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:border-[color:var(--ring)]',
                    )}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {priceOpts.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[color:var(--muted-foreground)]">
              {t('competitors.results.tunePrice')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {priceOpts.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onTune({ price: p.key })}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    'border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:border-[color:var(--ring)]',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <PctSlider
            label={t('competitors.results.addressablePct')}
            value={addressablePct}
            onChange={(v) => onTune({ addr: v })}
          />
          <PctSlider
            label={t('competitors.results.obtainablePct')}
            value={obtainablePct}
            onChange={(v) => onTune({ obt: v })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface PctSliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
}

function PctSlider({ label, value, onChange }: PctSliderProps): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-xs font-medium text-[color:var(--muted-foreground)]">
        {label}
        <span className="tabular-nums text-[color:var(--foreground)]">
          {Math.round(value * 100)}%
        </span>
      </span>
      <input
        type="range"
        min={1}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[color:var(--muted)] accent-[color:var(--primary)]"
      />
    </label>
  );
}

// --- KPI card ---------------------------------------------------------------

interface KpiCardProps {
  icon: JSX.Element;
  label: string;
  value: string;
  sub?: string;
  badge?: JSX.Element | null;
  valueClassName?: string;
}

function KpiCard({ icon, label, value, sub, badge, valueClassName }: KpiCardProps): JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5 p-3">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[color:var(--muted-foreground)]">
          <span className="text-[color:var(--primary)]">{icon}</span>
          {label}
        </span>
        <span className={cn('truncate text-lg font-semibold tabular-nums', valueClassName)} title={value}>
          {value}
        </span>
        {sub ? (
          <span className="truncate text-[11px] text-[color:var(--muted-foreground)]">{sub}</span>
        ) : null}
        {badge ? <div className="pt-0.5">{badge}</div> : null}
      </CardContent>
    </Card>
  );
}

// --- Competitor table -------------------------------------------------------

function CompetitorTable({ competitors }: { competitors: Competitor[] }): JSX.Element {
  const { t, i18n } = useTranslation();
  const selectCompany = useMapStore((s) => s.selectCompany);
  const [sortDesc, setSortDesc] = useState(true);

  const rows = useMemo(() => {
    const copy = [...competitors];
    copy.sort((a, b) => {
      const av = a.revenue_usd ?? 0;
      const bv = b.revenue_usd ?? 0;
      return sortDesc ? bv - av : av - bv;
    });
    return copy;
  }, [competitors, sortDesc]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[color:var(--primary)]" aria-hidden />
          {t('competitors.table.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-[color:var(--muted-foreground)]">
            {t('competitors.table.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border)] text-left text-xs text-[color:var(--muted-foreground)]">
                  <th className="px-3 py-2 font-medium">{t('competitors.table.name')}</th>
                  <th className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => setSortDesc((d) => !d)}
                      className="inline-flex items-center gap-1 hover:text-[color:var(--foreground)]"
                    >
                      {t('competitors.table.revenue')}
                      <TrendingUp
                        className={cn('h-3 w-3 transition-transform', !sortDesc && 'rotate-180')}
                        aria-hidden
                      />
                    </button>
                  </th>
                  <th className="px-3 py-2 font-medium">{t('competitors.table.employees')}</th>
                  <th className="px-3 py-2 font-medium">{t('competitors.table.region')}</th>
                  <th className="px-3 py-2 font-medium">{t('competitors.table.share')}</th>
                  <th className="px-3 py-2 font-medium">{t('competitors.table.tags')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => selectCompany(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectCompany(c.id);
                      }
                    }}
                    className="cursor-pointer border-b border-[color:var(--border)] last:border-0 hover:bg-[color:var(--accent)] focus:bg-[color:var(--accent)] focus:outline-none"
                  >
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {c.revenue_usd != null ? formatCurrency(c.revenue_usd, i18n.language) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {c.employee_count != null ? formatNumber(c.employee_count, i18n.language) : '—'}
                    </td>
                    <td className="px-3 py-2 text-[color:var(--muted-foreground)]">
                      {c.region_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {c.market_share_pct != null ? formatPercent(c.market_share_pct) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(c.tags ?? []).slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="muted" className="px-1.5 py-0 text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Loading / error states -------------------------------------------------

interface ResultsSkeletonProps {
  onReset?: () => void;
  resetLabel?: string;
}

function ResultsSkeleton({ onReset, resetLabel }: ResultsSkeletonProps = {}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {onReset && resetLabel ? (
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-48" />
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {resetLabel}
          </Button>
        </div>
      ) : (
        <Skeleton className="h-20 w-full" />
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-[420px] w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    </div>
  );
}

interface ErrorPanelProps {
  message: string;
  detail?: string;
  retryLabel: string;
  onRetry: () => void;
  resetLabel?: string;
  onReset?: () => void;
}

function ErrorPanel({
  message,
  detail,
  retryLabel,
  onRetry,
  resetLabel,
  onReset,
}: ErrorPanelProps): JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm font-medium text-[color:var(--foreground)]">{message}</p>
        {detail ? (
          <p className="text-xs text-[color:var(--muted-foreground)]">{detail}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {retryLabel}
          </Button>
          {onReset && resetLabel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onReset}>
              {resetLabel}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
