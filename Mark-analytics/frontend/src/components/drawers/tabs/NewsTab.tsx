import { Newspaper, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '../../ui/card';
import { Badge } from '../../ui/badge';

export interface NewsTabProps {
  companyId: string;
}

/**
 * News tab placeholder. Backend exposes `/trends/companies-by-month` but a
 * per-company news feed is scheduled for Phase 3.
 */
export function NewsTab(_props: NewsTabProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--muted)] text-[color:var(--muted-foreground)]">
            <Newspaper className="h-5 w-5" aria-hidden="true" />
          </div>
          <Badge variant="muted">Coming in Phase 3</Badge>
          <p className="max-w-[34ch] text-xs text-[color:var(--muted-foreground)]">
            Per-company news feed is not yet available. Meanwhile, browse aggregate
            monthly trends across the market.
          </p>
          <a
            href="/trends/companies-by-month"
            className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--primary)] hover:underline"
          >
            View market trends
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </CardContent>
      </Card>
      <ul className="flex flex-col gap-2" aria-label="News (empty)">
        {/* Intentionally empty list to keep markup stable for future rendering. */}
      </ul>
    </div>
  );
}

export default NewsTab;
