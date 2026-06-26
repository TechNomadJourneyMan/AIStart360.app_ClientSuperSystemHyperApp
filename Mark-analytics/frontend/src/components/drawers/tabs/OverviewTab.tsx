import { useTranslation } from 'react-i18next';
import { ExternalLink, Mail, Phone, MapPin, Building2, Users, CalendarDays } from 'lucide-react';
import { useCompany } from '../../../hooks/useCompany';
import { useCompanyInsights } from '../../../hooks/useCompanyInsights';
import { useCompanySimilar } from '../../../hooks/useCompanySimilar';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Skeleton } from '../../ui/skeleton';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber } from '../../../lib/format';
import type { CompanyDetail, CompanyInsight, CompanyListItem } from '../../../types/company';

export interface OverviewTabProps {
  companyId: string;
  /** Drawer is open AND this tab is selected — controls whether lazy queries fire. */
  active: boolean;
  onSelectSimilar?: (id: string) => void;
}

export function OverviewTab({ companyId, active, onSelectSimilar }: OverviewTabProps): JSX.Element {
  const { data: company, isLoading } = useCompany(companyId);
  const insightsQuery = useCompanyInsights(companyId, { enabled: active });
  const similarQuery = useCompanySimilar(companyId, { enabled: active, limit: 5 });

  if (isLoading || !company) {
    return <OverviewSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4">
      <FactsGrid company={company} />

      <section aria-labelledby="drawer-insights-heading" className="flex flex-col gap-2">
        <h4 id="drawer-insights-heading" className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Insights
        </h4>
        <InsightsBlock
          loading={insightsQuery.isLoading}
          error={insightsQuery.isError ? insightsQuery.error : null}
          insights={(insightsQuery.data?.insights ?? company.insights ?? []).slice(0, 3)}
        />
      </section>

      <section aria-labelledby="drawer-similar-heading" className="flex flex-col gap-2">
        <h4 id="drawer-similar-heading" className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Similar companies
        </h4>
        <SimilarBlock
          loading={similarQuery.isLoading}
          error={similarQuery.isError ? similarQuery.error : null}
          items={similarQuery.data ?? company.similar ?? []}
          onSelect={onSelectSimilar}
        />
      </section>
    </div>
  );
}

function FactsGrid({ company }: { company: CompanyDetail }): JSX.Element {
  const { t } = useTranslation();
  const industryLabel =
    company.industry?.label ??
    company.industry?.code ??
    null;
  const location = [company.region_name, company.city_name].filter(Boolean).join(', ') || null;

  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Fact icon={<Building2 className="h-3.5 w-3.5" aria-hidden="true" />} label="Industry" value={industryLabel ?? '—'} />
      <Fact icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />} label="Location" value={location ?? '—'} />
      <Fact
        icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Employees"
        value={company.employee_count != null ? formatNumber(company.employee_count) : '—'}
      />
      <Fact
        icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Registered"
        value={formatDate(company.registered_at)}
      />
      <Fact
        icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Website"
        value={
          company.website ? (
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[color:var(--primary)] underline-offset-2 hover:underline"
            >
              {prettyUrl(company.website)}
            </a>
          ) : (
            '—'
          )
        }
      />
      <Fact
        icon={<Phone className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Phone"
        value={
          company.phone ? (
            <a className="hover:underline" href={`tel:${company.phone}`}>
              {company.phone}
            </a>
          ) : (
            '—'
          )
        }
      />
      <Fact
        icon={<Mail className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Email"
        value={
          company.email ? (
            <a className="hover:underline" href={`mailto:${company.email}`}>
              {company.email}
            </a>
          ) : (
            '—'
          )
        }
      />
      <Fact
        icon={null}
        label={t('drawer.label.source', { defaultValue: 'Source' })}
        value={company.data_source ?? '—'}
      />
    </dl>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">
        {icon}
        <span>{label}</span>
      </dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  );
}

function InsightsBlock({
  loading,
  error,
  insights,
}: {
  loading: boolean;
  error: Error | null;
  insights: CompanyInsight[];
}): JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-[color:var(--muted-foreground)]" role="alert">
        Failed to load insights ({error.message}).
      </p>
    );
  }
  if (insights.length === 0) {
    return (
      <p className="text-xs text-[color:var(--muted-foreground)]">
        No insights yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {insights.map((i, idx) => (
        <li key={`${i.title}-${idx}`}>
          <Card className="px-3 py-2">
            <div className="flex items-start gap-2">
              <Badge variant={mapSeverity(i.severity)} className="mt-0.5 shrink-0">
                {i.severity}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{i.title}</p>
                <p className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">{i.body}</p>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function SimilarBlock({
  loading,
  error,
  items,
  onSelect,
}: {
  loading: boolean;
  error: Error | null;
  items: CompanyListItem[];
  onSelect?: (id: string) => void;
}): JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-[color:var(--muted-foreground)]" role="alert">
        Failed to load similar companies ({error.message}).
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="text-xs text-[color:var(--muted-foreground)]">No similar companies yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.slice(0, 5).map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect?.(c.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-left',
              'hover:bg-[color:var(--accent)] hover:text-[color:var(--accent-foreground)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
            )}
          >
            <div
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[color:var(--muted)] text-[10px] font-semibold uppercase text-[color:var(--muted-foreground)]"
            >
              {initials(c.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="truncate text-xs text-[color:var(--muted-foreground)]">
                {c.industry?.label ?? c.industry?.code ?? '—'}
                {c.region_name ? ` · ${c.region_name}` : ''}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function OverviewSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function mapSeverity(s: CompanyInsight['severity']): 'success' | 'info' | 'warn' | 'danger' {
  switch (s) {
    case 'ok':
      return 'success';
    case 'warn':
      return 'warn';
    case 'danger':
      return 'danger';
    default:
      return 'info';
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default OverviewTab;
