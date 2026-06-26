import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useAuth } from '@/services/auth';
import { useMyUsage } from '@/hooks/useMe';

const APPROACH_THRESHOLD = 0.8;

interface UpgradeBannerProps {
  className?: string;
  /** Disable dismiss button. */
  persistent?: boolean;
}

export function UpgradeBanner({ className, persistent = false }: UpgradeBannerProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const usage = useMyUsage();
  const [dismissed, setDismissed] = useState(false);

  if (!user || dismissed) return null;
  if (usage.isLoading || usage.isError || !usage.data) return null;

  const { used, limit } = usage.data.searches;
  if (limit <= 0) return null;
  const ratio = used / limit;
  if (ratio < APPROACH_THRESHOLD) return null;

  const atLimit = used >= limit;
  const pct = Math.min(100, Math.round(ratio * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col gap-2 rounded-md border p-3 text-xs sm:flex-row sm:items-center sm:justify-between',
        atLimit
          ? 'border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 text-[color:var(--destructive)]'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">
            {atLimit
              ? "You've reached your free tier limit."
              : "You're approaching your free tier limit."}
          </p>
          <p className="opacity-80">
            {used} / {limit} searches used ({pct}%). Upgrade for unlimited access.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:ml-3">
        <Button
          type="button"
          variant="default"
          size="sm"
          // Placeholder — wire up to billing flow later.
          onClick={() => {
            /* TODO: navigate to upgrade flow */
          }}
        >
          {t('auth.upgrade')}
        </Button>
        {!persistent && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="grid h-6 w-6 place-items-center rounded-sm opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
