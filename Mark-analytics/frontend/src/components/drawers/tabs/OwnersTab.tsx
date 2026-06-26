import { Users2, Network } from 'lucide-react';
import { useCompany } from '../../../hooks/useCompany';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Skeleton } from '../../ui/skeleton';
import { formatPercent, formatDate } from '../../../lib/format';
import type { CompanyOwner } from '../../../types/company';

export interface OwnersTabProps {
  companyId: string;
}

export function OwnersTab({ companyId }: OwnersTabProps): JSX.Element {
  const { data, isLoading } = useCompany(companyId);

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const founders = data.founders ?? [];
  const directors = data.directors ?? [];

  return (
    <div className="flex flex-col gap-4">
      <OwnersSection
        title="Founders"
        icon={<Users2 className="h-3.5 w-3.5" aria-hidden="true" />}
        items={founders}
        emptyHint="No founder data available."
        showShare
      />
      <OwnersSection
        title="Directors"
        icon={<Users2 className="h-3.5 w-3.5" aria-hidden="true" />}
        items={directors}
        emptyHint="No director data available."
        showShare={false}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
            <Network className="h-3.5 w-3.5" aria-hidden="true" />
            Beneficial ownership graph
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[color:var(--border)] px-4 py-6 text-center">
            <Badge variant="muted">Knowledge Graph view — Phase 3</Badge>
            <p className="max-w-[36ch] text-xs text-[color:var(--muted-foreground)]">
              Interactive ownership graph (UBO) will be available after Neo4j
              integration in Phase 3.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OwnersSection({
  title,
  icon,
  items,
  emptyHint,
  showShare,
}: {
  title: string;
  icon: React.ReactNode;
  items: CompanyOwner[];
  emptyHint: string;
  showShare: boolean;
}): JSX.Element {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
        {icon}
        <span>{title}</span>
        <span className="ml-auto font-normal normal-case tracking-normal">{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-[color:var(--muted-foreground)]">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((o, idx) => (
            <li key={`${o.name}-${idx}`}>
              <Card className="px-3 py-2">
                <div className="flex items-start gap-3">
                  <div
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--muted)] text-[10px] font-semibold uppercase text-[color:var(--muted-foreground)]"
                  >
                    {initials(o.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{o.name}</p>
                    <p className="truncate text-xs text-[color:var(--muted-foreground)]">
                      {o.role ? o.role : 'Owner'}
                      {o.country ? ` · ${o.country}` : ''}
                      {o.since ? ` · since ${formatDate(o.since)}` : ''}
                    </p>
                  </div>
                  {showShare && o.share_pct !== undefined && o.share_pct !== null ? (
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {formatPercent(o.share_pct, 1)}
                    </Badge>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export default OwnersTab;
