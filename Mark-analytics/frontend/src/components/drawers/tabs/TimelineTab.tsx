import { Clock } from 'lucide-react';
import { useCompanyTimeline } from '../../../hooks/useCompanyTimeline';
import { Card, CardContent } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Skeleton } from '../../ui/skeleton';
import { formatDateTime } from '../../../lib/format';
import type { TimelineEvent } from '../../../types/company';

export interface TimelineTabProps {
  companyId: string;
  active: boolean;
}

export function TimelineTab({ companyId, active }: TimelineTabProps): JSX.Element {
  const { data, isLoading, isError, error, refetch } = useCompanyTimeline(companyId, {
    enabled: active,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-xs text-[color:var(--muted-foreground)]" role="alert">
            Failed to load timeline ({error.message})
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-[color:var(--border)] px-3 py-1 text-xs hover:bg-[color:var(--accent)]"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const events = data ?? [];
  if (events.length === 0) {
    return (
      <p className="px-1 text-xs text-[color:var(--muted-foreground)]">No timeline events yet.</p>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {events.map((e, idx) => (
        <li key={`${e.kind}-${e.at}-${idx}`}>
          <Card className="px-3 py-2">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--muted-foreground)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={kindVariant(e.kind)}>{e.kind}</Badge>
                  <time
                    dateTime={e.at}
                    className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]"
                  >
                    {formatDateTime(e.at)}
                  </time>
                </div>
                <p className="mt-1 text-sm">{e.label}</p>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ol>
  );
}

function kindVariant(kind: TimelineEvent['kind']): 'info' | 'success' | 'warn' | 'muted' {
  switch (kind) {
    case 'registered':
      return 'success';
    case 'tender':
      return 'info';
    case 'updated':
      return 'muted';
    default:
      return 'muted';
  }
}

export default TimelineTab;
