import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMapStore } from '../../stores/map';
import { useCompany } from '../../hooks/useCompany';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/cn';
import { AddToListMenu } from '@/components/lists/AddToListMenu';
import { OverviewTab } from './tabs/OverviewTab';
import { FinancialsTab } from './tabs/FinancialsTab';
import { NewsTab } from './tabs/NewsTab';
import { OwnersTab } from './tabs/OwnersTab';
import { TimelineTab } from './tabs/TimelineTab';
import type { CompanyDetail } from '../../types/company';

type DrawerTab = 'overview' | 'financials' | 'news' | 'owners' | 'timeline';

const TAB_ORDER: DrawerTab[] = ['overview', 'financials', 'news', 'owners', 'timeline'];

/**
 * Right-side deep drawer for a single company. Driven by `useMapStore.selectedCompanyId`.
 * Mount this once, near the map.
 */
export function CompanyDeepDrawer(): JSX.Element {
  const selectedCompanyId = useMapStore((s) => s.selectedCompanyId);
  const selectCompany = useMapStore((s) => s.selectCompany);
  const { t } = useTranslation();
  const [tab, setTab] = useState<DrawerTab>('overview');

  const open = selectedCompanyId !== null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) selectCompany(null);
    },
    [selectCompany],
  );

  const handleSelectSimilar = useCallback(
    (id: string) => {
      setTab('overview');
      selectCompany(id);
    },
    [selectCompany],
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        closeLabel={t('drawer.close', { defaultValue: 'Close' })}
        className="flex flex-col gap-0 p-0"
      >
        {selectedCompanyId ? (
          <DrawerInner
            companyId={selectedCompanyId}
            tab={tab}
            onTabChange={(v) => setTab(v)}
            onSelectSimilar={handleSelectSimilar}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

interface DrawerInnerProps {
  companyId: string;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  onSelectSimilar: (id: string) => void;
}

function DrawerInner({ companyId, tab, onTabChange, onSelectSimilar }: DrawerInnerProps): JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useCompany(companyId);

  const tabLabels = useMemo<Record<DrawerTab, string>>(
    () => ({
      overview: t('drawer.tab.overview', { defaultValue: 'Overview' }),
      financials: t('drawer.tab.financials', { defaultValue: 'Financials' }),
      news: t('drawer.tab.news', { defaultValue: 'News' }),
      owners: t('drawer.tab.owners', { defaultValue: 'Owners' }),
      timeline: t('drawer.tab.timeline', { defaultValue: 'Timeline' }),
    }),
    [t],
  );

  return (
    <>
      <DrawerHeader
        loading={isLoading}
        error={isError ? error : null}
        company={data ?? null}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isError && !data ? (
          <ErrorState message={error.message} onRetry={() => void refetch()} />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => onTabChange(v as DrawerTab)}
            className="flex flex-col gap-3"
          >
            <TabsList className="flex w-full flex-wrap justify-start">
              {TAB_ORDER.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {tabLabels[key]}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="overview">
              {tab === 'overview' ? (
                <OverviewTab
                  companyId={companyId}
                  active={tab === 'overview'}
                  onSelectSimilar={onSelectSimilar}
                />
              ) : null}
            </TabsContent>
            <TabsContent value="financials">
              {tab === 'financials' ? <FinancialsTab companyId={companyId} /> : null}
            </TabsContent>
            <TabsContent value="news">
              {tab === 'news' ? <NewsTab companyId={companyId} /> : null}
            </TabsContent>
            <TabsContent value="owners">
              {tab === 'owners' ? <OwnersTab companyId={companyId} /> : null}
            </TabsContent>
            <TabsContent value="timeline">
              {tab === 'timeline' ? (
                <TimelineTab companyId={companyId} active={tab === 'timeline'} />
              ) : null}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}

function DrawerHeader({
  loading,
  error,
  company,
}: {
  loading: boolean;
  error: Error | null;
  company: CompanyDetail | null;
}): JSX.Element {
  const { t } = useTranslation();

  if (loading && !company) {
    return (
      <SheetHeader className="pr-12">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-md" />
          <div className="flex-1">
            <Skeleton className="mb-1 h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <SheetTitle className="sr-only">{t('drawer.loading', { defaultValue: 'Loading…' })}</SheetTitle>
      </SheetHeader>
    );
  }

  if (!company) {
    return (
      <SheetHeader className="pr-12">
        <SheetTitle>{error ? t('drawer.error', { defaultValue: 'Error' }) : '—'}</SheetTitle>
      </SheetHeader>
    );
  }

  const statusVariant = mapStatusVariant(company.status);

  return (
    <SheetHeader className="pr-12">
      <div className="flex items-center gap-3">
        <LogoOrInitials name={company.name} website={company.website} />
        <div className="min-w-0 flex-1">
          <SheetTitle className="truncate">{company.name}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-1.5">
            {company.bin ? <span className="font-mono">{company.bin}</span> : null}
            {company.bin && company.legal_form ? <span aria-hidden="true">·</span> : null}
            {company.legal_form ? <span>{company.legal_form}</span> : null}
          </SheetDescription>
        </div>
        {company.status ? (
          <Badge variant={statusVariant} className="shrink-0">
            {company.status}
          </Badge>
        ) : null}
        <AddToListMenu companyId={company.id} />
      </div>
    </SheetHeader>
  );
}

function LogoOrInitials({
  name,
  website,
}: {
  name: string;
  website: string | null;
}): JSX.Element {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  const logoUrl = useMemo(() => {
    if (!website) return null;
    try {
      const host = new URL(website).hostname.replace(/^www\./, '');
      return `https://logo.clearbit.com/${encodeURIComponent(host)}`;
    } catch {
      return null;
    }
  }, [website]);

  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-md border border-[color:var(--border)] object-contain bg-white"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
        'bg-[color:var(--muted)] text-xs font-semibold uppercase text-[color:var(--muted-foreground)]',
      )}
    >
      {initials || '?'}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <p className="font-medium">{t('drawer.error', { defaultValue: 'Failed to load company' })}</p>
      <p className="text-xs opacity-80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-md border border-red-300 px-3 py-1 text-xs hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900"
      >
        {t('common.retry', { defaultValue: 'Retry' })}
      </button>
    </div>
  );
}

function mapStatusVariant(status: string | null): 'success' | 'warn' | 'danger' | 'muted' {
  if (!status) return 'muted';
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('действ')) return 'success';
  if (s.includes('liquid') || s.includes('ликвид') || s.includes('закры')) return 'danger';
  if (s.includes('suspend') || s.includes('приост')) return 'warn';
  return 'muted';
}

export default CompanyDeepDrawer;
